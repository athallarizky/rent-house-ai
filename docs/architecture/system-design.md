# Kos AI — System Design Document (SDD)

> **Version**: 1.0 (post-Sprint 11, e5-small migration)
> **Status**: Living document — discussion material for infra / new engineers / AI agents
> **Last updated**: 2026-06-21
> **Audience**: Infrastructure engineers, backend engineers, AI agents operating on this codebase, stakeholders needing a technical overview
> **Scope**: What the system is, what's inside it, how it's resourced, what hurts, what's open

---

## 0. TL;DR (for busy readers)

**Kos AI** is a natural-language search engine for Indonesian boarding houses (*kos*). Users ask in plain Indonesian ("*kos di Cengkareng wifi kencang AC murah*") and get back ranked recommendations scraped fresh from Google Maps.

**Architecture**: 3 Docker containers — Node.js geo-router, Python FastAPI backend (loads the embedding model in-process), nginx-served Astro frontend.

**Embedding model**: `intfloat/multilingual-e5-small` (Sprint 11 swap from `BAAI/bge-m3`). 449 MB on disk, 384-dim vectors, ~60 ms warm search, ~20 s to index a 300-doc area.

**Minimum VPS**: **2 vCPU, 4 GiB RAM, 20 GiB disk**. Comfortable for ~10 concurrent users. **Cost target**: $5-12/month on DigitalOcean / Linode / Vultr / Hetzner.

**Pain points today**: scraping Google Maps is the slowest + most RAM-hungry phase (Chromium inside container); single-pipeline-slot design (intentional — prevents OOM); no horizontal scaling yet (single kos-api process).

