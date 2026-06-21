# Sprint 4 — Authentication & Authorization

> Status: ✅ Completed | Created: 2026-06-20
>
> **Mission:** Add login, JWT auth, and role-based access control.
> Admin can manage LLM config; users can search only.
>
> **Ref:** [`AGENTS.md`](./AGENTS.md) — full implementation guide
>
> Status legend: ⬜ pending | 🔵 in_progress | ✅ completed | ❌ blocked

---

## Phase 1 — Backend Auth Core ✅

> JWT utilities, SQLite users table, login/me endpoints, seed admin.

| ID   | Task | Difficulty | Status |
|------|------|-----------|--------|
| 1.1  | Create `api/src/auth.py` — JWT, password hash, `get_current_user`, `require_admin` | Medium | ✅ |
| 1.2  | Create `api/src/users.py` — SQLite users table, `seed_admin` | Easy | ✅ |
| 1.3  | Create `api/src/auth_routes.py` — `POST /auth/login`, `GET /auth/me` | Medium | ✅ |
| 1.4  | Register routes in `main.py` + startup seed | Easy | ✅ |

---

## Phase 2 — Protect Backend Endpoints ✅

> Add auth dependencies to existing routes.

| ID   | Task | Difficulty | Status |
|------|------|-----------|--------|
| 2.1  | Protect `PUT /settings`, `POST /settings/test` with `require_admin` | Easy | ✅ |
| 2.2  | Protect `POST /search`, `POST /area/load`, `*/searches`, `*/intent` with `get_current_user` | Easy | ✅ |
| 2.3  | Open: `GET /health`, `GET /health/services`, `GET /locations/*`, `POST /poi/resolve` | Easy | ✅ |

---

## Phase 3 — Login Page ✅

> Astro page + React login form.

| ID   | Task | Difficulty | Status |
|------|------|-----------|--------|
| 3.1  | Create `web/src/pages/login.astro` — full-screen login page | Easy | ✅ |
| 3.2  | Create `web/src/components/LoginForm.tsx` — email + password form | Medium | ✅ |
| 3.3  | Create `web/src/lib/auth.ts` — auth client (login, logout, token) | Medium | ✅ |

---

## Phase 4 — Frontend Integration ✅

> Wire auth into existing pages and components.

| ID   | Task | Difficulty | Status |
|------|------|-----------|--------|
| 4.1  | Update `web/src/lib/api.ts` — add `Authorization` header to all requests | Easy | ✅ |
| 4.2  | Update `DashboardLayout.astro` — logout button, hide admin nav for users | Medium | ✅ |
| 4.3  | Protect `/search` and `/settings` pages — redirect to login if not authenticated | Medium | ✅ |
| 4.4  | Hide `ProviderSettings` for non-admin users (read-only view) | Easy | ✅ |

---

## Phase 5 — Polish ✅

> Edge cases, error handling, UX.

| ID   | Task | Difficulty | Status |
|------|------|-----------|--------|
| 5.1  | Token expiry handling — auto-logout or refresh | Easy | ✅ |
| 5.2  | Login error display (wrong password, network error) | Easy | ✅ |
| 5.3  | Redirect to original page after login | Easy | ✅ |
| 5.4  | Admin password change UI | Medium | ✅ |

---

## Dependency Graph

```
Phase 1 (Auth Core) ──── independent
Phase 2 (Protect API) ── dep on Phase 1
Phase 3 (Login Page) ─── independent
Phase 4 (FE Integration) ─ dep on Phase 2 + 3
Phase 5 (Polish) ──────── dep on Phase 4
Phase 6 (Area Switcher) ─ independent
```

---

## Phase 6 — Area Switcher ✅

> Searchable regency dropdown di header — solve KNOWN_AREAS scalability untuk 489 regencies.

| ID | Task | Difficulty | Status |
|------|------|-----------|--------|
| 6.1  | `GET /locations/areas` — list regencies (cached from kodepos) | Easy | ✅ |
| 6.2  | `AreaSwitcher.tsx` — searchable dropdown component | Medium | ✅ |
| 6.3  | Integrate into `ChatInterface` header | Easy | ✅ |

---

## Summary

| Phase | Tasks | Est. Hours | Status |
|-------|-------|-----------|--------|
| 1 — Backend Auth Core | 4 | 2h | ✅ |
| 2 — Protect Endpoints | 3 | 1h | ✅ |
| 3 — Login Page | 3 | 2h | ✅ |
| 4 — Frontend Integration | 4 | 1.5h | ✅ |
| 5 — Polish | 4 | 1h | ✅ |
| 6 — Area Switcher | 3 | 1h | ✅ |
| **Total** | **21** | **~8.5h** | **✅** |

> **Ref:** `docs/sprint-4/AGENTS.md` — full implementation guide
> **Ref:** `docs/sprint-3/SUMMARY.md` — Sprint 3 handoff
