# Sprint 2 — UI Dashboard + Agentic Chat

> Status: ✅ Sprint 2 Complete (Phase 6 Done) | Created: 2026-06-19 | Updated: 2026-06-19
>
> **🤖 Agent Instruction:** Give another LLM [`AGENTS.md`](./AGENTS.md) — self-contained implementation guide with code snippets, file structure, and a 22-step checklist.
>
> Status legend: ⬜ pending | 🔵 in_progress | ✅ completed | ❌ blocked

---

## Phase 1 — Project Scaffold ✅

> 📄 Full report: [`reports/phase-1-report.md`](./reports/phase-1-report.md) — project structure, tech stack, design tokens, verification results

| ID   | Task                                                      | Difficulty | Dependencies | Status |
|------|-----------------------------------------------------------|------------|-------------|--------|
| 1.1  | Init Astro + React + Tailwind project in `web/`           | Easy       | —           | ✅     |
| 1.2  | Copy slack-rag layout patterns (DashboardLayout, icons)   | Easy       | 1.1         | ✅     |
| 1.3  | Setup Tailwind theme (brand colors, shadcn tokens)        | Easy       | 1.1         | ✅     |
| 1.4  | Create page routes: `/`, `/search`, `/settings`           | Easy       | 1.1         | ✅     |
| 1.5  | Setup API client (`web/src/lib/api.ts`)                   | Easy       | 1.1         | ✅     |

### Scaffold Summary

- **Stack:** Astro `^6.1.9` + React `^19.2.5` + Tailwind `4.2.4` + Leaflet + react-markdown (mirrors slack-rag)
- **Files:** `package.json`, `astro.config.mjs`, `tsconfig.json` (`@/*` alias), `.env`, `globals.css`, `DashboardLayout.astro`, `lib/{api,types,utils}.ts`, 3 page stubs, favicon
- **Layout:** 240px sidebar (Beranda / Pencarian / Pengaturan) with brand-blue active states; mobile-collapsible
- **API client:** `searchKos`, `streamSearch` (SSE reader), `resolveLocation`, `expandLocation`, `getHealth`, saved-searches + settings with **localStorage fallback** (Phase 5 swaps in SQLite with zero frontend changes)
- **Verification:** `astro check` → **0 errors / 0 warnings / 0 hints** · `npm run build` → **3 pages built** in 962ms
- **Decision:** Pinned `@tailwindcss/vite`/`tailwindcss` to `4.2.4` + `overrides.vite: ^7.3.5` to fix `@tailwindcss/vite@4.3` ↔ Astro 6 Vite-7 type conflict

---

## Phase 2 — Landing Page ✅

> 📄 Full report: [`reports/phase-2-report.md`](./reports/phase-2-report.md) — component breakdown, navigation flow, verification

| ID   | Task                                                      | Difficulty | Dependencies | Status |
|------|-----------------------------------------------------------|------------|-------------|--------|
| 2.1  | Hero section with search bar + CTA                        | Easy       | 1.4         | ✅     |
| 2.2  | Popular areas chips (Cengkareng, Jakarta Barat, Bandung)  | Easy       | 1.5         | ✅     |
| 2.3  | Stats display (X areas scraped, Y kos indexed)            | Medium     | 1.5         | ✅     |
| 2.4  | Search → redirect to `/search?q=...`                      | Easy       | 2.1         | ✅     |

### Landing Page Summary

- **Components:** `SearchBar.tsx` (`client:load`), `AreaChips.tsx` (`client:visible`), `StatsCards.tsx` (`client:visible`)
- **Hero:** headline + tagline + pill badge ("152 kos siap dicari") + search bar (auto-focus, Enter to submit)
- **Area chips:** 6 areas (Cengkareng, Jakarta Barat, Bandung, Surabaya, Yogyakarta, Tangerang) → `/search?area=...`
- **Stats cards:** 3-card grid (Kos terindeks / Reviews terindex / Area aktif); live `GET /health` with hardcoded fallback (152 kos), online/offline status dot
- **Extras:** "Cara kerjanya" 3-step explainer + example-prompt quick links
- **Navigation:** search submit → `/search?q=...`; area chip → `/search?area=...`; `?q=` round-trips back into the search bar
- **Verification:** `astro check` → **0/0/0** · `npm run build` → 3 pages · all area/prompt links present in rendered HTML

