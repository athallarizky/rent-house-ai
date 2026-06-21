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


def update_password(email: str, password_hash: str) -> bool:
    conn = _conn()
    try:
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE email = ?",
            (password_hash, email),
        )
        conn.commit()
        return True
    finally:
        conn.close()


def list_users() -> list[dict]:
    conn = _conn()
    try:
        rows = conn.execute("SELECT id, email, role, created_at FROM users ORDER BY created_at").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_user_by_id(user_id: str) -> Optional[dict]:
    conn = _conn()
    try:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def create_user(email: str, password_hash: str, role: str = "user") -> Optional[dict]:
    import uuid
    from datetime import datetime

    conn = _conn()
    try:
        user_id = str(uuid.uuid4())
        created = datetime.utcnow().isoformat()
        conn.execute(
            "INSERT INTO users VALUES (?, ?, ?, ?, ?)",
            (user_id, email, password_hash, role, created),
        )
        conn.commit()
        return {"id": user_id, "email": email, "role": role, "created_at": created}
    except sqlite3.IntegrityError:
        return None
    finally:
        conn.close()


def update_user(user_id: str, email: str | None = None, role: str | None = None, password_hash: str | None = None) -> Optional[dict]:
    conn = _conn()
    try:
        sets: list[str] = []
        params: list = []
        if email is not None:
            sets.append("email = ?")
            params.append(email)
        if role is not None:
            sets.append("role = ?")
            params.append(role)
        if password_hash is not None:
            sets.append("password_hash = ?")
            params.append(password_hash)
        if not sets:
            return get_user_by_id(user_id)
        params.append(user_id)
        conn.execute(f"UPDATE users SET {', '.join(sets)} WHERE id = ?", params)
        conn.commit()
        return get_user_by_id(user_id)
    finally:
        conn.close()


def delete_user(user_id: str) -> bool:
    conn = _conn()
    try:
        cur = conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()
