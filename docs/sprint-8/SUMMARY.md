# Sprint 8 Summary — In-Process RAG: Faster & Lighter

> **Status:** ✅ Complete | 16 tasks + 4 E2E fixes | Branch: `feat/in-process-embedding`
> **Prerequisite:** Sprint 6 (async pipeline) + Sprint 7 (pipeline dashboard)
> **Benchmark:** [`baseline.md`](./baseline.md)

---

## 1. Goal

Eliminate per-request subprocess overhead in the RAG pipeline. Load bge-m3
**once** in the FastAPI process and reuse across requests. Two equally-weighted
outcomes:

1. **Faster** — retrieval 5–13s → 50–100ms.
2. **Lighter** — no per-request interpreter spawns (~50–100 MB each), no repeated
   ~2.3 GB model reloads, no per-call ChromaDB client construction. One stable
   process instead of N heavy subprocesses.

## 2. What Shipped (5 phases)

| Phase | Deliverable |
|-------|-------------|
| 1 — Foundation | `rag_bridge.py` + `data_bridge.py` (importlib-alias load of rag-engine & data-processor under unique names — collision-proof in Docker + local-dev); startup model load (graceful `try/except` → `app.state.model_ready`); delete dead duplicate `run_pipeline_background` |
| 2 — Convert | 5 subprocess calls → in-process: `ensure_indexed`, `search_and_rank`, `_list_kos`, `ensure_processed`, `summarize`/`stream`. Lazy bridges keep API importable without torch |
| 3 — Lighter | `services/rag-engine/src/db.py` caches ChromaDB `PersistentClient` + collection (was rebuilt per call); pin uvicorn `--workers 1` (model is ~2.3 GB/worker → OOM otherwise) |
| 4 — Health | `start_period` already 300s in compose (no-op); `/health` now reports `model_ready` |
| 5 — Validation | Baseline benchmark before/after (see Metrics) |

**E2E fixes found during testing** (not in original plan): kecamatan-enrichment
fallback, region drill-down, POI province handling, saved-search tolerance.

## 3. Incidents / RCAs (11 root-cause analyses)

All in [`rca/`](./rca/). Notable:

- **RCA-018** dashboard `/pipeline/data` indexed counts always 0 — subprocess
  one-liner had `for: a; b` (SyntaxError) → silently returned `{}`. Fixed by
  converting to in-process `get_collection()`.
- **RCA-019** `/search` 500 when model unavailable — `rag = _rag()` was outside
  the try block in `search_and_rank`. Lazy import must live inside try.
- **RCA-020** scraped kos unsearchable — Google Maps rarely returns
  `postal_code`, so `enrich()` left `kecamatan=""`. Fallback to scrape area name.
- **RCA-021** broad-region query narrowed to random kecamatan ("Lampung"→
  "Agung"). Unified `_resolve_query` tries longest phrase first, returns typed
  `{kind:area|region}`; `/search` now offers a drill-down for provinces/regencies.
- **RCA-022** dead duplicate `run_pipeline_background` (latent `functools`
  NameError) — deleted, not "fixed".
- **RCA-023** POI resolver returned empty for provinces (Nominatim leaves
  `regency=""` on province match) → province drill-down fallback.
- **RCA-024** save-search 422 — `SavedSearch.area` was required; broad-region
  searches have no area. Made optional.

Post-report E2E testing found 4 more (all in `rca/`):

- **RCA-025** broad-region drill-down message didn't appear — `/search` returned
  JSON for `stream:true`; frontend SSE reader dropped it. Emit SSE `region` event.
- **RCA-026** "Tidak ada kos di **undefined**" + refresh 400 — frontend's weak
  area regex + unguarded undefined district. Fixed label + guard + `/search/resolve`
  (frontend defers to backend resolution).
- **RCA-027** POI → spurious "DKI Jakarta" drill-down + chip loop —
  `pipeline_started/queued` checked at wrong nesting level during busy pipeline.
- **RCA-028** `load_all=true` blocked the entire API — leftover sync multi-district
  scrape + single worker (Sprint 8 pin). load_all now loads cached-only.

**Key enhancements (not RCAs):** province drill-down via 38-province iteration +
aliases (`feat(search): province drill-down`), `/search/resolve` endpoint (Opsi A
— backend single source of truth for area resolution), POI radius search wired
end-to-end (5km default; rag-engine filter+rank was already there, just not
plumbed).

