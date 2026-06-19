---
tags:
  - project
  - kos-scraper
  - architecture
  - rag
  - scraping
created: 2026-06-19
updated: 2026-06-19
---

# Kos Scraper Project — Summary & Implementation Plan

> Hasil diskusi Nooku & Athalla tanggal 19 Juni 2026.
> Project: Scraper data kos Indonesia + RAG system untuk pencarian semantik.

---

## 1. Project Overview

**Goal:** Bikin sistem pencarian kos yang intelligent — user bisa query natural language seperti "carik kos di Cengkareng dengan wifi yang tidak lemot" dan dapet jawaban berbasis data review real.

**Two-phase approach:**
1. **Phase 1 — Data Pipeline:** Scrape kos data + reviews dari Google Maps
2. **Phase 2 — RAG System:** Semantic search + LLM answer generation

---

## 2. Components

### 2.1 Google Maps Scraper (Go)

- **Repo:** `https://github.com/gosom/google-maps-scraper` (4.4k stars, MIT license)
- **Clone:** `git clone https://github.com/gosom/google-maps-scraper.git`
- **Local path:** `~/development/google-maps-scraper/`
- **Bahasa:** Go 1.26.3 + Playwright (Chromium headless)
- **Status:** ✅ Cloned, built, tested — works perfectly

**Yang udah dilakuin:**
- Clone repo ke `~/development/google-maps-scraper/`
- Install Go via Homebrew (`go1.26.4 darwin/arm64`)
- Build binary: `go build -o gmaps-scraper .`
- Install Playwright Chromium (otomatis saat first run)
- Test run dengan query "cari kos disekitar 11730" → 20 kos, 160 reviews, 100% success rate, ~18 detik

**Command yang dipake:**
```bash
./gmaps-scraper \
  -input queries.txt \
  -results results.json \
  -json \
  -depth 1 \
  -c 1 \
  -lang id \
  -exit-on-inactivity 5m
```

**Output:** JSON file dengan fields lengkap per kos:
- `title`, `address`, `phone`, `web_site`, `review_rating`, `review_count`
- `reviews_per_rating` (distribution: 1-5 stars)
- `user_reviews` (array of review objects dengan text, rating, name)
- `latitude`, `longitude`, `plus_code`
- `place_id`, `cid`, `data_id`
- `images` (array of photo URLs)
- `street_view_url`
- `open_hours`, `popular_times`
- `category`, `categories`
- `timezone`, `price_range`

### 2.2 Dataset Wilayah Indonesia — Selected: sooluh/kodepos ✅

Setelah evaluasi dua dataset, dipilih **sooluh/kodepos** karena lebih superior untuk use case kita.

#### Perbandingan Dataset

| | teguh02/Wilayah | sooluh/kodepos |
|---|---|---|
| **Entries** | 81,248 | **83,761** |
| **Format** | SQLite + CSV + Excel + SQL | **Single JSON** (837KB) + Fastify API |
| **Koordinat** | ❌ Tidak ada | ✅ **100%** (lat/lon buat semua) |
| **API built-in** | ❌ | ✅ **/search + /detect by coordinates** |
| **Search engine** | Manual SQL | **Fuse.js** (fuzzy search, typo-tolerant) |
| **Geo query** | ❌ Impossible | ✅ **/detect?lat=...&lon=...** |
| **Deploy ready** | ❌ | ✅ Vercel, Koyeb, Render |
| **Naming** | `JAKARTA BARAT` | `Administrasi Jakarta Barat` (prefix administratif) |

**Kenapa sooluh/kodepos menang telak:**
1. **Koordinat untuk semua entries** — memungkinkan sort by distance, radius filter, dan auto-detect kode pos dari lokasi user
2. **API udah jadi** — bisa langsung fork/extend, gak perlu bikin dari nol
3. **Fuse.js fuzzy search** — query "jakarta brat" tetap ketemu "Administrasi Jakarta Barat"
4. **Ringan** — single JSON 837KB vs SQLite database

#### Specs
- **Repo:** `https://github.com/sooluh/kodepos` (Apache 2.0 license)
- **Clone:** `git clone https://github.com/sooluh/kodepos.git`
- **Local path:** `~/development/kodepos/`
- **Data:** `data/kodepos.json` — 83,761 entries, flat JSON array
- **Stack:** Node.js 20+, Fastify 5.x, TypeScript, Fuse.js 7.x

#### Data Structure
```json
{
  "code": 11730,
  "village": "Cengkareng Barat",
  "district": "Cengkareng",
  "regency": "Administrasi Jakarta Barat",
  "province": "DKI Jakarta",
  "latitude": -6.1354743,
  "longitude": 106.7231022,
  "elevation": 9,
  "timezone": "WIB"
}
```

