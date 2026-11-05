"""Acoustic intelligence inference.

Architecture preserved from FIELDZY's original backend::

    audio -> preprocessing -> YAMNet embeddings -> separate classifier -> result

The separate classifier (``fieldzy_sound_model.pkl``, loaded with joblib) is the
only thing allowed to name the classes. YAMNet alone is *not* an agricultural
threat detector and is never reported as one.

When the classifier or TensorFlow / TensorFlow Hub are unavailable, FIELDZY runs
``screening_rules_v1``: a real DSP analysis of the clip (band energy, tonality,
transient density, envelope modulation) mapped onto clearly-labelled screening
categories. Silence is detected honestly rather than classified as a threat.
"""
from __future__ import annotations

import json
import math
import wave
from io import BytesIO
from pathlib import Path
from typing import Any

import numpy as np

from ..config import (
    ALLOW_SCREENING_FALLBACK,
    AUDIO_CLASSIFIER_PATH,
    DATA_DIR,
    MAX_AUDIO_SECONDS,
    YAMNET_HANDLE,
    YAMNET_LOCAL_DIR,
)

TARGET_SAMPLE_RATE = 16_000
_state: dict[str, Any] = {
    "loaded": False,
    "classifier": None,
    "yamnet": None,
    "labels": [],
    "error": None,
    "engine": "screening_rules_v1",
}


def _sound_catalog() -> list[dict[str, Any]]:
    try:
        data = json.loads((Path(DATA_DIR) / "sound_classes.json").read_text())
        return data.get("classes", [])
    except Exception:  # pragma: no cover
        return []


CATALOG = {entry["key"]: entry for entry in _sound_catalog()}
SCREENING_ORDER = [
    "machinery_engine",
    "animal_distress",
    "alarm_buzzer",
    "insect_chorus",
    "bird_flock",
    "wind_rain",
    "human_activity",
    "unclassified_background",
]


# ---------------------------------------------------------------------------
# Audio decoding
# ---------------------------------------------------------------------------

def decode_wav(data: bytes) -> tuple[np.ndarray, int]:
    """Decode a PCM WAV file to mono float32 in [-1, 1]."""
    try:
        with wave.open(BytesIO(data), "rb") as handle:
            channels = handle.getnchannels()
            width = handle.getsampwidth()
            rate = handle.getframerate()
            frames = handle.readframes(handle.getnframes())
    except (wave.Error, EOFError) as exc:
        raise ValueError(
            "FIELDZY could not read this audio file. Please supply a PCM WAV file "
            "(the in-browser recorder produces WAV automatically)."
        ) from exc

    if width == 1:
        samples = np.frombuffer(frames, dtype=np.uint8).astype(np.float32)
        samples = (samples - 128.0) / 128.0
    elif width == 2:
        samples = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    elif width == 3:
        raw = np.frombuffer(frames, dtype=np.uint8).reshape(-1, 3)
        ints = (
            raw[:, 0].astype(np.int32)
            | (raw[:, 1].astype(np.int32) << 8)
            | (raw[:, 2].astype(np.int32) << 16)
        )
        ints = np.where(ints >= 1 << 23, ints - (1 << 24), ints)
        samples = ints.astype(np.float32) / float(1 << 23)
    elif width == 4:
        samples = np.frombuffer(frames, dtype="<i4").astype(np.float32) / 2147483648.0
    else:
        raise ValueError(f"Unsupported WAV sample width: {width * 8} bit")

    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)

    if rate != TARGET_SAMPLE_RATE and samples.size:
        duration = samples.size / float(rate)
        target_count = int(round(duration * TARGET_SAMPLE_RATE))
        if target_count > 0:
            source_times = np.linspace(0.0, duration, samples.size, endpoint=False)
            target_times = np.linspace(0.0, duration, target_count, endpoint=False)
            samples = np.interp(target_times, source_times, samples).astype(np.float32)
        rate = TARGET_SAMPLE_RATE

    samples = np.nan_to_num(samples)
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    if peak > 1.0:
        samples = samples / peak
    return samples, rate


# ---------------------------------------------------------------------------
# DSP feature extraction (shared by both engines for quality reporting)
# ---------------------------------------------------------------------------

