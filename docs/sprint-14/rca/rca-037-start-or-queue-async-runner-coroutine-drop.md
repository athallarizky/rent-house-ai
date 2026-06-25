# RCA-037 — `_start_or_queue` menjatuhkan coroutine runner (pipeline slot stuck selamanya)

> **Tanggal:** 2026-06-25
> **Sprint:** 14 (reliability batch — jalur `app/e5-small-embedding`)
> **Severity:** Critical (pipeline slot nempel permanen; `/rescrape` & `/resume` diam-diam tidak pernah jalan; semua aksi lain terblokir)
> **Layanan terdampak:** `POST /pipeline/{rescrape,resume}` via `_start_or_queue` (`api/src/pipeline_data.py`)
> **Branch:** `feat/pipeline-percode-resume` (base `app/e5-small-embedding`)
> **Status:** ✅ Resolved

## 1. Ringkasan

`POST /pipeline/resume` (dan `/rescrape`) mengembalikan `200 {pipeline_started:
true}`, `state.running` ter-set ke area, tapi **runner tidak pernah dieksekusi**.
Tidak ada subprocess scrape, manifest tidak ter-update, dan slot pipeline **stuck
selamanya** — semua aksi lain ditolak ("Pipeline sedang aktif"). Hanya bisa
pulih dengan restart container (state in-memory hilang).

## 2. Gejala

- Response `200`, `pipeline.running = <area>`, `progress = "Starting pipeline for <area>..."`.
- Tapi `ps` di container: **tidak ada** proses scrape/python-c.
- Manifest `_scrape_state.json` tidak berubah (mtime stagnan).
- `progress` tidak pernah berubah dari "Starting pipeline..." (runner tak pernah
  set progress-nya).
- Semua aksi pipeline berikutnya → `pipeline_blocked` / "sedang aktif".

## 3. Root Cause

Pola pemanggilan runner di `_start_or_queue`:

```python
# pipeline_data.py — LAMA
return _start_or_queue(req.area, lambda a: run_rescrape_background(a, postal_codes), background_tasks)
...
def _start_or_queue(area, runner_factory, background_tasks):
    ...
    background_tasks.add_task(runner_factory, area)   # ← lambda sync
```

`runner_factory` adalah **lambda sync** yang **mengembalikan** coroutine
(`run_*_background` adalah `async`). Starlette mengecek
`asyncio.iscoroutine_function(func)` pada func yang didaftarkan:

- lambda → `False` (sync) → Starlette menjalankannya via threadpool.
- Threadpool memanggil lambda → dapat **coroutine object** → **tidak di-await** →
  coroutine di-drop (warning `coroutine was never awaited`).
- `state.finish()` (di `finally` runner) tak pernah jalan → `running` tetap
  ter-set → slot stuck permanen.

`/index` & `/rebuild` **lolos** karena pass async func **langsung**
(`_start_or_queue(area, run_index_background, ...)` → terdeteksi coroutine →
di-await). Tapi `/rescrape` & `/resume` yang butuh arg tambahan (postal_codes /
code) dibungkus lambda → **broken**. Bug latent lama di `/rescrape`, baru
terkuasai saat `/resume` memakai pola yang sama.

## 4. Perbaikan

`_start_or_queue` menerima runner + extra args, lalu pass **langsung** ke
`add_task`:

```python
def _start_or_queue(area, runner, background_tasks, *runner_args):
    ...
    background_tasks.add_task(runner, area, *runner_args)   # async func → di-await
```

Callers:

```python
# /rescrape
return _start_or_queue(req.area, run_rescrape_background, background_tasks, postal_codes)
# /resume
return _start_or_queue(req.area, run_resume_background, background_tasks, postal_codes, req.code)
```

## 5. Verifikasi

| Check | Sebelum | Sesudah |
|-------|---------|---------|
| Runner dieksekusi | ❌ coroutine di-drop | ✅ progress = "Resume scrape..." |
| Subprocess scrape muncul | tidak ada | ada (Go binary jalan) |
| Manifest ter-update | stagnan | `running→completed` live |
| Slot selesai (`running=None`) | stuck selamanya | ✅ `state.finish()` jalan |

Repro retry kodepos 11230: `failed → running → completed (61 kos) → process →
index 306 docs`, lalu `running=None`.

## 6. Action Items

- [x] `_start_or_queue` terima `*runner_args`; pass runner langsung ke `add_task`
- [x] Update caller `/rescrape` & `/resume` (sekaligus fix latent bug `/rescrape`)
- [ ] **Tes otomatis:** assert background runner benar-benar berjalan & slot
      selesai (bukan hanya "started"), agar pola ini tidak regresi

## 7. Pelajaran

1. **Jangan bungkus async runner dalam lambda sync.** Gunakan `functools.partial`
   atau pass func + args langsung agar Starlette mendeteksinya sebagai coroutine.
2. **"Started" ≠ "running".** Status pipeline harus diverifikasi benar-benar
   mengeksekusi (progress berubah / subprocess hidup), bukan cuma return 200.
3. **Bug di path jarang dipakai (`/rescrape`) bisa latent lama** — pytest/manual
   test hanya menyentuh happy path. Saat menambah aksi baru (`/resume`) yang
   meniru pola lama, audit pola serupa.