#### Level Hierarki (sooluh naming)
```
Provinsi (38) → Regency/Kota (488) → District/Kecamatan (6,890) → Village/Kelurahan (63,758)
```

**⚠️ Naming convention:** Jakarta dan kota administratif pake prefix `"Administrasi ..."`, kota lain pake prefix `"Kota ..."`. Perlu alias mapping untuk user input natural.

#### Built-in API Endpoints
```bash
# Search by place name (fuzzy)
GET /search?q=cengkareng

# Detect by GPS coordinates
GET /detect?latitude=-6.1354&longitude=106.7231
```

#### Backup Dataset (teguh02/Wilayah) — REMOVED

Dataset teguh02/Wilayah dihapus dari project. Hanya menggunakan sooluh/kodepos untuk menghindari bloated dependencies.

---

## 3. Project Structure & Architecture

### 3.1 Monorepo Layout

```
development/rent-house-ai/
├── services/
│   ├── geo-router/           # Phase 1+2: Location classification + district lookup
│   ├── scraper/              # Phase 3: Go binary + wrapper script
│   ├── data-processor/       # Phase 4: Normalizer + dedup + entity resolution
│   └── rag-engine/           # Phase 5+6: Vector search + ranking + LLM
├── api/                      # Entry point — FastAPI/Fastify (thin orchestration layer)
├── data/                     # Shared data (kodepos.json, config)
└── docker/                   # Dockerfiles, compose
```

### 3.2 Service Responsibilities

#### `services/geo-router/` — Location Intelligence (Phase 1+2)

**Tanggung jawab:**
- Klasifikasi input: AREA administratif vs POI (Point of Interest)
- Lookup district dari regency/kota menggunakan sooluh/kodepos dataset
- Resolve kecamatan → postal codes
- Fuzzy search nama wilayah (typo-tolerant)

**Input/Output:**
```
Input:  "Jakarta Barat" (string)
Output: {
  type: "AREA",
  regency: "Administrasi Jakarta Barat",
  province: "DKI Jakarta",
  districts: ["Cengkareng", "Grogol Petamburan", "Kalideres", ...]
}

Input:  "Cengkareng" (string)
Output: {
  type: "AREA",
  district: "Cengkareng",
  regency: "Administrasi Jakarta Barat",
  province: "DKI Jakarta",
  postal_codes: [11710, 11720, 11730, 11740, 11750],
  villages: [
    {name: "Cengkareng Barat", code: 11730, lat: -6.135, lon: 106.723},
    ...
  ]
}

Input:  "Stasiun Duri" (string)
Output: {type: "POI", name: "Stasiun Duri"}
```

**Tech:** Node.js (reuse sooluh/kodepos Fastify API) atau Python dengan Fuse.js equivalent

#### `services/scraper/` — Google Maps Scraper (Phase 3)

**Tanggung jawab:**
- Terima list postal codes atau POI queries
- Generate query variants: "kos di 11730", "kost di 11730", "kosan di 11730"
- Jalankan Go binary secara parallel untuk 3 variants sekaligus
- Return raw JSON results

**Input/Output:**
```
Input:  postal_codes: [11730] atau poi_query: "Stasiun Duri"
Output: raw JSON array of kos entries (dengan reviews, coords, rating, dll)
```

**Tech:** Go binary (google-maps-scraper) + shell/Python wrapper untuk parallel execution

#### `services/data-processor/` — Data Cleaning (Phase 4)

**Tanggung jawab:**
- Parse raw scraper output
- Normalize names, addresses, phone numbers
- Dedup berdasarkan place_id atau koordinat
- Extract facilities dari review text
- Validate koordinat
- Output clean chunks siap untuk RAG

**Input/Output:**
```
Input:  raw JSON dari scraper
Output: clean kos documents:
  {
    name, address, phone, rating, review_count,
    postal_code, latitude, longitude,
    facilities: ["wifi", "ac", "parkir"],
    reviews: [{text, rating, author}],
    place_id
  }
```

**Tech:** Python (pandas/collections) atau Node.js

#### `services/rag-engine/` — Semantic Search & Ranking (Phase 5+6)

**Tanggung jawab:**
- Ingest clean documents → embeddings → vector DB
- Semantic retrieval berdasarkan query user
- Geo filtering (distance calculation pake haversine)
- Ranking: distance + rating + review quality + facility match
- LLM summarization untuk final response

