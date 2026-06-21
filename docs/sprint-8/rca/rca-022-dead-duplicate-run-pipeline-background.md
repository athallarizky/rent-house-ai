# RCA-022 — Dead duplicate `run_pipeline_background` (latent `NameError`)

> **Tanggal:** 2026-06-20
> **Sprint:** 8 — Phase 1 cleanup (T1.3)
> **Severity:** Low (latent — code path tidak pernah dieksekusi, tapi landmine untuk refactor)
> **Layanan terdampak:** tidak ada (dead code); berpotensi `NameError` jika dipanggil
> **Status:** ✅ Resolved (dead code dihapus)

## 1. Ringkasan

`orchestrator.py` mendefinisikan function `run_pipeline_background` **dua kali**
(~line 177 dan ~525). Versi pertama memakai `functools.partial` tanpa
`import functools` — `NameError` laten. Versi kedua (benar, tanpa functools)
menimpa yg pertama, sehingga bug tidak pernah terpicu.

## 2. Gejala

- Tidak ada gejala runtime (dead code tidak dipanggil)
- Ditemukan saat code review Sprint 8: `grep functools` menemukan pemakaian tanpa import
- `is_area_cached` juga redefined 2x (line 21 & 159) — pola shadowing sama

## 3. Root Cause

**Duplikasi definisi function + import yg hilang.** Kemungkinan origin: saat
Sprint 6, `run_pipeline_background` di-refactor (versi awal pake
`functools.partial`, versi akhir inline `asyncio.to_thread`), tapi versi lama
tidak dihapus. Python hanya menyimpan definisi **terakhir** saat module load —
versi pertama menjadi dead code.

```python
async def run_pipeline_background(area, postal_codes, force=False):  # line ~177 (DEAD)
    ...
    scrape_result = await asyncio.to_thread(
        functools.partial(ensure_scraped, area, postal_codes, force)  # ← functools undefined
    )
    ...

async def run_pipeline_background(area, postal_codes, force=False):  # line ~525 (ACTIVE)
    ...
    scrape_result = await asyncio.to_thread(ensure_scraped, area, postal_codes, force)  # OK
```

Jika seseorang menghapus versi kedua (mengira redundant) atau reorder, versi
pertama akan jalan → `NameError: name 'functools' is not defined` saat pipeline
background di-trigger.

## 4. Perbaikan

Hapus dead duplicate (line 177-215) sepenuhnya. **Jangan** "fix" dgn menambah
`import functools` — itu menyelamatkan dead code, bukan menghilangkannya.

## 5. Verifikasi

| Check | Result |
|-------|--------|
| `grep "def run_pipeline_background" orchestrator.py` | 1 definisi (sebelumnya 2) |
| `grep functools orchestrator.py` | 0 pemakaian |
| `py_compile` | OK |
| Background pipeline tetap jalan | ✓ (Sprint 8 benchmark pipeline area baru) |

## 6. Action Items

- [x] Hapus dead duplicate `run_pipeline_background` (177-215)
- [ ] **Note:** `is_area_cached` juga redefined 2x — pertahankan versi terakhir
      (line 159, cek docs file), hapus yg pertama (line 21). Out of scope sprint ini.

## 7. Pelajaran

1. **Refactor harus hapus versi lama**, bukan tambah yg baru di sampingnya.
   Duplikasi definisi = landmine: silent sampai seseorang menghapus yg "salah".
2. **`grep <symbol>` sebelum hapus import** — verifikasi tidak ada pemakaian
   tersisa. Sebaliknya, pemakaian tanpa import = code smell (dead atau buggy).
3. **Dead code lebih berbahaya dari tidak ada code** — memberi ilusi ada 2 cara,
   menyulitkan refactor, menyembunyikan bug laten. Hapus, jangan biarkan.
