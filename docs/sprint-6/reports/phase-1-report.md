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

---

## T3 — Integration & Concurrency Test
**Status:** ✅ Completed (live container)

### Test Results (8/8 passed)
```
[1] Idle status: OK
[2] Cached area: OK (54 kos, 9.3s)
[3] Pipeline start: started=True — Jakarta Timur (59 postal codes)
[4] Status-during-pipeline: scraping (7.1ms)  ← NOT blocked
[5] Dedup: 409 "already running" — correct
[6] Queue: queued=True — Jakarta Barat behind Jakarta Timur
[7] 30 consecutive status polls: ALL 1.9-11.3ms  ← zero blocking
[8] Health check responsive: OK (3.1ms)
```

### Performance summary
| Metric | Before | After |
|--------|--------|-------|
| Health endpoint during scrape | ❌ Timeout (30s+) | ✅ 3ms |
| Status endpoint | ❌ N/A | ✅ 2ms |
| Can browse other tabs during pipeline | ❌ | ✅ |
| Separate worker threads visible | ~3.5 cores | Same (asyncio.to_thread) |
| Pipeline completes | 8-15 min | Same (unchanged) |
