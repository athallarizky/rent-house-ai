# RCA-034 — POI ranking: distance 15% + semantic top-90 exclude kos terdekat

> **Tanggal:** 2026-06-21
> **Sprint:** 9 — POI radius search quality
> **Severity:** High (KOST EMPANG — kos 0m dari SMK Telkom, 4.9★ — tidak muncul di hasil)
> **Layanan terdampak:** `search_and_rank`, `rank()`, POI radius search
> **Status:** ✅ Resolved

## 1. Ringkasan
POI "kos sekitar smk telkom jakarta" (radius 5km) → KOST EMPANG (0m dari SMK
Telkom, 4.9★, 8 reviews) **tidak muncul di hasil** padahal dia kos terdekat.
Sebaliknya, kos lebih jauh muncul lebih tinggi.

## 2. Root Cause (dua bug berlapis)

### Bug A: Ranking weight_distance 15% terlalu rendah
`rank()` gunakan `weight_distance=0.15` (linear, max 10km). Pada 57m vs 1km:
score difference hanya ~1.4%. Rating 35% menang → kos jauh dgn rating tinggi
diutamakan. Untuk POI ("sekitar X"), **proximity harus dominan**.

### Bug B: Semantic search top-90 exclude kos terdekat
`search()` gunakan `collection.query(n_results=90)` → hanya ambil top-90 by
**embedding similarity** ke query "smk telkom". KOST EMPANG (0m) review-nya
tidak mirip "smk telkom" secara semantik → **tidak masuk top-90** → tidak
dipertimbangkan, walau dia terdekat secara geografis.

**Kombinasi**: candidate pool terlalu sempit (90 dari 195) + ranking tidak
prioritize distance → kos terdekat hilang dua kali.

## 3. Perbaikan

**Fix A — `rank()` proximity_first mode:**
```python
if proximity_first and has_geo:
    proximity = math.exp(-dist / 0.5)  # exp decay, 500m half-life
    score = 0.65 * proximity + 0.15 * rating + 0.10 * reviews + 0.10 * tags
```
65% weight distance dgn exponential decay (0m=1.0, 500m=0.37, 1km=0.14).
Close kos dominan; far kos fade cepat. Rating jadi tiebreaker.

**Fix B — `search_and_rank` POI top_k=500:**
```python
search_top_k = 500 if is_poi else max(top_k * 3, 30)
```
POI queries: SEMUA kos jadi kandidat (500 >> 195). Semantic narrowing tidak
exclude kos terdekat.

## 4. Verifikasi
```
Sebelum:                          Sesudah:
1. Kos Awany CoLiving (jauh)     1. KOST EMPANG     ★4.9  0m
2. KOST BOSSQU                    2. KM Kost TikaMuhni ★4.5 40m
3. ... (EMPANG absent)            3. KOST DHEADAY    ★4.8 60m
                                  4. Kost Bang Atil  ★4.7 57m
                                  5. Kost Hj.rohimah ★4.1 45m
```
EMPANG #1 (0m + 4.9★). Score drop eksponensial (0.71→0.67→0.65). Search
semantik ("wifi kenceng") **unaffected** (balanced weights, top_k=30).

## 5. Pelajaran
1. **Candidate pool + ranking = pipeline 2-stage**. Bug di salah satu stage
   cukup utk hilangkan hasil yg benar. Test end-to-end (bukan per-stage).
2. **Semantic search tidak cocok utk POI/proximity queries** — landmark name
   ("smk telkom") bukan konten semantik ("wifi kenceng"). POI butuh ALL
   candidates + distance rank, bukan embedding similarity.
3. **Exponential decay > linear utk proximity** — 500m half-life discriminating
   (0m vs 500m = 2.7x difference), linear 10km flat di dekat (0m vs 500m =
   1.05x).