**Input/Output:**
```
Input:  query: "kos di Cengkareng wifi tidak lemot", user_coords?: {lat, lon}
Output: ranked recommendations + LLM explanation
```

**Tech:** Python (LangChain/ChromaDB) atau Node.js

#### `api/` — Entry Point (Thin Layer)

**Tanggung jawab:**
- Terima HTTP request dari user
- Orchestrate: geo-router → scraper → data-processor → rag-engine
- Manage conversation state (user picking district, follow-up questions)
- Return formatted response

**Tech:** FastAPI (Python) atau Fastify (Node.js) — decision tergantung bahasa mayoritas services

### 3.3 Data Flow (End-to-End)

```
User prompt: "Carikan kosan di Jakarta Barat"
         │
         ▼
    api/ (orchestrator)
         │
         ▼
    services/geo-router/
    → detect "Jakarta Barat" = AREA (regency level)
    → list districts: [Cengkareng, Kalideres, ...]
    → return list to user via api/
         │
    user picks: "Cengkareng"
         │
         ▼
    services/geo-router/
    → resolve Cengkareng → postal_codes: [11710, 11720, 11730, ...]
         │
         ▼
    services/scraper/
    → generate: "kos di 11730", "kost di 11730", "kosan di 11730"
    → run Go binary (parallel)
    → return raw JSON
         │
         ▼
    services/data-processor/
    → normalize, dedup, extract facilities
    → return clean kos documents
         │
         ▼
    services/rag-engine/
    → ingest to vector DB (if not cached)
    → (on query) semantic search + geo filter + ranking
    → return ranked results
         │
         ▼
    api/
    → format response for user
```

### 3.4 Why This Structure (Decision Rationale)

1. **Separation of concerns** — tiap service punya tanggung jawab tunggal, gampang di-test isolated
2. **Phase-aligned** — tiap service map langsung ke phase di PRD (Section 12)
3. **Tech-agnostic per service** — scraper pake Go (performa), processor pake Python (data manipulation), router pake Node (reuse kodepos API)
4. **`api/` sebagai thin orchestrator** — bukan god object, cuma routing + state management
5. **Shared `data/`** — kodepos.json dipake bareng, gak duplikasi

---

## 4. Key Architectural Decisions

### 4.1 Scraper Technology: Go (NOT Rebuild ke JS/Python)

**Decision:** Pakai Go binary apa adanya, jangan rebuild.

**Reasoning:**
- Single binary, cross-compile ke Linux, gak perlu runtime
- Udah battle-tested dengan anti-detection, cookie consent, retry logic
- 11k LOC, 111 files — rebuilding butuh 2-3 hari untuk feature parity
- Go lebih server-friendly daripada Python/JS (low memory, single binary)
- Actively maintained, support Go 1.26.3

### 4.2 Grid Expand Strategy (NOT Direct Scrape)

**Decision:** Saat user query area luas (kota/provinsi), expand ke kecamatan level sebelum scraping.

**Reasoning:**
- Google Maps return max ~120 results per search query
- "Kos di Jakarta Barat" → hanya ~120 kos dari ribuan yang ada
- "Kos di Cengkareng", "Kos di Tambora", dst → setiap query buka pool 120 kos baru
- Jakarta Barat punya 12 kecamatan → 12 × 120 = ~1,440 potensi results

**Logic:**
```python
if input_is_city_level:
    expand_to_kecamatan()  # multi-query scrape
elif input_is_kecamatan_level:
    direct_query()         # single query scrape
```

Dataset wilayah berfungsi sebagai **query planner**, bukan query replacer.

### 4.3 RAG System untuk Semantic Search

**Decision:** Build RAG system untuk enable query seperti "kos dengan wifi tidak lemot".

**Reasoning:**
- Data review udah ter-scrape dengan text lengkap (160 reviews dari 20 kos)
- Review text mengandung info qualitatif yang gak bisa di-filter dengan SQL biasa
- Contoh: review "wifi sangat lambat" vs "wifi lancar" — butuh understanding semantik

**Bukti dari data scrape (query "wifi tidak lemot"):**

Kos dengan wifi bagus:
- Rosetta kost — "Wifi-nya lancar pokonya Bagus bgt"
- Kost Uncle Dee — "Wifi lancar. Kamar nyaman, kedap suara"
- Kost Cengkareng — "wifi kenceng. Lokasi strategis"

Kos dengan wifi jelek:
- Rukita Cendrawasih — "wifi sangat lambat dan air sering mati"
- Kost IMIGRAHA — "wifi nya sangat lemot"
- Kost AsterKing — "Wifi ada tapi sangat sangat lemah"

