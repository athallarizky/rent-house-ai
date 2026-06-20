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

**First run takes 5–15 minutes** (downloads embedding model ~2.3 GB). Subsequent runs take ~30 seconds.

### Step 3 — Open browser

```
http://localhost
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
| Landing | http://localhost |
| Login | http://localhost/login |
| Search | http://localhost/search |
| Settings (admin only) | http://localhost/settings |

---

## Troubleshooting

### Port conflict (80, 8080, or 3001 already in use)

```bash
lsof -i :80 -i :8080 -i :3001   # find what's using the port
```

If a port is taken, edit `docker-compose.yml`, change the host port (e.g. `8081:8080`), then update `.env.docker`:
```
PUBLIC_API_URL=http://localhost:8081
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
rm -rf model-cache/
docker compose up -d    # retries download
```

### Not enough RAM

Docker needs **≥ 8 GB RAM**. On macOS: Docker Desktop → Settings → Resources → increase Memory limit.

---

## Architecture

```
docker compose up
  ├── kos-geo:3001    Node.js (Fastify)     area name resolution
  ├── kos-api:8080    Python (FastAPI)      orchestrator + RAG engine + scraper + data processor
  └── kos-web:80      nginx (static)        Astro frontend
```

All Python services (API, RAG, scraper, data-processor) run inside a single `kos-api` container via subprocess calls — no refactoring needed.

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Astro 6 + React 19 + Tailwind 4 |
| Backend | FastAPI (Python 3.11) |
| Auth | JWT + bcrypt |
| Search / RAG | ChromaDB + bge-m3 + Z.AI (glm-4.5-air) |
| Scraper | Go (Google Maps) + Chromium |
| Geo resolution | Fastify (Node.js) + Fuse.js |
| Infra | Docker Compose (3 containers) |
