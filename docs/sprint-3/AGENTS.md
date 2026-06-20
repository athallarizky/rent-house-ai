# Sprint 3 — Handoff Instructions (Meta-Prompt for the Delegate Agent)

> **You are:** an autonomous software-engineering agent taking over this project.
> **Sprint 3 mission:** the app works end-to-end (Sprint 2 shipped). Your focus is
> **improving functionality + general improvements** — make it more capable, robust,
> and pleasant. Not a rewrite; iterate on what exists.
> **Read this whole file before doing anything.**

---

## 0. First, Read These

1. [`../sprint-2/SUMMARY.md`](../sprint-2/SUMMARY.md) — what shipped (current state)
2. [`../sprint-2/AGENTS.md`](../sprint-2/AGENTS.md) — original implementation guide (tech stack, file structure, conventions)
3. [`../sprint-2/rca/`](../sprint-2/rca/) — 8 RCAs; each has a **§6 Action Items** backlog (your source of robustness work)
4. [`../sprint-2/revisions/rev-001-session-dataset-model.md`](../sprint-2/revisions/rev-001-session-dataset-model.md) — the session model (important mental model)

Do NOT rebuild anything that already works. Audit before editing.

---

## 1. Project Overview

**Kos AI** — natural-language search for Indonesian boarding houses (kos). User
asks ("kos di Cengkareng wifi kenceng") → scrape Google Maps → process → embed →
semantic search → LLM recommendation, in a chat dashboard with map + filters.

```
rent-house-ai/
├── services/
│   ├── geo-router/      Node Fastify :3001  — area resolution (kodepos, 83K entries)
│   ├── scraper/         Python + Go binary  — Google Maps scraping → data/raw/<area>/
│   ├── data-processor/  Python              — raw → cleaned docs
│   └── rag-engine/      Python (ChromaDB)   — embed/search/rank/summarize
├── api/                 FastAPI :8080       — orchestrates everything
├── data/                chroma_db/, raw/, cleaned/, settings.json (gitignored), search_history.db (gitignored)
├── web/                 Astro :4321         — the dashboard (this sprint's focus)
└── docs/                sprint-1/, sprint-2/, sprint-3/
```

**Run (4 terminals):**
```bash
cd services/geo-router && npm run dev
cd api && python3 -m uvicorn src.main:app --port 8080 --reload
cd web && npm run dev
# scraper/processor run lazily on first area load (cached after)
```

## 2. FastAPI Endpoints (current)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/search` | RAG refine over a district (SSE: `progress→results→token…→done`). `ensure_pipeline=true` to run scrape/process/index inline (default off) |
| POST | `/area/load` | Load full kos dataset for a district + sibling list (switcher). Runs cached pipeline + `list_kos` |
| GET | `/locations/resolve`, `/locations/expand` | proxy to geo-router |
| GET | `/health`, `/health/services` | self / aggregate (fastapi+geo+rag) |
| GET/PUT | `/settings` | LLM provider config (masked on GET) |
| POST | `/settings/test`, `/settings/models` | test key, list models |
| GET/POST/DELETE | `/searches` | saved-search history (SQLite) |

## 3. Tech Stack (EXACT — do not change without reason)

Astro `^6.1.9` + React `^19.2.5` islands · Tailwind `4.2.4` (pinned; vite pinned to
v7 via `overrides` — see `web/package.json`) · Leaflet `^1.9.4` + react-leaflet `^5`
· react-markdown `^10` + remark-gfm · lucide-react · FastAPI + uvicorn · Python 3.9
· ChromaDB · `BAAI/bge-m3` (1024-dim, **8192-token context**) · Z.AI `glm-4.5-air`
via the **coding-plan endpoint** `https://api.z.ai/api/coding/paas/v4/` (PAYG users
switch to `/api/paas/v4/` in settings).

**State:** React `useState` only (no external lib). **API:** native `fetch` (no Axios/Query).

## 4. Key Conventions (follow these)

