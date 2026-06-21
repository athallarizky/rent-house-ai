# Sprint 2 Summary — UI Dashboard + Agentic Chat

> **Status:** ✅ Complete | 32/32 tasks | Created 2026-06-19
> **Handoff:** next sprint → [`../sprint-3/AGENTS.md`](../sprint-3/AGENTS.md)

---

## 1. Goal

Build the web UI on top of the Sprint 1 backend (geo-router, scraper, processor,
RAG engine, FastAPI). A 3-panel dashboard with agentic chat, map, filters,
settings, search history — plus a session-scoped dataset model refined mid-sprint.

## 2. What Shipped (6 phases + 1 revision)

| Phase | Deliverable |
|-------|-------------|
| 1 — Scaffold | Astro 6 + React 19 + Tailwind 4 + Leaflet project (`web/`), layout, API client, types |
| 2 — Landing | Hero search, area chips, live stats (`/`) |
| 3 — Dashboard | 3-panel `/search`: saved searches (left), chat + streaming (center), kos list/map (right); regency→kecamatan picker; SSE token streaming |
| 4 — Settings | `/settings`: Z.AI provider config, dynamic model list, test connection, server status |
| 5 — Search History | SQLite `saved_searches` + `GET/POST/DELETE /searches` |
| 6 — Polish | Dark mode (light/dark/system), mobile nav + drawers, skeleton/empty/error states |

**Rev-001 (mid-sprint revision):** switched from per-message search to a
**session-scoped dataset model** — load a district once (all kos in the right
panel), chat refines (highlights + sorts relevant kos), switch district via
header switcher. Plan: [`revisions/rev-001-session-dataset-model.md`](./revisions/rev-001-session-dataset-model.md).

## 3. Incidents / RCAs (8 root-cause analyses)

All in [`rca/`](./rca/). Notable:
- **RCA-001** bge-m3 SDPA crash → `attn_implementation="eager"`; **RCA-005** same model 8192-context batch crash → `MAX_DOC_CHARS` + small batch
- **RCA-002** Leaflet floating → CSS import + `invalidateSize` + `min-h-0`
- **RCA-003** chat vs sidebar count desync → single `top_k`
- **RCA-004 / 007 / 008** geo-router mis-resolve (Taman Sari POI, Buahbatu→Blahbatuh) → exact-district match + remove isPoi short-circuit (root fix in geo-router)
- **RCA-006** switch district had no initial recommendation → always run RAG on load

## 4. Key Architecture Decisions

- **Astro islands** (not SPA) — only chat/map hydrate; landing/settings mostly static
- **State in `ChatInterface`** (one `useState` owner, no lib)
- **SSE streaming** (not WebSocket) — `progress → results → token… → done`
- **Session = one district** — `/area/load` (full dataset, cached pipeline) + `/search` (lightweight refine)
- **Geo-router is the source of truth** for area resolution; backend resolves via regency for robustness
- **Single-user local MVP** — no auth; API key in `data/settings.json` (gitignored)

## 5. Tech Stack (exact)

Astro `^6.1.9` · React `^19.2.5` · Tailwind `4.2.4` (pinned + vite override to v7) ·
Leaflet `^1.9.4` + react-leaflet `^5` · react-markdown `^10` · FastAPI + uvicorn ·
Python 3.9 · ChromaDB · `BAAI/bge-m3` (1024-dim, 8192 ctx) · Z.AI `glm-4.5-air` (coding plan endpoint)

## 6. How to Run

```bash
# 4 terminals from repo root:
cd services/geo-router && npm run dev          # :3001
cd api && python3 -m uvicorn src.main:app --port 8080 --reload
cd web && npm run dev                           # :4321
# scraper/processor run lazily via the pipeline on first area load (cached after)
```

## 7. Metrics

- **32 tasks** across 6 phases + **24 rev-001 tasks** (rev-001-tasks.md)
- **8 RCAs**, **6 phase reports**, **2 revision docs**
- ~1113 kos indexed across ~10 districts (Cengkareng, Kebon Jeruk, Kembangan, Grogol Petamburan, Taman Sari, Buahbatu, …)

## 8. Known Issues & Backlog (→ Sprint 3)

See [`../sprint-3/AGENTS.md`](../sprint-3/AGENTS.md) §Backlog for the
prioritized list. Highlights: clear-all history (stub), cross-district search,
persistent RAG server (warm model — biggest perf win), follow-up chat context,
data-quality (255 empty-kecamatan docs, review chunking), geo-router unit tests.
