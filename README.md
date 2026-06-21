# Kos AI — AI-Powered Boarding House Search

Natural-language search for Indonesian boarding houses (*kos*).
Example: *"kos di Cengkareng wifi kencang AC murah"* → AI scrapes, processes, and recommends.

---

## Quick Start (for AI Agents)

Run these commands in order. The user needs **Docker + Git** installed.

### Step 1 — Install prerequisites (if missing)

**macOS:**
```bash
# Install Homebrew first if needed: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install --cask docker git
# Start Docker Desktop, then return to terminal
```

**Linux:**
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # log out/in after this
# Git is usually pre-installed
```

### Step 2 — Clone and run

```bash
git clone https://github.com/athallarizky/rent-house-ai.git
cd rent-house-ai
./scripts/setup.sh
```

`setup.sh` handles everything: checks deps → builds Go binary → builds Docker images → starts all services → waits for healthy → prints the URL.

**First run takes 2–5 minutes** (downloads embedding model ~449 MB — `intfloat/multilingual-e5-small`, ~5× smaller than the previous `bge-m3`). Subsequent runs take ~30 seconds.

### Step 3 — Open browser

```
http://localhost:4000
```

**Login:**
| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@kos.ai` | `admin123` |
| User  | `user@kos.ai` | `user123` |

---

## Pages

| Page | URL |
|------|-----|
| Landing | http://localhost:4000 |
| Login | http://localhost:4000/login |
| Search | http://localhost:4000/search |
| Settings (admin only) | http://localhost:4000/settings |
| User management (admin only) | http://localhost:4000/users |
| Pipeline dashboard (admin only) | http://localhost:4000/pipeline |

---

## Troubleshooting

### Port conflict (4000, 4001, or 4002 already in use)

```bash
lsof -i :4000 -i :4001 -i :4002   # find what's using the port
```

If a port is taken (e.g. macOS AirPlay Receiver grabs :5000), edit `docker-compose.yml`, change the host port (e.g. `4080:80`), then update `.env.docker`:
```
PUBLIC_API_URL=http://localhost:4080
```

### Containers unhealthy

```bash
docker compose ps           # check status
docker compose logs api     # see API logs
docker compose logs geo-router
docker compose restart      # restart all
```

### Reset all data (fresh start)

```bash
docker compose down
rm -rf data/raw data/cleaned data/chroma_db data/auth.db data/search_history.db
docker compose up -d
```

### Model download failed

```bash
docker compose down
docker volume rm rent-house-ai_model-cache   # or <project>_model-cache
docker compose up -d    # retries download
```

### Not enough RAM

Docker needs **≥ 2 GB RAM** for `e5-small` (was 8 GB for `bge-m3`). On macOS: Docker Desktop → Settings → Resources → increase Memory limit. On Colima: `colima start --memory 4`.

---

## Architecture

```
docker compose up
  ├── kos-geo:4002  →  internal :3001  Node.js (Fastify)     area name resolution
  ├── kos-api:4001  →  internal :8080  Python (FastAPI)      orchestrator + RAG engine + scraper + data processor
  └── kos-web:4000  →  internal :80    nginx (static)        Astro frontend
```

All Python services (API, RAG, scraper, data-processor) run inside a single `kos-api` container via subprocess calls — no refactoring needed.

**Embedding model** (`intfloat/multilingual-e5-small`, 384-dim, 449 MB):
  - Loaded resident in the kos-api process at startup (Sprint 8)
  - `query: ` / `passage: ` prefixes applied centrally via `services/rag-engine/src/prefixes.py` (Sprint 11)
  - ~12× faster ingest + ~3-4× faster search vs the previous `bge-m3` (Sprint 10 measurements)

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Astro 6 + React 19 + Tailwind 4 |
| Backend | FastAPI (Python 3.11) |
| Auth | JWT + bcrypt |
| Search / RAG | ChromaDB + multilingual-e5-small + Z.AI (glm-4.5-air) |
| Scraper | Go (Google Maps) + Chromium |
| Geo resolution | Fastify (Node.js) + Fuse.js |
| Infra | Docker Compose (3 containers) |

---

## Migration from bge-m3 (Sprint 11)

If you're upgrading an existing deployment from `BAAI/bge-m3` to `intfloat/multilingual-e5-small`, the vector dimensions change (1024 → 384) and ChromaDB must be wiped + re-indexed. See `scripts/migrate-to-e5-small.sh` for a one-shot migration script that:

1. Backs up the existing `data/chroma_db/`
2. Wipes it (dim mismatch makes old vectors unusable)
3. Restarts the API (loads e5-small + creates fresh collection)
4. Loops over every `data/cleaned/*_docs.json` and triggers `/pipeline/index` per area
5. Verifies the final doc count

Estimated time on a 1700-doc corpus: ~3 minutes total (vs ~30 minutes for bge-m3).
