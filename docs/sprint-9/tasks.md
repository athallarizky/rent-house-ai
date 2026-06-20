# Sprint 9 — Pipeline Action Triggers (Re-scrape / Re-process / Re-index)

> Status: ⬜ Planned | Created: 2026-06-21
> Branch: `feat/pipeline-actions`
> Prerequisite: Sprint 7 (pipeline dashboard) + Sprint 8 (in-process pipeline) merged to `main`
> Scope owner: admin tooling — **all actions admin-only**

Status legend: ⬜ pending | 🔵 in_progress | ✅ completed | ❌ blocked

---

## Goal

Make the `/pipeline` dashboard **actionable**. Admins can trigger, per area:
**re-scrape**, **re-process**, and **re-index** directly from the dashboard —
no SSH, no manual CLI. Fixes the visibility-without-control gap left by Sprint 7
(which was deliberately read-only).

## Problem Statement

Sprint 7 gave visibility (per-area scraped/processed/indexed status), Sprint 8
made the pipeline fast/in-process. But when an area is stuck or stale, the only
remediation is still:

- SSH into the server + run a CLI, or
- Search the area in `/search` to side-effect the cached pipeline.

Neither is discoverable from the dashboard where the problem is *visible*. This
sprint closes the loop: **see the status → fix it in one click**.

### Real scenarios this unblocks
- Area `scraped ✅ processed ✗ indexed ✗` (process/index crashed midway) → **Process & Index** button.
- Index corrupted / model changed / metadata fix landed → **Re-index**.
- Data stale (>30d) or incomplete → **Re-scrape** (full refresh).

## Solution

Three per-area actions, escalating in cost. All reuse the **existing background
pipeline slot** (single runner + 1 queue, Sprint 6) — **never synchronous**
(see RCA-028: sync scrape blocked the whole API). All **admin-only**
(`require_admin`).

| Action | What it runs | When shown | Cost |
|--------|--------------|------------|------|
| **Process & Index** | `ensure_processed → ensure_indexed` (skip scrape) | `scraped && !indexed` | cheap |
| **Re-index** | `ensure_indexed(force=True)` (re-embed + re-insert) | `indexed` (refresh) | moderate |
| **Re-scrape** | full `scrape → process → index` (force) | always (full refresh) | expensive |

> The **Process & Index** action is the headline "win-win" from the Sprint 7
> review: it skips the expensive Google Maps scrape (data already in
> `data/raw/`) and runs only the cheap in-process stages — seconds, not minutes.
> (Sprint 8 made process/index in-process, so this is now genuinely fast.)

## Tasks

### Phase 1 — Backend (action endpoints + background runners)

| ID | Task | File | Diff | Est | Status |
|----|------|------|------|-----|--------|
| 1.1 | `run_process_index_background(area)` — async runner: process → index (skip scrape), update PipelineState each stage | `api/src/orchestrator.py` | Medium | 0.5h | ⬜ |
| 1.2 | `run_index_background(area, force=True)` — async runner: re-index only | `api/src/orchestrator.py` | Easy | 0.25h | ⬜ |
| 1.3 | Reuse `run_pipeline_background(area, postal_codes, force=True)` for re-scrape (already exists, Sprint 6) — verify force path | `api/src/orchestrator.py` | Trivial | 0.25h | ⬜ |
| 1.4 | `POST /pipeline/process` `{area}` — admin-only, resolve postal codes, start/queue background process+index | `api/src/pipeline_data.py` | Medium | 0.5h | ⬜ |
| 1.5 | `POST /pipeline/index` `{area, force?}` — admin-only, re-index | `api/src/pipeline_data.py` | Easy | 0.25h | ⬜ |
| 1.6 | `POST /pipeline/scrape` `{area, force?}` — admin-only, full re-scrape | `api/src/pipeline_data.py` | Easy | 0.25h | ⬜ |

### Phase 2 — Frontend (actionable dashboard)

