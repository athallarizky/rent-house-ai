# Phase 3 Report — 3-Panel Dashboard (`/search`)

> Completed: 2026-06-19

---

## 1. How to Run

```bash
# Terminal 1: Geo-router
cd services/geo-router && npm run dev          # :3001

# Terminal 2: FastAPI
cd api && python3 -m uvicorn src.main:app --port 8080

# Terminal 3: Web UI
cd web && npm run dev                           # :4321 → open /search
```

The dashboard lives at `/search`. It bootstraps from URL params:

| URL | Behavior |
|-----|----------|
| `/search` | Empty state — type to start |
| `/search?area=Cengkareng` | Auto-sends "kos di Cengkareng" |
| `/search?q=wifi kenceng` | Auto-sends the query (area auto-extracted or default Cengkareng) |
| `/search?q=...&area=Jakarta%20Barat` | Regency query → shows kecamatan picker |

---

## 2. Component Tree

```
search.astro  (self-contained HTML shell, NO global sidebar)
└── ChatInterface  client:only="react"   ← ROOT STATE OWNER
    │
    ├── [Left · w-64]  SavedSearches
    │     props: searches, activeSearchId, onSelect, onNew, onDelete
    │
    ├── [Center · flex-1]
    │     ├── Header  (PanelLeft toggle · "Kos AI" · area · PanelRight toggle)
    │     ├── Error banner (if any)
    │     ├── ChatWindow
    │     │     props: messages, isLoading, streamingContent,
    │     │            onPickKecamatan, onPickAllKecamatan
    │     │     ├── empty state
    │     │     ├── message bubbles (user right/blue · assistant left/gray)
    │     │     ├── isPicker message → KecamatanPicker
    │     │     ├── streaming bubble (markdown + blinking cursor)
    │     │     └── bouncing-dots loader
    │     ├── FilterChips  (in-memory: wifi, ac, parkir, dapur, km_dalam, gender)
    │     └── MessageInput (auto-resize textarea · Enter send · Shift+Enter newline)
    │
    └── [Right · w-80]  KosCardList
          ├── Tabs: [List] [Map]
          ├── List mode → KosCard × N  → click → KosDetail (parsed reviews, tel:, Maps link)
          ├── Map mode  → MapView (Leaflet/OSM, markers, popups, recenter)
          └── empty + loading-skeleton states
```

`/search` does **not** use `DashboardLayout` — the global sidebar is replaced by the 3 panels. `search.astro` provides its own HTML shell + `globals.css` import.

---

## 3. State Management (ChatInterface)

All state in `useState` (no external library, per architecture.md §4):

| State | Purpose |
|-------|---------|
| `messages` | Chat history (`Message[]`, includes `isPicker`/`districts` for kecamatan flow) |
| `isLoading` / `streamingContent` | Search-in-progress + live token buffer |
| `results` | Raw kos list from API |
| `filteredResults` | `useMemo(results × filters)` — instant in-memory filtering |
| `savedSearches` / `activeSearchId` | Left panel history |
| `rightPanelMode` | `"list"` \| `"map"` |
| `selectedKos` | Expanded card in right panel |
| `filters` | `{wifi,ac,parkir,dapur,kamar_mandi_dalam,gender}` |
| `showLeft` / `showRight` | Panel visibility (header toggles) |
| `pendingArea` | Parked `{query, regency}` while user picks a kecamatan |
| `error` / `currentArea` | UI banners |

---

## 4. Regency → Kecamatan Flow (critical)

```
handleSendMessage(text, areaHint?)
  │  area = areaHint || extractArea(text) || currentArea || "Cengkareng"
  │  push user message
  ▼
resolveLocation(area)
  │
  ├── districts.length > 1  →  REGENCY
  │     push assistant message { isPicker: true, districts }
  │     setPendingArea({ query: text, regency })
  │     STOP  (no search yet)
  │
  └── districts.length === 1  →  DISTRICT
        doSearch(text, districts[0].name)

onPickKecamatan(name)   → push "[name]" · doSearch(pendingArea.query, name)
onPickAllKecamatan()    → push "[Cari di semua …]" · doSearch(query, regency)
```

Backend support: `search_and_rank` now resolves the area first — a regency (multiple districts) searches with `kecamatan=None` (all indexed kos) instead of a non-matching kecamatan name, so "Cari di SEMUA" returns real results.

---

## 5. SSE Streaming (task 3.5)

### Protocol (server → client)

```
data: {"type":"progress","stage":"search","message":"Mencari kos di Cengkareng…"}
data: {"type":"pipeline","pipeline":{...}}
data: {"type":"results","results":[{...kos...}]}
data: {"type":"token","token":"Berikut"}
data: {"type":"token","token":" rekomendasi"}
…
data: {"type":"done"}
```

`results` is emitted **before** tokens, so the right panel populates immediately while the LLM summary streams.

### Backend changes

| File | Change |
|------|--------|
| `services/rag-engine/src/summarize.py` | New `summarize_stream()` — OpenAI `stream=True`; falls back to `_chunk_text()` pseudo-streaming when no API key |
| `api/src/orchestrator.py` | New `format_results_stream()` — runs the RAG engine in a subprocess, prints each token as a JSON line `{"t": ...}`, read incrementally |
| `api/src/search.py` | `_stream_response()` rewrite — `progress → results → token… → done`; sync subprocess tokens bridged to the async loop via a `Queue` + thread (true incremental streaming, not buffered) |

