# RCA-030 — Dedup proximity 50m terlalu agresif → kos legit hilang (KOST EMPANG)

> **Tanggal:** 2026-06-21
> **Sprint:** 8/9 — testing POI radius search Cengkareng
> **Severity:** High (kos legit hilang diam-diam; data-quality; ~33% raw Cengkareng di-drop)
> **Layanan terdampak:** data-processor `dedup()`, SEMUA area (data hilang saat process)
> **Status:** ✅ Resolved

## 1. Ringkasan

"KOST EMPANG" (4.9★, 8 reviews, **persis di koordinat SMK Telkom** — kos paling
relevan utk query POI "sekitar smk telkom") ADA di raw Cengkareng, tapi **tidak
ada di cleaned docs / tidak ke-index**. Akibatnya search radius 5km ga pernah
bisa nemuin dia walau dia kos terdekat. Cengkareng: 302 raw → 203 docs (~99
entry hilang, ~33%).

## 2. Gejala

- `grep EMPANG data/raw/Cengkareng/*.jsonl` → ADA (place_id `ChIJj-HqCoT3aS4R...`).
- `data/cleaned/Cengkareng_docs.json` (203 docs) → **tidak ada EMPANG**.
- Chroma Cengkareng (174 indexed) → tidak ada EMPANG.
- POI search "sekitar smk telkom jakarta" (radius 5km, persis di lokasi EMPANG)
  → hasil top bukan EMPANG (dia absent).

## 3. Root Cause

**`dedup(entries, proximity_m=50)` terlalu agresif + first-wins.**

`services/data-processor/src/dedup.py`: setiap entry dlm 50m entry yg sudah
di-keep → dianggap dup → **di-skip**. Padahal:

```
kos dlm 100m KOST EMPANG (Cengkareng, area padat):
   0m  4.9★  'KOST EMPANG'            ← di-DROP (collision 40m dgn bawah)
  40m  4.5★  'KM Kost by TikaMuhni'   ← di-keep duluan (first-wins)
  45m  4.1★  'Kost Hj.rohimah'
  57m  4.7★  'Kost Bang Atil'
  60m  4.8★  'KOST DHEADAY'
```

Dua masalah:
1. **50m terlalu lebar utk Indonesia.** Kos di Jakarta padat & saling berdekatan
   (beda gang/gedung 30–50m itu normal, BUKAN duplikat). Threshold 50m salah-merge
   tetangga.
2. **First-wins, bukan best-wins.** Iterasi urutan file → kos pertama menang.
   EMPANG (4.9★) kalah sama TikaMuhni (4.5★) cuma krn TikaMuhni muncul duluan.

True duplicates (mis. TikaMuhni muncul 3× di raw krn ter-scrape antar postal code)
sudah tertangani oleh **place_id dedup** — proximity dedup tidak diperlukan utk
kasus itu, dan justru menyebabkan kerusakan.

## 4. Perbaikan

`dedup.py`:
1. **`proximity_m` default 100 → 10** (pipeline call 50 → 10). 10m cuma catch
   coord-drift duplicate sejati (tempat sama, koordinat melayang ≤10m); tetangga
   40m tetap distinct → di-keep.
2. **Keep-better-on-collision**: saat collision, simpan entry dgn score
   `rating × log1p(review_count)` lebih tinggi — bukan first-wins. Defense
   depth: walau tabrakan, kos lebih baik menang.
3. `place_id` dedup + review merge tetap (handle duplicate sejati).

```python
def _entry_score(e):
    return float(e.get("rating") or e.get("review_rating") or 0) * math.log1p(e.get("review_count") or 0)

def dedup(entries, proximity_m=10.0):
    ...
    if collision_idx >= 0:
        if _entry_score(entry) > _entry_score(unique[collision_idx]):
            unique[collision_idx] = entry  # keep better
        continue
```

## 5. Verifikasi

Rebuild Cengkareng (via sprint-9 `POST /pipeline/rebuild`, 24.3s):

| | Sebelum (prox 50m) | Sesudah (prox 10m) |
|---|---|---|
| docs | 203 | **233** (+30) |
| KOST EMPANG | ✗ hilang | **✓ ADA** |
| KM Kost TikaMuhni | ✓ (1, place_id dedup) | ✓ |
| Kost Hj.rohimah | ✗ | **✓ ADA** |
| Kost Bang Atil | ✗ | **✓ ADA** |
| KOST DHEADAY | ✗ | **✓ ADA** |

Semua 5 kos berdekatan (40–60m) sekarang KEPT (distinct), true duplicate
(TikaMuhni 3×) tetap ke-dedup by place_id.

## 6. Action Items

- [x] `dedup.py`: proximity 10m + keep-better-on-collision
- [x] `pipeline.py`: call `proximity_m=10`
- [x] Rebuild Cengkareng (sprint-9 action) → 233 docs, KOST EMPANG & friends recovered
- [ ] **Rebuild area lain** yg di-process dgn dedup lama (semua area existing
      ke-dedup berlebihan). Sprint-9 "Rebuild" action bikin ini murah.
      Priority: area padat (Jakarta/Bandung).
- [ ] Pertimbangkan: hilangkan proximity dedup entire (andalkan place_id only)?
      10m masih punya nilai utk coord-drift, jadi dipertahankan.

## 7. Pelajaran

1. **Threshold heuristik harus disesuaikan dgn domain.** "50m duplikat" mungkin
   masuk akal di suburb US, tapi **tidak di Jakarta** (kos padat, 40m = beda
   gedung). Validasi threshold thd data real, bukan asumsi.
2. **First-wins itu bug menunggu waktu.** Saat merge, pilih **terbaik** (score),
   bukan yg pertama. Order-dependence = non-deterministic data loss.
3. **Bug "data hilang diam-diam" paling insidious** — proses SUKSES (ga error),
   count turun tapi ga keliatan kalau ga cross-check raw vs docs. Pipeline harus
   report `raw → unique` ratio; drop signifikan = alarm.
4. **Sprint-9 Rebuild action tepat utk recovery** — data-quality fix landing →
   Rebuild semua area affected, no SSH. Bug ini jadi use-case kuat lg action tsb.
