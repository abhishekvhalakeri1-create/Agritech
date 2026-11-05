# FIELDZY

**Smarter Fields. Safer Harvests.**

An agricultural intelligence platform that monitors fields, screens plant
photographs, analyses field audio, tracks soil moisture, and — above all —
tracks **how much of what it says is actually supported by evidence**.

FIELDZY is built around one idea: a detection is not a fact. Every model output,
sensor reading and manual note enters the same evidence workflow before it is
allowed to become a warning. The state of that uncertainty is the
**Evidence Debt Meter**.

---

## Quick start

```bash
# 1. Backend
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env                 # optional: add GEMINI_API_KEY
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000

# 2. Frontend (second terminal)
cd frontend
npm install
npm run dev                          # http://localhost:5173
```

`npm run dev` proxies `/api/*` to `127.0.0.1:8000`, so the browser only ever
talks to one origin. API docs live at `http://localhost:8000/docs`.

Or run both together: `./scripts/setup.sh` (once) then `./scripts/dev.sh`.

Engine behaviour checks:

```bash
cd backend && .venv/bin/python -m tests.test_evidence_engine   # 7/7
```

On first boot FIELDZY creates `backend/fieldzy.db` and seeds four fields plus
eight observations. Seeded observations are flagged `isDemo: true` and labelled
**Demo record** in the UI. Everything else — analyses, observations, gap
resolutions, reviews, transmissions — is created by real use.

---

## What is actually implemented

| Area | Status | Honest detail |
| --- | --- | --- |
| Evidence Debt Meter | Working | `min(100, gaps×15 + unresolved×10)`, computed from observation rows |
| Evidence validation engine | Working | Deterministic rules, shared by every module, never self-verifies |
| Observation management | Working | Gaps resolved individually, review history, blocked verification |
| Plant disease detection | Working | TensorFlow `serving_default` when installed; otherwise labelled screening rules |
| Acoustic intelligence | Working | YAMNet embeddings + `fieldzy_sound_model.pkl` when installed; otherwise labelled DSP screening |
| Soil moisture | Working (simulated readings) | No physical sensor is attached — every value says so |
| Threat visualizer | Working | Driven by real observation records, slate-green → amber → orange → red |
| AI field-health summary | Working | Gemini through the backend when a key exists, else a labelled local summary |
| Weather | Working | Live Open-Meteo proxy with cache, loading and error states |
| Offline-aware network layer | Partial | Browser queue + explicit delivery states. No service worker, no mesh relay |

### Model artefacts are optional, honesty is not

FIELDZY never invents a prediction. If `backend/models/plant/fieldzy_savedmodel`
or `backend/models/audio/fieldzy_sound_model.pkl` are missing, the API switches
to a **screening engine**, reports `isTrainedModel: false`, says so in the UI, and
the evidence engine attaches a `MODEL_ARTIFACT_NOT_INSTALLED` gap to every
observation produced from it. See [`backend/models/README.md`](backend/models/README.md).

`GET /api/model-status` returns the live engine, the exact paths it looked for
and the reason anything is unavailable.

---

## Architecture

```
frontend/ (React + TypeScript + Vite, Garamond design system, lucide-react)
  pages/       Overview · Fields · Warnings · Observations · Acoustic · Plant · Soil · Network
  components/  EvidenceDebtMeter · ThreatCard · ObservationDrawer · WeatherCard · HealthSummary
  lib/         API client, offline queue, hooks, formatting

backend/ (FastAPI)
  evidence_engine.py         validate_evidence(), apply_review(), resolve_gap(), evidence_debt()
  services/
    plant_model.py           SavedModel or screening_rules_v1
    audio_model.py           YAMNet + classifier, or DSP screening_rules_v1
    image_features.py        quality scoring + colour/texture features
    observations.py          the single write path for every module
    gemini_summary.py        Gemini call + labelled local fallback
    weather.py               Open-Meteo proxy with cache and error states
  routers/                   core · inference · system
  db.py / seed.py            SQLite persistence, first-run seed
```

