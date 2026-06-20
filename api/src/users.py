"""User management — SQLite-backed CRUD for auth."""

import sqlite3
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent.parent
DB_PATH = ROOT / "data" / "auth.db"

def _conn():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            created_at TEXT NOT NULL
        )
    """)
    return conn


def seed_admin():
    """Create default admin if no users exist."""
    from .auth import hash_password
    import uuid
    from datetime import datetime

    conn = _conn()
    try:
        count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        if count == 0:
            conn.execute(
                "INSERT INTO users VALUES (?, ?, ?, ?, ?)",
                (str(uuid.uuid4()), "admin@kos.ai", hash_password("admin123"), "admin", datetime.utcnow().isoformat()),
            )
            conn.commit()
    finally:
        conn.close()


def get_user_by_email(email: str) -> Optional[dict]:
    conn = _conn()
    try:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()
