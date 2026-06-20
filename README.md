# Kos AI — Cari Kos dengan AI

Aplikasi pencarian kos (boarding house) berbasis AI untuk Indonesia.
Gunakan bahasa natural — misalnya *"kos di Cengkareng wifi kencang AC murah"* —
dan AI akan mencari, memproses, dan merekomendasikan kos terbaik.

---

## Cara Setup (untuk AI Agent / User Baru)

### Prasyarat
- **Docker** + **Docker Compose** terinstall
  - macOS: download [Docker Desktop](https://docs.docker.com/desktop/setup/mac/)
  - Linux: `curl -fsSL https://get.docker.com | sh`
- **Git** (untuk clone repository)
- Minimal **8 GB RAM** tersedia untuk Docker

### Setup Otomatis (direkomendasikan)

```bash
git clone https://github.com/athallarizky/rent-house-ai.git
cd rent-house-ai
./scripts/setup.sh
```

Script `setup.sh` akan:
1. Cek Docker & Docker Compose terinstall
2. Build Go scraper binary (sekali saja, ~3 menit)
3. Build semua Docker images (~10 menit pertama kali)
4. Jalankan semua service
5. Tunggu sampai semua siap, lalu tampilkan URL

**Pertama kali jalan**, model AI (bge-m3, ~2.3GB) akan di-download otomatis.
Ini hanya terjadi sekali — download berikutnya akan pakai cache.

### Setup Manual

```bash
git clone https://github.com/athallarizky/rent-house-ai.git
cd rent-house-ai

# 1. Build Go scraper binary (sekali saja)
./scripts/build-scraper.sh

# 2. Build & jalankan semua service
docker compose up -d

# 3. Cek status
docker compose ps
```

---

## Akses Aplikasi

| Halaman | URL |
|---------|-----|
| Landing | http://localhost |
| Login | http://localhost/login |
| Pencarian | http://localhost/search |
| Pengaturan | http://localhost/settings |

### Login Default
| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@kos.ai` | `admin123` |
| User | `user@kos.ai` | `user123` |

**Admin** bisa: search + ubah LLM config (API key, model)
**User** hanya bisa: search

---

## Troubleshooting

### Port sudah dipakai?
```bash
# Cek apa yang pakai port 80, 8080, 3001
lsof -i :80 -i :8080 -i :3001
```
Kalau bentrok, edit `docker-compose.yml` dan ubah port mapping (misal `8081:8080`),
lalu update `.env.docker` dengan `PUBLIC_API_URL=http://localhost:8081`.

### Model AI gagal download?
Model bge-m3 (~2.3GB) di-download saat pertama kali search.
Pastikan koneksi internet stabil. Kalau gagal, hapus cache dan coba lagi:
```bash
docker compose down
rm -rf model-cache/
docker compose up -d
```

### Container tidak healthy?
```bash
# Lihat log
docker compose logs api
docker compose logs geo-router

# Restart
docker compose restart
```

### Reset semua data?
```bash
docker compose down
rm -rf data/raw data/cleaned data/chroma_db data/auth.db data/search_history.db
docker compose up -d
```

---

## Arsitektur

```
docker compose up
  ├── kos-geo:3001    — Node.js (Fastify) — area resolution
  ├── kos-api:8080    — Python (FastAPI)  — orchestrator + RAG + scraper
  └── kos-web:80      — nginx (static)    — Astro frontend
```

Semua Python service (API, RAG engine, scraper, data-processor) berjalan
dalam 1 container `kos-api`. Geo-router dan frontend di container terpisah.

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Astro 6 + React 19 + Tailwind 4 |
| Backend API | FastAPI (Python) |
| Auth | JWT (python-jose) + bcrypt (passlib) |
| RAG / Search | ChromaDB + bge-m3 + Z.AI (glm-4.5-air) |
| Scraper | Go (Google Maps) + Chromium |
| Geo-router | Fastify (Node.js) + Fuse.js |
| Container | Docker Compose (3 containers) |
