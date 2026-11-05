"""Image feature extraction and capture-quality scoring.

Used by the plant disease module. Quality scoring is always real (blur energy,
exposure, resolution) and is what lets FIELDZY say "this photo is not good
enough to act on" instead of guessing.
"""
from __future__ import annotations

from io import BytesIO
from typing import Any

import numpy as np
from PIL import Image, ImageFilter, ImageStat, UnidentifiedImageError


def open_image(data: bytes) -> Image.Image:
    try:
        image = Image.open(BytesIO(data))
        image.load()
    except (UnidentifiedImageError, OSError) as exc:  # pragma: no cover - defensive
        raise ValueError("The uploaded file is not a readable image.") from exc
    return image.convert("RGB")


def _exif_timestamp(image: Image.Image) -> str | None:
    try:
        exif = image.getexif()
        raw = exif.get(306)  # DateTime
        return str(raw) if raw else None
    except Exception:  # pragma: no cover - exif is best effort
        return None


def analyse_image(image: Image.Image) -> dict[str, Any]:
    """Return colour/texture features plus a quality assessment for one photo."""
    width, height = image.size
    working = image.copy()
    working.thumbnail((384, 384))

    arr = np.asarray(working).astype(np.float32) / 255.0
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    luminance = 0.299 * r + 0.587 * g + 0.114 * b

    hsv = np.asarray(working.convert("HSV")).astype(np.float32) / 255.0
    hue, sat, val = hsv[..., 0], hsv[..., 1], hsv[..., 2]

    # --- shadow-relative spot detection (cheap local-contrast blob count)
    blurred = np.asarray(working.filter(ImageFilter.GaussianBlur(6))).astype(np.float32) / 255.0
    local_lum = 0.299 * blurred[..., 0] + 0.587 * blurred[..., 1] + 0.114 * blurred[..., 2]
    dark_spots = (luminance < local_lum * 0.72) & (val < 0.72)
    spot_fraction = float(dark_spots.mean())

    # --- blur energy (variance of the Laplacian)
    edges = np.asarray(working.convert("L").filter(ImageFilter.FIND_EDGES)).astype(np.float32) / 255.0
    blur_energy = float(edges.var())

    brightness = float(luminance.mean())
    contrast = float(ImageStat.Stat(working.convert("L")).stddev[0]) / 255.0

    healthy_green = (hue > 0.20) & (hue < 0.45) & (sat > 0.25) & (val > 0.15)
    chlorosis = (hue > 0.11) & (hue <= 0.20) & (sat > 0.35) & (val > 0.35)
    rust = (hue > 0.03) & (hue <= 0.11) & (sat > 0.45) & (val > 0.25)
    necrosis = (hue >= 0.0) & (hue <= 0.15) & (sat < 0.88) & (val < 0.58) & (val > 0.06)
    powdery = (sat < 0.14) & (val > 0.72)
    deep_water_soaked = (val < 0.28) & (sat > 0.15)

    features = {
        "greenFraction": float(healthy_green.mean()),
        "chlorosisFraction": float(chlorosis.mean()),
        "rustFraction": float(rust.mean()),
        "necrosisFraction": float(necrosis.mean()),
        "powderyFraction": float(powdery.mean()),
        "waterSoakedFraction": float(deep_water_soaked.mean()),
        "spotFraction": spot_fraction,
        "brightness": brightness,
        "contrast": contrast,
        "blurEnergy": blur_energy,
        "width": width,
        "height": height,
    }

    # --- capture quality (independent of any classification)
    sharpness = min(1.0, blur_energy / 0.0016)
    exposure = 1.0 - min(1.0, abs(brightness - 0.52) / 0.52)
    resolution = min(1.0, (min(width, height) / 480.0))
    quality_score = float(np.clip(0.5 * sharpness + 0.3 * exposure + 0.2 * resolution, 0.0, 1.0))

    if quality_score >= 0.75:
        summary = "Sharp, well-lit capture suitable for analysis."
    elif quality_score >= 0.55:
        summary = "Usable capture, though slightly soft or unevenly lit."
    elif quality_score >= 0.35:
        summary = "Marginal capture — blur or exposure may affect the result."
    else:
        summary = "Poor capture — the image is too blurred, too dark or too small."

    issues = []
    if sharpness < 0.45:
        issues.append("motion blur or missed focus")
    if exposure < 0.5:
        issues.append("unbalanced exposure")
    if resolution < 0.4:
        issues.append("low resolution")

    return {
        "features": features,
        "quality": {
            "score": round(quality_score, 3),
            "sharpness": round(sharpness, 3),
            "exposure": round(exposure, 3),
            "resolution": round(resolution, 3),
            "summary": summary,
            "issues": issues,
        },
        "capturedAt": _exif_timestamp(image),
    }
