"""Plant disease inference.

Two engines, in strict priority order:

1. ``fieldzy_savedmodel`` — the real TensorFlow SavedModel (``serving_default``)
   with labels from ``class_names.json``. Used whenever the artefacts are
   installed, exactly as the original FIELDZY backend did.
2. ``screening_rules_v1`` — a transparent, deterministic colour/texture screen.
   It exists so the product is usable before the trained artefacts are
   installed, and it is *always* labelled as a screen, never as a diagnosis.
   The evidence engine automatically attaches a "trained model artefact not
   installed" gap to anything it produces.

No random numbers are used anywhere in this module.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

from ..config import (
    ALLOW_SCREENING_FALLBACK,
    MODELS_DIR,
    PLANT_CLASS_NAMES,
    PLANT_MODEL_DIR,
)
from .image_features import analyse_image, open_image

DEFAULT_SCREENING_CLASSES = [
    "Healthy",
    "Early Blight",
    "Late Blight",
    "Leaf Rust",
    "Bacterial Spot",
    "Powdery Mildew",
    "Yellow Mosaic Virus",
    "Nitrogen Deficiency",
]

READABLE_LABELS = {
    "Healthy": "No disease pattern detected",
    "Early Blight": "Early blight pattern (Alternaria-type concentric lesions)",
    "Late Blight": "Late blight pattern (water-soaked lesions)",
    "Leaf Rust": "Leaf rust pattern (orange-brown pustules)",
    "Bacterial Spot": "Bacterial spot pattern (many small dark lesions)",
    "Powdery Mildew": "Powdery mildew pattern (white surface growth)",
    "Yellow Mosaic Virus": "Yellow mosaic pattern (mottled chlorosis)",
    "Nitrogen Deficiency": "Nitrogen deficiency pattern (uniform pale yellowing)",
}

_state: dict[str, Any] = {"loaded": False, "model": None, "signature": None, "error": None, "labels": []}


def _read_class_names(path: Path) -> list[str] | None:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    if isinstance(data, dict):
        # supports {"0": "Healthy", ...} and {"class_names": [...]}
        if "class_names" in data and isinstance(data["class_names"], list):
            data = data["class_names"]
        else:
            data = [value for _, value in sorted(data.items(), key=lambda kv: str(kv[0]))]
    if isinstance(data, list) and all(isinstance(item, str) for item in data):
        return data
    return None


def load_model() -> dict[str, Any]:
    """Attempt to load the TensorFlow SavedModel once. Safe to call repeatedly."""
    if _state["loaded"]:
        return _state
    _state["loaded"] = True

    if not Path(PLANT_MODEL_DIR).exists():
        _state["error"] = f"SavedModel directory not found at {PLANT_MODEL_DIR}"
        return _state
    try:
        import tensorflow as tf  # type: ignore
    except Exception as exc:  # ImportError or a broken TF install
        _state["error"] = f"TensorFlow is not installed in this environment ({exc.__class__.__name__})"
        return _state

    try:
        model = tf.saved_model.load(str(PLANT_MODEL_DIR))
        _state["model"] = model
        _state["signature"] = model.signatures["serving_default"]
        _state["labels"] = _read_class_names(Path(PLANT_CLASS_NAMES)) or []
        _state["tf"] = tf
    except Exception as exc:
        _state["error"] = f"Failed to load SavedModel: {exc}"
    return _state


def status() -> dict[str, Any]:
    state = load_model()
    installed = state.get("signature") is not None
    screening = _read_class_names(Path(MODELS_DIR / "plant" / "screening_class_names.json")) or DEFAULT_SCREENING_CLASSES
    labels = state.get("labels") or _read_class_names(Path(PLANT_CLASS_NAMES)) or screening
    return {
        "module": "plant_disease",
        "trainedModelInstalled": installed,
        "activeEngine": "fieldzy_savedmodel" if installed else "screening_rules_v1",
        "isTrainedModel": installed,
        "labels": labels,
        "labelCount": len(labels),
        "expectedModelPath": str(PLANT_MODEL_DIR),
        "expectedClassNamesPath": str(PLANT_CLASS_NAMES),
        "detail": (
            "TensorFlow SavedModel loaded via serving_default."
            if installed
            else (state.get("error") or "SavedModel not installed.")
            + " FIELDZY is using labelled screening rules; treat results as a triage signal only."
        ),
        "screeningFallbackEnabled": ALLOW_SCREENING_FALLBACK,
    }


def _softmax(scores: dict[str, float], temperature: float = 1.0) -> dict[str, float]:
    keys = list(scores.keys())
    values = np.array([scores[k] for k in keys], dtype=np.float64) / max(temperature, 1e-6)
    values -= values.max()
    exp = np.exp(values)
    probs = exp / exp.sum()
    return {k: float(v) for k, v in zip(keys, probs)}


def _screening_scores(features: dict[str, float]) -> dict[str, float]:
    necrosis = features["necrosisFraction"]
    chlorosis = features["chlorosisFraction"]
    green = features["greenFraction"]
    rust = features["rustFraction"]
    powdery = features["powderyFraction"]
    spots = features["spotFraction"]
    soaked = features["waterSoakedFraction"]
    contrast = features["contrast"]

    # Disease evidence is normalised against the visible leaf area: a leaf is
    # mostly green by definition, so raw green fraction cannot decide health.
    lesion = necrosis + rust + chlorosis + powdery
    lesion_share = lesion / (lesion + max(green, 0.05) + 1e-6)

    scores = {
        "Healthy": 1.55 + green * 0.7 - lesion_share * 7.5 - spots * 5.0,
        "Early Blight": lesion_share * 9.0 + spots * 16.0 + necrosis * 4.0 - rust * 3.0,
        "Late Blight": lesion_share * 8.0 + soaked * 11.0 + spots * 7.0,
        "Leaf Rust": lesion_share * 6.5 + rust * 28.0 + spots * 3.0,
        "Bacterial Spot": lesion_share * 5.5 + spots * 23.0 + necrosis * 2.0,
        "Powdery Mildew": lesion_share * 5.5 + powdery * 22.0 + (1.0 - contrast) * 0.5,
        "Yellow Mosaic Virus": lesion_share * 7.5 + chlorosis * 19.0 + spots * 2.0,
        "Nitrogen Deficiency": lesion_share * 4.5 + chlorosis * 11.0 - necrosis * 3.0 - spots * 3.0,
    }
    return scores


# Decision margins are deliberately compressed: the screening engine never
# reports the kind of confidence a validated model would.
def _screening_confidence(probs: dict[str, float], quality_score: float) -> float:
    top = max(probs.values())
    second = sorted(probs.values())[-2] if len(probs) > 1 else 0.0
    margin = top - second
    raw = 0.34 + 0.34 * margin + 0.10 * (quality_score - 0.5)
    return float(max(0.30, min(0.74, raw)))


def _resize_for_signature(image, signature) -> np.ndarray:
    shape = None
    for tensor in signature.inputs:
        dims = tensor.shape.as_list()
        if dims and len(dims) == 4:
            shape = dims
            break
    height = shape[1] if shape and shape[1] else 224
    width = shape[2] if shape and shape[2] else 224
    resized = image.convert("RGB").resize((int(width), int(height)))
    array = np.asarray(resized).astype(np.float32)
    if shape is None or (shape[-1] if shape[-1] else 3) == 3:
        pass
    if np.issubdtype(np.float32, np.floating):
        array = array / 255.0
    return np.expand_dims(array, 0)


def predict(image_bytes: bytes, crop: str | None = None) -> dict[str, Any]:
    """Run the active plant engine on one image and return a structured result."""
    image = open_image(image_bytes)
    analysis = analyse_image(image)
    features = analysis["features"]
    quality = analysis["quality"]

    state = load_model()
    if state.get("signature") is not None:
        tf = state["tf"]
        labels = state.get("labels") or []
        try:
            array = _resize_for_signature(image, state["signature"])
            tensor = tf.convert_to_tensor(array)
            input_key = list(state["signature"].structured_input_signature[1].keys())[0]
            output = state["signature"](**{input_key: tensor})
            logits = list(output.values())[0].numpy()[0]
            probs = np.exp(logits - logits.max()) / np.exp(logits - logits.max()).sum()
            order = np.argsort(probs)[::-1][:3]
            top_k = [
                {"label": labels[i] if i < len(labels) else f"class_{i}", "confidence": float(probs[i])}
                for i in order
            ]
            predicted = top_k[0]["label"]
            return {
                "engine": "fieldzy_savedmodel",
                "isTrainedModel": True,
                "predictedClass": predicted,
                "label": READABLE_LABELS.get(predicted, predicted),
                "confidence": round(float(top_k[0]["confidence"]), 4),
                "topK": top_k,
                "features": features,
                "quality": quality,
                "crop": crop or "",
                "note": "Prediction from the installed TensorFlow SavedModel. Not a laboratory diagnosis.",
            }
        except Exception as exc:  # fall through to screening if inference fails
            state["error"] = f"Inference failed: {exc}"

    if not ALLOW_SCREENING_FALLBACK:
        raise RuntimeError(
            "Plant model is not installed and the screening fallback is disabled "
            f"({state.get('error')})."
        )

    probs = _softmax(_screening_scores(features), temperature=0.55)
    ordered = sorted(probs.items(), key=lambda kv: kv[1], reverse=True)
    labels = _read_class_names(Path(MODELS_DIR / "plant" / "screening_class_names.json")) or DEFAULT_SCREENING_CLASSES
    top_k = [{"label": label, "confidence": round(prob, 4)} for label, prob in ordered[:3] if label in labels][:3]
    predicted = top_k[0]["label"] if top_k else ordered[0][0]
    confidence = round(_screening_confidence(probs, quality["score"]), 4)

    return {
        "engine": "screening_rules_v1",
        "isTrainedModel": False,
        "predictedClass": predicted,
        "label": READABLE_LABELS.get(predicted, predicted),
        "confidence": confidence,
        "topK": top_k,
        "features": features,
        "quality": quality,
        "crop": crop or "",
        "note": (
            "Produced by FIELDZY screening rules, not a trained disease model. "
            "No accuracy is claimed for this screen."
        ),
    }
