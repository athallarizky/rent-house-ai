"""GET/POST/DELETE /searches — saved search history (SQLite).

Persisted to data/search_history.db (single-user, local MVP). Schema matches
docs/sprint-2/architecture.md §8.
"""

import sqlite3
import uuid as _uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent.parent
DB_PATH = ROOT / "data" / "search_history.db"

router = APIRouter(prefix="/searches", tags=["searches"])


class SavedSearch(BaseModel):
    id: Optional[str] = None
    query_text: str
    area: str
    result_count: int = 0
    created_at: Optional[str] = None  # ISO 8601 from client


def _conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS saved_searches (
            id TEXT PRIMARY KEY,
            query_text TEXT NOT NULL,
            area TEXT NOT NULL,
            result_count INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    return conn


@router.get("")
async def list_searches():
    """Return all saved searches, newest first."""
    conn = _conn()
    try:
        rows = conn.execute(
            "SELECT id, query_text, area, result_count, created_at "
            "FROM saved_searches ORDER BY created_at DESC"
        ).fetchall()
    finally:
        conn.close()
    return {"searches": [dict(r) for r in rows]}


@router.post("")
async def save_search(req: SavedSearch):
    """Insert a saved search. Generates id/created_at if the client didn't."""
    now = datetime.utcnow().isoformat() + "Z"
    sid = req.id or str(_uuid.uuid4())
    created = req.created_at or now
    conn = _conn()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO saved_searches "
            "(id, query_text, area, result_count, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (sid, req.query_text, req.area, req.result_count, created, now),
        )
        conn.commit()
    finally:
        conn.close()
    return {
        "id": sid,
        "query_text": req.query_text,
        "area": req.area,
        "result_count": req.result_count,
        "created_at": created,
    }


@router.delete("/{search_id}")
async def delete_search(search_id: str):
    conn = _conn()
    try:
        conn.execute("DELETE FROM saved_searches WHERE id = ?", (search_id,))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True, "deleted": search_id}


@router.delete("")
async def delete_all_searches():
    conn = _conn()
    try:
        cur = conn.execute("DELETE FROM saved_searches")
        conn.commit()
        deleted = cur.rowcount
    finally:
        conn.close()
    return {"ok": True, "deleted_count": deleted}
