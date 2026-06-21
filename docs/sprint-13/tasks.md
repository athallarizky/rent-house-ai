# Sprint 13 — User Management

## Tujuan

Fitur management user untuk admin. Admin dapat CRUD (Create, Read, Update, Delete) data user melalui halaman admin baru di `/users`.

## Scope

| # | Task | Status |
|---|------|--------|
| 1 | Backend: tambah fungsi CRUD di `api/src/users.py` (list, get_by_id, create, update, delete) | Done |
| 2 | Backend: buat `api/src/user_routes.py` — 4 endpoint admin-only (GET/POST/PUT/DELETE `/users`) | Done |
| 3 | Backend: register `user_router` di `api/src/main.py` | Done |
| 4 | Frontend: tambah fungsi API (listUsers, createUser, updateUser, deleteUser) di `web/src/lib/api.ts` | Done |
| 5 | Frontend: buat komponen `UserManager.tsx` — tabel user, modal create/edit, konfirmasi hapus | Done |
| 6 | Frontend: buat halaman `/users` (`users.astro`) | Done |
| 7 | Frontend: tambah menu "Users" di sidebar (`DashboardLayout.astro`) — admin-only | Done |
| 8 | Frontend: tambah menu "Users" di mobile nav (`MobileNav.tsx`) — admin-only, filtered by role | Done |
| 9 | Fix: Python 3.9 type hints compatibility (`Optional[str]` bukan `str | None`) | Done |

## Backend API

### `GET /users` (admin-only)
Daftar semua user. Response:
```json
{"users": [{"id": "...", "email": "...", "role": "...", "created_at": "..."}]}
```

### `POST /users` (admin-only)
Buat user baru. Body: `{ email, password, role }`.
- Password minimal 4 karakter
- Role harus `admin` atau `user`
- Return 409 jika email sudah terdaftar

### `PUT /users/{user_id}` (admin-only)
Update user. Body: `{ email?, role?, password? }`. Field kosong = tidak diubah.

### `DELETE /users/{user_id}` (admin-only)
Hapus user. Admin tidak bisa menghapus akun sendiri (return 400).

## Frontend

### Halaman `/users`
- Hanya bisa diakses admin (AuthGuard `adminOnly`)
- Tabel user: email, role (badge), tanggal daftar, aksi (edit/hapus)
- Tombol "Tambah User" — buka modal create
- Edit — buka modal edit (password optional)
- Hapus — modal konfirmasi

### Navigasi
- Sidebar: menu "Users" (admin-only, hidden via JS + `nav-users` id)
- Mobile nav: menu "Users" (admin-only, filtered berdasarkan role dari localStorage)

## Local Development Setup

Untuk development tanpa Docker rebuild:
1. Stop `kos-web` dan `kos-api` containers
2. Jalankan API lokal: `.venv/bin/python -c "from api.src.main import app; from uvicorn import run; run(app, port=8081)"`
3. Jalankan Astro dev: `cd web && npm run dev -- --port 4000`
4. Astro dev server memproxy `/api/*` ke `http://localhost:8081` (via `astro.config.mjs`)

## Branch

- Feature: `feat/standalone/manage-users`
- Base: `release/standalone`
