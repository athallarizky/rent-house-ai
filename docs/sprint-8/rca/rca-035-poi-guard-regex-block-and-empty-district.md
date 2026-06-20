# RCA-035 — POI guard `!regexArea` + Nominatim empty district → wrong drill-down

> **Tanggal:** 2026-06-21
> **Sprint:** 9 — POI edge cases
> **Severity:** Medium (POI query "mall tangerang city" → drill-down 42 kecamatan, bukan radius search)
> **Layanan terdampak:** ChatInterface POI flow, `/poi/resolve`
> **Status:** ✅ Resolved

## 1. Ringkasan
"kos sekitar mall tangerang city" → sistem return **"Tangerang memiliki 42
kecamatan, pilih salah satu"** (regency drill-down) padahal expected: radius
search di sekitar mall.

## 2. Root Cause (dua bug)

### Bug A: Guard `!regexArea` block POI
Frontend `extractArea("kos sekitar mall tangerang city")` → match **"tangerang"**
(known area di KNOWN_AREAS list). Guard POI `if (intentPoi && !intentArea &&
!regexArea)` → `!regexArea` False → **POI path skipped** → area resolution →
"Tangerang" → multi-district → drill-down.

Akar masalah: **nama POI bisa contain area keyword** ("Mall **Tangerang** City").
Regex area tidak bisa distinguish "sekitar Tangerang" (area intent) dari
"sekitar Mall Tangerang City" (POI intent).

### Bug B: Nominatim empty district → regency picker
Setelah guard dilepas, `/poi/resolve` geocode → lat/lon Mall Tangerang City
ditemukan (-6.176, 106.638) TAPI **district: ''** (Nominatim hanya return
regency "Tangerang", bukan kecamatan). POI flow `if (districtName)` →
`districtName = poiResult.district || districts[0]?.name` → fallback ke first
district (arbitrary). Tapi loadDistrict(firstDistrict) salah — bukan district
yg berisi mall.

## 3. Perbaikan

**Fix A — hapus `!regexArea` dari guard:**
```js
// Before
if (intentPoi && !intentArea && !regexArea) { ... }
// After
if (intentPoi && !intentArea) { ... }
```
POI selalu coba duluan saat proximity keyword ada. Geocoder decide.

**Fix B — search ALL kos saat district empty:**
```js
if (hasDistrict) {
    loadDistrict(poiResult.district, ..., geo);  // district known
} else if (poiResult.lat && poiResult.lon) {
    queryDataset(text, undefined, { user_lat, user_lon, radius_km: 5 });
    // backend: search across ALL kecamatan (kec=None) within radius
}
```
Backend `search_and_rank(area=undefined)` → `_resolve_kecamatan` → kec=None →
search all. Radius filter handles geography.

## 4. Verifikasi
```
Sebelum: "Tangerang memiliki 42 kecamatan. Pilih salah satu..."
Sesudah: "📍 Mall Tangerang City, Tangerang. Mencari kos dalam radius 5km..."
         → hasil: kos terdekat dari mall, across ALL districts
```

## 5. Pelajaran
1. **Keyword-based routing fragile** — area name bisa muncul di POI name.
   Jangan block path berdasarkan keyword match saja; biarkan resolver (
   geocoder) tentukan.
2. **Nominatim tidak always return kecamatan** — geocode result bisa stop di
   regency/city level. Downstream harus handle empty district gracefully (
   jangan force pick arbitrary, jangan crash).
3. **Radius search tidak perlu district** — jika ada lat/lon, filter by
   jarak cukup. District filter itu optimasi (narrow candidate pool), bukan
   kebutuhan fungsional. Saat district unknown, search all + radius = benar.
