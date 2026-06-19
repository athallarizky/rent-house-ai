# Task Breakdown — Kos Scraper + RAG

> Status: 🔵 Phase 0 Done | Created: 2026-06-19 | Updated: 2026-06-19
>
> Status legend: ⬜ pending | 🔵 in_progress | ✅ completed | ❌ blocked

---

## Phase 0 — Repo Setup & Exploration ✅

> 📄 Full report: [`reports/phase-0-report.md`](./reports/phase-0-report.md) — manual run instructions, scrape results, review quality analysis

| ID   | Task                                                                         | Difficulty | Dependencies | Status |
|------|------------------------------------------------------------------------------|------------|-------------|--------|
| 0.1  | Clone `google-maps-scraper` → `services/scraper/google-maps-scraper/`        | Easy       | —           | ✅     |
| 0.2  | Clone `kodepos` → `services/geo-router/kodepos/`                             | Easy       | —           | ✅     |
| 0.3  | Build Go binary (`go build -o gmaps-scraper .`)                              | Easy       | 0.1         | ✅     |
| 0.4  | Create monorepo directory structure + `.gitignore`                            | Easy       | —           | ✅     |
| 0.5  | Test shallow scrape Cengkareng (`-depth 1 -lang id -json`) — study output     | Easy       | 0.3         | ✅     |
| 0.6  | Test deep scrape Cengkareng (`-depth 5 -extra-reviews`) — study review volume | Easy       | 0.3         | ✅     |

### 0.5 Findings — Shallow Scrape
- 20 kos from single query "kos di 11730" (~18 detik)
- 37 fields per entry (confirmed Go `Entry` struct)
- **8 reviews per kos** (inline `user_reviews`, no `-extra-reviews`)
- Review struct: 24 fields, mixed PascalCase + snake_case
- `Description` and `text_original` both present in 98.75% reviews
- Both `longtitude` and `longitude` keys present (identical values)
- 2/20 entries missing `postal_code` in `complete_address`
- File size: ~205KB (JSONL) for 20 kos = ~10KB/kos
- 100% success rate, no failures

### 0.6 Findings — Deep Scrape
- **RPC API returns empty** for Indonesian kos listings → scraper falls back to DOM extraction
- DOM extraction only gets **3 extra reviews** per kos (`user_reviews_extended`)
- Total: 8 inline + 3 extended = **11 reviews/kos** (vs 8 shallow)
- **30x slower**: ~2.5 min for 20 kos (vs ~18s shallow)
- File size: ~242KB (only 1.2x larger)
- **Decision: Shallow scrape for MVP** — 8 reviews/kos sufficient for RAG, `-extra-reviews` not worth the time cost

---

## Phase 1 — Geo-Router (`services/geo-router/`) ✅

| ID   | Task                                                   | Difficulty | Dependencies | Status |
|------|--------------------------------------------------------|------------|-------------|--------|
| 1.1  | Build alias table (colloquial → administrative names)  | Easy       | 0.2         | ✅     |
| 1.2  | Build `resolve()` — area name → kecamatan + postal codes | Easy       | 0.2, 1.1   | ✅     |
| 1.3  | Build `expand()` — regency → all kecamatan (grid-expand) | Easy       | 0.2         | ✅     |
| 1.4  | Build AREA vs POI classifier                           | Medium     | 1.2         | ✅     |
| 1.5  | Fastify HTTP endpoint (`GET /resolve`, `GET /expand`)   | Easy       | 1.2, 1.3, 1.4 | ✅  |
| 1.6  | Write tests for all endpoints                          | Easy       | 1.5         | ✅     |

### Service Summary

> 📄 Full report: [`reports/phase-1-report.md`](./reports/phase-1-report.md) — API reference, architecture, test coverage

