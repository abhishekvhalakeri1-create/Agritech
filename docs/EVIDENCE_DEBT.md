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
raw score, whether the cap was hit, debt per feature, debt per field, gap codes
by frequency, ageing statistics, a forecast and each observation's individual
contribution (the +15/+10 or nothing it adds).

The formula lives in one function, `score_from_counts(gaps, observations)`.
`evidence_debt()`, the recorded snapshots and the historical replay all call it,
so the meter, the chart and a past point can never disagree.

### Ageing

An open gap gets more expensive to leave alone. The engine returns an `ageing`
block:

| Field | Meaning |
| --- | --- |
| `oldestGapHours` / `oldestGapDays` | The longest-waiting unresolved gap |
| `staleThresholdHours` | `48` — gaps older than this are flagged `stale` |
| `buckets` | `under_12h`, `12h_to_48h`, `2_to_7_days`, `over_7_days`, `unknown` |
| `averageResolutionHours` | Mean time from open → resolved across resolved gaps |
| `resolvedSampleSize` | How many gaps that average is based on |

Each gap row also carries `ageHours`, `ageDays`, `ageBucket`, `stale` and (once
closed) `resolutionHours`.

### Forecast

`forecast` is the same formula applied to "what if the next N gaps closed":
`[{resolved: 0, score: 75}, {resolved: 1, score: 60}, …]`. It is a prediction
about the meter only — it never claims a crop outcome. The observation term
does not fall in the forecast, because closing a gap does not verify a record.

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

## History

Two sources feed the trend chart:

1. **Recorded snapshots** — `debtSnapshots` rows written whenever something that
   affects the score changes: `seed`, `observation_created`, `observation_deleted`,
   `gap_resolved`, `gap_reopened`, `review_{decision}`. Writes are de-duplicated
   when score *and* terms are unchanged within 90 seconds.
2. **Replay** — for any period before the first snapshot, the score is
   reconstructed from the timestamps already on record (observation creation,
   each gap's creation and resolution, each review decision), re-scored with the
   same formula. Recorded snapshots are authoritative from the moment they
   begin; replayed points inside that window are dropped.

`GET /api/evidence-debt/history` returns both series, the merged series
(sampled every 12 hours for long ranges), `delta24h`, `min`/`max`, and an
explanation of what is measured and what is replayed. The last point is always
the live score — that is the check that the replay and the engine agree.

## Ledger

Every gap — open or closed — is queryable as a flat row: code, description,
severity, observation, field, feature, opened at, age, stale flag, resolution
time, resolver and note.

- `GET /api/evidence-debt/ledger?status=open|resolved|all` plus optional
  `severity`, `fieldId`, `feature` and `limit`.
- `GET /api/evidence-debt/ledger.csv` — the same rows as a download
  (`fieldzy-evidence-ledger-YYYYMMDD-HHMM.csv`).
- `POST /api/evidence-debt/project` with `{ "gapIds": [...] }` returns the score
  that *would* result. It is read-only: it resolves nothing and writes nothing.

## API

| Endpoint | Purpose |
| --- | --- |
| `POST /api/validate-evidence` | Run the engine on a payload without saving |
| `GET /api/evidence-debt` | Full meter payload (score, terms, ageing, by field/feature, forecast, actions) |
| `GET /api/evidence-debt/history` | Recorded + reconstructed trend (`?limit=`) |
| `GET /api/evidence-debt/ledger` | Flat gap ledger with filters (`status`, `severity`, `fieldId`, `feature`) |
| `GET /api/evidence-debt/ledger.csv` | Ledger export | 
| `POST /api/evidence-debt/project` | Read-only “what if these gaps closed” projection |
| `POST /api/observations` | Create an observation → validation + gaps computed automatically |
| `POST /api/observations/{id}/evidence-gaps/{gapId}/resolve` | Resolve / re-open one gap |
| `POST /api/observations/{id}/review` | Record a human decision |

Every feature — plant detection, acoustic intelligence, soil moisture, threat
monitoring, manual observations — writes through `services/observations.py`, so
they all obey the same rules.

## Where it appears in the UI

- **Overview** — the meter card: gauge, band, explanation, the two terms, ageing
  summary, a one-week sparkline, and an expandable breakdown listing every open
  gap, its age, debt per feature and per field, the forecast, and recommended
  next actions (each linked to the observation).
- **Evidence** (`/evidence`, also linked from the sidebar chip and the meter) —
  the full ledger: trend chart with recorded vs replayed points, ageing buckets,
  per-field debt, a projection workspace where ticking gaps previews the score,
  the filterable gap table with resolve actions, and the method explainer.
- **Observations** — each row shows its open-gap count and the age of its oldest
  gap, turning orange past the stale threshold.

## Honest limits

- The meter measures *FIELDZY's* uncertainty, not crop risk. A high score means
  a queue of unfinished checks, not a bad field.
- Weighting gaps at 15 and observations at 10 is a product decision, not a
  statistically fitted parameter. It is documented, not hidden.
- Historical points before the first snapshot are reconstructions from recorded
  timestamps; they are labelled as such in both the API and the chart.
- There is no automatic ageing penalty in the score itself. Age is surfaced
  alongside the score (buckets, stale flags, oldest-gap days) so a reviewer can
  prioritise without the number silently changing meaning.
