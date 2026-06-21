# Sprint 5 — Dockerization Tasks

> Status: 🔵 In Progress | Created: 2026-06-20

Status legend: ⬜ pending | 🔵 in_progress | ✅ completed | ❌ blocked

---

## Phase 1 — Dockerfile & docker-compose (Core) 🔵

| ID   | Task | Difficulty | Status |
|------|------|-----------|--------|
| 1.1  | `Dockerfile.geo` — Node 22 Alpine, tsx + geo-router | Easy | ✅ |
| 1.2  | `Dockerfile.api` — Python 3.11, all deps, Chromium, Go binary | Medium | ✅ |
| 1.3  | `Dockerfile.web` — Multi-stage: Astro build → nginx serve | Medium | ✅ |
| 1.4  | `docker-compose.yml` — 3 containers, healthchecks, volumes, network | Medium | ✅ |
| 1.5  | `.env.docker` — Environment variables untuk Docker | Easy | ✅ |
| 1.6  | `docker/nginx.conf` — Nginx config untuk SPA routing | Easy | ✅ |
| 1.7  | Fix `GEO_ROUTER_URL` env var di orchestrator, locations, system | Easy | ✅ |

## Phase 2 — Build Script & Go Binary ⬜

| ID   | Task | Difficulty | Status |
|------|------|-----------|--------|
| 2.1  | `scripts/build-scraper.sh` — Build Go binary inside Docker | Easy | 🔵 |

## Phase 3 — Volume & Data ⬜

| ID   | Task | Difficulty | Status |
|------|------|-----------|--------|
| 3.1  | Volume `data/` → `/app/data` | Easy | 🔵 |
| 3.2  | Volume `model-cache/` → huggingface cache | Easy | 🔵 |

## Phase 4 — Setup & README ⬜

| ID   | Task | Difficulty | Status |
|------|------|-----------|--------|
| 4.1  | `scripts/setup.sh` — One-command setup | Medium | 🔵 |
| 4.2  | `README.md` — Panduan lengkap (ID + EN) | Medium | 🔵 |

## Phase 5 — Polish ⬜

| ID   | Task | Difficulty | Status |
|------|------|-----------|--------|
| 5.1  | Healthchecks semua container | Easy | 🔵 |
| 5.2  | Restart policy `unless-stopped` | Easy | 🔵 |
| 5.3  | Image size optimization | Medium | ⬜ |

---

## Summary

| Phase | Tasks | Est. | Status |
|-------|-------|------|--------|
| 1 — Dockerfile & Compose | 7 | 3h | 🔵 |
| 2 — Build Script | 1 | 1h | ⬜ |
| 3 — Volume & Data | 2 | 0.5h | ⬜ |
| 4 — Setup & README | 2 | 1h | ⬜ |
| 5 — Polish | 3 | 1h | ⬜ |
| **Total** | **15** | **~6.5h** | **🔵** |