The non-streaming `POST /search` response shape is **unchanged** — Phase 1/2 consumers still work.

### Frontend

`streamSearch()` (in `lib/api.ts`, built in Phase 1) is an async generator over the line-buffered SSE stream. `doSearch()` loops it: `results` → `setResults`, `token` → append to `streamingContent`, `done` → finalize message + save search.

---

## 6. In-Memory Filtering (task 3.8)

No API round-trip — filters apply instantly:

```ts
filteredResults = useMemo(() => results.filter(matchesAll(filters)), [results, filters])
```

- Tag chips (`wifi`/`ac`/`parkir`/`dapur`/`kamar_mandi_dalam`) toggle booleans; each shows a live count from current results, hidden when 0
- Gender chips (`Putri`/`Putra`/`Campur`) are tri-state toggle (click again to clear)
- `Reset (N)` button appears when any filter is active

---

## 7. Right Panel — List & Map (tasks 3.6 / 3.7 / 3.9)

- **`KosCard`** — name, rating star, kecamatan, up to 4 facility chips (color-coded per `TAG_CHIP_STYLES`), review count, match %
- **`KosDetail`** — parses `kos.text` into sections + `[N★]` reviews; click-to-call (`tel:`), Google Maps deep link (`place_id`), full facility chips, star-rendered review ratings
- **`MapView`** — react-leaflet + OSM tiles; marker-icon bundler fix (`leaflet/dist/images/*`); `Recenter` helper moves view on select; popups show name/rating/tags
- Tabs switch list↔map sharing the same 320px column (no layout shift); loading skeleton + empty state included

---

## 8. Mobile / Responsive

- Left & right panels: static columns on `md+`, **fixed overlay drawers with backdrop** on mobile
- Header `PanelLeft`/`PanelRight` buttons toggle panels (and close the drawer on mobile after a pick)
- Filter chips wrap; cards stack full-width
- Fine swipe polish is deferred to Phase 6

---

## 9. Verification

| Check | Result |
|-------|--------|
| `npm run check` (astro check) | **0 errors, 0 warnings, 0 hints** across 22 files |
| `npm run build` | 3 pages built in 2.30s |
| `/search` island | `astro-island` → `ChatInterface.BNDKVcsw.js` (client-only React) |
| Landing page | Still renders correctly (no regression) |
| Backend Python | `search.py`, `orchestrator.py`, `summarize.py` all parse cleanly |
| Non-streaming `/search` | Response shape unchanged (Phase 1/2 compatible) |

---

## 10. Known Issues & Notes

| Issue | Impact | Mitigation |
|-------|--------|-----------|
| Leaflet needs `window` at import time | Breaks Astro static pre-render of `/search` | Used `client:only="react"` on ChatInterface (no SSR for the dashboard — acceptable, it's interactive-only) |
| Leaflet marker image paths | Build fails if wrong | Use `leaflet/dist/images/*.png` (not `leaflet/dist/*.png`) |
| React 19 deprecates `FormEvent` | Type hint | Inline `onSubmit` with inferred event (see SearchBar) |
| Saved searches use localStorage until Phase 5 | Not shared across devices | `api.ts` already calls `/searches` first and falls back — Phase 5 SQLite works with zero frontend change |
| "Cari di SEMUA" searches the whole index | Returns all indexed kos (currently Cengkareng) | Correct behavior; will naturally scope as more areas are scraped/indexed |
| Saved-search select re-runs via `handleSendMessage` | Creates a new saved-search entry on re-run | Acceptable for MVP; dedup can be added in Phase 5 |

---

## 11. Reference Files

| File | Purpose |
|------|---------|
| `web/src/pages/search.astro` | Self-contained HTML shell + `<ChatInterface client:only="react" />` |
| `web/src/components/ChatInterface.tsx` | Root state owner — all flows wired here |
| `web/src/components/ChatWindow.tsx` | Message list, markdown, streaming, picker rendering |
| `web/src/components/MessageInput.tsx` | Auto-resize textarea input |
| `web/src/components/KecamatanPicker.tsx` | In-chat regency → kecamatan chip grid |
| `web/src/components/SavedSearches.tsx` | Left panel history sidebar |
| `web/src/components/KosCardList.tsx` | Right panel with List/Map tabs |
| `web/src/components/KosCard.tsx` / `KosDetail.tsx` | Result card + expanded detail |
| `web/src/components/FilterChips.tsx` | In-memory facility/gender filters |
| `web/src/components/MapView.tsx` | Leaflet map |
| `api/src/search.py` | SSE `_stream_response` + `_format_items` |
| `api/src/orchestrator.py` | `format_results_stream` + regency-aware `search_and_rank` |
| `services/rag-engine/src/summarize.py` | `summarize_stream` token generator |

> **Ref:** `docs/sprint-2/architecture.md` — component tree, data flow, SSE protocol
> **Ref:** `docs/sprint-2/ux-flow.md` §3 Dashboard + §2a Regency picker
> **Ref:** `docs/sprint-2/AGENTS.md` §3–§5
