---
tags:
  - deployment
  - production
  - cost-estimation
  - scaling
created: 2026-06-20
updated: 2026-06-20
---

# Deployment & Scale — Cost, Pros/Cons, Production Roadmap

> Analisis kesiapan deployment dan rencana scale ke production (ratusan concurrent user).

---

## 1. Current Architecture Assessment

### 1.1 Pros (Kelebihan)

| Aspek | Kelebihan |
|-------|-----------|
| **Modular monorepo** | 4 service terisolasi (geo-router, scraper, data-processor, rag-engine), bisa di-deploy atau rewrite satu per satu |
| **No vendor lock-in** | Semua service self-hosted. LLM Z.AI bisa diganti OpenAI/Anthropic/Llama lokal. Embedding bisa ganti model |
| **Zero infrastructure cost (MVP)** | ChromaDB embedded (no server), SQLite (no PostgreSQL), file-based data storage. Bisa jalan di laptop developer |
| **Grid-expand strategy solid** | Scrape per kecamatan (bukan langsung kota) — proven data strategy untuk Google Maps limit ~120 result |
| **SSE streaming built in** | Sudah ada token-by-token streaming ke frontend, UX real-time |
| **Data sudah terkumpul** | ~1,113 kos di 14 kecamatan, RAG pipeline berfungsi penuh |
| **Skala kecil VPS murah** | Dengan 4-8 GB RAM sudah bisa melayani 10-20 user bersamaan |

### 1.2 Cons (Kekurangan — Blocker Production)

| Masalah | Severity | Dampak |
|---------|----------|--------|
| **Subprocess-based RAG** | 🔴 Critical | Setiap search spawn Python subprocess baru, load ulang BGE-M3 (2.3 GB, 3-5 detik overhead). Mustahil untuk concurrent users |
| **Embedded ChromaDB** | 🔴 Critical | Single-writer, no concurrency. Query antri jika >1 user search barengan |
| **BGE-M3 di CPU** | 🔴 Critical | Embedding 100-500ms/query. Dengan 10 user bersamaan = 1-5 detik antrian |
| **FastAPI single worker** | 🔴 Critical | 1 uvicorn process = 1 request dalam 1 waktu. Pipeline blocking semua endpoint |
| **Tanpa message queue** | 🟠 Major | Scraping & indexing blocking API thread. User nunggu pipeline selesai sebelum dapat response |
| **Tanpa cache layer** | 🟠 Major | Setiap search jalankan pipeline penuh walau query mirip. Boros CPU & waktu |
| **SQLite untuk search history** | 🟡 Minor | Tidak support concurrent write. Cukup untuk single-user, problem di multi-user |
| **Tanpa auth / rate limiting** | 🔴 Critical | Semua endpoint terbuka. Siapapun bisa scrape infinite, abuse LLM API, baca settings |
| **Tanpa process supervisor** | 🟠 Major | Service mati tidak auto-restart. Perlu systemd / Docker auto-heal |
| **File-based data sharing** | 🟡 Minor | Service komunikasi via `data/` directory. Tidak bisa horizontal-scale (multiple server) |
| **Tanpa monitoring / logging** | 🟡 Minor | Gak ada metrics, tracing, alert. Debug production = SSH + `cat` log |

---

## 2. Cost & Estimation

### 2.1 MVP / Demo Stage (Arsitektur Sekarang)

**Kapasitas:** 5-10 concurrent users. Cocok untuk demo investor, internal testing, atau beta terbatas.

| Provider | Spec | RAM | CPU | Storage | Harga/Bulan |
|----------|------|-----|-----|---------|-------------|
| **IDCloudHost** | VM-C | 4 GB | 2 vCPU | 30 GB | ~Rp 150.000 |
| **Niagahoster** | VPS 3 | 4 GB | 2 vCPU | 50 GB | ~Rp 200.000 |
| **DigitalOcean** | Basic Droplet | 4 GB | 2 vCPU | 80 GB | ~$24 (Rp 390.000) |
| **Vultr** | Cloud Compute | 4 GB | 2 vCPU | 50 GB | ~$24 (Rp 390.000) |
| **AWS Lightsail** | 4 GB | 4 GB | 2 vCPU | 80 GB | ~$20 (Rp 325.000) |
| **AWS EC2** | t3.medium | 4 GB | 2 vCPU | 30 GB EBS | ~$25 (Rp 405.000) |

