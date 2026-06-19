# Phase 5 Report — CLI Orchestrator

> Completed: 2026-06-19

---

## 1. How to Run

### Basic Search

```bash
cd services/rag-engine
python3 -m src.cli --area Cengkareng --query "wifi kenceng parkir"
```

### Browse Mode (No Query)

```bash
cd services/rag-engine
python3 -m src.cli --area "Jakarta Barat"
# Lists all kecamatan, prompts user to pick one
```

### Force Re-Scrape

```bash
cd services/rag-engine
python3 -m src.cli --area Cengkareng --query "wifi kenceng" --force-scrape
```

### Flags

| Flag | Purpose |
|------|---------|
| `--area <name>` | Target area (Cengkareng, Jakarta Barat, Bandung, etc.) |
| `--query <text>` | Semantic search query |
| `--force-scrape` | Re-scrape even if cached |
| `--no-llm` | Skip LLM summarization |
| `--top-k N` | Number of results (default 5) |

---

## 2. Pipeline Flow

```
python -m src.cli --area Cengkareng --query "wifi kenceng"
    │
    ▼
[1/4] Geo-Router (HTTP)
    GET /resolve?q=Cengkareng → postal codes [11710..11750]
    │
    ▼
[2/4] Scraper (subprocess)
    Check cache: data/raw/cengkareng/*.jsonl
    All 5 files cached → skip
    │
    ▼
[3/4] Data Processor (subprocess)
    Check cache: data/cleaned/cengkareng_docs.json
    Already exists → skip
    │
    ▼
[4/4] RAG Engine
    ChromaDB: 152 docs already indexed → skip
    Search: embed query → vector search + metadata filter
    Rank: composite score → top-K
    │
    ▼
LLM Summary (optional)
    Z.AI glm-air → conversational recommendation
```

### Second Run (Fully Cached)

```
[1/4] Resolving → instant
[2/4] Scraping → skip (5 files cached)
[3/4] Processing → skip (docs cached)
[4/4] Indexing → skip (152 indexed)
Search → instant (<1s)
```

---

## 3. Test Results

```bash
$ python -m src.cli --area Cengkareng --query "wifi kenceng parkir" --top-k 3

1. KOST UTAMA 5 (4.2★, 229 reviews) — wifi, ac, dapur
   [5★] Kamarnya nyaman + kamar mandinya di dalam...
   [5★] Nyaman, free wifi 24 jam, AC bagus semua dingin...

2. Kost Tanah Koja Residence (4.4★, 32 reviews) — ac, parkir, dapur, kasur
   ...

3. KOST BOSSQU (4.8★, 16 reviews) — parkir, dapur, laundry
   ...
```

---

## 4. Service Architecture

```
services/rag-engine/src/
├── cli.py           ← Phase 5: CLI orchestrator
├── config.py        ← Configuration
├── ingest.py        ← Embedding + ChromaDB
├── search.py        ← Semantic search
├── rank.py          ← Composite ranking
└── summarize.py     ← LLM summarization
```

### Communication Patterns

| Service | Interface | Reason |
|---------|-----------|--------|
| geo-router | HTTP (localhost:3001) | Already a running server |
| scraper | subprocess | Has relative imports, needs its own venv |
| data-processor | subprocess | Has relative imports, needs its own venv |
| rag-engine | Direct import | Same process, same venv |

---

## 5. Key Decisions

### Subprocess for Scraper & Processor
Python 3.9 doesn't handle cross-package relative imports well when running from different working directories. Using subprocess ensures each service runs in its own context without import conflicts.

### Cache-First Pipeline
Every stage checks disk cache before executing. Second run is instant (<2s for all 4 stages).

### Area Auto-Detection
Basic extraction of common area names from queries. For production use, geo-router should handle the full NL parsing.

---

## 6. Reference Files

| File | Purpose |
|------|---------|
| `services/rag-engine/src/cli.py` | CLI orchestrator (main entry) |
