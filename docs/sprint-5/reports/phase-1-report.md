# Phase 1 Report — Dockerfile & docker-compose (Core)

> Completed: 2026-06-20 | Sprint 5 — Dockerization

---

## 1. Overview

Phase 1 membangun fondasi Docker: 3 Dockerfile untuk 3 service, docker-compose.yml
untuk orkestrasi, nginx config untuk SPA routing, dan environment variables.
Semua 3 container berhasil dibuild dan berjalan healthy.

```
docker compose up
  ├── kos-geo:3001    — geo-router (Node.js Fastify)
  ├── kos-api:8080    — FastAPI + RAG + scraper + data-processor (Python)
  └── kos-web:80      — Astro static (nginx)
```

---

## 2. Changes

### 2a. `Dockerfile.geo` (NEW — 16 lines)

Node 22 Alpine, install semua deps (termasuk tsx devDep untuk run TypeScript),
copy source + kodepos.json, expose port 3001.

### 2b. `Dockerfile.api` (NEW — 36 lines)

Python 3.11-slim, install Chromium + Playwright deps, semua Python packages
(fastapi, uvicorn, chromadb, sentence-transformers, openai, jose, passlib, bcrypt),
copy semua source code, expose port 8080.

**Note:** Go binary tidak di-build di Dockerfile (terlalu lama karena GOTOOLCHAIN
download Go 1.26.3). Sebagai gantinya, Go binary di-build via `scripts/build-scraper.sh`
dan di-copy ke image.

### 2c. `Dockerfile.web` (NEW — 16 lines)

Multi-stage build: stage 1 build Astro dengan Node 22 Alpine → stage 2 serve
static `dist/` dengan nginx:alpine.

### 2d. `docker-compose.yml` (NEW)

3 service + 1 network + 1 volume:
- **geo-router** → port 3001, healthcheck via node http
- **api** → port 8080, volume `./data:/app/data`, `model-cache:/root/.cache/huggingface`, depends_on geo-router
- **web** → port 80, depends_on api

Semua service pakai `restart: unless-stopped`.

### 2e. `docker/nginx.conf` (NEW)

nginx config dengan SPA routing: `try_files $uri/index.html $uri $uri/ =404`,
gzip enabled, static asset caching 30d.

### 2f. `.env.docker` (NEW)

Environment variables untuk Docker: JWT_SECRET, PUBLIC_API_URL, LLM config,
GEO_ROUTER_URL (internal Docker hostname), ChromaDB path.

### 2g. `GEO_ROUTER_URL` refactor

Di 3 file (`orchestrator.py`, `locations.py`, `system.py`), `GEO_ROUTER_URL`
diubah dari hardcoded `http://localhost:3001` menjadi `os.environ.get("GEO_ROUTER_URL", "http://localhost:3001")` agar bisa dikonfigurasi di Docker (menggunakan hostname `geo-router`).

---

## 3. Verification

| # | Check | Result |
|---|-------|--------|
| 1 | `docker compose build` (all 3 images) | Built successfully |
| 2 | `docker compose up -d` | All 3 containers running |
| 3 | `docker compose ps` | All 3 containers **healthy** |
| 4 | `curl localhost:8080/health` | `{"status":"ok","version":"0.1.0"}` |
| 5 | `POST /auth/login` | 200 + JWT token |
| 6 | `curl localhost:3001/resolve?q=bandung` | Area resolved → Bandung |
| 7 | `curl localhost` (/) | 200 |
| 8 | `curl localhost/login` | 200 |
| 9 | `curl localhost/search` | 200 |
| 10 | `curl localhost/settings` | 200 |
| 11 | `GET /health/services` | `{"all_ok": true}` |

| Check | Result |
|-------|--------|
| Python AST (orchestrator, locations, system) | OK |
| `npm run check` | 0/0/0 |

---

## 4. Image Sizes

| Image | Size | Notes |
|-------|------|-------|
| `rent-house-ai-api` | 10.1 GB | sentence-transformers + PyTorch + ChromaDB (dominan) |
| `rent-house-ai-geo-router` | 270 MB | Node.js + node_modules |
| `rent-house-ai-web` | 102 MB | nginx + static dist/ |

API image besar karena `sentence-transformers` menarik PyTorch (~2-3GB).
Bisa dioptimalkan di Phase 5 (pakai image yang lebih ringan atau ONNX runtime).

---

## 5. Findings / Notes

| Item | Detail |
|------|--------|
| **Go 1.26.3 build issue** | `golang:1.24` tidak kompatibel dengan `go.mod` yang minta Go 1.26. Fix: `GOTOOLCHAIN=auto` + build script terpisah. Binary di-build di `scripts/build-scraper.sh` (~37MB Linux binary). |
| **nginx trailing slash** | Astro build halaman sebagai `/login/index.html`. Nginx perlu `try_files $uri/index.html` biar `/login` resolve tanpa redirect 301. |
| **tsx devDependency** | Geo-router butuh `tsx` untuk run TypeScript. `npm install --production` tidak install devDeps → harus pakai `npm install` biasa. |
| **Healthcheck wget** | Alpine tidak punya `wget` bawaan → geo-router healthcheck pakai `node -e "require('http').get(...)"`. |

---

## 6. Reference Files

| File | Purpose |
|------|---------|
| `Dockerfile.api` | Python 3.11 + Chromium + semua Python deps |
| `Dockerfile.geo` | Node 22 Alpine + tsx + kodepos.json |
| `Dockerfile.web` | Multi-stage Astro build + nginx |
| `docker-compose.yml` | 3 containers + volumes + healthchecks |
| `docker/nginx.conf` | SPA routing + gzip + cache |
| `.env.docker` | Environment variables |
| `api/src/orchestrator.py` | `GEO_ROUTER_URL` env var |
| `api/src/locations.py` | `GEO_ROUTER_URL` env var |
| `api/src/system.py` | `GEO_ROUTER_URL` env var |
| `.gitignore` | `model-cache/`, `build/` |

> **Ref:** `docs/sprint-5/tasks.md` — Phase 1 task tracking
