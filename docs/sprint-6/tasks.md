# Sprint 6 — Async Pipeline (Background Tasks) POC

> Status: 🔵 In Progress | Created: 2026-06-20
> **LOCAL ONLY — POC, tidak di-push ke GitHub sampai divalidasi.**

Status legend: ⬜ pending | 🔵 in_progress | ✅ completed | ❌ blocked

---

## Goal

Pipeline scrape/process/index tidak blocking HTTP server. Search return instant,
pipeline jalan di background. Concurrency controlled (single queue + dedup).

## Problem Statement

Saat ini `POST /search` dengan `ensure_pipeline=true` dan `POST /area/load` menjalankan
scraper → processor → indexer secara **synchronous** di thread Uvicorn. Akibatnya:

- HTTP request hang 8-15 menit (scrape + ingest)
- Docker healthcheck timeout → container `unhealthy`
- API tidak bisa serve request lain selama pipeline jalan
- Browser menampilkan "Failed to fetch" / "Tidak bisa terhubung ke server"

## Solution

FastAPI `BackgroundTasks` + in-memory `PipelineState` singleton dengan:
1. **Single pipeline slot** — max 1 area running di satu waktu
2. **Single queue slot** — max 1 area antri (overwrite kalau ada request baru)
3. **Cache-first** — kalau data udah ada, skip pipeline entirely
4. **Same-area dedup** — kalau area sama lagi running, skip

---

## Tasks

### Phase 1 — Backend Core

| ID  | Task | File | Diff | Est | Status |
|-----|------|------|------|-----|--------|
| 1.1 | `PipelineState` class — thread-safe state tracker | `api/src/pipeline_state.py` (NEW) | Medium | 0.5h | ✅ |
| 1.2 | `run_pipeline_background()` — async wrapper for scrape→process→index | `api/src/orchestrator.py` | Medium | 0.75h | ✅ |
| 1.3 | 3-layer check: cache → dedup → queue, dispatch via `BackgroundTasks` | `api/src/search.py` | Hard | 1h | 🔵 |
| 1.4 | `GET /pipeline/status` endpoint | `api/src/search.py` | Easy | 0.25h | 🔵 |

### Phase 2 — Frontend

| ID  | Task | File | Diff | Est | Status |
|-----|------|------|------|-----|--------|
| 2.1 | `getPipelineStatus()` API client method | `web/src/lib/api.ts` | Easy | 0.25h | ⬜ |
| 2.2 | Polling UI: status bar + auto-refresh on complete | `web/src/pages/search.astro` | Medium | 0.5h | ⬜ |

### Phase 3 — Validation

| ID  | Task | Diff | Est | Status |
|-----|------|------|-----|--------|
| 3.1 | Integration test: fresh area → pipeline start → polling → results | Medium | 0.25h | ⬜ |
| 3.2 | Concurrency test: 2nd search while pipeline running → queue/dedup | Medium | 0.25h | ⬜ |

---

## Task Details

### T1.1 — PipelineState (`api/src/pipeline_state.py`)

Thread-safe singleton. `threading.Lock` around all mutations.

```python
class PipelineState:
    _instance = None
    _lock = threading.Lock()

    def __init__(self):
        self._lock = threading.Lock()
        self.running: Optional[str] = None      # area name
        self.queued: Optional[str] = None        # area name (max 1)
        self.status: str = "idle"                # idle|scraping|processing|indexing
        self.started_at: Optional[float] = None
        self.progress: Optional[str] = None

    def start(self, area: str) -> bool: ...
    def queue(self, area: str) -> bool: ...
    def finish(self) -> Optional[str]: ...       # returns queued area or None
    def status(self) -> dict: ...
```

### T1.2 — Async runner (`api/src/orchestrator.py`)

Wrap existing sync `ensure_scraped/processed/indexed` via `asyncio.to_thread()`.

```python
async def run_pipeline_background(area: str, postal_codes: List[int]):
    state = get_pipeline_state()
    try:
        state.status = "scraping"
        state.progress = f"Scraping {len(postal_codes)} postal codes..."
        await asyncio.to_thread(ensure_scraped, area, postal_codes)

        state.status = "processing"
        state.progress = "Processing scraped data..."
        await asyncio.to_thread(ensure_processed, area)

        state.status = "indexing"
        state.progress = "Indexing to ChromaDB..."
        await asyncio.to_thread(ensure_indexed, area)
    finally:
        state.finish()
```

### T1.3 — 3-Layer Check (`api/src/search.py`)

```
Request search "Jakarta Utara"
    ↓
[1] is_area_cached(area)?  ──YES──→ return search_and_rank()  (instant)
    ↓ NO
[2] state.running == area? ──YES──→ return {"queued": true, "msg": "already running"}
    ↓ NO
[3] state.running?         ──YES──→ state.queue(area); return {"queued": true}
    ↓ NO
    state.start(area)
    background_tasks.add_task(run_pipeline_background, area, postal_codes)
    return {"started": true, "area": area}
```

### T1.4 — Status Endpoint

```python
@router.get("/pipeline/status")
async def pipeline_status(user: dict = Depends(get_current_user)):
    return get_pipeline_state().status()
```

Response:
```json
{
  "running": "Tanjung Priok",
  "status": "indexing",
  "queued": null,
  "progress": "Indexing to ChromaDB...",
  "elapsed_seconds": 143.5
}
```

### T2.2 — Frontend Polling UI

```
┌─────────────────────────────────────────────┐
│ 🔄 Pipeline sedang berjalan...              │
│    Area: Tanjung Priok                      │
│    Status: Indexing... | 2 menit berlalu    │
│                                             │
│ [Refresh] (muncul kalau selesai)            │
└─────────────────────────────────────────────┘
```

Poll `GET /api/pipeline/status` setiap 3 detik. Kalau `running == null`, stop polling + auto-retry search.

---

## Out of Scope (POC)

- ❌ Auto-run queued item after pipeline finishes (manual trigger for now)
- ❌ Retry on failure
- ❌ Persistent state (container restart = state hilang, data disk aman)
- ❌ Progress percentage (cuma stage message)
- ❌ WebSocket (polling 3s enough for POC)

## Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| State lost on restart | Progress lost, data safe | User trigger ulang (retry search) |
| Multi-worker race | State gak shared across workers | Pin `--workers 1` di POC |
| Thread safety | Race condition | `threading.Lock` around mutations |

## Summary

| Phase | Tasks | Est |
|-------|-------|-----|
| 1 — Backend Core | 4 | 2.5h |
| 2 — Frontend | 2 | 0.75h |
| 3 — Validation | 2 | 0.5h |
| **Total** | **8** | **~3.75h** |
