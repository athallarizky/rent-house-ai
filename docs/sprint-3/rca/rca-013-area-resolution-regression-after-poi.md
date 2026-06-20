# RCA-013 — Area Resolution Regression Setelah POI Search

> **Tanggal:** 2026-06-20
> **Sprint:** 3 — Phase 8 (Workflow Fixes) + Phase 10 (POI Geocoding)
> **Severity:** Medium (UX — query eksplisit ke district lain diabaikan)
> **Layanan terdampak:** Web frontend `ChatInterface.tsx`
> **Status:** ✅ Resolved

---

## 1. Ringkasan

Setelah POI search berhasil (men-set `currentDistrict` ke district POI), query
berikutnya yang menyebut district eksplisit (`"Kos di cengkareng"`) diabaikan.
Bot malah menampilkan regency picker district POI, bukan district yang diminta.

```
User: kos sekitar stasiun tanah tinggi
Bot:  📍 Tanah Tinggi di Tangerang. Menampilkan 10 kos di Tangerang... ✅

User: Kos di cengkareng
Bot:  Tangerang memiliki 42 kecamatan. Pilih salah satu... ❌ (seharusnya Cengkareng)
```

---

## 2. Gejala

1. User sukses melakukan POI search → `currentDistrict` = "Tangerang"
2. User mengetik query dengan district eksplisit: `"Kos di cengkareng"`
3. Bot menampilkan regency picker Tangerang (42 district), bukan Cengkareng
4. Hanya terjadi di **mode Cepat** (RAG) — mode AI berfungsi normal

---

## 3. Root Cause

**Priority area resolution salah: `currentDistrict` di-cek sebelum `extractArea()` regex.**

### Kode sebelum fix:

```typescript
let area = intentArea || areaHint || currentDistrict;
if (!area) {
  const regexArea = extractArea(text);
  area = regexArea || DEFAULT_AREA;
}
```

### Alur saat mode Cepat setelah POI:

1. `chatMode === "rag"` AND `currentDistrict !== null` → intent TIDAK dipanggil
2. `intentArea = null`
3. `areaHint = undefined`
4. `area = currentDistrict` → **"Tangerang"**
5. Karena `area` sudah terisi, blok `if (!area)` tidak dijalankan
6. `extractArea("Kos di cengkareng")` **tidak pernah dipanggil**
7. `resolveLocation("Tangerang")` → 42 district → picker

### Kenapa mode AI tidak terdampak?

Mode AI selalu memanggil `extractIntent()`, yang mengembalikan `area: "Cengkareng"`.
Jadi `intentArea` terisi sebelum fallback ke `currentDistrict`.

---

## 4. Perbaikan

Ubah urutan priority: regex `extractArea()` di-cek **sebelum** `currentDistrict`:

```typescript
let area = intentArea || areaHint;
if (!area) {
  const regexArea = extractArea(text);
  area = regexArea || currentDistrict || DEFAULT_AREA;
}
```

### Priority baru:

| # | Source | Contoh |
|---|--------|--------|
| 1 | LLM intent (`extractIntent`) | `"kos di cengkareng"` → area: Cengkareng |
| 2 | `areaHint` (dari saved search) | Passed from sidebar click |
| 3 | `extractArea()` regex | `"Kos di cengkareng"` → "cengkareng" ✓ |
| 4 | `currentDistrict` | Previous loaded district fallback |
| 5 | `DEFAULT_AREA` | "Cengkareng" (last resort) |

---

## 5. Verifikasi

| Check | Result |
|-------|--------|
| `npm run check` | 0/0/0 |
| `npm run build` | 3 pages |
| POI search → kemudian "Kos di cengkareng" | Langsung load Cengkareng ✅ |
| POI search → kemudian "wifi kenceng" | Refine di district POI (correct, no area disebut) ✅ |
| Mode AI: "Kos di cengkareng" | LLM intent → Cengkareng ✅ |
| Mode Cepat: "Kos di cengkareng" | Regex → Cengkareng ✅ |

---

## 6. Action Items

- [x] Pindahkan `extractArea()` regex sebelum `currentDistrict` di priority chain
- [x] `DEFAULT_AREA` tetap sebagai last resort (setelah `currentDistrict`)

---

## 7. Pelajaran

1. **Priority chain harus dari paling spesifik ke paling umum** — regex `extractArea`
   (spesifik, dari query text) lebih prioritas daripada `currentDistrict` (umum, state
   sebelumnya).
2. **Mode behaviour yang berbeda bisa menyembunyikan bug** — bug hanya muncul di
   mode Cepat karena intent di-skip. Mode AI kebetulan "memperbaiki" bug dengan
   intent extraction.
3. **Test regression setelah setiap phase** — POI flow menambahkan `currentDistrict`
   baru dan mengubah state, yang memengaruhi priority chain area resolution.
