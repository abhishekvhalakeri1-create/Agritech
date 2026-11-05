"""Core FIELDZY routes: system, fields, observations, evidence, threats."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import db
from ..config import APP_NAME, APP_TAGLINE, ENGINE_VERSION, GEMINI_API_KEY, GEMINI_MODEL
from ..evidence_engine import (
    UNRESOLVED_STATUSES,
    apply_review,
    evidence_debt,
    resolve_gap,
    validate_evidence,
)
from ..services import audio_model, plant_model
from ..services.observations import (
    create_observation,
    field_summary_counts,
    recompute_field_activity,
    record_transmission,
)

router = APIRouter()


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


# --------------------------------------------------------------------- system
@router.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "app": APP_NAME,
        "tagline": APP_TAGLINE,
        "engineVersion": ENGINE_VERSION,
        "time": _now(),
        "observations": len(db.fetch_all("observations")),
    }


@router.get("/model-status")
def model_status() -> dict[str, Any]:
    return {
        "plant": plant_model.status(),
        "audio": audio_model.status(),
        "summary": {
            "provider": "Google Gemini",
            "model": GEMINI_MODEL,
            "keyConfigured": bool(GEMINI_API_KEY),
            "activeSource": "gemini" if GEMINI_API_KEY else "local_rules",
        },
        "weather": {"provider": "Open-Meteo", "live": True},
        "engineVersion": ENGINE_VERSION,
    }


# ---------------------------------------------------------------------- fields
class FieldCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    crop: str = ""
    areaHa: float = 0
    location: str = ""
    latitude: float | None = None
    longitude: float | None = None
    soilThresholdLow: float = 35
    soilThresholdCritical: float = 20
    notes: str = ""


class FieldUpdate(BaseModel):
    name: str | None = None
    crop: str | None = None
    areaHa: float | None = None
    location: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    soilThresholdLow: float | None = None
    soilThresholdCritical: float | None = None
    notes: str | None = None
    status: str | None = None


def _decorate_field(field: dict[str, Any]) -> dict[str, Any]:
    observations = db.fetch_all("observations", "fieldId = ?", (field["id"],))
    counts = field_summary_counts(field["id"])
    open_warnings = [o for o in observations if o["status"] in UNRESOLVED_STATUSES]
    return {
        **field,
        "observationCount": counts["observationCount"],
        "unresolvedCount": counts["unresolvedCount"],
        "openGaps": counts["openGaps"],
        "latestObservation": counts["latestObservation"],
        "openWarnings": open_warnings[:3],
        "openWarningCount": len(open_warnings),
    }


@router.get("/fields")
def list_fields() -> dict[str, Any]:
    fields = db.fetch_all("fields", order="name ASC")
    for field in fields:
        recompute_field_activity(field["id"])
    fields = db.fetch_all("fields", order="name ASC")
    return {"fields": [_decorate_field(f) for f in fields]}


@router.post("/fields", status_code=201)
def create_field(payload: FieldCreate) -> dict[str, Any]:
    field = {
        "id": f"FLD-{uuid.uuid4().hex[:4].upper()}",
        **payload.model_dump(),
        "status": "stable",
        "createdAt": _now(),
        "updatedAt": _now(),
    }
    db.insert("fields", field)
    return _decorate_field(field)


@router.patch("/fields/{field_id}")
def update_field(field_id: str, payload: FieldUpdate) -> dict[str, Any]:
    if not db.fetch_one("fields", field_id):
        raise HTTPException(404, "Field not found")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    updates["updatedAt"] = _now()
    db.update("fields", field_id, updates)
    return _decorate_field(db.fetch_one("fields", field_id))


@router.delete("/fields/{field_id}", status_code=204)
def delete_field(field_id: str) -> None:
    if not db.delete("fields", field_id):
        raise HTTPException(404, "Field not found")
    # Observations are kept: they are field history and the debt meter must not
    # silently forget them.
    for obs in db.fetch_all("observations", "fieldId = ?", (field_id,)):
        db.update("observations", obs["id"], {"fieldId": None, "fieldName": "Unassigned", "updatedAt": _now()})


# ---------------------------------------------------------------- observations
class ObservationCreate(BaseModel):
    fieldId: str | None = None
    feature: str = "manual_observation"
    category: str = "manual"
    title: str = Field(min_length=3, max_length=160)
    description: str = ""
    severity: str | None = None
    modelResult: dict[str, Any] | None = None
    evidence: dict[str, Any] | None = None
    context: dict[str, Any] | None = None
    syncStatus: str = "synced"


class GapResolution(BaseModel):
    resolved: bool = True
    note: str = ""
    resolvedBy: str = "Field reviewer"


class ReviewRequest(BaseModel):
    decision: str = Field(pattern="^(verify|resolve|request_evidence|reject|flag_conflict)$")
    note: str = ""
    reviewer: str = "Field reviewer"


@router.get("/observations")
def list_observations(fieldId: str | None = None, status: str | None = None, feature: str | None = None) -> dict[str, Any]:
    clauses, params = [], []
    if fieldId:
        clauses.append("fieldId = ?")
        params.append(fieldId)
    if status:
        clauses.append("status = ?")
        params.append(status)
    if feature:
        clauses.append("feature = ?")
        params.append(feature)
    observations = db.fetch_all("observations", " AND ".join(clauses), tuple(params))
    return {"observations": observations, "count": len(observations)}


@router.post("/observations", status_code=201)
def add_observation(payload: ObservationCreate) -> dict[str, Any]:
    observation = create_observation(
        field_id=payload.fieldId,
        feature=payload.feature,
        category=payload.category,
        title=payload.title,
        description=payload.description,
        severity=payload.severity,
        model_result=payload.modelResult,
        evidence=payload.evidence,
        context=payload.context,
        sync_status=payload.syncStatus,
    )
    if observation.get("fieldId"):
        recompute_field_activity(observation["fieldId"])
    return observation


@router.get("/observations/{observation_id}")
def get_observation(observation_id: str) -> dict[str, Any]:
    observation = db.fetch_one("observations", observation_id)
    if not observation:
        raise HTTPException(404, "Observation not found")
    transmissions = db.fetch_all("transmissions", "observationId = ?", (observation_id,), order="createdAt DESC")
    return {**observation, "transmissions": transmissions}


@router.patch("/observations/{observation_id}")
def update_observation(observation_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    observation = db.fetch_one("observations", observation_id)
    if not observation:
        raise HTTPException(404, "Observation not found")
    allowed = {"title", "description", "severity", "fieldId", "syncStatus", "nextAction"}
    updates = {k: v for k, v in payload.items() if k in allowed}
    if "fieldId" in updates:
        field = db.fetch_one("fields", updates["fieldId"]) if updates["fieldId"] else None
        updates["fieldName"] = field["name"] if field else "Unassigned"
    updates["updatedAt"] = _now()
    updated = db.update("observations", observation_id, updates)
    if observation.get("fieldId"):
        recompute_field_activity(observation["fieldId"])
    return updated


@router.delete("/observations/{observation_id}", status_code=204)
def delete_observation(observation_id: str) -> None:
    observation = db.fetch_one("observations", observation_id)
    if not observation:
        raise HTTPException(404, "Observation not found")
    db.delete("observations", observation_id)
    record_transmission(
        None,
        "Observation removed from the record",
        "saved_local",
        "Deleting an observation changes the Evidence Debt Meter immediately.",
        observation_id=observation_id,
        observation_title=observation["title"],
    )
    if observation.get("fieldId"):
        recompute_field_activity(observation["fieldId"])


@router.post("/observations/{observation_id}/evidence-gaps/{gap_id}/resolve")
def resolve_evidence_gap(observation_id: str, gap_id: str, payload: GapResolution) -> dict[str, Any]:
    observation = db.fetch_one("observations", observation_id)
    if not observation:
        raise HTTPException(404, "Observation not found")
    try:
        updated = resolve_gap(observation, gap_id, payload.note, payload.resolvedBy, payload.resolved)
    except KeyError:
        raise HTTPException(404, "Evidence gap not found") from None

    updated["updatedAt"] = _now()
    saved = db.update("observations", observation_id, {
        "evidenceGaps": updated["evidenceGaps"],
        "status": updated["status"],
        "reviewStage": updated["reviewStage"],
        "reviewHistory": updated["reviewHistory"],
        "validation": updated["validation"],
        "nextAction": updated["nextAction"],
        "updatedAt": updated["updatedAt"],
    })
    record_transmission(
        saved,
        "Evidence gap resolved" if payload.resolved else "Evidence gap re-opened",
        "synced",
        payload.note or "Gap status changed by a field reviewer.",
    )
    if saved.get("fieldId"):
        recompute_field_activity(saved["fieldId"])
    return {"observation": saved, "debt": evidence_debt(db.fetch_all("observations"))}


@router.post("/observations/{observation_id}/review")
def review_observation(observation_id: str, payload: ReviewRequest) -> dict[str, Any]:
    observation = db.fetch_one("observations", observation_id)
    if not observation:
        raise HTTPException(404, "Observation not found")
    result = apply_review(observation, payload.decision, payload.note, payload.reviewer)
    if not result["allowed"]:
        raise HTTPException(409, result["reason"])
    updated = result["observation"]
    saved = db.update("observations", observation_id, {
        "status": updated["status"],
        "reviewStage": updated["reviewStage"],
        "reviewHistory": updated["reviewHistory"],
        "validation": updated["validation"],
        "nextAction": updated["nextAction"],
        "updatedAt": _now(),
    })
    record_transmission(saved, f"Review decision recorded: {payload.decision}", "synced", payload.note or "Human review recorded.")
    if saved.get("fieldId"):
        recompute_field_activity(saved["fieldId"])
    return {"observation": saved, "debt": evidence_debt(db.fetch_all("observations"))}


# ------------------------------------------------------------------- evidence
class ValidateRequest(BaseModel):
    featureName: str = "manual_observation"
    modelResult: dict[str, Any] | None = None
    context: dict[str, Any] | None = None
    evidence: dict[str, Any] | None = None


@router.post("/validate-evidence")
def validate(payload: ValidateRequest) -> dict[str, Any]:
    """Common validation layer used by every FIELDZY feature."""
    return validate_evidence(payload.featureName, payload.modelResult, payload.context, payload.evidence)


@router.get("/evidence-debt")
def get_evidence_debt() -> dict[str, Any]:
    observations = db.fetch_all("observations")
    debt = evidence_debt(observations)
    debt["fields"] = [
        {"id": f["id"], "name": f["name"], "status": f["status"]}
        for f in db.fetch_all("fields", order="name ASC")
    ]
    return debt


# --------------------------------------------------------------------- threats
SEVERITY_LEVELS = ["low", "moderate", "elevated", "critical"]


def _threat_level(observation: dict[str, Any]) -> dict[str, Any]:
    status = observation.get("status")
    severity = observation.get("severity") or "moderate"
    checks = (observation.get("validation") or {}).get("checks") or []
    quality = (sum(1 for c in checks if c["passed"]) / len(checks)) if checks else 0.0

    level = severity if severity in SEVERITY_LEVELS else "moderate"
    if status == "verified" and level == "critical":
        level = "critical"
    elif status == "conflicting":
        level = "elevated" if level in {"low", "moderate"} else level
    elif status in {"unverified", "inconclusive"} and level == "critical":
        level = "elevated"  # unverified reports are never shown at maximum severity

    tone = {"low": "sage", "moderate": "amber", "elevated": "orange", "critical": "red"}[level]
    label = {
        "verified": "Verified field event",
        "needs_review": "Awaiting human review",
        "conflicting": "Conflicting reports",
        "inconclusive": "Inconclusive",
        "unverified": "Unverified report",
        "resolved": "Resolved",
    }.get(status, status)

    return {
        "level": level,
        "tone": tone,
        "statusLabel": label,
        "evidenceQuality": round(quality, 2),
        "isConfirmed": status == "verified",
    }


@router.get("/threats")
def list_threats() -> dict[str, Any]:
    observations = db.fetch_all("observations")
    threats = []
    for obs in observations:
        if obs.get("category") not in {"threat", "disease"} and obs.get("feature") not in {"threat_monitoring", "acoustic_intelligence"}:
            continue
        threats.append(
            {
                "id": obs["id"],
                "title": obs["title"],
                "fieldId": obs.get("fieldId"),
                "fieldName": obs.get("fieldName"),
                "feature": obs.get("feature"),
                "category": obs.get("category"),
                "status": obs.get("status"),
                "severity": obs.get("severity"),
                "confidence": obs.get("confidence"),
                "createdAt": obs.get("createdAt"),
                "evidenceGaps": [g for g in (obs.get("evidenceGaps") or []) if not g.get("resolved")],
                "nextAction": obs.get("nextAction"),
                "isDemo": obs.get("isDemo"),
                "visual": _threat_level(obs),
            }
        )
    order = {"critical": 0, "elevated": 1, "moderate": 2, "low": 3}
    threats.sort(key=lambda t: (t["status"] == "resolved", order.get(t["visual"]["level"], 4), t["createdAt"]), reverse=False)
    return {
        "threats": threats,
        "counts": {
            "total": len(threats),
            "confirmed": sum(1 for t in threats if t["status"] == "verified"),
            "awaitingReview": sum(1 for t in threats if t["status"] != "verified" and t["status"] != "resolved"),
            "demoRecords": sum(1 for t in threats if t["isDemo"]),
        },
        "note": (
            "A threat is a *possible* event until its evidence is reviewed. Seeded records are marked as demo "
            "records and are not live detections."
        ),
    }


# ------------------------------------------------------------------- overview
@router.get("/overview")
def overview() -> dict[str, Any]:
    fields = db.fetch_all("fields", order="name ASC")
    for field in fields:
        recompute_field_activity(field["id"])
    fields = db.fetch_all("fields", order="name ASC")
    observations = db.fetch_all("observations")
    transmissions = db.fetch_all("transmissions", order="createdAt DESC")
    audio = db.fetch_all("audioAnalyses", order="createdAt DESC")
    plants = db.fetch_all("plantAnalyses", order="createdAt DESC")
    soil = db.fetch_all("soilReadings", order="createdAt DESC")
    debt = evidence_debt(observations)

    physical_sensors = sum(1 for r in soil if not r.get("simulated"))
    simulated_probes = sum(1 for r in soil if r.get("simulated"))

    threat_obs = [o for o in observations if o.get("category") == "threat"]
    unverified = [o for o in observations if o["status"] in UNRESOLVED_STATUSES]

    priority: list[dict[str, Any]] = []
    for obs in observations:
        if obs["status"] == "resolved":
            continue
        open_gaps = [g for g in (obs.get("evidenceGaps") or []) if not g.get("resolved")]
        checks = (obs.get("validation") or {}).get("checks") or []
        low_confidence = any(c["key"] == "model_confidence" and not c["passed"] for c in checks)
        reason = None
        if obs["status"] == "conflicting":
            reason = "Conflicting information requires reconciliation"
        elif open_gaps:
            reason = f"{len(open_gaps)} missing piece{'s' if len(open_gaps) != 1 else ''} of evidence"
        elif obs["status"] == "needs_review":
            reason = "Human review pending"
        elif low_confidence:
            reason = "Low-confidence model result"
        elif obs["status"] == "inconclusive":
            reason = "Inconclusive evidence"
        if reason:
            priority.append(
                {
                    "observationId": obs["id"],
                    "title": obs["title"],
                    "fieldName": obs.get("fieldName"),
                    "fieldId": obs.get("fieldId"),
                    "feature": obs.get("feature"),
                    "status": obs["status"],
                    "severity": obs.get("severity"),
                    "reason": reason,
                    "action": obs.get("nextAction") or "Review this report",
                    "openGaps": len(open_gaps),
                    "isDemo": obs.get("isDemo"),
                    "createdAt": obs.get("createdAt"),
                }
            )
    priority.sort(key=lambda p: (p["status"] != "conflicting", -p["openGaps"], p["createdAt"]), reverse=False)

    activity: list[dict[str, Any]] = []
    for obs in observations:
        activity.append(
            {
                "id": f"act-{obs['id']}",
                "kind": "observation",
                "title": obs["title"],
                "detail": f"{obs.get('fieldName')} · {obs['status'].replace('_', ' ')}",
                "at": obs.get("updatedAt") or obs.get("createdAt"),
                "observationId": obs["id"],
                "tone": "sage" if obs["status"] == "verified" else "amber",
            }
        )
    for tx in transmissions[:10]:
        activity.append(
            {
                "id": f"act-{tx['id']}",
                "kind": "transmission",
                "title": tx["event"],
                "detail": tx.get("observationTitle") or "",
                "state": tx["state"],
                "at": tx["createdAt"],
                "tone": "sage" if tx["state"] == "synced" else "amber" if tx["state"] == "queued" else "red",
            }
        )
    for item in audio[:5]:
        activity.append(
            {
                "id": f"act-{item['id']}",
                "kind": "acoustic",
                "title": f"Acoustic analysis · {item.get('label') or 'unclassified'}",
                "detail": f"{item.get('fieldName') or 'Unassigned'} · {item.get('engine')}",
                "at": item["createdAt"],
                "tone": "sage" if item.get("isTrainedModel") else "amber",
            }
        )
    for item in plants[:5]:
        activity.append(
            {
                "id": f"act-{item['id']}",
                "kind": "plant",
                "title": f"Plant analysis · {item.get('label') or item.get('predictedClass')}",
                "detail": f"{item.get('fieldName') or 'Unassigned'} · {item.get('engine')}",
                "at": item["createdAt"],
                "tone": "sage" if item.get("isTrainedModel") else "amber",
            }
        )
    for item in soil[:4]:
        activity.append(
            {
                "id": f"act-{item['id']}",
                "kind": "soil",
                "title": f"Soil moisture {item['moisture']:.0f}% · {item['condition']}",
                "detail": f"{item.get('fieldName')} · {'simulated probe' if item.get('simulated') else 'physical sensor'}",
                "at": item["createdAt"],
                "tone": "amber" if item["condition"] in {"low", "critical"} else "sage",
            }
        )
    activity.sort(key=lambda a: a.get("at") or "", reverse=True)

    return {
        "stats": {
            "totalFields": len(fields),
            "activeSensors": physical_sensors,
            "simulatedProbes": simulated_probes,
            "threatsDetected": len(threat_obs),
            "threatsVerified": sum(1 for t in threat_obs if t["status"] == "verified"),
            "unverifiedObservations": len(unverified),
            "observationsTotal": len(observations),
            "verifiedObservations": sum(1 for o in observations if o["status"] == "verified"),
            "evidenceDebt": debt["score"],
            "evidenceDebtBand": debt["band"],
            "audioAnalyses": len(audio),
            "plantAnalyses": len(plants),
        },
        "fields": [_decorate_field(f) for f in fields],
        "debt": debt,
        "priorityQueue": priority[:6],
        "recentActivity": activity[:12],
        "threats": list_threats()["threats"][:4],
    }
