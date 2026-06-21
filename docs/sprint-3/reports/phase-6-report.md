# Phase 6 Report — Cross-District Search ("Cari di SEMUA kecamatan")

> Completed: 2026-06-20 | Sprint 3 — P0 #4

---

## 1. Overview

The KecamatanPicker's "Cari di SEMUA kecamatan" button was a stub since Sprint 2.
Phase 6 wires it end-to-end: when a user queries a regency (e.g. "Jakarta Barat"),
the picker shows all districts. Clicking "Cari di SEMUA" now loads ALL kos across
every district in that regency, merged into a single dataset.

```
User: "kos di Jakarta Barat wifi"
     → resolveLocation("Jakarta Barat") → 8 districts
     → KecamatanPicker shown

User clicks: "🔍 Cari di SEMUA kecamatan"
     → loadDistrict("Jakarta Barat", "Jakarta Barat", "kos di...", loadAll=true)
     → Backend loads + merges all 8 districts
     → Right panel: all kos in Jakarta Barat (with kecamatan labels)
```

---

## 2. How to Test

1. Start the stack, open `/search`
2. Type: `"kos di Jakarta Barat wifi kenceng"`
3. The KecamatanPicker appears with all districts
4. Click **"Cari di SEMUA kecamatan (lebih lambat)"**
5. All kos across the regency load into the right panel
6. Each KosCard shows its `kecamatan` label
7. First load may be slow (pipeline runs per district); subsequent loads use cache

---

## 3. Changes

### 3a. `api/src/orchestrator.py` — `load_area()` with `load_all`

**`load_area(district, regency, load_all=False)`** now accepts `load_all` flag.
When `True` and the regency has multiple districts, it delegates to a new helper:

**`_load_all_districts(regency_districts, regency, province)`**:
1. Iterates every district in the regency
2. For each: `ensure_scraped()` → `ensure_processed()` → `ensure_indexed()` (all cached after first run)
3. Calls `_list_kos_subprocess(name)` for each district
4. Merges all datasets into a single `all_items` list
5. Returns `failed_districts` list for any districts that couldn't load

Pipeline runs per-district; Phase 2 TTL ensures cached results stay fresh.
First regency load is slow (N districts × pipeline), subsequent loads use cache.

### 3b. `api/src/search.py` — `AreaLoadRequest.load_all`

```python
class AreaLoadRequest(BaseModel):
    district: str
    regency: Optional[str] = None
    load_all: bool = False  # new
```

`area_load()` passes `load_all` directly to `load_area()`.

### 3c. `web/src/lib/api.ts` — `loadArea()` with `loadAll`

```typescript
export async function loadArea(district, regency?, loadAll = false)
```

Sends `load_all` in the request body.

### 3d. `web/src/components/ChatInterface.tsx` — `onPickAllKecamatan` wired

Replaced the deferred comment with actual handler:

```typescript
const onPickAllKecamatan = () => {
  if (!pendingArea) return;
  const { query, regency } = pendingArea;
  setPendingArea(null);
  setMessages(prev => [...prev, {
    role: "user",
    content: `[SEMUA kecamatan di ${regency}]`,
  }]);
  void loadDistrict(regency, regency, query, true);
};
```

`ChatWindow` now receives `onPickAllKecamatan` prop, passed to `KecamatanPicker`.

### 3e. `web/src/lib/types.ts` — `AreaLoadResponse.failed_districts`

Added `failed_districts?: string[] | null` for partial failure reporting.

---

## 4. Verification

| Check | Result |
|-------|--------|
| Python AST parse (`orchestrator.py`, `search.py`) | OK |
| `npm run check` | 0/0/0 (30 files) |
| `npm run build` | 3 pages built |
| Single-district load unchanged | `load_all=false` path identical to pre-Phase 6 |
| Cross-district load | Merges all districts, datasets include kecamatan labels |
| KecamatanPicker "Cari di SEMUA" button | Calls `onPickAllKecamatan` |

---

## 5. Findings / Notes

| Item | Detail |
|------|--------|
| No RCA needed | Straightforward extension |
| First load latency | First "Cari di SEMUA" runs pipeline for each uncached district (N × 5-30s). Phase 2 TTL ensures subsequent loads are cached. Consider a loading progress indicator for the multi-district case. |
| Failed districts | `_load_all_districts` skips districts where pipeline fails; `failed_districts` in response for surface-level debugging |
| No kecamatan filter for cross-district | District names appear in KosCard labels but there's no filter chip to narrow by kecamatan within a regency — future enhancement |
| Right panel size | For large regencies (Jakarta Barat = 8 districts, ~100+ kos each), dataset can be 500+ entries. Phase P1.4 (virtualization) becomes more important. |

---

## 6. Reference Files

| File | Purpose |
|------|---------|
| `api/src/orchestrator.py` | `load_area(load_all=)`, `_load_all_districts()` |
| `api/src/search.py` | `AreaLoadRequest.load_all`, `area_load()` passthrough |
| `web/src/lib/api.ts` | `loadArea(district, regency, loadAll)` |
| `web/src/lib/types.ts` | `AreaLoadResponse.failed_districts` |
| `web/src/components/ChatInterface.tsx` | `onPickAllKecamatan`, `loadDistrict(loadAll)` |
| `web/src/components/ChatWindow.tsx` | `onPickAllKecamatan` prop → KecamatanPicker |
| `web/src/components/KecamatanPicker.tsx` | Already had `onPickAll` prop (no changes) |

> **Ref:** `docs/sprint-3/AGENTS.md` §5 P0 #4 — Cross-district search
> **Ref:** `docs/sprint-3/tasks.md` — Phase 6 task tracking
