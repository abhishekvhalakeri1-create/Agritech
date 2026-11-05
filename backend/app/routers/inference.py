"""Model-backed routes: plant disease, acoustic intelligence, soil moisture."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .. import db
from ..config import MAX_AUDIO_BYTES, MAX_IMAGE_BYTES, UPLOADS_DIR
from ..services import audio_model, plant_model
from ..services.image_features import analyse_image, open_image
from ..services.observations import create_observation, recompute_field_activity, record_transmission

router = APIRouter()


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


async def _read_upload(file: UploadFile, limit: int, kind: str) -> bytes:
    data = await file.read()
    if not data:
        raise HTTPException(400, f"The uploaded {kind} file is empty.")
    if len(data) > limit:
        raise HTTPException(413, f"{kind.capitalize()} file is larger than the {limit // (1024 * 1024)} MB limit.")
    return data


# --------------------------------------------------------------- plant disease
@router.post("/predict-plant")
async def predict_plant(
    file: UploadFile = File(...),
    fieldId: str = Form(""),
    crop: str = Form(""),
) -> dict[str, Any]:
    """Run the installed SavedModel, or the labelled screening screen."""
    data = await _read_upload(file, MAX_IMAGE_BYTES, "image")
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(415, "Please upload a JPEG or PNG image.")

    field = db.fetch_one("fields", fieldId) if fieldId else None
    try:
        image = open_image(data)
        analysis = analyse_image(image)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None

    try:
        result = plant_model.predict(data, crop=crop or (field or {}).get("crop"))
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from None

    # small preview for the UI / audit trail
    thumb = image.copy()
    thumb.thumbnail((720, 720))
    image_name = f"plant-{uuid.uuid4().hex[:10]}.jpg"
    thumb.save(UPLOADS_DIR / image_name, "JPEG", quality=82)

    record = {
        "id": f"PLT-{uuid.uuid4().hex[:6].upper()}",
        "fieldId": (field or {}).get("id") or None,
        "fieldName": (field or {}).get("name") or "",
        "fileName": file.filename or image_name,
        "imagePath": image_name,
        "predictedClass": result["predictedClass"],
        "label": result["label"],
        "confidence": result.get("confidence"),
        "engine": result["engine"],
        "isTrainedModel": result["isTrainedModel"],
        "quality": analysis["quality"],
        "topK": result.get("topK", []),
        "observationId": None,
        "createdAt": _now(),
    }
    db.insert("plantAnalyses", record)

    return {
        "analysis": {
            **record,
            "imageUrl": f"/api/uploads/{image_name}",
            "crop": result.get("crop"),
            "note": result.get("note"),
            "features": result.get("features"),
            "isTrainedModel": result["isTrainedModel"],
            "label": result["label"],
            "predictedClass": result["predictedClass"],
            "confidence": result.get("confidence"),
            "topK": result.get("topK", []),
            "createdAt": record["createdAt"],
            "fileName": record["fileName"],
        },
        "modelStatus": plant_model.status(),
        "observation": None,
    }


class PlantObservationRequest(BaseModel):
    fieldId: str | None = None
    severity: str | None = None
    notes: str = ""


@router.post("/plant-analyses/{analysis_id}/observation", status_code=201)
def plant_analysis_to_observation(analysis_id: str, payload: PlantObservationRequest) -> dict[str, Any]:
    analysis = db.fetch_one("plantAnalyses", analysis_id)
    if not analysis:
        raise HTTPException(404, "Plant analysis not found")
    if analysis.get("observationId"):
        raise HTTPException(409, "This analysis is already linked to an observation")

    field_id = payload.fieldId or analysis.get("fieldId")
    field = db.fetch_one("fields", field_id) if field_id else None
    label = analysis.get("label") or analysis.get("predictedClass")
    confidence = analysis.get("confidence")

    evidence = {
        "images": [
            {
                "fileName": analysis.get("fileName"),
                "path": analysis.get("imagePath"),
                "quality": analysis.get("quality") or {},
            }
        ],
        "independentConfirmations": 0,
        "independentSources": [],
    }
    model_result = {
        "predictedClass": analysis.get("predictedClass"),
        "label": label,
        "confidence": confidence,
        "engine": analysis.get("engine"),
        "isTrainedModel": bool(analysis.get("isTrainedModel")),
        "topK": analysis.get("topK") or [],
    }

    observation = create_observation(
        field_id=field_id,
        feature="plant_disease",
        category="disease",
        title=f"Plant screening — {label}",
        description=(
            f"{payload.notes} Image “{analysis.get('fileName')}” analysed at {analysis.get('createdAt')} "
            f"using {analysis.get('engine')}. " if payload.notes else
            f"Image “{analysis.get('fileName')}” analysed at {analysis.get('createdAt')} using "
            f"{analysis.get('engine')}. "
        )
        + (
            "Result came from the installed trained model and still requires field confirmation."
            if analysis.get("isTrainedModel")
            else "Result came from FIELDZY screening rules, not a trained disease model."
        ),
        severity=payload.severity or "moderate",
        model_result=model_result,
        evidence=evidence,
    )
    db.update("plantAnalyses", analysis_id, {"observationId": observation["id"]})
    if field:
        recompute_field_activity(field["id"])
    return {"observation": observation, "analysis": db.fetch_one("plantAnalyses", analysis_id)}


@router.get("/plant-analyses")
def list_plant_analyses() -> dict[str, Any]:
    items = db.fetch_all("plantAnalyses", order="createdAt DESC")
    for item in items:
        item["imageUrl"] = f"/api/uploads/{item['imagePath']}" if item.get("imagePath") else None
    return {"analyses": items, "count": len(items)}


# --------------------------------------------------------- acoustic intelligence
@router.post("/analyse-audio")
async def analyse_audio(
    file: UploadFile = File(...),
    fieldId: str = Form(""),
    source: str = Form("upload"),
) -> dict[str, Any]:
    data = await _read_upload(file, MAX_AUDIO_BYTES, "audio")
    field = db.fetch_one("fields", fieldId) if fieldId else None
    try:
        result = audio_model.analyse(data, source=source or "upload")
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from None

    features = result.get("features") or {}
    record = {
        "id": f"AUD-{uuid.uuid4().hex[:6].upper()}",
        "fieldId": (field or {}).get("id") or None,
        "fieldName": (field or {}).get("name") or "",
        "source": result.get("source", source),
        "fileName": file.filename or "",
        "durationSec": result.get("durationSec", 0),
        "predictedClass": result.get("predictedClass"),
        "label": result.get("label"),
        "confidence": result.get("confidence"),
        "engine": result.get("engine"),
        "isTrainedModel": bool(result.get("isTrainedModel")),
        "clarityScore": result.get("features", {}).get("clarityScore"),
        "features": {k: v for k, v in features.items() if k != "envelope"},
        "topK": result.get("topK") or [],
        "observationId": None,
        "createdAt": _now(),
    }
    db.insert("audioAnalyses", record)

    return {
        "analysis": {**record, "envelope": features.get("envelope", [])},
        "result": result,
        "modelStatus": audio_model.status(),
    }


class AudioObservationRequest(BaseModel):
    fieldId: str | None = None
    severity: str | None = None
    notes: str = ""


THREAT_SEVERITY = {"elevated": "elevated", "moderate": "moderate", "low": "low", "none": "low"}


@router.post("/audio-analyses/{analysis_id}/observation", status_code=201)
def audio_analysis_to_observation(analysis_id: str, payload: AudioObservationRequest) -> dict[str, Any]:
    analysis = db.fetch_one("audioAnalyses", analysis_id)
    if not analysis:
        raise HTTPException(404, "Acoustic analysis not found")
    if analysis.get("observationId"):
        raise HTTPException(409, "This analysis is already linked to an observation")

    field_id = payload.fieldId or analysis.get("fieldId")
    field = db.fetch_one("fields", field_id) if field_id else None
    features = analysis.get("features") or {}
    catalog = audio_model.CATALOG.get(analysis.get("predictedClass") or "", {})

    # Re-read the catalogue entry for label-driven analyses of a trained model.
    relevance = catalog.get("threatRelevance") or "unknown"
    is_threat_signal = relevance in {"elevated", "moderate"} or bool(payload.severity)
    severity = payload.severity or THREAT_SEVERITY.get(relevance, "low")

    evidence = {
        "audio": {
            "durationSec": analysis.get("durationSec"),
            "clarityScore": features.get("clarityScore"),
            "claritySummary": audio_model._clarity_summary(features.get("clarityScore") or 0.0),
            "engine": analysis.get("engine"),
            "source": analysis.get("source"),
            "retained": False,
            "retainRequested": False,
            "bands": features.get("bands"),
        },
        "independentConfirmations": 0,
        "independentSources": [],
    }
    model_result = {
        "predictedClass": analysis.get("predictedClass"),
        "label": analysis.get("label"),
        "confidence": analysis.get("confidence"),
        "engine": analysis.get("engine"),
        "isTrainedModel": bool(analysis.get("isTrainedModel")),
        "topK": analysis.get("topK") or [],
    }

    observation = create_observation(
        field_id=field_id,
        feature="acoustic_intelligence",
        category="threat" if is_threat_signal else "acoustic",
        title=f"Acoustic report — {analysis.get('label')}",
        description=(
            (payload.notes + " " if payload.notes else "")
            + f"{analysis.get('durationSec')}s clip classified as “{analysis.get('label')}” "
            f"({analysis.get('engine')}). "
            + (
                "Classification from the trained FIELDZY sound classifier; a sound by itself does not prove a threat."
                if analysis.get("isTrainedModel")
                else "Classification from FIELDZY screening rules; a sound by itself does not prove a threat."
            )
        ),
        severity=severity,
        model_result=model_result,
        evidence=evidence,
    )
    db.update("audioAnalyses", analysis_id, {"observationId": observation["id"]})
    record_transmission(
        observation,
        "Acoustic analysis linked to an observation",
        "synced",
        "Evidence validation applied to the acoustic finding.",
    )
    if field:
        recompute_field_activity(field["id"])
    return {"observation": observation, "analysis": db.fetch_one("audioAnalyses", analysis_id)}


@router.get("/audio-analyses")
def list_audio_analyses() -> dict[str, Any]:
    items = db.fetch_all("audioAnalyses", order="createdAt DESC")
    observations = {o["id"]: o for o in db.fetch_all("observations")}
    for item in items:
        obs = observations.get(item.get("observationId") or "")
        item["observationStatus"] = obs["status"] if obs else None
        item["observationTitle"] = obs["title"] if obs else None
    return {"analyses": items, "count": len(items), "modelStatus": audio_model.status()}


# --------------------------------------------------------------- soil moisture
class SoilReadingRequest(BaseModel):
    fieldId: str
    moisture: float = Field(ge=0, le=100)
    createObservation: bool = True
    notes: str = ""


@router.get("/soil/readings")
def list_soil_readings(fieldId: str | None = None) -> dict[str, Any]:
    if fieldId:
        readings = db.fetch_all("soilReadings", "fieldId = ?", (fieldId,), order="createdAt ASC")
    else:
        readings = db.fetch_all("soilReadings", order="createdAt ASC")
    return {
        "readings": readings,
        "source": "simulated",
        "note": (
            "No physical soil sensor is connected to this deployment. Every reading here is a simulated "
            "probe value and is labelled as such wherever it appears."
        ),
    }


@router.post("/soil/readings", status_code=201)
def add_soil_reading(payload: SoilReadingRequest) -> dict[str, Any]:
    field = db.fetch_one("fields", payload.fieldId)
    if not field:
        raise HTTPException(404, "Field not found")

    low, critical = field["soilThresholdLow"], field["soilThresholdCritical"]
    condition = "critical" if payload.moisture <= critical else "low" if payload.moisture <= low else "adequate"
    reading_id = f"SOIL-{uuid.uuid4().hex[:6].upper()}"
    created = _now()

    observation = None
    if payload.createObservation and condition in {"low", "critical"}:
        observation = create_observation(
            field_id=field["id"],
            feature="soil_moisture",
            category="soil",
            title=f"Soil moisture {condition} on {field['name']}",
            description=(
                (payload.notes + " " if payload.notes else "")
                + f"Simulated probe reading of {payload.moisture:.0f}% against a low threshold of {low:.0f}% "
                f"and a critical threshold of {critical:.0f}%. No physical sensor is installed on this field."
            ),
            severity="elevated" if condition == "critical" else "moderate",
            model_result={
                "predictedClass": "Critical moisture" if condition == "critical" else "Low moisture",
                "label": "Critical moisture" if condition == "critical" else "Low moisture",
                "confidence": None,
                "engine": "threshold_rules_v1",
                "isTrainedModel": False,
                "thresholdBased": True,
            },
            evidence={
                "readings": [
                    {
                        "label": "Volumetric moisture",
                        "value": payload.moisture,
                        "unit": "%",
                        "depthCm": 20,
                        "simulated": True,
                    }
                ],
                "sensorType": "simulated",
                "physicalSensorConfirmed": False,
                "independentConfirmations": 0,
            },
            context={
                "reading": payload.moisture,
                "threshold": low,
                "thresholdCritical": critical,
            },
        )

    record = {
        "id": reading_id,
        "fieldId": field["id"],
        "fieldName": field["name"],
        "moisture": payload.moisture,
        "thresholdLow": low,
        "thresholdCritical": critical,
        "condition": condition,
        "simulated": True,
        "observationId": (observation or {}).get("id"),
        "createdAt": created,
    }
    db.insert("soilReadings", record)
    if observation:
        db.update("soilReadings", reading_id, {"observationId": observation["id"]})
    recompute_field_activity(field["id"])
    return {
        "reading": record,
        "observation": observation,
        "condition": condition,
        "note": "Reading recorded from the simulated probe — not a physical sensor measurement.",
    }
