# Sprint 9 — Pipeline Action Triggers (Index / Rebuild / Rescrape / Delete)

> Status: 🔵 In Progress | Created: 2026-06-21
> Branch: `feat/pipeline-actions`
> Prerequisite: Sprint 7 (pipeline dashboard) + Sprint 8 (in-process pipeline) merged to `main`
> Scope owner: admin tooling — **all actions admin-only**

Status legend: ⬜ pending | 🔵 in_progress | ✅ completed | ❌ blocked

---

## Goal

Make the `/pipeline` dashboard **actionable + proactive**. Admins can, per area:
**Index**, **Rebuild**, **Rescrape**, and **Delete** — directly from the dashboard,
no SSH/CLI. Plus a **warning icon** that flags areas with likely-broken data and
suggests the right action, so even non-technical admins know what to do.

Closes the loop left by Sprint 7 (visibility-only): **see the status → know what's
wrong → fix it in one click**.

## Problem Statement

Sprint 7 gave visibility, Sprint 8 made the pipeline fast/in-process. But when an
area is stuck, stale, or corrupted, remediation still needs SSH + CLI — not
discoverable from where the problem is visible. Two concrete pain points this
sprint solves:

- **RCA-029**: empty `[]` docs file → area indexed 0 docs while reporting
  "completed". Needs a **Rebuild** (reprocess + reingest), not a full re-scrape.
- **Stale/incomplete areas**: no way to trigger refresh or clean up without shell
  access.

### Real scenarios unblocked
- `scraped ✅ processed ✗ indexed ✗` (crashed midway) → **Index**.
- Data-quality fix landed (kecamatan, processor change, RCA-029 empty docs) → **Rebuild**.
- Data stale (>60d) or incomplete → **Rescrape**.
- Test/corrupt area → **Delete** (free disk + index space).

## Solution

Four per-area actions, escalating in cost. All reuse the existing **background
pipeline slot** (single runner + 1 queue, Sprint 6) — **never synchronous** (see
RCA-028). All **admin-only** (`require_admin`). All UI buttons **disabled while a
pipeline is running** (focus 1 row, avoid confusion).

| Action | Label | Runs | Cost | Shown when |
|--------|-------|------|------|------------|
| Process + Index | **Index** | `ensure_processed → ensure_indexed` (skip scrape) | cheap | `scraped && !indexed` |
| Reprocess + Reingest | **Rebuild** | force rebuild docs + per-area delete + re-add | moderate | `indexed` (fix data) |
| Full refresh | **Rescrape** | scrape → process → index (force, per-area) | expensive | always |
| Remove | **Delete** | per-area chroma + docs (keep raw by default) | instant | always |

**Foundation primitive**: `delete_area_from_index(area)` = per-area
`collection.delete(where={"kecamatan": area})`. Used by Rebuild, Rescrape, Delete.
**Replaces** the dangerous global `ingest(force=True)` path (`delete_collection`
nukes ALL areas — landmine called out in earlier draft).

> **Index** is the headline "win-win": skips the expensive Google Maps scrape
> (data already in `data/raw/`) and runs only the cheap in-process stages.
> **Rebuild** is the "fix data" tool — rebuild docs from raw + re-embed, without
> re-scraping. Perfect for RCA-020 (kecamatan), RCA-029 (empty docs), and after
> any data-processor code change.

## Tasks

### Phase 1 — Backend (foundation + endpoints)

| ID | Task | File | Diff | Est | Status |
|----|------|------|------|-----|--------|
| 1.1 | `delete_area_from_index(area)` — `collection.delete(where={"kecamatan": area})`; also delete `data/cleaned/<area>_docs.json`. Returns count removed. **Foundation for 1.3/1.4/1.5.** | `services/rag-engine/src/db.py` + `api/src/orchestrator.py` | Medium | 0.5h | ⬜ |
| 1.2 | `run_index_background(area)` — process + index (skip scrape) | `api/src/orchestrator.py` | Easy | 0.25h | ⬜ |
| 1.3 | `run_rebuild_background(area)` — `delete_area_from_index` → `ensure_processed(force)` → `ensure_indexed`. Per-area, NOT global force. | `api/src/orchestrator.py` | Medium | 0.5h | ⬜ |
| 1.4 | `run_rescrape_background(area, postal_codes)` — per-area delete → full scrape → process → index | `api/src/orchestrator.py` | Medium | 0.5h | ⬜ |
| 1.5 | `POST /pipeline/index` `{area}` — admin-only, start/queue | `api/src/pipeline_data.py` | Easy | 0.25h | ⬜ |
| 1.6 | `POST /pipeline/rebuild` `{area}` — admin-only | `api/src/pipeline_data.py` | Easy | 0.25h | ⬜ |
| 1.7 | `POST /pipeline/rescrape` `{area}` — admin-only | `api/src/pipeline_data.py` | Easy | 0.25h | ⬜ |
| 1.8 | `POST /pipeline/delete` `{area, wipe_raw?}` — admin-only; default keep raw, `wipe_raw=true` deletes raw too (tier-2) | `api/src/pipeline_data.py` | Medium | 0.5h | ⬜ |

