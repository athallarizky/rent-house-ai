# Sprint 8 — In-Process RAG: Faster & Lighter

> Status: ✅ Complete | Created: 2026-06-20
> Branch: `feat/in-process-embedding`
> Report: [`SUMMARY.md`](./SUMMARY.md) | Benchmark: [`baseline.md`](./baseline.md)
> Prerequisite: Sprint 6 (async pipeline) + Sprint 7 (pipeline dashboard) merged to `main`

Status legend: ⬜ pending | 🔵 in_progress | ✅ completed | ❌ blocked

---

## Goal

Eliminate subprocess overhead in the RAG pipeline by loading bge-m3 **once**
inside the FastAPI process and reusing it. Two outcomes, equally important:

1. **Faster** — search latency **5–13s → 50–100ms** (20–50x).
2. **Lighter** — no per-request Python interpreter spawns, no repeated 2.3 GB
   model reloads, no per-call ChromaDB client creation. One stable process
   instead of N heavy subprocesses spawned under each request.

> Reframe vs original: this sprint is an **optimization for lightness**, not only
> speed. Every converted subprocess removes a ~50–100 MB interpreter + torch
> import that today multiplies under concurrency. Resource stability is a
> first-class deliverable, measured in Phase 5.

## Problem Statement

Every RAG operation (search, ingest, summarize, list_kos) spawns a fresh Python
subprocess. Each one:

1. Starts a new interpreter (~50–100 MB RSS, **multiplies under concurrency**)
2. Imports sentence-transformers + torch (~1–2s)
3. Loads bge-m3 from disk (~3–5s, ~2.3 GB into RAM — reloaded every call)
4. Runs the actual op (~50–100ms)
5. Dies — model unloaded, memory freed (then re-allocated next call)

**Net:** 5–13s per search (mostly model load) **and** spiky RAM under load.
The real compute is <100ms.

### Current Subprocess Calls (6 total in `orchestrator.py`)

| Line | Function | Calls | Uses bge-m3? | Convert? |
|------|----------|-------|--------------|----------|
| ~91 | `ensure_scraped` | Go binary (scraper) | ❌ | ❌ Stay subprocess |
| ~115 | `ensure_processed` | `python -m src.pipeline` | ❌ | ✅ In-process |
| ~134 | `ensure_indexed` | `python -c "...ingest"` | ✅ | ✅ In-process |
| ~250 | `search_and_rank` | `python -c "...search, rank"` | ✅ | ✅ In-process |
| ~278 | `stream_summary` | `python -c "...summarize"` | ❌ | ✅ In-process |
| ~503 | `_list_kos_subprocess` | `python -c "...list_kos"` | ❌ | ✅ In-process |

**5 of 6 convert to in-process.** Only the Go scraper binary stays a subprocess.

## Solution

**sentence-transformers loaded at FastAPI startup, reused via `rag_bridge.py`.**

Codebase is ~90% ready: `sentence-transformers` installed, `model_cache.py`
singleton (`get_model()`) already used by `ingest.py` + `search.py`, bge-m3
1024-dim dense vectors already in ChromaDB.

### What Changes

1. **`rag_bridge.py`** adds rag-engine to `sys.path` + re-exports functions
2. **Load model at startup** via `@app.on_event("startup")` → `get_model()` once
3. **Replace 5 subprocess calls** with direct Python imports
4. **Cache the ChromaDB client** (new — `get_client()` singleton) so search/list/ingest
   stop recreating `PersistentClient` per call
5. **Pin uvicorn to 1 worker** — the 2.3 GB model is per-worker; multi-worker = OOM
6. **Keep scraper as subprocess** — Go binary, unchanged

### Expected Impact

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Search latency | 5–13s | 50–100ms | **20–50x** |
| Ingest latency (per area) | 30–60s overhead | 0s overhead | Eliminated |
| RAM under load | N × (interpreter+torch) spikes | +2.3 GB permanent, flat | **Stable** |
| Per-request process spawns | 1–3 subprocesses | 0 | **Eliminated** |
| ChromaDB client alloc/call | 1 | 0 (cached) | Eliminated |
| Startup time | ~3s | ~20–30s | One-time cost |
| Health check during search | Slow (CPU contention) | Always <10ms | Fixed |