---

## Phase 3 — 3-Panel Dashboard (`/search`) ✅

> 📄 Full report: [`reports/phase-3-report.md`](./reports/phase-3-report.md) — component breakdown, regency→kecamatan flow, SSE protocol, verification

| ID   | Task                                                      | Difficulty | Dependencies | Status |
|------|-----------------------------------------------------------|------------|-------------|--------|
| 3.1  | Left panel: SavedSearches sidebar (load from SQLite API)  | Medium     | 1.5, 2.4    | ✅     |
| 3.2  | Left panel: New search, delete saved search               | Easy       | 3.1         | ✅     |
| 3.3  | Center panel: ChatWindow (messages, streaming)            | Hard       | 1.5         | ✅     |
| 3.3a | Regency detection → kecamatan picker (resolveLocation)     | Medium     | 1.5, 3.3    | ✅     |
| 3.3b | KecamatanPicker component (in-chat chip grid)              | Medium     | 3.3a        | ✅     |
| 3.4  | Center panel: MessageInput (send query)                   | Medium     | 3.3         | ✅     |
| 3.5  | Center panel: SSE streaming (token-by-token render)       | Hard       | 3.3, 1.5    | ✅     |
| 3.6  | Right panel: KosCardList (vertical scroll)                | Medium     | 1.5         | ✅     |
| 3.7  | Right panel: MapView toggle (Leaflet + OSM)               | Hard       | 3.6         | ✅     |
| 3.8  | Filter chips (wifi, AC, parkir, gender) — in-memory       | Medium     | 3.6         | ✅     |
| 3.9  | Kos detail expansion (click card → full reviews)          | Medium     | 3.6         | ✅     |

### Dashboard Summary

- **State owner:** `ChatInterface.tsx` (root, all `useState` — no external state lib)
- **Left panel:** `SavedSearches.tsx` — New search button, scrollable history (query/area/count/relative time), hover-to-delete, active highlight; persists via `saveSavedSearch`/`deleteSavedSearch` with localStorage fallback
- **Center panel:** header (panel toggles + current area) → `ChatWindow` (markdown + streaming cursor + bouncing-dots loader + empty state) → `FilterChips` (in-memory) → `MessageInput` (auto-resize, Enter/Shift+Enter)
- **Right panel:** `KosCardList` with List/Map tabs · list = `KosCard` → click expands `KosDetail` (parsed reviews, click-to-call, Maps link) · map = `MapView` (Leaflet/OSM, marker-icon fix, recenter on select)
- **Regency flow:** `handleSendMessage` calls `resolveLocation` → if `districts.length > 1`, emits a picker message (`isPicker: true`) and parks `pendingArea`; `onPickKecamatan`/`onPickAllKecamatan` resume the search
- **SSE streaming:** backend emits `progress` → `results` → `token`… → `done`; tokens bridge subprocess → async via queue+thread; frontend `streamSearch` async-generator appends live
- **Backend work (done here, supports 3.5):** `summarize_stream()` (OpenAI streaming + chunked fallback), `format_results_stream()` (JSON-line subprocess protocol), `_stream_response()` rewrite; `search_and_rank` now resolves regency → `kecamatan=None` so "Cari di SEMUA" returns cross-district results
- **Layout:** `/search` is a self-contained full-screen shell (`client:only="react"` — Leaflet needs `window`); panels collapse via header toggles; mobile drawers for left/right
- **Verification:** `astro check` → **0/0/0** across 22 files · `npm run build` → 3 pages · `/search` island wired to `ChatInterface` chunk · backend Python parses clean

---

## Phase 4 — Settings Page ✅

> 📄 Full report: [`reports/phase-4-report.md`](./reports/phase-4-report.md) — persistence design, model-name discovery, coding-plan endpoint

