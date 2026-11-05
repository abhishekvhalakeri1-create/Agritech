# Evidence Debt — FIELDZY's validation model

Evidence Debt is the amount of unresolved uncertainty FIELDZY is carrying about
its own agricultural records. It is the reason the platform can say
_"something may be wrong here — but it is not confirmed yet"_ instead of
escalating every model output into an alert.

## The score

```
Evidence Debt = min(100, unresolved_evidence_gaps × 15
                        + unverified_observations × 10)
```

Implemented once, in `backend/app/evidence_engine.py → evidence_debt()`.

| Component | Meaning | Weight |
| --- | --- | --- |
| Unresolved evidence gaps | Every gap row with `resolved: false`, across all observations | 15 each |
| Unverified observations | Observations whose status is `unverified`, `needs_review`, `conflicting` or `inconclusive` | 10 each |

Verified and resolved observations contribute nothing. A gap is counted once,
from its own row; an observation is counted once, by its status. There is no
other multiplier and no random component, so the same database always produces
the same score.

The response also includes the full breakdown the UI shows: the two terms, the
raw score, whether the cap was hit, debt per feature, gap codes by frequency and
each observation's individual contribution.

### Status → debt

| Status | Counted as unverified? | Typical cause |
| --- | --- | --- |
| `unverified` | yes | no evidence attached, or almost no context |
| `needs_review` | yes | all automated checks pass, human decision pending |
| `conflicting` | yes | two records disagree |
| `inconclusive` | yes | quality or confidence too low to conclude |
| `verified` | no | a person recorded a verification decision |
| `resolved` | no | closed out (e.g. false alarm, fixed issue) |

## Evidence gaps

Gap codes raised by the engine:

`SUPPORTING_EVIDENCE_UNAVAILABLE`, `PHYSICAL_SENSOR_CONFIRMATION_PENDING`,
`IMAGE_QUALITY_INSUFFICIENT`, `ADDITIONAL_PHOTO_REQUIRED`,
`LOCATION_CONFIRMATION_MISSING`, `TIME_INFORMATION_MISSING`,
`INDEPENDENT_CONFIRMATION_REQUIRED`, `CONFLICTING_REPORTS_REQUIRE_REVIEW`,
`LOW_CONFIDENCE_MODEL_RESULT`, `MODEL_ARTIFACT_NOT_INSTALLED`,
`AUDIO_CLARITY_INSUFFICIENT`, `THRESHOLD_CONTEXT_INCOMPLETE`,
`AUDIO_EVIDENCE_PENDING`, `REVIEWER_NOT_ASSIGNED`.

Each gap carries an id, code, description, detail, severity, resolution state
and resolution metadata. Gaps are resolved individually through
`POST /api/observations/{id}/evidence-gaps/{gapId}/resolve`.

**Resolving a gap never verifies the observation.** Closing every gap moves the
record to `needs_review` at most; the second term of the formula only clears
when a person records a review decision.

## Verification

The engine can *never* return `verified` on its own — `validate_evidence()`
caps its output at `needs_review`. Verification requires:

1. every evidence gap resolved, and
2. `POST /api/observations/{id}/review` with `decision = "verify"`.

Attempting to verify with open gaps returns HTTP 409 with an explanation.
Re-opening a gap on a verified observation immediately drops it back to
`needs_review` and the debt returns.

## Why the meter saturates quickly

With weights of 15 and 10, six open gaps alone reach 90. That is deliberate:
debt is a prompt to go and close loops, not a percentage to admire. The meter
shows the cap explicitly (`components.capped`) and lists the cheapest actions
first.

## API

| Endpoint | Purpose |
| --- | --- |
| `POST /api/validate-evidence` | Run the engine on a payload without saving |
| `GET /api/evidence-debt` | Full meter payload (score, terms, breakdown, actions) |
| `POST /api/observations` | Create an observation → validation + gaps computed automatically |
| `POST /api/observations/{id}/evidence-gaps/{gapId}/resolve` | Resolve / re-open one gap |
| `POST /api/observations/{id}/review` | Record a human decision |

Every feature — plant detection, acoustic intelligence, soil moisture, threat
monitoring, manual observations — writes through `services/observations.py`, so
they all obey the same rules.
