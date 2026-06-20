# Phase 5 Report — Polish

> Completed: 2026-06-20 | Sprint 4 — Auth & Authorization

---

## 1. Overview

Phase 5 adalah polish final — verifikasi edge cases, error handling, dan
penambahan fitur ganti password admin. Sebagian besar fitur polish (token
expiry, error display, redirect after login) sudah terintegrasi di fase
sebelumnya.

---

## 2. Changes

### 5a. Token expiry handling (built-in from Phase 3)

`auth.ts:getAuth()` otomatis mengecek expiry JWT setiap kali dipanggil:

```typescript
if (isTokenExpired(parsed.token)) {
  clearAuth();
  return { token: null, user: null };
}
```

`isTokenExpired()` decode payload JWT (base64), baca field `exp`, bandingkan
dengan `Date.now()`. Kalau expired → token dihapus → `AuthGuard` redirect ke login.

**Verifikasi:** 
1. User dengan token expired → `getAuth()` return `null`
2. AuthGuard → redirect ke `/login`
3. Setiap API call yang gagal 401 → `isAuthError()` di ChatInterface → `logout()`

### 5b. Login error display (built-in from Phase 3)

`LoginForm.tsx` sudah menangani error dengan baik:
- 401 → "Email atau password salah" (dari response backend)
- Network error → "Login gagal" (fallback message)
- Loading state: tombol disabled + spinner `Loader2`

### 5c. Redirect after login (built-in from Phase 4)

`AuthGuard.tsx` mengirim `?redirect=/search` saat redirect ke `/login`.
`LoginForm.tsx` membaca `?redirect=` dari URL dan redirect ke URL tersebut
setelah login sukses (fallback ke `/search`).

### 5d. Admin password change (NEW)

**Backend — `api/src/auth_routes.py`:**
- `PUT /auth/password` — validasi current_password + new_password, update hash
- Minimal 4 karakter untuk password baru
- Harus terautentikasi

**Backend — `api/src/users.py`:**
- `update_password(email, hash)` — UPDATE di SQLite

**Frontend — `web/src/lib/auth.ts`:**
- `changePassword(currentPassword, newPassword)` — PUT `/auth/password`

**Frontend — `web/src/components/ProviderSettings.tsx`:**
- Section "Ubah Password Admin" di halaman settings
- Input current password + new password
- Error display ("Password saat ini salah", "Password baru minimal 4 karakter")
- Success indicator (centang hijau "Password berhasil diubah.")
- Loading state: tombol disabled + spinner

### 5e. CORS Authorization header

`main.py` menggunakan `allow_headers=["*"]` — sudah mencakup `Authorization`.
Tidak perlu perubahan.

### 5f. 401 handling di ChatInterface

Fungsi `isAuthError()` mendeteksi `(401)` di error message, trigger `logout()`.
Sudah diimplementasikan di Phase 4.

---

## 3. Verification

| # | Test | Result |
|---|------|--------|
| 1 | `PUT /auth/password` — valid change | 200 `{"ok":true}` |
| 2 | Login dengan password lama setelah diganti | 401 "Email atau password salah" |
| 3 | Login dengan password baru | 200 + JWT |
| 4 | Change back ke password original | 200 |
| 5 | Wrong current password | 400 "Password saat ini salah" |
| 6 | Password < 4 karakter | 400 "Password baru minimal 4 karakter" |
| 7 | Token expired → `getAuth()` return null | Verified via `isTokenExpired()` logic |
| 8 | Login error display | Verified via error state in LoginForm |
| 9 | Redirect after login | Verified via `?redirect=` in AuthGuard + LoginForm |
| 10 | CORS Authorization header | `allow_headers=["*"]` sudah mencakup |

| Check | Result |
|-------|--------|
| `npm run check` | **0/0/0** (34 files) |
| `npm run build` | 4 pages in 2.40s |
| Python AST (auth_routes.py, users.py) | OK |
| Password change flow | End-to-end verified |

---

## 4. Reference Files

| File | Change |
|------|--------|
| `api/src/auth_routes.py` | `PUT /auth/password` endpoint |
| `api/src/users.py` | `update_password()` function |
| `web/src/lib/auth.ts` | `changePassword()` client function |
| `web/src/components/ProviderSettings.tsx` | "Ubah Password Admin" section |

> **Ref:** `docs/sprint-4/tasks.md` — Phase 5 task tracking
> **Ref:** `docs/sprint-4/AGENTS.md` — §5 Polish
