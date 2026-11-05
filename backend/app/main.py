"""FIELDZY API.

Run with:  uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import APP_NAME, APP_TAGLINE, UPLOADS_DIR
from .db import fetch_one, init_db
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


@app.get("/api/uploads/{name}")
def uploaded_file(name: str):
    path = UPLOADS_DIR / name
    if not path.exists():
        raise HTTPException(404, "File not found")
    return FileResponse(path)


@app.get("/")
def root() -> dict[str, str]:
    return {"app": APP_NAME, "tagline": APP_TAGLINE, "docs": "/docs", "api": "/api/health"}