| ID   | Task                                                      | Difficulty | Dependencies | Status |
|------|-----------------------------------------------------------|------------|-------------|--------|
| 4.1  | LLM provider config (Z.AI key, model select)              | Easy       | 1.5         | ✅     |
| 4.2  | Save settings to server (SQLite/JSON)                     | Medium     | 4.1         | ✅     |
| 4.3  | Test LLM connection button                                | Easy       | 4.1, 1.5    | ✅     |

### Settings Page Summary

- **Backend:** `api/src/settings.py` — `GET /settings` (masked, no key leak), `PUT /settings` (→ `data/settings.json`), `POST /settings/test` (server-side proxy → avoids browser CORS), `POST /settings/models` (live Z.AI model list)
- **Wiring:** `config.py` reads `api_key`/`model`/`base_url` from `data/settings.json` first → **key dari form benar-benar dipakai** RAG engine (fallback env)
- **Frontend:** `ProviderSettings.tsx` (`client:load`) — provider readonly, model input + **datalist live-fetched**, API key (password + masked hint), editable base_url, Test Connection (✅/❌), Simpan (toast), Data paths section
- **Security:** raw key **never echoed** to client on GET (only `api_key_set` + masked hint) — standard secrets pattern; field kosong saat reload by design
- **Model discovery:** `glm-air` (sprint-1, salah) → `glm/glm-4.5-air` (400) → `glm-4.5-air` (via `/models`) → **coding-plan endpoint** `https://api.z.ai/api/coding/paas/v4/` (PAYG `/paas/v4/` → 429). Default base_url sekarang coding endpoint
- **Verification:** `astro check` **0/0/0** · `POST /settings/test` coding endpoint → ✅ reply · `/search` summary pakai LLM asli

---

## Phase 5 — Backend: Search History API ✅

> 📄 Full report: [`reports/phase-5-report.md`](./reports/phase-5-report.md) — SQLite schema, endpoints, frontend wiring

| ID   | Task                                                      | Difficulty | Dependencies | Status |
|------|-----------------------------------------------------------|------------|-------------|--------|
| 5.1  | SQLite schema: `saved_searches` table                     | Easy       | —           | ✅     |
| 5.2  | FastAPI endpoints: `GET/POST/DELETE /searches`            | Medium     | 5.1         | ✅     |
| 5.3  | Save search on first query (area + query text)            | Easy       | 5.2         | ✅     |
| 5.4  | Re-run saved search (click → auto-fill chat)              | Medium     | 5.2, 3.3    | ✅     |

### Search History Summary

- **Backend:** `api/src/searches.py` — SQLite (`data/search_history.db`, gitignored) + `GET /searches` (newest first), `POST /searches` (INSERT OR REPLACE, generates id/created_at kalau kosong), `DELETE /searches/{id}`. Schema: `saved_searches(id, query_text, area, result_count, created_at, updated_at)`
- **Frontend:** flip `SAVED_SEARCHES_API_ENABLED = true` di `lib/api.ts` → `listSavedSearches`/`saveSavedSearch`/`deleteSavedSearch` sekarang pakai backend (localStorage jadi fallback kalau API down)
- **5.3 (save):** sudah di-wire sejak Rev-001 — `ChatInterface.queryDataset` simpan tiap query eksplisit (auto-recommendation switch tidak disimpan, via flag `saveSearch`)
- **5.4 (re-run):** `SavedSearches.onSelect` → `loadDistrict(area, undefined, query_text)` → muat ulang district + RAG query
- **Verification:** POST/GET/DELETE smoke test OK; `astro check` 0/0/0; build 3 pages

---

## Phase 6 — Polish & Mobile ✅

> 📄 Full report: [`reports/phase-6-report.md`](./reports/phase-6-report.md) — dark mode, mobile drawers, error UX

