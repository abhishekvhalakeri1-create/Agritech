"""FIELDZY Evidence Validation Engine.

FIELDZY treats a model prediction or a sensor reading as a *report*, never as a
confirmed agricultural event. ``validate_evidence`` is the single shared gate
every module (plant disease, soil moisture, acoustic intelligence, threat
monitoring, manual observations) passes its findings through.

The engine is deliberately rule based and deterministic: given the same
evidence it always returns the same verdict, and it never upgrades a report to
``verified`` on its own. Only a recorded human review can do that.

Public API
----------
``validate_evidence(feature_name, model_result, context, evidence) -> dict``
    Mirrors the endpoint contract used by ``POST /validate-evidence``.

``evidence_debt(observations) -> dict``
    The Evidence Debt Meter.

Evidence Debt formula (preserved from the original FIELDZY design):

    Evidence Debt = min(100, unresolved evidence gaps x 15
                             + unverified/conflicting/inconclusive observations x 10)

No randomness, no hidden multipliers, no double counting: a gap is counted once
by its own row, and an observation is counted once by its status bucket.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Iterable

from .config import CONFIDENCE_THRESHOLDS, ENGINE_VERSION

# ---------------------------------------------------------------------------
# Vocabulary
# ---------------------------------------------------------------------------

STATUS_UNVERIFIED = "unverified"
STATUS_NEEDS_REVIEW = "needs_review"
STATUS_VERIFIED = "verified"
STATUS_CONFLICTING = "conflicting"
STATUS_INCONCLUSIVE = "inconclusive"
STATUS_RESOLVED = "resolved"

ALL_STATUSES = [
    STATUS_UNVERIFIED,
    STATUS_NEEDS_REVIEW,
    STATUS_VERIFIED,
    STATUS_CONFLICTING,
    STATUS_INCONCLUSIVE,
    STATUS_RESOLVED,
]

# An observation counts towards the second term of the debt formula unless it
# is verified or fully resolved. `needs_review` is an *unverified* observation
# with a reviewer already assigned, so it belongs in the same bucket.
UNRESOLVED_STATUSES = {
    STATUS_UNVERIFIED,
    STATUS_NEEDS_REVIEW,
    STATUS_CONFLICTING,
    STATUS_INCONCLUSIVE,
}

GAP_DEBT_WEIGHT = 15
OBSERVATION_DEBT_WEIGHT = 10
DEBT_CAP = 100

FEATURE_LABELS = {
    "plant_disease": "Plant Disease Detection",
    "soil_moisture": "Soil Moisture Monitoring",
    "acoustic_intelligence": "Acoustic Intelligence",
    "threat_monitoring": "Threat Monitoring",
    "manual_observation": "Manual Observation",
    "weather": "Weather Context",
    "sensor": "Sensor Reading",
}

# code -> (human description, severity)
GAP_CATALOG: dict[str, tuple[str, str]] = {
    "SUPPORTING_EVIDENCE_UNAVAILABLE": ("Supporting evidence unavailable", "high"),
    "PHYSICAL_SENSOR_CONFIRMATION_PENDING": ("Physical sensor confirmation pending", "high"),
    "IMAGE_QUALITY_INSUFFICIENT": ("Image quality insufficient for a reliable read", "medium"),
    "ADDITIONAL_PHOTO_REQUIRED": ("Additional photograph required", "medium"),
    "LOCATION_CONFIRMATION_MISSING": ("Location confirmation missing", "high"),
    "TIME_INFORMATION_MISSING": ("Time information missing", "medium"),
    "INDEPENDENT_CONFIRMATION_REQUIRED": ("Independent confirmation required", "high"),
    "CONFLICTING_REPORTS_REQUIRE_REVIEW": ("Conflicting reports require review", "high"),
    "LOW_CONFIDENCE_MODEL_RESULT": ("Model confidence below the communication threshold", "medium"),
    "MODEL_ARTIFACT_NOT_INSTALLED": ("Trained model artefact not installed — screening rules used", "high"),
    "AUDIO_CLARITY_INSUFFICIENT": ("Audio too quiet or too noisy for a dependable read", "medium"),
    "THRESHOLD_CONTEXT_INCOMPLETE": ("Field threshold context incomplete", "medium"),
    "AUDIO_EVIDENCE_PENDING": ("Audio clip not retained with the observation", "low"),
    "REVIEWER_NOT_ASSIGNED": ("No reviewer has examined this report yet", "medium"),
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _new_gap(code: str, detail: str | None = None, severity: str | None = None) -> dict[str, Any]:
    description, default_severity = GAP_CATALOG.get(code, (code.replace("_", " ").title(), "medium"))
    return {
        "id": f"gap_{uuid.uuid4().hex[:10]}",
        "code": code,
        "description": description,
        "detail": detail or description,
        "severity": severity or default_severity,
        "resolved": False,
        "resolvedAt": None,
        "resolvedBy": None,
        "createdAt": _now_iso(),
    }


def _check(key: str, label: str, passed: bool, detail: str = "") -> dict[str, Any]:
    return {"key": key, "label": label, "passed": bool(passed), "detail": detail}


def parse_timestamp(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _confidence_of(model_result: dict[str, Any] | None) -> float | None:
    if not model_result:
        return None
    raw = model_result.get("confidence")
    if raw is None:
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    if value > 1.0001:  # some models report percentages
        value = value / 100.0
    return max(0.0, min(1.0, value))


# ---------------------------------------------------------------------------
# The validation engine
# ---------------------------------------------------------------------------

def validate_evidence(
    feature_name: str,
    model_result: dict[str, Any] | None = None,
    context: dict[str, Any] | None = None,
    evidence: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Validate one report and return its evidence verdict.

    Parameters
    ----------
    feature_name
        One of the keys of ``FEATURE_LABELS`` (unknown features are accepted and
        treated like a generic observation).
    model_result
        ``{"predictedClass": str, "confidence": float|None, "engine": str,
        "isTrainedModel": bool, "topK": [...]}``
    context
        ``{"fieldId", "fieldName", "capturedAt", "latitude", "longitude",
        "crop", "reading", "threshold", "severity"}``
    evidence
        ``{"images": [...], "audio": {...}, "readings": [...],
        "independentConfirmations": int, "conflictingSignals": [...]}``
    """
    feature = (feature_name or "manual_observation").strip().lower().replace(" ", "_")
    model_result = model_result or {}
    context = context or {}
    evidence = evidence or {}

    gaps: list[dict[str, Any]] = []
    checks: list[dict[str, Any]] = []
    threshold = CONFIDENCE_THRESHOLDS.get(feature, 0.60)
    confidence = _confidence_of(model_result)
    images = evidence.get("images") or []
    audio = evidence.get("audio") or {}
    readings = evidence.get("readings") or []
    conflicts = evidence.get("conflictingSignals") or []
    confirmations = int(evidence.get("independentConfirmations") or 0)

    # ---------------------------------------------------------------- checks
    has_evidence = bool(images) or bool(audio) or bool(readings) or bool(model_result.get("predictedClass"))
    checks.append(_check("evidence_present", "Observation contains recorded evidence", has_evidence))

    captured_at = parse_timestamp(context.get("capturedAt"))
    checks.append(
        _check("capture_time_known", "Capture time is recorded", captured_at is not None,
               captured_at.isoformat() if captured_at else "No timestamp supplied")
    )

    has_location = bool(context.get("fieldId")) or (
        context.get("latitude") is not None and context.get("longitude") is not None
    )
    checks.append(
        _check("location_known", "Field / location is associated", has_location,
               "Field linked" if has_location else "No field or coordinates attached")
    )

    quality_ok = True
    quality_detail = "Evidence quality acceptable"
    if images:
        worst = min(images, key=lambda im: float((im.get("quality") or {}).get("score", 1.0)))
        quality = worst.get("quality") or {}
        score = float(quality.get("score", 1.0))
        quality_ok = score >= 0.55
        quality_detail = quality.get("summary") or f"Image quality score {score:.2f}"
        if not quality_ok:
            gaps.append(_new_gap("IMAGE_QUALITY_INSUFFICIENT", quality_detail))
            if score < 0.35:
                gaps.append(_new_gap("ADDITIONAL_PHOTO_REQUIRED", "A clearer, closer photograph is needed"))
    if audio:
        clarity = float(audio.get("clarityScore", 1.0) or 0.0)
        if clarity < 0.45:
            quality_ok = False
            quality_detail = audio.get("claritySummary") or f"Audio clarity score {clarity:.2f}"
            gaps.append(_new_gap("AUDIO_CLARITY_INSUFFICIENT", quality_detail))
    checks.append(_check("evidence_quality", "Evidence quality is usable", quality_ok, quality_detail))

    model_backed = bool(model_result.get("predictedClass"))
    confidence_ok = True
    if model_backed and threshold > 0:
        confidence_ok = confidence is not None and confidence >= threshold
        if not confidence_ok:
            gaps.append(
                _new_gap(
                    "LOW_CONFIDENCE_MODEL_RESULT",
                    f"Confidence {'unknown' if confidence is None else f'{confidence:.0%}'} "
                    f"is below the {threshold:.0%} communication threshold",
                )
            )
    checks.append(
        _check("model_confidence", "Model confidence meets the feature threshold", confidence_ok,
               "No model inference attached" if not model_backed else f"{confidence:.0%}" if confidence is not None else "Unknown")
    )

    # Threshold rules (soil moisture bands, for example) are not a learned model,
    # so they are not penalised for the absence of a trained artefact — they are
    # penalised elsewhere for the absence of a *physical* sensor instead.
    rule_based = bool(model_result.get("thresholdBased", False))
    trained_model = (not model_backed) or bool(model_result.get("isTrainedModel", False)) or rule_based
    if model_backed and not trained_model:
        gaps.append(
            _new_gap(
                "MODEL_ARTIFACT_NOT_INSTALLED",
                "This result came from FIELDZY screening rules, not an installed trained model",
            )
        )
    checks.append(
        _check(
            "trained_model",
            "Result produced by an installed trained model",
            trained_model,
            "Threshold rules (no model inference)" if rule_based else model_result.get("engine", "screening rules"),
        )
    )

    if not captured_at:
        gaps.append(_new_gap("TIME_INFORMATION_MISSING"))
    if not has_location:
        gaps.append(_new_gap("LOCATION_CONFIRMATION_MISSING"))
    if not has_evidence:
        gaps.append(_new_gap("SUPPORTING_EVIDENCE_UNAVAILABLE"))

    if feature == "soil_moisture":
        physical = bool(evidence.get("physicalSensorConfirmed")) or str(evidence.get("sensorType", "")).lower() in {"physical", "esp32", "capacitive"}
        checks.append(
            _check("physical_sensor", "Reading comes from a physical sensor", physical,
                   evidence.get("sensorType", "simulated"))
        )
        if not physical:
            gaps.append(
                _new_gap(
                    "PHYSICAL_SENSOR_CONFIRMATION_PENDING",
                    "Reading originates from FIELDZY's simulated probe — no soil sensor is installed on this field yet",
                )
            )
        if context.get("threshold") is None:
            gaps.append(_new_gap("THRESHOLD_CONTEXT_INCOMPLETE"))

    # Retention is opt-in for privacy, so a missing clip only becomes a gap when
    # the reviewer explicitly asked for the recording to be kept.
    if feature == "acoustic_intelligence" and audio.get("retainRequested") and not audio.get("retained", False):
        gaps.append(_new_gap("AUDIO_EVIDENCE_PENDING"))

    independent_ok = confirmations > 0
    checks.append(
        _check("independent_confirmation", "An independent signal corroborates this report", independent_ok,
               f"{confirmations} corroboration(s)" if confirmations else "No second signal yet")
    )
    if not independent_ok:
        gaps.append(_new_gap("INDEPENDENT_CONFIRMATION_REQUIRED"))

    conflict_ok = not conflicts
    checks.append(
        _check("no_conflict", "No contradicting evidence on record", conflict_ok,
               "; ".join(str(c) for c in conflicts) if conflicts else "No conflict recorded")
    )
    if not conflict_ok:
        gaps.append(_new_gap("CONFLICTING_REPORTS_REQUIRE_REVIEW", "; ".join(str(c) for c in conflicts)))

    # ---------------------------------------------------------------- verdict
    passed = {c["key"]: c["passed"] for c in checks}
    if not conflict_ok:
        status = STATUS_CONFLICTING
    elif not has_evidence or (captured_at is None and not has_location):
        status = STATUS_UNVERIFIED
    elif not quality_ok or not confidence_ok or (model_backed and not trained_model):
        status = STATUS_INCONCLUSIVE
    elif not independent_ok:
        status = STATUS_NEEDS_REVIEW
    else:
        # Even a clean report is *awaiting* review — the engine never self-verifies.
        status = STATUS_NEEDS_REVIEW

    requires_human_review = status != STATUS_VERIFIED
    automated_checks_passed = sum(1 for c in checks if c["passed"])

    if status == STATUS_CONFLICTING:
        summary = (
            "Evidence conflicts with an existing report on this field. FIELDZY is holding the "
            "warning until a reviewer reconciles the two records."
        )
        next_action = "Reconcile the conflicting reports and record which evidence is authoritative."
    elif status == STATUS_UNVERIFIED:
        summary = (
            "This report exists but lacks the evidence FIELDZY needs before it can be communicated "
            "as a warning."
        )
        next_action = "Attach the missing evidence (photo, reading or timestamp) before review."
    elif status == STATUS_INCONCLUSIVE:
        summary = (
            "The available evidence is not strong enough for a dependable conclusion. FIELDZY keeps "
            "the report open rather than issuing a warning on weak input."
        )
        next_action = "Capture clearer evidence or corroborate with a second source."
    else:
        summary = (
            "Automated evidence checks are satisfied, but a human review is still required before this "
            "report is treated as verified field information."
        )
        next_action = "Route the report to review; resolving gaps alone does not verify it."

    return {
        "engineVersion": ENGINE_VERSION,
        "feature": feature,
        "featureLabel": FEATURE_LABELS.get(feature, feature.replace("_", " ").title()),
        "status": status,
        "confidence": confidence,
        "confidenceThreshold": threshold,
        "checks": checks,
        "checksPassed": automated_checks_passed,
        "checksTotal": len(checks),
        "evidenceGaps": gaps,
        "unresolvedGapCount": len(gaps),
        "requiresHumanReview": requires_human_review,
        "automatedVerdict": passed,
        "summary": summary,
        "nextAction": next_action,
        "debtContribution": {
            "gapWeight": len(gaps) * GAP_DEBT_WEIGHT,
            "observationWeight": OBSERVATION_DEBT_WEIGHT if status in UNRESOLVED_STATUSES else 0,
        },
        "validatedAt": _now_iso(),
    }


