# Phase 1 Report — Backend Auth Core

> Completed: 2026-06-20 | Sprint 4 — Auth & Authorization

---

## 1. Overview

Phase 1 membangun fondasi autentikasi backend: JWT utilities, SQLite users table,
endpoint login/me, dan seed admin otomatis. Semua endpoint `/auth/*` sudah berfungsi —
login mengembalikan JWT, `/me` memvalidasi token dan mengembalikan info user.

```
POST /auth/login  ──►  validate email+password (bcrypt)
                       └── return JWT (HS256, 24h expiry)

GET /auth/me      ──►  decode Bearer token → lookup user → return email+role

Startup event     ──►  seed_admin() → admin@kos.ai (if no users exist)
```

---

## 2. How to Run

```bash
cd api && python3 -m uvicorn src.main:app --port 8080 --reload
```

```bash
# Login
curl -s -X POST http://localhost:8080/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@kos.ai","password":"admin123"}'
# → {"token": "eyJ...", "user": {"email":"admin@kos.ai","role":"admin"}}

# Get current user
TOKEN="<token dari login>"
curl -s http://localhost:8080/auth/me -H "Authorization: Bearer $TOKEN"
# → {"email":"admin@kos.ai","role":"admin"}

# Without token
curl -s http://localhost:8080/auth/me
# → 401 {"detail":"Not authenticated"}

# Wrong password
curl -s -X POST http://localhost:8080/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@kos.ai","password":"wrong"}'
# → 401 {"detail":"Email atau password salah"}
```

---

## 3. Changes

### 3a. Dependencies — `api/pyproject.toml`

Menambahkan 3 dependency:

```toml
"python-jose[cryptography]>=3.3",
"passlib[bcrypt]>=1.7",
"bcrypt==4.0.1",
```

**Catatan:** `bcrypt` di-pin ke `4.0.1` karena `passlib 1.7.4` tidak kompatibel
dengan `bcrypt >= 5.0`. `pip install passlib[bcrypt]` menarik `bcrypt==5.0.0`
yang menyebabkan `ValueError` saat `hash_password()`. RCA detail di §5.

### 3b. `api/src/auth.py` (NEW — 67 lines)

JWT + password utilities:

- `hash_password()` / `verify_password()` — bcrypt via passlib
- `create_access_token()` / `decode_token()` — JWT HS256, 24h expiry
- `get_current_user()` — FastAPI dependency, decode Bearer token → lookup user
- `require_admin()` — FastAPI dependency, asserts role == "admin"

`HTTPBearer(auto_error=False)` digunakan agar endpoint yang tidak membutuhkan auth
(seperti `/health`) tidak otomatis error. Tanpa token → `credentials` None →
`get_current_user` raise 401.

### 3c. `api/src/users.py` (NEW — 56 lines)

SQLite user management:

- `_conn()` — buka `data/auth.db`, auto-create tabel `users` kalau belum ada
- `seed_admin()` — insert `admin@kos.ai` / `admin123` kalau tabel kosong
- `get_user_by_email()` — lookup user by email, return dict atau None

Tabel `users`:
```sql
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL
)
```

### 3d. `api/src/auth_routes.py` (NEW — 27 lines)

Auth endpoints:

- `POST /auth/login` — validasi email+password, return JWT + user info
- `GET /auth/me` — return `{"email", "role"}` dari token (requires auth)

### 3e. `api/src/main.py` (MODIFIED)

```python
from .auth_routes import router as auth_router
from .users import seed_admin

app.include_router(auth_router)

@app.on_event("startup")
async def startup():
    seed_admin()
```

Router auth diregister di prefix `/auth`. `seed_admin()` jalan setiap startup —
idempoten, hanya insert kalau tabel kosong.

### 3f. `.gitignore` (MODIFIED)

Menambahkan `data/auth.db` di bawah `data/search_history.db`.

---

## 4. Verification

| Check | Result |
|-------|--------|
| Python AST parse (`auth.py`) | OK |
| Python AST parse (`users.py`) | OK |
| Python AST parse (`auth_routes.py`) | OK |
| Python AST parse (`main.py`) | OK |
| `POST /auth/login` (valid) | `200 {"token":"...","user":{"email":"admin@kos.ai","role":"admin"}}` |
| `POST /auth/login` (wrong password) | `401 {"detail":"Email atau password salah"}` |
| `POST /auth/login` (unknown email) | `401 {"detail":"Email atau password salah"}` |
| `GET /auth/me` (with valid token) | `200 {"email":"admin@kos.ai","role":"admin"}` |
| `GET /auth/me` (without token) | `401 {"detail":"Not authenticated"}` |
| `GET /health` (without token) | `200 {"status":"ok","version":"0.1.0"}` |
| `git check-ignore data/auth.db` | Matched by `.gitignore:17` |
| `git ls-files data/auth.db` | (not tracked) |
| `npm run check` | 0 errors / 0 warnings / 0 hints |
| Second startup (re-seed) | No duplicate — idempotent |

---

## 5. Findings / Notes

| Item | Detail |
|------|--------|
| **RCA-017: passlib + bcrypt 5.x incompatibility** | `pip install passlib[bcrypt]` menarik `bcrypt==5.0.0` yang mengubah API internal (`__about__` hilang, `hashpw` behavior beda). Fix: pin `bcrypt==4.0.1` di `pyproject.toml`. RCA detail di `docs/sprint-4/rca/rca-017-passlib-bcrypt5.md`. |
| **HTTPBearer auto_error=False** | Penting — kalau `auto_error=True` (default), semua request tanpa `Authorization` header akan otomatis 403, termasuk `/health` yang harus tetap open. |
| **Startup seed idempoten** | `seed_admin()` cek `COUNT(*)` dulu, jadi aman dipanggil setiap restart. Tidak bakal double-insert. |
| **JWT_SECRET default** | `"kos-ai-secret-change-in-production"` — hardcoded, bisa di-override via env `JWT_SECRET`. Production wajib ganti. |

---

## 6. Reference Files

| File | Purpose |
|------|---------|
| `api/pyproject.toml` | Dependencies (python-jose, passlib, bcrypt pin) |
| `api/src/auth.py` | JWT + hash + `get_current_user` + `require_admin` |
| `api/src/users.py` | SQLite users table + `seed_admin` |
| `api/src/auth_routes.py` | `POST /auth/login`, `GET /auth/me` |
| `api/src/main.py` | Auth router registration + startup seed |
| `.gitignore` | `data/auth.db` entry |

> **Ref:** `docs/sprint-4/tasks.md` — Phase 1 task tracking
> **Ref:** `docs/sprint-4/AGENTS.md` — Full implementation guide
