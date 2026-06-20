# Phase 2 Report — Protect Backend Endpoints

> Completed: 2026-06-20 | Sprint 4 — Auth & Authorization

---

## 1. Overview

Phase 2 menambahkan dependency injection `get_current_user` dan `require_admin`
ke seluruh endpoint yang perlu diproteksi. Endpoint publik (`/health`, `/locations/*`,
`/poi/resolve`, `/settings/models`) tetap open.

```
                     ┌── require_admin ── PUT /settings, POST /settings/test
get_current_user ────┤
                     └── get_current_user ── GET /settings, POST /search,
                                              POST /area/load, */searches,
                                              POST /intent

(tanpa auth) ───────── GET /health, GET /health/services,
                       GET /locations/*, POST /poi/resolve,
                       POST /settings/models
```

---

## 2. Changes

### 2a. `api/src/settings.py`

| Endpoint | Protection | Detail |
|----------|-----------|--------|
| `GET /settings` | `get_current_user` | User biasa bisa lihat provider/model (masked key) |
| `PUT /settings` | `require_admin` | Hanya admin bisa ganti API key/model |
| `POST /settings/test` | `require_admin` | Hanya admin bisa test koneksi LLM |
| `POST /settings/models` | *(open)* | List model Z.AI tetap publik |

### 2b. `api/src/search.py`

| Endpoint | Protection |
|----------|-----------|
| `POST /search` | `get_current_user` |
| `POST /area/load` | `get_current_user` |

### 2c. `api/src/searches.py`

| Endpoint | Protection |
|----------|-----------|
| `GET /searches` | `get_current_user` |
| `POST /searches` | `get_current_user` |
| `DELETE /searches/{id}` | `get_current_user` |
| `DELETE /searches` (bulk) | `get_current_user` |

### 2d. `api/src/intent.py`

| Endpoint | Protection |
|----------|-----------|
| `POST /intent` | `get_current_user` |

---

## 3. Verification

### Protected Endpoints (tanpa token → 401)

| # | Endpoint | Expected | Result |
|---|----------|----------|--------|
| 1 | `GET /settings` | 401 | ✅ 401 |
| 2 | `PUT /settings` | 401 | ✅ 401 |
| 3 | `POST /search` | 401 | ✅ 401 |
| 4 | `POST /searches` | 401 | ✅ 401 |
| 5 | `GET /searches` | 401 | ✅ 401 |
| 6 | `POST /intent` | 401 | ✅ 401 |

### Role-Based Access

| # | Scenario | Expected | Result |
|---|----------|----------|--------|
| 7 | Admin `PUT /settings` | 200 | ✅ 200 |
| 8 | User `PUT /settings` | 403 (Admin required) | ✅ 403 |
| 9 | User `POST /search` | 200 | ✅ 200 |
| 10 | User `GET /settings` | 200 | ✅ 200 |

### Open Endpoints (tanpa token → 200)

| # | Endpoint | Expected | Result |
|---|----------|----------|--------|
| 11 | `GET /health` | 200 | ✅ 200 |
| 12 | `GET /locations/resolve?q=bandung` | 200 | ✅ 200 |
| 13 | `POST /poi/resolve` | 200 | ✅ 200 |
| 14 | `POST /settings/models` | 200 | ✅ 200 |

### Build Check

| Check | Result |
|-------|--------|
| Python AST (`settings.py`, `search.py`, `searches.py`, `intent.py`) | OK |
| `npm run check` | 0/0/0 |

---

## 4. Findings / Notes

| Item | Detail |
|------|--------|
| **User seed manual** | User `user@kos.ai` / `user123` dibuat manual via Python script untuk test role authorization. Belum ada endpoint registrasi — sesuai scope MVP. |
| **`/settings/models` open** | Endpoint ini hanya return list model ID Z.AI, tidak membocorkan secret. Tetap open untuk memudahkan landing page / form settings. |
| **`POST /search` user OK** | User bisa search — role hanya membatasi akses ke settings write, bukan fungsionalitas core. |

---

## 5. Reference Files

| File | Change |
|------|--------|
| `api/src/settings.py` | Import `get_current_user`, `require_admin`; add `Depends` to GET/PUT/POST test |
| `api/src/search.py` | Import `get_current_user`; add `Depends` to POST /search, POST /area/load |
| `api/src/searches.py` | Import `get_current_user`; add `Depends` to all 4 endpoints |
| `api/src/intent.py` | Import `get_current_user`; add `Depends` to POST /intent |

> **Ref:** `docs/sprint-4/tasks.md` — Phase 2 task tracking
> **Ref:** `docs/sprint-4/AGENTS.md` — §3e Protect existing routes
