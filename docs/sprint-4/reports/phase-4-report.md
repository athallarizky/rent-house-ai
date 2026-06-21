# Phase 4 Report — Frontend Integration

> Completed: 2026-06-20 | Sprint 4 — Auth & Authorization

---

## 1. Overview

Phase 4 mengintegrasikan auth ke seluruh frontend: API client menambahkan
`Authorization` header, halaman `/search` dan `/settings` diproteksi dengan
`AuthGuard`, sidebar menampilkan user info + tombol logout dan menyembunyikan
"Pengaturan" untuk non-admin.

```
/login ──► AuthGuard ──► ChatInterface (token valid)
                              │
                API calls ──► api.ts ── headers: { Authorization: "Bearer ..." }
                              │
                        401 detected ──► logout() ──► redirect /login
```

---

## 2. Changes

### 4a. `web/src/lib/api.ts` — Auth headers

Semua fetch call ke endpoint terproteksi sekarang menyertakan `getAuthHeaders()`:

| Endpoint | Before | After |
|----------|--------|-------|
| `POST /search` | `{ "Content-Type": "application/json" }` | `{ ...getAuthHeaders(), "Content-Type": ... }` |
| `POST /area/load` | same | same |
| `POST /intent` | same | same |
| `GET /searches` | no headers | `getAuthHeaders()` |
| `POST /searches` | `{ "Content-Type": "application/json" }` | `{ ...getAuthHeaders(), ... }` |
| `DELETE /searches` | no headers | `getAuthHeaders()` |
| `DELETE /searches/{id}` | no headers | `getAuthHeaders()` |
| `GET /settings` | no headers | `getAuthHeaders()` |
| `PUT /settings` | `{ "Content-Type": ... }` | `{ ...getAuthHeaders(), ... }` |
| `POST /settings/test` | `{ "Content-Type": ... }` | `{ ...getAuthHeaders(), ... }` |

Endpoint publik (`/health`, `/locations/*`, `/poi/resolve`, `/settings/models`) tetap tanpa auth headers.

### 4b. `web/src/components/AuthGuard.tsx` (NEW)

Guard komponen client-side:
- Cek `getAuth()` — kalau tidak ada token → redirect ke `/login?redirect=<current_path>`
- Props `adminOnly` — kalau true dan user bukan admin → redirect ke `/search`
- Loading state: teks "Memeriksa akses..." (fallback kustom disupport via props)

### 4c. `web/src/pages/search.astro`

Dibungkus dengan `AuthGuard`:
```astro
<AuthGuard client:only="react">
  <ChatInterface client:only="react" />
</AuthGuard>
```

### 4d. `web/src/pages/settings.astro`

Dibungkus dengan `AuthGuard adminOnly`:
```astro
<AuthGuard client:load adminOnly>
  <ProviderSettings client:load />
</AuthGuard>
```

### 4e. `web/src/layouts/DashboardLayout.astro`

Sidebar footer sekarang memiliki:
- **User info** — menampilkan email + role (contoh: `admin@kos.ai · admin`)
- **Tombol logout** — icon 🚪 "Keluar", langsung hapus localStorage + redirect
- **Hide "Pengaturan"** — link nav `#nav-settings` di-hidden via inline script kalau role bukan admin

Semua dicek via inline `<script>` yang membaca `localStorage["kos-ai.auth"]`.

### 4f. `web/src/components/ChatInterface.tsx`

- **User info di header** — email user ditampilkan di sebelah ThemeToggle, dan tombol logout (icon `LogOut`)
- **401 detection** — fungsi `isAuthError()` mendeteksi error message yang mengandung `(401)`, lalu trigger `logout()` → redirect ke `/login`

### 4g. `web/src/components/ProviderSettings.tsx`

- Cek role via `getAuth()` di mount
- Kalau bukan admin → tampilkan pesan "Hanya admin yang dapat mengubah pengaturan LLM." dengan icon `ShieldAlert`, alih-alih form settings

---

## 3. Verification

| Check | Result |
|-------|--------|
| `npm run check` | **0/0/0** (34 files) |
| `npm run build` | 4 pages built in 2.32s |
| `GET /settings` with token | 200 |
| `GET /settings` without token | 401 |
| `POST /search` without token | 401 |
| `PUT /settings` (user role) | 403 |
| `POST /settings/test` (user role) | 403 |
| `GET /health` (open) | 200 |
| `GET /locations/*` (open) | 200 |

---

## 4. Reference Files

| File | Change |
|------|--------|
| `web/src/lib/api.ts` | Add `getAuthHeaders()` to all protected fetch calls |
| `web/src/components/AuthGuard.tsx` | NEW — route guard with adminOnly + redirect support |
| `web/src/pages/search.astro` | Wrap ChatInterface with AuthGuard |
| `web/src/pages/settings.astro` | Wrap ProviderSettings with AuthGuard adminOnly |
| `web/src/layouts/DashboardLayout.astro` | User info, logout, hide settings link for non-admin |
| `web/src/components/ChatInterface.tsx` | User info in header, 401 detection → logout |
| `web/src/components/ProviderSettings.tsx` | Read-only view for non-admin |

> **Ref:** `docs/sprint-4/tasks.md` — Phase 4 task tracking
> **Ref:** `docs/sprint-4/AGENTS.md` — §4d-4f Frontend integration
