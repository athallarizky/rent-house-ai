# Sprint 3 — Functionality + Improvements

> Status: 🔵 In Progress | Created: 2026-06-20 | Updated: 2026-06-20
>
> **Mission:** App works end-to-end (Sprint 2 shipped). Focus is improving
> functionality + general improvements — make it more capable, robust, and pleasant.
> Not a rewrite; iterate on what exists.
>
> **Ref:** [`AGENTS.md`](./AGENTS.md) — full handoff instructions
>
> Status legend: ⬜ pending | 🔵 in_progress | ✅ completed | ❌ blocked

---

## Phase 1 — Delete Chat History (P0 #3) ✅

> Clear-all history — currently a stub modal. Implement `DELETE /searches` (bulk) + frontend wiring.

| ID   | Task                                                      | Difficulty | Dependencies | Status |
|------|-----------------------------------------------------------|------------|-------------|--------|
| 1.1  | Add `DELETE /searches` (bulk) endpoint in `api/src/searches.py` | Easy   | —           | ✅     |
| 1.2  | Add `deleteAllSavedSearches()` in `web/src/lib/api.ts`    | Easy       | 1.1         | ✅     |
| 1.3  | Replace stub `ConfirmModal` with danger variant + real deletion in `ChatInterface.tsx` | Easy | 1.2 | ✅ |
| 1.4  | Verify: clear-all → list refreshes → empty state shown    | —          | 1.3         | ✅     |

---

## Phase 2 — Scheduled Re-Scrape (Future Enhancement #6) ✅

> TTL-based cache invalidation. Re-scrape areas older than N days. Quick win — existing cache infra.

| ID   | Task                                                      | Difficulty | Dependencies | Status |
|------|-----------------------------------------------------------|------------|-------------|--------|
| 2.1  | Add TTL check in `services/scraper/src/run.py`            | Easy       | —           | ✅     |
| 2.2  | Hook into orchestrator pipeline (`ensure_scraped`)        | Easy       | 2.1         | ✅     |
| 2.3  | Add scrape freshness indicator in frontend                | Medium     | 2.2         | ✅     |

---

## Phase 3 — Query Understanding (Future Enhancement #1) ⬜

> LLM-powered intent extraction: parse natural language → structured params BEFORE embedding.
> Replaces hardcoded `extractArea()` + regex tag detection.

| ID   | Task                                                      | Difficulty | Dependencies | Status |
|------|-----------------------------------------------------------|------------|-------------|--------|
| 3.1  | Design intent extraction prompt + response schema         | Medium     | —           | ⬜     |
| 3.2  | Implement `extract_intent()` in RAG engine or API layer   | Medium     | 3.1         | ⬜     |
| 3.3  | Replace `extractArea()` usage with LLM intent in frontend  | Medium     | 3.2         | ⬜     |
| 3.4  | Wire extracted tags/gender into search filter params      | Medium     | 3.2         | ⬜     |

---

## Phase 4 — Price Range Detection (Future Enhancement #4) ⬜

> Extract price mentions from review text via regex. Enable budget filtering.

| ID   | Task                                                      | Difficulty | Dependencies | Status |
|------|-----------------------------------------------------------|------------|-------------|--------|
| 4.1  | Add regex patterns in `services/data-processor/src/extract.py` | Easy  | —           | ⬜     |
| 4.2  | Add `price_range` to ChromaDB metadata + doc schema       | Medium     | 4.1         | ⬜     |
| 4.3  | Re-index affected kos                                     | Easy       | 4.2         | ⬜     |
| 4.4  | Add price range filter chip in frontend                   | Medium     | 4.2         | ⬜     |

---

## Phase 5 — Follow-up Chat Context (P0 #2) ⬜

> Pass recent chat history as context to `summarize` so follow-up queries refine previous answers.

| ID   | Task                                                      | Difficulty | Dependencies | Status |
|------|-----------------------------------------------------------|------------|-------------|--------|
| 5.1  | Collect prior assistant response in `queryDataset()`       | Easy       | —           | ⬜     |
| 5.2  | Pass chat history to backend `/search` request            | Medium     | 5.1         | ⬜     |
| 5.3  | Include history in `summarize()` prompt                   | Easy       | 5.2         | ⬜     |

---

## Phase 6 — Cross-District Search / "Cari di SEMUA" (P0 #4) ⬜

> Wire KecamatanPicker's "all" button to load regency-wide results.

| ID   | Task                                                      | Difficulty | Dependencies | Status |
|------|-----------------------------------------------------------|------------|-------------|--------|
| 6.1  | Backend: `load_area` with `kecamatan=None` (regency scope) | Medium    | —           | ⬜     |
| 6.2  | Frontend: wire `onPickAllKecamatan` in ChatInterface      | Medium     | 6.1         | ⬜     |
| 6.3  | Merge multi-district results with district labels         | Medium     | 6.2         | ⬜     |

