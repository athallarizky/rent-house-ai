# Phase 4 Report — RAG Engine

> Completed: 2026-06-19

---

## 1. How to Run

All commands from the project root (`rent-house-ai/`).

### Ingest Documents into ChromaDB

```bash
cd services/rag-engine
python3 -m src.ingest ../../data/cleaned/cengkareng_docs.json

# Force re-index:
python3 -m src.ingest ../../data/cleaned/cengkareng_docs.json --force
```

Idempotent — re-running skips already-indexed docs.

### Search

```bash
cd services/rag-engine && python3 -c "
from src.search import search
from src.rank import rank

results = search('wifi kencang', kecamatan='Cengkareng', top_k=10)
ranked = rank(results, user_lat=-6.147, user_lon=106.727)

for r in ranked[:5]:
    m = r['metadata']
    print(f'{m[\"name\"]} ({m[\"rating\"]}★) score={r[\"score\"]:.3f}')
"
```

### Search + LLM Summary

```bash
cd services/rag-engine && python3 -c "
from src.search import search
from src.rank import rank
from src.summarize import summarize

results = search('wifi kenceng', kecamatan='Cengkareng', top_k=20)
ranked = rank(results)
print(summarize('wifi kenceng', ranked[:5]))
"
```

LLM uses Z.AI `glm-air` via OpenAI-compatible API. Set `ZAI_API_KEY` env var. Falls back to formatted list if key not set.

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ZAI_API_KEY` | (required) | Z.AI API key |
| `EMBED_MODEL` | `BAAI/bge-m3` | Sentence-transformers model |
| `LLM_MODEL` | `glm-air` | Z.AI model name |
| `LLM_BASE_URL` | `https://api.z.ai/api/paas/v4/` | Z.AI API base |
| `SEARCH_TOP_K` | 20 | Default results count |

---

## 2. Service Architecture

```
services/rag-engine/
├── src/
│   ├── __init__.py
│   ├── config.py        — CHROMA_PATH, EMBED_MODEL, LLM config
│   ├── ingest.py        — docs → embeddings → ChromaDB
│   ├── search.py        — vector search + metadata filter + geo radius
│   ├── rank.py          — composite scoring
│   └── summarize.py     — Z.AI glm-air (OpenAI-compatible) + fallback
└── pyproject.toml
```

### Flow

```
Query: "wifi kenceng, ada parkir"
    │
    ▼
[search.py]
    embed(query) → BAAI/bge-m3 → query_vector
    ChromaDB.query(query_vector, where={kecamatan: "Cengkareng"}, n=60)
    post-filter: tags, gender, haversine radius
    → top 20 results
    │
    ▼
[rank.py]
    composite_score = 0.35*rating + 0.30*tags + 0.20*reviews + 0.15*distance
    → sorted results
    │
    ▼
[summarize.py]
    context = top-5 kos documents
    prompt = "rekomendasi kos..."
    Z.AI glm-air → conversational response
    │
    ▼
    "Berikut 5 kos dengan wifi bagus di Cengkareng..."
```

### ChromaDB Schema

```
Collection: kos_indonesia
  Index: HNSW + cosine distance
  Embedding: BAAI/bge-m3 (1024-dim)
  
  Metadata (all indexed):
    place_id, name, kecamatan, kelurahan, province
    postal_code, lat, lon
    rating, review_count
    tags (pipe-delimited), gender, is_24h
    phone, website, maps_url
```

---

## 3. Test Results — Cengkareng

### Ingestion

| Metric | Value |
|--------|-------|
| Documents | 152 |
| Embedding time | ~16s |
| Embedding model | BAAI/bge-m3 (1024-dim, first download ~2.3GB) |
| Collection size | ~30 MB |

### Search Quality

| Query | Top Result | Rating | Tags |
|-------|-----------|--------|------|
| "wifi kenceng" | Warteg & Kos Nyaman Gemini | 4.8★ | wifi, ac, laundry |
| "wifi lemot" | Kos ALFA | 4.3★ | — |
| "ac dingin parkir luas" | Kost ancece258 | 4.5★ | parkir |

### Ranking Weights

| Factor | Weight |
|--------|--------|
| Rating | 35% |
| Tag match | 30% |
| Review count | 20% |
| Distance | 15% |

---

## 4. Key Decisions

### BAAI/bge-m3 (from kosan-jakbar)
- Multilingual, strong Indonesian support
- 1024-dim embeddings
- Free, local, CPU-sufficient
- ~2.3GB one-time download

### ChromaDB Persistent (from kosan-jakbar)
- Embedded mode, no server process
- HNSW index with cosine distance
- Metadata WHERE clauses for area/gender/rating filtering
- Single collection for all Indonesia

### Z.AI glm-air via OpenAI SDK
- `openai.OpenAI(base_url="https://api.z.ai/api/paas/v4/")`
- Model: `glm-air` (user preference)
- Fallback: formatted text list if API unavailable

### Sanitized Metadata
- ChromaDB rejects `None` values
- All metadata coerced: `None → 0/""/False`, complex → string

---

## 5. Reference Files

| File | Purpose |
|------|---------|
| `services/rag-engine/src/config.py` | Paths, model names, defaults |
| `services/rag-engine/src/ingest.py` | Load docs → embed → ChromaDB |
| `services/rag-engine/src/search.py` | Vector search + metadata filter + geo radius |
| `services/rag-engine/src/rank.py` | Composite scoring (rating + tags + reviews + distance) |
| `services/rag-engine/src/summarize.py` | Z.AI LLM call + fallback |
| `data/chroma_db/` | ChromaDB persistent storage (~30 MB) |
