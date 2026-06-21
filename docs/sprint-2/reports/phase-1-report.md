# Phase 1 Report — Project Scaffold

> Completed: 2026-06-19

---

## 1. How to Run

All commands run from the project root (`rent-house-ai/`).

### Install Dependencies

```bash
cd web
npm install
```

### Start the Dev Server

```bash
cd web
npm run dev
# → http://localhost:4321
```

Three routes are available (currently stubs, filled in later phases):

| Route | Status |
|-------|--------|
| `/` | Stub — built in Phase 2 |
| `/search` | Stub — built in Phase 3 |
| `/settings` | Stub — built in Phase 4 |

### Type-Check & Build

```bash
cd web
npm run check    # astro check — 0 errors, 0 warnings, 0 hints
npm run build    # production build — 3 pages built
```

### Run the Full Stack

```bash
# Terminal 1: Geo-router
cd services/geo-router && npm run dev          # :3001

# Terminal 2: FastAPI
cd api && python3 -m uvicorn src.main:app --port 8080

# Terminal 3: Web UI
cd web && npm run dev                           # :4321
```

---

## 2. Project Structure

```
web/
├── astro.config.mjs          # Astro 6 + React 19 + Tailwind 4 (Vite plugin)
├── package.json              # Pinned deps + vite override
├── tsconfig.json             # Strict, @/* path alias → ./src/*
├── .env                      # PUBLIC_API_URL=http://localhost:8080
├── .gitignore
├── public/
│   └── favicon.svg
└── src/
    ├── styles/
    │   └── globals.css       # Tailwind 4 + shadcn CSS tokens (brand blue) + dark theme
    ├── layouts/
    │   └── DashboardLayout.astro   # Sidebar nav: Beranda / Pencarian / Pengaturan
    ├── pages/
    │   ├── index.astro       # /  (stub — Phase 2)
    │   ├── search.astro      # /search  (stub — Phase 3)
    │   └── settings.astro    # /settings  (stub — Phase 4)
    └── lib/
        ├── api.ts            # API client (search, SSE stream, locations, health, saved searches, settings)
        ├── types.ts          # All TypeScript interfaces + TAG_LABELS/chip styles
        └── utils.ts          # cn(), time/distance formatters, extractArea(), uuid()
```

---

## 3. Tech Stack

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| Framework | Astro | `^6.1.9` | SSR-ready, islands architecture |
| UI | React | `^19.2.5` | Hydrated islands only |
| Styling | Tailwind CSS | `4.2.4` (pinned) | Via `@tailwindcss/vite` plugin |
| Map | Leaflet + react-leaflet | `^1.9.4` / `^5.0.0` | Free OSM tiles |
| Markdown | react-markdown + remark-gfm | `^10.1.0` / `^4.0.1` | LLM response rendering |
| Icons | lucide-react | `^0.469.0` | — |
| State | React `useState` only | — | No external state lib (per architecture doc) |
| API | Native `fetch` | — | No Axios / React Query |

Mirrors the slack-rag `web/` stack (same Astro 6 + React 19 + Tailwind 4), with Leaflet added for the map panel.

---

## 4. Design Tokens

`globals.css` defines the shadcn token set with a **brand-blue primary** (matching `architecture.md` §3):

```
Primary:    hsl(221 83% 53%)  → blue-600 (search buttons, active nav, links)
Background: white            (slate-50 for cards)
Text:       slate-900 / slate-600
Border:     slate-200
Radius:     0.75rem (rounded-xl default)
```

Dark mode tokens are defined under `.dark` (wired up in Phase 6 toggle). Additional utilities baked into the stylesheet:

- `.prose-chat` — markdown rendering styles for chat bubbles (headings, lists, code, tables, blockquotes)
- `.streaming-cursor` — blinking cursor for live LLM token streaming
- `.thin-scroll` — slim scrollbars for sidebars and result lists
- Leaflet container sizing (100% × 100%)

---

## 5. API Client (`src/lib/api.ts`)

Wraps the FastAPI backend at `http://localhost:8080` (via `PUBLIC_API_URL`).

