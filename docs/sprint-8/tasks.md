# Sprint 8 — In-Process Embedding (Eliminate Subprocess Overhead)

> Status: ⬜ Pending | Created: 2026-06-20
> Branch: `feat/in-process-embedding`
> Prerequisite: Sprint 6 (async pipeline) merged to main

Status legend: ⬜ pending | 🔵 in_progress | ✅ completed | ❌ blocked

---

## Goal

Eliminate subprocess overhead in RAG search/ingest pipeline. Load bge-m3 model
once at FastAPI startup, reuse across all requests. Reduce search latency from
**5–13s → 50–100ms** (20–50x improvement).

## Problem Statement

Current architecture spawns a new Python subprocess for every RAG operation
(search, ingest, summarize, list_kos). Each subprocess:

1. Starts a fresh Python interpreter (~200ms)
2. Imports sentence-transformers + torch (~1–2s)
3. Loads bge-m3 model from disk (~3–5s, ~2.3 GB into RAM)
4. Runs the actual operation (~50–100ms)
5. Dies — model unloaded, memory freed

**Net result:** 5–13 seconds per search query, most of which is model loading
overhead. The actual embedding computation is <100ms.

This also affects:
- **Pipeline indexing** (`ensure_indexed`): reloads model per ingest call
- **Summarize**: does NOT use bge-m3 (LLM-only), but still subprocess overhead
- **List kos**: does NOT use bge-m3 (metadata-only query), but still subprocess
- **Health check during search**: subprocess consumes CPU, slow health response

### Current Subprocess Calls (6 total in `orchestrator.py`)

| Line | Function | Calls | Uses bge-m3? | In-process? |
|------|----------|-------|-------------|-------------|
| ~91 | `ensure_scraped` | Go binary (scraper) | ❌ | ❌ Stay subprocess |
| ~115 | `ensure_processed` | `python -m src.pipeline` | ❌ | ✅ Convert |
| ~134 | `ensure_indexed` | `python -c "...ingest"` | ✅ | ✅ Convert |
| ~250 | `search_and_rank` | `python -c "...search, rank"` | ✅ | ✅ Convert |
| ~278 | `stream_summary` | `python -c "...summarize"` | ❌ | ✅ Convert |
| ~503 | `_list_kos_subprocess` | `python -c "...list_kos"` | ❌ | ✅ Convert |

**5 of 6 subprocess calls can be converted to in-process.** Only the Go scraper
binary must remain subprocess.

## Solution

**Approach: sentence-transformers + FastAPI startup load (Opsi 2)**

The codebase is already 90% ready:
- ✅ `sentence-transformers` v5.6.0 installed
- ✅ `model_cache.py` singleton with `get_model()` exists
- ✅ bge-m3 compatible (1024-dim dense, already used by `ingest.py` + `search.py`)

### What Changes

1. **Add `sys.path` entry for rag-engine** — so API can `import` rag-engine modules directly
2. **Load model at FastAPI startup** — `@app.on_event("startup")` triggers `get_model()` once
3. **Replace 5 subprocess calls with direct Python imports** — `from services.rag_engine.src.search import search`
4. **Keep scraper as subprocess** — Go binary, no change
5. **Handle streaming summarize** — replace stdin/stdout subprocess with async generator

### Expected Impact

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Search latency | 5–13s | 50–100ms | **20–50x** |
| Ingest latency (per area) | 30–60s overhead | 0s overhead | **Eliminated** |
| RAM usage | Spikes 2.3GB per query | +2.3GB permanent | Trade-off |
| Startup time | ~3s | ~20–30s | One-time cost |
| Health check stability | Slow during search | Always <5ms | **Fixed** |

### Trade-offs

- **+2.3 GB permanent RAM** — model stays loaded in FastAPI process. Acceptable
  on 8GB Colima VM or Hetzner CX32 (8GB).
- **+15–25s startup time** — one-time cost on container boot. Health check must
  account for this (increase `start_period` in docker-compose).