| ID   | Task                                                      | Difficulty | Dependencies | Status |
|------|-----------------------------------------------------------|------------|-------------|--------|
| 6.1  | Responsive: mobile collapses panels, swipe navigation     | Hard       | 3.x         | ✅     |
| 6.2  | Loading skeletons (shimmer for cards, dots for chat)      | Easy       | 3.x         | ✅     |
| 6.3  | Empty states ("No results", "Start a search")             | Easy       | 3.x         | ✅     |
| 6.4  | Error states (API down, geo-router offline)               | Medium     | 3.x         | ✅     |
| 6.5  | Dark mode toggle                                         | Medium     | 1.3         | ✅     |

### Polish & Mobile Summary

- **6.5 Dark mode:** `lib/theme.ts` (light/dark/system + no-flash inline script), `ThemeToggle.tsx`
  (3-way segmented, persists to `localStorage`, reacts to OS changes in system mode). No-flash
  `<script is:inline>` in DashboardLayout + search.astro heads (no FOUC). Toggle in sidebar
  footer (DashboardLayout) + dashboard header (search.astro). `.dark` tokens already in globals.css.
- **6.1 Mobile:** left & right panels render as **overlay drawers with backdrop** on mobile
  (`fixed inset-0 z-40`), desktop columns unchanged. Panel state now **initializes from viewport
  width** (closed on mobile, open on desktop) so drawers don't auto-open on load. Selecting a kos
  in the mobile right drawer closes it.
- **6.2 Skeletons:** chat bouncing-dots loader, card shimmer (`animate-pulse`), stats spinner —
  all in place from Phases 2–5.
- **6.3 Empty states:** chat "Mulai pencarian", results "Belum ada kos", history "Belum ada
  riwayat", saved-searches empty.
- **6.4 Errors:** `friendlyError()` maps `Failed to fetch` / 502 / geo-router-unavailable to
  Indonesian guidance ("Pastikan FastAPI (:8080) & geo-router (:3001) berjalan"). Error banner in
  dashboard header; StatsCards offline badge on landing.
- **Verification:** `astro check` 0/0/0 (26 files) · build 3 pages · no-flash script + ThemeToggle
  island confirmed in rendered HTML across `/`, `/settings`, `/search`

---

## Dependency Graph

```
Phase 1 ───────────────────────────────────────────┐
  1.1 ──► 1.2, 1.3, 1.4, 1.5                      │
                                                    │
Phase 2 ────────────────────────────────────────────┤
  1.4 ──► 2.1 ──► 2.4                              │
  1.5 ──► 2.3                                      │
                                                    │
Phase 3 ────────────────────────────────────────────┤
  1.5 ──► 3.1, 3.3, 3.6                            │
  2.4 ──► 3.x (all)                                 │
  3.1 ──► 3.2                                      │
  3.3 ──► 3.4, 3.5                                 │
  3.6 ──► 3.7, 3.8, 3.9                            │
                                                    │
Phase 4 ────────────────────────────────────────────┤
  1.5 ──► 4.1 ──► 4.2, 4.3                          │
                                                    │
Phase 5 ────────────────────────────────────────────┤
  5.1 ──► 5.2 ──► 5.3, 5.4                          │
                                                    │
Phase 6 ────────────────────────────────────────────┤
  3.x ──► 6.1, 6.2, 6.3, 6.4                       │
  1.3 ──► 6.5                                      │
```

---

## Summary

| Phase                    | Tasks | Est. Hours | Status |
|--------------------------|-------|-----------|--------|
| 1 — Project Scaffold     | 5     | 3h        | ✅     |
| 2 — Landing Page         | 4     | 2h        | ✅     |
| 3 — 3-Panel Dashboard    | 11       | 14h       | ✅     |
| 4 — Settings Page        | 3     | 2h        | ✅     |
| 5 — Search History API   | 4     | 3h        | ✅     |
| 6 — Polish & Mobile      | 5     | 5h        | ✅     |
| **Total**                | **32** | **~29h**  | **✅** |

> **Ref:** `docs/sprint-2/architecture.md` — tech stack, component tree
> **Ref:** `docs/sprint-2/ux-flow.md` — screen designs, user flow
