# RCA-021 — Broad-region query di-narrow ke kecamatan acak (Lampung → "Agung")

> **Tanggal:** 2026-06-20
> **Sprint:** 8 — testing E2E lintas wilayah
> **Severity:** High (pencarian region luas provinsi/kabupaten selalu 0 results; user experience rusak)
> **Layanan terdampak:** `POST /search` area resolution
> **Status:** ✅ Resolved

## 1. Ringkasan

Query region luas (`"kos di Lampung"` — provinsi, `"kos di Jawa Barat"`,
`"kos di Bandar Lampung"` — kabupaten/kota) mengembalikan **0 results** dan
tersimpan di history dgn `result_count:0`. Expected: muncul **region list**
(drill-down sub-area) karena region luas bukan satu kecamatan.

## 2. Gejala

- `"kos di Lampung"` → search 0 results (saved `result_count:0`)
- `"kos di Bandar Lampung"` → 0 results
- `"kos di Jawa Barat"` → 0 results
- `"kos di cakung"` (kecamatan spesifik) → results normal (regresi negatif)

## 3. Root Cause (berlapis, dari 3 iterasi)

### Layer 1 — hardcoded list tidak mencakup (Sprint 7 era)
`_extract_area()` hanya cocokkan **substring** terhadap list ~14 kota:
`["cengkareng","jakarta *", "bandung", ...]`. "lampung"/"bandar lampung" tidak
ada → return None → `400 "Could not determine area"`.

### Layer 2 — fallback geo-router narrow ke `districts[0]`
Iterasi 1: tambah fallback geo-router. Tapi:
```python
geo = resolve_area(cand)
if geo.get("districts"):
    return geo["districts"][0].get("name")   # ← ambil kecamatan PERTAMA
```
"Lampung" → geo-router mapped ke regency Tanggamus (20 kecamatan) → return
**"Agung"** (districts[0], acak) → search `kecamatan="Agung"` → 0 (silent
narrowing ke 1 kecamatan random). Lebih buruk dari Layer 1: tidak error, tapi
silently salah.

### Layer 3 — unigram pendek spurious-match
Iterasi 2: coba phrase. Tapi candidate generation juga nyoba unigram pendek
(`"bandar"`, `"barat"`), yg spurious-match ke 1 kecamatan di tempat lain →
bypass region path.

**Akar masalah:** tidak ada distinsi antara "area spesifik" (1 kecamatan) vs
"region luas" (multi-district/province). Resolution selalu berusaha menghasilkan
1 area, walau query sebenarnya region.

## 4. Perbaikan

Satukan resolution ke **satu function typed** `_resolve_query()` yg coba phrase
**terpanjang dulu** (contiguous span), return jenis hasil:

```python
def _resolve_query(query):
    # 1) keyword cepat
    for a in _KNOWN_AREAS:
        if a in lower: return {"kind":"area","name":a}
    # 2) candidate phrase terpanjang dulu
    for span_len in range(len(tokens),0,-1):
        for start in ...:
            cand = " ".join(tokens[start:start+span_len])
            if cand in province_index:                  # province
                return {"kind":"region","region_type":"province",...,"regions":[regencies]}
            geo = resolve_area(cand)
            if geo.type=="AREA":
                if len(districts)==1:                   # kecamatan spesifik
                    return {"kind":"area","name":districts[0]}
                if len(districts)>1:                    # kabupaten/kota
                    return {"kind":"region","region_type":"regency",...,"regions":[kecamatan]}
    return None
```

Handler `/search`:
- `kind=="area"` → search normal
- `kind=="region"` → return drill-down list (`broad_region:true`, `regions:[...]`)
- `None` → 400

Phrase terpanjang-dulu menyelesaikan Layer 3 ("Bandar Lampung" resolve sbg
region sebelum unigram "bandar"). Distinsi kind menyelesaikan Layer 1+2.

## 5. Verifikasi

| Query | Sebelum | Setelah |
|-------|---------|---------|
| `kos di Lampung` | 0 (narrow→"Agung") | province → 15 kabupaten |
| `kos di Bandar Lampung` | 0 | regency → 20 kecamatan |
| `kos di Jawa Barat` | 0 | province → 21 kabupaten |
| `kos putri di cakung` | results | results (regresi aman) |
| `kos di tenjo` | results | results |

## 6. Action Items

- [x] `_resolve_query` unified (phrase terpanjang dulu, typed result)
- [x] Handler `/search` branch area vs region drill-down
- [ ] **Frontend:** render `regions` sbg chip/picklist (saat ini API informative,
      UI belum memanfaatkan `broad_region`)

## 7. Pelajaran

1. **"Resolution" bukan satu arah.** Bukan hanya "query → area", tapi harus
   mendeteksi granularitas: kecamatan vs kabupaten vs provinsi. Memaksa 1 output
   menyembunyikan ambiguitas.
2. **Phrase terpanjang dulu** adalah heuristic kunci untuk multi-word place
   ("Bandar Lampung", "Jawa Barat"). Unigram pendek sering spurious-match.
3. **Silent failure (0 results tanpa error) lebih buruk dari error eksplisit** —
   user & frontend tidak tahu salahnya apa. Drill-down list adalah UX yg lebih
   jujur untuk input ambigu/luas.
