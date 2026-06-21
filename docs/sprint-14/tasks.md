# Sprint 14 — Pipeline Logging System

> Status: ⬜ Pending | Created: 2026-06-22
> Branch: `feat/pipeline-logs` (to be created off `release/standalone`)
> Base: `release/standalone` (post-Sprint-13 user management)
> Type: **New feature — admin observability**
> Estimated effort: **~3 h** (9 tasks)

---

## Tujuan

Sistem logging terstruktur untuk pipeline scraping (EC2 → process → index) yang
tersimpan persistent di SQLite dan dapat dilihat via halaman admin `/logs` di
web. Saat ini debugging pipeline harus SSH ke VPS + baca `docker logs` (hilang
saat container rebuild, noisy, susah filter).

**Problem yang di-solve:**
- Scraping area baru gagal → tidak tahu kenapa tanpa SSH
- Job EC2 timeout / 0 results → tidak terlihat di UI
- Network issue (VPS ↔ EC2) → tidak ada record
- Container rebuild → `docker logs` hilang

---

## Background

Saat Sprint 12 (deploy SumoPod) kita mengalami:
1. Pipeline "stuck" 25 menit — ternyata async bug di `/pipeline/rescrape`
2. Polling timeout 360s — job 11740/11750 results hilang padahal completed di EC2
3. Network block VPS↔EC2 — debugging butuh 5+ SSH session untuk diagnose

Semua itu bisa terlihat dalam 1 menit di `/logs` page kalau sistem logging ini
sudah ada.

---

## Scope

| # | Task | Est | Status |
|---|------|-----|--------|
| 1 | Backend: buat `api/src/logs.py` — SQLite store (`data/pipeline_logs.db`) + fungsi `log_event()` | 0.5h | ⬜ |
| 2 | Backend: `GET /logs` endpoint (admin-only) — filter area/level/search, paginate, auto-cleanup old entries | 0.5h | ⬜ |
| 3 | Backend: insert `log_event()` calls di `scraper_client.py` (submit/done/fail/timeout per job) | 0.25h | ⬜ |
| 4 | Backend: insert `log_event()` calls di `orchestrator.py` (pipeline stage transitions + process/index results) | 0.25h | ⬜ |
| 5 | Backend: insert `log_event()` calls di `pipeline_data.py` (admin actions: index/rebuild/rescrape/delete triggers) | 0.25h | ⬜ |
| 6 | Frontend: buat fungsi API (`getLogs`) di `web/src/lib/api.ts` | 0.25h | ⬜ |
| 7 | Frontend: buat komponen `Logs.tsx` — tabel auto-refresh, filter, color-coded level | 1h | ⬜ |
| 8 | Frontend: buat halaman `/logs` (`logs.astro`) — admin-only (AuthGuard) | 0.25h | ⬜ |
| 9 | Frontend: tambah menu "Logs" di sidebar (`DashboardLayout.astro`) + mobile nav (`MobileNav.tsx`) — admin-only | 0.25h | ⬜ |

---

## Backend Design

### SQLite Schema (`data/pipeline_logs.db`)

```sql
CREATE TABLE IF NOT EXISTS pipeline_logs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ts        TEXT    NOT NULL,          -- ISO 8601 timestamp
    area      TEXT,                       -- e.g. "Cengkareng" (nullable untuk global events)
    stage     TEXT    NOT NULL,           -- "scrape" | "process" | "index" | "rescrape" | "rebuild" | "system"
    level     TEXT    NOT NULL,           -- "info" | "warn" | "error"
    message   TEXT    NOT NULL,           -- human-readable detail
    extra     TEXT                        -- JSON blob (job_id, result_count, elapsed_s, etc.)
);
CREATE INDEX idx_logs_ts ON pipeline_logs(ts DESC);
CREATE INDEX idx_logs_area ON pipeline_logs(area);
CREATE INDEX idx_logs_level ON pipeline_logs(level);
```

### `log_event()` function (`api/src/logs.py`)

```python
def log_event(
    stage: str,           # "scrape" | "process" | "index" | ...
    level: str,           # "info" | "warn" | "error"
    message: str,         # "submit 'kos di 11730' → job_id X97kj..."
    area: str = None,     # "Cengkareng" (optional)
    extra: dict = None,   # {"job_id": "...", "result_count": 32, "elapsed_s": 72}
) -> None:
    """Insert a pipeline log entry. Fire-and-forget — never raises."""
```

### Auto-cleanup

- Cron / startup check: hapus entry older than 30 hari (`DELETE FROM pipeline_logs WHERE ts < ...`)
- Cap: keep max 10.000 rows (delete oldest beyond cap)
- DB size estimate: ~500 bytes/entry × 10.000 = ~5 MB (trivial)

### Endpoints

#### `GET /logs` (admin-only, `require_admin`)

Query params:
| Param | Default | Description |
|-------|---------|-------------|
| `area` | — | Filter by area name (exact match) |
| `level` | — | Filter: `info`, `warn`, `error` (or combo: `warn,error`) |
| `stage` | — | Filter: `scrape`, `process`, `index`, etc. |
| `q` | — | Full-text search di `message` (LIKE) |
| `limit` | 100 | Max 500 |
| `offset` | 0 | Pagination |

Response:
```json
{
  "logs": [
    {
      "id": 1234,
      "ts": "2026-06-22T10:30:00",
      "area": "Cengkareng",
      "stage": "scrape",
      "level": "info",
      "message": "done 'kos di 11730': 32 results in 72s",
      "extra": {"job_id": "X97kj...", "result_count": 32, "elapsed_s": 72}
    }
  ],
  "total": 1234,
  "has_more": true
}
```