# ---------------------------------------------------------------------------
# Review helpers
# ---------------------------------------------------------------------------

REVIEW_DECISIONS = {
    "verify": STATUS_VERIFIED,
    "resolve": STATUS_RESOLVED,
    "request_evidence": STATUS_NEEDS_REVIEW,
    "reject": STATUS_INCONCLUSIVE,
    "flag_conflict": STATUS_CONFLICTING,
}

# Closing an observation out (verified *or* resolved) requires a clean gap list,
# otherwise the debt meter would keep counting evidence nobody is chasing.
DECISIONS_REQUIRING_CLEAN_GAPS = {"verify", "resolve"}


def apply_review(observation: dict[str, Any], decision: str, note: str, reviewer: str) -> dict[str, Any]:
    """Record a human review decision.

    A review is the *only* path to ``verified``. Resolving an individual gap
    never promotes the whole observation.
    """
    if decision not in REVIEW_DECISIONS:
        raise ValueError(f"Unknown review decision: {decision}")

    gaps = observation.get("evidenceGaps") or []
    unresolved = [g for g in gaps if not g.get("resolved")]

    if decision in DECISIONS_REQUIRING_CLEAN_GAPS and unresolved:
        # Not allowed: verifying while evidence is still outstanding would
        # silently erase debt the meter is supposed to surface.
        return {
            "allowed": False,
            "reason": (
                f"{len(unresolved)} evidence gap(s) are still outstanding. Resolve each gap, then "
                "record the verification decision."
            ),
            "observation": observation,
        }

    new_status = REVIEW_DECISIONS[decision]
    entry = {
        "id": f"rev_{uuid.uuid4().hex[:8]}",
        "decision": decision,
        "status": new_status,
        "note": note or "",
        "reviewer": reviewer or "Field reviewer",
        "at": _now_iso(),
    }
    history = list(observation.get("reviewHistory") or [])
    history.insert(0, entry)

    validation = dict(observation.get("validation") or {})
    validation["status"] = new_status
    validation["requiresHumanReview"] = new_status != STATUS_VERIFIED
    validation["reviewedAt"] = entry["at"]
    validation["reviewedBy"] = entry["reviewer"]

    observation = dict(observation)
    observation["status"] = new_status
    observation["reviewStage"] = (
        "reviewed" if new_status == STATUS_VERIFIED else "resolved" if new_status == STATUS_RESOLVED else "human_review"
    )
    observation["reviewHistory"] = history
    observation["validation"] = validation
    observation["nextAction"] = (
        "No further action — treat as verified field information."
        if new_status == STATUS_VERIFIED
        else "No further action — closed out by the reviewer."
        if new_status == STATUS_RESOLVED
        else "Additional evidence requested by the reviewer."
    )
    return {"allowed": True, "reason": "", "observation": observation}