- **Frontend type gate:** `cd web && npm run check` MUST stay 0 errors / 0 warnings / 0 hints. Also `npm run build`.
- **Backend type gate:** `python3 -c "import ast; ast.parse(open('FILE').read())"` for every Python file you touch. Never leave a syntax error.
- **Inline `python -c` subprocess trick:** in `orchestrator.py`, the `-c` script must contain only **simple statements** separated by `;` — NO `for/if/while` (they're compound statements, cause SyntaxError, see RCA-001). Move loops into a helper module function and call it.
- **Per-phase workflow:** user reviews + pushes each phase. Don't commit/push unless asked.
- **RCA practice:** when a non-trivial bug bites, write an RCA in `docs/sprint-3/rca/` (Ringkasan → Gejala → Root Cause → Perbaikan → Verifikasi → Action Items → Pelajaran) — see sprint-2 RCAs for the format.
- **Commit style:** `Phase N: <summary>` or `fix(<area>): <summary>`. Reference RCA ids.
- **No emojis in code** unless existing convention.

## 5. Sprint 3 Scope — Functionality + Improvements

Pick from the backlog below. Suggested order (impact × risk):

### P0 — Functionality
1. **Persistent RAG server (warm model).** Currently every `/search` + ingest spawns a subprocess that reloads `bge-m3` (~2.3 GB) — follow-up queries are slow. Make `rag-engine` a long-running service (or an in-process cache in FastAPI) so the model loads once. **Biggest perf win.**
2. **Follow-up chat context.** Today each chat message is an independent RAG query; the LLM doesn't see prior turns. Pass recent chat history as context to `summarize` so "yang di bawah 2 juta" refines the previous answer conversationally.
3. **Clear-all history (currently a stub).** `SavedSearches` "Hapus semua histori" shows a modal but does nothing (RCA/handoff marker). Implement: `DELETE /searches` (bulk) + refresh. See `ChatInterface.handleClearAllSaved`.
4. **Cross-district search ("Cari di SEMUA").** Backend already supports `kecamatan=None` (searches all indexed). Wire the picker's "all" button → loads regency-wide results.

### P1 — Improvements / Data quality
5. **Empty-kecamatan docs.** ~255 of ~1113 indexed kos have `kecamatan=""` (data-processor gap) → they never match any district filter. Audit `data-processor` enrichment; backfill.
6. **Review chunking for embeddings.** `ingest.py` truncates doc text to 1500 chars (RCA-005 cap). Improve recall by chunking per-review and indexing chunks (or a richer doc builder).
7. **Single source of truth `RAG_TOP_K`.** `top_k` (request) and `results[:10]` (summarize) drifted once (RCA-003). Make one constant.
8. **Virtualization / pagination** in `KosCardList` for large districts (some have 100+ kos).
9. **Typed error envelope** from backend instead of heuristic `friendlyError()` string-matching.

### P2 — Robustness / polish
10. **Geo-router unit tests** (none exist) — cover the RCA-004/007/008 cases (Buahbatu→Bandung, Taman Sari district-not-POI, Bandung→regency).
11. **Proper `classify.ts` POI fix** — verify against known district names before labeling POI (RCA-004 §6).
12. **Multi-regency district disambiguation** — "Taman Sari" exists in Jakarta Barat AND Pangkal Pinang; direct resolve picks the first. Scope by regency/province when available.
13. **`model.max_seq_length`** explicit in RAG config (don't rely on bge-m3's 8192 default).
14. **Surface subprocess stderr** in orchestrator (RCA-001 §6) — don't `PIPE` without reading.
15. **`py_compile`/AST pre-commit** for `api/` + `services/**/src/` (catches inline `-c` SyntaxErrors early).
16. **Mobile swipe** between panels (deferred in Phase 6); **dark-mode Leaflet tiles**.
17. **Persist session/dataset in IndexedDB** so a refresh doesn't reload.
18. **Auth** (currently none — single-user MVP assumption, `architecture.md §9`).

## 6. Security — READ THIS

- **Never commit credentials.** `data/settings.json` (Z.AI API key) and `data/search_history.db` are gitignored — keep them so.
- `GET /settings` returns a **masked** key hint, never the raw key. Preserve this.
- Frontend input sanitization lives in `web/src/lib/sanitize.ts` (`validateQuery`) — blocks prompt-injection/morse/encoded blobs with early-return. Extend it as new patterns appear; keep it client-side (defense-in-depth; the LLM still has its own guardrails).
- Before committing, run the credential audit (see §8).

## 7. Known Quirks (don't be surprised)

- `web/src/pages/search.astro` uses `<ChatInterface client:only="react" />` (Leaflet needs `window` → can't SSR). If a page uses Leaflet or browser APIs, use `client:only`.
- Leaflet marker images must be imported with **`?url`** (`leaflet/dist/images/marker-icon.png?url`) — plain imports return `ImageMetadata` objects → broken icons (RCA-002 / the post-RCA-002 fix).
- The `orchestrator` runs the RAG engine via `subprocess` with `cwd=services/rag-engine`; `ROOT = Path(__file__).resolve().parent.parent.parent` from `api/src/`.
- `resolve_area` (geo-router) is the source of truth; the backend's `_resolve_kecamatan(area, regency)` resolves via regency when known to dodge direct-resolve mis-hits (RCA-007/008). Keep that pattern.
- Coding-plan credits ≠ PAYG key balance — the Z.AI key works on `/api/coding/paas/v4/`, not `/api/paas/v4/` (which 429s).
- Non-streaming `/search` calls the full `format_results` LLM summarize (60s timeout) — the app always uses streaming; if you add non-stream callers, mind the timeout.

## 8. Pre-Commit Credential Audit (always do before pushing)

```bash
# from repo root:
git check-ignore -v data/settings.json data/search_history.db   # both must show a .gitignore match
git ls-files data/settings.json data/search_history.db          # must print nothing (not tracked)
git grep -nE "api_key.{0,3}:.{0,3}[\"'][A-Za-z0-9]{20,}" -- . ':!docs'   # no hardcoded keys in tracked files
git status --short                                               # confirm data/*.json|*.db not listed
```

## 9. Definition of Done for Sprint 3

- `cd web && npm run check` → 0/0/0; `npm run build` → OK
- Every touched Python file parses (`ast.parse`)
- Any new bug with a non-obvious cause → RCA in `docs/sprint-3/rca/`
- No credentials committed (run §8 audit)
- Update `docs/sprint-3/tasks.md` (create it) as you go, like sprint-2's

## 10. Start Here

1. Read §0 docs.
2. Boot the 4 services, open http://localhost:4321, click through `/`, `/search`, `/settings` to feel the current behavior.
3. Pick a P0 item, write a short plan (in `docs/sprint-3/`), execute per-phase with the user reviewing each.

Good luck. Be careful with the model-loading subprocesses and the geo-router resolver — that's where the hard-won Sprint 2 fixes live.
