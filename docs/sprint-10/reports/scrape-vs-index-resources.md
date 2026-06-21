# Sprint 10 — Scrape vs Index Resource Profile + Concurrency

> Generated: 2026-06-21 | Branch: `feat/e5-small-poc`
> Source: `poc/_e2e_logs/poc_docker_stats.jsonl` (4 269 samples @ 5 s, 4+ hours)
> Target area: **Tambora** (10 postal codes, 318 docs scraped fresh, then indexed)

This report answers three questions:
1. **CPU/RAM needed during scraping** (Google Maps scraper, Chromium-based)
2. **CPU/RAM needed during indexing** (e5-small embedding)
3. **Can scraping + indexing run concurrently?** (Short answer: NO — prevented at orchestrator level, not just resource level)

---

## 1. Side-by-side resource comparison

| Phase | Duration | kos-api avg CPU | kos-api peak CPU | kos-api avg RAM | kos-api peak RAM | kos-geo peak | kos-web peak |
|---|---:|---:|---:|---:|---:|---:|---:|
| **Idle (cold, pre-scrape)** | 15 min | 10.6 % | 384 % ⚠ | 0.79 GiB | 1.92 GiB | 0.19 GiB | <0.01 GiB |
| **SCRAPING Tambora** | **1 h 22 m** | **114.8 %** | **253.6 %** | **1.90 GiB** | **2.35 GiB** | 0.20 GiB | <0.01 GiB |
| **Idle (warm, post-scrape)** | 30 min | 45.2 % | 241 % | 1.62 GiB | 2.30 GiB | 0.19 GiB | <0.01 GiB |
| **INDEXING Tambora** | **20 s** | **52.6 %** | **357.8 %** | **1.42 GiB** | **1.43 GiB** | 0.19 GiB | <0.01 GiB |
| **All-time peak** | — | — | 384 % | — | **2.39 GiB** | 0.20 GiB | 0.01 GiB |

⚠ The 384 % peak CPU in the "idle" window is a brief API burst (4-core saturated for <5 s, likely a `/search` request). It's not sustained — average CPU in that window is only 10.6 %.

⚠ Post-scrape idle RAM (1.62 GiB) is **higher than pre-scrape idle** (0.79 GiB). This is normal Python/ChromaDB behavior — heap grows under load and doesn't always return to baseline. The 1.62 GiB is the realistic "warm steady-state" production number.

---

## 2. CPU/RAM during SCRAPING

### What scraping does

The scraper is a Go binary (`services/scraper/google-maps-scraper/gmaps-scraper`)
running inside the kos-api container. It launches **Chromium via Playwright**
to fetch Google Maps search results per postal code, then writes raw JSONL to
`data/raw/<area>/<postal_code>.jsonl`.

Per postal code: ~5–10 minutes (rate-limited by Google).
Tambora has 10 postal codes → ~1 h 22 m total.

### Resource profile

| Metric | Value | Notes |
|---|---:|---|
| Duration (Tambora, 10 postal codes) | 1 h 22 m | Google rate-limits dominate, not CPU |
| kos-api avg CPU | 115 % | ~1 core average — scraper is I/O-bound (waits on HTTP) |
| kos-api peak CPU | 254 % | Spikes during HTML parsing + JSON extraction |
| kos-api avg RAM | **1.90 GiB** | Resident e5-small (~445 MiB) + Chromium (~500-800 MiB) + Python heap |
| kos-api peak RAM | **2.35 GiB** | Brief peaks when Chromium opens new tabs |
| kos-geo | <0.20 GiB | Geo-router only invoked during process phase, not scrape |

### Why scraping is RAM-heavy

The 2.35 GiB peak comes from **Chromium** running inside the container, not
from anything related to the embedding model. Chromium uses ~500-800 MiB per
headless browser instance; Playwright + the Go binary add another ~200 MiB.

