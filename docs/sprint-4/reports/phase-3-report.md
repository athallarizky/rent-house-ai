# Phase 3 Report — Login Page + Auth Client

> Completed: 2026-06-20 | Sprint 4 — Auth & Authorization

---

## 1. Overview

Phase 3 membangun halaman login dan auth client library. User bisa mengakses
`/login`, memasukkan email + password, dan mendapatkan JWT token yang disimpan
di `localStorage`. Setelah login, user di-redirect ke halaman yang diminta.

```
/login  ──►  LoginForm.tsx  ──►  auth.ts:login()  ──►  POST /auth/login
                                       │
                                       ▼
                                  setAuth(token, user)
                                       │
                                  localStorage["kos-ai.auth"]
                                       │
                                       ▼
                                  redirect ke /search (atau ?redirect=)
```

---

## 2. Changes

### 3a. `web/src/lib/auth.ts` (NEW — 75 lines)

Auth client library — semua fungsi untuk auth di frontend:

| Function | Purpose |
|----------|---------|
| `getAuth()` | Baca token + user dari localStorage, auto-detect expiry |
| `setAuth(token, user)` | Simpan ke localStorage |
| `clearAuth()` | Hapus dari localStorage |
| `getAuthHeaders()` | Return `{ Authorization: "Bearer <token>" }` atau `{}` |
| `login(email, password)` | POST `/auth/login`, simpan token, return AuthState |
| `logout()` | Hapus localStorage + redirect ke `/login` |
| `isTokenExpired(token)` | Decode JWT payload, cek `exp` vs `Date.now()` |

**Key decisions:**
- `API_URL` di-import secara dynamic (`await import("./api")`) untuk menghindari
  circular dependency di SSR
- `getAuth()` otomatis clear token + return null kalau token expired
- `localStorage` guard (`typeof localStorage === "undefined"`) untuk SSR safety

### 3b. `web/src/pages/login.astro` (NEW)

Halaman login full-screen dengan Astro:
- Center-card layout dengan judul "Kos AI" + subtitle
- Import `LoginForm` sebagai React island (`client:load`)
- Dark mode support via `noFlashScript`
- Tidak ada DashboardLayout — halaman standalone

### 3c. `web/src/components/LoginForm.tsx` (NEW — 73 lines)

Form login React:
- Input email (autoFocus) + password
- Submit handler inline (matching `SearchBar.tsx` pattern — no separate handler function)
- Loading state: button disabled + `Loader2` spinner
- Error state: pesan error di box merah (`bg-destructive/10`)
- Success: baca `?redirect=` dari URL, fallback ke `/search`
- Styling: Tailwind, consistent dengan theme variables (`bg-background`, `border-border`, `text-primary`, dll)

---

## 3. Verification

| Check | Result |
|-------|--------|
| `POST /auth/login` admin | 200 + JWT token + user info |
| `POST /auth/login` wrong password | 401 "Email atau password salah" |
| `GET /auth/me` with valid token | 200 `{"email":"admin@kos.ai","role":"admin"}` |
| `npm run check` | **0 errors / 0 warnings / 0 hints** (33 files) |
| `npm run build` | 4 pages built in 2.36s (index, login, search, settings) |
| Token expiry detection | Implemented in `isTokenExpired()` — decode JWT payload, compare `exp` with `Date.now()` |

---

## 4. Findings / Notes

| Item | Detail |
|------|--------|
| **React 19 `FormEvent` deprecated** | React 19 types soft-deprecate `React.FormEvent`. Solusi: inline handler seperti di `SearchBar.tsx` — TypeScript infer type dari `onSubmit` prop. |
| **Dynamic `API_URL` import** | `auth.ts` menggunakan `await import("./api")` alih-alih `import { API_URL } from "./api"` untuk menghindari masalah di SSR (Astro mencoba load modul yang merujuk `localStorage`). |
| **`localStorage` guard** | Semua fungsi cek `typeof localStorage === "undefined"` dulu — penting untuk SSR safety di Astro. |

---

## 5. Reference Files

| File | Purpose |
|------|---------|
| `web/src/lib/auth.ts` | Auth client: login, logout, token, headers, expiry |
| `web/src/pages/login.astro` | Halaman login Astro |
| `web/src/components/LoginForm.tsx` | Form login React |
| `web/src/lib/api.ts` | `API_URL` export (digunakan oleh auth.ts) |

> **Ref:** `docs/sprint-4/tasks.md` — Phase 3 task tracking
> **Ref:** `docs/sprint-4/AGENTS.md` — §4a-4c Frontend auth implementation