def _frame_signal(samples: np.ndarray, frame: int = 1024, hop: int = 512) -> np.ndarray:
    if samples.size < frame:
        padded = np.zeros(frame, dtype=np.float32)
        padded[: samples.size] = samples
        return padded.reshape(1, frame)
    count = 1 + (samples.size - frame) // hop
    index = np.arange(frame)[None, :] + hop * np.arange(count)[:, None]
    return samples[index]


def _hz_to_mel(f: np.ndarray | float) -> np.ndarray | float:
    return 2595.0 * np.log10(1.0 + np.asarray(f) / 700.0)


def dsp_features(samples: np.ndarray, rate: int) -> dict[str, Any]:
    frames = _frame_signal(samples)
    window = np.hanning(frames.shape[1]).astype(np.float32)
    windowed = frames * window
    spectrum = np.abs(np.fft.rfft(windowed, axis=1)) + 1e-9
    freqs = np.fft.rfftfreq(frames.shape[1], 1.0 / rate)

    rms_frames = np.sqrt(np.mean(windowed ** 2, axis=1)) + 1e-9
    rms = float(np.sqrt(np.mean(samples ** 2))) if samples.size else 0.0
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    crest = float(peak / (rms + 1e-9))
    zcr = float(np.mean(np.abs(np.diff(np.sign(samples))) > 0)) if samples.size > 1 else 0.0

    total = spectrum.sum(axis=1, keepdims=True)
    centroid = float(np.mean((spectrum * freqs).sum(axis=1) / total[:, 0]))
    flatness = float(np.mean(np.exp(np.mean(np.log(spectrum), axis=1)) / np.mean(spectrum, axis=1)))
    cumulative = np.cumsum(spectrum, axis=1)
    rolloff_index = np.argmax(cumulative >= 0.85 * cumulative[:, -1:], axis=1)
    rolloff = float(np.mean(freqs[np.clip(rolloff_index, 0, len(freqs) - 1)])) if frames.size else 0.0

    bands = {
        "low": float(spectrum[:, (freqs >= 20) & (freqs < 250)].sum() / spectrum.sum()),
        "lowMid": float(spectrum[:, (freqs >= 250) & (freqs < 800)].sum() / spectrum.sum()),
        "mid": float(spectrum[:, (freqs >= 800) & (freqs < 2000)].sum() / spectrum.sum()),
        "high": float(spectrum[:, (freqs >= 2000) & (freqs < 6000)].sum() / spectrum.sum()),
        "veryHigh": float(spectrum[:, (freqs >= 6000) & (freqs <= rate / 2)].sum() / spectrum.sum()),
    }

    # tonal peak + harmonicity from average spectrum autocorrelation
    mean_spectrum = spectrum.mean(axis=0)
    peak_bin = int(np.argmax(mean_spectrum))
    dominant_hz = float(freqs[peak_bin])
    narrowband_ratio = float(mean_spectrum[peak_bin] / (np.median(mean_spectrum) + 1e-9))
    tonality = float(np.clip(math.log10(max(narrowband_ratio, 1.0)) / 2.5, 0.0, 1.0))

    envelope = rms_frames - rms_frames.mean()
    env_spectrum = np.abs(np.fft.rfft(envelope))
    env_freqs = np.fft.rfftfreq(envelope.size, hop_duration := (frames.shape[1] / 2.0) / rate)
    modulation_hz = float(env_freqs[int(np.argmax(env_spectrum[1:]) + 1)]) if envelope.size > 4 else 0.0
    modulation_depth = float(np.std(rms_frames) / (np.mean(rms_frames) + 1e-9))

    median_rms = float(np.median(rms_frames))
    transients = int(np.sum(rms_frames > max(median_rms * 2.2, 0.01)))

    # dominant frequency inside the tonal band (for pitch-like sounds)
    tonal_mask = (freqs > 80) & (freqs < 3000)
    tonal_peak_hz = float(freqs[tonal_mask][int(np.argmax(mean_spectrum[tonal_mask]))]) if tonal_mask.any() else dominant_hz

    noise_floor = float(np.percentile(rms_frames, 10))
    snr_db = 20.0 * math.log10((median_rms + 1e-9) / (noise_floor + 1e-9))
    clarity = float(np.clip((min(snr_db, 40.0) / 40.0) * min(1.0, (rms / 0.02)), 0.0, 1.0))

    return {
        "rms": float(rms),
        "peak": peak,
        "crestFactor": crest,
        "zeroCrossingRate": zcr,
        "spectralCentroid": centroid,
        "spectralRolloff": rolloff,
        "spectralFlatness": flatness,
        "tonality": tonality,
        "dominantHz": dominant_hz,
        "tonalPeakHz": tonal_peak_hz,
        "modulationHz": modulation_hz,
        "modulationDepth": modulation_depth,
        "transientCount": transients,
        "bands": bands,
        "snrDb": float(snr_db),
        "clarityScore": clarity,
        "frameCount": int(frames.shape[0]),
        "hopDuration": hop_duration,
    }


# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------

def load_models() -> dict[str, Any]:
    if _state["loaded"]:
        return _state
    _state["loaded"] = True

    if not Path(AUDIO_CLASSIFIER_PATH).exists():
        _state["error"] = f"Classifier not found at {AUDIO_CLASSIFIER_PATH}"
        return _state

    try:
        import joblib

        classifier = joblib.load(AUDIO_CLASSIFIER_PATH)
        _state["classifier"] = classifier
        classes = getattr(classifier, "classes_", None)
        _state["labels"] = [str(c) for c in classes] if classes is not None else []
    except Exception as exc:
        _state["error"] = f"Could not load the classifier: {exc}"
        return _state

    try:
        import tensorflow as tf  # type: ignore
        import tensorflow_hub as hub  # type: ignore

        if Path(YAMNET_LOCAL_DIR).exists() and any(Path(YAMNET_LOCAL_DIR).iterdir()):
            _state["yamnet"] = hub.load(str(YAMNET_LOCAL_DIR))
            _state["yamnetSource"] = str(YAMNET_LOCAL_DIR)
        else:
            _state["yamnet"] = hub.load(YAMNET_HANDLE)
            _state["yamnetSource"] = YAMNET_HANDLE
        _state["tf"] = tf
        _state["engine"] = "yamnet_embeddings+fieldzy_sound_model"
    except Exception as exc:
        _state["error"] = f"YAMNet unavailable: {exc}"

    return _state


def status() -> dict[str, Any]:
    state = load_models()
    installed = state.get("classifier") is not None and state.get("yamnet") is not None
    return {
        "module": "acoustic_intelligence",
        "trainedModelInstalled": installed,
        "activeEngine": "yamnet_embeddings+fieldzy_sound_model" if installed else "screening_rules_v1",
        "isTrainedModel": installed,
        "classifierPath": str(AUDIO_CLASSIFIER_PATH),
        "classifierPresent": state.get("classifier") is not None,
        "yamnetLoaded": state.get("yamnet") is not None,
        "yamnetSource": state.get("yamnetSource", YAMNET_LOCAL_DIR if Path(YAMNET_LOCAL_DIR).exists() else YAMNET_HANDLE),
        "labels": state.get("labels") or [CATALOG[k]["label"] for k in SCREENING_ORDER],
        "labelSource": "classifier.classes_" if state.get("labels") else "screening catalogue",
        "detail": (
            "YAMNet embeddings + the separate FIELDZY classifier are active."
            if installed
            else (state.get("error") or "Classifier not installed.")
            + " Acoustic results use labelled screening rules and claim no trained-model accuracy."
        ),
        "screeningFallbackEnabled": ALLOW_SCREENING_FALLBACK,
    }


# ---------------------------------------------------------------------------
# Inference
# ---------------------------------------------------------------------------

