# AGENTS.md — Sprint 4 Implementation Guide (Auth & Authz)

> **For:** Any LLM agent implementing Auth for Kos AI.
> **Context:** Sprint 3 complete. App works end-to-end. This sprint adds authentication,
> authorization, and role-based access control.

---

## 0. Current State

Sprint 3 shipped 9 phases. App has:
- Full kos search dashboard (3-panel: saved searches, chat, results)
- RAG/AI mode toggle, POI geocoding, follow-up chat, price filtering
- Settings page for LLM key/model (currently unprotected — anyone can change)
- All endpoints open (no auth)

**Key files to know:**
```
api/src/main.py          — FastAPI entry, CORS, routers
api/src/settings.py      — GET/PUT /settings (unprotected)
web/src/pages/           — /, /search, /settings
web/src/layouts/         — DashboardLayout.astro (sidebar nav)
web/src/lib/api.ts       — API client
web/src/components/ProviderSettings.tsx — LLM settings form
```

---

## 1. Requirements

### 1a. Auth
- Login page (`/login`) with email + password
- JWT-based authentication
- Token stored in localStorage (sent as `Authorization: Bearer <token>`)
- Logout button in sidebar/dashboard header

### 1b. Roles (2)
| Role | Permissions |
|------|-------------|
| **admin** | Full access — search, settings (change LLM key/model), manage users |
| **user** | Search only — cannot access settings page, cannot change LLM config |

### 1c. Protected Endpoints
- `PUT /settings`, `POST /settings/test` → admin only
- `POST /search`, `POST /area/load`, etc. → authenticated user

### 1d. Seeding
- On first run, create default admin: `admin@kos.ai` / `admin123`
- Admin can be changed via settings or direct DB edit

---

## 2. Tech Stack (EXACT)

| Layer | Tech | Notes |
|-------|------|-------|
| Auth library | `python-jose[cryptography]` | JWT encode/decode |
| Password hash | `passlib[bcrypt]` | bcrypt hashing |
| Token storage (FE) | `localStorage` | Simple, no HttpOnly cookie for MVP |
| State (FE) | React `useState` + `Context` | Consistent with existing conventions |
| DB | SQLite `data/auth.db` | Users table, gitignored |
| Pages | Astro | `/login` (new), `/search`, `/settings` (protected) |

**Do NOT add:** Redis, OAuth, SSO, email verification, password reset — MVP scope.

---

## 3. Backend Implementation

### 3a. `api/src/auth.py` — JWT + password utilities (NEW)

```python
"""JWT auth utilities — token creation, verification, password hashing."""

import os
from datetime import datetime, timedelta
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

SECRET_KEY = os.environ.get("JWT_SECRET", "kos-ai-secret-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None
```

### 3b. `api/src/users.py` — SQLite users table (NEW)

```python
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
```

### 3c. FastAPI Dependencies — `get_current_user` + `require_admin`

Add to `api/src/auth.py`:

```python
async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(credentials.credentials)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    from .users import get_user_by_email
    user = get_user_by_email(payload["sub"])
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin required")
    return user
```

### 3d. `api/src/auth_routes.py` — Login/Me endpoints (NEW)

```python
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from .auth import verify_password, create_access_token, get_current_user
from .users import get_user_by_email, seed_admin

router = APIRouter(prefix="/auth", tags=["auth"])

class LoginRequest(BaseModel):
    email: str
    password: str

@router.post("/login")
async def login(req: LoginRequest):
    user = get_user_by_email(req.email)
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(401, "Email atau password salah")
    token = create_access_token({"sub": user["email"], "role": user["role"]})
    return {"token": token, "user": {"email": user["email"], "role": user["role"]}}

@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return {"email": user["email"], "role": user["role"]}
```

### 3e. Protect existing routes

**`api/src/settings.py`** — add `Depends(require_admin)`:

```python
from .auth import require_admin

@router.put("")
async def save_settings(req: SettingsUpdate, user: dict = Depends(require_admin)):
    ...

@router.post("/test")
async def test_connection(req: TestRequest, user: dict = Depends(require_admin)):
    ...
```

**`api/src/search.py`, `api/src/searches.py`, etc.** — add `Depends(get_current_user)`:

```python
from .auth import get_current_user

@router.post("/search")
async def search(req: SearchRequest, user: dict = Depends(get_current_user)):
    ...
```

### 3f. Register routes in `main.py`

```python
from .auth_routes import router as auth_router
from .users import seed_admin

@app.on_event("startup")
async def startup():
    seed_admin()

app.include_router(auth_router)
```

---

## 4. Frontend Implementation

### 4a. `web/src/lib/auth.ts` — Auth client (NEW)

```typescript
const AUTH_KEY = "kos-ai.auth";

interface AuthUser {
  email: string;
  role: "admin" | "user";
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
}

export function getAuth(): AuthState {
  if (typeof localStorage === "undefined") return { token: null, user: null };
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? JSON.parse(raw) : { token: null, user: null };
  } catch {
    return { token: null, user: null };
  }
}

export function setAuth(token: string, user: AuthUser) {
  localStorage.setItem(AUTH_KEY, JSON.stringify({ token, user }));
}

export function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
}

export function getAuthHeaders(): Record<string, string> {
  const auth = getAuth();
  return auth.token ? { Authorization: `Bearer ${auth.token}` } : {};
}

export async function login(email: string, password: string): Promise<AuthState> {
  const resp = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(err.detail || "Login failed");
  }
  const data = await resp.json();
  setAuth(data.token, data.user);
  return { token: data.token, user: data.user };
}

export async function logout() {
  clearAuth();
  window.location.href = "/login";
}
```

### 4b. `web/src/pages/login.astro` — Login page (NEW)

Pure Astro page with client-side React island for the login form.

### 4c. `web/src/components/LoginForm.tsx` — Login form (NEW)

Email + password inputs, submit calls `login()`, redirects to `/search` on success.

### 4d. Protected middleware (Astro)

Add auth check in Astro pages or via client-side redirect in components.

### 4e. Sidebar updates

- Add "Logout" button in `DashboardLayout.astro`
- Hide "Pengaturan" nav item for non-admin users
- Show user email/role indicator

### 4f. API client updates

All `fetch()` calls in `web/src/lib/api.ts` should include auth headers:

```typescript
import { getAuthHeaders } from "./auth";

// In each fetch:
fetch(url, {
  headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
  ...
})
```

---

## 5. File Structure (to create/modify)

### Create:
```
api/src/auth.py          — JWT + password utils, get_current_user, require_admin
api/src/users.py         — SQLite users table, seed_admin
api/src/auth_routes.py   — POST /auth/login, GET /auth/me
web/src/pages/login.astro     — Login page route
web/src/components/LoginForm.tsx — Login form island
web/src/lib/auth.ts      — Auth client (login, logout, token storage)
data/auth.db             — SQLite DB (gitignored, auto-created)
```

### Modify:
```
api/src/main.py          — Register auth router, startup seed
api/src/settings.py      — Protect with require_admin
api/src/search.py        — Protect with get_current_user
api/src/searches.py      — Protect with get_current_user
web/src/lib/api.ts       — Add auth headers to all requests
web/src/layouts/DashboardLayout.astro — Logout button, hide admin links
web/src/pages/settings.astro — Redirect if not admin
```

---

## 6. Implementation Order

| Phase | Tasks | Est. |
|-------|-------|------|
| 1 — Backend Auth Core | `auth.py`, `users.py`, `auth_routes.py`, seed admin | 2h |
| 2 — Protect Endpoints | Add Depends to settings, search, searches | 1h |
| 3 — Login Page | `login.astro`, `LoginForm.tsx`, `auth.ts` client | 2h |
| 4 — Frontend Integration | Auth headers in api.ts, sidebar updates, redirects | 1.5h |
| 5 — Polish | Logout UX, error states, token expiry handling | 1h |

---

## 7. Conventions (Sprint 3 carry-over)

- `npm run check` → 0/0/0; `npm run build` → OK
- Every Python file AST parse
- React `useState` only, native `fetch`
- No credentials committed (auth.db gitignored)
- RCA per non-trivial bug

---

## 8. Security Notes

- `JWT_SECRET` default is weak — document that production needs env var
- Password hashed with bcrypt (passlib)
- Token in localStorage (not HttpOnly cookie) — acceptable for MVP
- Admin seed password should be changed on first login (future)