#### `DELETE /logs` (admin-only)

Clear all logs (atau by filter). Untuk maintenance.

---

## Integration Points (where to insert `log_event`)

### `api/src/scraper_client.py`

```python
# Phase 1: submit
log_event("scrape", "info", f"submit '{keyword}' → {job_id}", area=area,
          extra={"keyword": keyword, "job_id": job_id})

# Phase 2: poll — job completed
log_event("scrape", "info", f"done '{keyword}': {len(results)} results in {elapsed:.0f}s",
          area=area, extra={"job_id": job_id, "result_count": len(results)})

# Phase 2: poll — job failed/timeout
log_event("scrape", "warn", f"timeout '{keyword}' after {budget:.0f}s",
          area=area, extra={"job_id": job_id})

# Phase 3: write files
log_event("scrape", "info", f"{area}: {total} entries across {files_written} files",
          area=area, extra={"total_entries": total, "files": files_written})
```

### `api/src/orchestrator.py` — `run_pipeline_background` + `run_rescrape_background`

```python
# Stage transitions
log_event("scrape", "info", f"Pipeline started: scrape {area} ({len(codes)} postal codes)", area=area)
log_event("process", "info", f"Processing {area}...", area=area)
log_event("index", "info", f"Indexed {new} new, {skipped} skipped for {area}", area=area)
log_event("index", "error", f"Scrape failed: {message}", area=area)
```

### `api/src/pipeline_data.py` — admin action triggers

```python
log_event("rescrape", "info", f"Admin triggered rescrape for {area}", area=area)
log_event("rebuild", "info", f"Admin triggered rebuild for {area}", area=area)
log_event("index", "info", f"Admin triggered index for {area}", area=area)
log_event("system", "warn", f"Admin deleted {area} from index ({removed} entries)", area=area)
```

---

## Frontend Design

### Halaman `/logs` (`web/src/pages/logs.astro`)

- AuthGuard `adminOnly` (sama seperti `/users`, `/pipeline`)
- Render `<Logs />` component

### Komponen `Logs.tsx`

Layout:
```
┌─────────────────────────────────────────────────────┐
│ Pipeline Logs                          [⟳ Auto-refresh] │
├─────────────────────────────────────────────────────┤
│ Area: [All ▾]  Level: [All ▾]  Search: [_______]   │
├─────┬──────────┬───────┬──────┬────┬────────────────┤
│ TS  │ Area     │ Stage │ Lvl  │ #  │ Message        │
├─────┼──────────┼───────┼──────┼────┼────────────────┤
│10:30│Cengkareng│scrape │ INFO │ 1  │ done 'kos di…  │
│10:29│Cengkareng│scrape │ WARN │ 2  │ timeout 'kos…  │
│10:28│Tambora   │index  │ERROR │ 3  │ Scrape failed  │
└─────┴──────────┴───────┴──────┴────┴────────────────┘
```

Features:
- **Auto-refresh**: toggle ON → poll `GET /logs` tiap 5s saat pipeline running
- **Color-coded level**: green (info), yellow (warn), red (error)
- **Filter chips**: click level badge → filter by that level
- **Expandable rows**: click row → show `extra` JSON detail (job_id, result_count, elapsed)
- **Infinite scroll** atau load-more button (pagination via offset)
- **Empty state**: "No logs yet" illustration

### Navigasi

- Sidebar (`DashboardLayout.astro`): tambah menu "Logs" dengan icon 📋, admin-only
  (sama pattern seperti "Users" — `nav-logs` id, hidden via JS untuk non-admin)
- Mobile nav (`MobileNav.tsx`): tambah "Logs", filtered by role

### API client (`web/src/lib/api.ts`)

```typescript
export async function getLogs(params: {
  area?: string; level?: string; stage?: string; q?: string;
  limit?: number; offset?: number;
}): Promise<{ logs: LogEntry[]; total: number; has_more: boolean }> {
  // GET /logs dengan query params, Authorization header
}
```

---

## Local Development Setup

Sama dengan Sprint 13:
1. Stop `kos-web` dan `kos-api` containers
2. Jalankan API lokal: `.venv/bin/python -c "from api.src.main import app; from uvicorn import run; run(app, port=8081)"`
3. Jalankan Astro dev: `cd web && npm run dev -- --port 4000`
4. Test: trigger search area baru → cek `/logs` page

---

## Out of Scope

| Item | Alasan |
|------|--------|
| Real-time WebSocket streaming | Overkill untuk MVP — polling 5s cukup |
| Log aggregation (Loki/CloudWatch) | Defer ke sprint monitoring (Phase 10 deployment-and-scale.md) |
| Scraper EC2 logs (internal Go logs) | EC2 punya log sendiri; kita cuma log API-side events |
| Email/Slack alerting | Defer — butuh threshold config + notification service |
| Structured logging (JSON to stdout) | Separate concern (replacement untuk print statements); sprint ini fokus UI-facing log viewer |

---

## Acceptance Criteria

- [ ] `GET /logs` returns structured log entries dengan filter working
- [ ] Scraping area baru → log entries muncul real-time di `/logs` (within 5s)
- [ ] Error/timeout terlihat dengan level `warn`/`error` (highlighted merah/kuning)
- [ ] Logs survive container restart (SQLite persistent)
- [ ] `/logs` page hanya accessible by admin (non-admin → redirect)
- [ ] Auto-cleanup: logs > 30 hari terhapus otomatis
- [ ] DB size < 10 MB setelah 10.000 entries

---

## Branch

- Feature: `feat/pipeline-logs`
- Base: `release/standalone` (post-Sprint-13)
- Deploy target: SumoPod VPS (https://kos-ai.athallarizky.com)
