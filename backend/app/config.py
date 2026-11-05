"""FIELDZY backend configuration.

All secrets are read from the environment (backend/.env). Nothing in this file
is ever shipped to the browser.
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
APP_DIR = BACKEND_DIR / "app"
DATA_DIR = APP_DIR / "data"
MODELS_DIR = Path(os.getenv("FIELDZY_MODELS_DIR", BACKEND_DIR / "models"))
UPLOADS_DIR = BACKEND_DIR / "uploads"
# Built React app (npm run build writes here). Served by FastAPI when present.
FRONTEND_DIST = Path(os.getenv("FIELDZY_FRONTEND_DIST", BACKEND_DIR / "webapp"))
DB_PATH = Path(os.getenv("FIELDZY_DB_PATH", BACKEND_DIR / "fieldzy.db"))

load_dotenv(BACKEND_DIR / ".env")

APP_NAME = "FIELDZY"
APP_TAGLINE = "Smarter Fields. Safer Harvests."
ENGINE_VERSION = "1.0.0"

# ---------------------------------------------------------------- AI summary
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite").strip()

# ---------------------------------------------------------------- model paths
PLANT_MODEL_DIR = Path(os.getenv("FIELDZY_PLANT_MODEL_DIR", MODELS_DIR / "plant" / "fieldzy_savedmodel"))
PLANT_CLASS_NAMES = Path(
    os.getenv("FIELDZY_PLANT_CLASS_NAMES", MODELS_DIR / "plant" / "class_names.json")
)
AUDIO_CLASSIFIER_PATH = Path(
    os.getenv("FIELDZY_SOUND_MODEL", MODELS_DIR / "audio" / "fieldzy_sound_model.pkl")
)
YAMNET_HANDLE = os.getenv("FIELDZY_YAMNET_HANDLE", "https://tfhub.dev/google/yamnet/1")
YAMNET_LOCAL_DIR = Path(os.getenv("FIELDZY_YAMNET_DIR", MODELS_DIR / "audio" / "yamnet"))
# The single most important switch for honesty: if the trained artefacts are not
# installed, FIELDZY runs an explicitly-labelled *screening* heuristic instead
# of pretending a trained model answered.
ALLOW_SCREENING_FALLBACK = os.getenv("FIELDZY_ALLOW_SCREENING", "1") != "0"

# ---------------------------------------------------------------- thresholds
CONFIDENCE_THRESHOLDS = {
    "plant_disease": 0.60,
    "acoustic_intelligence": 0.60,
    "threat_monitoring": 0.65,
    "soil_moisture": 0.0,  # sensor rules are threshold based, no model confidence
}

MAX_IMAGE_BYTES = 12 * 1024 * 1024
MAX_AUDIO_BYTES = 25 * 1024 * 1024
MAX_AUDIO_SECONDS = 60
WEATHER_TIMEOUT_SECONDS = float(os.getenv("FIELDZY_WEATHER_TIMEOUT", "6"))

# Default field centre used when a field has no coordinates (Karnataka demo farm).
DEFAULT_LAT = float(os.getenv("FIELDZY_LAT", "12.9716"))
DEFAULT_LON = float(os.getenv("FIELDZY_LON", "77.5946"))

UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
