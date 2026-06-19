# Phase 0 Report — Repo Setup & Scraper Exploration

> Completed: 2026-06-19

---

## 1. How to Run the Scraper Manually

All commands run from the project root (`rent-house-ai/`).

### Quick Test (Single Query)

```bash
# 1. Create query file
echo "kos di 11730" > data/raw/test_query.txt

# 2. Run scraper (~18 detik)
services/scraper/google-maps-scraper/gmaps-scraper \
  -input data/raw/test_query.txt \
  -results data/raw/test_result.jsonl \
  -json \
  -depth 1 \
  -c 1 \
  -lang id \
  -exit-on-inactivity 5m

# 3. Check results
wc -l data/raw/test_result.jsonl       # jumlah kos yang didapat
head -1 data/raw/test_result.jsonl | python3 -m json.tool | head -40
```

### Multi-Query (5 Postal Codes × 3 Variants)

```bash
# Save as scripts/run_scraper.sh and chmod +x
#!/bin/bash
AREA="cengkareng"
CODES=(11710 11720 11730 11740 11750)
VARIANTS=("kos di" "kost di" "kosan di")
QUERY_FILE="data/raw/${AREA}_queries.txt"

> "$QUERY_FILE"  # truncate
for code in "${CODES[@]}"; do
  for variant in "${VARIANTS[@]}"; do
    echo "$variant $code" >> "$QUERY_FILE"
  done
done

services/scraper/google-maps-scraper/gmaps-scraper \
  -input "$QUERY_FILE" \
  -results "data/raw/${AREA}.jsonl" \
  -json \
  -depth 1 \
  -c 1 \
  -lang id \
  -exit-on-inactivity 5m
```

### Flags Reference

| Flag | Value | Purpose |
|------|-------|---------|
| `-input` | path | File with queries (1 per line) |
| `-results` | path | Output JSONL file |
| `-json` | — | JSON Lines format (default is CSV) |
| `-depth` | 1 | Scroll depth (1 = ~20 places) |
| `-c` | 1 | Concurrency (1 = safe for local) |
| `-lang` | id | Language code for Google Maps |
| `-exit-on-inactivity` | 5m | Auto-exit if no activity |

---

## 2. Scrape Test Results

### Shallow Scrape (`-depth 1`, no `-extra-reviews`)

| Metric | Value |
|--------|-------|
| Query | `"kos di 11730"` |
| Places found | 20 |
| Reviews per place | 8 (inline `user_reviews`) |
| Total reviews | 160 |
| Fields per entry | 37 |
| File size | ~205 KB (JSONL) |
| Duration | ~18 seconds |
| Success rate | 100% (0 failures) |

### Deep Scrape (`-depth 1`, `-extra-reviews`)

| Metric | Value |
|--------|-------|
| Places found | 20 |
| Reviews per place | 8 inline + 3 extended = 11 total |
| Total reviews | 220 |
| File size | ~242 KB (1.2× larger) |
| Duration | ~2.5 minutes (30× slower) |

### Key Finding: `-extra-reviews` Not Worth It

RPC API returns **empty** for all Indonesian kos listings. The scraper falls back to DOM-based review extraction which:
- Only captures 3 extra reviews per place
- Takes 30× longer
- Results in minimal data gain (37% more reviews)

**Decision:** Use shallow scrape for MVP. 8 reviews/kos is sufficient.

---

## 3. Review Quality Analysis

### Composition (from 160 reviews across 20 kos)

| Type | ~% | Example |
|------|-----|---------|
| Real reviews (detailed) | ~35% | "wifi nya jelek banget sumpah. Apalagi yang lantai 3 jelek banget" |
| Real reviews (brief) | ~15% | "tempatnya nyaman dan bersih" |
| Availability questions | ~40% | "Masih ada yang kosong ngga?", "berapa harga?" |
| Contact requests | ~10% | "ada nomor WA?", "hubungi kemana ya?" |

### Implication for Data Processor (Phase 3)

Reviews under ~30 characters or matching question patterns should be filtered:

```python
NOISE_PATTERNS = [
    "ada yang kosong", "masih ada kamar", "berapa harga",
    "nomor wa", "hubungi kemana", "ada nomor"
]

def is_usable_review(review_text: str) -> bool:
    if len(review_text) < 30:
        return False
    lower = review_text.lower()
    for p in NOISE_PATTERNS:
        if p in lower:
            return False
    return True
```

After filtering, expect **~4 usable reviews per kos** — still solid for RAG.

### Rich Review Examples (Gold Data for RAG)

| Kos | Review |
|-----|--------|
| Kost Meisi (3.9★) | "Tempatnya nyaman, bersih tapi wifi nya jelek banget sumpah. Apalagi yang lantai 3 jelek banget ampun" |
| Kost IMIGRAHA (4.5★) | "wifi nya sangat lemot, fasilitas kurang ter maintain dengan baik (banyak yang rusak gk diganti), Dan kebersihan..." |
| Kost Humming Homes (4.7★) | "Nyaman, penjaganya asik. Sudah 1 thn ga ada masalah stay disini" |
| Rosetta kost (4.8★) | "Tempat strategis. Di belakang jalan utama. Bangunan bagus berlantai dimana di lantai dasar terdapat laundry." |
| Warteg & Kos Nyaman Gemini (4.8★) | "Kostnya bersih, fasilitas lengkap (AC & WiFi kencang), dan lokasinya strategis banget." |
| KOST UTAMA 5 (4.2★) | "Kamarnya nyaman + kamar mandinya di dalam. Lingkungannya amann bgt deket jalan besar." |

---

## 4. Data Structure Findings

### All Entry Fields (37 total)
`about`, `address`, `categories`, `category`, `cid`, `complete_address`, `data_id`, `description`, `emails`, `images`, `input_id`, `latitude`, `link`, `longitude`, `longtitude`, `menu`, `open_hours`, `order_online`, `owner`, `phone`, `place_id`, `plus_code`, `popular_times`, `price_range`, `reservations`, `review_count`, `review_rating`, `reviews_link`, `reviews_per_rating`, `status`, `street_view_url`, `thumbnail`, `timezone`, `title`, `user_reviews`, `user_reviews_extended`, `web_site`

### Review Fields (24 total, mixed casing)
PascalCase: `Name`, `ProfilePicture`, `Rating`, `Description`, `Images`, `When`
snake_case: `review_id`, `source`, `rating_scale`, `rating_float`, `author_url`, `language`, `translated_lang`, `text_original`, `text_translated`, `posted_at_unix_micros`, `updated_at_unix_micros`, `reply_text`, `reply_text_original`, `reply_language`, `reply_translated_lang`, `reply_posted_at_unix_micros`, `reply_updated_at_unix_micros`, `published_at`

### Known Issues

| Issue | Impact | Mitigation |
|-------|--------|-----------|
| 10% entries missing `postal_code` in `complete_address` | Can't resolve kelurahan/kecamatan | Fallback to `lat/lon` → kodepos `/detect` API |
| `longtitude` + `longitude` both present | Duplicate keys in dict | Parse both, prefer `longitude` |
| Review `Description` and `text_original` both present (98.75%) | Duplicate text | Use `Description` as primary, `text_original` as fallback |
| ~50% reviews are "ada kamar kosong?" questions | Noise in RAG | Filter short/question-pattern reviews in processor |
| `user_reviews_extended` always empty `[]` without `-extra-reviews` | Empty field | Ignore, only use `user_reviews` |

---

## 5. Reference Files

| File | Description |
|------|-------------|
| `data/raw/test_query.txt` | Single-query test input ("kos di 11730") |
| `data/raw/test_result.jsonl` | Shallow scrape output (20 kos, 160 reviews) |
| `data/raw/deep_query.txt` | Deep scrape test input |
| `data/raw/deep_result.jsonl` | Deep scrape output (20 kos, 220 reviews) |
| `data/raw/cengkareng_queries.txt` | Full 15 query variants for 5 postal codes |
| `services/scraper/google-maps-scraper/gmaps-scraper` | Go binary (62MB, gitignored) |