def resolve_gap(observation: dict[str, Any], gap_id: str, note: str, resolved_by: str, resolved: bool = True) -> dict[str, Any]:
    """Resolve (or re-open) a single evidence gap.

    Deliberately does NOT verify the observation: the observation status can at
    best move to ``needs_review`` once all gaps are closed, because an automated
    gap list is not a human review.
    """
    gaps = [dict(g) for g in (observation.get("evidenceGaps") or [])]
    target = next((g for g in gaps if g.get("id") == gap_id), None)
    if target is None:
        raise KeyError(gap_id)

    target["resolved"] = bool(resolved)
    target["resolvedAt"] = _now_iso() if resolved else None
    target["resolvedBy"] = (resolved_by or "Field reviewer") if resolved else None
    target["resolutionNote"] = note or ("Marked resolved" if resolved else "Re-opened")

    observation = dict(observation)
    observation["evidenceGaps"] = gaps
    observation["status"] = recompute_status(observation)
    observation["reviewStage"] = "evidence_collection" if not resolved else "evidence_checked"

    history = list(observation.get("reviewHistory") or [])
    history.insert(
        0,
        {
            "id": f"rev_{uuid.uuid4().hex[:8]}",
            "decision": "resolve_gap" if resolved else "reopen_gap",
            "status": observation["status"],
            "note": f"{'Resolved' if resolved else 'Re-opened'} gap “{target['description']}”"
            + (f" — {note}" if note else ""),
            "reviewer": resolved_by or "Field reviewer",
            "at": _now_iso(),
        },
    )
    observation["reviewHistory"] = history

    validation = dict(observation.get("validation") or {})
    validation["unresolvedGapCount"] = sum(1 for g in gaps if not g.get("resolved"))
    validation["status"] = observation["status"]
    validation["debtContribution"] = {
        "gapWeight": validation["unresolvedGapCount"] * GAP_DEBT_WEIGHT,
        "observationWeight": OBSERVATION_DEBT_WEIGHT if observation["status"] in UNRESOLVED_STATUSES else 0,
    }
    observation["validation"] = validation
    observation["nextAction"] = (
        "All evidence gaps are closed — record a human review decision to verify or reject this report."
        if validation["unresolvedGapCount"] == 0
        else f"{validation['unresolvedGapCount']} evidence gap(s) still open."
    )
    return observation