---

## 5. Deployment Plan (Backlog — Belum Dieksekusi)

> Simpan dulu, belum eksekusi. Athalla belum pernah deploy BE ke production.

### 5.1 Target Platform: AWS EC2

- **Region:** Singapore (`ap-southeast-1`) — terdekat untuk Indonesia
- **Instance type:** `t3.micro` (free tier, 1GB RAM) atau `t3.small` (2GB, ~$15/bln)
- **OS:** Ubuntu 24.04 LTS
- **Storage:** 20GB gp3

**Resource requirements:**
- Chromium headless: ~500MB RAM per process
- Scraper binary + wrapper: minimal
- `t3.micro` (1GB): cukup buat 1 concurrent scrape
- `t3.small` (2GB): cukup buat 2-3 concurrent scrapes

### 5.2 Deployment Steps (Saat Dieksekusi Nanti)

1. Launch EC2 instance via AWS Console
2. Setup Security Group: SSH (port 22) + API (port 8080)
3. SSH ke server, install dependencies:
   - Go runtime (atau cross-compile binary di mesin lokal)
   - Chromium dependencies untuk headless
4. Copy binary + dataset wilayah (SQLite)
5. Deploy API wrapper (Python FastAPI atau Go native)
6. Setup systemd service untuk auto-restart

### 5.3 Concurrency Model: Sequential (Skenario A)

- 1 binary instance, 1 Chromium process
- Request diproses satu per satu (queue)
- RAM flat ~500MB regardless of user count
- 3 user barengan: ~54 detik (acceptable untuk low traffic)
- flag `-c 2-3` buat internal concurrency (2-3 kos di-scrape paralel per search query)

---

## 6. RAG Architecture (Phase 2)

### 6.1 Data Flow

```
┌─────────────────────────────────────────────────────┐
│ 1. INGESTION (one-time / scheduled)                 │
│                                                     │
│  Scraper → Reviews + Metadata → Embedding → Vector DB│
│  (per kecamatan, grid expand)                       │
└─────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────┐
│ 2. QUERY TIME                                        │
│                                                     │
│  User: "kos di Cengkareng, wifi tidak lemot"         │
│          │                                           │
│          ▼                                           │
│  Embed query → Vector search                        │
│          │                                           │
│          ▼                                           │
│  Top-K reviews + kos info                           │
│          │                                           │
│          ▼                                           │
│  LLM (summarize + recommend)                        │
│          │                                           │
│          ▼                                           │
│  "Berikut 5 kos dengan wifi bagus di Cengkareng..."  │
└─────────────────────────────────────────────────────┘
```

### 6.2 Components

| Komponen | Teknologi (recommended) | Fungsi |
|----------|------------------------|--------|
| Scraper | Go binary (existing) | Ambil data + reviews dari Google Maps |
| Query Planner | Node.js + sooluh/kodepos API | Expand query kota → kecamatan + detect level |
| Vector DB | Qdrant / Chroma / Pinecone | Simpan embedding reviews |
| Embedding Model | OpenAI text-embedding-3-small (atau local sentence-transformers) | Convert text → vector |
| LLM | GPT-4o-mini / Claude / local Llama | Jawab pertanyaan user dengan summarize + recommend |
| API Server | Python FastAPI atau Node.js Fastify | HTTP endpoint untuk query |

### 6.3 Deep Review Scraping

Default scraper hanya ambil ~8 review per kos (160 dari 20 kos). Untuk RAG quality, butuh lebih banyak.

**Config untuk deep scrape:**
```bash
./gmaps-scraper \
  -input queries.txt \
  -results deep_results.json \
  -json \
  -depth 5 \
  -extra-reviews \
  -c 2 \
  -lang id
```

Estimasi: 50-200+ reviews per kos, total 5,000+ reviews untuk 20 kos.

### 6.4 Open Questions (Perlu Decision Saat Build)

1. **Embedding model:** OpenAI (bayar, best quality untuk Indonesia) vs local (gratis, butuh tuning)?
2. **LLM:** OpenAI/Anthropic API (bayar, simple) vs local Llama (gratis, butuh GPU)?
3. **Data scope:** Cengkareng only untuk MVP, atau seluruh Jakarta?

---

## 8. Repo Clone Guide (Device-Agnostic)

> Untuk setup di device baru (bukan komputer Hermes). Clone semua repo yang dibutuhkan.

### Prerequisites

```bash
# macOS
brew install go node python

# Linux (Ubuntu/Debian)
# Go: https://go.dev/doc/install
# Node 20+: https://nodejs.org/en/download
# Python 3.11+: https://www.python.org/downloads/
```

