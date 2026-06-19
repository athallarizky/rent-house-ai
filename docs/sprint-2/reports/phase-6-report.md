# Phase 6 Report — Polish & Mobile

> Completed: 2026-06-19
> Sprint 2 final phase.

---

## 1. Overview

Final polish: dark mode, mobile drawers, and error UX. Skeletons (6.2) and empty
states (6.3) were already implemented during Phases 2–5; Phase 6 adds the two
missing pieces (dark mode, mobile) plus an error-message polish layer.

| Area | Status coming in | Phase 6 added |
|------|------------------|---------------|
| 6.1 Mobile | right panel inaccessible on phone | right-panel drawer + viewport-aware init |
| 6.2 Skeletons | chat dots, card shimmer, stats spinner | (already done) |
| 6.3 Empty states | chat / results / history empties | (already done) |
| 6.4 Errors | raw fetch errors surfaced | `friendlyError()` → Indonesian guidance |
| 6.5 Dark mode | `.dark` tokens only, no toggle | theme lib + ThemeToggle + no-flash |

---

## 2. Dark Mode (6.5)

### Stack
- **`lib/theme.ts`** — `Theme = "light" | "dark" | "system"`; `getStoredTheme`,
  `storeTheme`, `applyTheme`, `isDark`, and `noFlashScript` (a string of inline JS).
- **`components/ThemeToggle.tsx`** — 3-way segmented control (Sun/Monitor/Moon);
  persists to `localStorage["kos-ai.theme"]`; in "system" mode, listens to
  `matchMedia("(prefers-color-scheme: dark)")` and re-applies on OS change.
- **No FOUC:** `<script is:inline set:html={noFlashScript} />` in the `<head>` of
  `DashboardLayout.astro` AND `search.astro`. Runs before first paint, toggles
  `.dark` on `<html>` from stored preference.

### Placement
- `DashboardLayout.astro` sidebar footer (covers `/` and `/settings`)
- `ChatInterface.tsx` dashboard header (covers `/search`, which uses its own shell)

### Tokens
Already defined in Phase 1 `globals.css` (`.dark { --background, --primary, … }`),
plus `@theme inline` maps them to Tailwind colors — so every component flips
automatically when `.dark` is on `<html>`.

---

## 3. Mobile Responsive (6.1)

### Panel drawers
Both left and right panels now render as **overlay drawers with backdrop** on
mobile, mirroring each other:

```
mobile (< md):
  showLeft true  → fixed inset-0 z-40 drawer (w-64) + backdrop
  showRight true → fixed inset-0 z-40 drawer (w-80) + backdrop
desktop (≥ md):
  static columns (w-64 / w-80) as before
```

### Global mobile navigation (`MobileNav.tsx`)
The DashboardLayout sidebar is `hidden md:flex`, so on mobile there was no way
to navigate between Beranda / Pencarian / Pengaturan. Added a `MobileNav` island:
a hamburger (☰) that opens a drawer overlay with the three routes + theme toggle.
Placed in:
- `DashboardLayout.astro` — a `md:hidden` top bar (covers `/` and `/settings`)
- `ChatInterface.tsx` header — so `/search` (own shell) can also navigate away

### Viewport-aware init
Panel state previously defaulted to `true`, which auto-opened both drawers on a
phone load. Now initialized from `window.innerWidth >= 768`:

```ts
const [showLeft, setShowLeft] = useState(() => window.innerWidth >= 768);
const [showRight, setShowRight] = useState(() => window.innerWidth >= 768);
```

→ panels open by default on desktop, closed on mobile (opened via the header
hamburger / panel-right toggles).

### Mobile interactions
- Selecting a kos in the mobile right drawer closes the drawer (back to chat)
- Backdrop click closes either drawer
- Header toggles (`PanelLeft` / `PanelRight`) work in both layouts

> Swipe gesture between panels (optional in the spec) is deferred — toggle + drawer
> is sufficient and more discoverable.

---

## 4. Error UX (6.4)

**`lib/utils.ts` → `friendlyError(e, fallback)`** maps low-level errors to
Indonesian guidance:

| Detected | Message |
|----------|---------|
| `Failed to fetch` / `NetworkError` | "Tidak bisa terhubung ke server. Pastikan FastAPI (:8080) & geo-router (:3001) berjalan." |
| `resolveLocation failed (502)` / geo-router | "Geo-router tidak tersedia (:3001). Jalankan `npm run dev` di services/geo-router." |
| 502 / Bad Gateway | "Server upstream tidak tersedia (502). Cek service backend." |
| other | fallback |

Used in `ChatInterface` catch blocks (`handleSendMessage`, `loadDistrict`,
`queryDataset`). Landing `StatsCards` already has an "API offline" badge from Phase 2.

---

## 5. Skeletons & Empty States (6.2 / 6.3 — recap)

Already in place from earlier phases:

| State | Where | Style |
|-------|-------|-------|
| Chat loading | `ChatWindow` | 3 bouncing dots |
| Results loading | `KosCardList` | shimmer (`animate-pulse`) cards ×6 |
| Stats loading | `StatsCards` | spinner |
| Chat empty | `ChatWindow` | "Mulai pencarian" hint |
| Results empty | `KosCardList` | "Belum ada kos" |
| History empty | `SavedSearches` | "Belum ada riwayat pencarian" |

---

## 6. Verification

| Check | Result |
|-------|--------|
| `astro check` | 0 errors / 0 warnings / 0 hints (26 files) |
| `npm run build` | 3 pages built |
| `/` landing | no-flash script + ThemeToggle island present in HTML |
| `/settings` | script + toggle present (via DashboardLayout) |
| `/search` | no-flash script in shell; toggle hydrates client-side |
| Mobile (viewport < 768) | panels init closed; open as drawers via toggles |
| Dark mode | persisted, no flash on reload, reacts to OS in system mode |

---

## 7. Known Limitations / Backlog

| Item | Note |
|------|------|
| No swipe gesture between mobile panels | Toggle + drawer used instead (more discoverable) |
| Dark mode for Leaflet map tiles | OSM tiles stay light; could swap to a dark tile provider later |
| `friendlyError` is heuristic (string match) | Good enough for MVP; a typed error envelope from backend would be cleaner |

---

## 8. Reference Files

| File | Purpose |
|------|---------|
| `web/src/lib/theme.ts` | Theme types, persistence, apply, no-flash script |
| `web/src/components/ThemeToggle.tsx` | 3-way light/dark/system toggle |
| `web/src/layouts/DashboardLayout.astro` | no-flash script + sidebar toggle |
| `web/src/pages/search.astro` | no-flash script (own shell) |
| `web/src/components/ChatInterface.tsx` | header ThemeToggle + mobile drawers + viewport init + friendlyError |
| `web/src/lib/utils.ts` | `friendlyError()` |

> **Ref:** `docs/sprint-2/ux-flow.md` §5 Mobile / Responsive