- **GIL contention** — model inference is CPU-bound and holds GIL. With
  `asyncio.to_thread()` in Sprint 6, FastAPI can still serve requests while
  inference runs. Search is <100ms so blocking is negligible.

---

## Tasks

### Phase 1 — Foundation (Model Load + Import Bridge)

| ID | Task | File | Diff | Est | Status |
|----|------|------|------|-----|--------|
| 1.1 | Add rag-engine to Python path + verify in-process import works | `api/src/main.py`, `api/src/rag_bridge.py` (NEW) | Easy | 0.5h | ⬜ |
| 1.2 | Load bge-m3 at FastAPI startup via `get_model()` | `api/src/main.py` | Easy | 0.25h | ⬜ |
| 1.3 | Fix missing `import functools` in orchestrator.py (latent bug from Sprint 6) | `api/src/orchestrator.py` | Trivial | 0.1h | ⬜ |

### Phase 2 — Convert Subprocess Calls

| ID | Task | File | Diff | Est | Status |
|----|------|------|------|-----|--------|
| 2.1 | Convert `ensure_indexed` — subprocess → direct `ingest()` call | `api/src/orchestrator.py` | Medium | 0.5h | ⬜ |
| 2.2 | Convert `search_and_rank` — subprocess → direct `search()` + `rank()` calls | `api/src/orchestrator.py` | Medium | 0.75h | ⬜ |
| 2.3 | Convert `_list_kos_subprocess` — subprocess → direct `list_kos()` call | `api/src/orchestrator.py` | Easy | 0.25h | ⬜ |
| 2.4 | Convert `ensure_processed` — subprocess → direct `pipeline.process()` call | `api/src/orchestrator.py` | Easy | 0.25h | ⬜ |
| 2.5 | Convert `stream_summary` — subprocess stdout → async generator | `api/src/orchestrator.py` | Hard | 1h | ⬜ |

### Phase 3 — Docker & Health Check

| ID | Task | File | Diff | Est | Status |
|----|------|------|------|-----|--------|
| 3.1 | Update `docker-compose.yml` health check `start_period` to 60s (model load) | `docker-compose.yml` | Trivial | 0.1h | ⬜ |
| 3.2 | Verify health endpoint stable during search (must stay <10ms) | Manual test | Easy | 0.25h | ⬜ |

### Phase 4 — Validation & Benchmarks

| ID | Task | Diff | Est | Status |
|----|------|------|-----|--------|
| 4.1 | Benchmark: search latency before vs after (same query, same area) | Easy | 0.25h | ⬜ |
| 4.2 | Integration test: full search → rank → summarize flow via Tailscale | Easy | 0.25h | ⬜ |
| 4.3 | Regression test: pipeline (scrape → process → index) still works async | Easy | 0.25h | ⬜ |

---

## Task Details

### T1.1 — Import Bridge (`api/src/rag_bridge.py`)

Create a bridge module that adds rag-engine to `sys.path` and re-exports key
functions. This isolates path manipulation in one place.

```python
# api/src/rag_bridge.py
import sys
from pathlib import Path

# Add rag-engine to Python path
RAG_ENGINE = Path(__file__).resolve().parent.parent.parent / "services" / "rag-engine"
if str(RAG_ENGINE) not in sys.path:
    sys.path.insert(0, str(RAG_ENGINE))

# Re-export for convenient imports
from src.search import search, list_kos          # noqa: E402
from src.rank import rank                          # noqa: E402
from src.ingest import ingest                      # noqa: E402
from src.summarize import summarize, summarize_stream  # noqa: E402
from src.model_cache import get_model              # noqa: E402
```

**Verification:**
```bash
docker compose exec kos-api python -c "from api.src.rag_bridge import search; print('OK')"
```

### T1.2 — Startup Model Load (`api/src/main.py`)

```python
@app.on_event("startup")
async def startup():
    seed_admin()
    # Pre-load bge-m3 so first search request doesn't pay the load cost
    from .rag_bridge import get_model
    get_model()  # Loads ~2.3GB model into process memory
```