def _screening_scores(f: dict[str, float]) -> dict[str, float]:
    bands = f["bands"]
    tonal = f["tonality"]
    low = bands["low"]
    high = bands["high"] + bands["veryHigh"]
    mid = bands["mid"] + bands["lowMid"]
    mod = f["modulationHz"]
    phrase = (8.0 <= mod <= 45.0) and f["modulationDepth"] > 0.35
    steady = f["modulationDepth"] < 0.5
    low_pitch = 40 <= f["tonalPeakHz"] <= 260
    high_tone = 900 <= f["tonalPeakHz"] <= 4200

    return {
        "machinery_engine": 3.2 * low + 2.6 * tonal + 1.8 * (1.0 if low_pitch else 0.0) + 1.2 * (1.0 if steady else 0.0) - 1.4 * high,
        "animal_distress": 2.4 * tonal + 2.0 * (1.0 if low_pitch else 0.0) + 1.6 * mid + 0.8 * min(f["crestFactor"] / 4.0, 1.5) + 0.7 * (1.0 if phrase else 0.0) - 1.2 * low,
        "alarm_buzzer": 2.0 * tonal + 1.6 * (1.0 if high_tone else 0.0) + 1.5 * (1.0 if steady else 0.0) + 1.1 * (bands["mid"] + bands["high"]) - 1.0 * low - 1.6 * (1.0 if phrase else 0.0),
        "insect_chorus": 2.8 * high + 2.6 * (1.0 if phrase else 0.0) + 0.8 * (1.0 - tonal) + 1.4 * min(mod / 40.0, 1.0) + 0.8 * (1.0 if 8 <= mod <= 45 else 0.0),
        "bird_flock": 1.6 * tonal + 1.4 * min(f["transientCount"] / 12.0, 1.6) + 1.2 * mid + 0.9 * (1.0 if high_tone else 0.0),
        "wind_rain": 1.9 * (1.0 - tonal) + 1.6 * f["spectralFlatness"] + 1.2 * high + 0.6 * min(f["zeroCrossingRate"] * 2.2, 1.0) - 1.0 * (1.0 if low_pitch else 0.0),
        "human_activity": 1.7 * mid + 1.5 * min(f["transientCount"] / 10.0, 1.6) + 0.9 * (1.0 if 2.0 <= mod <= 9.0 else 0.0) - 0.8 * (1.0 if steady else 0.0),
        "unclassified_background": 1.0 + 0.4 * f["spectralFlatness"],
    }


def _yamnet_inference(state: dict[str, Any], samples: np.ndarray) -> tuple[str, float, list[dict[str, Any]]]:
    tf = state["tf"]
    model = state["yamnet"]
    classifier = state["classifier"]
    scores, embeddings, _ = model(samples.astype(np.float32))
    embedding = np.array(embeddings)
    pooled = embedding.mean(axis=0, keepdims=True)

    labels = state.get("labels") or []
    if hasattr(classifier, "predict_proba"):
        probs = np.asarray(classifier.predict_proba(pooled))[0]
        classes = list(getattr(classifier, "classes_", [])) or labels
        order = np.argsort(probs)[::-1][:3]
        top_k = [{"label": str(classes[i]), "confidence": float(probs[i])} for i in order]
    else:
        prediction = classifier.predict(pooled)[0]
        top_k = [{"label": str(prediction), "confidence": None}]
    return top_k[0]["label"], (top_k[0]["confidence"] or 0.0), top_k


