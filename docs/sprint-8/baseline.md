# Sprint 8 — Baseline Benchmark (Before)

> Measured: 2026-06-20 | Stack: remote kos-api via SSH tunnel (localhost:8080)
> Data: 136 entries in ChromaDB collection `kos_indonesia`, bge-m3 model
> Purpose: "before" reference for T5.1 (latency) and T5.2 (RAM) comparisons.

## Methodology

- Admin login → bearer token → timed `curl -w "%{time_total}"` calls.
- Area: **Bekasi Timur** (indexed, 54 kos via list_kos).
- `mode=rag` isolates the retrieval subprocess (loads bge-m3, no LLM).
- `mode=ai` would include LLM summarize, but **no API key configured**
  (`api_key_set: false`) → instant `_format_fallback`. LLM latency NOT measurable
  in this baseline.

## Results

| # | Endpoint / path | Time | Notes |
|---|-----------------|------|-------|
| 1 | `GET /health` | **3.6 ms** | RTT floor; connection healthy |
| 2 | `POST /area/load` (list_kos, **no model**) | **9.99 s** | 54 kos. Pure subprocess+import overhead |
| 3 | `POST /search` `mode=rag` run 1 | 14.41 s | retrieval + bge-m3 load |
| 4 | `POST /search` `mode=rag` run 2 | 14.62 s | |
| 5 | `POST /search` `mode=rag` run 3 | 13.80 s | |
|   | **Retrieval avg (mode=rag)** | **~14.3 s** | stable 13.8–14.6 |
| 6 | `POST /search` `mode=ai` | 13.86 s | ⚠️ fallback (no API key), not real LLM |

## Key finding (sharper than the original Sprint 8 plan)

The original plan assumed 5–13s baseline. **Reality: ~14s retrieval, and
list_kos alone is ~10s even though it never loads the model.** That ~10s is
pure per-subprocess overhead: interpreter spawn + `import torch` +
`import sentence_transformers` + `import chromadb`, repeated on EVERY RAG op.

So Sprint 8 eliminates:
- ~10s redundant import overhead per rag operation (not just ~4s model load)
- ~4s model load per embedding op
- per-request interpreter spawns (~50–100 MB each, multiplies under concurrency)

This makes the projected improvement **larger** than the plan's "20–50x" claim.

## Projected after Sprint 8 (targets for T5.1)

| Path | Before | Target after | Factor |
|------|--------|--------------|--------|
| Retrieval (`mode=rag`) | ~14.3 s | ~0.1–0.2 s | **~70–140x** |
| `list_kos` / `/area/load` | ~9.99 s | ~0.05 s | **~200x** |
| Pipeline indexing (per area) | ~10 s overhead | ~0 s | eliminated |
| `/health` during active search | slow (CPU contention) | <10 ms | fixed |
| End-to-end search (with real LLM) | ~16–19 s* | ~2–5 s | ~4–8x |

*End-to-end before = 14s retrieval + LLM streaming (estimated 2–5s, not measured
here because no API key is set).

## Honest caveats

1. **"After" numbers are projections** — Sprint 8 not yet implemented. The
   ~100–200ms retrieval target derives from actual compute cost (bge-m3 CPU
   inference ~50–100 ms + ChromaDB query).
2. **End-to-end is LLM-capped** (~2–5s). Sprint 8 does not touch LLM latency, so
   perceived user-search improvement is ~4–8x, not 100x. The 70–140x figure is
   valid only for the retrieval path.
3. **Set a Z.AI API key** before re-measuring end-to-end after Sprint 8, or the
   `mode=ai` path will still fall back instantly and misrepresent the number.

## Reproduction script

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@kos.ai","password":"admin123"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
AUTH="Authorization: Bearer $TOKEN"

# Retrieval (mode=rag) — the Sprint 8 target
for i in 1 2 3; do
  curl -s -X POST http://localhost:8080/search -H "$AUTH" -H "Content-Type: application/json" \
    -d '{"query":"kos putri murah parkir luas","area":"Bekasi Timur","mode":"rag","ensure_pipeline":false,"top_k":5}' \
    -o /dev/null -w "run $i: %{time_total}s\n"
done

# list_kos (no model) — isolates import overhead
curl -s -X POST http://localhost:8080/area/load -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"district":"Bekasi Timur"}' -o /dev/null -w "area/load: %{time_total}s\n"
```