- **Runtime:** Node.js + Fastify on port 3001
- **Files:** `src/server.ts`, `src/resolve.ts`, `src/expand.ts`, `src/alias.ts`, `src/classify.ts`, `src/types.ts`
- **Tests:** 14/14 passing (alias, classify, expand)
- **Endpoints:**
  - `GET /resolve?q=Jakarta+Barat` → 8 kecamatan with postal codes
  - `GET /resolve?q=Cengkareng` → single kecamatan, 5 postal codes, 6 villages
  - `GET /resolve?q=Bandung` → 61 kecamatan (auto-detects regency vs district level)
  - `GET /resolve?q=jakbar` → alias resolution to Administrasi Jakarta Barat
  - `GET /resolve?q=Stasiun+Duri` → POI detection
  - `GET /expand?q=Jakarta+Barat` → list of all kecamatan names
  - `GET /health` → status + entry count
- **Aliases:** jakbar, jaksel, jaktim, jakpus, jakut, kepulauan seribu
- **Data:** Loads 83,761 entries from vendored kodepos JSON at startup (~1s)
- **Fuse.js:** Fuzzy search with threshold 0.3, dual-key indexing (searchText + fulltext)

---

## Phase 2 — Scraper (`services/scraper/`) ✅

> 📄 Full report: [`reports/phase-2-report.md`](./reports/phase-2-report.md) — run instructions, test results, cache strategy

| ID   | Task                                                                              | Difficulty | Dependencies  | Status |
|------|-----------------------------------------------------------------------------------|------------|---------------|--------|
| 2.1  | Query generator — postal codes → search variants ("kos di 11730", etc.)            | Easy       | 1.2           | ✅     |
| 2.2  | Go binary wrapper (`subprocess.run`, parallel per kecamatan, collect JSONL)        | Medium     | 0.3, 2.1      | ✅     |
| 2.3  | Cache layer — save JSONL to `data/raw/<area>/`, skip scrape if cache exists        | Easy       | 2.2           | ✅     |
| 2.4  | Deep scrape (`-extra-reviews`) — **SKIPPED**                                       | Medium     | 0.6, 2.2      | ❌     |
| 2.5  | Test: scrape all Cengkareng (5 postal codes × 3 variants) → `data/raw/cengkareng/` | Medium     | 2.3           | ✅     |

### Scrape Results (Cengkareng)

| Postal Code | Kos Found |
|-------------|-----------|
| 11710 | 44 |
| 11720 | 42 |
| 11730 | 36 |
| 11740 | 42 |
| 11750 | 44 |
| **Total** | **208** (177 unique by place_id) |

### Service Summary

- **Runtime:** Python 3.9+
- **Files:** `src/generate.py`, `src/run.py`, `src/cache.py`
- **Flow:** Postal codes → generate 3 query variants → run Go binary via subprocess → collect JSONL
- **Cache:** Saves to `data/raw/<area>/<code>.jsonl`, skips re-scrape if exists
- **2.4 Skipped:** Phase 0 proved `-extra-reviews` useless for Indonesian listings (RPC API empty, DOM fallback only 3 reviews at 30x time cost)

> **Ref:** `docs/sprint-1/data-design.md` — Scraper Output Format section
> **Ref:** `docs/sprint-1/architecture.md` — Caching Strategy section

---

## Phase 3 — Data Processor (`services/data-processor/`) ✅

> 📄 Full report: [`reports/phase-3-report.md`](./reports/phase-3-report.md) — pipeline stages, test results, RAG document format

| ID   | Task                                                                                      | Difficulty | Dependencies     | Status |
|------|-------------------------------------------------------------------------------------------|------------|------------------|--------|
| 3.1  | Parse JSONL → Python dicts (handle `longtitude`/`longitude`, mixed PascalCase/snake_case) | Medium     | 0.5              | ✅     |
| 3.2  | Normalize (phone E.164, area de-anglicizing) — reuse kosan-jakbar patterns                 | Medium     | 3.1              | ✅     |
| 3.3  | Enrich with kodepos — resolve postal_code → kecamatan, kelurahan, province                 | Medium     | 3.1, 1.2         | ✅     |
| 3.4  | Dedup by `place_id` + coordinate proximity (<50m)                                         | Medium     | 3.1              | ✅     |
| 3.5  | Extract facilities from review text (wifi, AC, parkir, dll) — regex                       | Hard       | 3.1              | ✅     |
| 3.6  | Build RAG document text per kos (name + address + rating + top-20 reviews)                 | Medium     | 3.2, 3.3, 3.5    | ✅     |
| 3.7  | Validate coordinates (bounds Indonesia) + output clean JSON + RAG docs                     | Easy       | 3.6              | ✅     |
| 3.8  | Test full pipeline with Cengkareng data                                                   | Medium     | 3.7              | ✅     |

