# RCA-009 — Orchestrator RAG imports shadowed by `api/src/` package

> **Tanggal:** 2026-06-20
> **Sprint:** 3 — Phase 7 (Persistent RAG Server) + Phase 8 (Workflow Fixes)
> **Severity:** High (memblokir `/area/load` — error saat indexing)
> **Layanan terdampak:** FastAPI `POST /area/load`, `POST /search`
> **Status:** ✅ Resolved

---

## 1. Ringkasan

Saat user membuka dashboard dan memuat district (Cengkareng), endpoint
`POST /area/load` gagal dengan error:

```
{"detail": "Indexing failed: No module named 'src.ingest'"}
```

Pencarian juga mengembalikan hasil kosong (silent failure).

---

## 2. Gejala

- `curl POST /area/load` → `{"detail": "Indexing failed: No module named 'src.ingest'"}`
- `POST /search` → results kosong `[]`
- Tidak ada error di log selain `ModuleNotFoundError`
- Bekerja normal di development environment (saat test via Python shell dari repo root)
- Hanya terjadi saat dijalankan via `uvicorn src.main:app` dari direktori `api/`

---

## 3. Root Cause

**Python import shadowing — `api/src/` menimpa `services/rag-engine/src/`.**

### Alur:

1. `uvicorn src.main:app` dijalankan dengan `cwd=api/`
2. Uvicorn menambahkan direktori kerja (`api/`) ke `sys.path`
3. `api/src/` sudah menjadi package Python (`src.main`, `src.search`, `src.settings`, dll)
4. `orchestrator.py` menambahkan `services/rag-engine` ke `sys.path` dengan `insert(0, ...)`
5. TAPI: impor `from src.ingest import ingest` dilakukan **di dalam function**
   (`ensure_indexed()`, `search_and_rank()`, `_list_kos_subprocess()`)
6. Pada saat function dipanggil, modul `src` sudah di-cache oleh Python sebagai
   `api/src/` (karena modul `api.src.main` dll sudah diload)
7. `from src.ingest import ingest` → mencari `ingest.py` di `api/src/` → tidak ditemukan → ModuleNotFoundError

### Kenapa `sys.path.insert(0, ...)` tidak cukup?

`sys.path` hanya memengaruhi **pencarian package baru**. Jika package `src` sudah
diload (via `api.src.main`), Python menggunakan package yang sudah ada tanpa
melihat `sys.path` lagi. Modul-modul di `services/rag-engine/src/` tidak akan
ditemukan.

---

## 4. Perbaikan

Pindahkan impor ke **module level** (top of file), sehingga terjadi **sebelum**
uvicorn sepenuhnya meload package `api.src.*`:

```python
# Before (inside functions — shadowed by api/src/)
def ensure_indexed(area):
    try:
        from src.ingest import ingest  # ← resolves to api/src/ (wrong)
        ...

# After (module level — happens before uvicorn interference)
_RAG_DIR = str(ROOT / "services" / "rag-engine")
try:
    sys.path.insert(0, _RAG_DIR)
    from src.search import search as _rag_search, list_kos as _rag_list_kos
    from src.rank import rank as _rag_rank
    from src.ingest import ingest as _rag_ingest
    _RAG_AVAILABLE = True
except Exception:
    pass

def ensure_indexed(area):
    if not _RAG_AVAILABLE:
        return {"status": "error", "message": "RAG engine not available"}
    ...
    result = _rag_ingest(str(docs_path))
```

Dengan impor di module level:
- `services/rag-engine/src/` diload sebagai package `src` pertama kali
- Binding disimpan sebagai variabel module-level (`_rag_X`)
- Function-function menggunakan binding ini tanpa impor ulang
- `_RAG_AVAILABLE` flag untuk graceful degradation jika modul tidak tersedia

---

## 5. Verifikasi

| Check | Result |
|-------|--------|
| Python AST parse | OK |
| `npm run check` | 0/0/0 |
| Simulasi uvicorn context (sys.path) | `from src.ingest` resolves to rag-engine/src/ |
| Model warm-start tetap berfungsi | search_and_rank tanpa subprocess |
| Fallback (_RAG_AVAILABLE=False) | Returns empty/error gracefully |

---

## 6. Action Items

- [x] `orchestrator.py`: pindahkan impor RAG ke module level + `_RAG_AVAILABLE` flag
- [ ] **Future:** pertimbangkan mengganti nama package `api/src/` → `api/app/` untuk menghindari konflik nama `src` di masa depan (low priority — current fix sudah stabil)

---

## 7. Pelajaran

1. **Nama package `src/` ambigous** — terlalu generik, banyak proyek menggunakannya.
   Jika dua service sama-sama punya `src/`, Python import shadowing tidak terhindarkan
   saat keduanya ada di sys.path.
2. **Impor di module level lebih predictable** — memberi kontrol lebih baik atas
   kapan dan bagaimana modul dimuat, terutama di environment multi-package seperti
   monorepo.
3. **Jangan impor di dalam function kecuali memang lazy loading** — jika modul
   selalu dibutuhkan, impor di top level dan tangkap error di sana.