def recompute_status(observation: dict[str, Any]) -> str:
    """Status after a gap change.

    Verified observations whose evidence is re-opened drop back to review; an
    observation with open gaps can never sit at ``verified``.
    """
    gaps = observation.get("evidenceGaps") or []
    unresolved = [g for g in gaps if not g.get("resolved")]
    status = observation.get("status", STATUS_UNVERIFIED)
    validation = observation.get("validation") or {}
    conflicting = any(g.get("code") == "CONFLICTING_REPORTS_REQUIRE_REVIEW" and not g.get("resolved") for g in unresolved)

    if conflicting:
        return STATUS_CONFLICTING
    if status == STATUS_VERIFIED and not unresolved:
        return STATUS_VERIFIED
    if not unresolved:
        return STATUS_NEEDS_REVIEW
    if status in {STATUS_UNVERIFIED, STATUS_CONFLICTING, STATUS_INCONCLUSIVE}:
        return status
    return STATUS_NEEDS_REVIEW


# ---------------------------------------------------------------------------
# Evidence Debt Meter
# ---------------------------------------------------------------------------

def score_from_counts(unresolved_gaps: int, unresolved_observations: int) -> dict[str, Any]:
    """The single implementation of the Evidence Debt formula.

    ``min(100, gaps * 15 + unresolved_observations * 10)`` — used by the live
    meter, the recorded snapshots and the historical replay, so all three can
    never disagree.
    """
    gap_term = max(0, int(unresolved_gaps)) * GAP_DEBT_WEIGHT
    observation_term = max(0, int(unresolved_observations)) * OBSERVATION_DEBT_WEIGHT
    raw = gap_term + observation_term
    return {
        "unresolvedGaps": max(0, int(unresolved_gaps)),
        "gapWeight": GAP_DEBT_WEIGHT,
        "gapTerm": gap_term,
        "unresolvedObservations": max(0, int(unresolved_observations)),
        "observationWeight": OBSERVATION_DEBT_WEIGHT,
        "observationTerm": observation_term,
        "rawScore": raw,
        "score": min(DEBT_CAP, raw),
        "capped": raw > DEBT_CAP,
    }


