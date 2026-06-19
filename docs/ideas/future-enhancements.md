# Future Enhancements

> Sprint 1 ideas for post-MVP improvement.

---

## 1. Query Understanding (LLM-Powered Intent Extraction)

**Service:** `services/rag-engine/src/search.py`

**What:** Parse natural language query into structured params BEFORE embedding.

```
"kost cewek di Cengkareng wifi kenceng parkir luas"
    → LLM call (glm-air)
    → {
        area: "Cengkareng",
        tags: ["wifi", "parkir"],
        gender: "putri",
        sentiment: "positive",
        intent: "recommendation"
      }
```

**Benefit:** Replace regex area extraction + explicit `--area` flag. User just types freely.

**Cost:** 1 extra LLM call per search (~100 tokens).

---

## 2. Query Rewriting / HyDE

**Service:** `services/rag-engine/src/search.py`

**What:** Expand short queries with synonyms or generate hypothetical documents.

```
"wifi kenceng" 
    → rewrite: ["wifi lancar", "internet cepat", "wifi stabil", "wifi 100mbps"]
    → embed all variants → average vector → search

Alternative (HyDE):
    → LLM generates: "Kost dengan koneksi internet yang cepat dan stabil untuk bekerja remote"
    → embed generated doc → search
```

**Benefit:** Better recall for short/ambiguous queries. Catches reviews that use different wording.

**Cost:** 1 LLM call or zero (synonym list is static).

---

## 3. Review Sentiment per Facility

**Service:** `services/data-processor/src/extract.py`

**What:** During ingestion, classify each review's sentiment per facility tag.

```python
# Current (Phase 3):
entry["tags"] = ["wifi", "ac", "parkir"]  # binary: yes/no

# Enhancement:
entry["facility_sentiment"] = {
    "wifi": {"positive": 3, "negative": 2},    # 3 reviews praise wifi, 2 complain
    "ac": {"positive": 5, "negative": 0},
    "parkir": {"positive": 2, "negative": 1},
}
```

**How:**
- Regex + keyword approach (fast, free):
  - "wifi kenceng/lancar/cepat/bagus" → positive
  - "wifi lemot/lambat/jelek/mati" → negative
- Future: LLM-based per-review sentiment classification

**Benefit:** Rank score can penalize kos with negative wifi reviews when user asks for "wifi kenceng". Done at ingestion time (one-time, not per query).

**Cost:** Zero (regex) or 1 LLM call per review (expensive).

---

## 4. Price Range Detection

**Service:** `services/data-processor/src/extract.py`

**What:** Extract price mentions from review text.

```
"harga 1.5jt per bulan" → price_range: 1000000-1999999
"850rb" → price_range: 500000-999999
"2.2 juta" → price_range: 2000000-2999999
```

**Benefit:** Enable budget filtering ("kos di bawah 1.5jt").

**Cost:** Regex, zero LLM.

---

## 5. Multi-Area Search (Grid Expand)

**Service:** `services/rag-engine/src/cli.py` + geo-router

**What:** "Jakarta Barat" → auto-expand ke 8 kecamatan → scrape all → merge results.

**Benefit:** User doesn't need to know specific kecamatan names.

**Status:** Geo-router already supports this (`/resolve?q=Jakarta+Barat` returns 8 districts). CLI just needs to iterate.

---

## 6. Scheduled Re-Scrape (Dating Freshness)

**Service:** `services/scraper/src/run.py`

**What:** TTL-based cache invalidation. Re-scrape areas older than N days.

```python
if cache_age > 30:  # days
    force_rescrape()
```

**Benefit:** Data stays fresh without manual `--force-scrape`.
