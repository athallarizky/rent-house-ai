# Phase 2 Report — Scraper Service

> Completed: 2026-06-19

---

## 1. How to Run

All commands from the project root (`rent-house-ai/`).

### Single Postal Code

```bash
cd services/scraper && python3 -c "
from src.run import scrape_area, ScraperConfig

config = ScraperConfig(depth=1, concurrency=1, lang='id')
entries = scrape_area('cengkareng', [11730], config=config)
print(f'{len(entries)} kos')
"
```

### Full Area (All Postal Codes)

```bash
cd services/scraper && python3 -c "
from src.run import scrape_area, ScraperConfig

codes = [11710, 11720, 11730, 11740, 11750]
entries = scrape_area('cengkareng', codes, config=ScraperConfig())
print(f'{len(entries)} kos')
"
```

### Force Re-scrape (Ignore Cache)

```bash
cd services/scraper && python3 -c "
from src.run import scrape_area, ScraperConfig
entries = scrape_area('cengkareng', [11730], config=ScraperConfig(), force=True)
"
```

### Generate Queries Only (No Scraping)

```bash
cd services/scraper && python3 -c "
from src.generate import generate_queries
for q in generate_queries([11730]):
    print(q)
"
# Output:
# kos di 11730
# kost di 11730
# kosan di 11730
```

---

## 2. Service Architecture

```
services/scraper/
├── google-maps-scraper/           # vendored Go binary source
│   └── gmaps-scraper              # compiled binary (62MB, gitignored)
├── src/
│   ├── __init__.py
│   ├── generate.py                # postal codes → search queries
│   ├── cache.py                   # disk cache (data/raw/<area>/)
│   └── run.py                     # subprocess wrapper + cache logic
└── pyproject.toml
```

### Flow

```
scrape_area("cengkareng", [11710, 11720, ...])
    │
    ├── for each postal_code:
    │     ├── cache exists? → skip
    │     └── cache missing? →
    │         generate.py: [11730] → ["kos di 11730", "kost di 11730", "kosan di 11730"]
    │         subprocess.run([gmaps-scraper, -input queries.txt, -results ...])
    │         → saves to data/raw/cengkareng/11730.jsonl
    │
    └── load all JSONL files → merge → return list[dict]
```

### ScraperConfig

| Param | Default | Purpose |
|-------|---------|---------|
| `depth` | 1 | Scroll depth (1 = ~20 places per query) |
| `concurrency` | 1 | Places scraped in parallel (safe for local) |
| `lang` | "id" | Google Maps language |
| `json_output` | True | JSONL format |
| `exit_on_inactivity` | "5m" | Auto-exit timeout |

### Cache Layer

```
data/raw/<area>/
├── 11710.jsonl        ← if exists → skip scrape
├── 11720.jsonl
├── 11730.jsonl
├── 11740.jsonl
├── 11750.jsonl
├── queries_11710.txt  ← query files (generated, temporary)
└── ...
```

Cache is permanent — no TTL. To re-scrape, use `force=True` or delete the JSONL files.

---

## 3. Test Results — Cengkareng

| Postal Code | Queries | Kos Found | File Size |
|-------------|---------|-----------|-----------|
| 11710 | 3 | 44 | 336 KB |
| 11720 | 3 | 42 | 309 KB |
| 11730 | 3 | 36 | 340 KB |
| 11740 | 3 | 42 | 327 KB |
| 11750 | 3 | 44 | 344 KB |
| **Total** | **15** | **208** | **1.7 MB** |

### Dedup

| Metric | Value |
|--------|-------|
| Total entries | 208 |
| Unique by `place_id` | **177** |
| Duplicate rate | 14.9% |

~15% overlap is expected — some kos appear in multiple postal code searches (near boundaries, or Google Maps broad matching).

### Estimation for RAG

| Metric | Value |
|--------|-------|
| Unique kos | 177 |
| Reviews per kos | ~8 |
| Total reviews | ~1,416 |
| Average review text | ~50-100 words |
| Estimated token count (embedding) | ~1,000-2,000 per kos document |

---

## 4. Important Decisions

### `-extra-reviews` Skipped

Based on Phase 0 findings, `-extra-reviews` provides no benefit for Indonesian listings:
- RPC API returns empty
- DOM fallback only adds 3 reviews at 30× time cost
- 8 inline reviews per kos is sufficient

### 3 Query Variants

Each postal code uses 3 search queries:
- `"kos di <code>"` — most common spelling
- `"kost di <code>"` — common variant
- `"kosan di <code>"` — another variant

This maximizes coverage — different spelling conventions capture different Google Maps listings.

### Sequential Execution

`-c 1` (concurrency = 1) for local safety:
- Chromium headless uses ~500MB RAM
- 5 postal codes × ~18 seconds = ~90 seconds total
- Parallel execution would require more RAM and risk rate-limiting

---

## 5. Reference Files

| File | Purpose |
|------|---------|
| `services/scraper/src/generate.py` | Query generation (postal code → 3 search variants) |
| `services/scraper/src/run.py` | Go binary subprocess wrapper + cache logic |
| `services/scraper/src/cache.py` | Disk cache (exists check, load, path resolution) |
| `services/scraper/google-maps-scraper/gmaps-scraper` | Go binary (62MB, gitignored) |
| `data/raw/cengkareng/` | Cached Cengkareng scrape results (1.7 MB, 177 unique kos) |
