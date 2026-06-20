# RCA-029 — `ensure_processed` cached-too-lenient → area index 0 docs selamanya

> **Tanggal:** 2026-06-21
> **Sprint:** 8 — testing Cengkareng pipeline
> **Severity:** High (area ber-data raw tapi tidak pernah searchable; silent — tampak "completed" tapi 0 indexed)
> **Layanan terdampak:** pipeline `ensure_processed`, semua area yg punya docs file kosong
> **Status:** ✅ Resolved

## 1. Ringkasan

Pipeline Cengkareng `status: completed`, "Done: 0 new, 0 skipped", padahal raw
data 302 entries (semua punya `place_id`). Search Cengkareng → 0 results. Area
tampak "selesai" tapi **0 dokumen ter-index** selamanya.

## 2. Gejala

- `GET /pipeline/status` → `completed, "Done: 0 new, 0 skipped for Cengkareng"`.
- Dashboard: Cengkareng `scraped ✅ processed ✅ indexed ✅` tapi `docs_count: None`, `indexed_count: 26` (sisa run lama).
- `data/cleaned/Cengkareng_docs.json` → `[]` (0 docs, 2 bytes).
- `data/raw/Cengkareng/*.jsonl` → 302 entries, **semua punya `place_id`** (raw bagus).
- Search `"kos di cengkareng"` → 0 results.

## 3. Root Cause

**`ensure_processed` cek cached hanya dari file exists, bukan konten.**

```python
def ensure_processed(area):
    docs_path = .../f"{area}_docs.json"
    if docs_path.exists():          # ← file [] (2 byte) juga lolos
        return {"status": "cached"}
    ...
```

Sebuah run gagal/partial sebelumnya menulis `Cengkareng_docs.json = []` (mungkin
saat itu raw belum di-scrape, jadi parse 0 entries → 0 docs → save `[]`). Setelah
itu, **semua pipeline run berikutnya** lihat file exists → "cached" → **skip
reprocess** → ingest empty docs → 0 indexed. Selamanya stuck.

`is_area_cached` (untuk `/area/load`) sebenarnya sudah cek `size > 100`, jadi
area ini tidak dianggap cached di load layer — pipeline tetap di-trigger. Tapi
`ensure_processed` (di dalem pipeline) lebih lenient → kontradiksi → pipeline
jalan tapi process skip.

**4 area kena** (docs file 0–31 bytes): Cengkareng, Cilincing, Tanjung Priok,
Jatiasih.

## 4. Perbaikan

`ensure_processed` verifikasi konten (size > 100), konsisten dgn `is_area_cached`:

```python
if docs_path.exists():
    try:
        if docs_path.stat().st_size > 100:
            return {"status": "cached"}
    except OSError:
        pass
    # file exists tapi kosong/garbage → reprocess
```

## 5. Verifikasi & Recovery

- **Fix**: Cengkareng_docs.json (2 byte) → sekarang `ensure_processed` reprocess.
- **Recovery**: hapus docs kosong + reprocess Cengkareng:
  - process: 203 docs (dari 302 raw setelah dedup).
  - ingest: 160 new + 43 skipped (sisa) = 203.
  - Cengkareng dashboard: `docs_count: 203, indexed_count: 174` ✓.
  - Search `"kos di cengkareng"` → 3 results ✓.
- 3 victim lain (Cilincing/Tanjung Priok = placeholder raw sprint-7; Jatiasih =
  no raw) → docs kosong dihapus; butuh real scrape utk berdata.

## 6. Action Items

- [x] `ensure_processed`: cek `size > 100`, bukan cuma `.exists()`
- [x] Hapus docs kosong 4 area + recover Cengkareng
- [ ] **Sprint 9 (Re-scrape/Re-process action):** tombol "Process & Index" akan
      auto-fix kasus ini — user bisa re-trigger process tanpa SSH. Bug ini tepat
      jadi use-case utk action trigger sprint-9.
- [ ] **Future:** `process_area` jangan save `[]` kalau 0 docs (fail loud, jangan
      tulis file kosong).

## 7. Pelajaran

1. **"Cached" check harus verifikasi konten, bukan keberadaan file.** File exists
   ≠ valid. Empty/garbage file (dari run gagal) adalah jebakan klasik.
2. **Kontrak antar layer harus konsisten** — `is_area_cached` (size>100) vs
   `ensure_processed` (exists) kontradiktif. Cache predicate satu definisi.
3. **"Completed" + 0 hasil = red flag** — pipeline report sukses tapi output 0
   harusnya trigger alarm. Tambah validasi: "Done: 0 new" saat raw ada data →
   warning/error, bukan happy path.
4. **Bug ini jadi justifikasi kuat utk Sprint 9 action triggers** — admin bisa
   re-process area stuck tanpa SSH/CLI. Visibility (dashboard) + control (action)
   = loop tertutup.
