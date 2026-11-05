"""First-run seed data for FIELDZY.

These are genuine database rows (editable, deletable) that give the platform a
believable starting state. They are marked ``isDemo = true`` and the UI labels
them as demo records — FIELDZY never presents seeded content as a live
detection. Every observation below is produced by the *real* evidence engine,
so the Evidence Debt Meter is computed, not invented.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from . import db
from .evidence_engine import apply_review, resolve_gap, validate_evidence

BASE = datetime(2026, 11, 4, 6, 30, tzinfo=timezone.utc)


def _ts(hours_ago: float) -> str:
    return (BASE - timedelta(hours=hours_ago)).replace(microsecond=0).isoformat().replace("+00:00", "Z")


FIELDS = [
    {
        "id": "FLD-01",
        "name": "North Block — Tomato",
        "crop": "Tomato",
        "areaHa": 2.4,
        "status": "monitor",
        "location": "North block, 400 m from pump house",
        "latitude": 12.9731,
        "longitude": 77.5962,
        "soilThresholdLow": 38,
        "soilThresholdCritical": 22,
        "notes": "Drip irrigated, 6 rows. Historic early blight pressure in November.",
        "createdAt": _ts(720),
        "updatedAt": _ts(20),
    },
    {
        "id": "FLD-02",
        "name": "Canal Plot — Paddy",
        "crop": "Paddy",
        "areaHa": 3.8,
        "status": "monitor",
        "location": "East of the canal channel",
        "latitude": 12.9698,
        "longitude": 77.6014,
        "soilThresholdLow": 45,
        "soilThresholdCritical": 25,
        "notes": "Canal-fed. Moisture probe readings for this plot are simulated until a sensor is installed.",
        "createdAt": _ts(700),
        "updatedAt": _ts(9),
    },
    {
        "id": "FLD-03",
        "name": "Ridge Field — Chilli",
        "crop": "Chilli",
        "areaHa": 1.6,
        "status": "attention",
        "location": "Raised ridges behind the tool shed",
        "latitude": 12.9752,
        "longitude": 77.5941,
        "soilThresholdLow": 36,
        "soilThresholdCritical": 20,
        "notes": "Scouting every second morning for thrips and chewing damage.",
        "createdAt": _ts(690),
        "updatedAt": _ts(28),
    },
    {
        "id": "FLD-04",
        "name": "Orchard Row — Mango",
        "crop": "Mango",
        "areaHa": 2.1,
        "status": "stable",
        "location": "West boundary orchard row",
        "latitude": 12.9685,
        "longitude": 77.5902,
        "soilThresholdLow": 30,
        "soilThresholdCritical": 18,
        "notes": "Boundary fence shared with neighbouring grazing land.",
        "createdAt": _ts(650),
        "updatedAt": _ts(52),
    },
]

FIELD_BY_ID = {f["id"]: f for f in FIELDS}


def _build(
    *,
    obs_id: str,
    field_id: str,
    feature: str,
    category: str,
    title: str,
    description: str,
    severity: str,
    hours_ago: float,
    model_result: dict[str, Any] | None = None,
    evidence: dict[str, Any] | None = None,
    context_extra: dict[str, Any] | None = None,
    resolve_all: bool = False,
    review: tuple[str, str] | None = None,
    sync_status: str = "synced",
) -> dict[str, Any]:
    field = FIELD_BY_ID[field_id]
    created = _ts(hours_ago)
    context = {
        "fieldId": field["id"],
        "fieldName": field["name"],
        "crop": field["crop"],
        "capturedAt": created,
        "latitude": field["latitude"],
        "longitude": field["longitude"],
        **(context_extra or {}),
    }
    validation = validate_evidence(feature, model_result, context, evidence or {})
    # Gaps belong to the moment the observation was captured, not to seed time —
    # otherwise ageing and staleness would be misleading.
    for gap in validation["evidenceGaps"]:
        gap["createdAt"] = created
    record = {
        "id": obs_id,
        "fieldId": field["id"],
        "fieldName": field["name"],
        "title": title,
        "description": description,
        "category": category,
        "feature": feature,
        "status": validation["status"],
        "syncStatus": sync_status,
        "severity": severity,
        "confidence": validation.get("confidence"),
        "modelResult": model_result,
        "validation": validation,
        "evidence": evidence or {},
        "evidenceGaps": validation["evidenceGaps"],
        "reviewStage": "human_review" if validation["status"] == "needs_review" else "evidence_checked",
        "qualityChecks": validation["checks"],
        "reviewHistory": [
            {
                "id": f"rev_seed_{obs_id.lower()}",
                "decision": "created",
                "status": validation["status"],
                "note": "Observation created and routed through the evidence engine.",
                "reviewer": "FIELDZY evidence engine",
                "at": created,
            }
        ],
        "nextAction": validation["nextAction"],
        "isDemo": True,
        "createdAt": created,
        "updatedAt": created,
    }
    for gap in list(record["evidenceGaps"]):
        if resolve_all and not gap["resolved"]:
            record = resolve_gap(
                record,
                gap["id"],
                "Evidence attached during field visit and checked against the field notebook.",
                "Hemish (field review)",
            )
    if review:
        result = apply_review(record, review[0], review[1], "Hemish (field review)")
        record = result["observation"] if result["allowed"] else record

    # Reviews and gap resolutions in the seed data happened *after* the capture,
    # not at seed time. Stamp them relative to the observation so ageing, replay
    # and trend maths reflect a real sequence of events.
    created_dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
    gap_resolved_at = (created_dt + timedelta(hours=3, minutes=20)).isoformat().replace("+00:00", "Z")
    reviewed_at = (created_dt + timedelta(hours=5)).isoformat().replace("+00:00", "Z")
    for gap in record["evidenceGaps"]:
        if gap.get("resolved"):
            gap["resolvedAt"] = gap_resolved_at
    for entry in record["reviewHistory"]:
        if entry.get("decision") != "created":
            entry["at"] = reviewed_at
    if any(entry.get("decision") != "created" for entry in record["reviewHistory"]):
        record["updatedAt"] = reviewed_at
    return record


def _observations() -> list[dict[str, Any]]:
    return [
        _build(
            obs_id="OBS-1041",
            field_id="FLD-01",
            feature="plant_disease",
            category="disease",
            title="Early-blight-like lesions on the north tomato row",
            description=(
                "Concentric dark lesions on lower-canopy leaves across roughly three metres of row 2. "
                "Two leaves photographed in daylight; a third was confirmed by the field notebook entry "
                "from the previous evening."
            ),
            severity="elevated",
            hours_ago=19,
            model_result={
                "predictedClass": "Early Blight",
                "label": "Early blight (Alternaria solani)",
                "confidence": 0.91,
                "engine": "fieldzy_savedmodel",
                "isTrainedModel": True,
                "topK": [
                    {"label": "Early Blight", "confidence": 0.91},
                    {"label": "Healthy", "confidence": 0.05},
                    {"label": "Late Blight", "confidence": 0.04},
                ],
            },
            evidence={
                "images": [
                    {"fileName": "north-row-leaf-01.jpg", "quality": {"score": 0.78, "summary": "Sharp, well-lit leaf close-up"}},
                    {"fileName": "north-row-leaf-02.jpg", "quality": {"score": 0.71, "summary": "Slight shadow on lower edge"}},
                ],
                "independentConfirmations": 1,
                "independentSources": ["Field notebook entry, previous evening"],
            },
            review=("verify", "Confirmed on site; lesion pattern matches the previous November outbreak. Scouting row 2 daily."),
        ),
        _build(
            obs_id="OBS-1042",
            field_id="FLD-02",
            feature="soil_moisture",
            category="soil",
            title="Soil moisture below the low threshold on Canal Plot",
            description=(
                "Simulated probe reading of 31% at 20 cm depth against a 45% low-moisture threshold. "
                "No physical sensor is installed on this plot yet."
            ),
            severity="moderate",
            hours_ago=9,
            model_result={
                "predictedClass": "Low moisture",
                "label": "Low moisture",
                "confidence": None,
                "engine": "threshold_rules_v1",
                "isTrainedModel": False,
                "thresholdBased": True,
            },
            evidence={
                "readings": [{"label": "Volumetric moisture", "value": 31, "unit": "%", "depthCm": 20, "simulated": True}],
                "sensorType": "simulated",
                "physicalSensorConfirmed": False,
                "independentConfirmations": 0,
            },
            context_extra={"reading": 31, "threshold": 45, "thresholdCritical": 25},
        ),
        _build(
            obs_id="OBS-1043",
            field_id="FLD-04",
            feature="threat_monitoring",
            category="threat",
            title="Movement reported along the western orchard boundary",
            description=(
                "Night patrol reported movement near the shared fence line with the grazing plot. "
                "A second report from the same time describes the sound as wind in the mango canopy."
            ),
            severity="elevated",
            hours_ago=74,
            model_result=None,
            evidence={
                "images": [
                    {"fileName": "boundary-fence-night.jpg", "quality": {"score": 0.58, "summary": "Low-light frame, fence line visible"}}
                ],
                "independentConfirmations": 1,
                "independentSources": ["Night patrol log"],
                "conflictingSignals": ["Second report attributes the sound to wind in the canopy"],
            },
        ),
        _build(
            obs_id="OBS-1044",
            field_id="FLD-03",
            feature="manual_observation",
            category="manual",
            title="Chewing damage on chilli saplings, ridge 4",
            description="Ragged leaf margins on 12 saplings. Damage pattern noted but no pest photographed yet.",
            severity="moderate",
            hours_ago=28,
            evidence={"images": [], "independentConfirmations": 0},
            resolve_all=True,
            review=("verify", "Photographs taken during the morning scouting round and filed with the observation."),
        ),
        _build(
            obs_id="OBS-1045",
            field_id="FLD-02",
            feature="manual_observation",
            category="environment",
            title="Waterlogging along the canal bund after overnight rain",
            description=(
                "Standing water 4–6 cm deep over roughly 150 m of bund. Recorded at 06:10 with photographs "
                "and a measured depth."
            ),
            severity="low",
            hours_ago=32,
            evidence={
                "images": [{"fileName": "bund-waterlogging.jpg", "quality": {"score": 0.82, "summary": "Clear wide shot with depth marker"}}],
                "readings": [{"label": "Standing water depth", "value": 5, "unit": "cm"}],
                "independentConfirmations": 1,
                "independentSources": ["Canal gauge reading"],
            },
            review=("verify", "Drainage channel opened; water had receded by the afternoon check."),
        ),
        _build(
            obs_id="OBS-1046",
            field_id="FLD-01",
            feature="threat_monitoring",
            category="threat",
            title="Pump-house alarm triggered twice before dawn",
            description=(
                "Perimeter alarm recorded two triggers at 04:12 and 04:48. An on-site check found no "
                "intrusion; the sensor has a known false-trigger history in high wind."
            ),
            severity="moderate",
            hours_ago=40,
            evidence={
                "readings": [{"label": "Alarm triggers", "value": 2, "unit": "events"}],
                "independentConfirmations": 1,
                "independentSources": ["On-site check by night watchman"],
            },
            resolve_all=True,
            review=("verify", "Verified as a false trigger. Sensor sensitivity reduced."),
        ),
        _build(
            obs_id="OBS-1047",
            field_id="FLD-03",
            feature="manual_observation",
            category="manual",
            title="Missing drip emitter on row 6",
            description="Drip line emitter absent at 18 m along row 6; local dry patch visible in the soil.",
            severity="low",
            hours_ago=52,
            evidence={
                "images": [{"fileName": "row6-emitter.jpg", "quality": {"score": 0.8, "summary": "Close-up of the drip line"}}],
                "independentConfirmations": 1,
                "independentSources": ["Irrigation round log"],
            },
            review=("verify", "Emitter replaced during the afternoon maintenance round."),
        ),
        _build(
            obs_id="OBS-1048",
            field_id="FLD-03",
            feature="manual_observation",
            category="manual",
            title="Thrips scouting note — ridge 2",
            description="Silvery leaf flecking consistent with thrips, but the scouting card photograph was out of focus.",
            severity="low",
            hours_ago=58,
            evidence={"images": [{"fileName": "ridge2-blurred.jpg", "quality": {"score": 0.31, "summary": "Blurred, low light"}}], "independentConfirmations": 0},
            resolve_all=True,
            review=("reject", "Image unusable and no second scout corroborated the note. Kept for reference only."),
        ),
    ]


def _transmissions(observations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for index, obs in enumerate(observations):
        created = obs["createdAt"]
        rows.append(
            {
                "id": f"TX-{2000 + index * 3}",
                "observationId": obs["id"],
                "observationTitle": obs["title"],
                "event": "Observation saved to local store",
                "state": "saved_local",
                "detail": "Written to the device store before any network attempt.",
                "createdAt": created,
            }
        )
        rows.append(
            {
                "id": f"TX-{2001 + index * 3}",
                "observationId": obs["id"],
                "observationTitle": obs["title"],
                "event": "Evidence package queued for the server",
                "state": "queued",
                "detail": "Queued with the observation payload and evidence references.",
                "createdAt": created,
            }
        )
        rows.append(
            {
                "id": f"TX-{2002 + index * 3}",
                "observationId": obs["id"],
                "observationTitle": obs["title"],
                "event": "Server acknowledged the record",
                "state": "synced",
                "detail": "Delivery confirmed by an explicit server acknowledgement, not by link status.",
                "createdAt": created,
            }
        )
    rows.append(
        {
            "id": "TX-2099",
            "observationId": "OBS-1042",
            "observationTitle": "Soil moisture below the low threshold on Canal Plot",
            "event": "Retry scheduled after timeout",
            "state": "failed",
            "detail": "Link was reported online but the request timed out — FIELDZY does not count that as delivered.",
            "createdAt": _ts(8.4),
        }
    )
    return rows


def _soil_readings() -> list[dict[str, Any]]:
    readings = []
    series = {
        "FLD-02": [58, 55, 50, 47, 45, 42, 38, 34, 31],
        "FLD-01": [52, 49, 47, 44, 46, 43, 41, 40, 39],
    }
    for field_id, values in series.items():
        field = FIELD_BY_ID[field_id]
        for index, value in enumerate(values):
            condition = (
                "critical" if value <= field["soilThresholdCritical"]
                else "low" if value <= field["soilThresholdLow"]
                else "adequate"
            )
            readings.append(
                {
                    "id": f"SOIL-{field_id[-2:]}-{index}",
                    "fieldId": field_id,
                    "fieldName": field["name"],
                    "moisture": float(value),
                    "thresholdLow": field["soilThresholdLow"],
                    "thresholdCritical": field["soilThresholdCritical"],
                    "condition": condition,
                    "simulated": True,
                    "observationId": "OBS-1042" if field_id == "FLD-02" and index == len(values) - 1 else None,
                    "createdAt": _ts(9 + (len(values) - index) * 6),
                }
            )
    return readings


def seed_database() -> None:
    for field in FIELDS:
        db.insert("fields", field)
    observations = _observations()
    for obs in observations:
        db.insert("observations", obs)
    for tx in _transmissions(observations):
        db.insert("transmissions", tx)
    for reading in _soil_readings():
        db.insert("soilReadings", reading)

    from .services.debt_history import record_snapshot

    record_snapshot("seed", None, force=True)