def _score_band(score: int) -> dict[str, str]:
    if score == 0:
        return {"key": "clear", "label": "Clear", "tone": "sage"}
    if score <= 25:
        return {"key": "low", "label": "Low debt", "tone": "sage"}
    if score <= 50:
        return {"key": "moderate", "label": "Moderate debt", "tone": "amber"}
    if score <= 75:
        return {"key": "high", "label": "High debt", "tone": "orange"}
    return {"key": "critical", "label": "Critical debt", "tone": "red"}


STALE_GAP_HOURS = 48


def _age_hours(created_at: Any, *, until: datetime | None = None) -> float | None:
    parsed = parse_timestamp(created_at)
    if parsed is None:
        return None
    now = until or datetime.now(timezone.utc)
    return round(max(0.0, (now - parsed).total_seconds() / 3600.0), 2)


def _age_bucket(hours: float | None) -> str:
    if hours is None:
        return "unknown"
    if hours < 12:
        return "under_12h"
    if hours < 48:
        return "12h_to_48h"
    if hours < 168:
        return "2_to_7_days"
    return "over_7_days"


def collect_gaps(observations: Iterable[dict[str, Any]], *, include_resolved: bool = False) -> list[dict[str, Any]]:
    """Flatten every evidence gap with its observation, field and age."""
    gaps: list[dict[str, Any]] = []
    for obs in observations or []:
        feature = obs.get("feature") or obs.get("category") or "manual_observation"
        for gap in obs.get("evidenceGaps") or []:
            if gap.get("resolved") and not include_resolved:
                continue
            age = _age_hours(gap.get("createdAt") or obs.get("createdAt"))
            resolved_age = _age_hours(gap.get("createdAt"), until=parse_timestamp(gap.get("resolvedAt"))) \
                if gap.get("resolved") and gap.get("resolvedAt") else None
            gaps.append(
                {
                    "gapId": gap.get("id"),
                    "code": gap.get("code"),
                    "description": gap.get("description"),
                    "detail": gap.get("detail"),
                    "severity": gap.get("severity", "medium"),
                    "resolved": bool(gap.get("resolved")),
                    "resolvedAt": gap.get("resolvedAt"),
                    "resolvedBy": gap.get("resolvedBy"),
                    "resolutionNote": gap.get("resolutionNote"),
                    "createdAt": gap.get("createdAt") or obs.get("createdAt"),
                    "ageHours": age,
                    "ageBucket": _age_bucket(age),
                    "ageDays": round(age / 24.0, 1) if age is not None else None,
                    "stale": bool(age is not None and age >= STALE_GAP_HOURS and not gap.get("resolved")),
                    "resolutionHours": resolved_age,
                    "observationId": obs.get("id"),
                    "observationTitle": obs.get("title"),
                    "observationStatus": obs.get("status"),
                    "observationFeature": feature,
                    "feature": feature,
                    "fieldId": obs.get("fieldId"),
                    "fieldName": obs.get("fieldName") or "Unassigned",
                }
            )
    return gaps


