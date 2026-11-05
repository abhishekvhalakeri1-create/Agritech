#!/usr/bin/env bash
# Run the FIELDZY API and the Vite dev server together.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -x backend/.venv/bin/uvicorn ]; then
  echo "Backend dependencies missing — run ./scripts/setup.sh first." >&2
  exit 1
fi

# For a single-origin run instead: cd frontend && npm run build, then start
# uvicorn on :8000 alone — FastAPI serves the built app from backend/webapp.
backend/.venv/bin/uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT

cd frontend
npm run dev