### Trade-offs

- **+2.3 GB permanent RAM** — model stays resident. Fine on 8 GB VM (~3.1 GB total
  with ChromaDB + FastAPI). **Must run 1 worker** — see Phase 3 / Risks.
- **+15–25s startup** — one-time; health `start_period` bumped (Phase 4).
- **GIL** — bge-m3 inference is CPU-bound & holds GIL, but search is <100ms and
  Sprint 6's `asyncio.to_thread()` keeps Uvicorn responsive. Negligible.

---

## Tasks

### Phase 1 — Foundation (Import Bridge + Startup Load + Cleanup)

| ID | Task | File | Diff | Est | Status |
|----|------|------|------|-----|--------|
| 1.1 | `rag_bridge.py` — add rag-engine to `sys.path`, re-export funcs; **verify import works in BOTH Docker (`api.src.main`) and local dev (`src.main` from `api/`)** — the `src` package collision is the #1 landmine | `api/src/rag_bridge.py` (NEW), `api/src/main.py` | Easy | 0.5h | ⬜ |
| 1.2 | Pre-load bge-m3 at FastAPI startup via `get_model()`; graceful `try/except` so a model-load failure logs + continues (search returns 503) instead of crashing the container | `api/src/main.py` | Easy | 0.25h | ⬜ |
| 1.3 | **Remove dead duplicate `run_pipeline_background` (`orchestrator.py:177-215`).** It's shadowed by the real one at `:525` and references `functools` (never imported). Delete it — do NOT just add `import functools` to fix dead code | `api/src/orchestrator.py` | Trivial | 0.25h | ⬜ |

### Phase 2 — Convert Subprocess → In-Process

| ID | Task | File | Diff | Est | Status |
|----|------|------|------|-----|--------|
| 2.1 | `ensure_indexed` → direct `ingest()` call | `api/src/orchestrator.py` | Medium | 0.5h | ⬜ |
| 2.2 | `search_and_rank` → direct `search()` + `rank()` | `api/src/orchestrator.py` | Medium | 0.75h | ⬜ |
| 2.3 | `_list_kos_subprocess` → direct `list_kos()` | `api/src/orchestrator.py` | Easy | 0.25h | ⬜ |
| 2.4 | `ensure_processed` → direct `pipeline.process()` | `api/src/orchestrator.py` | Easy | 0.25h | ⬜ |
| 2.5 | `stream_summary` → async wrapper over `summarize_stream()` sync generator. Handle `StopIteration` cleanly in `run_in_executor` (no leaked thread-pool tasks); bump time vs original — sync→async generator wrapping is fiddly | `api/src/orchestrator.py` | Hard | 1.5h | ⬜ |

### Phase 3 — Resource Optimization (the "lighter" core, NEW)

| ID | Task | File | Diff | Est | Status |
|----|------|------|------|-----|--------|
| 3.1 | Cache ChromaDB `PersistentClient` + collection via `get_client()` / `get_collection()` singletons; refactor `search.py`, `ingest.py`, `list_kos` to use it (they each call `chromadb.PersistentClient(...)` per request today) | `services/rag-engine/src/db.py` (NEW) + call sites | Easy | 0.5h | ⬜ |
| 3.2 | Pin uvicorn to **1 worker** (model is 2.3 GB/worker → multi-worker OOMs). Add env guard / startup assertion + document the constraint in `Dockerfile.api` / compose | `scripts/docker-startup.sh`, `docker-compose.yml` | Trivial | 0.25h | ⬜ |
| 3.3 | *(Stretch)* Evaluate FP16 / int8 model load to cut ~2.3 GB → ~1.2 GB. **Defer if CPU inference penalty erases the latency win** — benchmark first | `services/rag-engine/src/model_cache.py` | Medium | 0.75h | ⬜ |

### Phase 4 — Docker & Health Check