### Phase 2 — Frontend (actionable dashboard)

| ID | Task | File | Diff | Est | Status |
|----|------|------|------|-----|--------|
| 2.1 | API client: `indexArea`, `rebuildArea`, `rescrapeArea`, `deleteArea` + types | `web/src/lib/api.ts` | Easy | 0.25h | ⬜ |
| 2.2 | Per-row **contextual action buttons** (icon + short label): Index (Zap), Rebuild (RefreshCw), Rescrape (Globe), Delete (Trash2, red). Max 3 visible per row (contextual). | `web/src/components/PipelineDashboard.tsx` | Medium | 0.75h | ⬜ |
| 2.3 | **Disable ALL action buttons while `pipeline.running !== null`** (focus 1 row, avoid concurrent). Tooltip: "Pipeline aktif: {running}" | `web/src/components/PipelineDashboard.tsx` | Easy | 0.25h | ⬜ |
| 2.4 | **Confirm modal**: Rescrape (expensive) + Delete (destructive, tier-2 full-wipe w/ raw) | `web/src/components/PipelineDashboard.tsx` + `ConfirmModal.tsx` | Easy | 0.25h | ⬜ |
| 2.5 | **Warning icon** (AlertTriangle, amber) next to area name for likely-broken data; hover → suggestion (see detection rules below) | `web/src/components/PipelineDashboard.tsx` | Medium | 0.5h | ⬜ |
| 2.6 | **Status-badge tooltips** — hover ✅ shows count: scraped→scraped_count, processed→docs_count, indexed→indexed_count (native `title`, only when on) | `web/src/components/PipelineDashboard.tsx` (`StatusBadge`) | Easy | 0.25h | ⬜ |
| 2.7 | Wire actions to existing 5s auto-refresh: trigger → `pipeline.running` non-null → polling resumes → live status | `web/src/components/PipelineDashboard.tsx` | Trivial | 0.1h | ⬜ |

### Phase 3 — Validation

| ID | Task | Diff | Est | Status |
|----|------|------|-----|--------|
| 3.1 | Index: scraped-only area → ✅✅ in seconds | Easy | 0.25h | ⬜ |
| 3.2 | Rebuild: RCA-029-style empty docs → docs repopulated, indexed_count climbs | Easy | 0.25h | ⬜ |
| 3.3 | Rescrape: confirm modal → fresh data | Easy | 0.25h | ⬜ |
| 3.4 | Delete (default): chroma+docs gone, raw kept → Rebuild still works after | Easy | 0.25h | ⬜ |
| 3.5 | Delete (wipe_raw): area fully gone from dashboard | Easy | 0.15h | ⬜ |
| 3.6 | Admin-only: non-admin token → 403 on all 4 endpoints | Easy | 0.15h | ⬜ |
| 3.7 | Disable: buttons disabled while running; 2nd click ignored (no crash, no concurrent scrape) | Easy | 0.2h | ⬜ |

---

## Task Details

### T1.1 — `delete_area_from_index(area)` (foundation primitive)

```python
# services/rag-engine/src/db.py
def delete_area_from_index(area: str) -> int:
    """Delete all vectors for one area (by metadata.kecamatan). Returns count removed."""
    col = get_collection()
    before = col.count()
    col.delete(where={"kecamatan": area})
    removed = before - col.count()
    reset_collection_cache()  # safety: refresh cached handle metadata
    return removed
```
The orchestrator wraps this + deletes the cleaned docs file when appropriate.
This **replaces** `ingest(force=True)` (which does global `delete_collection`) —
per-area, safe.

### T1.5-1.8 — Endpoint shape (identical pattern)