**Biaya tambahan:**
- Z.AI API (LLM): tergantung usage, estimasi $5-10/bulan dengan 500-1000 query
- Domain: ~Rp 150.000/tahun
- SSL: Free (Let's Encrypt)

**Total MVP:** Rp 200.000 - Rp 450.000/bulan

### 2.2 Growth Stage (20-50 Concurrent Users)

**Optimasi ringan tanpa arsitektur ulang:**
- Gunicorn 4 workers (ganti uvicorn single process)
- Persistent RAG service (model stay in memory)
- Redis untuk session cache + rate limiting
- Nginx reverse proxy

| Provider | Spec | RAM | CPU | Storage | Harga/Bulan |
|----------|------|-----|-----|---------|-------------|
| **IDCloudHost** | VM-D | 8 GB | 4 vCPU | 60 GB | ~Rp 350.000 |
| **DigitalOcean** | CPU-Optimized | 8 GB | 4 vCPU | 100 GB | ~$48 (Rp 780.000) |
| **Vultr** | High Frequency | 8 GB | 4 vCPU | 80 GB | ~$48 (Rp 780.000) |

**Biaya tambahan:**
- Z.AI API (LLM): ~$10-20/bulan
- Managed Redis (opsional): +$5-10/bulan

**Total Growth:** Rp 500.000 - Rp 1.200.000/bulan

### 2.3 Production Stage (Ratusan Concurrent Users)

**Arsitektur ulang penuh.** Butuh multiple servers atau managed services.

#### Opsi A: Self-Managed (2-3 VPS)

| Komponen | Server | Spec | Harga/Bulan |
|----------|--------|------|-------------|
| **API Server** (FastAPI × 4 workers) | VPS 1 | 8 GB, 4 vCPU | ~Rp 500.000 |
| **RAG Worker** (GPU instance) | VPS GPU | 16 GB, 4 vCPU + GPU | Rp 2.500.000 |
| **Chromium Scraper** × 2 | VPS 3 | 8 GB, 4 vCPU | ~Rp 500.000 |
| **Redis** (cache + queue) | — | Managed 2 GB | ~Rp 250.000 |
| **PostgreSQL** | — | Managed 10 GB | ~Rp 200.000 |
| **Nginx LB** | VPS 1 | bundled | — |
| **Block Storage** | per server | +50-100 GB each | ~Rp 150.000 |

**Total Opsi A:** Rp 3.500.000 - Rp 4.500.000/bulan (~$215-280)

#### Opsi B: Managed Cloud (AWS/GCP)

| Service | Spec | Harga/Bulan |
|---------|------|-------------|
| **ECS Fargate** (API, 2 tasks) | 4 vCPU, 8 GB each | ~$120 |
| **EC2 G4dn.xlarge** (RAG GPU) | 16 GB, 4 vCPU, T4 GPU | ~$200 |
| **EC2 Spot** (Scraper, 2 instances) | 8 GB, 4 vCPU | ~$80 |
| **ElastiCache** (Redis) | cache.t3.small | ~$25 |
| **RDS** (PostgreSQL) | db.t3.small, 20 GB | ~$35 |
| **ALB** (Load Balancer) | Application LB | ~$25 |
| **S3** (Data backup) | 50 GB | ~$3 |
| **CloudFront** (CDN) | Frontend static | ~$10 |
| **Route 53** (DNS) | Domain + hosted zone | ~$5 |

**Total Opsi B:** ~$500/bulan (~Rp 8.100.000)

#### Opsi C: Hybrid (Budget-Conscious Production)

| Service | Provider | Spec | Harga/Bulan |
|---------|----------|------|-------------|
| **API + RAG** | IDCloudHost VM-GPU | 16 GB, 8 vCPU + GPU | ~Rp 1.500.000 |
| **Scraper** | IDCloudHost VM-D | 8 GB, 4 vCPU | ~Rp 350.000 |
| **Redis** | Upstash (managed) | 1 GB | ~$10 (Rp 160.000) |
| **PostgreSQL** | Supabase (managed) | 8 GB | ~$25 (Rp 400.000) |
| **CDN** | Cloudflare (free tier) | Unlimited | Free |
| **DNS** | Cloudflare | — | Free |

**Total Opsi C:** Rp 2.400.000 - Rp 2.800.000/bulan (~$150-175)

---

## 3. Production Architecture (Target)

### 3.1 Target Arsitektur

```
                                ┌─────────────────┐
                                │   Cloudflare CDN │
                                │  (Astro SSG +    │
                                │   DNS + DDoS)    │
                                └────────┬────────┘
                                         │
                                ┌────────▼────────┐
                                │  Nginx / ALB    │
                                │  (Load Balancer) │
                                └────────┬────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    │                    │                    │
           ┌────────▼────────┐  ┌───────▼───────┐  ┌────────▼────────┐
           │  API Server 1   │  │  API Server 2  │  │  API Server N   │
           │  FastAPI :8080  │  │  FastAPI :8080  │  │  FastAPI :8080  │
           │  (Gunicorn ×4)  │  │  (Gunicorn ×4)  │  │  (Gunicorn ×4)  │
           └────────┬────────┘  └───────┬───────┘  └────────┬────────┘
                    │                    │                    │
                    └────────────────────┼────────────────────┘
                                         │
              ┌──────────────────────────┼──────────────────────────┐
              │                          │                          │
    ┌─────────▼─────────┐   ┌───────────▼──────────┐   ┌───────────▼──────────┐
    │   Redis Cluster   │   │   BullMQ / Celery    │   │     PostgreSQL       │
    │   (Cache + Rate   │   │   (Job Queue)        │   │     (Main DB)        │
    │    Limit + PubSub) │   └──────────┬──────────┘   └──────────────────────┘
    └────────────────────┘              │
                          ┌─────────────┼─────────────┐
                          │             │             │
                ┌─────────▼────┐ ┌──────▼──────┐ ┌───▼──────────┐
                │ RAG Worker 1 │ │ RAG Worker 2│ │ Scraper Pool │
                │ BGE-M3 @ GPU │ │ BGE-M3 @ GPU│ │ Chromium ×N  │
                │ ChromaDB SVR │ │ ChromaDB SVR│ │ (Ephemeral)  │
                └──────────────┘ └─────────────┘ └──────────────┘
```

### 3.2 Perubahan Kunci dari MVP

| Komponen | MVP (Sekarang) | Production (Target) |
|----------|----------------|---------------------|
| **Web Server** | 1 uvicorn process | Gunicorn 4-8 workers, multiple API server instances |
| **RAG Engine** | subprocess, load model per request | Long-running service, model warm di GPU, shared via API |
| **Vector DB** | ChromaDB embedded | ChromaDB server (client-server mode) atau Qdrant |
| **Queue** | Tidak ada | Redis + BullMQ/Celery untuk async scraping & indexing |
| **Cache** | Tidak ada | Redis: query cache, session cache, rate limit counter |
| **Database** | SQLite | PostgreSQL + connection pooling |
| **Auth** | Tidak ada | JWT + OAuth2 (Google login), API key untuk service-to-service |
| **Monitoring** | Tidak ada | Prometheus + Grafana + Sentry error tracking |
| **Deployment** | Manual `python3 -m uvicorn` | Docker Compose / Kubernetes, CI/CD pipeline |
| **Frontend** | Astro SSR | Astro SSG (static pre-build) + API calls, served via CDN |
| **File Storage** | Lokal `data/` directory | S3-compatible (MinIO / AWS S3) |

---

## 4. Production Development Roadmap

### Phase 1: Containerization & Orchestration (Week 1-2)

**Goal:** Semua service berjalan di Docker dengan satu command.

```
Tasks:
├── Dockerfile untuk setiap service (api, geo-router, rag-engine, scraper)
├── docker-compose.yml (all services + dependency order)
├── Volume mounts untuk development (data/, chroma_db/)
├── Health checks untuk setiap container
└── Multi-stage builds untuk optimasi image size
```

**Dockerfile examples:**

```dockerfile
# services/rag-engine/Dockerfile
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY services/rag-engine/pyproject.toml .
RUN pip install --no-cache-dir .
COPY services/rag-engine/ .
COPY data/ /data/
ENV PYTHONUNBUFFERED=1
CMD ["python", "-m", "src.server"]
```

### Phase 2: Persistent RAG Service (Week 2-3)

**Goal:** RAG model tidak reload per request. Embedding tetap di memory.

```
Tasks:
├── Buat `services/rag-engine/src/server.py` — FastAPI/Flask server
│   ├── Warmup bge-m3 saat startup (sekali saja)
│   ├── Endpoint: POST /embed, POST /search, POST /ingest, GET /health
│   └── Concurrency: async embedding dengan ThreadPoolExecutor
├── Ubah orchestrator dari subprocess → HTTP call ke RAG server
├── Health check otomatis di docker-compose (depends_on + condition)
└── Benchmark latency sebelum vs sesudah
```

**Estimasi improvement:** 5-10× lebih cepat per query (hilangkan 3-5 detik model loading overhead).

### Phase 3: Async Pipeline dengan Message Queue (Week 3-4)

**Goal:** Scraping & indexing tidak blocking API response.

```
Tasks:
├── Setup Redis + BullMQ (TypeScript) atau Celery (Python)
├── Job types:
│   ├── scrape_area(area_name) — jalankan scraper + processor di background
│   ├── index_docs(docs) — embed & insert ke ChromaDB di background
│   └── revalidate_cache(area) — scheduled job untuk TTL check
├── WebSocket/SSE notifikasi ke frontend saat job selesai
├── Rate limit: max 2 concurrent scrape jobs
└── Dashboard queue monitoring (opsional)
```

**Flow baru:**
```
User search "Cengkareng belum di-cache"
  → API terima request
  → API return SSE: "event: progress, stage: queued"
  → API enqueue job scrape_area("Cengkareng")
  → API return response kosong dengan status "pending"
  → Worker scrape + process + index
  → Worker publish event ke Redis PubSub
  → API subscribe → SSE ke user: "event: progress, stage: done"
  → User bisa refresh / re-search untuk lihat hasil
```

### Phase 4: Redis Cache Layer (Week 4)

**Goal:** Query yang mirip tidak perlu re-search. Response instant untuk cache hit.

```
Cache strategy:
├── Query → normalize → hash → Redis GET
├── Cache key: `search:{area}:{normalized_query}`
├── Cache TTL: 15 menit (query populer), 5 menit (query spesifik)
├── Cache invalidation: saat re-index area, flush semua key prefix `search:{area}:`
├── Rate limiting: 30 req/menit per IP (anonymous), 60 req/menit (authenticated)
└── Session state di Redis (pengganti in-memory ChatInterface state)
```

### Phase 5: Auth & Multi-Tenancy (Week 5-6)

**Goal:** User login, data terisolasi per user.

```
Tasks:
├── User model: id, email, name, password_hash, created_at
├── JWT auth (access + refresh token)
├── Middleware: @require_auth decorator untuk semua endpoint kecuali public
├── Rate limit per-user yang lebih tinggi
├── Saved searches terisolasi per user_id
├── OAuth2: Google Sign-In (opsional, untuk quick onboarding)
└── API key untuk service-to-service (internal communication)
```

### Phase 6: Database Migration (Week 6)

**Goal:** Ganti SQLite ke PostgreSQL untuk concurrent write & query.

```
Tasks:
├── Setup PostgreSQL (Supabase managed atau self-hosted)
├── SQLAlchemy models untuk saved_searches, users, scrape_jobs
├── Alembic migration
├── Data migration script (SQLite → PostgreSQL)
├── Connection pooling (SQLAlchemy pool_size=10)
└── Remove sqlite3 stdlib usage dari api/src/searches.py
```

### Phase 7: ChromaDB Server Mode (Week 6-7)

**Goal:** ChromaDB bisa melayani concurrent query dari multiple API workers.

```
Tasks:
├── Deploy ChromaDB dalam client-server mode (bukan embedded)
│   ├── Docker container dedicated ChromaDB
│   ├── Persistent volume untuk chroma.sqlite3 + index
│   └── Auth token untuk akses
├── Ubah semua client ChromaDB dari PersistentClient → HttpClient
├── Test concurrent query performance
└── Backup & restore strategy
```

### Phase 8: GPU Migration untuk Embedding (Week 7-8)

**Goal:** Embedding model berjalan di GPU untuk throughput tinggi.

```
Tasks:
├── Setup GPU instance (VPS GPU atau cloud GPU)
├── Install CUDA + PyTorch GPU
├── Migrasi sentence-transformers ke GPU
├── Benchmark: CPU vs GPU embedding throughput
│   ├── CPU: ~2-5 embedding/detik
│   └── GPU: ~100-500 embedding/detik (50-100× faster)
├── Batching strategy: kumpulkan N query → embed sekaligus di GPU
└── Fallback ke CPU jika GPU unavailable
```

### Phase 9: Horizontal Scaling (Week 8-9)

**Goal:** Multiple API server instances di belakang load balancer.

```
Tasks:
├── Nginx reverse proxy (atau cloud ALB)
│   ├── Load balancing: least_conn
│   ├── Health checks: GET /health
│   ├── Rate limiting: 100 req/s global
│   └── SSL termination
├── Stateless API design (semua state di Redis, bukan in-memory)
├── Session stickiness via Redis (opsional, untuk SSE connection affinity)
├── Docker Compose → Docker Swarm / Kubernetes untuk orchestration
└── Auto-scaling policy (CPU > 70% → spawn new instance)
```

### Phase 10: Monitoring & Observability (Week 9-10)

**Goal:** Visibility penuh ke system health dan user behavior.

```
Tasks:
├── Prometheus metrics:
│   ├── request_count, request_latency (histogram)
│   ├── cache_hit_rate, embedding_latency
│   ├── queue_depth, active_scrape_jobs
│   └── model_memory_usage, gpu_utilization
├── Grafana dashboards:
│   ├── API performance overview
│   ├── RAG pipeline health
│   └── Business metrics: searches/day, kos indexed, user retention
├── Sentry error tracking (Python + TypeScript SDK)
├── Structured logging (JSON format) → Loki / CloudWatch
└── Uptime monitoring (UptimeRobot / CloudWatch alarm)
```

### Phase 11: CI/CD Pipeline (Week 10)

**Goal:** Automated build, test, deploy.

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Type check (web)
        run: cd web && npm ci && npm run check
      - name: Python lint
        run: ruff check services/ api/
      - name: Unit tests
        run: pytest services/ api/

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - name: Build Docker images
        run: docker compose build
      - name: Push to registry
        run: docker compose push
      - name: Deploy via SSH
        run: ssh vps 'docker compose pull && docker compose up -d'
```

### Phase 12: Production Hardening (Week 10-12)

```
Tasks:
├── Security audit:
│   ├── CORS strict whitelist (bukan allow_origin=*)
│   ├── CSP headers (Content-Security-Policy)
│   ├── SQL injection audit (semua query parameterized)
│   ├── LLM prompt injection guard (perkuat sanitize.ts)
│   └── Dependency vulnerability scan (npm audit, pip-audit)
├── Rate limiting tier:
│   ├── Anonymous: 10 search/hari
│   ├── Free user: 50 search/hari
│   └── Premium: unlimited
├── Backup strategy:
│   ├── PostgreSQL: daily dump ke S3
│   ├── ChromaDB: daily snapshot
│   └── Retention: 30 hari
├── Disaster recovery plan:
│   ├── Documented restore procedure
│   └── RTO: <4 jam, RPO: <24 jam
└── Load test:
    ├── Artillery / k6 scripts untuk simulasi 100 concurrent users
    ├── Identify bottleneck (CPU, RAM, DB connection, LLM API rate)
    └── Tuning berdasarkan hasil load test
```

---

## 5. Estimasi Biaya Total per Stage

| Stage | Infra/Bulan | LLM API/Bulan | Total/Bulan | Concurrent Users |
|-------|-------------|---------------|-------------|------------------|
| **MVP** (sekarang) | Rp 200.000 | Rp 80.000 | **~Rp 280.000** | 5-10 |
| **Growth** | Rp 500.000 | Rp 240.000 | **~Rp 740.000** | 20-50 |
| **Production A** (self-managed) | Rp 3.500.000 | Rp 1.600.000 | **~Rp 5.100.000** | 200-500 |
| **Production B** (managed cloud) | Rp 8.100.000 | Rp 1.600.000 | **~Rp 9.700.000** | 500+ |
| **Production C** (hybrid budget) | Rp 2.400.000 | Rp 1.600.000 | **~Rp 4.000.000** | 100-300 |

> Catatan: Biaya LLM API dihitung asumsi 50% user melakukan 1 search/hari, dengan rata-rata 500 token output per search. Bisa lebih rendah dengan caching agresif.

---

## 6. Quick Wins (Yang Bisa Dilakukan Sekarang Tanpa Arsitektur Ulang)

Ini adalah perbaikan yang bisa langsung dilakukan di arsitektur saat ini untuk meningkatkan kapasitas 2-3× tanpa biaya infrastruktur tambahan:

| # | Quick Win | Effort | Impact |
|---|-----------|--------|--------|
| 1 | **Gunicorn ganti uvicorn** — 4 workers instead of 1 | 30 menit | 4× concurrent API |
| 2 | **Persistent RAG service** — model stay di memory, no reload | 4 jam | 5-10× faster search |
| 3 | **Query result cache** — dictionary in-memory, TTL 5 menit | 2 jam | Instant untuk query populer |
| 4 | **Scraper TTL pre-check** — return cached tanpa scrape jika <30 hari | Sudah ada | 0 detik untuk area cached |
| 5 | **ChromaDB batch query** — kumpulkan 3-5 query sebelum embed | 3 jam | 2-3× throughput embedding |
| 6 | **Frontend SSG** — build static, serve via Nginx (bukan Astro SSR) | 2 jam | Kurangi 200-300 MB RAM |
| 7 | **Rate limit middleware** — simple IP-based counter di FastAPI | 1 jam | Cegah abuse LLM API |
| 8 | **Compressed response** — gzip/brotli middleware di FastAPI | 15 menit | Kurangi bandwidth 70% |

**Estimasi setelah semua quick wins:** 20-50 concurrent users (dari sebelumnya 5-10).

---

## 7. Keputusan Arsitektur Kunci (Production)

| Keputusan | Rekomendasi | Alasan |
|-----------|-------------|--------|
| **LLM Provider** | Tetap Z.AI untuk production awal, fallback OpenAI | Z.AI lebih murah untuk bahasa Indonesia, sudah teruji |
| **Embedding Model** | Tetap BGE-M3, tapi ke GPU | Multilingual superior, 8192 token context, gratis |
| **Vector DB** | ChromaDB server → Qdrant (opsional) | ChromaDB cukup untuk <100K docs, Qdrant untuk skala lebih besar |
| **Database** | PostgreSQL (Supabase managed) | Gratis tier cukup untuk MVP, managed = no ops |
| **Queue** | BullMQ + Redis | TypeScript-native, dashboard built-in, mature |
| **Cache** | Redis | Multi-purpose (cache, queue, rate limit, session) |
| **Auth** | JWT + Google OAuth2 | Simple, no password management, familiar |
| **Deployment** | Docker Compose → Kubernetes | Compose untuk growth stage, K8s untuk production scale |
| **Cloud** | IDCloudHost (compute) + Vercel (frontend) + Supabase (DB) | Cost-effective untuk traffic Indonesia |

---

## 8. Timeline Produksi

```
Month 1: Phase 1-2 (Docker + Persistent RAG)
Month 2: Phase 3-4 (Queue + Cache)
Month 3: Phase 5-6 (Auth + PostgreSQL)
Month 4: Phase 7-8 (ChromaDB server + GPU)
Month 5: Phase 9-10 (Horizontal scale + Monitoring)
Month 6: Phase 11-12 (CI/CD + Hardening)
Month 7: Production launch (ratusan user)
```

**Timeline bisa dipercepat** dengan managed services (Phase 3-8 bisa skip jika pakai Supabase + Upstash Redis + Qdrant Cloud).

---

## 9. Risiko & Mitigasi

| Risiko | Probability | Impact | Mitigasi |
|--------|-------------|--------|----------|
| Google Maps scraping diblokir | Medium | High | Rotate IP/proxy, fallback ke data manual entry, diversifikasi sumber data |
| Z.AI API down / pricing berubah | Low | Medium | Maintain fallback ke OpenAI/Anthropic, abstract LLM adapter |
| BGE-M3 GPU OOM dengan banyak concurrent query | Medium | Medium | Batch embedding, queue system, fallback CPU untuk overflow |
| Biaya LLM API membengkak | Medium | High | Aggressive caching, rate limit ketat, pre-compute common queries |
| Scaling bottleneck tidak terdeteksi | Low | Critical | Load test berkala, monitoring & alerting, gradual rollout |

---

## 10. Kesimpulan

**Status saat ini:** MVP siap demo, **tidak siap production untuk ratusan user.**

**Untuk production:**
- Minimal investasi 2-3 bulan development untuk rewrite infrastruktur backend
- Biaya operasional **Rp 2.5 - 5 juta/bulan** untuk 100-500 users
- Quick wins yang ada bisa langsung dilakukan untuk naik ke 20-50 users tanpa biaya tambahan
- Jangan deploy arsitektur sekarang ke production — subprocess-based RAG dan single-worker FastAPI akan menjadi bottleneck fatal

**Rekomendasi next step:**
1. Kerjakan 8 quick wins dulu (effort 2-3 hari, impact 2-3× kapasitas)
2. Deploy ke VPS 8 GB untuk beta testing (10-20 user internal)
3. Mulai Phase 1-2 (Docker + Persistent RAG) sebagai fondasi production
4. Cari product-market fit dulu sebelum investasi scale penuh

---

*Documented by Claude Code — 2026-06-20*