| ID | Task | File | Diff | Est | Status |
|----|------|------|------|-----|--------|
| 2.1 | API client: `processArea(area)`, `reindexArea(area)`, `rescrapeArea(area)` + types | `web/src/lib/api.ts` | Easy | 0.25h | ⬜ |
| 2.2 | `PipelineDashboard`: per-row action buttons, **contextual** (Process&Index only when scraped&&!indexed; Re-index when indexed; Re-scrape always) | `web/src/components/PipelineDashboard.tsx` | Medium | 0.75h | ⬜ |
| 2.3 | **Confirm modal** for Re-scrape (expensive) + disable all actions while a pipeline is running (single slot) | `web/src/components/PipelineDashboard.tsx` + `ConfirmModal.tsx` | Easy | 0.25h | ⬜ |
| 2.4 | Wire to existing 5s auto-refresh: action → pipeline.running non-null → polling resumes → status updates live | `web/src/components/PipelineDashboard.tsx` | Trivial | 0.1h | ⬜ |
| 2.5 | **Status-badge tooltips** — hover ✅ per stage menampilkan count: scraped→`scraped_count`, processed→`docs_count`, indexed→`indexed_count`. Native `title` atau tooltip component. Hanya saat badge on (true). | `web/src/components/PipelineDashboard.tsx` (`StatusBadge`) | Easy | 0.25h | ⬜ |

### Phase 3 — Validation

| ID | Task | Diff | Est | Status |
|----|------|------|-----|--------|
| 3.1 | Verify Process & Index: scraped-only area (e.g. Cakung pre-fix) → ✅✅ in seconds | Easy | 0.25h | ⬜ |
| 3.2 | Verify Re-index: existing area, count unchanged, no dupes | Easy | 0.25h | ⬜ |
| 3.3 | Verify Re-scrape: confirm modal → full pipeline → fresh data | Easy | 0.25h | ⬜ |
| 3.4 | Verify admin-only: non-admin token → 403 on all 3 endpoints | Easy | 0.15h | ⬜ |
| 3.5 | Verify queue behavior: trigger 2nd action while one running → queued, not 500/block | Easy | 0.25h | ⬜ |

---

## Task Details

### T1.1 — `run_process_index_background(area)`

```python
async def run_process_index_background(area: str) -> None:
    """Process + index only — skip scrape (data already in data/raw/).
    The cheap remediation path: scraped-but-unprocessed areas become searchable
    in seconds (Sprint 8 made these stages in-process)."""
    state = get_pipeline_state()
    try:
        state.status = "processing"
        state.progress = f"Processing {area}..."
        proc = await asyncio.to_thread(ensure_processed, area)
        if proc["status"] == "error":
            state.progress = f"Processing failed: {proc.get('message','')}"
            return
        state.status = "indexing"
        state.progress = f"Indexing {area}..."
        idx = await asyncio.to_thread(ensure_indexed, area)
        if idx["status"] == "error":
            state.progress = f"Indexing failed: {idx.get('message','')}"
            return
        state.progress = f"Done: {idx.get('new',0)} new, {idx.get('skipped',0)} skipped"
    except Exception as exc:
        state.progress = f"Pipeline error: {exc}"
    finally:
        state.finish()
```

### T1.4-1.6 — Endpoint shape (all identical pattern)

```python
@router.post("/pipeline/process")
async def trigger_process(req: ActionRequest, user: dict = Depends(require_admin)):
    """Process + index an already-scraped area (admin only)."""
    return _start_or_queue(req.area, lambda area: run_process_index_background(area))
```

`_start_or_queue` reuses the Sprint-6 3-layer check: cache state → if slot free,
`state.start(area)` + `background_tasks.add_task(...)`; if busy, `state.queue(area)`
and return `{pipeline_queued: true, pipeline: state.state()}`. **Never blocks**
(RCA-028).

`ActionRequest = {area: str, force: bool = False}`.

### T2.2 — Contextual buttons (per row)

```tsx
{area.scraped && !area.indexed && (
  <button onClick={() => processArea(area.area)}>Process & Index</button>
)}
{area.indexed && (
  <button onClick={() => reindexArea(area.area)}>Re-index</button>
)}
<button onClick={() => confirmRescrape(area.area)}>Re-scrape</button>
```

All disabled when `pipeline.running !== null` (single slot — show "Pipeline
aktif: {running}" tooltip instead of silently queueing behind the scenes; queueing
still works server-side but the UI should make the slot occupancy obvious).

