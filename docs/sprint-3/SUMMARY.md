# Sprint 3 Summary — Functionality + Improvements

> **Status:** 🔵 In Progress | Created 2026-06-20
> **Handoff:** [`AGENTS.md`](./AGENTS.md)

---

## 1. Goal

Improve the Sprint 2 Kos AI app — make it more capable, robust, and pleasant.
Not a rewrite; iterate on what exists.

Focus areas:
- **Functionality** — P0 items: delete history, follow-up chat, cross-district, warm RAG model
- **Data quality** — P1: empty-kecamatan, review chunking, price extraction
- **Robustness** — P2: tests, error handling, disambiguation
- **Enhancements** — Future ideas: query understanding, price detection, scheduled re-scrape

---

## 2. All Phases

| Phase | Status | Description |
|-------|--------|-------------|
| 1 — Delete Chat History | ✅ | `DELETE /searches` (bulk) + frontend wiring |
| 2 — Scheduled Re-Scrape | ✅ | TTL-based cache invalidation (30-day freshness) |
| 3 — Query Understanding | ✅ | LLM intent extraction (replace regex, auto-filters) |
| 4 — Price Range Detection | ⬜ | Regex price parsing from reviews |
| 5 — Follow-up Chat Context | ✅ | Pass chat history to summarize |
| 6 — Cross-District Search | ⬜ | Wire "Cari di SEMUA kecamatan" |
| 7 — Persistent RAG Server | ⬜ | Warm bge-m3 model (biggest perf win) |
| 8 — Workflow Fixes | ⬜ | User-reported issues (waterfall) |
| 9 — AI Chat Mode Toggle | ⬜ | Manual RAG/AI mode dropdown di input chat |

---

## 3. Key Decisions (TBD)

- (none yet — will be documented as phases progress)

---

## 4. Metrics

- **Starting point:** ~1,113 kos indexed across ~10 districts
- **Sprint 2:** 32 tasks across 6 phases, 8 RCAs

(Will be updated as sprint progresses.)
