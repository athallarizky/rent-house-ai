# Phase 2 Report — Landing Page

> Completed: 2026-06-19

---

## 1. How to Run

```bash
cd web
npm run dev
# → open http://localhost:4321
```

The landing page is served at `/`. It is the default route and the entry point of the app.

> The StatsCards island calls `GET /health` on the FastAPI backend (`http://localhost:8080`). If the backend is offline, the page still renders with hardcoded demo stats and an "API offline" status dot — so the landing page is fully usable for design review without the backend running.

---

## 2. Page Sections

```
┌───────────────────────────────────────────────────────────┐
│  Sidebar (Beranda/Pencarian/Pengaturan)  │  Landing hero  │
├───────────────────────────────────────────────────────────┤
│                                                           │
│            [● Didukung AI · 152 kos siap dicari]          │
│                                                           │
│        Cari kos impianmu dengan bahasa sehari-hari        │
│      Ketik "kos di Cengkareng wifi kenceng parkir luas"   │
│                                                           │
│      ┌──────────────────────────────────────────────┐     │
│      │ 🔍  kos di Cengkareng wifi kenceng...   [Cari]│     │
│      └──────────────────────────────────────────────┘     │
│                                                           │
│                     Area populer:                         │
│      [🏙️ Cengkareng] [🏙️ Jakarta Barat] [🏙️ Bandung]      │
│      [🏙️ Surabaya] [🏙️ Yogyakarta] [🏙️ Tangerang]          │
│                                                           │
│           ┌────────┐ ┌────────┐ ┌────────┐               │
│           │  152   │ │ 1.416  │ │ Cengk. │               │
│           │  Kos   │ │Reviews │ │  Area  │               │
│           └────────┘ └────────┘ └────────┘               │
│                  [● API terhubung]                        │
│                                                           │
│                    Cara kerjanya                          │
│      [1 Tulis natural] [2 AI baca reviews] [3 Pilih]      │
│                                                           │
│                   Coba prompt ini                         │
│      [kos di Cengkareng wifi kenceng]  [kos putri …]      │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

---

## 3. Components

### `SearchBar.tsx` (`client:load`)

| Aspect | Detail |
|--------|--------|
| Behavior | Controlled input, auto-focus on mount, Enter or button to submit |
| Submit | `window.location.href = /search?q=<encoded query>` (no client router) |
| Styling | 2xl rounded, 2px border, focus ring (`ring-primary/10`), primary CTA button |
| Props | `initialValue` (from `?q=` round-trip), `placeholder` |

Implementation note: React 19's types deprecate `React.FormEvent` ("doesn't actually exist"), so submit is triggered via an inline `onSubmit={(e) => { e.preventDefault(); submit(); }}` where the event type is inferred — keeping `astro check` at 0 hints.

### `AreaChips.tsx` (`client:visible`)

| Aspect | Detail |
|--------|--------|
| Default areas | Cengkareng, Jakarta Barat, Bandung, Surabaya, Yogyakarta, Tangerang |
| Navigation | Plain `<a href="/search?area=...">` — accessible, supports middle-click, no JS needed for click |
| Styling | Pill chips, hover → primary border/text |

Rendered as real anchor tags rather than JS navigation so they work without hydration and are SEO/accessibility-friendly.

### `StatsCards.tsx` (`client:visible`)

| Aspect | Detail |
|--------|--------|
| Data source | `getHealth()` → if `entries` present, overrides the Kos count |
| Fallback | Hardcoded `152` kos / `1.416` reviews / `Cengkareng` area (per AGENTS.md §4) |
| Status dot | 🟢 "API terhubung" / ⚪ "Mode demo (API offline)" / loading spinner |
| Resilience | Network failure is non-fatal — page renders with demo stats |

This is future-proof: when Phase 5 (or the backend) starts returning `entries` from `/health`, the live count lights up automatically with zero frontend changes.

---

## 4. Navigation Flow

```
Landing (/)
   │
   ├── type + Enter ──────► /search?q=<query>
   ├── click area chip ───► /search?area=<area>
   ├── click prompt chip ─► /search?q=<prompt>
   └── sidebar "Pencarian" ► /search  (empty)
```

All navigation is hard browser navigation (`window.location.href` / `<a>`). There is intentionally no client-side router — the dashboard at `/search` reads `?q=` / `?area=` on mount and kicks off the appropriate flow (built in Phase 3).

The landing page also round-trips `?q=` back into the search bar (`initialValue`), so navigating back to `/` from the dashboard preserves the last query.

---

## 5. Verification

| Check | Result |
|-------|--------|
| `npm run check` (astro check) | **0 errors, 0 warnings, 0 hints** across 12 files |
| `npm run build` | 3 pages built in 1.65s |
| Landing HTML content | Hero, "Area populer", "Cara kerjanya", stats all present |
| Area chip links | All 6 `/search?area=...` links rendered |
| Example prompt links | All `/search?q=...` links rendered |
| Island hydration | `astro-island` elements present (SearchBar, AreaChips, StatsCards) |
| Backend-offline resilience | Page renders with demo stats + "Mode demo" badge |

---

## 6. Known Issues & Notes

| Issue | Impact | Mitigation |
|-------|--------|-----------|
| `/health` does not return `entries` count | Kos count shows hardcoded 152 | StatsCards reads `entries` if present; Phase 5 will extend `/health` to return ChromaDB count — no frontend change needed |
| Stats (1.416 reviews, "Cengkareng" area) are hardcoded | Not live | Acceptable for MVP; single-area (Cengkareng) dataset. Will become live when a stats endpoint exists |
| `React.FormEvent` deprecated in React 19 types | Type-check hint | Used inline `onSubmit` with inferred event type |

---

## 7. Reference Files

| File | Purpose |
|------|---------|
| `web/src/pages/index.astro` | Landing page — hero + chips + stats + how-it-works + example prompts |
| `web/src/components/SearchBar.tsx` | Controlled search input → `/search?q=` |
| `web/src/components/AreaChips.tsx` | Popular-area anchor chips → `/search?area=` |
| `web/src/components/StatsCards.tsx` | 3-card stats with live `/health` + fallback |

> **Ref:** `docs/sprint-2/ux-flow.md` §2 Landing Page
> **Ref:** `docs/sprint-2/AGENTS.md` §4 Phase 2 — Landing Page
