# Data Design — Kos Scraper + RAG

> Scraper output format, data processor pipeline, and RAG document model.
> Sprint 1 — June 2026

---

## 1. Go Scraper Output Format

### Format

**JSON Lines (JSONL)** — one complete JSON object per line. NOT a JSON array.

Each line is a full `Entry` struct from the gosom/google-maps-scraper Go binary. Output is controlled via `-json` flag.

### Key Fields — `Entry` Struct

| Field              | Type             | Notes                                              |
|--------------------|------------------|-----------------------------------------------------|
| `title`            | string           | Kos name                                            |
| `address`          | string           | Full address string                                 |
| `place_id`         | string           | Google Place ID — **primary dedup key**              |
| `latitude`         | float64          |                                                      |
| `longtitude`       | float64          | ⚠️ Misspelled key. `longitude` also present (duplicate) |
| `longitude`        | float64          | ⚠️ Same value as `longtitude` — backward compat       |
| `review_rating`    | float64          | Overall rating (1-5)                                 |
| `review_count`     | int              | Total review count                                   |
| `reviews_per_rating` | map[int]int    | Distribution: `{"1": 3, "2": 0, "3": 5, ...}`        |
| `phone`            | string           | Raw phone string                                     |
| `web_site`         | string           | Website URL                                          |
| `complete_address` | object           | Structured: `{borough, street, city, postal_code, state, country}` |
| `user_reviews`     | []Review         | ~5-10 inline reviews (**always present**)             |
| `user_reviews_extended` | []Review    | ~300 paginated reviews (**only with `-extra-reviews`**) |
| `category`         | string           | Primary category                                     |
| `categories`       | []string         | All categories                                       |
| `images`           | []Image          | Photo URLs                                           |
| `plus_code`        | string           | Google Plus Code                                     |
| `data_id`          | string           | Google data ID (hex)                                 |
| `cid`              | string           | Google CID                                           |
| `open_hours`       | map              | Opening hours (unlikely for kos)                     |
| `price_range`      | string           | Price indicator                                      |

### Review Struct — ⚠️ Mixed PascalCase/snake_case

The Go struct has NO json tags on legacy fields, so they serialize as PascalCase. Extended fields use explicit snake_case tags.

```json
{
    "Name": "E. Ö.",                  // PascalCase (no json tag)
    "ProfilePicture": "...",          // PascalCase
    "Rating": 1,                      // PascalCase, integer
    "Description": "WiFi lambat...",  // PascalCase — THE REVIEW TEXT
    "Images": [],                     // PascalCase
    "When": "2 months ago",           // PascalCase

    "review_id": "Ci9DQUl...",        // snake_case (has json tag)
    "source": "Google",               // snake_case
    "rating_scale": 5,
    "rating_float": 1.0,
    "language": "id",                 // snake_case
    "text_original": "...",           // snake_case
    "text_translated": "...",         // snake_case
    "posted_at_unix_micros": 177...,  // snake_case
    "published_at": "2026-02-26T..."  // snake_case

    // Reply fields (if management replied):
    "reply_text": "...",              // snake_case, omitempty
    "reply_text_original": "...",
    "reply_posted_at_unix_micros": ...
}
```

**Key rule for parser:** Both `Description` (PascalCase) and `text_original` (snake_case) contain the review text. Use `Description` as primary; fallback to `text_original` if Description is empty.

### What Each Flag Does (With Phase 0 Findings)

| Flag               | Effect                                                                 |
|---------------------|------------------------------------------------------------------------|
| `-json`             | Output JSON Lines instead of CSV                                       |
| `-results /path`    | Write to file (default: stdout)                                        |
| `-depth 1`          | Scroll depth 1 — finds ~20 places. **Sufficient for MVP.**              |
| `-extra-reviews`    | **NOT USED.** RPC API returns empty for Indonesian listings. DOM fallback only adds 3 reviews at 30x time cost. |
| `-c 1`              | Internal concurrency — 1 place at a time (safe for local)              |
| `-lang id`          | Language code passed to Google (`hl=id`)                               |
| `-exit-on-inactivity 5m` | Timeout if no scraping activity                                    |

### Phase 0 Findings Summary

- **8 reviews/kos** (shallow, `-depth 1`, no `-extra-reviews`)
- `user_reviews_extended` is always empty `[]` in shallow mode
- **RPC API non-functional** for Indonesian kos — only DOM fallback works
- 20 kos from single query "kos di 11730" in ~18 seconds
- 100% success rate
- 10% of entries missing `postal_code` in `complete_address`

### Output Example (One JSONL Entry)