**For deep performance numbers**: see [§6 Resource Requirements](#6-resource-requirements). For "what breaks and why": see [§7 Known Issues & Constraints](#7-known-issues--constraints). For "how do I run this": see [§8 Operational Runbook](#8-operational-runbook).

---

## 1. What is Kos AI?

### 1.1 Problem statement

Cari kos di Indonesia itu susah. Google Maps kasih raw list,不复 tidak ada filter
"wifi kenceng" / "AC dingin" / "parkir luas" / "kos putri depan stasiun". User
harus click satu-satu, baca reviews manual, cross-reference fasilitas.

**Kos AI** solves this dengan natural-language search. User ketik query
bahasa sehari-hari, sistem:

1. **Geo-resolves** nama area (kecamatan / kota / POI) ke postal code list
2. **Scrapes** Google Maps untuk kos di postal-code itu (Go + Playwright + Chromium)
3. **Processes** raw data: extract fasilitas, gender, harga, reviews; normalize alamat
4. **Embeds** each kos document with `multilingual-e5-small` (384-dim vectors)
5. **Stores** vectors in ChromaDB (HNSW + cosine)
6. **Searches** at query time: embed query → cosine similarity → rank → optional LLM summarize

### 1.2 Stakeholders

- **End users**: anak kos / mahasiswa / pekerja yang cari tempat tinggal
- **Admin**: operator yang trigger scrape + index area baru via `/pipeline` dashboard
- **Infra**: tim yang maintain VPS + monitor resource usage
- **AI agent**: agent yang baca dokumen ini untuk operasional atau development task

---

## 2. System Architecture

### 2.1 High-level diagram

```
                         ┌─────────────────────────────────────┐
                         │           User browser               │
                         │   http://localhost:4000              │
                         └─────────────────┬───────────────────┘
                                           │ HTTP
                                           ▼
                         ┌─────────────────────────────────────┐
                         │   kos-web  (nginx + Astro SPA)       │
                         │   - Static frontend                  │
                         │   - Reverse proxy /api → kos-api     │
                         └─────────────────┬───────────────────┘
                                           │ internal docker network
                                           ▼
                         ┌─────────────────────────────────────┐
                         │      kos-api  (Python FastAPI)       │
                         │  ┌────────────────────────────────┐ │
                         │  │ FastAPI app (uvicorn, 1 worker) │ │
                         │  │  - REST endpoints (/search,     │ │
                         │  │    /pipeline/*, /auth, dll)     │ │
                         │  │  - JWT auth + bcrypt            │ │
                         │  │  - Orchestrator (single-slot    │ │
                         │  │    pipeline queue)              │ │
                         │  └────────────────────────────────┘ │
                         │  ┌────────────────────────────────┐ │
                         │  │ e5-small model (resident)      │ │
                         │  │  ~445 MiB RSS, loaded at boot   │ │
                         │  │  - query: /passage: prefix wired│ │
                         │  │  - via services/rag-engine/     │ │
                         │  │    src/prefixes.py              │ │
                         │  └────────────────────────────────┘ │
                         │  ┌────────────────────────────────┐ │
                         │  │ ChromaDB (in-process, file-     │ │
                         │  │  backed at /app/data/chroma_db) │ │
                         │  │  Collection: kos_indonesia      │ │
                         │  │  - hnsw:space=cosine            │ │
                         │  │  - 384-dim vectors              │ │
                         │  └────────────────────────────────┘ │
                         │  ┌────────────────────────────────┐ │
                         │  │ Subprocesses (Go binary, data-  │ │
                         │  │  processor Python) untuk scrape │ │
                         │  │  + process phase                │ │
                         │  └────────────────────────────────┘ │
                         └──┬──────────────────────────────┬───┘
                            │ HTTP                         │ file I/O
                            ▼                              ▼
       ┌─────────────────────────────────┐    ┌────────────────────────┐
       │  kos-geo (Node.js / Fastify)    │    │  ./data/ (bind mount)  │
       │  - Area name resolution         │    │   raw/                 │
       │  - Fuse.js fuzzy matching       │    │   cleaned/             │
       │  - Kecamatan → postal codes     │    │   chroma_db/           │
       │  - Internal port 3001           │    │   auth.db              │
       └─────────────────────────────────┘    │   search_history.db    │
                                              └────────────────────────┘
                       External integrations:
                         - Google Maps (via scraper, rate-limited)
                         - Z.AI API (LLM glm-4.5-air for summarize)
                         - HuggingFace Hub (model download, first boot)
```

### 2.2 Container layout

| Container | Image | Internal port | Host port | Purpose |
|---|---|---:|---:|---|
| `kos-web` | `Dockerfile.web` (Astro → nginx) | 80 | **4000** | Static frontend + reverse proxy `/api → kos-api:8080` |
| `kos-api` | `Dockerfile.api` (Python + Go + Chromium + Node) | 8080 | **4001** | Backend logic + embedding model + ChromaDB + scraper + data-processor |
| `kos-geo` | `Dockerfile.geo` (Bun + Node) | 3001 | **4002** | Area-name → postal-code resolution |

**Single-container strategy for kos-api**: semua Python services (FastAPI, rag-engine, data-processor) + Go binary (scraper) + Chromium (for scraping) tinggal di satu container. Ini **intentional** untuk minimize cross-container latency (in-process embedding = 12× faster than subprocess, per Sprint 8) dan simplify deployment. Trade-off: container ini besar (3.68 GB image).

---

## 3. Components

### 3.1 kos-web (frontend)

**Stack**: Astro 6 + React 19 + Tailwind 4, build-time SSG, served by nginx.

**Pages**:
- `/` — landing page
- `/login` — JWT-based auth
- `/search` — chat-style search interface
- `/settings` (admin) — LLM config, model swap
- `/pipeline` (admin) — area inventory + Index/Rebuild/Rescrape/Delete triggers

**Resource cost**: ~5 MiB RSS, ~0% CPU idle, ~0.1% CPU under load. Negligible.

### 3.2 kos-api (backend)

**Stack**: Python 3.11 + FastAPI + uvicorn (1 worker).

**Internal structure**:
- `api/src/` — FastAPI app, routers, orchestrator, JWT auth
- `services/rag-engine/src/` — ChromaDB client, embedding model loader (`model_cache.py`), search + ingest, **prefixes.py** (Sprint 11)
- `services/data-processor/src/` — raw JSONL → RAG-ready docs (extract fasilitas, gender, harga, reviews)
- `services/scraper/google-maps-scraper/` — Go binary, called as subprocess with Chromium

**Model loading**: `services/rag-engine/src/model_cache.py` is a **process-wide singleton**. Loaded once at FastAPI startup (Sprint 8 in-process embedding). Reused across all subsequent search/ingest requests → eliminates 5-15 s cold-start per request.

**Resource cost (e5-small)**:
- Idle (model resident + small ChromaDB cache): **~1.4 GiB RSS**
- Active search: ~50-100 ms per query, +50 MiB transient
- Indexing 300 docs: peak **~1.45 GiB RSS** (small spike), 4-core saturated
- Scraping (Chromium inside container): peak **~2.4 GiB RSS** (independent of embedding model)

### 3.3 kos-geo (geo-router)

**Stack**: Bun runtime + Fastify + Fuse.js fuzzy matching.

**Purpose**: resolve "Cengkareng" / "Jakarta Barat" / "Monas" → list of (kecamatan, kelurahan, postal_codes). Static dataset from `kodepos.json`.

**Resource cost**: ~200 MiB RSS, ~0.5% CPU idle, ~70% peak during cold parse.

### 3.4 External dependencies

| Service | Used for | Required? |
|---|---|---|
| **HuggingFace Hub** | Download embedding model (first boot only) | Yes (one-time, cached) |
| **Google Maps** | Scraping kos data per postal code | Yes (rate-limited) |
| **Z.AI API** (`glm-4.5-air`) | LLM summarize search results into chat response | Optional (fallback to plain retrieval if no API key) |
| **GitHub Container Registry** | None — all images built locally from `Dockerfile.*` | n/a |

---

## 4. Data Flow

### 4.1 Pipeline flow (admin triggers via UI)

```
[Admin clicks "Index" on /pipeline]
              │
              ▼
    POST /pipeline/index
              │
              ▼
   api/src/pipeline_data.py
   (single-slot queue check)
              │
       ┌──────┴──────┐
       │             │
       ▼             ▼
  [Slot free]    [Slot busy]
       │             │
       │             └─→ queue area, return 202
       │
       ▼
   run_index_background(area)
              │
       ┌──────┴──────┐
       │             │
       ▼             ▼
  data-processor   (already-scraped
   reads raw JSONL  raw data exists?)
       │
       ▼
   build RAG docs:
    - extract fasilitas, gender, harga
    - normalize alamat via kos-geo
    - select top-N reviews (worst+best)
       │
       ▼
   write data/cleaned/<area>_docs.json
       │
       ▼
   rag-engine ingest:
    - read docs JSON
    - prefix_passage() per doc (e5-small)
    - model.encode() batch_size=8
    - chroma_db.collection.add()
       │
       ▼
   pipeline_state: completed
```

### 4.2 Search flow (user query)

```
[User types query in /search]
              │
              ▼
        POST /search
              │
              ▼
   api/src/search.py
       │
       ├─→ kos-geo /resolve?q=<query>
       │   (extract area name from natural language)
       │
       ├─→ check cache: is_area_cached(area)?
       │   ├─→ yes: skip pipeline
       │   └─→ no, ensure_pipeline=true:
       │        trigger run_pipeline_background (queue)
       │
       ▼
   rag-engine search:
    - prefix_query() (e5-small)
    - model.encode([query])
    - chroma_db.collection.query(n_results=60)
    - filter by kecamatan / radius / tags
    - rank by distance (lower = better)
       │
       ▼
   top-K results
       │
       ├─→ mode=rag: return JSON
       └─→ mode=ai: LLM stream (glm-4.5-air)
                    summarize into chat response
```

---

## 5. Data Storage

### 5.1 On-disk layout (host bind mount: `./data`)

```
data/
├── raw/                          # scraper output, per-area JSONL files
│   └── <AreaName>/
│       ├── <postal_code>.jsonl   # raw kos entries from Google Maps
│       └── queries_<pc>.txt      # search queries used
│
├── cleaned/                      # data-processor output (model-independent)
│   └── <AreaName>_docs.json      # RAG-ready docs: text + metadata, NO vectors
│
├── chroma_db/                    # ChromaDB sqlite + HNSW index
│   └── <uuid>/                   # one collection uuid
│       ├── chroma.sqlite3        # metadata + doc text
│       └── <uuid>.bin            # HNSW vector index
│
├── auth.db                       # SQLite: users (bcrypt-hashed)
├── search_history.db             # SQLite: query log per user
└── settings.json                 # admin-configurable LLM settings
```

### 5.2 Docker volumes

| Volume | Type | Size | Persists? |
|---|---|---:|---|
| `./data` (host bind) | bind mount | 50-500 MB typical | yes (host filesystem) |
| `<project>_model-cache` | named volume | **~449 MB** (e5-small) or ~2.3 GB (bge-m3) | yes (Docker volume) |

### 5.3 Backup strategy

Critical data to backup:
- `data/cleaned/` — RAG-ready docs (expensive to regenerate, requires re-scrape)
- `data/auth.db` — user accounts
- `data/settings.json` — admin LLM config

Non-critical (regeneratable):
- `data/raw/` — can re-scrape from Google Maps
- `data/chroma_db/` — can re-index from `data/cleaned/` (~3 min for 1700 docs)

---

## 6. Resource Requirements

### 6.1 Minimum vs Recommended VPS

| Resource | Minimum | Recommended | Reason |
|---|---|---|---|
| **CPU** | 2 vCPU | 4 vCPU | Indexing saturates 4 cores; 2 OK for low traffic |
| **RAM** | **4 GiB** | **4 GiB** | kos-api peak 2.4 GiB during scrape; +OS+overhead |
| **Disk** | 20 GiB | 40 GiB | Docker image 3.7 GiB + model 0.5 GiB + chroma growing |
| **Network** | 100 Mbps | 1 Gbps | Google Maps scrape bursts; first-boot model download |

**VPS providers that work well**:
- **Hetzner CX22** (2 vCPU / 4 GiB / 40 GiB) — €3.79/mo, best value in EU
- **DigitalOcean Basic Premium Intel** (2 vCPU / 4 GiB / 80 GiB) — $24/mo
- **Linode Shared 4 GiB** — $24/mo
- **Vultr Cloud Compute 4 GiB** — $24/mo

**Providers to AVOID**:
- Anything with <4 GiB RAM (will OOM during scrape)
- Burst-CPU providers (index + scrape need sustained multi-core)

### 6.2 Per-workload resource cost (measured on 4 vCPU / 8 GiB Colima VM, macOS arm64 host)

| Workload | Duration | Peak RAM kos-api | Peak CPU kos-api | Disk I/O |
|---|---:|---:|---:|---|
| Idle (model resident) | ongoing | 1.40 GiB | 0.3 % | none |
| 1× search query (warm) | 60 ms | 1.40 GiB | burst 50 % | ~50 KB read |
| 1× search query (cold) | 67 ms | 1.40 GiB | burst 50 % | ~50 KB read |
| Index 1 area (~300 docs) | **20 s** | **1.45 GiB** | 380 % | ~3 MB write |
| Index full corpus (~1700 docs) | ~2 min | 1.5 GiB | 380 % | ~20 MB write |
| Scrape 1 area (10 postal codes) | **1.5 hours** | **2.4 GiB** | 250 % | ~5 MB write |
| Concurrent scrape + index | prevented | — | — | — |

### 6.3 Storage growth projection

| Corpus size | data/raw | data/cleaned | data/chroma_db | Total |
|---|---:|---:|---:|---:|
| 1 kecamatan (~250 docs) | 5 MB | 0.5 MB | 4 MB | 10 MB |
| 20 kecamatan (~5,000 docs) | 100 MB | 10 MB | 60 MB | 170 MB |
| All Indonesia (~50,000 docs) | 1 GB | 100 MB | 600 MB | 1.7 GB |

Growth is roughly linear in docs. No special accommodation needed below ~100 GB corpus. Above that, ChromaDB will need sharding (separate Sprint, not in scope).

### 6.4 Network

| Direction | Bandwidth | Notes |
|---|---|---|
| Inbound (user search) | <1 KB per request | tiny |
| Outbound (search results) | 5-50 KB per request | small JSON |
| First-boot model download | 449 MB one-time | cached in volume thereafter |
| Scrape outbound | 50-200 MB per area | depends on kos density |

---

## 7. Known Issues & Constraints

### 7.1 Single-pipeline-slot design (intentional)

**Issue**: only one pipeline (Index/Rebuild/Rescrape) can run at a time. Second
request gets queued.

**Why**: prevents OOM from concurrent scrape + index. See `api/src/pipeline_state.py` for the queue implementation.

**Trade-off**: admin can't parallelize bulk re-index. Acceptable for current scale (<100 areas).

**Migration cost**: if we ever want concurrent pipelines, would need a real
task queue (Celery / RQ) + careful RAM budgeting.

### 7.2 Scraping is the slowest + most expensive phase

**Issue**: scraping 10 postal codes for one kecamatan takes 1-2 hours (Google rate-limits).

**Why**: Google Maps aggressively rate-limits. Scraper uses Playwright + headless Chromium + retries + random delays. This is inherent to the data source.

**Mitigation**: scrape rarely. Once data is in `data/cleaned/`, you can re-index it many times (model swap, schema change) without re-scraping. Treat `data/cleaned/` as the durable asset.

### 7.3 Scraping RAM is independent of embedding model

**Issue**: scraping uses 2.4 GiB peak RAM regardless of which embedding model is configured.

**Why**: Chromium (~600-800 MiB) + Go scraper process dominate during scrape. The embedding model is not loaded during scrape (only during index phase).

**Implication**: VPS sizing must accommodate scrape-time RAM **regardless of model choice**. Switching to e5-small didn't reduce the VPS floor for scraping workloads.

### 7.4 Embedding model dimension is locked at first insert

**Issue**: ChromaDB locks the collection's vector dimensionality to whatever the first inserted vector has. Cannot mix 1024-dim (bge-m3) and 384-dim (e5-small).

**Why**: ChromaDB schema-less design, but HNSW index assumes fixed-dim.

**Recovery**: wipe `data/chroma_db/` and re-index from `data/cleaned/`. ~3 min for 1700 docs. See `scripts/migrate-to-e5-small.sh`.

### 7.5 No horizontal scaling yet

**Issue**: kos-api runs as a single uvicorn worker. Cannot scale beyond one machine.

**Why**: model is loaded resident per process. Multi-worker uvicorn would duplicate the 449 MB model and add memory pressure for no concurrency benefit (model inference is CPU-bound, not I/O-bound — workers would just thrash CPU).

**Migration cost**: to scale horizontally, would need to externalize the embedding model into a separate container (Text Embeddings Inference server, or TEI) and have kos-api workers call it via HTTP. Out of scope for now.

### 7.6 Auth uses default credentials

**Issue**: default admin credentials are `admin@kos.ai` / `admin123`. Documented in README.

**Mitigation**: change immediately on production deploy. JWT secret in `.env.docker` also defaults to `kos-ai-secret-change-in-production` — change that too.

### 7.7 macOS port conflicts (development only)

**Issue**: default ports `4000/4001/4002` work on Linux but conflict with macOS AirPlay Receiver (5000), ControlCenter (80), ssh (8080). Already worked around by picking 4000-range defaults.

**Production**: not an issue on Linux VPS.

---

## 8. Operational Runbook

### 8.1 First-time deploy (fresh VPS)

```bash
# On a fresh Ubuntu 22.04 / Debian 12 VPS:
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

git clone https://github.com/athallarizky/rent-house-ai.git
cd rent-house-ai
git checkout app/e5-small-embedding

# IMPORTANT: change defaults
nano .env.docker  # set JWT_SECRET to random 32-char string

# Run setup (5-15 min: builds Docker images + downloads model)
./scripts/setup.sh

# Verify
curl http://localhost:4001/health  # should show "model_ready":true
open http://localhost:4000          # login admin@kos.ai/admin123
                                    # CHANGE PASSWORD via /settings
```

### 8.2 Update existing deploy (no model change)

```bash
cd rent-house-ai
git pull
docker compose build
docker compose up -d
```

### 8.3 Update existing deploy (bge-m3 → e5-small migration)

```bash
cd rent-house-ai
git pull origin app/e5-small-embedding

# Run migration script (backup + wipe chroma + reindex)
./scripts/migrate-to-e5-small.sh

# Expected output:
#   ✓ backed up to data/chroma_db.bge-m3-backup.<timestamp>/
#   ✓ API healthy + model ready
#   ✓ indexed docs after reindex: NNNN (across M areas)
#   Migration complete!
```

### 8.4 Restart just the API (e.g., after settings change)

```bash
docker compose restart api
# Wait for healthy
until curl -sf http://localhost:4001/health | grep -q '"model_ready":true'; do
  echo "waiting..."; sleep 5
done
```

### 8.5 View logs

```bash
docker compose logs api         # API + rag-engine + scraper + data-processor
docker compose logs -f api      # follow
docker compose logs api --tail 100

docker compose logs geo-router  # geo-router
docker compose logs web         # nginx
```

### 8.6 Inspect / query ChromaDB directly

```bash
# Get collection count
docker exec kos-api python -c "
from services.rag_engine.src.db import get_collection
print(get_collection().count())
"

# Get indexed areas + counts
TOKEN=$(curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"email":"admin@kos.ai","password":"admin123"}' \
  http://localhost:4001/auth/login | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:4001/pipeline/data | python3 -m json.tool
```

### 8.7 Wipe all data and start fresh

```bash
docker compose down
rm -rf data/raw data/cleaned data/chroma_db data/auth.db data/search_history.db
docker compose up -d
```

### 8.8 Rollback after failed migration

```bash
docker compose down
rm -rf data/chroma_db
mv data/chroma_db.bge-m3-backup.<timestamp> data/chroma_db
# revert code to previous branch/commit
git checkout main  # or pre-migration commit
docker compose up -d
```

---

## 9. Sprint 11 Migration Notes (bge-m3 → e5-small)

This is the most consequential recent change. Details:

### 9.1 What changed
- Default `EMBED_MODEL`: `BAAI/bge-m3` → `intfloat/multilingual-e5-small`
- New module: `services/rag-engine/src/prefixes.py` (central prefix helper, single source of truth)
- `ingest.py` calls `prefix_passage()` before encoding docs
- `search.py` calls `prefix_query()` before encoding queries
- Default ports: 80/8080/3001 → 4000/4001/4002 (host conflict avoidance)
- Default RAM floor: 8 GiB → 2-4 GiB
- 20 unit tests added (`services/rag-engine/tests/test_prefixes.py`)

### 9.2 What didn't change
- ChromaDB schema (collection name, hnsw:space=cosine)
- Document format in `data/cleaned/*_docs.json`
- Scraper (Go binary + Chromium)
- Data-processor pipeline
- Frontend behavior
- API contract

### 9.3 Measured impact (live UI, identical workload)

| Metric | Before (bge-m3) | After (e5-small) | Δ |
|---|---:|---:|---:|
| Indexing 318 docs | 257 s | 20 s | **−92 % (13× faster)** |
| Search latency warm | 191 ms | 56 ms | **−71 % (3.4× faster)** |
| Peak RAM during indexing | 3.3 GiB | 1.4 GiB | **−57 %** |
| Model on disk | 2.3 GB | 449 MB | **−80 %** |
| Quality (nDCG@5) | 0.571 | 0.552 | −3.4 % (acceptable) |
| Quality (recall@5) | 0.130 | 0.123 | −5.3 % (acceptable) |

Full details: `docs/sprint-10/reports/head-to-head-live-ui.md`.

### 9.4 What's still on bge-m3

- The `main` branch (pre-migration baseline) — preserved for A/B testing.
- Old `data/chroma_db/` backups — keep at least one for emergency rollback.

---

## 10. Open Questions (for discussion)

These are not bugs — they are decisions the infra / engineering team needs to make.

### 10.1 Backup policy

**Question**: how often to backup `data/cleaned/`? It's the expensive-to-regenerate asset (re-scrape = hours per area).

**Options**:
- Daily rsync to S3 / B2 (cheap, ~$0.005/GB)
- Weekly full snapshot of `./data` directory
- Git LFS for `data/cleaned/` (would balloon repo size)

**Recommendation**: daily rsync to S3, 30-day retention.

### 10.2 Monitoring

**Question**: what should we monitor?

**Recommendation**:
- `/health` endpoint (via UptimeRobot / BetterStack, free tier)
- Container RAM via `docker stats` (cron + alert if >3 GiB)
- Disk usage of `data/` (alert if >10 GB)
- Search latency via APM (Sentry, free tier)

### 10.3 HTTPS / TLS termination

**Question**: how to add HTTPS?

**Options**:
- Caddy in front of `kos-web` (auto-Let's Encrypt, easiest)
- Nginx + certbot
- Cloudflare proxy (free, no server config)

**Recommendation**: Cloudflare proxy for simplicity; Caddy if direct TLS needed.

### 10.4 Multiple environments (staging / production)

**Question**: how to run staging + production on same VPS?

**Approach**: use docker-compose project names to isolate (`docker compose -p prod up`, `docker compose -p staging up`). Each gets own volumes + network. Ports must differ (e.g., 4000/4001/4002 prod, 4010/4011/4012 staging).

### 10.5 Scaling beyond single-VPS

**Question**: when do we outgrow a single 4 GiB VPS?

**Triggers**:
- >50 concurrent users searching simultaneously
- Corpus > 100 GB (ChromaDB becomes slow without sharding)
- Need <50 ms p99 search latency at scale

**Path forward** (out of scope for now):
- Move ChromaDB to dedicated container / managed vector DB (Pinecone, Weaviate Cloud)
- Move embedding model to dedicated TEI container (scales horizontally)
- Move frontend to CDN (Vercel / Netlify)
- kos-api becomes stateless orchestrator only

---

## 11. Glossary

| Term | Meaning |
|---|---|
| **Kos** | Indonesian boarding house / hostel |
| **Kecamatan** | Indonesian administrative district (subdivision of a city) |
| **Kelurahan** | Sub-district (subdivision of kecamatan) |
| **Postal code** | 5-digit Indonesian postcode |
| **ChromaDB** | Open-source vector database (HNSW + cosine) |
| **HNSW** | Hierarchical Navigable Small World — graph-based approximate nearest neighbor index |
| **e5-small** | `intfloat/multilingual-e5-small` — multilingual embedding model, 384-dim |
| **bge-m3** | `BAAI/bge-m3` — previous multilingual embedding model, 1024-dim |
| **Pipeline** | scrape → process → index flow for one area |
| **Single-slot queue** | Design that allows only one pipeline to run at a time (prevents OOM) |
| **In-process embedding** | Loading the model inside the FastAPI process (vs subprocess), Sprint 8 |

---

## 12. References

### 12.1 In this repo

| Document | Purpose |
|---|---|
| `README.md` | User-facing quick start |
| `docs/architecture/system-design.md` | **This document** |
| `docs/sprint-10/reports/decision.md` | Sprint 10 GO/NO-GO decision report |
| `docs/sprint-10/reports/head-to-head-live-ui.md` | e5-small vs bge-m3 live UI comparison |
| `docs/sprint-10/reports/scrape-vs-index-resources.md` | Scrape vs index resource profile |
| `docs/sprint-11/tasks.md` | Sprint 11 migration task list |
| `docs/deployment-and-scale.md` | (older) deployment notes |

### 12.2 External

- [`intfloat/multilingual-e5-small` model card](https://huggingface.co/intfloat/multilingual-e5-small) — official HuggingFace page
- [ChromaDB docs](https://docs.trychroma.com/) — vector DB used
- [Sprint 8 baseline](docs/sprint-8/baseline.md) — in-process embedding perf baseline

### 12.3 Code map (entry points)

```
api/src/main.py                           # FastAPI app + router registration
api/src/search.py                         # POST /search, POST /area/load
api/src/pipeline_data.py                  # GET /pipeline/data, POST /pipeline/{index,rebuild,...}
api/src/orchestrator.py                   # run_pipeline_background, run_index_background
services/rag-engine/src/search.py         # cosine search + filter + rank
services/rag-engine/src/ingest.py         # doc → vector → ChromaDB
services/rag-engine/src/model_cache.py    # singleton model loader
services/rag-engine/src/prefixes.py       # prefix_query() / prefix_passage() (Sprint 11)
services/data-processor/src/pipeline.py   # raw JSONL → cleaned docs
services/scraper/google-maps-scraper/     # Go binary + Playwright
scripts/setup.sh                          # one-command first-run setup
scripts/docker-startup.sh                 # container entrypoint
scripts/migrate-to-e5-small.sh            # bge-m3 → e5-small migration
docker-compose.yml                        # 3-service composition
Dockerfile.{api,web,geo}                  # one per service
```

---

## 13. Document maintenance

This is a living document. Update when:
- Architectural decisions change (new container, new model, new external dependency)
- Resource measurements shift significantly (new VPS, new corpus size)
- New known issues discovered
- Open questions get resolved

**Style guide**: keep paragraphs short, prefer tables and diagrams. Audience
is mixed (infra engineers + AI agents + non-engineer stakeholders) — explain
Indonesian-specific terms (kos, kecamatan) once in the glossary.

**Companion documents** to keep in sync:
- `README.md` — must reflect current ports + first-run instructions
- `.env.docker` — must reflect current env-var defaults
- `docker-compose.yml` — must reflect current port mapping