| Function | Purpose |
|----------|---------|
| `searchKos(req)` | Non-streaming `POST /search` |
| `streamSearch(req)` | Async generator over SSE `POST /search` (yields normalized `{type, ...}` events) |
| `resolveLocation(q)` | `GET /locations/resolve` — regency vs district detection |
| `expandLocation(q)` | `GET /locations/expand` — regency → kecamatan list |
| `getHealth()` | `GET /health` |
| `listSavedSearches()` / `saveSavedSearch()` / `deleteSavedSearch()` | Phase 5 SQLite, with **localStorage fallback** for now |
| `loadSettings()` / `persistSettings()` | Z.AI provider config (localStorage until Phase 5) |

The SSE reader follows the slack-rag pattern: line-buffered `data:` parsing with `[DONE]` sentinel handling. The normalized event shapes (`progress` / `token` / `results` / `pipeline` / `done`) match what Phase 5 will emit from the FastAPI backend.

---

## 6. Layout

`DashboardLayout.astro` provides:

- **Desktop:** fixed 240px sidebar (`hidden md:flex`) with logo + nav + footer version
- **Active state:** `bg-primary/10 text-primary` keyed off `Astro.url.pathname`
- **Mobile:** sidebar collapses (hamburger drawer wired up in Phase 6)
- Nav items: 🏡 Beranda (`/`), 🔍 Pencarian (`/search`), ⚙️ Pengaturan (`/settings`)

---

## 7. Verification

| Check | Result |
|-------|--------|
| `npm install` | 350 packages, 0 install errors |
| `npm run check` (astro check) | **0 errors, 0 warnings, 0 hints** across 9 files |
| `npm run build` | **3 pages built** in 962ms, no warnings |
| Routes generated | `/index.html`, `/search/index.html`, `/settings/index.html` |

---

## 8. Known Issues & Decisions

| Issue | Impact | Mitigation |
|-------|--------|-----------|
| `@tailwindcss/vite@4.3` pulls Vite 8, but Astro 6 uses Vite 7 | `astro check` type error (rollup vs rolldown `PluginOption` mismatch) | Pinned `@tailwindcss/vite` + `tailwindcss` to `4.2.4` and added `overrides: { vite: "^7.3.5" }` to force a single Vite 7 instance across the tree |
| React 19 `@types` stricter than slack-rag's usage | Potential `any` lint noise later | Strict tsconfig kept; will resolve per-component in Phase 3 |
| Saved searches / settings have no backend yet | Data lives in localStorage | `api.ts` written to call `GET/POST/DELETE /searches` first and fall back to localStorage — Phase 5 builds the SQLite layer and it works with zero frontend changes |
| `/health` does not currently return `entries` count | `StatsCards` can't show live kos count yet | Phase 2 will extend `/health` (or add a `/stats` endpoint) to return indexed entry count |

---

## 9. Reference Files

| File | Purpose |
|------|---------|
| `web/package.json` | Pinned dependency manifest + vite override |
| `web/astro.config.mjs` | Astro + React + Tailwind integration |
| `web/tsconfig.json` | Strict TS config with `@/*` alias |
| `web/src/styles/globals.css` | Tailwind + shadcn tokens + prose/streaming/scroll utilities |
| `web/src/layouts/DashboardLayout.astro` | Sidebar nav shell (3 routes) |
| `web/src/lib/api.ts` | API client + SSE reader + localStorage fallbacks |
| `web/src/lib/types.ts` | Shared TypeScript interfaces + tag label/style maps |
| `web/src/lib/utils.ts` | `cn()` + time/distance/score formatters + `extractArea()` |
| `web/src/pages/{index,search,settings}.astro` | Route stubs for Phases 2–4 |
| `web/public/favicon.svg` | Brand favicon |

> **Ref:** `docs/sprint-2/architecture.md` — component tree, tech stack rationale
> **Ref:** `docs/sprint-2/AGENTS.md` — §2 Project Scaffold, §6 API Client, §7 TypeScript Types
