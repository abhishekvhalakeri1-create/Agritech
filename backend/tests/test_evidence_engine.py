"""Behavioural checks for the FIELDZY evidence engine.

Run without any test dependency:

    cd backend && .venv/bin/python -m tests.test_evidence_engine

(Pytest also picks these up: ``pytest backend/tests``.)
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.evidence_engine import (  # noqa: E402
    apply_review,
    evidence_debt,
    resolve_gap,
    validate_evidence,
)

FIELD = {"fieldId": "FLD-01", "fieldName": "North Block", "capturedAt": "2026-11-05T09:00:00Z"}


def test_debt_formula_and_cap() -> None:
    gap = {"id": "g1", "code": "TIME_INFORMATION_MISSING", "description": "x", "severity": "medium", "resolved": False}
    observation = {"id": "O1", "feature": "manual_observation", "status": "unverified", "evidenceGaps": [gap]}
    debt = evidence_debt([observation])
    assert debt["components"]["gapTerm"] == 15
    assert debt["components"]["observationTerm"] == 10
    assert debt["score"] == 25

    many = []
    for index in range(8):
        many.append(
            {
                "id": f"O{index}",
                "feature": "manual_observation",
                "status": "unverified",
                "evidenceGaps": [
                    {"id": f"g{index}-{j}", "description": "gap", "severity": "low", "resolved": False} for j in range(2)
                ],
            }
        )
    capped = evidence_debt(many)
    assert capped["score"] == 100, capped
    assert capped["components"]["capped"] is True
    assert capped["components"]["rawScore"] > 100


def test_verified_observations_do_not_accrue_debt() -> None:
    verified = {"id": "V1", "feature": "plant_disease", "status": "verified", "evidenceGaps": []}
    assert evidence_debt([verified])["score"] == 0


def test_resolving_a_gap_does_not_verify_observation() -> None:
    result = validate_evidence(
        "manual_observation",
        {},
        FIELD,
        {"images": [], "independentConfirmations": 0},
    )
    assert result["status"] == "unverified"
    observation = {"id": "O1", "status": result["status"], "evidenceGaps": result["evidenceGaps"], "validation": result}
    for gap in list(result["evidenceGaps"]):
        observation = resolve_gap(observation, gap["id"], "attached", "tester")
    assert observation["status"] != "verified"
    assert observation["validation"]["unresolvedGapCount"] == 0


def test_verification_requires_clean_gaps_and_review() -> None:
    result = validate_evidence("manual_observation", {}, FIELD, {"images": [], "independentConfirmations": 0})
    observation = {"id": "O1", "status": result["status"], "evidenceGaps": result["evidenceGaps"], "validation": result}

    blocked = apply_review(observation, "verify", "looks fine", "tester")
    assert blocked["allowed"] is False

    for gap in list(result["evidenceGaps"]):
        observation = resolve_gap(observation, gap["id"], "checked", "tester")
    allowed = apply_review(observation, "verify", "confirmed on site", "tester")
    assert allowed["allowed"] is True
    assert allowed["observation"]["status"] == "verified"
    assert allowed["observation"]["reviewHistory"][0]["reviewer"] == "tester"


def test_model_prediction_is_not_verified_automatically() -> None:
    result = validate_evidence(
        "plant_disease",
        {"predictedClass": "Early Blight", "confidence": 0.99, "isTrainedModel": True, "engine": "savedmodel"},
        FIELD,
        {
            "images": [{"fileName": "a.jpg", "quality": {"score": 0.9, "summary": "sharp"}}],
            "independentConfirmations": 2,
        },
    )
    assert result["status"] == "needs_review"
    assert result["requiresHumanReview"] is True


def test_low_confidence_and_missing_artefact_raise_gaps() -> None:
    result = validate_evidence(
        "plant_disease",
        {"predictedClass": "Leaf Rust", "confidence": 0.31, "isTrainedModel": False, "engine": "screening_rules_v1"},
        FIELD,
        {"images": [{"fileName": "a.jpg", "quality": {"score": 0.4, "summary": "soft"}}]},
    )
    codes = {gap["code"] for gap in result["evidenceGaps"]}
    assert "LOW_CONFIDENCE_MODEL_RESULT" in codes
    assert "MODEL_ARTIFACT_NOT_INSTALLED" in codes
    assert result["status"] == "inconclusive"


def test_conflict_outranks_other_states() -> None:
    result = validate_evidence(
        "threat_monitoring",
        {},
        FIELD,
        {"images": [{"fileName": "a.jpg", "quality": {"score": 0.8, "summary": "ok"}}], "conflictingSignals": ["wind"]},
    )
    assert result["status"] == "conflicting"
    assert any(gap["code"] == "CONFLICTING_REPORTS_REQUIRE_REVIEW" for gap in result["evidenceGaps"])


if __name__ == "__main__":
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_") and callable(value)]
    failures = 0
    for test in tests:
        try:
            test()
            print(f"  ✓ {test.__name__}")
        except AssertionError as exc:
            failures += 1
            print(f"  ✗ {test.__name__}: {exc}")
    print(f"\n{len(tests) - failures}/{len(tests)} checks passed")
    raise SystemExit(1 if failures else 0)
