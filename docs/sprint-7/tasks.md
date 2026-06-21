# Sprint 7 — Pipeline Dashboard Page

> Status: 🔵 In Progress | Created: 2026-06-20
> Branch: `feat/pipeline-dashboard`

Status legend: ⬜ pending | 🔵 in_progress | ✅ completed | ❌ blocked

---

## Goal

Halaman dashboard untuk melihat data apa saja yang sudah di-scrape, di-process,
dan di-index di RAG. Memberikan visibility ke sistem tanpa harus SSH ke container.

## Problem Statement

Saat ini tidak ada cara untuk melihat area mana saja yang sudah ada datanya.
Data tersebar di 3 lokasi:

- `data/raw/<area>/` — hasil scraper (JSONL files)
- `data/cleaned/<area>_docs.json` — hasil processing (RAG-ready documents)
- ChromaDB collection `kos_indonesia` — indexed vectors

User harus SSH ke server dan `ls` manual untuk cek status. Tidak ada visibility
untuk debugging (contoh: "kenapa Cakung gagal?") atau planning area selanjutnya.

## Solution

New API endpoint `GET /pipeline/data` yang scan ketiga lokasi di atas dan return
per-area status (scraped/processed/indexed + kos count). New frontend page
`/pipeline` dengan table, summary cards, dan live pipeline banner.

---

## Tasks

### Phase 1 — Backend

| ID  | Task | File | Diff | Est | Status |
|-----|------|------|------|-----|--------|
| 1.1 | `GET /pipeline/data` — scan raw/cleaned/ChromaDB, return per-area inventory | `api/src/pipeline_data.py` (NEW), `api/src/main.py` | Medium | 0.75h | ✅ |

### Phase 2 — Frontend

| ID  | Task | File | Diff | Est | Status |
|-----|------|------|------|-----|--------|
| 2.1 | `getPipelineData()` API client + TypeScript types | `web/src/lib/api.ts` | Easy | 0.25h | ✅ |
| 2.2 | `PipelineDashboard` component — table + summary cards + live banner | `web/src/components/PipelineDashboard.tsx` (NEW) | Medium | 0.75h | ✅ |
| 2.3 | `/pipeline` page route + sidebar nav item | `web/src/pages/pipeline.astro` (NEW), `web/src/layouts/DashboardLayout.astro` | Easy | 0.25h | ✅ |

### Phase 3 — Validation

| ID  | Task | Diff | Est | Status |
|-----|------|------|-----|--------|
| 3.1 | Verify: all known areas show correct status ( Bekasi Timur ✅, Cakung scraped-only, etc.) | Easy | 0.25h | ✅ |
| 3.2 | Verify: live pipeline banner auto-refreshes during active scrape | Easy | 0.25h | ⬜ |

---

## Task Details

### T1.1 — `GET /pipeline/data` Endpoint (`api/src/pipeline_data.py`)

Scan `data/raw/`, `data/cleaned/`, dan query ChromaDB untuk dapat per-area counts.

**Response shape:**

```json
{
  "areas": [
    {
      "area": "Bekasi Timur",
      "scraped": true,
      "processed": true,
      "indexed": true,
      "postal_codes": 3,
      "scraped_count": 17111,
      "docs_count": 54,
      "indexed_count": 54,
      "scrape_date": 1718880000.0
    },
    {
      "area": "Cakung",
      "scraped": true,
      "processed": false,
      "indexed": false,
      "postal_codes": 6,
      "scraped_count": 89,
      "docs_count": null,
      "indexed_count": 0,
      "scrape_date": 1718881200.0
    }
  ],
  "pipeline": {
    "running": "Jakarta Timur",
    "status": "scraping",
    "queued": null,
    "progress": "Scraping 59 postal codes...",
    "elapsed_seconds": 45.2
  },
  "totals": {
    "areas": 7,
    "scraped": 7,
    "processed": 3,
    "indexed": 3,
    "total_kos": 154
  }
}
```

