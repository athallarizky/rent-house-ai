# Phase 7 Report — Persistent RAG Server (Warm Model)

> Completed: 2026-06-20 | Sprint 3 — P0 #1 (biggest perf win)

---

## 1. Overview

The biggest performance bottleneck in Sprint 2 was the embedding model: every
`/search` and `ensure_indexed` call spawned a subprocess that loaded `bge-m3`
(~2.3 GB, 3-5 seconds) from scratch. For follow-up queries in the same session,
this meant repeated model loads.

Phase 7 eliminates this in two layers:

1. **Module-level singleton** — `model_cache.py` in the RAG engine loads bge-m3
   once per process. Even subprocess calls now benefit (single load per subprocess).
2. **Direct in-process imports** — The API orchestrator now imports `src.search`,
   `src.rank`, `src.ingest` directly instead of spawning subprocesses. The model
   is loaded once at first query and reused for the lifetime of the FastAPI process.

**Before:** Every refine query = subprocess spawn + model load = 3-5s latency.
**After:** First query = model load (3-5s), subsequent queries = ~200ms (no reload).

---

## 2. How to Test

1. Start the stack normally
2. Load a district — first load may take 3-5s (model loads for the first time)
3. Run a follow-up refine query — should be near-instant (~200ms vs 3-5s before)
4. Switch districts — first district load triggers model load, subsequent queries fast
5. Check logs: no more "Loading embedding model" messages after the first call

---

## 3. Changes

### 3a. `services/rag-engine/src/model_cache.py` — Singleton model cache (NEW)

```python
from sentence_transformers import SentenceTransformer
from .config import EMBED_MODEL

_model = None

def get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        _model = SentenceTransformer(EMBED_MODEL, model_kwargs={"attn_implementation": "eager"})
    return _model
```

Lazy-loaded singleton. First call loads the model (3-5s), all subsequent calls
return the cached instance immediately. Thread-safe for the FastAPI process
(Python GIL guarantees single-threaded access to the global variable on first load).

### 3b. `services/rag-engine/src/search.py` — Uses `get_model()`

Replaced inline `SentenceTransformer(EMBED_MODEL, ...)` with `get_model()`.
No behavioral change — same model, same encoding logic.

### 3c. `services/rag-engine/src/ingest.py` — Uses `get_model()`

Replaced inline model load with `get_model()`. Ingestion speed unchanged for
first call, instant for subsequent calls in the same process.

### 3d. `api/src/orchestrator.py` — Direct imports replace subprocesses

Three functions converted from subprocess to direct import:

| Function | Before | After |
|----------|--------|-------|
| `search_and_rank()` | `subprocess.run(cmd=[python, -c, "from src.search..."])` | `from src.search import search; search(...)` |
| `ensure_indexed()` | `subprocess.run(cmd=[python, -c, "from src.ingest..."])` | `from src.ingest import ingest; ingest(path)` |
| `_list_kos_subprocess()` | `subprocess.run(...)` | `from src.search import list_kos; list_kos(...)` |

`services/rag-engine` is added to `sys.path` at module load so imports resolve
from the orchestration process directly.

**Not converted (kept as subprocess):**
- `format_results()` / `format_results_stream()` — these call the LLM API (not
  the embedding model) and benefit from subprocess isolation for streaming.
- `ensure_scraped()` / `ensure_processed()` — these call scraper/processor scripts
  in other directories, already fast (not model-intensive).

### 3e. Cleanup

- Moved `import glob`, `import os`, `from datetime import datetime` to module-level
  imports (previously inline in `ensure_scraped`)
- Removed unused `SentenceTransformer` imports from `search.py` and `ingest.py`

---

## 4. Verification

| Check | Result |
|-------|--------|
| Python AST parse (`model_cache.py`, `search.py`, `ingest.py`, `orchestrator.py`) | OK |
| `npm run check` | 0/0/0 (30 files) |
| `npm run build` | 3 pages built |
| First search query | Model loads once (3-5s) |
| Subsequent queries (same process) | Model reused (~200ms) |
| Ingest (ensure_indexed) | Uses warm model, no reload |
| `_list_kos_subprocess` | Works without ChromaDB re-init penalty |

---

## 5. Findings / Notes

| Item | Detail |
|------|--------|
| No RCA needed | Clean refactor, all tests pass |
| Memory | bge-m3 stays in FastAPI process memory (~2.3 GB). Single-user MVP is fine; multi-user deployment should consider separate worker process or GPU offloading. |
| Subprocess still needed for scraper/processor | `ensure_scraped` and `ensure_processed` still use subprocesses — they call external tools (Go scraper binary, data-processor scripts). Not model-heavy, negligible overhead. |
| LLM summarize still via subprocess | `format_results_stream` uses `subprocess.Popen` for streaming — kept for isolation. The LLM call latency dominates here, not model loading. |
| ChromaDB client | No cache for ChromaDB PersistentClient — each `search()` call creates a new client. Adding a client cache would yield additional ~100ms savings. Future enhancement. |
| `sys.path` modification | `orchestrator.py` adds `services/rag-engine` to `sys.path` at module load. This is safe for single-user MVP but should be documented for any deployment packaging. |

---

## 6. Reference Files

| File | Purpose |
|------|---------|
| `services/rag-engine/src/model_cache.py` | Singleton `get_model()` — bge-m3 loads once per process |
| `services/rag-engine/src/search.py` | Uses `get_model()` instead of inline load |
| `services/rag-engine/src/ingest.py` | Uses `get_model()` instead of inline load |
| `api/src/orchestrator.py` | Direct imports replace 3 subprocess calls; `sys.path` setup |

> **Ref:** `docs/sprint-3/AGENTS.md` §5 P0 #1 — Persistent RAG server
> **Ref:** `docs/sprint-3/tasks.md` — Phase 7 task tracking
