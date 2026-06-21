# Deployment Runbook — Sprint 12 (SumoPod VPS)

> Generated: 2026-06-21 | Live deploy verified

---

## 1. Live Endpoint

| Item | Value |
|---|---|
| **URL** | http://43.157.212.235:4000 |
| **Login email** | `admin@kos.ai` |
| **Login password** | Stored on VPS at `/home/ubuntu/.ADMIN_CREDENTIALS` (chmod 600). SSH in and `cat` it. Default `admin123` was rotated to a random 20-char string on deploy. |
| **Public ports** | Only `4000` (web). `4001` (api) and `4002` (geo) are NOT published. |
| **API access** | Via nginx proxy only: `http://43.157.212.235:4000/api/*` |

---

## 2. Architecture Deployed (3 containers)

```
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
  ├── kos-geo  (Node.js Fastify)  internal :3001   area name resolution
  ├── kos-api  (Python FastAPI)    internal :8080   orchestrator + RAG + data-processor
  └── kos-web  (nginx + Astro)     0.0.0.0:4000     frontend + reverse proxy /api/
```

**Scraper tidak ada di image `kos-api`** — dijalankan eksternal di EC2. Koneksi
via `REMOTE_SCRAPER_URL` + `REMOTE_SCRAPER_API_KEY` di `.env.production`.

---

## 3. ⚠️ CRITICAL ISSUE — VPS tidak bisa reach EC2 scraper

### Gejala
- Dari Mac/local: `curl http://32.236.228.8:8080/health` → 200 OK ✓
- Dari VPS SumoPod (Tencent, Jakarta): TCP timeout + ICMP 100% packet loss ✗
- Scraper_client di VPS **fail-fast** setelah ~120s (timeout 8s × 15 job submissions)

### Dampak
- Search di area **sudah ter-index** (Cengkareng: 120 kos) → **WORKS** (tidak butuh scraper)
- Search di area **baru** (belum di-scrape) → pipeline scraping gagal. User harus
  pre-load data (lihat §5) atau fix network issue (lihat §4).

### Penyebab (perlu investigasi user)
IP `32.236.228.8` ada di range `30.0.0.0/8` (allocated US DoD). Kemungkinan:
1. **AWS security group** hanya allow IP tertentu (rumah/kantor user) — paling likely
2. Routing issue antara Tencent (SumoPod) ↔ ISP tujuan
3. Geo-blocking

---

## 4. Fix untuk Network Blocker (RECOMMENDED, oleh user)

Pilih salah satu:

### Opsi A — Whitelist IP VPS di AWS Security Group (paling likely fix)
1. Login AWS Console → EC2 → Security Groups
2. Cari security group instance scraper (`32.236.228.8`)
3. Inbound rules → Edit → Add rule:
   - Type: Custom TCP, Port: `8080`, Source: `43.157.212.235/32` (IP VPS SumoPod)
4. Save. Test dari VPS: `curl -m 8 http://32.236.228.8:8080/health`

### Opsi B — Gunakan domain/proxy yang reachable
Jika EC2 punya domain (bukan IP), coba resolve. Atau pasang Cloudflare/proxy.

### Setelah fix, test dari VPS:
```bash
ssh ubuntu@43.157.212.235
curl -m 8 -H "X-API-Key: gms_..." http://32.236.228.8:8080/api/v1/health
# expect {"status":"ok"}
```
Lalu search area baru via UI — pipeline akan scrape otomatis.

---

## 5. Workaround saat ini — Pre-scrape dari Mac (yang bisa reach EC2)

Untuk menambah area baru selama network blocker belum di-fix:

```bash
# 1. Di Mac (bisa reach EC2), edit /var/folders/.../scrape_from_mac.py
#    ganti CODES + OUT_DIR sesuai area, jalankan:
cd ~/development/rent-house-ai
python3 /tmp/scrape_from_mac.py   # butuh ~15-20 menit per area

# 2. Upload ke VPS:
sshpass -p '...' scp data/raw/<Area>/*.jsonl \
  ubuntu@43.157.212.235:/home/ubuntu/rent-house-ai/data/raw/<Area>/

# 3. Trigger process+index via UI (login → search area tsb).
#    Scrape akan skip (cached), langsung process+index.
```

Cengkareng sudah pre-loaded dengan cara ini: 164 raw → 125 processed → 120 indexed.

---

## 6. Konfigurasi LLM (Z.AI) — perlu di-set oleh user

