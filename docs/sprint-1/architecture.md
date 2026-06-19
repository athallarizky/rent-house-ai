# Architecture — Kos Scraper + RAG

> Decision log for tech stack, monorepo structure, and service boundaries.
> Sprint 1 — June 2026

---

## 1. Monorepo Structure

```
rent-house-ai/
├── services/
│   ├── geo-router/                  # Node.js (Fastify)
│   │   ├── kodepos/                 # vendored: sooluh/kodepos
│   │   ├── src/
│   │   │   ├── alias.ts             # colloquial → administrative name mapping
│   │   │   ├── classify.ts          # AREA vs POI classifier
│   │   │   ├── expand.ts            # regency → kecamatan list
│   │   │   ├── resolve.ts           # area name → kecamatan + postal codes
│   │   │   └── server.ts            # Fastify HTTP server
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── scraper/                     # Python (wraps Go binary)
│   │   ├── google-maps-scraper/     # vendored: gosom/google-maps-scraper
│   │   ├── src/
│   │   │   ├── generate.py          # postal codes → search query variants
│   │   │   ├── run.py               # subprocess wrapper, parallel execution
│   │   │   ├── cache.py             # save/load raw JSONL per area
│   │   │   └── deep.py              # -depth 5 -extra-reviews config
│   │   └── pyproject.toml
│   │
│   ├── data-processor/              # Python
│   │   ├── src/
│   │   │   ├── parse.py             # JSONL → Python dicts
│   │   │   ├── normalize.py         # phone, area, lodging type
│   │   │   ├── enrich.py            # kodepos lookup: postal_code → area
│   │   │   ├── dedup.py             # place_id + coordinate proximity
│   │   │   ├── extract.py           # facility extraction from reviews
│   │   │   ├── build_doc.py         # construct RAG document text
│   │   │   └── validate.py          # coordinate bounds, required fields
│   │   └── pyproject.toml
│   │
│   └── rag-engine/                  # Python (ChromaDB + sentence-transformers)
│       ├── src/
│       │   ├── config.py            # MODEL, CHROMA_PATH, LLM config
│       │   ├── ingest.py            # docs → embeddings → ChromaDB
│       │   ├── search.py            # vector search + metadata filter + geo radius
│       │   ├── rank.py              # composite scoring
│       │   └── summarize.py         # Z.AI glm-air LLM call
│       └── pyproject.toml
│
├── api/                             # FastAPI (Future — Phase 6)
│   └── src/
│       ├── main.py
│       ├── routes/
│       │   ├── search.py            # POST /search
│       │   └── locations.py         # GET /locations/*
│       └── orchestrator.py          # geo-router → scraper → processor → rag
│
├── data/                            # All runtime data (gitignored)
│   ├── kodepos.json                 # symlink → services/geo-router/kodepos/data/kodepos.json
│   ├── raw/                         # scraper JSONL per area
│   │   └── cengkareng/
│   │       ├── 11710.jsonl
│   │       ├── 11720.jsonl
│   │       └── ...
│   ├── cleaned/                     # processor output (parquet + RAG docs)
│   │   └── cengkareng.parquet
│   └── chroma_db/                   # ChromaDB persistent storage
│
└── docs/
    ├── Kos Scraper - Summary & Implementation Plan.md
    └── sprint-1/
        ├── tasks.md
        ├── architecture.md
        └── data-design.md
```

---

## 2. Tech Stack Decisions

### Decision Matrix

| Service         | Language | Key Libraries                         | Why                                                    |
|-----------------|----------|---------------------------------------|--------------------------------------------------------|
| geo-router      | Node.js  | Fastify, Fuse.js (from kodepos)       | kodepos already Node — import directly, no rewrite     |
| scraper         | Python   | subprocess, asyncio                   | Lightweight wrapper, no heavy deps needed              |
| data-processor  | Python   | pandas, pyarrow                       | Best for data wrangling + reuses kosan-jakbar patterns |
| rag-engine      | Python   | ChromaDB, sentence-transformers       | Both existing RAG projects use this stack              |
| api (future)    | Python   | FastAPI                               | Same runtime as processor + rag — direct function calls |

### Why NOT Alternatives

| Rejected            | Reason                                                            |
|---------------------|-------------------------------------------------------------------|
| Python geo-router   | Would need to port Fuse.js fuzzy search + kodepos API logic       |
| Node.js processor   | pandas/pyarrow unmatched in Node; regex NLP weaker                |
| Node.js rag-engine  | ChromaDB Python bindings are primary; JS client is secondary      |
| Node.js API         | Would require HTTP bridging to Python services (serialization overhead) |

### Runtime Interaction

```
User Request
    │
    ▼
FastAPI (Python) ──HTTP──► Geo-Router (Node.js)    ← different runtime, lightweight HTTP call
    │
    ├── subprocess ──► Go Binary (gmaps-scraper)    ← compiled binary, no runtime needed
    │
    ├── direct import ──► Data Processor (Python)    ← same process
    │
    └── direct import ──► RAG Engine (Python)        ← same process
```

---

## 3. Service Boundaries

### Geo-Router (`services/geo-router/`)

- **Input:** Natural language area name (string)
- **Output:** Structured location data (kecamatan list, postal codes, province)
- **Does NOT:** Know about kos, scraping, or RAG
- **HTTP Endpoints:** `GET /resolve?q=...`, `GET /expand?q=...`

