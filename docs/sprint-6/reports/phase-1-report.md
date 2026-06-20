# Sprint 6 — Phase 1 Report

## T1.1 — PipelineState Class
**Status:** ✅ Completed
**File:** `api/src/pipeline_state.py` (NEW)

### What was built
Thread-safe singleton `PipelineState` with:
- `start(area)` → claim the single pipeline slot
- `queue(area)` → place area in single queue slot (with same-area dedup)
- `finish()` → mark complete, return queued area, keep progress for frontend
- `reset()` → clear "completed" state back to idle
- `state()` → serializable status dict

### Test Results (9/9 passed)
- Double-start rejected ✅
- Same-area queue rejected (dedup) ✅
- Queue overwrite works ✅
- Singleton identity preserved ✅

---

## T1.2 — Async Pipeline Runner
**Status:** ✅ Completed
**File:** `api/src/orchestrator.py` (modified — added `run_pipeline_background()`)

### What was built
`async def run_pipeline_background(area, postal_codes, force)` that:
1. Wraps existing sync `ensure_scraped/processed/indexed` via `asyncio.to_thread()`
2. Updates `PipelineState` at each stage (scraping→processing→indexing)
3. Handles errors gracefully — keeps error message in `progress`
4. Calls `state.finish()` in `finally` block

### Bug found & fixed during testing
`finish()` originally reset `progress` to None — frontend couldn't read final result.
Fixed: `finish()` now sets status to `"completed"` and preserves progress.
Added `reset()` method for frontend to acknowledge completion.

### Test Results (4/4 passed)
```
T1 success: Done: 15 new, 3 skipped for TestArea
T2 error: Scrape failed: timeout
T3 nonblocking: 26 ticks during pipeline  ← event loop NOT blocked
T4 reset OK
ALL TESTS PASSED
```

### Key proof: non-blocking
T3 ran a concurrent `ticker` coroutine during the pipeline. It ticked **26 times**
proving the event loop remained responsive throughout all 3 pipeline stages.
