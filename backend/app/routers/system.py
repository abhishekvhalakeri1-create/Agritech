"""Weather, AI summary, and network/transmission routes."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import db
from ..config import DEFAULT_LAT, DEFAULT_LON, GEMINI_API_KEY, GEMINI_MODEL
from ..evidence_engine import UNRESOLVED_STATUSES, evidence_debt
from ..services import gemini_summary
from ..services.observations import record_transmission
from ..services.weather import fetch_weather

router = APIRouter()


@router.get("/weather")
async def weather(lat: float | None = None, lon: float | None = None, force: bool = False) -> dict[str, Any]:
    if lat is None:
        fields = db.fetch_all("fields", order="name ASC")
        first = next((f for f in fields if f.get("latitude")), None)
        lat = (first or {}).get("latitude") or DEFAULT_LAT
        lon = (first or {}).get("longitude") or DEFAULT_LON
        field_name = (first or {}).get("name")
    else:
        field_name = None
    payload = await fetch_weather(lat, lon if lon is not None else DEFAULT_LON, force=force)
    payload["fieldName"] = field_name
    return payload


class SummaryRequest(BaseModel):
    fields: list[dict[str, Any]] | None = None
    observations: list[dict[str, Any]] | None = None
    focusFieldId: str | None = None


@router.post("/field-health-summary")
def field_health_summary(payload: SummaryRequest | None = None) -> dict[str, Any]:
    """AI agricultural summary. Key stays server-side; local fallback is labelled."""
    payload = payload or SummaryRequest()
    fields = payload.fields or db.fetch_all("fields", order="name ASC")
    observations = payload.observations or db.fetch_all("observations")

    if payload.focusFieldId:
        fields = [f for f in fields if f.get("id") == payload.focusFieldId]
        observations = [o for o in observations if o.get("fieldId") == payload.focusFieldId]

    if isinstance(observations, list):
        observations = sorted(observations, key=lambda o: o.get("createdAt") or "", reverse=True)

    debt = evidence_debt(db.fetch_all("observations"))
    result = gemini_summary.generate_summary(fields, observations, debt)
    result["evidenceDebt"] = {"score": debt["score"], "band": debt["band"]}
    result["context"] = {
        "fieldCount": len(fields),
        "observationCount": len(observations),
        "geminiModel": GEMINI_MODEL,
        "keyConfigured": bool(GEMINI_API_KEY),
    }
    return result


# ------------------------------------------------------------------- network
class TransmissionCreate(BaseModel):
    observationId: str | None = None
    observationTitle: str | None = None
    event: str
    state: str = "saved_local"
    detail: str = ""


VALID_STATES = {"saved_local", "queued", "synced", "failed", "retrying"}


@router.get("/transmissions")
def list_transmissions(limit: int = 120) -> dict[str, Any]:
    rows = db.fetch_all("transmissions", order="createdAt DESC")
    return {"transmissions": rows[:limit], "count": len(rows)}


@router.post("/transmissions", status_code=201)
def add_transmission(payload: TransmissionCreate) -> dict[str, Any]:
    state = payload.state if payload.state in VALID_STATES else "saved_local"
    observation = db.fetch_one("observations", payload.observationId) if payload.observationId else None
    if observation and state in {"synced", "failed"}:
        # A client-reported delivery outcome is mirrored onto the observation.
        db.update("observations", observation["id"], {
            "syncStatus": "synced" if state == "synced" else "failed",
        })
    return record_transmission(
        observation,
        payload.event,
        state,
        payload.detail,
        observation_id=payload.observationId,
        observation_title=payload.observationTitle,
    )


@router.get("/network")
def network_state() -> dict[str, Any]:
    observations = db.fetch_all("observations")
    transmissions = db.fetch_all("transmissions", order="createdAt DESC")
    gaps = [g for o in observations for g in (o.get("evidenceGaps") or []) if not g.get("resolved")]
    counts = {state: sum(1 for t in transmissions if t["state"] == state) for state in VALID_STATES}
    return {
        "serverReachable": True,
        "trackedObservations": len(observations),
        "unverifiedRecords": sum(1 for o in observations if o["status"] in UNRESOLVED_STATUSES),
        "localOnly": sum(1 for o in observations if o.get("syncStatus") == "local_only"),
        "pendingSync": sum(1 for o in observations if o.get("syncStatus") == "pending_sync"),
        "synced": sum(1 for o in observations if o.get("syncStatus") == "synced"),
        "failed": sum(1 for o in observations if o.get("syncStatus") == "failed"),
        "evidenceGaps": len(gaps),
        "transmissionCounts": counts,
        "transmissions": transmissions[:60],
        "evidenceDebt": evidence_debt(observations)["score"],
        "note": (
            "FIELDZY only marks a record as delivered after an explicit server acknowledgement. A browser "
            "reporting itself online is not delivery. No device-to-device relay mesh is implemented."
        ),
    }
