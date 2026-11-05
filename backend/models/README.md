# Trained artefacts

FIELDZY loads trained models **if they are present** and reports honestly when
they are not. Nothing in the codebase fabricates a trained-model prediction.

```
backend/models/
├── plant/
│   ├── fieldzy_savedmodel/      # TensorFlow SavedModel directory (serving_default)
│   │   ├── saved_model.pb
│   │   └── variables/
│   └── class_names.json         # label order for the SavedModel output
└── audio/
    ├── fieldzy_sound_model.pkl  # joblib classifier trained on YAMNet embeddings
    └── yamnet/                  # optional local copy of https://tfhub.dev/google/yamnet/1
```

## Plant disease (`POST /api/predict-plant`)

1. `tensorflow.saved_model.load(<PLANT_MODEL_DIR>)` → signature `serving_default`.
2. Labels from `class_names.json` (a list, `{"class_names": [...]}`, or an
   index→label map).
3. Input shape is read from the signature; images are resized to it.

If the directory or TensorFlow is missing, the engine falls back to
`screening_rules_v1` (colour/texture/lesion rules) and the evidence engine
attaches a `MODEL_ARTIFACT_NOT_INSTALLED` gap to every observation it produces.

## Acoustic intelligence (`POST /api/analyse-audio`)

1. PCM WAV is decoded and resampled to 16 kHz mono.
2. `yamnet` from TensorFlow Hub (or `FIELDZY_YAMNET_DIR`) produces embeddings.
3. Embeddings are pooled and passed to `fieldzy_sound_model.pkl` (joblib).
4. Labels come from `classifier.classes_` — **the classifier defines the class
   set**, not YAMNet's 521 AudioSet classes.

YAMNet alone is not a custom agricultural threat detector, and FIELDZY never
presents it as one. When the classifier or YAMNet is missing, results are
labelled `screening_rules_v1` and marked as untrained.

## Installing

```bash
cd backend
pip install "tensorflow>=2.16" "tensorflow-hub>=0.16"   # optional, large
# then copy your artefacts into backend/models/plant and backend/models/audio
```

`GET /api/model-status` always reports which engine is live, the exact paths it
looked for, and the reason a model is unavailable.
