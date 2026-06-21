# Phase 6 Report — FastAPI Layer

> Completed: 2026-06-19

---

## 1. How to Run

### Prerequisites

```bash
# Start geo-router first
cd services/geo-router && npm run dev   # port 3001

# Start API server
cd api && python3 -m uvicorn src.main:app --host 0.0.0.0 --port 8080
```

### Endpoints

```bash
# Health check
curl http://localhost:8080/health

# Resolve location
curl "http://localhost:8080/locations/resolve?q=Cengkareng"
curl "http://localhost:8080/locations/expand?q=Jakarta+Barat"

# Full search pipeline
curl -X POST http://localhost:8080/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "wifi kenceng parkir",
    "area": "Cengkareng",
    "top_k": 5
  }'

# Force re-scrape
curl -X POST http://localhost:8080/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "wifi kenceng",
    "area": "Cengkareng",
    "force_scrape": true
  }'

# With filters
curl -X POST http://localhost:8080/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "ac dingin kamar mandi dalam",
    "area": "Cengkareng",
    "min_rating": 4.0,
    "gender": "putri",
    "top_k": 3
  }'
```

---

## 2. API Reference

### `POST /search`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `query` | string | yes | — | Semantic search query |
| `area` | string | no | auto-detect | Target area (Cengkareng, Jakarta Barat) |
| `min_rating` | float | no | — | Minimum rating filter |
| `gender` | string | no | — | "putra", "putri", or "campur" |
| `top_k` | int | no | 5 | Number of results |
| `force_scrape` | bool | no | false | Re-scrape even if cached |
| `stream` | bool | no | false | SSE streaming response |

### Response

```json
{
  "success": true,
  "query": "wifi kenceng",
  "pipeline": {
    "area": "Cengkareng",
    "regency": "Administrasi Jakarta Barat",
    "province": "DKI Jakarta",
    "scrape": "cached",
    "process": "cached",
    "index": "0 new, 152 skipped"
  },
  "results": [
    {
      "name": "Kost A",
      "place_id": "ChIJ...",
      "rating": 4.5,
      "review_count": 35,
      "tags": ["wifi", "ac", "parkir"],
      "gender": "campur",
      "phone": "+6281234567890",
      "lat": -6.135,
      "lon": 106.723,
      "kecamatan": "Cengkareng",
      "score": 0.618,
      "text": "## Kost A\n..."
    }
  ],
  "summary": "Pencarian: wifi kenceng\n\n1. Kost A — 4.5★..."
}
```

### `GET /locations/resolve?q=...`

Proxy to geo-router `/resolve`.

### `GET /locations/expand?q=...`

Proxy to geo-router `/expand`.

### `GET /health`

```json
{"status": "ok", "version": "0.1.0"}
```

---

## 3. Service Architecture

```
api/
├── pyproject.toml
└── src/
    ├── __init__.py
    ├── main.py           # FastAPI app + CORS + routes
    ├── orchestrator.py   # Pipeline coordination (subprocess)
    ├── search.py         # POST /search endpoint
    └── locations.py      # GET /locations/* endpoints
```

### Communication

| Service | Interface | Why |
|---------|-----------|-----|
| geo-router | HTTP | Already a running server, just proxy |
| scraper | subprocess | Has relative imports |
| data-processor | subprocess | Has relative imports |
| rag-engine (ingest) | subprocess | Has relative imports |
| rag-engine (search/rank/summarize) | subprocess (stdin JSON) | Avoids import conflicts with `api/src/search.py` |

### All-Subprocess Design

Every external service is called via `subprocess.run()` to avoid Python 3.9 relative import limitations across packages. This also isolates memory and dependency conflicts.

---

## 4. Test Result

```bash
$ curl -X POST localhost:8080/search -d '{"query":"wifi kenceng","area":"Cengkareng","top_k":3}'

{
  "success": true,
  "pipeline": {"scrape": "cached", "process": "cached", "index": "0 new, 0 skipped"},
  "results": [
    {"name": "Kost Lavender Taman Palem", "rating": 3.9, "score": 0.618, "tags": ["wifi", "ac", "parkir"]},
    {"name": "KOST UTAMA 5", "rating": 4.2, "score": 0.584, "tags": ["wifi", "ac", "dapur"]},
    {"name": "Rumah Kost 28D", "rating": 3.7, "score": 0.579, "tags": ["wifi", "ac", "parkir", "dapur"]}
  ],
  "summary": "Pencarian: wifi kenceng\n\n1. Kost Lavender Taman Palem — 3.9★..."
}
```

---

## 5. Reference Files

| File | Purpose |
|------|---------|
| `api/src/main.py` | FastAPI app + CORS + routes |
| `api/src/search.py` | `POST /search` endpoint |
| `api/src/locations.py` | `GET /locations/*` endpoints |
| `api/src/orchestrator.py` | Pipeline coordination (all subprocess) |
