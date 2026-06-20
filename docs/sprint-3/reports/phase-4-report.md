# Phase 4 Report — Price Range Detection from Reviews

> Completed: 2026-06-20 | Sprint 3 / Future Enhancement #4

---

## 1. Overview

Previously, the search system had no price awareness — data-processor extracted tags
(wifi, AC, etc.) and gender but never parsed price mentions from reviews. Users
couldn't filter by budget.

Phase 4 adds **regex-based price range detection** from Indonesian review text,
stores it in ChromaDB metadata, and exposes budget filter chips in the frontend.

```
Review: "harga Mulai dari 1,5 - 2 juta per bulan"
         ──► detect_price() ──► {min: 1500000, max: 2000000}

FilterChips: [<500rb(5)] [500rb-1jt(12)] [1jt-2jt(45)] [>2jt(8)]
```

---

## 2. How to Test

1. Start the stack (geo-router, api, web)
2. Open `/search`, load a district with price data in reviews
3. FilterChips shows budget preset chips with counts
4. Click a budget chip → right panel filters to matching kos
5. KosCard shows price badge (e.g., "Rp1.5jt") when available

**Note:** Existing cached data needs re-processing to pick up prices.
Pipeline runs automatically on next district load (30-day TTL from Phase 2
may also trigger it).

To force a re-process locally:

```bash
cd services/data-processor && python3 -m src.pipeline Cengkareng
# Re-index after
cd services/rag-engine && python3 -m src.ingest ../../data/cleaned/Cengkareng_docs.json
```

---

## 3. Changes

### 3a. `services/data-processor/src/extract.py` — `detect_price()`

New function with regex patterns for Indonesian price mentions:

**Range pattern** (`_PRICE_RANGE_RE`):
| Input | Output |
|-------|--------|
| `harga 1,5 - 2 juta` | `{min: 1500000, max: 2000000}` |
| `harga 700-1,2jt` | `{min: 700000, max: 1200000}` |
| `harga kisaran 800rb-1,2juta` | `{min: 800000, max: 1200000}` |

**Single pattern** (`_PRICE_SINGLE_RE`):
| Input | Output |
|-------|--------|
| `harga 1.5jt` | `{min: 1500000, max: 1500000}` |
| `Harga 800 ribu` | `{min: 800000, max: 800000}` |
| `biaya tambahan 200 ribu` | `{min: 200000, max: 200000}` |

**Unit inheritance:** When range has mixed units (`700-1,2jt`), the first number
inherits the second's unit unless that makes it absurdly larger — then it
downshifts (jt→rb). Validation: 10k–50M rupiah range.

**Keywords detected:** `harga`, `harganya`, `biaya`, `sewa`, `bayar`.

All 16 real-world test patterns pass.

### 3b. `services/data-processor/src/pipeline.py` — `_extract_facilities()`

Calls `detect_price(all_text, title_text)` during extraction phase. Sets
`entry["price_min"]` and `entry["price_max"]` on the normalized entry.

### 3c. `services/data-processor/src/build_doc.py` — Price in document + metadata

- Adds price info to the text document: `Harga: Rp1,500,000 - Rp2,000,000`
- Adds `price_min` and `price_max` to ChromaDB metadata (default 0 if null)

### 3d. `api/src/orchestrator.py` — `_format_kos_items()`

Includes `price_min` and `price_max` in API responses (as `None` when missing).

### 3e. Frontend — Types + Filter + Card

| File | Change |
|------|--------|
| `web/src/lib/types.ts` | `KosResult.price_min`, `price_max`; `Filters.budget` field |
| `web/src/components/FilterChips.tsx` | 4 budget preset chips: `<500rb`, `500rb-1jt`, `1jt-2jt`, `>2jt` |
| `web/src/components/ChatInterface.tsx` | `budgetCounts` useMemo, budget filter logic in `filteredDataset` |
| `web/src/components/KosCard.tsx` | Price badge in emerald when available |

---

## 4. Verification

| Check | Result |
|-------|--------|
| Python AST parse (`extract.py`, `pipeline.py`, `build_doc.py`, `orchestrator.py`) | OK |
| 16 price pattern tests | All pass (range, single, mixed units, no price) |
| `npm run check` | 0/0/0 (30 files) |
| `npm run build` | 3 pages built |
| Budget filter chips render | With counts from dataset |
| KosCard price badge | Shows when `price_min/price_max` present |

---

## 5. Findings / Notes

| Item | Detail |
|------|--------|
| No RCA needed | Passed all tests first try after regex fixes |
| Unit inheritance edge case | `700-1,2jt` — 700 could be rb (700k) or jt (700M). Downshift heuristic: if inheriting "jt" makes v1 > 2× v2, step down to "rb" |
| No re-index trigger | Price detection runs during `process_area`. Existing indexed data won't have prices until the district is re-processed. Phase 2 TTL handles this passively (30-day re-scrape → re-process). |
| Daily/harian prices | `harga harian 125 rb` detected as 125k — acceptable; daily rent is still rent data |
| `bayar 50rb` detected | Edge cases like random payments are captured but stay within 10k–50M validation |
| Price badge format | Rounded to 1 decimal jt: `Rp1.5jt`, `Rp0.7-1.2jt` |

---

## 6. Reference Files

| File | Purpose |
|------|---------|
| `services/data-processor/src/extract.py` | `detect_price()`, `_PRICE_RANGE_RE`, `_PRICE_SINGLE_RE`, `_PRICE_UNIT` |
| `services/data-processor/src/pipeline.py` | `_extract_facilities()` calls `detect_price()` |
| `services/data-processor/src/build_doc.py` | Price in document text + metadata |
| `api/src/orchestrator.py` | `_format_kos_items()` includes price fields |
| `web/src/lib/types.ts` | `KosResult` + `Filters` extended |
| `web/src/components/FilterChips.tsx` | Budget preset chips |
| `web/src/components/ChatInterface.tsx` | Budget filter logic + counts |
| `web/src/components/KosCard.tsx` | Price badge |

> **Ref:** `docs/ideas/future-enhancements.md` §4 & §8 — Price Range Detection
> **Ref:** `docs/sprint-3/tasks.md` — Phase 4 task tracking
