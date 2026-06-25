# RCA-036 — Scrape area di-timeout 600s, progress hilang & proses Go orphan

> **Tanggal:** 2026-06-25
> **Sprint:** 14 (reliability batch — jalur `app/e5-small-embedding`)
> **Severity:** High (scrape area besar selalu gagal di tengah jalan; data partial dipakai; zombie process)
> **Layanan terdampak:** pipeline scraping — `POST /pipeline/rescrape`, search-triggered scrape (`load_area`), `services/scraper/src/run.py`, `api/src/orchestrator.py`
> **Branch:** `feat/pipeline-percode-resume` (base `app/e5-small-embedding`)
> **Status:** ✅ Resolved

## 1. Ringkasan

Scrape area **Tambora** (10 kodepos) selalu berakhir **di-timeout setelah 600 detik**,
hanya 8/10 kodepos selesai, dan 2 kodepos (11230, 11260) tidak pernah di-scrape.
Lebih buruk: data partial yang tersisa tetap dipakai (dianggap complete), proses
Go `gmaps-scraper` jadi **zombie**, dan re-scrape berikutnya **mulai dari awal**
(tidak ada resume).

## 2. Gejala

- Pipeline `status: "completed"` tapi `progress: "Pipeline error: ... timed out after 600 seconds"`.
- `data/raw/Tambora/` hanya 8 file `*.jsonl` (missing `11230`, `11260`).
- `[gmaps-scraper] <defunct>` (zombie) tersisa di container `kos-api`.
- Klik Rescrape → scrape semua kodepos **dari nol** lagi (progress tidak diingat).

## 3. Root Cause

Empat masalah berlapis di `orchestrator.py` & `run.py`:

1. **Timeout di layer yang salah.** `ensure_scraped` membungkus **seluruh**
   `scrape_area` (semua kodepos) dengan `subprocess.run(..., timeout=600)`.
   10 kodepos × ~1 menit > 10 menit → kill di tengah. Per-code sebenarnya
   sudah punya timeout 300s sendiri di `run_scrape`, jadi timeout luar ini
   berlebihan dan fatal.

2. **Partial output dianggap complete.** `missing_codes()` / `all_cached()`
   hanya cek `path.exists()`. Kodepos yang di-kill mid-scrape meninggalkan
   `<code>.jsonl` (mungkin potongan) → dianggap "sudah" → **di-skip saat resume**
   (data rusak dipertahankan, kodepos tak pernah diselesaikan).

3. **Proses anak tidak di-reap.** `subprocess.run` tanpa `start_new_session` →
   saat `python -c` parent di-kill, anak `gmaps-scraper` (Go) tidak ikut
   terbunuh → orphan / zombie (`<defunct>`).

4. **Tidak ada resume.** `run_rescrape_background` memanggil
   `ensure_scraped(..., force=True)` → `scrape_area(force=True)` scrape **semua**
   kodepos dari awal, mengabaikan yang sudah complete.

## 4. Perbaikan

- **Hapus timeout luar 600s** (`orchestrator.py:ensure_scraped`). Andalkan
  per-code 300s di `run_scrape` — area sekarang berjalan sampai selesai.
- **Atomic writes** (`run.py:run_scrape`): scrape ke `<code>.jsonl.part`,
  `os.replace` → `<code>.jsonl` **hanya** saat exit bersih. `.jsonl` ada ⟺
  complete; run yang terbunuh meninggalkan hanya `.part` (diabaikan semua reader).
- **Process-group kill** (`start_new_session=True` di `run_scrape` &
  `ensure_scraped`) → anak Go ikut terbunuh, anti-zombie.
- **Manifest per-kodepos** `data/raw/<area>/_scrape_state.json`
  (`services/scraper/src/state.py`): tiap kodepos `waiting → running →
  completed | failed` (+ alasan error). `scrape_area` resume: scrape hanya kode
  tanpa `.jsonl` complete ∪ `failed`.

## 5. Verifikasi

| Check | Sebelum | Sesudah |
|-------|---------|---------|
| Scrape 10 kodepos | timeout @ 600s (8/10) | selesai semua (per-code 300s) |
| Kodepos partial | dianggap complete | `.part` → re-scrape |
| Zombie `gmaps-scraper` | ada (`<defunct>`) | tidak (process group) |
| Resume kode gagal | restart dari awal | hanya kode missing/failed |
| Live retry 11230 | — | failed→running→completed (61 kos) → index 306 docs |

## 6. Action Items

- [x] Hapus timeout 600s; atomic `.part`→`.jsonl`; `start_new_session`
- [x] Manifest per-kodepos + resume mode (`state.py`, `run.py`)
- [x] `POST /pipeline/resume` + tampilan per-kodepos di dashboard (RCA-037)
- [ ] **Future:** worker pool di geo-router (RCA-038) untuk paralelisme penuh

## 7. Pelajaran

1. **Timeout harus di layer unit kerja, bukan seluruh batch.** Timeout luar
   yang < (jumlah unit × timeout per-unit) pasti memotong di tengah.
2. **Output partial harus dibedakan dari complete** — atomic write (temp +
   rename) adalah cara standar agar "file ada" = "utuh".
3. **Subprocess child harus di-reap** — `start_new_session` + process-group
   kill, kalau tidak jadi orphan/zombie.
4. **Operasi long-running harus idempotent + resumable.** Tanpa resume, setiap
   kegagalan = mulai dari nol (boros kuota Google Maps).