```python
class ActionRequest(BaseModel):
    area: str
    wipe_raw: bool = False  # Delete only

@router.post("/pipeline/index")
async def trigger_index(req: ActionRequest, bg: BackgroundTasks, user: dict = Depends(require_admin)):
    return _start_or_queue(req.area, lambda a: run_index_background(a), bg)
```
`_start_or_queue` reuses the Sprint-6 3-layer check (free → `state.start` +
`bg.add_task`; busy → `state.queue` + return `{pipeline_queued: true}`). **Never
blocks** (RCA-028). `Delete` is synchronous + instant (no background needed) but
still admin-only.

### T2.2 — Contextual buttons

```tsx
{area.scraped && !area.indexed && <ActionBtn icon={Zap}     label="Index"    onClick={...} />}
{area.indexed                  && <ActionBtn icon={RefreshCw} label="Rebuild"  onClick={...} />}
<ActionBtn icon={Globe}   label="Rescrape" onClick={...} />
<ActionBtn icon={Trash2}  label="Delete"   danger onClick={...} />
```
All `disabled={pipelineRunning}` (T2.3).

### T2.3 — Disable while running

```tsx
const pipelineRunning = data?.pipeline?.running != null;
// every ActionBtn: disabled={pipelineRunning}
// tooltip when disabled: `Pipeline aktif: ${data.pipeline.running}. Tunggu selesai.`
```
Server-side queue (1 deep) stays as graceful double-click fallback, but the UI
makes "fokus 1 row" obvious.

### T2.5 — Warning icon (detection rules)

`AlertTriangle` (amber) next to area name. Hover → suggestion. Priority order
(first match wins):

| Condition | Hover suggestion | Points to |
|-----------|------------------|-----------|
| `scraped && !processed` | "Belum diproses — perlu **Index**" | Index |
| `processed && docs_count==0` | "Docs kosong (data rusak) — perlu **Rebuild**" | Rebuild |
| `scraped && processed && !indexed` | "Sudah diproses, belum di-index — perlu **Index**" | Index |
| `indexed && indexed_count==0` | "0 terindex padahal ada data — perlu **Rebuild**" | Rebuild |
| `scrape_date > 60 hari` | "Data stale — pertimbangkan **Rescrape**" | Rescrape |

No icon when area is healthy (`indexed && indexed_count > 0 && docs_count > 0 &&
fresh`). Native `title` attr (or tooltip component if already available).

### T2.6 — Status-badge tooltips

```tsx
function StatusBadge({ on, count, label }) {
  const title = on && count != null ? `${label}: ${count.toLocaleString("id-ID")}` : label;
  return <span title={title}>{on ? <CheckCircle2/> : "✗"}</span>;
}
```

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Sync execution blocks API (RCA-028) | API down | All actions `asyncio.to_thread` + background runner; Delete is instant. Hard rule: no sync scrape/process/index in request path. T3.7. |
| Concurrent scrape corrupts ChromaDB | Data loss | Single pipeline slot + disable buttons while running (T2.3). |
| Non-admin triggers action | Unauthorized destructive op | `require_admin` on all 4 endpoints (T3.6); frontend hides buttons (page is `AuthGuard adminOnly`). |
| Re-scrape Google rate-limit | Scraper fails | concurrency=1 (ScraperConfig); manual/admin-rare; surface failure in pipeline progress. |
| Delete wrong area / accidental wipe | Data loss | Per-area scoped delete (T1.1 primitive, NOT global); confirm modal (T2.4); default keep raw; tier-2 confirm for wipe_raw. |
| ~~ingest(force=True) global nuke~~ | ~~loses ALL areas~~ | **Resolved by design**: T1.1 per-area primitive replaces global force. |

## Out of Scope

- ❌ Bulk "process all incomplete" (one button for every stuck area) — follow-up.
- ❌ Scheduled/auto re-scrape (cron) — manual admin trigger only.
- ❌ Undo for Delete — raw is kept by default; full-wipe is explicit tier-2.
- ❌ E5 model swap — Sprint 10 (the renumbered POC doc).

## Sequencing

Branch `feat/pipeline-actions` from `main` after Sprint 7+8 merge (touches same
`orchestrator.py` + `/pipeline` routes). T1.1 (delete primitive) is the
foundation — build & unit-test it first, then 1.2-1.4 runners, then endpoints.

## Summary

| Phase | Tasks | Est |
|-------|-------|-----|
| 1 — Backend (primitive + 4 actions) | 8 | 3.0h |
| 2 — Frontend (buttons + warning + tooltips) | 7 | 2.35h |
| 3 — Validation | 7 | 1.5h |
| **Total** | **22** | **~6.85h** |

Biggest dependency: T1.1 (per-area delete primitive) — do first; everything else builds on it.