### Pipeline Results (Cengkareng)

| Stage | Count |
|-------|-------|
| Raw | 208 |
| After dedup | **152 kos** |
| RAG docs | 152 |
| Invalid | 0 |

### Service Summary

- **Runtime:** Python 3.9+
- **Files:** 8 modules (pipeline, parse, normalize, enrich, extract, dedup, build_doc, validate)
- **Pipeline:** Parse → Normalize → Enrich → Extract → Dedup → Build Docs → Validate
- **Facilities detected:** wifi (21), ac (29), parkir (19), dapur (14), km_dalam (7), laundry (7), kasur (12), lemari (9), listrik (9), tv (5)
- **Review noise filter:** ~40% reviews filtered (questions like "ada kamar kosong?")
- **Dedup:** place_id (177 → 152) + 50m proximity
- **Output:** `data/cleaned/cengkareng.json` (344 KB) + `cengkareng_docs.json` (186 KB)

---

## Phase 4 — RAG Engine (`services/rag-engine/`) ✅

> 📄 Full report: [`reports/phase-4-report.md`](./reports/phase-4-report.md) — architecture, ChromaDB schema, search flow, LLM integration

| ID   | Task                                                                                  | Difficulty | Dependencies | Status |
|------|---------------------------------------------------------------------------------------|------------|-------------|--------|
| 4.1  | Setup ChromaDB persistent + `BAAI/bge-m3` sentence-transformers                       | Easy       | —           | ✅     |
| 4.2  | Build `ingest.py` — clean docs → embeddings → ChromaDB (idempotent, `--force` flag)   | Medium     | 3.7, 4.1    | ✅     |
| 4.3  | Build `search.py` — vector search + metadata WHERE clause + geo radius (haversine)    | Medium     | 4.2         | ✅     |
| 4.4  | Build `rank.py` — composite score (distance + rating + tag match + review count)      | Hard       | 4.3         | ✅     |
| 4.5  | Build `summarize.py` — Z.AI `glm-air` via OpenAI-compatible client + fallback         | Medium     | 4.4         | ✅     |
| 4.6  | End-to-end test with Cengkareng data (ingest → search → rank → summarize)             | Medium     | 4.5         | ✅     |

### Test Results (Cengkareng, 152 docs)

| Query | Top Result | Rating | Tags |
|-------|-----------|--------|------|
| "wifi kenceng" | Warteg & Kos Nyaman Gemini | 4.8★ | wifi, ac, laundry |
| "wifi lemot" | Kos ALFA | 4.3★ | — |
| "ac dingin parkir luas" | Kost ancece258 | 4.5★ | parkir |

### Service Summary

- **Runtime:** Python 3.9+ (chromadb, sentence-transformers, openai)
- **Files:** `config.py`, `ingest.py`, `search.py`, `rank.py`, `summarize.py`
- **Embedding:** `BAAI/bge-m3` (1024-dim, multilingual, ~2.3GB first download)
- **Vector DB:** ChromaDB persistent, HNSW + cosine, single collection `kos_indonesia`
- **LLM:** Z.AI `glm-air` via `openai.OpenAI(base_url=...)` — falls back to formatted list if no key
- **Ranking:** 35% rating + 30% tags + 20% reviews + 15% distance
- **Idempotent:** Re-ingest skips already-indexed docs
> **Ref:** `docs/sprint-1/architecture.md` — RAG Engine section

---

## Phase 5 — CLI Orchestrator ✅