### The observation contract

```jsonc
{
  "id": "OBS-1041", "fieldId": "FLD-01", "fieldName": "North Block — Tomato",
  "title": "…", "description": "…", "category": "disease",
  "feature": "plant_disease", "status": "needs_review",
  "syncStatus": "synced", "confidence": 0.91,
  "evidenceGaps": [ /* individual, resolvable gap rows */ ],
  "validation":   { /* verdict, checks, terms, next action */ },
  "evidence":     { /* images, audio, readings, corroboration */ },
  "qualityChecks": [ /* automated checks */ ],
  "reviewStage": "human_review",
  "reviewHistory": [ /* every decision, with reviewer and time */ ],
  "nextAction": "…",
  "createdAt": "…", "isDemo": true
}
```

### API surface

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health`, `/api/model-status` | Liveness and live engine status |
| GET | `/api/overview` | Dashboard payload (stats, fields, debt, queue, activity) |
| GET/POST/PATCH/DELETE | `/api/fields` | Field records |
| GET/POST/PATCH/DELETE | `/api/observations` | Observation records |
| POST | `/api/observations/{id}/evidence-gaps/{gapId}/resolve` | Resolve / re-open a gap |
| POST | `/api/observations/{id}/review` | Human verification decision |
| POST | `/api/validate-evidence` | Run the engine without saving |
| GET | `/api/evidence-debt` | Full meter payload |
| GET | `/api/threats` | Threat visualizer records |
| POST | `/api/predict-plant` | Leaf photograph → engine result |
| POST | `/api/plant-analyses/{id}/observation` | Promote an analysis into the workflow |
| POST | `/api/analyse-audio` | Clip → acoustic result |
| POST | `/api/audio-analyses/{id}/observation` | Promote an analysis into the workflow |
| GET/POST | `/api/soil/readings` | Simulated probe readings |
| GET | `/api/weather` | Open-Meteo proxy (`?force=true` to bypass cache) |
| POST | `/api/field-health-summary` | Gemini summary or labelled local fallback |
| GET/POST | `/api/transmissions`, `/api/network` | Delivery trail and network state |

---

## Design principles

- **A model prediction is a report.** The engine caps automated verdicts at
  `needs_review`; only a recorded review sets `verified`.
- **One gap at a time.** Resolving an evidence gap never resolves the whole
  observation.
- **Say which engine answered.** Trained model, threshold rule or screening pass
  — every result is labelled.
- **Never fake live data.** Weather errors show as errors. Simulated soil values
  say "simulated". Acoustic history is only what you actually analysed.
- **Online is not delivered.** A record is `synced` only after a server
  acknowledgement; the browser queue is separate and visible.
- **Calm design.** Garamond throughout, forest/sage/olive/cream palette, a
  horizontal top navigation, generous whitespace, restrained motion.

Open **/network** in the app for the full delivery model, and
[`docs/EVIDENCE_DEBT.md`](docs/EVIDENCE_DEBT.md) for the scoring rules.

---

## Deliberately not claimed

- Trained plant/acoustic accuracy figures — no evaluation set has been run here.
- Physical soil sensors, ESP32 integration or calibration.
- PWA/service-worker offline shell, IndexedDB evidence storage, duplicate
  prevention and conflict resolution.
- Device-to-device relay or mesh networking.
- Live automatic threat detection from cameras or sensors; the visualizer shows
  observation-backed records, marked as demo where seeded.
- A validated Gemini response: without `GEMINI_API_KEY` the endpoint returns a
  local, plainly-labelled summary.

## Roadmap

Farm-specific audio datasets and calibrated confidence; crop-specific plant
models evaluated with precision/recall/F1 and confusion matrices; real sensor
integration with health monitoring; a proper offline PWA with a synchronisation
queue; multi-signal corroboration before a threat is raised; cross-field pattern
detection that never mistakes correlation for causation.