### Clone All Repos

```bash
mkdir -p ~/development && cd ~/development

# 1. Scraper (Go)
git clone https://github.com/gosom/google-maps-scraper.git

# 2. Dataset wilayah (Node.js)
git clone https://github.com/sooluh/kodepos.git

# 3. Project monorepo (akan dibuat)
# mkdir rent-house-ai && cd rent-house-ai
```

### Build Scraper Binary

```bash
cd ~/development/google-maps-scraper
go build -o gmaps-scraper .

# Install Playwright Chromium (first run)
PLAYWRIGHT_INSTALL_ONLY=1 ./gmaps-scraper
# atau
go run github.com/playwright-community/playwright-go/cmd/playwright@latest install chromium
```

### Test Scraper

```bash
echo "cari kos disekitar 11730" > queries.txt

DISABLE_TELEMETRY=1 ./gmaps-scraper \
  -input queries.txt \
  -results test_results.json \
  -json \
  -depth 1 \
  -c 1 \
  -lang id \
  -exit-on-inactivity 5m
```

**Expected:** ~20 kos entries, ~160 reviews, ~18 detik, 100% success rate.

### Test Kodepos API (optional)

```bash
cd ~/development/kodepos
npm install
npm run dev
# API available at http://localhost:3000
# Test: curl 'http://localhost:3000/search?q=cengkareng'
```

---

## 9. Scraper CLI Reference

### Flag Reference

| Flag | Default | Function |
|------|---------|----------|
| `-input` | — | Path ke file berisi queries (1 per line) |
| `-results` | — | Output file path |
| `-json` | false | Output format JSON (vs CSV) |
| `-depth` | 1 | Scroll depth (1 = cepat, 5+ = dalam) |
| `-c` | 1 | Concurrency internal (jumlah place di-scrape paralel) |
| `-lang` | en | Language code (`id`, `en`, dll) |
| `-exit-on-inactivity` | — | Timeout jika tidak ada activity (contoh: `5m`) |
| `-extra-reviews` | false | Scrape semua reviews (bukan hanya top 8) |

### Concurrency (`-c`) vs Memory

| `-c` | Speed | RAM | Risk |
|------|-------|-----|------|
| 1 | Slow | ~500MB | Safe |
| 4 | 4× faster | ~800MB-1GB | Still safe |
| 8 | 8× faster | ~1.5-2GB | Needs RAM |
| 16 | Very fast | ~3-4GB | Heavy, rate-limit risk |

**Sweet spot untuk t3.micro (1GB):** `-c 2` atau `-c 3`

### Lang Flag

`-lang id` penting untuk hasil yang relevant. Tanpa ini, search default ke English dan hasilnya kurang akurat untuk konteks Indonesia. Review text tetap dalam bahasa aslinya.

---

## 10. File Locations

| Item | Path |
|------|------|
| Scraper binary | `~/development/google-maps-scraper/gmaps-scraper` |
| Scraper source | `~/development/google-maps-scraper/` |
| Test results (JSON) | `~/development/google-maps-scraper/results2.json` |
| Test results (CSV) | `~/development/google-maps-scraper/results2.csv` |
| Query file | `~/development/google-maps-scraper/queries.txt` |
| Dataset wilayah | `~/development/kodepos/` |
| Dataset JSON data | `~/development/kodepos/data/kodepos.json` |

---

## 11. Next Steps

### Phase 1: Data Pipeline (MVP)
1. [ ] Bikin deep scrape script (query planner + grid expand)
2. [ ] Scrape Cengkareng area lengkap dengan `-depth 5 -extra-reviews`
3. [ ] Parse + clean data, siapkan untuk vector DB

### Phase 2: RAG Prototype
1. [ ] Setup vector DB ( Chroma recommended untuk simplicity)
2. [ ] Build ingestion script (reviews → embeddings → vector DB)
3. [ ] Build FastAPI endpoint untuk semantic search
4. [ ] Integrate LLM untuk answer generation

### Phase 3: Deployment
1. [ ] Build Docker image (Go binary + Chromium + Python API)
2. [ ] Deploy to AWS EC2
3. [ ] Setup systemd / Docker Compose
4. [ ] Production test dengan multiple users

---

## 12. Related

- [[Google Maps Scraper - Deep Dive]] — Analisis arsitektur codebase scraper
- sooluh/kodepos: https://github.com/sooluh/kodepos
- Scraper repo: https://github.com/gosom/google-maps-scraper

---

*Documented by Nooku — 2026-06-19*
