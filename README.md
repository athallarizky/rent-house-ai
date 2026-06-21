# Google Maps Scraper — SaaS Mode (Standalone Deployment)

> Service scraper Google Maps terpisah dari Kos AI monorepo. Berjalan sebagai
> service SaaS dengan REST API + admin dashboard + worker pool (Chromium-based).
> Didesign untuk di-deploy di server/VPS manapun secara isolated.

[![deploy](https://img.shields.io/badge/deploy-EC2%2FVPS-blue)](docs/deployment.md)
[![docker](https://img.shields.io/badge/docker-compose-ec2-2496ED)](services/scraper/google-maps-scraper/docker-compose.ec2.yaml)

---

## Apa ini?

Branch `services/scraper` berisi **hanya service scraper** (Google Maps data
acquisition), terpisah dari aplikasi Kos AI utama. Tujuannya:

- ✅ Bisa di-deploy di server terpisah (EC2/VPS manapun)
- ✅ Bebas dependency ke kos-api/kos-web/kos-geo
- ✅ Resource (RAM/CPU) ter-isolated — Chromium heavy load nggak ganggu app lain
- ✅ Bisa di-scale horizontal (multi-instance worker)

## Arsitektur

```
                     Internet
                         │
                ┌────────▼────────┐
                │  gmapssaas      │  ← REST API + admin dashboard (:8080)
                │     serve       │     Auth: API Key (Bearer gms_xxx)
                └────────┬────────┘
                         │
                ┌────────▼────────┐
                │   Postgres      │  ← Job queue (River) + results + admin users
                └────────┬────────┘
                         │
                ┌────────▼────────┐
                │  gmapssaas      │  ← Worker (Chromium headless)
                │     worker      │     Concurrency configurable
                └─────────────────┘
```

## Komponen utama

| Komponen | Lokasi | Fungsi |
|----------|--------|--------|
| **Go source** | `services/scraper/google-maps-scraper/` | Binary `gmapssaas` (serve + worker + admin) |
| **Dockerfile** | `.../Dockerfile.saas` | Multi-stage build (Go builder + Debian runtime) |
| **Compose EC2** | `.../docker-compose.ec2.yaml` | Production compose: postgres + serve + worker |
| **Migrations** | `.../migrations/` | SQL migrations (auto-applied via sql-migrate) |
| **Admin dashboard** | `.../admin/templates/` | Web UI (login, jobs, workers, API keys, terminal) |

## Quick start

### 1. Prerequisite

- Linux server (Ubuntu 24.04 LTS recommended)
- Docker + Docker Compose v2
- Minimum: 2 GB RAM + 2 GB swap, 20 GB disk
- Recommended: 4 GB RAM, 2 vCPU, Singapore region (untuk target Indonesia)

### 2. Setup environment

```bash
# Generate secrets
ENCRYPTION_KEY=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)

# Write .env.saas
cat > services/scraper/google-maps-scraper/.env.saas << EOF
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
DATABASE_URL=postgres://postgres:$POSTGRES_PASSWORD@postgres:5432/gmaps_pro?sslmode=disable
ENCRYPTION_KEY=$ENCRYPTION_KEY
CONCURRENCY=1
MAX_JOBS_PER_CYCLE=100
EOF

chmod 600 services/scraper/google-maps-scraper/.env.saas
```

> ⚠️ **Wajib backup `ENCRYPTION_KEY`**. Kalau hilang, data terenkripsi di DB
> nggak bisa di-decrypt lagi → data hilang permanen.

### 3. Build & start

```bash
cd services/scraper/google-maps-scraper

# Bikin alias biar singkat
echo "alias dc='cd $(pwd) && docker compose -f docker-compose.ec2.yaml --env-file .env.saas'" >> ~/.bashrc
source ~/.bashrc

dc build         # 5-15 menit
dc up -d         # Start 3 container
dc ps            # Verify healthy
```

### 4. Run DB migration

```bash
PP=$(grep POSTGRES_PASSWORD .env.saas | cut -d= -f2)
cat > /tmp/dbconfig.yml << EOF
development:
  dialect: postgres
  datasource: postgres://postgres:$PP@postgres:5432/gmaps_pro?sslmode=disable
  dir: migrations
  table: migrations
EOF

docker run --rm \
  --network gmaps-saas_saas-net \
  -v "$PWD/migrations:/work/migrations" \
  -v "/tmp/dbconfig.yml:/work/dbconfig.yml" \
  -w /work \
  golang:1.24-alpine sh -c '
    go install github.com/rubenv/sql-migrate/sql-migrate@latest &&
    $(go env GOPATH)/bin/sql-migrate up -config=dbconfig.yml
  '

rm /tmp/dbconfig.yml
```

### 5. Create admin user

```bash
dc exec serve /app/gmapssaas admin create-user -u admin -p 'YOUR_PASSWORD'
```

### 6. Akses dashboard

```
http://SERVER_IP:8080/
```

Login dengan username/password yang baru dibuat.

## Environment variables

Lihat [`.env.saas.example`](.env.saas.example) untuk template lengkap.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `POSTGRES_PASSWORD` | ✅ | — | Password postgres |
| `DATABASE_URL` | ✅ | — | DSN untuk serve & worker |
| `ENCRYPTION_KEY` | ✅ | — | 32-byte hex (generate via `openssl rand -hex 32`) |
| `CONCURRENCY` | — | `1` | Worker concurrency ( Chromium instances) |
| `MAX_JOBS_PER_CYCLE` | — | `100` | Restart worker setiap N jobs |
| `PROXIES` | — | — | Comma-separated proxy URLs (highly recommended for production) |
| `FAST_MODE` | — | `false` | Stealth HTTP mode (faster but easier to block) |

## Security

Service ini punya **3 lapis auth built-in**:

1. **API Key** (REST API `/api/v1/*`) — `Authorization: Bearer gms_xxx`
2. **Session + 2FA** (admin dashboard `/admin/*`)
3. **Rate limiting** per user/IP

Plus yang harus kamu set sendiri:
- **AWS Security Group / firewall** — restrict port 8080 ke IP whitelist
- **HTTPS** — via Caddy/nginx + Let's Encrypt (kalau pakai domain)
- **Proxy residensial** — untuk cegah IP block Google (Webshare, Bright Data)

## API endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/scrape` | Submit scrape job |
| `GET` | `/api/v1/jobs` | List jobs (pagination) |
| `GET` | `/api/v1/jobs/{id}` | Get job status + results |
| `DELETE` | `/api/v1/jobs/{id}` | Delete job |
| `GET` | `/api/v1/health` | Health check |

Swagger docs: `http://SERVER_IP:8080/swagger/index.html`

## Operations

```bash
# Lihat log
dc logs -f
dc logs -f serve
dc logs -f worker

# Restart
dc restart serve

# Stop semua
dc down

# Backup DB
dc exec postgres pg_dump -U postgres gmaps_pro > backup_$(date +%F).sql

# Update code
git pull && dc build && dc up -d
```

## Documentation

- **Deployment guide lengkap** — ada di vault Obsidian `reference/deploy-scraper-to-ec2.md`
- **RCA setup (8 issues + solutions)** — `rca/2026-06-21 RCA - Kos AI Scraper EC2 Deployment.md`
- **Risk & mitigation scraping di AWS** — `reference/scraping-on-aws-ec2.md`

## Upstream

Based on [gosom/google-maps-scraper](https://github.com/gosom/google-maps-scraper)
with SaaS layer (admin dashboard, REST API, job queue, multi-user).

## License

Following upstream: see `services/scraper/google-maps-scraper/LICENSE`.