```json
{
  "title": "Kost Cengkareng Indah",
  "address": "Jl. Cendrawasih No.15, Cengkareng Barat, Cengkareng, Jakarta Barat",
  "place_id": "ChIJ1234...",
  "latitude": -6.1354743,
  "longtitude": 106.7231022,
  "longitude": 106.7231022,
  "review_rating": 4.2,
  "review_count": 35,
  "reviews_per_rating": {"1": 2, "2": 3, "3": 5, "4": 10, "5": 15},
  "phone": "081234567890",
  "complete_address": {
    "borough": "Cengkareng Barat",
    "street": "Jl. Cendrawasih No.15",
    "city": "Jakarta Barat",
    "postal_code": "11730",
    "state": "DKI Jakarta",
    "country": "ID"
  },
  "user_reviews": [
    {
      "Name": "Andi",
      "Rating": 5,
      "Description": "Wifi lancar. Kamar nyaman, kedap suara. Lokasi strategis dekat jalan raya.",
      "When": "3 minggu lalu",
      "language": "id",
      "published_at": "2026-05-28T..."
    }
  ],
  "user_reviews_extended": [
    {
      "Name": "Rina",
      "Rating": 2,
      "Description": "Wifi sering mati kalau malam. Tapi parkir luas.",
      "When": "1 bulan lalu",
      "language": "id",
      "published_at": "2026-05-10T..."
    }
  ],
  "category": "Kost",
  "categories": ["Kost", "Boarding House"]
}
```

---

## 2. Data Processor Pipeline

```
JSONL files (data/raw/<area>/*.jsonl)
    │
    ▼
[parse.py]       — Read JSONL line-by-line, handle longitude duplication,
    │              normalize Review casing (accept both PascalCase and snake_case)
    │
    ▼
[normalize.py]   — Phone → E.164 format, area de-anglicizing
    │              ("West Jakarta" → "Jakarta Barat"),
    │              lodging type mapping
    │
    ▼
[enrich.py]      — Match postal_code → kodepos: resolve kecamatan, kelurahan, province
    │              If postal_code is missing, fallback to lat/lon → kodepos /detect
    │
    ▼
[dedup.py]       — Group by place_id, keep entry with highest review_count
    │              If same place_id: merge reviews (union), keep latest metadata
    │              Secondary: coordinate proximity <100m → flag as potential duplicate
    │
    ▼
[extract.py]     — Regex-detect facilities from ALL review texts (user_reviews + user_reviews_extended):
    │
    │   Facilities:
    │     wifi        → "wifi", "wi-fi", "internet"
    │     ac          → "ac", "air conditioner", "pendingin"
    │     parkir      → "parkir", "parking", "garasi"
    │     dapur       → "dapur", "kitchen", "masak"
    │     km_dalam    → "kamar mandi dalam", "km dalam", "bathroom inside"
    │     kasur       → "kasur", "springbed", "ranjang"
    │     lemari      → "lemari", "wardrobe", "closet"
    │     listrik     → "listrik", "meteran", "electricity"
    │     air         → "air", "pam", "sumur"
    │
    │   Gender detection:
    │     putri       → "putri", "perempuan", "wanita", "cewek", "khusus wanita"
    │     putra       → "putra", "laki-laki", "pria", "cowok", "khusus pria"
    │     campur       → "campur", "campuran", "bebas"
    │
    │   24h detection:
    │     is_24h       → "24 jam", "buka 24 jam", "akses 24 jam"
    │
    ▼
[build_doc.py]   — Construct text for embedding + metadata dict (see §3)
    │              Select top 20 reviews: 10 lowest rated + 10 highest rated
    │
    ▼
[validate.py]    — Coordinate bounds: -11 ≤ lat ≤ 6, 95 ≤ lon ≤ 141 (Indonesia)
    │              Required fields: place_id, name, lat, lon
    │              Flag: missing postal_code, missing phone, few reviews
    │
    ▼
Output: data/cleaned/<area>.parquet   (full records, all fields preserved)
        data/cleaned/<area>_docs.json (RAG documents, ready for ChromaDB)
```

---

## 3. RAG Document Schema

### Two-Tier Output

**Tier 1 — Full Record** (parquet, preserves ALL data for flexibility):

```python
{
    "place_id": "ChIJ...",
    "name": "Kost Cengkareng Indah",
    "address": "Jl. Cendrawasih No.15, Cengkareng Barat, Cengkareng, Jakarta Barat",
    "kelurahan": "Cengkareng Barat",
    "kecamatan": "Cengkareng",
    "regency": "Administrasi Jakarta Barat",
    "province": "DKI Jakarta",
    "postal_code": "11730",
    "lat": -6.1354743,
    "lon": 106.7231022,
    "rating": 4.2,
    "review_count": 35,
    "reviews_per_rating": {"1": 2, "2": 3, "3": 5, "4": 10, "5": 15},
    "tags": ["wifi", "ac", "parkir"],
    "gender": "campur",
    "is_24h": False,
    "phone": "+6281234567890",
    "website": "https://example.com/kost-cengkareng",
    "maps_url": "https://maps.google.com/?cid=...",
    "category": "Kost",
    "reviews": [                          # ALL reviews preserved
        {
            "text": "Wifi lancar. Kamar nyaman, kedap suara.",
            "rating": 5,
            "date": "2026-05-28",
            "author": "Andi",
            "language": "id"
        },
        # ... up to ~300 reviews
    ]
}
```

**Tier 2 — RAG Document** (JSON, for ChromaDB embedding):