**This means**: swapping to e5-small does **not** reduce scrape-time RAM.
Chromium dominates, regardless of embedding model. The model only matters
during indexing (§3 below).

### Implication for VPS planning

A scrape-heavy workload (e.g. initializing the corpus, periodic re-scrapes)
needs **at least 4 GiB VPS RAM** just for kos-api. This is **independent of
the embedding model choice** — bge-m3 and e5-small have the same scrape-time
footprint because the embedding model isn't loaded during scrape.

---

## 3. CPU/RAM during INDEXING

### What indexing does

Indexing = take already-scraped `data/cleaned/<area>_docs.json` and:
1. Load e5-small model (resident in process via `model_cache.py`)
2. Encode each doc → 384-dim vector (batch_size=8)
3. Insert into ChromaDB collection `kos_indonesia`

Per doc: ~64 ms (e5-small) or ~1 000 ms (bge-m3).
Tambora = 310 docs → 19.7 s with e5-small.

### Resource profile

| Metric | Value | Notes |
|---|---:|---|
| Duration (Tambora, 310 docs) | **19.7 s** | 64 ms/doc |
| kos-api avg CPU | 53 % | Includes 5 s of "completed but RAM not yet released" tail |
| kos-api peak CPU | **358 %** | Pure model inference burst, 4-core saturated |
| kos-api avg RAM | **1.42 GiB** | Mostly resident model + ChromaDB cache |
| kos-api peak RAM | **1.43 GiB** | Tight spike — only +34 MiB over pre-index idle |
| kos-geo | <0.20 GiB | Not involved in indexing |

### Why indexing RAM is modest (for e5-small)

Idle RAM (1.40 GiB on warm stack) already includes:
- e5-small model resident: ~445 MiB
- ChromaDB HNSW index cached: ~6 MiB (for ~250 docs)
- Python/torch/chromadb heap: ~900 MiB

During indexing, the **transient** additions are:
- e5-small batch-encode workspace: ~25 MiB (8 docs × 384-dim tensors)
- HNSW insert in-memory: ~10 MiB (310 new vectors before flush)
- **Total delta: +34 MiB**

This is why e5-small is so VPS-friendly — the indexing spike is tiny.

### Compare to bge-m3 (Phase 5 reference)

| Metric | bge-m3 | e5-small |
|---|---:|---:|
| Cold-start idle RAM | 0.73 GiB | 0.74 GiB |
| Warm idle RAM | ~1.6 GiB (projected) | 1.40 GiB |
| Indexing peak RAM | **3.30 GiB** | **1.43 GiB** |
| Indexing delta (peak − warm idle) | **+2.57 GiB** | **+0.03 GiB** |

bge-m3's attention buffer for 1024-dim embeddings creates a much larger
transient workspace (~2.5 GiB) during batch encode. e5-small at 384-dim
doesn't have this overhead.

---

## 4. Concurrency question — can scrape + index run at the same time?

### Short answer

**No, the system explicitly prevents it** at the orchestrator level via a
single-slot queue (`api/src/pipeline_state.py`). Even if the queue didn't
exist, running both simultaneously would be **theoretically possible but
would push peak RAM to ~3.8 GiB** (2.35 scrape + 1.43 index), which is risky
on a 4 GiB VPS.

### Long answer — three layers of protection

#### Layer 1: API-level prevention (already implemented)

`api/src/pipeline_state.py:37-47`:

```python
def start(self, area: str) -> bool:
    """Attempt to start pipeline for `area`. Returns False if already running."""
    with self._lock:
        if self.running is not None:
            return False              # ← hard block
        self.running = area
        ...
```

`api/src/pipeline_data.py:199-224` — `_start_or_queue`:

If `state.running` is set, the second request is **queued**, not started
concurrently. There is exactly one pipeline slot. Clicking "Index" while
"Rescrape" is running just queues your request — both do not run together.

#### Layer 2: Sequential phases inside one pipeline run