## 4. Key Architecture Decisions

- **importlib alias bridges** (`rag_bridge`, `data_bridge`) load the rag-engine
  and data-processor `src` packages under unique aliases (`rag_engine`,
  `data_processor`) — avoids the `src` namespace collision with the API's own
  `src` in **both** Docker (`api.src.main`) and local-dev (`src.main`) launch
  contexts. (cf. RCA-009 from Sprint 3.)
- **Lazy bridges** — API stays importable & bootable without torch/chromadb
  installed; startup loads the model gracefully and sets `model_ready`.
- **Single uvicorn worker** — the resident 2.3 GB model is per-worker; scale-out
  is via a separate TEI/embedding container (Sprint 9), not more workers.
- **Region drill-down over silent narrowing** — broad queries (province/regency)
  return a sub-area list instead of 0 results. Province index reused from kodepos
  (`locations._load_regencies`); no hardcoded constants.
- **In-process ChromaDB client singleton** (`db.py`) — the new per-call ceiling
  once subprocess overhead was gone.

## 5. Tech Stack (additions this sprint)

Python 3.9 (Docker 3.11) · `torch 2.8.0` (CPU) · `chromadb 1.5.9` ·
`sentence-transformers` · `BAAI/bge-m3` (~2.3 GB, resident) ·
`importlib.util` (alias package loading) · Go scraper binary rebuilt per-OS
(macOS arm64 for local dev; Linux arm64 in Docker).

## 6. How to Run

**Local (macOS, full stack for testing):**
```bash
# geo-router (or via SSH tunnel to remote)
cd services/geo-router && npm start                 # :3001
# api — needs torch+chromadb+model (one-time: ~3.5 GB download)
cd api && python3 -m venv .venv && .venv/bin/pip install \
  fastapi "uvicorn[standard]" "python-jose[cryptography]" "passlib[bcrypt]" "bcrypt==4.0.1" \
  "sentence-transformers>=3.0" "chromadb>=0.5"
.venv/bin/python -m uvicorn src.main:app --port 8081 --workers 1   # model loads ~15-25s
# scraper binary must be built for the host OS:
cd services/scraper/google-maps-scraper && go build -o gmaps-scraper .
# web
cd web && PUBLIC_API_URL=http://127.0.0.1:8081 npm run dev          # :4321
```
**Docker (production):** `docker compose up` — Dockerfile builds the Linux Go
binary and the model caches into the `model-cache` volume.

## 7. Metrics (benchmark — [`baseline.md`](./baseline.md))

| Path | Before (subprocess) | After (in-process) | Factor |
|------|---------------------|--------------------|--------|
| `/search` retrieval (mode=rag, warm) | ~14.3 s | **~50 ms** | **~280×** |
| `/area/load` (list_kos, warm) | 9.99 s | **32 ms** | ~280× |
| Pipeline new area (process+index, 30 kos) | ~15 s | **1.53 s** | ~10× |
| `/health` during active search | slow (CPU contention) | <10 ms | fixed |
| End-to-end search (with real LLM) | ~16–19 s* | ~2–5 s | ~4–8× |

*End-to-end is LLM-capped (~2–5 s); Sprint 8 does not touch LLM latency. The
280× figure applies to the retrieval path. Verified locally + on remote baseline.

## 8. Known Issues & Backlog (→ Sprint 9 / frontend)

- **Frontend doesn't render `broad_region` drill-down** — `/search` and
  `/poi/resolve` now return a `regions` list for broad queries; UI still shows
  empty/"not found". Needs chip/picklist rendering.
- **Multi-worker OOM** — single worker only; scale needs TEI server (Sprint 9).
- **End-to-end latency is LLM-bound** — streaming summarize (glm-4.5-air) is the
  new ceiling once retrieval is ~50 ms.
- **Scraper postal_code unreliable** — RCA-020 fallback masks it; better
  extraction (from address/plus_code) is a future data-quality task.
- **`is_area_cached` still duplicated** (orchestrator.py L21 & L159) — same
  shadowing pattern as RCA-022, deferred.
- **`Pulo Gadung` vs `Pulogadung`** naming mismatch — kodepos stores without
  space; dashboard shows two entries. Data-normalization task.
- **Cold first search ~2–3 s** — torch/embedding warm-up on first call after
  boot; warm calls ~50 ms. Acceptable.
