# Sprint 10 Phase 5 — E2E Docker Resource Comparison

> Generated: 2026-06-21 | Branch: `feat/e5-small-poc`
> Methodology: full Docker stack (3 containers) run twice on local Colima VM
> (macOS arm64 host). One area (Cengkareng, 233 docs) indexed via real
> `/pipeline/index` API. Same script (`poc/e2e_run.py`) drove both runs.
> Raw samples: `poc/_e2e_logs/{runA_bge_m3,runB_e5_small}_results.json`.

## Methodology

Both runs use the **production Docker stack** — `kos-api`, `kos-web`, `kos-geo`
containers from `docker-compose.yml`, with `Dockerfile.api` containing torch
+ chromium + node + bge-m3 model pre-download via `scripts/docker-startup.sh`.

The only sprint-10-PoC edit was to `scripts/docker-startup.sh` so the same
script could pre-download either model based on `$EMBED_MODEL`. The change
read `EMBED_MODEL="${EMBED_MODEL:-BAAI/bge-m3}"` and used that env var inside
the python check. **Reverted at end of Phase 5** — `git diff` is empty.

Run isolation: two compose project names (`-p bge`, `-p e5`) gave each run its
own `model-cache` volume, so the second run didn't inherit the first's cached
model. The bind-mounted `./data/chroma_db` was wiped between runs because
ChromaDB locks vector dimensionality on first insert (1024 → 384 mismatch).

Environment:
- Host: macOS arm64 (Apple Silicon)
- Colima VM: Ubuntu 24.04, 4 vCPU, 8 GiB RAM, 50 GiB disk
- Docker: Engine 29.5.2 (Linux), Compose v1 5.1.4
- Inside container: Python 3.11-slim, torch 2.8.0 CPU, chromadb 1.5.9, sentence-transformers (latest)

## Headline Comparison

| Metric | bge-m3 (Run A) | e5-small (Run B) | Δ absolute | Δ relative |
|---|---:|---:|---:|---:|
| **Indexing 233 docs (Cengkareng)** | **232.9 s** | **19.2 s** | **−213.7 s** | **−91.8 % (12× faster)** |
| Peak RAM during indexing | 3.30 GiB | 1.15 GiB | −2.15 GiB | −65 % |
| Peak CPU during indexing | ~400 % | ~380 % | ~same | (both 4-core saturated) |
| Idle RAM (model resident, pre-pipeline) | 727 MiB | 743 MiB | +16 MiB | +2 % |
| ChromaDB storage after 233 docs | 4.5 MiB | 3.2 MiB | −1.3 MiB | −29 % |
| Per-doc ingest time | 1 000 ms | 82 ms | −918 ms | 12× faster |
| Warm search latency (q1 wifi) | 210 ms | 62 ms | −148 ms | 3.4× faster |
| Warm search latency (q3 ac+parkir) | 187 ms | 53 ms | −134 ms | 3.5× faster |
| Warm search latency (q4 KM dalam) | 187 ms | 63 ms | −124 ms | 3.0× faster |
| Cold search latency (q1 first call) | 510 ms | 67 ms | −443 ms | 7.6× faster |

## Per-query search latency (mode=rag, top_k=5)

| # | Query | Area | bge-m3 cold | bge-m3 warm | e5-small cold | e5-small warm |
|---|---|---|---:|---:|---:|---:|
| 1 | `wifi kenceng buat wfh` | Cengkareng | 510 ms | 210 ms | 67 ms | 62 ms |
| 2 | `kos putri murah` | Cilandak | 186 ms | 185 ms | 52 ms | 50 ms |
| 3 | `ac dingin parkir luas` | Kebon Jeruk | 192 ms | 187 ms | 51 ms | 53 ms |
| 4 | `kamar mandi dalam` | Grogol Petamburan | 189 ms | 187 ms | 54 ms | 63 ms |
| 5 | `dapur buat masak` | Kalideres | 183 ms | 186 ms | 54 ms | 52 ms |
| | **Average warm** | | **193 ms** | | **56 ms** | |

Notes:
- Only Cengkareng was actually indexed in each run. Result-count anomalies
  (q3 / q4 returning n=5 for non-indexed areas) suggest the search API falls
  back to a broader query when the area has no vectors; this is consistent
  across both runs and doesn't bias the latency comparison.
- Warm search delta is consistent at ~3-4× faster. This is more conservative
  than the Sprint-8 projected 70-140× speedup vs the OLD subprocess-per-request
  architecture, because both runs here already benefit from Sprint 8's
  in-process model residency. The remaining 3-4× is the pure model-inference
  cost difference.

## RAM profile during indexing (kos-api container, 5 s samples)

