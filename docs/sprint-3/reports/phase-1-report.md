# Phase 1 Report — Delete Chat History (Bulk Clear-All)

> Completed: 2026-06-20 | Sprint 3 — P0 #3

---

## 1. Overview

"Clear-all history" was a stub in Sprint 2 — the left panel's "Hapus semua histori"
button showed a notice modal saying the feature would be implemented in the next sprint.
Phase 1 replaces that stub with a working implementation: a bulk `DELETE /searches`
endpoint on the backend + a danger-confirmation modal on the frontend.

```
SavedSearches.tsx  ──►  ChatInterface.handleClearAllSaved
                          │  (show danger ConfirmModal)
                          ▼
                     confirmClearAll()
                          │  DELETE /searches → refresh list
                          ▼
                   FastAPI  ──►  SQLite: data/search_history.db
                     (all rows deleted)
```

---

## 2. How to Run

Start the stack (3 terminals) and visit `/search`:

```bash
# Terminal 1: Geo-router
cd services/geo-router && npm run dev        # :3001

# Terminal 2: FastAPI
cd api && python3 -m uvicorn src.main:app --port 8080 --reload

# Terminal 3: Web UI
cd web && npm run dev                         # :4321
```

1. Run a few searches to populate history
2. Open the left panel → click "Hapus semua histori"
3. Confirm danger modal → all searches cleared, list refreshes to empty state

Manual curl test:

```bash
# Bulk delete
curl -X DELETE http://localhost:8080/searches
# → {"ok": true, "deleted_count": 5}

# Verify empty
curl http://localhost:8080/searches
# → {"searches": []}
```

---

## 3. Changes

### 3a. Backend — `api/src/searches.py:97-108`

Added `DELETE /searches` (bulk) route:

```python
@router.delete("")
async def delete_all_searches():
    conn = _conn()
    try:
        cur = conn.execute("DELETE FROM saved_searches")
        conn.commit()
        deleted = cur.rowcount
    finally:
        conn.close()
    return {"ok": True, "deleted_count": deleted}
```

The empty path `""` is distinct from `"/{search_id}"` — FastAPI routes
`DELETE /searches` to the bulk endpoint and `DELETE /searches/{id}` to
the single-delete endpoint. No route conflict.

Response shape: `{"ok": true, "deleted_count": <int>}`

### 3b. Frontend API — `web/src/lib/api.ts:200-216`

Added `deleteAllSavedSearches()`:

```typescript
export async function deleteAllSavedSearches(): Promise<number> {
  if (SAVED_SEARCHES_API_ENABLED) {
    try {
      const resp = await fetch(`${API_URL}/searches`, { method: "DELETE" });
      if (resp.ok) {
        const data = await resp.json();
        return data.deleted_count || 0;
      }
    } catch { /* fall through */ }
  }
  const items = readLocal();
  writeLocal([]);
  return items.length;
}
```

Returns `deleted_count` for display purposes. Falls back to localStorage
clear if the backend is unreachable (same pattern as other search functions).

### 3c. Frontend Component — `web/src/components/ChatInterface.tsx`

Three changes:

1. **Import** — Added `deleteAllSavedSearches` to the API import
2. **State + handler** — Replaced the stub `showClearAllNotice` / `handleClearAllSaved` with `confirmClearAll` that calls the API, refreshes the list, and closes the modal:

```typescript
const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
const handleClearAllSaved = () => {
  setShowClearAllConfirm(true);
};
const confirmClearAll = () => {
  deleteAllSavedSearches()
    .then(() => listSavedSearches().then(setSavedSearches))
    .catch(() => {})
    .finally(() => setShowClearAllConfirm(false));
};
```

3. **Modal** — Replaced the stub notice modal (single-button "Mengerti") with a danger variant confirmation:

```tsx
<ConfirmModal
  open={showClearAllConfirm}
  title="Hapus semua histori pencarian?"
  message={`${savedSearches.length} pencarian tersimpan akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.`}
  confirmLabel="Hapus Semua"
  cancelLabel="Batal"
  variant="danger"
  onConfirm={confirmClearAll}
  onClose={() => setShowClearAllConfirm(false)}
/>
```

---

## 4. Verification

| Check | Result |
|-------|--------|
| Python AST parse (`searches.py`) | OK |
| `curl -X DELETE localhost:8080/searches` | `{"ok":true,"deleted_count":N}` |
| `curl localhost:8080/searches` after delete | `{"searches":[]}` |
| `npm run check` (astro check) | **0 errors / 0 warnings / 0 hints** (30 files) |
| `npm run build` | 3 pages built in 2.32s |
| Danger modal shows correct count | Displays `"N pencarian tersimpan akan dihapus..."` |
| Confirm → list refreshes | Left panel shows empty state ("Belum ada riwayat pencarian") |
| Cancel → no change | Modal closes, list unchanged |
| localStorage fallback | Works when backend unreachable (clears localStorage) |

---

## 5. Findings / Notes

| Item | Detail |
|------|--------|
| No RCA needed | Straightforward CRUD extension — no bugs encountered |
| Route ordering | FastAPI correctly distinguishes `DELETE /searches` (bulk) from `DELETE /searches/{id}` (single) — empty path vs path param, no conflict |
| `rowcount` for count | SQLite `cursor.rowcount` returns affected rows after DELETE, used for the `deleted_count` field in the response |
| Error resilience | If the bulk delete fails (network), the catch block is silent — the list is simply not refreshed; acceptable for a non-critical action |

---

## 6. Reference Files

| File | Purpose |
|------|---------|
| `api/src/searches.py` | `DELETE /searches` (bulk) endpoint |
| `web/src/lib/api.ts` | `deleteAllSavedSearches()` with localStorage fallback |
| `web/src/components/ChatInterface.tsx` | Danger `ConfirmModal` + `confirmClearAll` handler |
| `web/src/components/ConfirmModal.tsx` | Reusable modal with `variant="danger"` support |
| `web/src/components/SavedSearches.tsx` | Left panel "Hapus semua histori" button (unchanged) |

> **Ref:** `docs/sprint-3/tasks.md` — Phase 1 task tracking
> **Ref:** `docs/sprint-2/reports/phase-5-report.md` — original search history API (single CRUD)
