# RCA-019 — `POST /search` 500 saat model unavailable (bridge import di luar try)

> **Tanggal:** 2026-06-20
> **Sprint:** 8 (In-Process RAG) — Phase 2 verification
> **Severity:** High (search crash 500 saat bridge gagal load — bukan graceful degradation)
> **Layanan terdampak:** `POST /search` (mode=rag maupun ai), semua path yg pakai `search_and_rank`
> **Status:** ✅ Resolved

## 1. Ringkasan

Saat pengujian lokal Sprint 8 (venv tanpa torch/chromadb), `POST /search`
mengembalikan **HTTP 500 Internal Server Error**, bukan graceful empty results.
Padahal tujuan desain lazy-bridge adalah degradasi gracefully saat model absent.

## 2. Gejala

```
POST /search {"query":"kos putri","area":"Bekasi Timur","mode":"rag"}
→ HTTP 500 Internal Server Error
```
- Startup log: `[startup] bge-m3 load failed: ModuleNotFoundError("No module named 'chromadb'")`
- `/health` → `model_ready: false` (startup graceful ✓)
- Tapi `/search` crash 500, bukan `[]`

## 3. Root Cause

Di `orchestrator.py:search_and_rank`, lazy accessor `_rag()` dipanggil **di luar
try block**:

```python
def search_and_rank(query, area, top_k=5, regency=None):
    kec_filter = _resolve_kecamatan(area, regency)
    rag = _rag()                    # ← DI LUAR try
    try:
        results = rag.search(...)   # hanya bagian ini yg di-guard
        ranked = rag.rank(results)
    except Exception:
        return []
    return [...]
```

`_rag()` melakukan `from . import rag_bridge` — yg me-load rantai import
`search.py → db.py → import chromadb`. Tanpa chromadb → `ImportError` terjadi di
baris `rag = _rag()`, **di luar try**, sehingga propagate ke handler → 500.

Konversi function-function lain (`ensure_indexed`, `format_results`,
`_list_kos`) sudah menaruh `_rag()` di dalam try (sebagai `_rag().method()`),
hanya `search_and_rank` yg terlewat.

## 4. Perbaikan

Pindahkan `rag = _rag()` ke dalam try block:

```python
def search_and_rank(query, area, top_k=5, regency=None):
    kec_filter = _resolve_kecamatan(area, regency)
    try:
        rag = _rag()
        results = rag.search(query_text=query, kecamatan=kec_filter, top_k=...)
        ranked = rag.rank(results)
    except Exception:
        return []
    return [...]
```

## 5. Verifikasi

| Check | Result |
|-------|--------|
| Sebelum fix | `/search` mode=rag → HTTP 500 |
| Setelah fix | `/search` mode=rag → HTTP 200, `results: []` (graceful) |
| Saat model ready | search tetap return hasil (~50ms) |

## 6. Action Items

- [x] Pindahkan `rag = _rag()` ke dalam try di `search_and_rank`
- [ ] **Future:** pertimbangkan guard eksplisit `app.state.model_ready` di handler
      search → return 503 dgn pesan jelas (bukan silent `[]`) — UX lebih baik

## 7. Pelajaran

1. **Lazy import HARUS di dalam try** kalau function-nya menjanjikan graceful
   degradation. Satu baris di luar try membatalkan seluruh kontrak graceful.
2. **Konsistensi pattern** — saat convert beberapa function dgn pola yg sama,
   review semua call site. Satu function terlewat (`search_and_rank`) cukup
   untuk menghasilkan regression.
3. **Graceful degradation perlu diuji pada kondisi gagal** — local venv tanpa
   deps adalah test environment berharga untuk verifikasi fallback path.