def project_debt(observations: Iterable[dict[str, Any]], gap_ids: Iterable[str]) -> dict[str, Any]:
    """What the score becomes if specific gaps were resolved (no side effects)."""
    observations = list(observations or [])
    current = evidence_debt(observations)
    target = set(gap_ids or [])
    known = {gap["gapId"] for gap in collect_gaps(observations)}
    selected = target & known
    unknown = sorted(target - known)
    counts = score_from_counts(
        current["components"]["unresolvedGaps"] - len(selected),
        current["components"]["unresolvedObservations"],
    )
    return {
        "current": current["score"],
        "projected": counts["score"],
        "delta": counts["score"] - current["score"],
        "requestedGapIds": sorted(target),
        "selectedGaps": sorted(selected),
        "alreadyResolvedOrUnknown": unknown,
        "components": counts,
        "note": (
            "Projection only — nothing is written. The second term clears only when a human review "
            "moves an observation out of the unresolved bucket."
        ),
    }


def evidence_debt(observations: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Compute the Evidence Debt Meter from observation records.

    Formula (unchanged from the FIELDZY design):

        min(100, unresolved_gaps * 15 + unresolved_observations * 10)

    Unresolved observations are those whose status is unverified, needs_review,
    conflicting or inconclusive. Verified and resolved observations contribute
    nothing. Each gap is counted once, from its own row — never once per
    observation *and* once per gap bucket.
    """
    observations = list(observations or [])
    all_gaps = collect_gaps(observations, include_resolved=True)
    unresolved_gaps = [gap for gap in all_gaps if not gap["resolved"]]
    unresolved_observations = [o for o in observations if o.get("status") in UNRESOLVED_STATUSES]
    verified = sum(1 for o in observations if o.get("status") == STATUS_VERIFIED)
    resolved = sum(1 for o in observations if o.get("status") == STATUS_RESOLVED)

    counts = score_from_counts(len(unresolved_gaps), len(unresolved_observations))
    score = counts["score"]
    band = _score_band(score)

    by_feature: dict[str, dict[str, Any]] = {}
    by_field: dict[str, dict[str, Any]] = {}
    by_gap_code: dict[str, dict[str, Any]] = {}
    for obs in observations:
        feature = obs.get("feature") or obs.get("category") or "manual_observation"
        field_key = obs.get("fieldId") or "unassigned"
        feature_bucket = by_feature.setdefault(
            feature,
            {
                "feature": feature,
                "label": FEATURE_LABELS.get(feature, feature.replace("_", " ").title()),
                "observations": 0,
                "unresolvedObservations": 0,
                "unresolvedGaps": 0,
                "debt": 0,
            },
        )
        field_bucket = by_field.setdefault(
            field_key,
            {
                "fieldId": obs.get("fieldId"),
                "fieldName": obs.get("fieldName") or "Unassigned",
                "observations": 0,
                "unresolvedObservations": 0,
                "unresolvedGaps": 0,
                "debt": 0,
            },
        )
        for bucket in (feature_bucket, field_bucket):
            bucket["observations"] += 1
            if obs.get("status") in UNRESOLVED_STATUSES:
                bucket["unresolvedObservations"] += 1

    for gap in unresolved_gaps:
        feature = gap.get("feature") or "manual_observation"
        field_key = gap.get("fieldId") or "unassigned"
        if feature in by_feature:
            by_feature[feature]["unresolvedGaps"] += 1
        if field_key in by_field:
            by_field[field_key]["unresolvedGaps"] += 1
        code_bucket = by_gap_code.setdefault(
            gap.get("code") or "UNKNOWN",
            {"code": gap.get("code"), "description": gap.get("description"), "count": 0, "stale": 0},
        )
        code_bucket["count"] += 1
        if gap["stale"]:
            code_bucket["stale"] += 1

    for bucket in list(by_feature.values()) + list(by_field.values()):
        bucket["debt"] = score_from_counts(bucket["unresolvedGaps"], bucket["unresolvedObservations"])["score"]

    stale_gaps = [gap for gap in unresolved_gaps if gap["stale"]]
    age_buckets = {key: 0 for key in ("under_12h", "12h_to_48h", "2_to_7_days", "over_7_days", "unknown")}
    for gap in unresolved_gaps:
        age_buckets[gap["ageBucket"]] = age_buckets.get(gap["ageBucket"], 0) + 1

    resolution_times = [gap["resolutionHours"] for gap in all_gaps if gap.get("resolutionHours") is not None]
    oldest = max((gap["ageHours"] or 0) for gap in unresolved_gaps) if unresolved_gaps else 0.0

    severity_rank = {"high": 0, "medium": 1, "low": 2}
    ordered_gaps = sorted(
        unresolved_gaps,
        key=lambda gap: (
            severity_rank.get(gap["severity"], 1),
            -(gap["ageHours"] or 0),
        ),
    )

    actions: list[dict[str, Any]] = []
    for gap in ordered_gaps[:5]:
        actions.append(
            {
                "label": f"Resolve \u201c{gap['description']}\u201d",
                "detail": f"{gap['observationTitle']} \u00b7 {gap['fieldName']} \u00b7 open "
                f"{gap['ageDays']}d",
                "observationId": gap["observationId"],
                "gapId": gap["gapId"],
                "impact": GAP_DEBT_WEIGHT if score > 0 else 0,
                "severity": gap["severity"],
            }
        )
    if len(unresolved_observations) > len(actions):
        first = unresolved_observations[0]
        actions.append(
            {
                "label": "Record review decisions for open observations",
                "detail": f"{len(unresolved_observations)} observations are awaiting evidence or review",
                "observationId": first.get("id"),
                "gapId": "",
                "impact": 0,
                "severity": "medium",
            }
        )

    forecast = [
        {
            "resolved": step,
            "score": score_from_counts(
                max(0, len(unresolved_gaps) - step), len(unresolved_observations)
            )["score"],
        }
        for step in range(0, min(6, len(unresolved_gaps)) + 1)
    ]

    if score == 0:
        explanation = (
            "No unresolved evidence. Every active field report has complete supporting evidence and a "
            "recorded review decision."
        )
    elif stale_gaps:
        explanation = (
            f"{len(stale_gaps)} of {len(unresolved_gaps)} open evidence gaps have been waiting more than "
            f"48 hours. Stale gaps are what turn a cautious system into a slow one \u2014 review the missing "
            "supporting information before treating these warnings as confirmed."
        )
    else:
        explanation = (
            "Your field reports contain unresolved evidence. Review the missing supporting information "
            "before treating these warnings as confirmed."
        )

    return {
        "score": score,
        "band": band,
        "formula": "min(100, unresolved_gaps \u00d7 15 + unresolved_observations \u00d7 10)",
        "components": counts,
        "counts": {
            "totalObservations": len(observations),
            "verified": verified,
            "resolved": resolved,
            "unverified": sum(1 for o in unresolved_observations if o.get("status") == STATUS_UNVERIFIED),
            "needsReview": sum(1 for o in unresolved_observations if o.get("status") == STATUS_NEEDS_REVIEW),
            "conflicting": sum(1 for o in unresolved_observations if o.get("status") == STATUS_CONFLICTING),
            "inconclusive": sum(1 for o in unresolved_observations if o.get("status") == STATUS_INCONCLUSIVE),
            "gapsTotal": len(all_gaps),
            "gapsResolved": len(all_gaps) - len(unresolved_gaps),
            "gapsStale": len(stale_gaps),
        },
        "ageing": {
            "oldestGapHours": oldest,
            "oldestGapDays": round(oldest / 24.0, 1),
            "staleThresholdHours": STALE_GAP_HOURS,
            "buckets": age_buckets,
            "averageResolutionHours": round(sum(resolution_times) / len(resolution_times), 1) if resolution_times else None,
            "resolvedSampleSize": len(resolution_times),
        },
        "unresolvedGapList": ordered_gaps,
        "recentlyResolved": sorted(
            [gap for gap in all_gaps if gap["resolved"] and gap.get("resolvedAt")],
            key=lambda gap: gap.get("resolvedAt") or "",
            reverse=True,
        )[:6],
        "byFeature": sorted(by_feature.values(), key=lambda b: b["debt"], reverse=True),
        "byField": sorted(by_field.values(), key=lambda b: b["debt"], reverse=True),
        "byGapCode": sorted(by_gap_code.values(), key=lambda b: b["count"], reverse=True),
        "forecast": forecast,
        "observations": [
            {
                "id": o.get("id"),
                "title": o.get("title"),
                "fieldId": o.get("fieldId"),
                "fieldName": o.get("fieldName"),
                "feature": o.get("feature"),
                "status": o.get("status"),
                "unresolvedGaps": sum(1 for g in (o.get("evidenceGaps") or []) if not g.get("resolved")),
                "contribution": score_from_counts(
                    sum(1 for g in (o.get("evidenceGaps") or []) if not g.get("resolved")),
                    1 if o.get("status") in UNRESOLVED_STATUSES else 0,
                )["score"],
            }
            for o in sorted(
                observations,
                key=lambda o: (
                    sum(1 for g in (o.get("evidenceGaps") or []) if not g.get("resolved")) * GAP_DEBT_WEIGHT
                    + (OBSERVATION_DEBT_WEIGHT if o.get("status") in UNRESOLVED_STATUSES else 0)
                ),
                reverse=True,
            )
        ],
        "explanation": explanation,
        "recommendedActions": actions,
        "computedAt": _now_iso(),
        "engineVersion": ENGINE_VERSION,
    }
