# Phase 5 Report — Search History API

> Completed: 2026-06-19

---

## 1. Overview

Persisted saved-search history backed by SQLite. The frontend saved-search UI
(Phase 3) was already built but using localStorage; Phase 5 adds the backend and
flips the frontend to use it (localStorage stays as a fallback).

```
SavedSearches.tsx  ──►  api.ts (listSavedSearches / save / delete)
                         │  (SAVED_SEARCHES_API_ENABLED = true)
                         ▼
                  FastAPI /searches  ──►  SQLite: data/search_history.db
```

---

## 2. How to Run

```bash
cd api && python3 -m uvicorn src.main:app --port 8080 --reload
cd web && npm run dev   # :4321 → /search
```

History populates automatically: every explicit chat query saves an entry; the
left panel lists them; click to re-run, hover to delete.

---

## 3. SQLite Schema

File: `data/search_history.db` (gitignored). Matches `architecture.md §8`.

```sql
CREATE TABLE IF NOT EXISTS saved_searches (
    id           TEXT PRIMARY KEY,
    query_text   TEXT NOT NULL,
    area         TEXT NOT NULL,
    result_count INTEGER DEFAULT 0,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
```

- `id` — UUID (client-generated, or backend-generated if absent)
- `created_at` — ISO 8601 from client (`new Date().toISOString()`); backend
  defaults to `datetime.utcnow()` if missing
- Created lazily on first connection (`CREATE TABLE IF NOT EXISTS`)

---

## 4. API Reference (`api/src/searches.py`)

### `GET /searches` — list all
```json
{ "searches": [
  { "id": "...", "query_text": "wifi kenceng", "area": "Cengkareng",
    "result_count": 10, "created_at": "2026-06-19T18:00:00.000Z" }
] }
```
Ordered `created_at DESC` (newest first).

### `POST /searches` — save
Request body (any of these):
```json
{ "id": "optional", "query_text": "...", "area": "...",
  "result_count": 5, "created_at": "optional ISO" }
```
- `INSERT OR REPLACE` (idempotent on `id`)
- Generates `id` (uuid4) and `created_at` if omitted
- Returns the stored row

### `DELETE /searches/{id}` — delete
```json
{ "ok": true, "deleted": "<id>" }
```

---

## 5. Frontend Wiring

`web/src/lib/api.ts` — `SAVED_SEARCHES_API_ENABLED` flipped `false → true`:

| Function | Path | Behavior |
|----------|------|----------|
| `listSavedSearches()` | `GET /searches` | returns `data.searches`; falls back to localStorage on failure |
| `saveSavedSearch(s)` | `POST /searches` | sends full `SavedSearch`; falls back to localStorage |
| `deleteSavedSearch(id)` | `DELETE /searches/{id}` | falls back to localStorage |

### What gets saved (Rev-001 carry-over)

| Trigger | Saved? | Why |
|---------|--------|-----|
| Explicit user chat query (`queryDataset` with `saveSearch=true`) | ✅ | genuine user intent |
| Picker pick (passes original query) | ✅ | user query |
| District switch / bootstrap (`kos di <district>` auto) | ❌ | system-generated, would spam history |

This is controlled by the `saveSearch` flag in `queryDataset(opts)` (RCA-006).

### Re-run (5.4)

`SavedSearches.onSelect → handleSelectSaved → loadDistrict(area, undefined, query_text)`
→ reloads the district dataset + runs the RAG with the saved query.

---

## 6. Verification

| Check | Result |
|-------|--------|
| Python parse | `searches.py`, `main.py` OK |
| `POST /searches` (with id) | stored, echoed |
| `POST /searches` (no id) | backend-generated uuid + created_at |
| `GET /searches` | newest first, correct shape `{searches:[...]}` |
| `DELETE /searches/{id}` | removed; `GET` count decreases |
| `astro check` | 0 errors / 0 warnings / 0 hints (24 files) |
| `npm run build` | 3 pages OK |
| CORS | preflight `OPTIONS` served (`allow_origins=["*"]` in `main.py`) |

---

## 7. Known Issues / Notes

| Issue | Detail | Status |
|-------|--------|--------|
| No migration from localStorage | Old localStorage entries (from pre-Phase-5 testing) don't appear once backend is enabled | Acceptable — backend starts fresh; backlog: one-time migrate on first load |
| Insert-per-save (no dedup) | Same query twice → two rows | Acceptable (history-style); `updated_at` column ready if upsert-by-(query,area) wanted later |
| SQLite write concurrency | One connection per request | Fine for single-user local MVP; pooling not needed |
| `data/search_history.db` | Gitignored | Safe — not committed |

---

## 8. Reference Files

| File | Purpose |
|------|---------|
| `api/src/searches.py` | `/searches` router + SQLite persistence |
| `api/src/main.py` | registers `searches_router` |
| `web/src/lib/api.ts` | `listSavedSearches` / `saveSavedSearch` / `deleteSavedSearch` (flag on) |
| `web/src/components/SavedSearches.tsx` | left panel history UI (Phase 3) |
| `web/src/components/ChatInterface.tsx` | save-on-query + re-run wiring (Rev-001) |

> **Ref:** `docs/sprint-2/architecture.md` §8 Search History
