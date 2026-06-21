# RCA-007 — `/search` Mis-resolves "Buahbatu" → "Blahbatuh, Gianyar" (0 hasil)

> **Tanggal:** 2026-06-19
> **Sprint:** 2 — Phase 5 (ditemukan saat verifikasi history)
> **Severity:** High (district tertentu return 0 / salah lokasi padahal data ada)
> **Komponen:** `api/src/orchestrator.py` (`search_and_rank`)
> **Status:** ✅ Resolved
> **Hubungan:** kelas bug yang sama dengan [RCA-004](./rca-004-taman-sari-poi-misclassification.md) — geo-router direct-resolve tidak reliable; Rev-001 perbaiki di `/area/load`, tapi `/search` tertinggal.

---

## 1. Ringkasan

User pilih district **Buahbatu** → panel kanan terisi 25 kos (dataset via `/area/load`),
TAPI chat balas "Maaf, tidak ada kos yang cocok" / kasus lain return 1 kos yang salah.

Akar masalah: `/search` → `search_and_rank("Buahbatu")` memakai **resolve direct**
geo-router, yang fuzzy-match **"Buahbatu" → "Blahbatuh" (Gianyar, Bali)** — bukan
Buahbatu, Bandung. Akibatnya search memfilter `kecamatan="Blahbatuh"` → ketemu 1 kos
di Gianyar (atau 0 di tempat lain). Sementara `/area/load` (Rev-001) resolve **via
regency** → nemu "Buahbatu" yang benar di Bandung → 25 kos.

---

## 2. Gejala

```
resolve_area("Buahbatu")
  → { regency: "Gianyar", districts: ["Blahbatuh"] }   ❌ salah kota

POST /search {"area":"Buahbatu"}                       (stream)
  → results highlighted: 1
  → top: "Kost Graha Vidyan Gianyar Bali"              ❌

POST /area/load {"district":"Buahbatu","regency":"Bandung"}
  → dataset: 25 (kecamatan "Buahbatu" Bandung)         ✅ benar
```

User-facing: dataset panel ada data, tapi chat bilang "tidak ada kos" (karena hasil
RAG di district yang salah → kosong/irisan).

---

## 3. Root Cause

`search_and_rank` (sebelum fix) selalu resolve direct:

```python
def search_and_rank(query, area, top_k=5):
    geo = resolve_area(area)            # ← "Buahbatu" → Blahbatuh (Gianyar)
    districts = geo.get("districts", [])
    if len(districts) == 1:
        kec_filter = districts[0]["name"]   # "Blahbatuh"   ❌
    ...
    search(query, kecamatan="Blahbatuh")    # → kosong / salah
```

Kenapa `/area/load` benar? Karena Rev-001 (RCA-004) memperbaiki load_area untuk resolve
**via regency** (cari district di daftar regency → exact match), tapi **perbaikan itu
tidak diterapkan ke `search_and_rank`**. Jadi dua jalur pakai strategi resolve berbeda:
load = regency-scoped (robust), search = direct (rapuh).

**Klasifikasi:** inkonsistensi resolve antar-endpoint + false-positive fuzzy search
geo-router (Buahbatu ≈ Blahbatuh). Sama seperti RCA-004 (Taman Sari/POI), beda manifestasi.

---

## 4. Perbaikan

Ekstrak helper shared `_resolve_kecamatan(area, regency)` dan dipakai `search_and_rank`:

```python
def _resolve_kecamatan(area, regency=None):
    if regency:
        regency_geo = resolve_area(regency)
        for d in regency_geo.get("districts", []):
            if d.get("name", "").lower() == area.lower():
                return d.get("name", area)      # ✅ exact, scoped ke regency
    # fallback: direct resolve (regency-level → None, single district → name)
    ...

def search_and_rank(query, area, top_k=5, regency=None):
    kec_filter = _resolve_kecamatan(area, regency)
    ...
```

Wiring:
- `SearchRequest` + field `regency: Optional[str]`
- `POST /search` → `search_and_rank(query, area, top_k, regency=req.regency)`
- Frontend `queryDataset` → `streamSearch({ ..., regency: currentRegency })`;
  `loadDistrict` pass `res.regency` eksplisit (hindari stale state)

Sekarang kedua jalur (`/area/load` & `/search`) konsisten pakai regency-scoped resolve.

---

## 5. Verifikasi

| Skenario | Sebelum | Sesudah |
|----------|---------|---------|
| `/search Buahbatu` **tanpa** regency (legacy) | 1 hasil (Gianyar) ❌ | 1 (tetap, fallback direct) — pakai regency dari frontend |
| `/search Buahbatu` **dengan** regency=Bandung | — | **10 hasil** (Bandung) ✅, top "BOBOPULES" |
| `/area/load Buahbatu` | 25 ✅ | 25 ✅ (tidak berubah) |
| Cengkareng / district lain | OK | OK (regression-free) |

`astro check` 0/0/0; build OK.

---

## 6. Pencegahan / Action Items

| # | Action | Status |
|---|--------|--------|
| 1 | `_resolve_kecamatan(area, regency)` shared helper; `/search` terima & pakai regency | ✅ done |
| 2 | Frontend kirim `regency` (currentRegency) di tiap refine | ✅ done |
| 3 | **Proper fix geo-router `resolve()`:** jangan fuzzy-match lintas provinsi (Buahbatu Bandung vs Blahbatuh Gianyar); prioritas exact district + scope provinsi/regency | 🟡 backlog (RCA-004 juga |
| 4 | Single source of truth resolve di backend (satu helper untuk load + search + test connection) | ✅ sebagian (helper shared); test geo-router tetap perlu |
| 5 | Bump timeout `format_results` 30s → 60s (non-stream `/search` sempat 500 saat LLM lambat) | ✅ done |

---

## 7. Pelajaran

- **Satu bug, dua manifestasi.** RCA-004 (Taman Sari) dan RCA-007 (Buahbatu) sama-sama
  "geo-router direct-resolve rapuh". Fix RCA-004 hanya di `/area/load` — `/search`
  tertinggal. **Saat memperbaiki resolve, audit semua pemanggil**, jangan setempat.
- **Fuzzy search lintas provinsi berbahaya.** Nama tempat mirip antar daerah (Buahbatu /
  Blahbatuh) → harus ada scope (regency/provinsi) sebelum fuzzy.
- **Dataset vs RAG bisa desinkron kalau resolve-nya beda.** Panel kanan (list_kos) dan
  chat (search_and_rank) harus pakai resolusi kecamatan yang identik.
- Non-streaming path yang jarang dipakai tetap bisa bite (500 timeout) — jangan abaikan
  hanya karena frontend pakai streaming.
