#!/usr/bin/env bash
# Install FIELDZY's backend and frontend dependencies.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ Backend virtual environment"
python3 -m venv backend/.venv
backend/.venv/bin/pip install --upgrade pip >/dev/null
backend/.venv/bin/pip install -r backend/requirements.txt

if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  echo "→ Created backend/.env from the example (add GEMINI_API_KEY when you have one)"
fi

echo "→ Frontend dependencies"
cd frontend && npm install
echo "✓ Ready. Run ./scripts/dev.sh"