Search saat ini pakai **fallback format** (list, bukan LLM summary) karena
Z.AI API key belum dikonfigurasi di server.

Cara set:
1. Buka http://43.157.212.235:4000/settings (login admin)
2. Isi: provider=Z.AI, model=glm-4.5-air, base_url (default), api_key (Z.AI key)
3. Click "Test" → harus "ok"
4. Save

Setelah ini, search akan menghasilkan summary natural language dari LLM.

---

## 7. Common Operations (di VPS)

```bash
# SSH
ssh ubuntu@43.157.212.235

# Status container
cd /home/ubuntu/rent-house-ai
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps

# Logs
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f web

# Restart
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart api

# Stop semua
docker compose -f docker-compose.yml -f docker-compose.prod.yml down

# Update kode (dari Mac): rsync perubahan + rebuild
#   scp file yg berubah, lalu:
docker compose -f docker-compose.yml -f docker-compose.prod.yml build api
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d api

# Memory check (RAM 1.9GB + swap 5.9GB)
free -h
docker stats --no-stream
```

---

## 8. File lokasi di VPS

| Path | Isi |
|---|---|
| `/home/ubuntu/rent-house-ai/` | Repo (clone via tar from Mac, bukan git) |
| `/home/ubuntu/rent-house-ai/.env.production` | Creds (chmod 600, TIDAK di-commit ke git) |
| `/home/ubuntu/rent-house-ai/data/raw/Cengkareng/*.jsonl` | Cache scrape (164 entries) |
| `/home/ubuntu/rent-house-ai/data/chroma_db/` | Vector DB (120 docs Cengkareng) |
| `/home/ubuntu/.ADMIN_CREDENTIALS` | Password admin baru (chmod 600) |
| `/swapfile` | 4GB swap (dibuat saat deploy, auto-mount via fstab) |

---

## 9. Specs & Limitations

- **VPS**: Ubuntu 24.04, 2 vCPU, RAM 1.9 GB + swap 5.9 GB, disk 40 GB
- **uvicorn**: 1 worker (RAM terbatas — multi-worker akan OOM karena model
  e5-small ter-resident di tiap worker)
- **Concurrent capacity**: ~5-10 users (single worker + embedded ChromaDB)
- **Embedding model**: `intfloat/multilingual-e5-small` (449 MB, 384-dim)
- **First search area baru**: lambat (~15-20 menit untuk scrape 5 postal codes
  via EC2), berikutnya instan (cached)

---

## 10. Sprint 12 deliverables status

| Phase | Task | Status |
|---|---|---|
| 1.2 | Rewrite `ensure_scraped()` → HTTP scraper_client | ✅ |
| 1.5 | Slim Dockerfile.api.prod (no Chromium/Go/Node) | ✅ |
| 2 | docker-compose.prod.yml + .env.production | ✅ |
| 3.1 | Install Docker di VPS | ✅ |
| 3.2-3.3 | Transfer kode + .env.production | ✅ |
| 3.5 | Build & start 3 container | ✅ |
| 4 | Smoke test (search end-to-end) | ✅ (Cengkareng 120 docs) |
| 5.1 | Ganti password admin default | ✅ (rotated) |
| 5.2 | Firewall (close 4001/4002) | ✅ (!reset ports) |
| 5.3 | Whitelist IP VPS di EC2 | ❌ BLOCKER — butuh user (AWS console) |
| 5.4 | Deployment runbook (file ini) | ✅ |

---

## 11. Files changed di repo (local, NOT committed — user review dulu)

| File | Change |
|---|---|
| `api/src/scraper_client.py` | NEW — HTTP client untuk remote scraper EC2 |
| `api/src/orchestrator.py` | Dispatch ensure_scraped() → scraper_client bila REMOTE_SCRAPER_URL set |
| `Dockerfile.api.prod` | NEW — slim image tanpa Chromium/Go/Node |
| `docker-compose.prod.yml` | NEW — override untuk prod (no public ports api/geo) |
| `.env.production` | NEW — creds prod (gitignored, tidak di-commit) |
| `.gitignore` | Tambah `.env.production` |
| `docs/sprint-12/tasks.md` | Sprint doc |
| `docs/sprint-12/reports/deployment-runbook.md` | File ini |

**Tidak ada yang di-commit ke git.** Semua perubahan ada di working tree lokal
+ sudah di-transfer ke VPS via scp/rsync. User review dulu, lalu commit manual.
