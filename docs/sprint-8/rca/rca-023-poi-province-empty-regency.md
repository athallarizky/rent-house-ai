# RCA-023 — POI resolver gagal untuk region provinsi (Gorontalo → "tidak ditemukan")

> **Tanggal:** 2026-06-20
> **Sprint:** 8 — testing E2E
> **Severity:** Medium (region provinsi tidak bisa di-resolve via POI flow)
> **Layanan terdampak:** `POST /poi/resolve`, frontend POI search
> **Status:** ✅ Resolved

## 1. Ringkasan

Query `"kos di sekitar gorontalo"` via `/poi/resolve` mengembalikan
`districts: []` meski Gorontalo dikenali (lat/lon + regency/province terisi).
Frontend menampilkan "Tidak dapat menemukan lokasi". Expected: drill-down
region list.

## 2. Gejala

```
POST /poi/resolve {"query":"kos di sekitar gorontalo"}
→ {"lat":0.71,"lon":122.45,"regency":"Gorontalo","province":"Gorontalo",
   "district":"","districts":[]}
→ UI: "Tidak dapat menemukan lokasi 'kos di sekitar gorontalo'..."
```
- `geo-router /resolve?q=Gorontalo` → 28 kecamatan (data ADA)
- Tapi POI flow return districts kosong

## 3. Root Cause

Dua temuan terkait:

### A. `geocode()` return regency kosong untuk match provinsi
`geocode("kos di sekitar gorontalo")` → Nominatim resolve ke **titik provinsi**
Gorontalo. Output: `regency: ""` (kosong!), `province: "Gorontalo"`, `district: ""`.
Nominatim tidak mengisi regency saat match adalah level provinsi.

### B. POI flow skip expand saat regency kosong
`api/src/poi.py`:
```python
regency = geo.get("regency", "")
if regency:                            # ← "" → False
    area = resolve_area(regency)        # ← skip total
    districts = area.get("districts")
```
Karena `regency=""`, block expand di-skip → `districts` tetap `[]`. Province
(Gorontalo) diabaikan.

## 4. Perbaikan

Saat `districts` kosong tapi `province` ada → anggap region provinsi → kembalikan
**list kabupaten** di provinsi itu (drill-down, konsisten dgn RCA-021):

```python
if not districts and province:
    pe = _province_regencies().get(province.lower())  # dari kodepos index
    if pe:
        result["broad_region"] = True
        result["region_type"] = "province"
        result["region"] = pe["display"]
        result["regions"] = sorted(pe["regencies"])
```

Reuse index kabupaten dari `locations._load_regencies` (tidak ada konstanta baru).

## 5. Verifikasi

| Check | Result |
|-------|--------|
| Sebelum | `districts:[]`, UI "tidak ditemukan" |
| Setelah | `broad_region:true, region:"Gorontalo", regions:[Boalemo,Bone Bolango,Gorontalo,Gorontalo Utara,Pahuwato]` (5) |

## 6. Action Items

- [x] POI flow: fallback province drill-down saat regency kosong
- [x] Reuse `_load_regencies` index (no constant)
- [ ] **Frontend:** handle `broad_region` di POI flow (saat ini `districts`-only)
- [ ] **Future:** `geocode` bisa return level (province/regency/district) eksplisit
      biar downstream tidak menebak dari field kosong

## 7. Pelajaran

1. **Field kosong ≠ tidak ada data.** `regency=""` saat match provinsi adalah
   signal "ini level provinsi", bukan "tidak diketahui". Downstream harus
   interpretasi field kosong sbg kasus khusus, bukan skip.
2. **Konsistensi drill-down** — RCA-021 (search) & RCA-023 (POI) adalah gejala
   sama (region luas) di 2 endpoint berbeda. Solusi seragam (province drill-down
   via index kabupaten) mencegah divergensi.
3. **Nominatim/geocoder level ambigu** — nama tempat Indonesia serangkai
   (Gorontalo = provinsi+kabupaten+kota). Jangan assume 1 level.