```python
{
    "doc_id": "ChIJ...",                # place_id as primary key
    "text": """
    ## Kost Cengkareng Indah
    Alamat: Jl. Cendrawasih No.15, Cengkareng Barat, Kecamatan Cengkareng, Jakarta Barat, 11730

    Rating: 4.2/5 dari 35 reviews

    Fasilitas: wifi, ac, parkir
    Tipe asrama: campur
    Akses 24 jam: tidak

    Review tamu:
    [5★] Wifi lancar. Kamar nyaman, kedap suara. Lokasi strategis dekat jalan raya.
    [5★] Tempat bersih, pengelola ramah. Ada dapur bersama.
    [4★] Ac dingin, parkir luas. Hanya saja parkir motor aja.
    [2★] Wifi kadang lemot pas hujan. Selain itu oke.
    [1★] Listrik sering mati tanpa pemberitahuan. Deposit susah balik.
    """,
    "metadata": {
        "place_id": "ChIJ...",
        "name": "Kost Cengkareng Indah",
        "kecamatan": "Cengkareng",
        "kelurahan": "Cengkareng Barat",
        "province": "DKI Jakarta",
        "postal_code": "11730",
        "lat": -6.1354743,
        "lon": 106.7231022,
        "rating": 4.2,
        "review_count": 35,
        "tags": "wifi|ac|parkir",
        "gender": "campur",
        "is_24h": False,
        "category": "Kost"
    }
}
```

### Document Text Strategy

**Review Selection:** All available reviews (~8 per kos in shallow scrape). With `-extra-reviews` disabled (RPC API non-functional for Indonesian listings), we only have 8 inline reviews. Include ALL of them in the document text — they fit comfortably within the token budget.

**Selection when review count > 20 (future deep scrape):** Top 20 reviews — 10 lowest rated + 10 highest rated.
This ensures both positive and negative signals are embedded for queries like
"wifi tidak lemot" (matches negative reviews) and "wifi kencang" (matches positive reviews).

**Format:** Structured Indonesian text with markdown headers, star ratings per review,
and facility list. BAAI/bge-m3 is trained on multilingual structured text.

**Token Budget:** ~1000-2000 tokens per document (8 reviews × ~50-100 words each). Well within BAAI/bge-m3's 8192 token limit.

---

## 4. ChromaDB Schema

```
Collection: kos_indonesia
│                   (single collection, area filtered via metadata WHERE)
│
├── Embedding: BAAI/bge-m3 (1024-dim)
├── Distance: cosine (HNSW index)
├── Documents: doc text (Indonesian markdown, ~4000 tokens)
│
└── Metadata fields (indexed for WHERE clause filtering):
    ├── place_id (str)       — primary key, unique
    ├── kecamatan (str)      — area filter: {"kecamatan": "Cengkareng"}
    ├── kelurahan (str)
    ├── province (str)
    ├── postal_code (str)
    ├── lat (float)          — for haversine post-filter
    ├── lon (float)          — for haversine post-filter
    ├── rating (float)       — for score ranking
    ├── review_count (int)
    ├── tags (str)           — pipe-delimited, post-filter in Python
    ├── gender (str)         — "putra" | "putri" | "campur"
    ├── is_24h (bool)        — 24-hour access
    └── category (str)       — "Kost" | "Boarding House" | etc.
```

### Why Single Collection

- ChromaDB supports `$and` WHERE filters: `{"kecamatan": "Cengkareng"}` filters efficiently
- Simpler ingestion — no collection management per area
- Cross-area queries possible ("kos di Jakarta Barat" → multiple kecamatan)
- HNSW index scales to ~100K documents

---

## 5. Search Flow (End-to-End)

```
User query: "kos di Cengkareng, wifi tidak lemot, ada parkir"
    │
    ▼
[embed query]  → BAAI/bge-m3(query)
    │
    ▼
[ChromaDB query]
    WHERE: {"kecamatan": "Cengkareng"}
    query_embeddings: [query_embedding]
    n_results: 50
    │
    ▼
[Python post-filter]
    haversine(lat, lon, user_lat, user_lon) ≤ radius_km     (if user coordinates provided)
    "wifi" in tags.split("|")                                (if tag filter)
    │
    ▼
[rank.py — composite scoring]
    score = (
        w1 * (1 - distance / max_distance) +    # proximity (0-1)
        w2 * (rating / 5) +                     # rating (0-1)
        w3 * tag_match_score +                  # how many requested tags match
        w4 * review_quality_score               # ratio of positive vs negative reviews
    )
    │
    ▼
[LLM summarize — Z.AI glm-air]
    System: "You are a kos recommendation assistant. Answer in Indonesian."
    Context: Top-5 kos with their document text
    User query: "kos di Cengkareng, wifi tidak lemot, ada parkir"
    │
    ▼
Output:
    "Berikut 5 kos di Cengkareng dengan wifi bagus dan parkir:
    1. Kost Cengkareng Indah (4.2★, 35 reviews) — Wifi lancar, parkir luas..."
```

### Haversine Formula (from kosan-jakbar `lib/geo.py`)

```python
import math

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
```
