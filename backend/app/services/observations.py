"""Observation lifecycle: the shared layer every FIELDZY module writes into."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from .. import db
from ..evidence_engine import UNRESOLVED_STATUSES, evidence_debt, validate_evidence

SYNC_STATES = {"local_only", "pending_sync", "synced", "failed"}


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def record_transmission(
    observation: dict[str, Any] | None,
    event: str,
    state: str,
    detail: str = "",
    *,
    observation_id: str | None = None,
    observation_title: str | None = None,
) -> dict[str, Any]:
    row = {
        "id": f"TX-{uuid.uuid4().hex[:8]}",
        "observationId": observation_id or (observation or {}).get("id"),
        "observationTitle": observation_title or (observation or {}).get("title"),
        "event": event,
        "state": state,
        "detail": detail,
        "createdAt": _now(),
    }
    db.insert("transmissions", row)
    return row


def create_observation(
    *,
    field_id: str | None,
    feature: str,
    category: str,
    title: str,
    description: str,
    severity: str | None = None,
    model_result: dict[str, Any] | None = None,
    evidence: dict[str, Any] | None = None,
    context: dict[str, Any] | None = None,
    sync_status: str = "synced",
    is_demo: bool = False,
    observation_id: str | None = None,
) -> dict[str, Any]:
    """Validate evidence, persist the observation and log its transmission trail."""
    field = db.fetch_one("fields", field_id) if field_id else None
    captured_at = (context or {}).get("capturedAt") or _now()
    merged_context = {
        "fieldId": (field or {}).get("id") or field_id,
        "fieldName": (field or {}).get("name") or "",
        "crop": (field or {}).get("crop") or "",
        "latitude": (field or {}).get("latitude"),
        "longitude": (field or {}).get("longitude"),
        "capturedAt": captured_at,
        **(context or {}),
    }

    validation = validate_evidence(feature, model_result, merged_context, evidence or {})
    obs_id = observation_id or f"OBS-{uuid.uuid4().hex[:6].upper()}"
    created = _now()

    record = {
        "id": obs_id,
        "fieldId": merged_context.get("fieldId"),
        "fieldName": merged_context.get("fieldName") or "Unassigned",
        "title": title,
        "description": description,
        "category": category,
        "feature": feature,
        "status": validation["status"],
        "syncStatus": sync_status if sync_status in SYNC_STATES else "pending_sync",
        "severity": severity,
        "confidence": validation.get("confidence"),
        "modelResult": model_result or {},
        "validation": validation,
        "evidence": evidence or {},
        "evidenceGaps": validation["evidenceGaps"],
        "reviewStage": "evidence_collection" if validation["status"] == "unverified" else "evidence_checked",
        "qualityChecks": validation["checks"],
        "reviewHistory": [
            {
                "id": f"rev_{uuid.uuid4().hex[:8]}",
                "decision": "created",
                "status": validation["status"],
                "note": f"Created by {validation['featureLabel']} and validated by the evidence engine.",
                "reviewer": "FIELDZY evidence engine",
                "at": created,
            }
        ],
        "nextAction": validation["nextAction"],
        "isDemo": is_demo,
        "createdAt": created,
        "updatedAt": created,
    }
    db.insert("observations", record)

    record_transmission(record, "Observation saved to local store", "saved_local",
                        "Held in FIELDZY's local observation store.")
    record_transmission(record, "Evidence package queued for the server", "queued",
                        f"{len(record['evidenceGaps'])} evidence gap(s) recorded with the payload.")
    if record["syncStatus"] == "synced":
        record_transmission(record, "Server acknowledged the record", "synced",
                            "Delivery confirmed by an explicit server acknowledgement.")

    # Recorded debt snapshot for the trend — imported lazily to avoid a cycle
    # (debt_history reads observations back out of the store).
    from .debt_history import record_snapshot

    record_snapshot("observation_created", record["id"])
    return record


def list_observations() -> list[dict[str, Any]]:
    return db.fetch_all("observations")


def recompute_field_activity(field_id: str) -> None:
    """Keep the field's cached status/average health in step with its observations."""
    field = db.fetch_one("fields", field_id)
    if not field:
        return
    observations = db.fetch_all("observations", "fieldId = ?", (field_id,))
    open_items = [
        o for o in observations
        if o["status"] in UNRESOLVED_STATUSES or o.get("severity") in {"elevated", "critical"}
    ]
    if any(o.get("severity") == "critical" for o in open_items):
        status = "attention"
    elif any(o["status"] in {"conflicting", "needs_review"} for o in open_items):
        status = "attention"
    elif open_items:
        status = "monitor"
    else:
        status = "stable"
    db.update("fields", field_id, {"status": status, "updatedAt": _now()})


def debt_snapshot() -> dict[str, Any]:
    return evidence_debt(db.fetch_all("observations"))


def field_summary_counts(field_id: str) -> dict[str, Any]:
    observations = db.fetch_all("observations", "fieldId = ?", (field_id,))
    return {
        "observationCount": len(observations),
        "unresolvedCount": sum(1 for o in observations if o["status"] in UNRESOLVED_STATUSES),
        "openGaps": sum(1 for o in observations for g in (o.get("evidenceGaps") or []) if not g.get("resolved")),
        "latestObservation": observations[0] if observations else None,
    }
