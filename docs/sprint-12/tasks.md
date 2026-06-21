# Sprint 12 — Production Deploy ke VPS SumoPod (Scraper Eksternal)

> Status: ⬜ Pending | Created: 2026-06-21
> Branch: `feat/deploy-sumopod` (to be created off `main`)
> Based on: Sprint 11 production migration (e5-small, commit `7384db50`) + `docs/deployment-and-scale.md`
> Type: **Production deployment — infra & build changes land**
> Estimated effort: **~5-7 h** (15 tasks)

Status legend: ⬜ pending | 🔵 in_progress | ✅ completed | ❌ blocked

---

## Goal

Deploy aplikasi Kos AI ke VPS SumoPod (https://sumopod.com/) sehingga bisa
diakses publik. Sejak Sprint 9-11 scraper dijalankan in-process di container
`kos-api` (subprocess → Go binary + Chromium). **Scraper sekarang sudah
berjalan mandiri di EC2 AWS** (`http://32.236.228.8:8080`, API key
`gms_87b0e671e4e92e489da3906f20fc4d370e531f08c93378343dd7bec1ee7c8417`),
jadi di SumoPod kita hanya perlu **3 service**:

```
docker compose up
  ├── kos-geo:4002  →  internal :3001  Node.js (Fastify)     area name resolution
  ├── kos-api:4001  →  internal :8080  Python (FastAPI)      orchestrator + RAG engine + data processor (NO scraper)
  └── kos-web:4000  →  internal :80    nginx (static)        Astro frontend
```

Scraper **dihilangkan dari build SumoPod** (Chromium + Node.js + Go binary
tidak perlu di-image `kos-api` lagi) — perkiraan image jadi ~600-900 MB lebih
kecil. **Scraper tetap ada di repo GitHub**, hanya tidak ikut di-build /
di-deploy.

### Non-goals (eksplisit)

| Item | Alasan |
|---|---|
| Menghapus `services/scraper/` dari repo / branch GitHub | Scraper masih dipakai untuk development lokal & di-deploy terpisah di EC2 |
| Horizontal scaling, Redis, PostgreSQL, GPU | Masih tahap MVP (lihat `docs/deployment-and-scale.md` §1.1) — target 5-10 concurrent users |
| Domain + SSL / HTTPS | Ditangguhkan ke sprint berikutnya bila perlu (deploy pertama via IP publik SumoPod cukup) |
| CI/CD pipeline GitHub Actions | Sprint terpisah (lihat `docs/deployment-and-scale.md` Phase 11) |
| Mengganti uvicorn single-worker | OOM risk untuk e5-small (lihat `scripts/docker-startup.sh:33-36`); scaling out defer ke sprint GPU/RAG-server |

---

## Asumsi (perlu dikonfirmasi sebelum Phase 1 dimulai)

| # | Asumsi | Validasi |
|---|--------|----------|
| A1 | **API contract scraper EC2**: server mode `google-maps-scraper` (Go) menerima request auth via header (mis. `X-API-Key: gms_...`) dan mengembalikan JSON/JSONL hasil scrape per query. | Cek `services/scraper/google-maps-scraper/` (server / `--api-key` flag); lakukan `curl http://32.236.228.8:8080/...` dengan API key untuk memastikan endpoint + payload. **Jika interface berbeda, task 1.1-1.2 perlu disesuaikan.** |
| A2 | **Spec VPS SumoPod**: RAM ≥ 4 GB, disk ≥ 30 GB (kompensasi e5-small ~449 MB + ChromaDB + data). | Cek panel SumoPod / `free -h` & `df -h` setelah SSH. Bila < 4 GB, downgrade tetap可行 (e5-small hemat RAM vs bge-m3) tapi swap wajib. |
| A3 | **Akses SSH** ke VPS (key / password) + user dengan sudo / docker group. | Konfirmasi kredensial dari panel SumoPod. |
| A4 | Scraper EC2 reachable dari SumoPod via internet (port 8080 publik). Saat ini juga reachable dari mana saja — pertimbangkan firewall whitelist IP SumoPod. | `curl -H "X-API-Key: ..." http://32.236.228.8:8080/health` dari dalam VPS. |
| A5 | Data kos yang sudah terkumpul (`data/cleaned/*_docs.json`, ~1.113 kos / 14 kecamatan) **bisa di-copy ke VPS** lewat `scp` atau re-index ulang via scraper EC2. | Lihat task 3.4. Copy lebih cepat (no re-scrape). |

---

## Migration touch points (verified against current `main` HEAD `c4e2efa4`)

| File | Line(s) | Change |
|---|---|---|
| `Dockerfile.api` | 1-14, 24-43, 62-63 | **Hapus stage 1 (Go builder), hapus `chromium`, hapus Node.js (baris 36-38), hapus `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, hapus COPY Go binary (baris 43, 62-63).** Sisanya: python:3.11-slim + torch CPU + sentence-transformers + chromadb + source. |
| `api/src/orchestrator.py` | 93-132 (`ensure_scraped`) | **Rewrite**: ganti subprocess call → HTTP POST ke `${REMOTE_SCRAPER_URL}` dengan header `X-API-Key: ${REMOTE_SCRAPER_API_KEY}`. Simpan response JSON ke `data/raw/<area>/<code>.jsonl` (pertahankan cache layer + `pipeline_data.py` reporting). Pertahankan signature + return shape supaya caller (`load_area`, `run_pipeline_background`, `run_rescrape_background`) tidak berubah. |
| `.env.docker` | 26-28 | Tambah `REMOTE_SCRAPER_URL` + `REMOTE_SCRAPER_API_KEY`. Ganti default `JWT_SECRET` jadi placeholder production. |
| `.env.docker` | 8 | `PUBLIC_API_URL` → URL publik SumoPod (IP / domain). |
| `docker-compose.prod.yml` | (NEW) | Override file untuk production: set `env_file: .env.production`, hapus arg build `PUBLIC_API_URL` (diisi dari env), expose port langsung ke 80/443 kalau perlu. |
| `scripts/docker-startup.sh` | — | Tidak berubah (model e5-small, 1 worker uvicorn). |
| `scripts/setup.sh` | 42-51 | Tidak berubah untuk local dev. Tambah guard: skip `build-scraper.sh` bila `REMOTE_SCRAPER_URL` set (opsional, nice-to-have). |
| `data/` | — | Copy `data/cleaned/` + `data/raw/` (opsional) dari lokal → VPS via `scp`/`rsync`. Atau re-index ulang via EC2 scraper. |
| `services/scraper/` | — | **TIDAK dihapus dari repo.** Tetap di GitHub, tetap dipakai lokal & di EC2. Hanya dikecualikan dari image SumoPod via perubahan `Dockerfile.api`. |

---

## Tasks

### Phase 1 — Decouple scraper dari image API (~1.5 h)

> Image `kos-api` saat ini membawa Chromium (~300 MB) + Node.js (~80 MB) + Go binary (~15 MB) + libnss3 dll (~100 MB). Setelah Phase 1, image ini hanya berisi Python runtime + torch CPU + sentence-transformers. Build time turun drastis.

| ID | Task | Where | Difficulty | Dependencies | Est | Status |
|----|------|-------|------------|--------------|-----|--------|
| 1.1 | Validasi asumsi A1: baca `services/scraper/google-maps-scraper/README` / source, konfirmasi endpoint server mode (path, payload, auth header). `curl` endpoint health + satu scrape test dengan API key. Dokumentasikan payload sample di `docs/sprint-12/reports/scraper-api-contract.md`. | scraper source + remote | Easy | A1 | 0.4 h | ⬜ |
| 1.2 | Rewrite `ensure_scraped()` di `api/src/orchestrator.py:93-132` → HTTP call ke remote scraper. Loop per postal code (sesuai interface scraper), collect JSONL, tulis ke `data/raw/<area>/<code>.jsonl`. Pertahankan cache-first logic (skip bila file fresh < `stale_days`). | `api/src/orchestrator.py` | Medium | 1.1 | 0.5 h | ⬜ |
| 1.3 | Tambah env var baru: `REMOTE_SCRAPER_URL`, `REMOTE_SCRAPER_API_KEY`. Default aman (kosong / fallback ke subprocess untuk local dev). Bila env kosong → raise error jelas di startup, JANGANG silently fall back ke subprocess lama. | `api/src/orchestrator.py`, `.env.docker` | Easy | 1.2 | 0.2 h | ⬜ |
| 1.4 | Tambah unit test untuk `ensure_scraped()` versi HTTP (mock `urllib` / `requests`, verify file ditulis benar + cache hit path). | `api/tests/test_orchestrator_scrape.py` | Easy | 1.2 | 0.3 h | ⬜ |
| 1.5 | Slim `Dockerfile.api`: hapus Go stage, hapus Chromium + Node.js + playwright env, hapus COPY Go binary. Sisanya: `python:3.11-slim` + torch CPU + deps + source. Verify `docker build` sukses. | `Dockerfile.api` | Medium | 1.2 | 0.4 h | ⬜ |

### Phase 2 — Production config & compose (~1 h)

| ID | Task | Where | Difficulty | Dependencies | Est | Status |
|----|------|-------|------------|--------------|-----|--------|
| 2.1 | Buat `.env.production` (gitignored) berisi: `JWT_SECRET` (generate fresh, 32+ char), `PUBLIC_API_URL=http://<SUMOPOD_PUBLIC_IP>` (atau domain bila ada), `REMOTE_SCRAPER_URL=http://32.236.228.8:8080`, `REMOTE_SCRAPER_API_KEY=gms_...`, `LLM_BASE_URL`, `LLM_MODEL=glm-4.5-air`, `EMBED_MODEL=intfloat/multilingual-e5-small`. | `.env.production` (NOT committed) | Easy | A2 | 0.2 h | ⬜ |
| 2.2 | Buat `docker-compose.prod.yml` (override): set `env_file: .env.production`, pertahankan 3 service (geo / api / web), pasang `restart: always`. Tidak mengubah `docker-compose.yml` (local dev tetap utuh). | `docker-compose.prod.yml` | Easy | 2.1 | 0.3 h | ⬜ |
| 2.3 | Update `.dockerignore` agar tidak mengecualikan `Dockerfile.api` (sudah OK), dan pastikan `services/scraper/` tetap ter-copy bila diperlukan oleh proses lain — tidak, setelah 1.5 scraper tidak di-copy ke image. Verify dengan `docker image inspect` ukuran final. | `.dockerignore` | Easy | 1.5 | 0.2 h | ⬜ |
| 2.4 | Smoke test lokal dengan prod compose: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`. Verify 3 container healthy, search mengarah ke remote scraper, `data/raw/` terisi. | local | Medium | 2.2 | 0.3 h | ⬜ |

### Phase 3 — Provisioning VPS SumoPod (~1.5 h)

| ID | Task | Where | Difficulty | Dependencies | Est | Status |
|----|------|-------|------------|--------------|-----|--------|
| 3.1 | SSH ke VPS SumoPod, install Docker Engine + Docker Compose plugin (via `get.docker.com`). Tambah user ke grup `docker`. Verify `docker run hello-world`. | VPS | Medium | A3 | 0.4 h | ⬜ |
| 3.2 | `git clone` repo ke `/opt/rent-house-ai` (atau home user). Checkout branch `feat/deploy-sumopod` setelah merge (atau langsung dari branch selama uji coba). | VPS | Easy | 3.1 | 0.2 h | ⬜ |
| 3.3 | Upload `.env.production` (via `scp`, BUKAN commit) ke VPS. Atur permission `chmod 600`. | VPS | Easy | 2.1, 3.2 | 0.2 h | ⬜ |
| 3.4 | Transfer data kos yang sudah terkumpul ke VPS (PILIH SALAH SATU): (a) **recommended** — `rsync -avz data/cleaned/ user@vps:/opt/rent-house-ai/data/cleaned/` (cepat, no re-scrape); atau (b) re-index ulang via trigger `/pipeline/rescrape` per area (memakai scraper EC2, lambat). | local → VPS | Medium | 3.2 | 0.4 h | ⬜ |
| 3.5 | Build & start: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`. Monitor `docker compose logs -f api` sampai uvicorn ready + model e5-small loaded (~2-5 menit first run untuk download model). | VPS | Medium | 3.3, 3.4 | 0.3 h | ⬜ |

### Phase 4 — Acceptance / smoke tests (~1 h)

| ID | Task | Est | Status |
|----|------|-----|--------|
| 4.1 | Buka `http://<SUMOPOD_PUBLIC_IP>:4000` di browser. Login `admin@kos.ai / admin123`. Verifikasi landing + search page render. | 0.15 h | ⬜ |
| 4.2 | Jalankan 3 search berbeda (satu area baru yang belum ada datanya → trigger remote scraper EC2; satu area yang sudah cached → harusnya cepat; satu POI / radius query). Verifikasi hasil + LLM summary. Cek `data/raw/` terisi untuk area baru. | 0.4 h | ⬜ |
| 4.3 | Cek dashboard `/pipeline`: list area muncul dengan status scraped/processed/indexed benar. Trigger satu action "Index" untuk area yang sudah scraped → harusnya sukses tanpa re-scrape. | 0.2 h | ⬜ |
| 4.4 | Health check endpoint: `curl http://<IP>:4001/health` (lewat port expose) dan `curl http://<IP>:4000/api/health` (lewat nginx proxy). Keduanya 200. | 0.1 h | ⬜ |
| 4.5 | Verifikasi scraper EC2 tidak ter-block dari SumoPod: jalankan satu search di area baru, cek log `kos-api` muncul HTTP POST ke `32.236.228.8:8080` + response 200. | 0.15 h | ⬜ |

### Phase 5 — Hardening & docs (~1 h)

| ID | Task | Est | Status |
|----|------|-----|--------|
| 5.1 | **Wajib**: ganti password admin default (`admin@kos.ai / admin123`) via halaman `/settings` setelah login pertama. Atau seed password kuat via env saat startup. | 0.2 h | ⬜ |
| 5.2 | Firewall VPS: buka hanya port 22 (SSH), 80/443 (HTTP/S untuk masa depan), 4000 (web publik). **Tutup** port 4001 (API) dan 4002 (geo) dari publik — hanya akses internal via docker network. Bila ingin expose API, gunakan reverse proxy nginx + API key. | 0.3 h | ⬜ |
| 5.3 | (Opsional) Whitelist IP SumoPod di security group EC2 scraper AWS — restrict akses port 8080 hanya dari IP SumoPod. | 0.2 h | ⬜ |
| 5.4 | Tulis deployment runbook: `docs/sprint-12/reports/deployment-runbook.md` — langkah reproduce dari VPS kosong sampai live (extract dari task 3.x + 4.x). | 0.3 h | ⬜ |
| 5.5 | Update `README.md` bagian "Quick Start" — tambahkan section "Production deploy" singkat yang link ke runbook. | 0.1 h | ⬜ |

---

## Rollback plan

Jika acceptance tests gagal (search error, scraper EC2 unreachable, OOM, model
load gagal):

1. **Container bermasalah, data aman** → `docker compose ... down`, fix config /
   image, `up -d` lagi. Total downtime < 5 menit.
2. **Image API baru broken** → revert `Dockerfile.api` ke versi `main` (yang
   masih bundle scraper), `docker compose build api`, restart. Ini kembalikan
   subprocess scraper fallback (butuh `services/scraper/` di repo — masih ada).
3. **Scraper EC2 unreachable dari VPS** → fallback sementara: set
   `REMOTE_SCRAPER_URL` kosong + uncomment path subprocess lama (keep sebagai
   feature flag selama 1 sprint sebelum cleanup).
4. **Data corrupt** → restore `data/cleaned/` dari backup lokal (task 3.4
   source). `data/chroma_db/` bisa di-rebuild via `scripts/migrate-to-e5-small.sh`
   atau trigger `/pipeline/index` per area.

Total rollback time: **< 10 menit** bila image lama masih ada di VPS Docker
cache.

---

## Dependency Graph

```
Asumsi A1-A5 ─────────────────────────────────────────┐
                                                       │
Phase 1 — Scraper decouple ────────────────────────────┤
  1.1 ──► 1.2 ──► 1.3 ──► 1.4                          │
                1.2 ──► 1.5                             │
                                                       │
Phase 2 — Prod config ─────────────────────────────────┤
  A2 ──► 2.1 ──► 2.2 ──► 2.4                           │
  1.5 ──► 2.3 ──► 2.4                                  │
                                                       │
Phase 3 — VPS provisioning ────────────────────────────┤
  A3 ──► 3.1 ──► 3.2 ──► 3.3 ──► 3.5                   │
                       3.2 ──► 3.4 ──► 3.5             │
                       2.1 ──► 3.3                     │
                       2.2 ──► 3.5                     │
                                                       │
Phase 4 — Acceptance ──────────────────────────────────┤
  3.5 ──► 4.1 ──► 4.2 ──► 4.3 ──► 4.4 ──► 4.5          │
                                                       │
Phase 5 — Hardening & docs ────────────────────────────┤
  4.x ──► 5.1 ──► 5.2 ──► 5.4 ──► 5.5                  │
  A4 ──► 5.3                                           │
```

---

## Summary

| Phase | Tasks | Est. Hours | Status |
|-------|-------|-----------|--------|
| 0 — Asumsi & verifikasi | 5 (asumsi) | — | ⬜ |
| 1 — Scraper decouple | 5 | ~1.8 h | ⬜ |
| 2 — Prod config & compose | 4 | ~1.0 h | ⬜ |
| 3 — VPS provisioning | 5 | ~1.5 h | ⬜ |
| 4 — Acceptance / smoke | 5 | ~1.0 h | ⬜ |
| 5 — Hardening & docs | 5 | ~1.1 h | ⬜ |
| **Total** | **24** | **~6.4 h** | |

> Effort realistis termasuk debug VPS + network quirks: **0.5-1 hari kerja**.

---

## Open questions (perlu jawaban sebelum Phase 1)

1. **Spec VPS SumoPod** (RAM / CPU / disk / bandwidth)? Wajib ≥ 4 GB RAM untuk
   e5-small resident di memory uvicorn (lihat `scripts/docker-startup.sh:33-36`).
2. **Akses ke panel SumoPod** — bagaimana cara SSH, apakah ada console web,
   berapa IP publik VPS?
3. **API contract scraper EC2** — sudah dikonfirmasi endpoint + payload? Bila
   belum, task 1.1 prioritas tertinggi.
4. **Domain tersedia?** Bila ya, SSL via Let's Encrypt bisa masuk sprint ini
   (tambah ~0.5 h). Bila tidak, deploy via IP cukup untuk demo / beta internal.
5. **Budget LLM (Z.AI)** — deploy publik = potential abuse. Rate limit masih
   belum ada (lihat `docs/deployment-and-scale.md` §1.2 "Tanpa auth / rate
   limiting"). Pertimbangkan tunda publikasi URL atau tambah rate-limit
   middleware minimal (quick win #7).

---

## References

- Repo saat ini: HEAD `c4e2efa4` (Sprint 11 merged)
- Deployment master plan: `docs/deployment-and-scale.md` (cost, scaling roadmap, quick wins)
- Sprint 11 (model migration baseline): `docs/sprint-11/tasks.md`
- Dockerfile.api (sebelum slim): `Dockerfile.api:1-72`
- Scraper integration (sebelum decouple): `api/src/orchestrator.py:93-132`
- Scraper source (untuk verifikasi API contract): `services/scraper/google-maps-scraper/`
- Remote scraper: `http://32.236.228.8:8080` (API key: `gms_87b0e671e4e92e489da3906f20fc4d370e531f08c93378343dd7bec1ee7c8417`)
- VPS target: https://sumopod.com/
