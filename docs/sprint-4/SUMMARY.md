# Sprint 4 Summary — Authentication & Authorization

> **Status:** ⬜ Pending | Created 2026-06-20
> **Handoff:** [`AGENTS.md`](./AGENTS.md)

---

## 1. Goal

Add authentication and role-based access control to Kos AI:

- **Login page** (`/login`) with email + password
- **JWT-based auth** (python-jose + passlib/bcrypt)
- **2 roles:** admin (full access + settings) and user (search only)
- **Protected endpoints:** settings (admin only), search (authenticated)
- **Seed admin:** `admin@kos.ai` / `admin123` on first run

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────┐
│ Frontend (Astro + React)                             │
│  /login  →  LoginForm.tsx  →  POST /auth/login      │
│  /search →  ChatInterface (protected)               │
│  /settings → ProviderSettings (admin only)          │
│  auth.ts: localStorage token + auth headers         │
└──────────────────────┬──────────────────────────────┘
                       │  Authorization: Bearer <JWT>
┌──────────────────────▼──────────────────────────────┐
│ Backend (FastAPI :8080)                              │
│  api/src/auth.py      — JWT + hash + dependencies   │
│  api/src/users.py     — SQLite users + seed admin   │
│  api/src/auth_routes.py — POST /auth/login, /me     │
│  data/auth.db (gitignored)                           │
└─────────────────────────────────────────────────────┘
```

---

## 3. All Phases

| Phase | Status | Description |
|-------|--------|-------------|
| 1 — Backend Auth Core | ⬜ | JWT, password hash, SQLite users, login/me endpoints |
| 2 — Protect Endpoints | ⬜ | Add auth deps to settings (admin), search (user) |
| 3 — Login Page | ⬜ | Astro login page + React form |
| 4 — Frontend Integration | ⬜ | Auth headers, sidebar, protected routes |
| 5 — Polish | ⬜ | Token expiry, error states, admin password change |

---

## 4. Tech Stack

| Layer | Tech |
|-------|------|
| JWT | `python-jose[cryptography]` |
| Password hash | `passlib[bcrypt]` |
| User DB | SQLite `data/auth.db` |
| Token storage (FE) | `localStorage` |
| Auth state (FE) | `useState` + localStorage helpers |

---

## 5. Key Decisions

- **localStorage over HttpOnly cookie** — simpler for MVP SPA, no CSRF concerns for API-only client
- **Single JWT_SECRET** — env var override for production
- **No refresh tokens** — 24h access token, simple re-login on expiry
- **No registration UI** — admin seeded, users added via backend/CLI for MVP