def _envelope(samples: np.ndarray, points: int = 120) -> list[float]:
    if samples.size == 0:
        return []
    chunk = max(1, samples.size // points)
    trimmed = samples[: chunk * points]
    env = np.abs(trimmed.reshape(points, chunk)).mean(axis=1)
    peak = float(env.max()) or 1.0
    return [round(float(v / peak), 3) for v in env]


def analyse(data: bytes, *, source: str = "microphone") -> dict[str, Any]:
    samples, rate = decode_wav(data)
    duration = round(samples.size / rate, 2) if rate else 0.0
    if duration > MAX_AUDIO_SECONDS:
        raise ValueError(f"Clip is {duration:.0f}s; FIELDZY analyses up to {MAX_AUDIO_SECONDS}s at a time.")
    if duration < 0.25:
        raise ValueError("Clip is too short to analyse. Record at least half a second.")

    features = dsp_features(samples, rate)
    envelope = _envelope(samples)
    state = load_models()

    if features["rms"] < 0.0025:
        entry = CATALOG["no_signal"]
        return {
            "engine": "screening_rules_v1",
            "isTrainedModel": False,
            "predictedClass": "no_signal",
            "label": entry["label"],
            "description": entry["description"],
            "confidence": 0.0,
            "topK": [],
            "threatRelevance": "none",
            "threatCategory": "none",
            "recommendedAction": entry["recommendedAction"],
            "features": {**features, "durationSec": duration, "sampleRate": rate, "envelope": envelope},
            "clarityScore": 0.0,
            "claritySummary": "The clip is effectively silent — check the microphone input.",
            "durationSec": duration,
            "source": source,
            "note": "No acoustic content was detected, so no classification is reported.",
        }

    if state.get("classifier") is not None and state.get("yamnet") is not None:
        label, confidence, top_k = _yamnet_inference(state, samples)
        catalog_entry = next((v for k, v in CATALOG.items() if v["label"].lower() == label.lower() or v["key"] == label), None)
        return {
            "engine": "yamnet_embeddings+fieldzy_sound_model",
            "isTrainedModel": True,
            "predictedClass": label,
            "label": label,
            "description": catalog_entry["description"] if catalog_entry else "Prediction from fieldzy_sound_model.pkl.",
            "confidence": round(float(confidence), 4),
            "topK": top_k,
            "threatRelevance": (catalog_entry or {}).get("threatRelevance", "unknown"),
            "threatCategory": (catalog_entry or {}).get("threatCategory", "unmapped"),
            "recommendedAction": (catalog_entry or {}).get(
                "recommendedAction", "Confirm the source in the field before acting on this classification."
            ),
            "features": {**features, "durationSec": duration, "sampleRate": rate, "envelope": envelope},
            "clarityScore": features["clarityScore"],
            "claritySummary": _clarity_summary(features["clarityScore"]),
            "durationSec": duration,
            "source": source,
            "note": "Classified by the separate FIELDZY sound classifier on YAMNet embeddings. A sound is not proof of a threat.",
        }

    if not ALLOW_SCREENING_FALLBACK:
        raise RuntimeError(
            "The acoustic classifier is not installed and the screening fallback is disabled "
            f"({state.get('error')})."
        )

    scores = _screening_scores(features)
    keys = list(scores)
    values = np.array([scores[k] for k in keys]) / 0.75
    values -= values.max()
    probs = np.exp(values) / np.exp(values).sum()
    order = np.argsort(probs)[::-1]
    top_keys = [keys[i] for i in order[:3]]
    top_k = [
        {"label": CATALOG.get(key, {}).get("label", key), "confidence": round(float(probs[order[i]]), 4)}
        for i, key in enumerate(top_keys)
    ]
    predicted_key = top_keys[0]
    entry = CATALOG.get(predicted_key, CATALOG["unclassified_background"])
    confidence = float(probs[order[0]])
    margin = confidence - float(probs[order[1]])
    screening_confidence = round(min(0.86, max(0.30, 0.40 + 0.45 * margin + 0.10 * features["clarityScore"])), 4)

    return {
        "engine": "screening_rules_v1",
        "isTrainedModel": False,
        "predictedClass": predicted_key,
        "label": entry["label"],
        "description": entry["description"],
        "confidence": screening_confidence,
        "topK": top_k,
        "threatRelevance": entry["threatRelevance"],
        "threatCategory": entry["threatCategory"],
        "recommendedAction": entry["recommendedAction"],
        "features": {**features, "durationSec": duration, "sampleRate": rate, "envelope": envelope},
        "clarityScore": features["clarityScore"],
        "claritySummary": _clarity_summary(features["clarityScore"]),
        "durationSec": duration,
        "source": source,
        "note": (
            "Produced by FIELDZY acoustic screening rules (band energy, tonality, transients, envelope "
            "modulation) — not the trained classifier. No accuracy is claimed."
        ),
    }


def _clarity_summary(clarity: float) -> str:
    if clarity >= 0.7:
        return "Clean recording with a good signal-to-noise ratio."
    if clarity >= 0.45:
        return "Usable recording, some background noise present."
    if clarity >= 0.2:
        return "Noisy or quiet recording — the result is low confidence."
    return "Very weak signal — move closer to the source or check the microphone."