> 📄 Full report: [`reports/phase-5-report.md`](./reports/phase-5-report.md) — CLI usage, pipeline flow, architecture

| ID   | Task                                                                                   | Difficulty | Dependencies               | Status |
|------|----------------------------------------------------------------------------------------|------------|----------------------------|--------|
| 5.1  | Build CLI entry point — parse natural language → determine area → trigger full pipeline | Hard       | 1.5, 2.3, 3.7, 4.5         | ✅     |
| 5.2  | Build conversational state (district picking, follow-up questions)                      | Medium     | 5.1                        | ✅     |
| 5.3  | End-to-end test: "Carikan kos di Cengkareng dengan wifi kenceng"                        | Hard       | 5.2                        | ✅     |

### Service Summary

- **Runtime:** Python 3.9+
- **Entry:** `cd services/rag-engine && python -m src.cli --area Cengkareng --query "wifi kenceng"`
- **Flow:** geo-router (HTTP) → scraper (subprocess) → processor (subprocess) → search (direct)
- **Cache-first:** All stages skipped if disk cache exists — second run <2s
- **Output:** Ranked kos with reviews, facilities, phone, LLM summary (optional)

---

## Phase 6 — API Layer (Future)

| ID   | Task                                                    | Difficulty | Dependencies | Status |
|------|---------------------------------------------------------|------------|-------------|--------|
| 6.1  | FastAPI app + `/search` endpoint wrapping orchestration | Medium     | 5.3         | ⬜     |
| 6.2  | Streaming LLM response (SSE)                            | Medium     | 6.1         | ⬜     |

---

## Dependency Graph

```
Phase 0  ─────────────────────────────────────────────────────────────┐
  0.1 ──► 0.3 ──► 0.5                                                │
  0.2 ──► 0.4                                                        │
  0.3 ──► 0.6                                                        │
                                                                      │
Phase 1 ──────────────────────────────────────────────────────────────┤
  0.2 ──► 1.1 ──► 1.2 ──► 1.5 ──► 1.6                               │
               1.3 ──┘   1.4 ──┘                                     │
                                                                      │
Phase 2 ──────────────────────────────────────────────────────────────┤
  1.2 ──► 2.1 ──► 2.2 ──► 2.3 ──► 2.5                               │
  0.3 ──┘         0.6 ──► 2.4                                        │
                                                                      │
Phase 3 ──────────────────────────────────────────────────────────────┤
  0.5 ──► 3.1 ──► 3.2 ──► 3.6 ──► 3.7 ──► 3.8                       │
           │     3.3 ──┘   3.5 ──┘                                   │
           │     3.4 ──┘                                              │
           │     1.2 ──► 3.3                                         │
                                                                      │
Phase 4 ──────────────────────────────────────────────────────────────┤
  3.7 ──► 4.2 ──► 4.3 ──► 4.4 ──► 4.5 ──► 4.6                       │
  4.1 ──┘                                                            │
                                                                      │
Phase 5 ──────────────────────────────────────────────────────────────┤
  1.5 ──► 5.1 ──► 5.2 ──► 5.3                                       │
  2.3 ──┘                                                            │
  3.7 ──┘                                                            │
  4.5 ──┘                                                            │
                                                                      │
Phase 6 ──────────────────────────────────────────────────────────────┤
  5.3 ──► 6.1 ──► 6.2                                               │
```

---

## Summary

| Phase                    | Tasks | Est. Hours | Status |
|--------------------------|-------|-----------|--------|
| 0 — Setup & Exploration  | 6     | 1h        | ⬜     |
| 1 — Geo-Router           | 6     | 3h        | ⬜     |
| 2 — Scraper              | 5     | 4h        | ⬜     |
| 3 — Data Processor       | 8     | 7h        | ⬜     |
| 4 — RAG Engine           | 6     | 6h        | ⬜     |
| 5 — CLI Orchestrator     | 3     | 5h        | ⬜     |
| 6 — API (Future)         | 2     | 3h        | ⬜     |
| **Total**                | **36** | **~29h**  |        |