---

## Phase 7 — Persistent RAG Server (P0 #1) ⬜

> Make rag-engine a long-running service so bge-m3 loads once (~2.3 GB). Biggest perf win.

| ID   | Task                                                      | Difficulty | Dependencies | Status |
|------|-----------------------------------------------------------|------------|-------------|--------|
| 7.1  | Design: FastAPI in-process cache vs. separate service     | Medium     | —           | ⬜     |
| 7.2  | Implement warm model cache in orchestrator                | Hard       | 7.1         | ⬜     |
| 7.3  | Migrate subprocess calls to in-process / RPC              | Hard       | 7.2         | ⬜     |

---

## Phase 8 — Workflow Fixes (User-Reported) ⬜

> Waterfall: user identifies issues → report → investigate → fix. Each issue gets its own sub-task + RCA if non-trivial.

| ID   | Issue                                                     | Difficulty | RCA? | Status |
|------|-----------------------------------------------------------|------------|------|--------|
| 8.1  | (pending user report)                                     | —          | —    | ⬜     |

---

## P1 Backlog (Improvements / Data Quality)

| ID   | Task                                                      | Difficulty | Status |
|------|-----------------------------------------------------------|------------|--------|
| P1.1 | Empty-kecamatan docs — audit + backfill ~255/1113 kos    | Medium     | ⬜     |
| P1.2 | Review chunking for embeddings (RCA-005 cap)              | Hard       | ⬜     |
| P1.3 | Single source of truth `RAG_TOP_K` (RCA-003)             | Easy       | ⬜     |
| P1.4 | Virtualization / pagination in KosCardList                | Medium     | ⬜     |
| P1.5 | Typed error envelope from backend                         | Medium     | ⬜     |

## P2 Backlog (Robustness / Polish)

| ID   | Task                                                      | Difficulty | Status |
|------|-----------------------------------------------------------|------------|--------|
| P2.1 | Geo-router unit tests (RCA-004/007/008 cases)             | Medium     | ⬜     |
| P2.2 | `classify.ts` POI fix — verify against known districts     | Medium     | ⬜     |
| P2.3 | Multi-regency district disambiguation                     | Hard       | ⬜     |
| P2.4 | `model.max_seq_length` explicit in RAG config             | Easy       | ⬜     |
| P2.5 | Surface subprocess stderr in orchestrator (RCA-001 §6)    | Easy       | ⬜     |
| P2.6 | `py_compile`/AST pre-commit for `api/` + services         | Easy       | ⬜     |
| P2.7 | Mobile swipe between panels                               | Medium     | ⬜     |
| P2.8 | Persist session/dataset in IndexedDB                      | Hard       | ⬜     |
| P2.9 | Auth (currently none — single-user MVP)                   | Hard       | ⬜     |

---

## Dependency Graph

```
Phase 1 (Delete History) ─── independent, no deps
Phase 2 (Re-Scrape)       ─── independent, no deps
Phase 3 (Query Understanding) ─── may dep on Phase 2 if we want fresh data for intent
Phase 4 (Price Range)     ─── independent, no deps
Phase 5 (Follow-up Chat)  ─── independent, small scope
Phase 6 (Cross-District)  ─── independent, medium scope
Phase 7 (Persistent RAG)  ─── independent, largest scope
Phase 8 (Workflow Fixes)  ─── waterfall, interleaved
```

---

## Summary

| Phase                          | Tasks | Est. Hours | Status |
|--------------------------------|-------|-----------|--------|
| 1 — Delete Chat History        | 4     | 1h        | 🔵     |
| 2 — Scheduled Re-Scrape        | 3     | 2h        | ⬜     |
| 3 — Query Understanding        | 4     | 4h        | ⬜     |
| 4 — Price Range Detection      | 4     | 3h        | ⬜     |
| 5 — Follow-up Chat Context     | 3     | 3h        | ⬜     |
| 6 — Cross-District Search      | 3     | 4h        | ⬜     |
| 7 — Persistent RAG Server      | 3     | 6h        | ⬜     |
| 8 — Workflow Fixes             | TBD   | TBD       | ⬜     |
| **Total**                      | **24+** | **~23h+** | **🔵** |

> **Ref:** `docs/sprint-3/AGENTS.md` — full Sprint 3 scope + conventions
> **Ref:** `docs/ideas/future-enhancements.md` — source for Phases 2, 3, 4
> **Ref:** `docs/sprint-2/tasks.md` — Sprint 2 tracking (format reference)