**Risk:** If model download fails on first boot (no cache), startup hangs.
Mitigation: model is already cached in Docker volume `model-cache` from Sprint 5.

### T1.3 — Fix Missing `import functools`

`orchestrator.py` uses `functools.partial` (line ~537 in `run_pipeline_background`)
but `import functools` is missing. This is a latent bug from Sprint 6 that hasn't
been triggered because the code path may not execute yet.

### T2.1 — Convert `ensure_indexed`

**Before (subprocess):**
```python
proc = subprocess.run(
    [sys.executable, "-c",
     f"import json; from src.ingest import ingest; ..."],
    cwd=str(ROOT / "services" / "rag-engine"),
    ...
)
```

**After (in-process):**
```python
from .rag_bridge import ingest as rag_ingest

def ensure_indexed(area: str) -> dict:
    docs_path = ROOT / "data" / "cleaned" / f"{area.lower().replace(' ', '_')}_docs.json"
    if not docs_path.exists():
        return {"status": "error", "message": f"No docs for {area}"}
    result = rag_ingest(docs_path)
    return {"status": "ok", **result}
```

### T2.2 — Convert `search_and_rank`

**Before (subprocess, ~5–13s):**
```python
proc = subprocess.run(
    [sys.executable, "-c",
     f"from src.search import search; from src.rank import rank; ..."],
    cwd=str(ROOT / "services" / "rag-engine"),
    ...
)
```

**After (in-process, ~50–100ms):**
```python
from .rag_bridge import search as rag_search, rank as rag_rank

def search_and_rank(query: str, area: str, top_k: int = 50) -> list:
    results = rag_search(query_text=query, kecamatan=area, top_k=top_k)
    ranked = rag_rank(results)
    return ranked
```

### T2.5 — Convert `stream_summary` (Hardest)

**Before:** Spawns subprocess that streams JSON lines to stdout
```python
proc = subprocess.Popen(
    [sys.executable, "-u", "-c", "..."],
    stdout=subprocess.PIPE, ...
)
for line in proc.stdout:
    yield json.loads(line)["t"]
```

**After:** Call `summarize_stream()` generator directly, wrap for async:
```python
from .rag_bridge import summarize_stream

async def stream_summary(query, results, model=None, chat_history=None):
    loop = asyncio.get_event_loop()
    # summarize_stream is a sync generator → run in thread
    gen = summarize_stream(query, results, model, chat_history)
    while True:
        try:
            token = await loop.run_in_executor(None, next, gen)
            yield token
        except StopIteration:
            break
```

### T3.1 — Docker Health Check Adjustment

```yaml
# docker-compose.yml
kos-api:
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
    interval: 10s
    timeout: 5s
    retries: 3
    start_period: 60s  # Was 10s — now needs to wait for model load
```

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Model load fails on startup → container won't start | API down | Wrap in try/except, log error, continue without model (search returns 503) |
| RAM exhaustion (model + ChromaDB + FastAPI) | OOM kill | Monitor with `docker stats`. 8GB VM should be enough: ~2.3GB model + ~500MB ChromaDB + ~300MB FastAPI = ~3.1GB |
| GIL contention during concurrent search + pipeline | Slow responses | Acceptable: search is <100ms, pipeline runs in `asyncio.to_thread()`. If problematic, move to Opsi 1 (TEI server) in Sprint 9 |
| `sys.path` import conflicts between `api/src/` and `services/rag-engine/src/` | Import errors | Isolate in `rag_bridge.py`, test thoroughly in T1.1 |
| Streaming summarize blocking event loop | UI stutter | Use `run_in_executor()` for sync generator (T2.5) |

---

## Out of Scope

- **Opsi 1 (TEI/infinity embedding server)** — Separate container with HTTP API.
  Consider in Sprint 9 if GIL contention becomes an issue at scale.
- **GPU acceleration** — Not needed at current scale. CPU inference is <100ms.
- **Model quantization (int8/FP16)** — Reduces RAM but adds complexity. Not needed
  on 8GB VM.
- **Scrape subprocess optimization** — Go binary, out of scope.