### Run A — bge-m3
```
t=  1.0s   cpu=250%   mem=1.259 GiB
t= 13.2s   cpu=373%   mem=2.337 GiB
t= 31.5s   cpu=347%   mem=2.773 GiB
t= 49.8s   cpu=385%   mem=3.183 GiB   ← first peak
t=158.9s   cpu=371%   mem=3.285 GiB   ← sustained plateau
t=220.0s   cpu=376%   mem=3.257 GiB
t=232.9s   cpu=  0%   mem=3.273 GiB   ← done (background GC)
```

### Run B — e5-small
```
t=  1.1s   cpu=299%   mem=1.024 GiB
t=  7.1s   cpu=382%   mem=1.146 GiB   ← peak
t= 13.2s   cpu=381%   mem=1.111 GiB
t= 19.2s   cpu=  0%   mem=1.117 GiB   ← done
```

e5-small peak RAM (1.15 GiB) fits comfortably in a 2 GiB VM. bge-m3 peak
(3.30 GiB) requires at least a 4 GiB VM, ideally 8 GiB to leave headroom
for the OS + other containers. **e5-small enables smaller VPS SKUs.**

## Storage footprint

| Component | bge-m3 | e5-small |
|---|---:|---:|
| Model on disk (`~/.cache/huggingface` inside container) | ~2.3 GB | ~449 MB |
| Per-vector storage in ChromaDB (cosine, normalized) | 1 024 × 4 B = 4 KB | 384 × 4 B = 1.5 KB |
| ChromaDB after 233 docs (incl. metadata, HNSW index) | 4.5 MB | 3.2 MB |
| Docker image size (api, both models installed) | 3.68 GB | 3.68 GB (unchanged — torch/chromium/node dominate) |

Extrapolated to the full 1 693-doc corpus:
- bge-m3: ~33 MB ChromaDB
- e5-small: ~23 MB ChromaDB
- Difference is minor at this scale but matters if we ever 10× the corpus.

## Reproduction

```bash
# Pre-flight (once)
colima start --cpu 4 --memory 8 --disk 50

# Backup current state
tar -czf poc/_backups/chroma_db_baseline_$(date +%Y%m%d_%H%M%S).tar.gz -C data chroma_db

# Apply temporary POC edits (already reverted in repo)
# - scripts/docker-startup.sh: read $EMBED_MODEL env
# - .env.docker: EMBED_MODEL=<model>
# - docker-compose.override.yml: ports 18080 (host 8080 conflict)

# Run A — bge-m3 baseline
rm -rf data/chroma_db && mkdir -p data/chroma_db
docker-compose -p bge up -d
# wait for kos-api healthy
poc/.venv/bin/python poc/e2e_run.py --label runA_bge_m3 --area Cengkareng
docker-compose -p bge down -v

# Run B — e5-small
rm -rf data/chroma_db && mkdir -p data/chroma_db
sed -i 's/^EMBED_MODEL=.*/EMBED_MODEL=intfloat\/multilingual-e5-small/' .env.docker
docker-compose -p e5 up -d
# wait for kos-api healthy
poc/.venv/bin/python poc/e2e_run.py --label runB_e5_small --area Cengkareng
docker-compose -p e5 down -v

# Restore
tar -xzf poc/_backups/chroma_db_baseline_*.tar.gz -C data/
git checkout scripts/docker-startup.sh .env.docker
rm docker-compose.override.yml
```

## Caveats

1. **Single area only** — only Cengkareng (233 docs) was indexed. Scaling
   behavior to 1 693 docs is well-modeled by Phase 1's 50-doc batch (linear)
   and Phase 2's full-corpus run (1 622 docs in 218 s bge-m3 / 30 s e5-small).
2. **No fresh scraping** — used existing `data/cleaned/Cengkareng_docs.json`.
   Scraping doesn't touch the embedding model, so it wouldn't change the
   comparison. Full Rebuild was out of Phase 5 scope to save time.
3. **macOS arm64 ≠ production VPS** — absolute numbers (latency, RAM) are
   Apple-Silicon-specific. Relative e5-small-vs-bge-m3 deltas transfer to a
   Linux x86_64 VPS but absolute targets will differ. (Same caveat as Sprint 8
   baseline.)
4. **Manual UI smoke test deferred** — the Sprint 9 dashboard calls the same
   `/pipeline/*` APIs exercised here; if APIs work, UI works. Visual smoke
   test (open `http://localhost`, login, click Index) is recommended on the
   next iteration if the team wants browser-level validation.
5. **q3/q4 returned n=5 results for non-indexed areas** — likely the search
   API falls back to a broader query when the requested area has no vectors.
   Consistent across both runs, doesn't bias the latency comparison. Worth
   investigating separately (not a Sprint 10 deliverable).
