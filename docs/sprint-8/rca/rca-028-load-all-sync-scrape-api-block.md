# RCA-028 — `load_all` sync-scrape memblokir seluruh API (single-worker fatal)

> **Tanggal:** 2026-06-20
> **Sprint:** 8 — testing `load_all=true`
> **Severity:** Critical (API total down selama puluhan menit; bahkan `/health` timeout)
> **Layanan terdampak:** `POST /area/load` dgn `load_all=true`, SELURUH API (single worker)
> **Status:** ✅ Resolved

## 1. Ringkasan

`POST /area/load {"district":"Grogol Petamburan","load_all":true}` → endpoint
**tidak return**, dan **API total tidak responsif** (health check 5s timeout)
selama proses. Harus `kill -9` + restart utk pulih.

## 2. Gejala

- Endpoint hang >60s (curl `--max-time 30` terpotong, bash timeout 60s).
- `/health` concurrent → HTTP 000 (5s timeout) — **API down**.
- `ps`: uvicorn worker + scraper (gmaps-scraper) + chromium aktif, blocking.
- Baru pulih setelah `pkill -9 uvicorn` + `pkill -9 gmaps-scraper`.

## 3. Root Cause

**`_load_all_districts` (`orchestrator.py`) adalah leftover SYNCHRONOUS path.**

```python
for d in regency_districts:
    sr = ensure_scraped(name, postal_codes)   # ← SYNC: Go scraper per district
    ensure_processed(name)
    ensure_indexed(name)
```

Loop ini `ensure_scraped` (subprocess Go binary, menit/district) **inline** utk
setiap district di regency. "Administrasi Jakarta Barat" = 8 kecamatan → scrape
8× berurutan, blocking.

**Diperburuk Sprint 8 (`--workers 1`):** model bge-m3 ~2.3GB/worker memaksa
single worker. 1 request load_all → **worker eksklusif scrape** → API tidak bisa
serve request lain (termasuk `/health`).

Single-district di-async-kan di Sprint 6 (background pipeline via
`asyncio.to_thread`, return cepat `pipeline_started`), tapi `load_all`
**tidak ikut di-convert**. Sprint 8 memunculkan dampak fatalnya.

## 4. Perbaikan (Opsi A — cached-only)

`_load_all_districts` hanya load district yg **sudah cached**, skip yg belum:

```python
for d in regency_districts:
    if not is_area_cached(name):
        skipped.append(name)
        continue
    raw = _list_kos(name)        # in-process, cepat
    all_items.extend(_format_kos_items(raw))
return {..., "skipped_districts": skipped, ...}
```

Tidak ada scraping. Maksud `load_all` berubah: *"search across district yg sudah
berdata di regency ini"*, bukan *"scrape semuanya sekarang"*. District belum
berdata tetap di-scrape via async pipeline saat user load satu-satu (return cepat).

## 5. Verifikasi

| Check | Sebelum | Sesudah |
|-------|---------|---------|
| Endpoint time | hang (>60s) | **0.36s** |
| API responsif selama load_all | ❌ down | ✅ `/health` 1ms |
| District dimuat | sync scrape 8 | cached 3 (skip 5) |
| `skipped_districts` reported | — | `['Cengkareng','Kembangan',...]` ✓ |

## 6. Action Items

- [x] `_load_all_districts`: cache-check + skip uncached (no sync scrape)
- [x] response `skipped_districts` (juga pertahankan `failed_districts` utk backward-compat)
- [ ] **Frontend:** tampilkan note district mana yg di-skip + link load satu-satu
- [ ] **Future (Sprint 10):** jika "search all" utk regency baru penting, queue async multi-district dgn pipeline slot dedicated (bukan sync)

## 7. Pelajaran

1. **Saat convert ke async, AUDIT semua path sync** — single-district di-async, tapi `load_all` tertinggal. Refactor parsial = landmine.
2. **Single worker (= resource constraint) memperburuk blocking code** — code yg dulu "cuma lambat" jadi "fatal down". Saat pin workers=1 (model besar), pastikan TIDAK ADA sync long-running di request path.
3. **Endpoint blocking = DoS diri sendiri** — 1 request load_all = API unavailable utk semua user. Health check gagal = monitoring false-negative. Scrape (long-running) HARUS background.
