"""SQLite persistence for FIELDZY.

Deliberately dependency-free (stdlib sqlite3) so the platform boots anywhere.
API payloads use camelCase to match the existing frontend data contract
(``fieldId``, ``evidenceGaps``, ``syncStatus`` ...).
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .config import DB_PATH

JSON_COLUMNS = {
    "observations": {
        "modelResult",
        "validation",
        "evidence",
        "evidenceGaps",
        "qualityChecks",
        "reviewHistory",
    },
    "audioAnalyses": {"features", "topK"},
    "plantAnalyses": {"topK", "quality"},
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS fields (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    crop TEXT NOT NULL DEFAULT '',
    areaHa REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'stable',
    location TEXT NOT NULL DEFAULT '',
    latitude REAL,
    longitude REAL,
    soilThresholdLow REAL NOT NULL DEFAULT 35,
    soilThresholdCritical REAL NOT NULL DEFAULT 20,
    notes TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS observations (
    id TEXT PRIMARY KEY,
    fieldId TEXT,
    fieldName TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'manual',
    feature TEXT NOT NULL DEFAULT 'manual_observation',
    status TEXT NOT NULL DEFAULT 'unverified',
    syncStatus TEXT NOT NULL DEFAULT 'local_only',
    severity TEXT,
    confidence REAL,
    modelResult TEXT,
    validation TEXT,
    evidence TEXT,
    evidenceGaps TEXT,
    reviewStage TEXT NOT NULL DEFAULT 'evidence_collection',
    qualityChecks TEXT,
    reviewHistory TEXT,
    nextAction TEXT,
    isDemo INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transmissions (
    id TEXT PRIMARY KEY,
    observationId TEXT,
    observationTitle TEXT,
    event TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'saved_local',
    detail TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audioAnalyses (
    id TEXT PRIMARY KEY,
    fieldId TEXT,
    fieldName TEXT,
    source TEXT NOT NULL DEFAULT 'microphone',
    fileName TEXT NOT NULL DEFAULT '',
    durationSec REAL NOT NULL DEFAULT 0,
    predictedClass TEXT,
    label TEXT,
    confidence REAL,
    engine TEXT,
    isTrainedModel INTEGER NOT NULL DEFAULT 0,
    clarityScore REAL,
    features TEXT,
    topK TEXT,
    observationId TEXT,
    createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plantAnalyses (
    id TEXT PRIMARY KEY,
    fieldId TEXT,
    fieldName TEXT,
    fileName TEXT NOT NULL DEFAULT '',
    imagePath TEXT,
    predictedClass TEXT,
    label TEXT,
    confidence REAL,
    engine TEXT,
    isTrainedModel INTEGER NOT NULL DEFAULT 0,
    quality TEXT,
    topK TEXT,
    observationId TEXT,
    createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS debtSnapshots (
    id TEXT PRIMARY KEY,
    score INTEGER NOT NULL,
    gapTerm INTEGER NOT NULL,
    observationTerm INTEGER NOT NULL,
    unresolvedGaps INTEGER NOT NULL,
    unresolvedObservations INTEGER NOT NULL,
    trigger TEXT NOT NULL DEFAULT '',
    observationId TEXT,
    createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS soilReadings (
    id TEXT PRIMARY KEY,
    fieldId TEXT,
    fieldName TEXT,
    moisture REAL NOT NULL,
    thresholdLow REAL NOT NULL,
    thresholdCritical REAL NOT NULL,
    condition TEXT NOT NULL,
    simulated INTEGER NOT NULL DEFAULT 1,
    observationId TEXT,
    createdAt TEXT NOT NULL
);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _dumps(value: Any) -> str | None:
    if value is None:
        return None
    return json.dumps(value, separators=(",", ":"))


def _loads(value: Any, fallback: Any) -> Any:
    if value is None or value == "":
        return fallback
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return fallback


def get_connection(path: Path | str | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path or DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def db_cursor() -> Iterator[sqlite3.Connection]:
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    first_time = not Path(DB_PATH).exists()
    with db_cursor() as conn:
        conn.executescript(SCHEMA)
    if first_time:
        from .seed import seed_database

        seed_database()


def row_to_dict(table: str, row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    for key in JSON_COLUMNS.get(table, set()):
        if key in data:
            data[key] = _loads(data[key], [] if key.endswith("s") or key in {"evidenceGaps", "reviewHistory", "qualityChecks"} else None)
    if table == "observations":
        data["isDemo"] = bool(data.get("isDemo"))
    if table in {"audioAnalyses", "plantAnalyses"}:
        data["isTrainedModel"] = bool(data.get("isTrainedModel"))
    if table == "soilReadings":
        data["simulated"] = bool(data.get("simulated"))
    return data


def serialize_for_write(table: str, payload: dict[str, Any]) -> dict[str, Any]:
    out = dict(payload)
    for key in JSON_COLUMNS.get(table, set()):
        if key in out:
            out[key] = _dumps(out[key])
    if isinstance(out.get("isDemo"), bool):
        out["isDemo"] = int(out["isDemo"])
    for key in ("isTrainedModel", "simulated"):
        if isinstance(out.get(key), bool):
            out[key] = int(out[key])
    return out


def insert(table: str, payload: dict[str, Any]) -> dict[str, Any]:
    record = serialize_for_write(table, payload)
    columns = ", ".join(record.keys())
    placeholders = ", ".join("?" for _ in record)
    with db_cursor() as conn:
        conn.execute(f"INSERT INTO {table} ({columns}) VALUES ({placeholders})", list(record.values()))
    return payload


def update(table: str, record_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    if not payload:
        return fetch_one(table, record_id)
    record = serialize_for_write(table, payload)
    assignments = ", ".join(f"{key} = ?" for key in record)
    with db_cursor() as conn:
        conn.execute(f"UPDATE {table} SET {assignments} WHERE id = ?", [*record.values(), record_id])
    return fetch_one(table, record_id)


def fetch_one(table: str, record_id: str) -> dict[str, Any] | None:
    with db_cursor() as conn:
        row = conn.execute(f"SELECT * FROM {table} WHERE id = ?", (record_id,)).fetchone()
    return row_to_dict(table, row) if row else None


def fetch_all(table: str, where: str = "", params: tuple = (), order: str = "createdAt DESC") -> list[dict[str, Any]]:
    query = f"SELECT * FROM {table}"
    if where:
        query += f" WHERE {where}"
    if order:
        query += f" ORDER BY {order}"
    with db_cursor() as conn:
        rows = conn.execute(query, params).fetchall()
    return [row_to_dict(table, row) for row in rows]


def delete(table: str, record_id: str) -> bool:
    with db_cursor() as conn:
        cursor = conn.execute(f"DELETE FROM {table} WHERE id = ?", (record_id,))
    return cursor.rowcount > 0