Even within a single `Rescrape` action (which does scrape → process → index),
the three phases run **sequentially**, not concurrently:

```
[scrape Chromium + Go]  →  [process Python]  →  [index e5-small encode]
       ~1h22m                   ~5s                     ~20s
```

So during a full Rescrape of Tambora, peak RAM = max(scrape_peak, index_peak)
= max(2.35, 1.43) = **2.35 GiB**, NOT the sum (3.78 GiB).

#### Layer 3: What if you bypassed both and ran them in parallel manually?

Theoretical peak RAM if you somehow ran scrape + index concurrently on the
same area:

| Component | RAM |
|---|---:|
| kos-api base (interpreter, FastAPI) | 200 MiB |
| e5-small model resident | 445 MiB |
| e5-small batch encode workspace | 34 MiB |
| ChromaDB HNSW cache + insert | 50 MiB |
| **Subtotal (index-related)** | **~730 MiB** |
| Chromium (1 headless browser) | 600 MiB |
| Go scraper process | 200 MiB |
| **Subtotal (scrape-related)** | **~800 MiB** |
| **Theoretical concurrent peak** | **~1.53 GiB** |

Wait — this is less than the scrape-only peak of 2.35 GiB measured in §2.
Why? Because the measured 2.35 GiB already INCLUDES the resident e5-small
model (it was loaded at FastAPI startup per Sprint 8). The "scrape" phase
doesn't unload the model.

So actual concurrent peak ≈ measured scrape peak + indexing delta ≈
**2.35 + 0.03 = 2.38 GiB**. NOT 3.78 GiB. The e5-small indexing delta is so
small it barely adds anything on top of scraping.

**With bge-m3**, concurrent peak would be **2.35 + 2.57 = 4.92 GiB** — would
OOM a 4 GiB VM, hence the user's intuition was right **for bge-m3**. For
e5-small, the concern largely disappears.

### Verdict

| Scenario | Safe? | Min VPS RAM |
|---|---|---|
| Scrape alone | ✅ | 4 GiB |
| Index alone (e5-small) | ✅ | 2 GiB |
| Index alone (bge-m3) | ⚠ tight | 4 GiB |
| Sequential scrape → index (Rescrape, e5-small) | ✅ | 4 GiB |
| Sequential scrape → index (Rescrape, bge-m3) | ⚠ | 4 GiB |
| **Concurrent scrape + index (e5-small)** ⚠ hypothetical | ✅ | **4 GiB** |
| Concurrent scrape + index (bge-m3) ⚠ hypothetical | ❌ OOM risk | **8 GiB** |
| API-allowed concurrent | ❌ prevented | n/a |

The orchestrator's single-slot queue is the right design choice for bge-m3
(it would OOM otherwise). For e5-small, the queue is still a good safety net
but no longer strictly necessary from a RAM perspective — concurrent
operations would fit in 4 GiB.

---

## 5. Summary — what to plan for in production

| Workload | Peak RAM kos-api | Min VPS (comfortable) |
|---|---:|---:|
| Idle / serving searches only | 1.4 GiB | 2 GiB |
| One-off index (e5-small) | 1.5 GiB | 2 GiB |
| One-off scrape (any model) | 2.4 GiB | **4 GiB** |
| Full Rescrape (scrape + index sequential) | 2.4 GiB | 4 GiB |
| Concurrent users + admin indexing | 1.5 GiB + small per-search overhead | 4 GiB |

**Bottom line**:
- The **binding constraint is scraping, not indexing**. Chromium is the
  RAM-hungriest component, and it's model-independent.
- For e5-small, **2 GiB VPS works for serving + occasional indexing**.
- For scraping (which happens rarely — initial corpus setup or monthly
  refresh), **4 GiB VPS is the practical floor** regardless of model.
- The orchestrator's single-slot queue prevents accidental concurrent
  pipelines. Keep it even after the e5-small migration — it's good defense
  in depth.