```json
// GET /resolve?q=Jakarta+Barat
{
  "type": "AREA",
  "regency": "Administrasi Jakarta Barat",
  "province": "DKI Jakarta",
  "districts": ["Cengkareng", "Grogol Petamburan", "Kalideres", "..."],
  "postal_codes": [11710, 11720, 11730, "..."]
}

// GET /resolve?q=Cengkareng
{
  "type": "AREA",
  "district": "Cengkareng",
  "regency": "Administrasi Jakarta Barat",
  "province": "DKI Jakarta",
  "postal_codes": [11710, 11720, 11730, 11740, 11750],
  "villages": [
    {"name": "Cengkareng Barat", "code": 11730, "lat": -6.135, "lon": 106.723},
    "..."
  ]
}
```

### Scraper (`services/scraper/`)

- **Input:** List of postal codes
- **Output:** Raw JSONL files per postal code
- **Does NOT:** Parse, clean, or process the output
- **Side effect:** Writes to `data/raw/<area>/`

### Data Processor (`services/data-processor/`)

- **Input:** Raw JSONL files
- **Output:** Cleaned parquet + RAG document JSON
- **Does NOT:** Scrape or embed
- **Pipeline:** Parse → Normalize → Enrich → Dedup → Extract → Build Doc → Validate

### RAG Engine (`services/rag-engine/`)

- **Input:** Cleaned RAG documents
- **Output:** Ranked search results + LLM summary
- **Does NOT:** Scrape, clean, or determine area
- **Pipeline:** Ingest → Search → Rank → Summarize

---

## 4. Scraper Strategy (Updated from Phase 0 Findings)

### Key Finding: `-extra-reviews` Not Worth It

| Metric | Shallow (`-depth 1`) | Deep (`-extra-reviews`) |
|--------|----------------------|------------------------|
| Reviews per kos | 8 (inline `user_reviews`) | 11 (8 inline + 3 DOM fallback) |
| Time for 20 kos | ~18 detik | ~2.5 menit |
| RPC API | N/A | **EMPTY** — falls back to DOM |
| File size | ~205 KB | ~242 KB (1.2x) |

**RPC API returns empty for Indonesian kos listings.** The scraper falls back to DOM-based review extraction which is slow and limited (3 reviews max). The 30x time penalty only yields 37% more reviews.

**Decision: Shallow scrape (`-depth 1`, no `-extra-reviews`) for MVP.** The 8 inline reviews per kos are sufficient for initial RAG quality.

---

## 6. Cache Strategy

On-demand scraping with per-area disk cache — scraped once, reused for subsequent RAG queries.

```
Query "Cengkareng"
    │
    ▼
geo-router resolve("Cengkareng")
    → postal_codes: [11710, 11720, 11730, 11740, 11750]
    │
    ▼
for each postal_code:
    cache_path = data/raw/cengkareng/<postal_code>.jsonl
    │
    ├── exists? ──► load from disk
    │
    └── missing? ──► run Go binary → save to cache → load
    │
    ▼
merge all JSONL → processor → cleaned parquet + RAG docs
    │
    ▼
ingest to ChromaDB (if not already indexed)
```

**Cache Invalidation:** Manual — delete `data/raw/<area>/` to force re-scrape.
**Future:** TTL-based (re-scrape after N days to keep data fresh).

---

## 7. Local-First Design

- All data stored locally in `data/` (gitignored via `.gitignore`)
- No cloud services required for core pipeline
- No Docker/containerization in Sprint 1 — everything runs directly on macOS
- ChromaDB persistent mode (embedded, no server process)
- `BAAI/bge-m3` runs on CPU (no GPU needed for MVP scale ~5000 docs)
- Only external dependency: Z.AI API for LLM summarization (Phase 4.5+)

---

## 8. Key Architectural Decisions

### Scraper: Use Go Binary + Shallow Scrape

**Decision:** Run the Go binary via `subprocess` with `-depth 1` (no `-extra-reviews`). Do not rewrite in Python.

**Reasoning:**
- 11k LOC, 111 files — rebuilding to Python = 2-3 days for feature parity
- Battle-tested anti-detection, cookie consent, retry logic
- Single binary, no Python runtime needed for scraping
- Go memory model prevents leaks during long scrape sessions
- **`-extra-reviews` useless for Indonesian listings** — RPC API returns empty, DOM fallback only gives 3 reviews at 30x time cost
- 8 inline reviews per kos (shallow) is sufficient for document-level RAG

### Grid-Expand for Coverage

**Decision:** When user queries a city/regency, expand to kecamatan level before scraping.

**Reasoning:**
- Google Maps returns max ~120 results per search query
- "Kos di Jakarta Barat" → only ~120 kos (out of thousands)
- Expanding to 12 kecamatan → 12 × 120 = ~1,440 potential results
- kodepos dataset enables this expansion via postal code resolution

### Document-Level (Not Review-Level) RAG

**Decision:** Each kos is ONE document in vector DB, with reviews embedded in the document text.

**Reasoning:**
- Simpler ingestion (N documents vs N × M reviews)
- Metadata filtering works at kos level (rating, kecamatan, tags)
- "wifi tidak lemot" queries still work — review text is part of the document
- Full reviews preserved in parquet for future review-level RAG if needed

### ChromaDB: Single Collection per Region

**Decision:** One collection for all Indonesia (or per major region), not per-area.

**Reasoning:**
- ChromaDB WHERE clauses support `$and` filtering by kecamatan
- Cross-area queries possible ("kos di Jakarta Barat" → multiple kecamatan)
- Simpler ingestion (no collection management per area)
- HNSW index scales efficiently for ~100K documents

---

## 9. References

- kosan-jakbar worktree: `~/development/personal/kosan-jakbar/.worktrees/feature/kosan-rag-v1/` — patterns for clean.py, ingest.py, query.py, detect.py, geo.py
- slack-rag: `~/development/slack-rag/` — patterns for FastAPI, Z.AI adapter, conversational state
- sooluh/kodepos: vendored at `services/geo-router/kodepos/`
- gosom/google-maps-scraper: vendored at `services/scraper/google-maps-scraper/`
