# RCA-038 — Geo-router Fuse memblokir event loop → "Geo-router unavailable: timed out"

> **Tanggal:** 2026-06-25
> **Sprint:** 14 (reliability batch — jalur `app/e5-small-embedding`)
> **Severity:** High (resolve konkuren timeout; `/health` stall; error user-facing)
> **Layanan terdampak:** `services/geo-router` (Node/Fastify), `api/src/locations.py`, `api/src/orchestrator.resolve_area`
> **Branch:** `feat/pipeline-percode-resume` (base `app/e5-small-embedding`)
> **Status:** ✅ Resolved

## 1. Ringkasan

`GET /api/locations/resolve?q=Tambora` sewaktu-waktu mengembalikan
`502 {"detail":"Geo-router unavailable: timed out"}`, padahal geo-router sehat
dan resolve langsung cepat. Penyebabnya: **Fuse.js search di geo-router
berjalan synchronous pada event loop Node single-threaded** — satu query fuzzy
berat (~1.7s) memblokir loop, sehingga request lain (resolve konkuren, bahkan
`/health`) antri dan kena timeout API 5s.

## 2. Gejala

- `GET /api/locations/resolve?q=Tambora` → `502 "Geo-router unavailable: timed out"`.
- Resolve langsung ke geo-router (`Cengkareng`) = 5ms; `Tambora` langsung = 16ms
  → **intermiten**, muncul saat ada query berat lain bersamaan.
- Query fuzzy ambigu (`BOBOS`) = **~1.7s**; query exact (`Cengkareng`) = ~5ms
  (short-circuit sebelum Fuse).
- Frontend menampilkan "Geo-router tidak tersedia (:3001). Jalankan `npm run
  dev`…" — **menyesatkan** (menyalahkan geo-router padahal kadang backend yg
  restart; hint dev-lokal salah di konteks Docker).

## 3. Root Cause

1. **Fuse di event loop.** Handler `app.get("/resolve", async ...)` memanggil
   `resolve(fuse, ...)` **synchronous**. `fuse.search` (Fuse.js) CPU-bound,
   scan 83.761 entri (field `fulltext` membengkak dari nested-loop pasangan).
   Node single-threaded → selama search, **event loop total terblokir**, semua
   request lain antri.
2. **Hanya query fuzzy yang kena** — `resolve()` cek exact regency/district
   dulu (cepat), Fuse cuma fallback. Query ambigu/typo → Fuse → blokir.
3. **Timeout API 5s terlalu ketat** (`locations.py` & `resolve_area`:
   `urlopen(timeout=5)`) → antrian sesaat saja sudah lewat batas.
4. **API handler blocking juga.** `resolve_location`/`expand_location` adalah
   `async def` yang melakukan blocking `urlopen` → memblokir event loop API
   pula selama menunggu geo-router.

## 4. Perbaikan

**Geo-router (`services/geo-router/src`):**
- Fuse dipindah ke **worker thread** baru (`search-worker.ts`). Hanya query
  fuzzy yang round-trip ke worker; exact resolve & `/health` tetap di event
  loop → **selalu responsif** walau fuzzy berat sedang jalan.
- `resolve.ts` di-split: `resolveExact` (regency/district exact + POI guard,
  sinkron) vs `resolveFuzzy` (finishing dari hasil Fuse).
- **LRU cache 512** untuk `/resolve` & `/expand` (repeat instant).
- Guard resiliensi: worker mati/timeout → degrade "not found", bukan hang
  (per-request timeout 12s + ready-promise fallback).

**API (`api/src`):**
- Timeout geo-router **5s → 15s** (`locations.py`, `orchestrator.resolve_area`).
- `/locations` resolve & expand jadi **sync `def`** → Fastify jalankan di
  threadpool → event loop API tidak terblokir saat menunggu geo-router.

**Web (`web/src/lib`):**
- `friendlyError` akurat: 502 di resolve tidak lagi menyalahkan geo-router
  ("backend kemungkinan sedang restart"); hanya `Geo-router unavailable`
  asli yang menampilkan pesan geo-router.

## 5. Verifikasi

| Check | Sebelum | Sesudah |
|-------|---------|---------|
| `/health` saat 3 fuzzy berat konkuren | stall → timeout | **4.8 ms** |
| `BOBOS` berulang (cache) | ~1.7 s | **2.9 ms** |
| `Tambora` via API | timeout (intermiten) | **14 ms** |
| `resolveLocation` 502 labeling | salah "geo-router" | akurat (backend vs geo) |
| Unit test geo-router | — | 14/14 pass |

## 6. Action Items

- [x] Fuse → worker thread (`search-worker.ts`); split `resolve` exact/fuzzy
- [x] LRU cache + guard resiliensi
- [x] Timeout API 5s→15s; handler sync (threadpool)
- [x] `friendlyError` akurat + `resolveLocation` sertakan body error
- [ ] **Future (opsional):** ganti single worker → **worker pool** (2–3) agar
      beberapa query fuzzy distinct jalan benar-benar paralel. Skrg single
      worker + cache cukup utk traffic admin.

## 7. Pelajaran

1. **CPU-bound di handler async = memblokir seluruh event loop.** Pindahkan ke
   worker thread (atau jadikan sync `def` agar Fastify threadpool yang menangani).
2. **Bedakan "backend down" vs "dependency down"** di pesan error user-facing —
   sertakan detail upstream agar klasifikasi akurat, jangan hard-code satu
   penyebab.
3. **Timeout klien harus > worst-case dependency + antrian konkurensi** kalau
   dependency-nya tidak benar-benar paralel.
4. **Cache di depan operasi mahal & berulang** (`/resolve` area yang sama
   dipukul berkali-kali oleh search page) = win besar dengan risiko nol.
