"""FIELDZY API — also serves the built React app on the same origin.

Run with:  uvicorn app.main:app --host 0.0.0.0 --port 8000

Routes
------
/api/*            JSON API (docs at /docs)
/api/uploads/*    retained plant photographs
/*                the built single-page app from backend/webapp (if built)

The SPA is built with `cd frontend && npm run build`, which writes into
backend/webapp. If it has not been built, `/` returns a helpful JSON message
instead of a blank page; the dev workflow (`npm run dev` on :5173 with the
`/api` proxy) works without it.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import APP_NAME, APP_TAGLINE, FRONTEND_DIST, UPLOADS_DIR
from .db import init_db
from .routers import core, inference, system


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title=f"{APP_NAME} API", description=APP_TAGLINE, version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(core.router, prefix="/api", tags=["core"])
app.include_router(inference.router, prefix="/api", tags=["inference"])
app.include_router(system.router, prefix="/api", tags=["system"])

app.mount("/api/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

DIST = Path(FRONTEND_DIST)
INDEX = DIST / "index.html"

if (DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=str(DIST / "assets")), name="assets")


@app.get("/api/uploads/{name}")
def uploaded_file(name: str):
    path = UPLOADS_DIR / name
    if not path.exists():
        raise HTTPException(404, "File not found")
    return FileResponse(path)


@app.get("/")
def root():
    if INDEX.exists():
        return FileResponse(INDEX)
    return JSONResponse(
        {
            "app": APP_NAME,
            "tagline": APP_TAGLINE,
            "built_app": "not found",
            "detail": f"No build at {DIST}. Run `cd frontend && npm run build`, or use `npm run dev` on :5173.",
            "docs": "/docs",
            "api": "/api/health",
        }
    )


@app.get("/{full_path:path}")
def spa(full_path: str):
    """Client-side routes (/fields, /acoustic …) all resolve to index.html."""
    if full_path.startswith(("api/", "docs", "redoc", "openapi.json")):
        raise HTTPException(404, "Not found")
    candidate = (DIST / full_path).resolve()
    if DIST.resolve() in candidate.parents and candidate.is_file():
        return FileResponse(candidate)
    if INDEX.exists():
        return FileResponse(INDEX)
    raise HTTPException(404, "The FIELDZY app has not been built. Run `cd frontend && npm run build`.")
