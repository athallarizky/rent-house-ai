# RCA-026 — "Tidak ada kos di undefined" + refresh 400 (undefined district)

> **Tanggal:** 2026-06-20
> **Sprint:** 8 — testing E2E
> **Severity:** Medium-High (UX rusak: refresh error 400 + message membingungkan "di undefined")
> **Layanan terdampak:** frontend ChatInterface (loadDistrict, queryDataset), bootstrap
> **Status:** ✅ Resolved

## 1. Ringkasan

Dua gejala terkait `district=undefined`:
1. **Refresh selalu 400**: setiap page load → `POST /area/load {"district":"undefined"}` → "gagal membuat district".
2. **"Tidak ada kos di undefined"**: search area tak dikenal → message render literal `undefined`.

## 2. Gejala

- Refresh page → `POST /area/load {"district":"undefined"}` → 400.
- Search `"kos di cipondoh"` (area tak dikenal frontend) → "Tidak ada kos di **undefined** yang cocok...".

## 3. Root Cause

**Frontend area resolution lemah + value undefined bocor ke render.**

### A. Refresh 400
- URL persist `?area=undefined` (dari state null yg di-stringify masa lalu).
- Bootstrap effect baca `area="undefined"` (string) → `loadDistrict("undefined")` → API 400.

### B. "di undefined"
- Frontend `extractArea` regex hanya kenal ~21 area (cengkareng, bandung, …). "cipondoh" tidak dikenal → null.
- `area = regexArea || currentDistrict || DEFAULT_AREA`. Pada fresh page, currentDistrict=null → queryDataset(text, undefined).
- Backend `/search` area=None → `_resolve_query` resolve cipondoh → search → 0 hasil (belum di-index). Backend **benar**.
- Tapi frontend `queryDataset` done-handler interpolasi `${district}` langsung → render "di **undefined**".

**Akar masalah B**: pesan frontend pakai variabel `district` (undefined) bukan area resolved backend. **Akar masalah A**: ga ada guard nilai undefined sebelum hit API.

## 4. Perbaikan

**A. Refresh 400:**
- `loadDistrict` early-return untuk falsy/`"undefined"`/empty (guard centralized).
- Bootstrap: `?area=undefined` diperlakukan no-area + di-strip dari URL.

**B. "di undefined":**
- `queryDataset` signature: `district` jadi optional (`string | undefined`).
- Turunkan `districtLabel = district?.trim() || "area ini"` — dipakai di semua 3 message hasil.
- Saved-search area di-coerce `district || ""` (backend udah optional, RCA-024).

## 5. Verifikasi

| Check | Result |
|-------|--------|
| Refresh dgn `?area=undefined` | no API hit, URL dibersihin ✓ |
| `"kos di cipondoh"` message | "Tidak ada kos di **area ini**..." (bukan undefined) ✓ |
| Search tetap jalan | backend resolve cipondoh, 0 hasil krn belum indexed (benar) ✓ |

## 6. Action Items

- [x] loadDistrict guard undefined/empty
- [x] bootstrap strip `?area=undefined`
- [x] queryDataset districtLabel + district optional
- [x] (lanjutan) Opsi A `/search/resolve` — frontend defer ke backend resolution shg cipondoh dst resolve & trigger auto-scrape (commit e622f13)

## 7. Pelajaran

1. **State null/undefined harus di-guard sebelum render & sebelum hit API** — `${var}` di template literal静静 renders "undefined" tanpa error.
2. **Frontend/backend area resolution mesti satu source of truth** — frontend regex lemah + backend kuat = mismatch. Opsi A (`/search/resolve`) menyatukan.
3. **URL persistent = state** — `?area=undefined` yg nyangkut terus memicu bug setiap refresh. Bootstrap harus validasi + bersihkan param stale.