**Implementation notes:**

- `_count_jsonl_records(area_dir)` — count lines across all `*.jsonl` files
- `_count_docs(area)` — parse `<area>_docs.json`, return `len(array)`
- `_get_indexed_count()` — subprocess ChromaDB query, group by `metadata.area`
- Fuse all three sources into a single `areas` dict keyed by area name
- Sort alphabetically
- Wrap with `Depends(get_current_user)` — admin only

**Register router in `api/src/main.py`:**

```python
from .pipeline_data import router as pipeline_data_router
# ...
app.include_router(pipeline_data_router)
```

### T2.1 — API Client (`web/src/lib/api.ts`)

```typescript
export interface PipelineArea {
  area: string;
  scraped: boolean;
  processed: boolean;
  indexed: boolean;
  postal_codes: number;
  scraped_count: number;
  docs_count: number | null;
  indexed_count: number;
  scrape_date: number | null;
}

export interface PipelineDataResponse {
  areas: PipelineArea[];
  pipeline: { running; status; queued; progress; elapsed_seconds };
  totals: { areas; scraped; processed; indexed; total_kos };
}

export async function getPipelineData(): Promise<PipelineDataResponse> { ... }
```

### T2.2 — `PipelineDashboard` Component (`web/src/components/PipelineDashboard.tsx`)

```
┌─────────────────────────────────────────────────────────┐
│  📍 7 Areas    ⛏️ 7 Scraped    ⚙️ 3 Processed    🔢 3 Indexed  │
├─────────────────────────────────────────────────────────┤
│  🔄 Pipeline berjalan: Jakarta Timur                    │
│     Scraping 59 postal codes... · 45s                   │
├─────────────────────────────────────────────────────────┤
│  Area              Scraped  Processed  Indexed  Count   │
│  ─────────────────────────────────────────────────────  │
│  Bekasi Timur         ✅       ✅        ✅      54     │
│  Cakung               ✅       ✗         ✗       —     │
│  Cilincing            ✅       ✅        ✅      38     │
│  Jakarta Timur        ✅       ✗         ✗       —     │
│  Tanjung Priok        ✅       ✅        ✅      62     │
│                                                         │
│                                              [↻ Refresh]│
└─────────────────────────────────────────────────────────┘
```

**Features:**
- Summary cards (total areas, scraped, processed, indexed)
- Active pipeline banner (auto-refresh 5s saat pipeline running)
- Table dengan green ✅ / grey ✗ status badges
- Kos count column (indexed > docs > scraped fallback)
- Manual refresh button

### T2.3 — Page Route + Nav (`web/src/pages/pipeline.astro`)

- Uses `DashboardLayout` + `AuthGuard adminOnly`
- Add 📊 Pipeline nav item antara Pencarian dan Pengaturan
- Update `active` type union: `'home' | 'search' | 'pipeline' | 'settings'`

---

## Out of Scope

- ❌ Delete/reprocess area dari dashboard (read-only untuk sekarang)
- ❌ Progress bar percentage per postal code
- ❌ Export data (CSV/JSON download)
- ❌ Auto-refresh saat tidak ada pipeline running (manual refresh button cukup)
- ❌ Historical scrape logs (kapan terakhir di-scrape ulang, dll)

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| ChromaDB subprocess call +2-3s latency | Dashboard lambat | Acceptable untuk admin page; optimize later dengan persistent client |
| JSONL count bisa lambat untuk area besar | API timeout | Count dibatasi per-file, skip parse jika >10MB |
| ChromaDB metadata area field missing | Count fallback ke "unknown" | Default "unknown" key, tetap muncul di table |

## Summary

| Phase | Tasks | Est |
|-------|-------|-----|
| 1 — Backend | 1 | 0.75h |
| 2 — Frontend | 3 | 1.25h |
| 3 — Validation | 2 | 0.5h |
| **Total** | **6** | **~2.5h** |