| ID | Task | File | Diff | Est | Status |
|----|------|------|------|-----|--------|
| 4.1 | Bump health `start_period` to 60s (model load on boot) | `docker-compose.yml` | Trivial | 0.1h | ⬜ |
| 4.2 | Manual: `/health` stable <10ms **during** an active search (was slow before due to subprocess CPU contention) | Manual test | Easy | 0.25h | ⬜ |

### Phase 5 — Validation & Benchmarks

| ID | Task | Diff | Est | Status |
|----|------|------|-----|--------|
| 5.1 | Latency benchmark: same query+area, before vs after (use Sprint-7 dashboard as the observation tool) | Easy | 0.25h | ⬜ |
| 5.2 | **RAM benchmark:** peak RSS under 3 concurrent searches, before vs after — prove "lighter" | Easy | 0.25h | ⬜ |
| 5.3 | Regression: async pipeline (scrape → process → index) still works; live banner still updates | Easy | 0.25h | ⬜ |

---

## Task Details

### T1.1 — Import Bridge (`api/src/rag_bridge.py`)

Isolates `sys.path` manipulation in one module.

```python
import sys
from pathlib import Path

RAG_ENGINE = Path(__file__).resolve().parent.parent.parent / "services" / "rag-engine"
if str(RAG_ENGINE) not in sys.path:
    sys.path.insert(0, str(RAG_ENGINE))

from src.search import search, list_kos          # noqa: E402
from src.rank import rank                          # noqa: E402
from src.ingest import ingest                      # noqa: E402
from src.summarize import summarize, summarize_stream  # noqa: E402
from src.model_cache import get_model              # noqa: E402
from src.db import get_client, get_collection      # noqa: E402  (Phase 3)
```

**⚠️ Collision test (mandatory, not optional):** both `api/src` and
`services/rag-engine/src` are packages named `src`. Works in Docker (api runs as
`api.src.main`, so `src` resolves only to rag-engine). **Breaks in local dev** if
run as `uvicorn src.main` from `api/` — there `from src.search` hits
`api/src/search.py`. Verify in **both** contexts before signing off:

```bash
# Docker context
docker compose exec kos-api python -c "from api.src.rag_bridge import search; print(search.__module__)"
# Local-dev context (from api/ dir)
python -c "import sys; sys.path.insert(0,'.'); from src.rag_bridge import search; print(search.__module__)"
```
Expected: `src.search` (rag-engine), NOT `src.search` from api. If it resolves
wrong, rename the rag-engine package or load via `importlib.util.spec_from_file_location`.

### T1.2 — Startup Model Load (`api/src/main.py`)

```python
@app.on_event("startup")
async def startup():
    seed_admin()
    try:
        from .rag_bridge import get_model
        get_model()  # ~2.3 GB into process memory, ~15-25s first time
        app.state.model_ready = True
    except Exception as exc:
        app.state.model_ready = False
        print(f"[startup] model load failed: {exc} — search will return 503")
```
Search endpoints check `app.state.model_ready` and return 503 if False (don't
let a failed load cascade into a 500 with a stack trace).

### T1.3 — Delete Dead Duplicate `run_pipeline_background`

`orchestrator.py` defines `run_pipeline_background` **twice** (≈L177 and ≈L525).
Python keeps only the last (L525, the correct one used by Sprint 6). The L177
copy references `functools.partial` with no `import functools` — a latent
`NameError` that never fires only because it's shadowed. **Delete L177–215
entirely.** Do not "fix" dead code by adding the import.

### T2.2 — `search_and_rank` (in-process)

Signatures verified against `services/rag-engine/src/`:
`search(query_text, kecamatan, top_k, ...)`, `rank(results, user_lat, user_lon, ...)`,
`list_kos(kecamatan, limit)`, `ingest(docs_path, force)`,
`summarize_stream(query, results, model, chat_history)`.

```python
from .rag_bridge import search as rag_search, rank as rag_rank

def search_and_rank(query, area, top_k=5, regency=None):
    kec = _resolve_kecamatan(area, regency)
    results = rag_search(query_text=query, kecamatan=kec, top_k=max(top_k*3, 30))
    return rag_rank(results)
```

### T2.5 — `stream_summary` (hardest)

Wrap the sync generator in `run_in_executor`. Must drain cleanly:

```python
from .rag_bridge import summarize_stream

async def stream_summary(query, results, chat_history=None):
    loop = asyncio.get_event_loop()
    gen = iter(summarize_stream(query, results, chat_history=chat_history))
    with ThreadPoolExecutor(max_workers=1) as pool:
        while True:
            try:
                token = await loop.run_in_executor(pool, next, gen)
            except StopIteration:
                break
            yield token
```
Use a bounded `ThreadPoolExecutor` and always drain to completion to avoid
leaking a blocked thread if the client disconnects mid-stream.

### T3.1 — ChromaDB Client Singleton (`services/rag-engine/src/db.py`)

Today `search()`, `list_kos()`, `ingest()` each call `chromadb.PersistentClient(path=CHROMA_PATH)`.
After subprocess removal this becomes the next per-call overhead. Cache it:

```python
import chromadb
from .config import CHROMA_PATH, COLLECTION_NAME

_client = None
_collection = None

def get_client():
    global _client
    if _client is None:
        _client = chromadb.PersistentClient(path=CHROMA_PATH)
    return _client

def get_collection():
    global _collection
    if _collection is None:
        _collection = get_client().get_or_create_collection(
            COLLECTION_NAME, metadata={"hnsw:space": "cosine"})
    return _collection
```
Refactor `search.py`, `ingest.py` call sites to use `get_collection()`.

### T3.2 — Pin 1 Worker

`scripts/docker-startup.sh` must launch `uvicorn ... --workers 1` (it currently
uses the default = 1, but make it **explicit + asserted** so a future flag can't
silently OOM). Document in `Dockerfile.api`: *"model is 2.3 GB resident; scale
out via a separate TEI container (Sprint 9), not via uvicorn workers."*

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **`sys.path` `src` collision** (api vs rag-engine) | ImportError / wrong module | Isolate in `rag_bridge.py`; **test both Docker + local-dev contexts** (T1.1). Rename package if flaky |
| Multi-worker uvicorn → model duplicated → **OOM** | Container killed | Pin workers=1 (T3.2); TEI server is the scale-out path (Sprint 9) |
| Model load fails on boot → API down | Search 503 | `try/except` in startup, `app.state.model_ready` gate (T1.2) |
| Streaming executor leaks thread on client disconnect | Thread-pool exhaustion | Bounded `ThreadPoolExecutor`, drain/`cancel` on disconnect (T2.5) |
| GIL during concurrent search + pipeline | Slow responses | <100ms blocking; `asyncio.to_thread` from Sprint 6. If bad → Sprint 9 TEI |
| RAM (model + ChromaDB + FastAPI) | OOM on small VM | ~3.1 GB on 8 GB VM; monitor `docker stats`; stretch T3.3 quantization |

---

## Out of Scope

- **TEI / infinity embedding server** (Opsi 1) — separate HTTP container. Sprint 9
  if GIL contention or multi-worker scale is needed.
- **GPU acceleration** — CPU inference is <100ms at current scale.
- **Model quantization (int8/FP16)** — **stretch only (T3.3)**; deferred unless RAM
  is tight, because CPU FP16 may erase the latency win. Benchmark before adopting.
- **Scraper subprocess** — Go binary, unrelated.

---

## Sequencing Note

Doc prerequisite: **Sprint 6 + Sprint 7 merged to `main` first.** They currently
sit unmerged in `feat/pipeline-dashboard`. Sprint 8 mutates the same
`orchestrator.py`; branch `feat/in-process-embedding` from a clean `main` to avoid
triple-coupling. Bonus: the Sprint-7 pipeline dashboard is the observation tool
for T5.1/T5.2 benchmarks (you can watch ingest speed up live).

## Summary

| Phase | Tasks | Est |
|-------|-------|-----|
| 1 — Foundation + cleanup | 3 | 1.0h |
| 2 — Convert subprocess | 5 | 3.25h |
| 3 — Resource optimization (NEW) | 3 | 1.5h |
| 4 — Docker & health | 2 | 0.35h |
| 5 — Validation & benchmarks | 3 | 0.75h |
| **Total** | **16** | **~6.9h** |
