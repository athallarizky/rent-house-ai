# Phase 2 Report — Scheduled Re-Scrape (TTL Cache Invalidation)

> Completed: 2026-06-20 | Sprint 3 / Future Enhancement #6

---

## 1. Overview

Previously, scraped Google Maps data was cached forever — once you scraped
Cengkareng, it would never refresh unless you manually ran `force=True`.
Phase 2 adds a **30-day TTL**: cached files older than the threshold trigger
an automatic re-scrape. Freshness is surfaced in the frontend header.

```
┌──────────────────────────────────────────────────────┐
│ ensure_scraped(area, codes, stale_days=30)           │
│                                                      │
│  1. Check each JSONL file's mtime                    │
│  2. If all exist AND all < 30 days → return "cached" │
│  3. If any are stale/missing → call scraper with     │
│     stale_days param → only re-scrapes those codes   │
│  4. Return freshness (scrape_age_days) in response   │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│ scrape_area(area, codes, stale_days=30)              │
│                                                      │
│  - Identifies stale codes via cache.stale_codes()    │
│  - Re-scrapes only stale + missing codes             │
│  - Fresh codes are loaded from cache (no re-scrape)  │
└──────────────────────────────────────────────────────┘
```

---

## 2. How It Works

**On every `/area/load` call** (user opens a district, switches area):

1. `load_area()` → `ensure_scraped(district, codes, stale_days=30)`
2. Orchestrator checks each `{code}.jsonl` modification time
3. If **all files exist and are under 30 days old** → `status: "cached"`, scraper is NOT called at all (fast path)
4. If **any are stale or missing** → calls `scrape_area()` with `stale_days=30`, which re-scrapes only the stale/missing postal codes, loads fresh ones from cache
5. `scrape_age_days` (age of the oldest cache file) is returned in the pipeline response
6. Frontend shows "Data N hari lalu" in the header

**TTL configuration:**
- Default: **30 days** (`CACHE_TTL_DAYS` in `cache.py`)
- Orchestrator passes `stale_days=30` as the default
- Can be adjusted per environment

---

## 3. Changes

### 3a. `services/scraper/src/cache.py` — New TTL helpers

Added four functions:

| Function | Purpose |
|----------|---------|
| `cache_age_days(area, code)` | Returns age of cache file in days (float), `None` if missing |
| `stale_codes(area, codes, max_age_days)` | Returns list of codes whose files are older than threshold |
| `max_cache_age_days(area, codes)` | Returns the maximum age across all codes (for freshness reporting) |
| `CACHE_TTL_DAYS = 30` | Default TTL constant |

Implementation uses `os.path.getmtime()` — no extra dependencies.

### 3b. `services/scraper/src/run.py` — `scrape_area` with `stale_days`

Added `stale_days: int = 0` parameter to `scrape_area()`:

```python
def scrape_area(area, postal_codes, config=None, force=False, stale_days=0):
```

Logic:
- `force=True` → scrape all codes (unchanged)
- `stale_days > 0` → identify stale + missing codes, scrape only those; skip entirely if all fresh
- `stale_days = 0` → original behavior (skip if all cached, only scrape missing)

### 3c. `api/src/orchestrator.py` — `ensure_scraped` with TTL

Added `stale_days` parameter and pre-subprocess freshness check:

1. Iterates all postal codes, computes `max_age` from file mtimes
2. If `all_fresh` → returns immediately with `status: "cached"` + `scrape_age_days`
3. Otherwise → passes `stale_days` to the scraper subprocess via inline `-c` as kwarg
4. `load_area()` propagates `scrape_age_days` into the pipeline response

### 3d. Frontend — Freshness indicator

| File | Change |
|------|--------|
| `web/src/lib/types.ts` | Added `scrape_age_days?: number` to `SearchPipeline` interface |
| `web/src/components/ChatInterface.tsx` | Added `scrapePipeline` state, captures `res.pipeline` in `loadDistrict`, renders freshness text |

Header shows: `Data 15 hari lalu` (if ≥1 day) or `Data baru saja` (if <1 day).
Only visible when data exists and a district is loaded.

---

## 4. Verification

| Check | Result |
|-------|--------|
| Python AST parse (`run.py`, `cache.py`, `orchestrator.py`) | OK |
| `npm run check` (astro check) | **0 errors / 0 warnings / 0 hints** (30 files) |
| `npm run build` | 3 pages built in 2.31s |
| Fresh cache → fast path | Orchestrator returns `"cached"` without subprocess |
| Stale cache → re-scrape | Orchestrator calls scraper with `stale_days=30`, only stale codes re-scraped |
| `scrape_age_days` in response | Included in pipeline (0.0 for fresh scrape, N.N for cached) |
| Frontend shows freshness | "Data X hari lalu" appears in header when age > 0 |

---

## 5. Findings / Notes

| Item | Detail |
|------|--------|
| No RCA needed | Straightforward extension, no runtime issues encountered |
| `stale_days=0` backward compat | When `stale_days=0`, behavior is identical to pre-Phase 2 — used for `force=True` paths |
| No re-index on re-scrape | Re-scraping refreshes raw JSONL files. The pipeline will re-process and re-index in the same `load_area` call only if the docs file doesn't exist yet. For fresher embeddings, the user would need to clear the chroma_db and re-index. A future phase could add "re-index if re-scraped" logic. |
| Subprocess kwarg format | `f"stale_days={stale_days}"` passed as simple statement in the `-c` script — no compound statement issue (RCA-001 safe) |
| `os.path.getmtime` precision | Uses filesystem mtime (seconds precision) — sufficient for day-level TTL |

---

## 6. Reference Files

| File | Purpose |
|------|---------|
| `services/scraper/src/cache.py` | TTL helpers: `cache_age_days`, `stale_codes`, `max_cache_age_days`, `CACHE_TTL_DAYS` |
| `services/scraper/src/run.py` | `scrape_area()` with `stale_days` parameter |
| `api/src/orchestrator.py` | `ensure_scraped()` TTL fast path + `load_area()` freshness propagation |
| `web/src/lib/types.ts` | `SearchPipeline.scrape_age_days` field |
| `web/src/components/ChatInterface.tsx` | `scrapePipeline` state + header freshness indicator |

> **Ref:** `docs/ideas/future-enhancements.md` §6 — Scheduled Re-Scrape
> **Ref:** `docs/sprint-3/tasks.md` — Phase 2 task tracking