### T2.3 — Confirm modal for Re-scrape

Re-scrape hits Google Maps (expensive, rate-limit risk). Wrap in the existing
`ConfirmModal`: *"Re-scrape {area}? Ini akan menghapus data lama dan ambil ulang
dari Google Maps (butuh beberapa menit). Lanjutkan?"*

### T2.5 — Status-badge tooltips

Setiap badge ✅ di tabel menampilkan count saat di-hover, jadi admin tau
"berapa banyak data" per stage tanpa lihat kolom terpisah:

```tsx
function StatusBadge({ on, count, label }: { on: boolean; count?: number; label: string }) {
  const title = on && count != null ? `${label}: ${count.toLocaleString("id-ID")}` : label;
  return (
    <span title={title} className="...">
      {on ? <CheckCircle2 ... /> : "✗"}
    </span>
  );
}
// pemakaian:
<StatusBadge on={area.scraped} count={area.scraped_count} label="Scraped" />
<StatusBadge on={area.processed} count={area.docs_count ?? undefined} label="Processed" />
<StatusBadge on={area.indexed} count={area.indexed_count} label="Indexed" />
```

Native `title` cukup (cepat, accessible, mobile-touch fallback OK). Kalau mau
lebih fancy, pakai tooltip component (Radix/shadcn) — tapi native dulu, sejalan
dgn "keep it simple" dashboard. Hanya tampil count saat badge on; saat off tetap
"✗" tanpa angka (ga ada artinya).


---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Sync execution blocks API** (RCA-028 recurrence) | API down | All actions use `asyncio.to_thread` + background runner. Hard rule: no sync scrape/process/index in request path. Test 3.5. |
| Concurrent re-scrape corrupts ChromaDB | Data loss | Single pipeline slot + queue (Sprint 6). Disable buttons while running (T2.2). |
| Non-admin triggers action | Unauthorized re-scrape | `require_admin` on all 3 endpoints (T3.4 verifies 403). Frontend hides buttons for non-admins (existing `AuthGuard adminOnly` on `/pipeline`). |
| Re-scrape Google rate-limit / ban | Scraper fails | Cap concurrency (already `concurrency=1` in ScraperConfig); re-scrape is manual/admin-rare. Surface failure in pipeline progress. |
| Re-index `force=True` deletes collection (RCA ingest semantics) | Loses OTHER areas | **Audit first**: `ingest(force=True)` currently `delete_collection` (whole DB!). Sprint 9 MUST scope force to per-area delete (by `doc_id`/`kecamatan` where-filter), not nuke the collection. This is a T1.2 prerequisite — fix before exposing. |

> ⚠️ The last risk is the real landmine. `ingest(force=True)` today wipes the
> ENTIRE ChromaDB collection. Sprint 9's Re-index MUST NOT use global force —
> it needs a per-area delete (e.g. `collection.delete(where={kecamatan: area})`
> then re-ingest that area's docs). T1.2 owns this fix.

## Out of Scope

- ❌ Bulk "process all incomplete areas" (one button for every stuck area) —
  follow-up if the per-area flow proves useful.
- ❌ Scheduled/auto re-scrape (cron) — out of scope; manual admin trigger only.
- ❌ Re-scrape progress bar % per postal code — coarse progress text is enough.
- ❌ Undo / rollback for re-scrape — data is regenerated from Google Maps anyway.
- ❌ E5 model swap — that's Sprint 10 (the renumbered POC doc).

## Sequencing

Branch `feat/pipeline-actions` from `main` **after** Sprint 7 + 8 merge. Touches
the same `orchestrator.py` + `/pipeline` routes — clean base avoids conflicts.
The dashboard (Sprint 7) and in-process pipeline (Sprint 8) are the foundation:
this sprint only adds the action layer on top.

## Summary

| Phase | Tasks | Est |
|-------|-------|-----|
| 1 — Backend (endpoints + runners) | 6 | 2.0h |
| 2 — Frontend (buttons + modal + tooltips) | 5 | 1.6h |
| 3 — Validation | 5 | 1.15h |
| **Total** | **16** | **~4.75h** |

The biggest single risk is T1.2 (per-area re-index without nuking the collection)
— prioritize & verify that first.
