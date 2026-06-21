# Sprint 5 — Dockerization

> Status: 🔵 In Progress | Created: 2026-06-20

---

## Goal

Wrap seluruh aplikasi Kos AI ke dalam Docker containers agar setup di device baru
tinggal `./scripts/setup.sh` → langsung jalan. Target user: non-teknis yang menyuruh
AI agent untuk baca README dan bantu setup.

---

## Architecture

```
docker compose up
  ├── kos-geo:3001    — Node 22 Alpine (Fastify + Fuse.js)
  ├── kos-api:8080    — Python 3.11 (FastAPI + RAG + scraper + data-processor)
  └── kos-web:80      — nginx Alpine (Astro static build)
```

---

## All Phases

| Phase | Status | Description |
|-------|--------|-------------|
| 1 — Dockerfile & Compose | 🔵 | 3 Dockerfiles, docker-compose.yml, nginx config, env vars |
| 2 — Build Script & Go Binary | ⬜ | `build-scraper.sh`, Go binary untuk Linux |
| 3 — Volume & Data | ⬜ | Volume mounts, data persistence, model cache |
| 4 — Setup Script & README | ⬜ | `setup.sh` one-command, README troubleshooting |
| 5 — Polish | ⬜ | Healthchecks, restart policy, image optimization |
