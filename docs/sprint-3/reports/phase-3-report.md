# Phase 3 Report — Query Understanding (LLM Intent Extraction)

> Completed: 2026-06-20 | Sprint 3 / Future Enhancement #1

---

## 1. Overview

Previously, the frontend used a hardcoded `extractArea()` regex to detect area names
in user queries. A query like "kost cewek di dekat stasiun murah" would fail area
detection and fall back to the default "Cengkareng". Tags and gender were never
extracted from query text.

Phase 3 adds **LLM-powered intent extraction** — one small Z.AI call (~100 tokens)
parses the user's natural-language query into structured params BEFORE the
search pipeline runs.

```
User types: "kos cewek Cengkareng wifi kenceng parkir luas di bawah 2jt"

    ┌─────────────────────────────────────────┐
    │ POST /intent  →  LLM (glm-4.5-air)      │
    │                                            │
    │ {                                          │
    │   "area": "Cengkareng",                    │
    │   "tags": ["wifi", "parkir"],              │
    │   "gender": "putri",                       │
    │   "budget_min": null,                      │
    │   "budget_max": 2000000,                   │
    │   "keywords": ["kenceng", "luas"]          │
    │ }                                          │
    └──────────────┬──────────────────────────┘
                   │
    ┌──────────────▼──────────────────────────┐
    │ ChatInterface integrates intent:        │
    │  • area → resolveLocation               │
    │  • tags → pre-fill filter chips         │
    │  • gender → pre-select gender filter    │
    │  • keywords → enrich RAG query          │
    └──────────────────────────────────────────┘
```

---

## 2. How It Works

1. User types a natural-language query
2. Frontend calls `POST /intent` (backend → RAG engine subprocess → Z.AI)
3. LLM returns structured JSON: `{area, tags, gender, budget_min, budget_max, keywords}`
4. ChatInterface uses the extracted:
   - **area** → primary area for location resolution (falls back to regex `extractArea()` if LLM returns null or backend is unreachable)
   - **tags** → automatically activates matching filter chips (wifi, AC, parkir, etc.)
   - **gender** → pre-selects Putri/Putra/Campur filter
   - **budget** → stored in intent for future filtering (Phase 4 budget filter will consume this)
5. Search proceeds normally from there

**Latency:** One extra LLM call per search (~100 tokens, ~500ms).

---

## 3. Changes

### 3a. `services/rag-engine/src/intent.py` — LLM extraction core

New module following the same pattern as `summarize.py`:
- Uses `openai` library with Z.AI credentials from `config.py`
- `INTENT_PROMPT` instructs the LLM to detect: area, tags, gender, budget, keywords
- `extract_intent(query)` → returns dict with all fields (empty defaults on failure)
- Handles markdown code fences (LLM sometimes wraps JSON in ```)
- Temperature=0 for deterministic output

### 3b. `api/src/intent.py` — FastAPI `POST /intent`

New FastAPI router:
- `POST /intent` accepts `{query}` → returns `IntentResponse`
- Delegates to RAG engine via subprocess (`_extract_intent_subprocess`)
- 20s timeout (LLM calls are fast, ~500ms)
- Graceful degradation: returns empty intent on any failure

### 3c. `api/src/main.py` — Router registration

Added `intent_router` to `include_router` — new endpoint available at `POST /intent`.

### 3d. `web/src/lib/api.ts` — `extractIntent()` client

Added `IntentResult` interface + `extractIntent(query)` function:
```typescript
export async function extractIntent(query: string): Promise<IntentResult>
```
Falls back to empty result if backend unreachable.

### 3e. `web/src/components/ChatInterface.tsx` — Intent integration

`handleSendMessage` now:
1. Calls `extractIntent(text)` early (before area resolution)
2. Pre-fills filter chips with detected tags
3. Pre-selects gender filter if detected
4. Uses LLM-extracted area as primary; falls back to `extractArea()` regex + `areaHint` + `currentDistrict` + default

---

## 4. Verification

| Check | Result |
|-------|--------|
| Python AST parse (`main.py`, `intent.py`, `rag/intent.py`) | OK |
| `npm run check` (astro check) | **0 errors / 0 warnings / 0 hints** (30 files) |
| `npm run build` | 3 pages built in 2.27s |
| Intent extraction with valid API key | Returns structured JSON via subprocess |
| Intent extraction without API key | Returns empty result gracefully |
| "kos cewek Cengkareng wifi" → intent | `{area: "Cengkareng", tags: ["wifi"], gender: "putri", ...}` |
| Frontend integrates intent → filters | FilterChips auto-activate matching tags |
| Backend unavailable | Falls back to `extractArea()` regex (no regression) |

---

## 5. Findings / Notes

| Item | Detail |
|------|--------|
| No RCA needed | Straightforward integration, no bugs encountered |
| `extractArea()` retained as fallback | Not removed — `handleSelectSaved` still uses it for quick area-in-query detection. If LLM intent is unavailable (API down), the old regex fallback still works. |
| Budget not wired to filters yet | `budget_min` / `budget_max` extracted but not consumed — Phase 4 (Price Range) will add budget filter chips |
| Temperature=0 | Ensures consistent, predictable output for intent parsing — important for UX |
| Markdown fence handling | Some LLM models wrap JSON in ```json...``` — code strips these before parsing |
| Subprocess latency | ~500ms overhead from `subprocess.run` (spawns Python, imports openai, creates client). Could be optimized with in-process caching later (Phase 7). |

---

## 6. Reference Files

| File | Purpose |
|------|---------|
| `services/rag-engine/src/intent.py` | LLM intent extraction core (`extract_intent`, `INTENT_PROMPT`) |
| `api/src/intent.py` | FastAPI `POST /intent` router + subprocess delegation |
| `api/src/main.py` | Registers `intent_router` |
| `web/src/lib/api.ts` | `extractIntent()` client function + `IntentResult` type |
| `web/src/components/ChatInterface.tsx` | Intent integration in `handleSendMessage` — area resolution + filter pre-fill |

> **Ref:** `docs/ideas/future-enhancements.md` §1 — Query Understanding
> **Ref:** `docs/sprint-3/tasks.md` — Phase 3 task tracking
