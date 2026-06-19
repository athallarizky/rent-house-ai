# Sprint 2 — UI Dashboard + Agentic Chat

> Status: 🟡 Planning | Created: 2026-06-19
>
> **🤖 Agent Instruction:** Give another LLM [`AGENTS.md`](./AGENTS.md) — self-contained implementation guide with code snippets, file structure, and a 22-step checklist.
>
> Status legend: ⬜ pending | 🔵 in_progress | ✅ completed | ❌ blocked

---

## Phase 1 — Project Scaffold

| ID   | Task                                                      | Difficulty | Dependencies | Status |
|------|-----------------------------------------------------------|------------|-------------|--------|
| 1.1  | Init Astro + React + Tailwind project in `web/`           | Easy       | —           | ⬜     |
| 1.2  | Copy slack-rag layout patterns (DashboardLayout, icons)   | Easy       | 1.1         | ⬜     |
| 1.3  | Setup Tailwind theme (brand colors, shadcn tokens)        | Easy       | 1.1         | ⬜     |
| 1.4  | Create page routes: `/`, `/search`, `/settings`           | Easy       | 1.1         | ⬜     |
| 1.5  | Setup API client (`web/src/lib/api.ts`)                   | Easy       | 1.1         | ⬜     |

---

## Phase 2 — Landing Page

| ID   | Task                                                      | Difficulty | Dependencies | Status |
|------|-----------------------------------------------------------|------------|-------------|--------|
| 2.1  | Hero section with search bar + CTA                        | Easy       | 1.4         | ⬜     |
| 2.2  | Popular areas chips (Cengkareng, Jakarta Barat, Bandung)  | Easy       | 1.5         | ⬜     |
| 2.3  | Stats display (X areas scraped, Y kos indexed)            | Medium     | 1.5         | ⬜     |
| 2.4  | Search → redirect to `/search?q=...`                      | Easy       | 2.1         | ⬜     |

---

## Phase 3 — 3-Panel Dashboard (`/search`)

| ID   | Task                                                      | Difficulty | Dependencies | Status |
|------|-----------------------------------------------------------|------------|-------------|--------|
| 3.1  | Left panel: SavedSearches sidebar (load from SQLite API)  | Medium     | 1.5, 2.4    | ⬜     |
| 3.2  | Left panel: New search, delete saved search               | Easy       | 3.1         | ⬜     |
| 3.3  | Center panel: ChatWindow (messages, streaming)            | Hard       | 1.5         | ⬜     |
| 3.3a | Regency detection → kecamatan picker (resolveLocation)     | Medium     | 1.5, 3.3    | ⬜     |
| 3.3b | KecamatanPicker component (in-chat chip grid)              | Medium     | 3.3a        | ⬜     |
| 3.4  | Center panel: MessageInput (send query)                   | Medium     | 3.3         | ⬜     |
| 3.5  | Center panel: SSE streaming (token-by-token render)       | Hard       | 3.3, 1.5    | ⬜     |
| 3.6  | Right panel: KosCardList (vertical scroll)                | Medium     | 1.5         | ⬜     |
| 3.7  | Right panel: MapView toggle (Leaflet + OSM)               | Hard       | 3.6         | ⬜     |
| 3.8  | Filter chips (wifi, AC, parkir, gender) — in-memory       | Medium     | 3.6         | ⬜     |
| 3.9  | Kos detail expansion (click card → full reviews)          | Medium     | 3.6         | ⬜     |

---

## Phase 4 — Settings Page

| ID   | Task                                                      | Difficulty | Dependencies | Status |
|------|-----------------------------------------------------------|------------|-------------|--------|
| 4.1  | LLM provider config (Z.AI key, model select)              | Easy       | 1.5         | ⬜     |
| 4.2  | Save settings to server (SQLite/JSON)                     | Medium     | 4.1         | ⬜     |
| 4.3  | Test LLM connection button                                | Easy       | 4.1, 1.5    | ⬜     |

---

## Phase 5 — Backend: Search History API

| ID   | Task                                                      | Difficulty | Dependencies | Status |
|------|-----------------------------------------------------------|------------|-------------|--------|
| 5.1  | SQLite schema: `saved_searches` table                     | Easy       | —           | ⬜     |
| 5.2  | FastAPI endpoints: `GET/POST/DELETE /searches`            | Medium     | 5.1         | ⬜     |
| 5.3  | Save search on first query (area + query text)            | Easy       | 5.2         | ⬜     |
| 5.4  | Re-run saved search (click → auto-fill chat)              | Medium     | 5.2, 3.3    | ⬜     |

---

## Phase 6 — Polish & Mobile

| ID   | Task                                                      | Difficulty | Dependencies | Status |
|------|-----------------------------------------------------------|------------|-------------|--------|
| 6.1  | Responsive: mobile collapses panels, swipe navigation     | Hard       | 3.x         | ⬜     |
| 6.2  | Loading skeletons (shimmer for cards, dots for chat)      | Easy       | 3.x         | ⬜     |
| 6.3  | Empty states ("No results", "Start a search")             | Easy       | 3.x         | ⬜     |
| 6.4  | Error states (API down, geo-router offline)               | Medium     | 3.x         | ⬜     |
| 6.5  | Dark mode toggle                                         | Medium     | 1.3         | ⬜     |

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
| 1 — Project Scaffold     | 5     | 3h        | ⬜     |
| 2 — Landing Page         | 4     | 2h        | ⬜     |
| 3 — 3-Panel Dashboard    | 11       | 14h       | ⬜     |
| 4 — Settings Page        | 3     | 2h        | ⬜     |
| 5 — Search History API   | 4     | 3h        | ⬜     |
| 6 — Polish & Mobile      | 5     | 5h        | ⬜     |
| **Total**                | **32** | **~29h**  |        |

> **Ref:** `docs/sprint-2/architecture.md` — tech stack, component tree
> **Ref:** `docs/sprint-2/ux-flow.md` — screen designs, user flow
