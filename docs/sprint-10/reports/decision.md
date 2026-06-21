# Sprint 10 — Decision Report: e5-small vs bge-m3

> **Decision: GO** — swap `BAAI/bge-m3` → `intfloat/multilingual-e5-small` in Sprint 11.
>
> Branch: `feat/e5-small-poc` (POC only — no production code merged)
> Author: athallarizky | Date: 2026-06-21
> Time invested: ~7 h across 6 phases (1 under the 7.75 h estimate)

---

## TL;DR

**Quality cost is small (3-5 %); resource wins are large (5-12 ×).** e5-small is
competitive on retrieval quality on our actual kos data, decisively faster on
encode + search latency, and uses a fraction of the RAM. The 512-token context
truncates only 9.6 % of docs (loss concentrated in trailing reviews, recoverable
via chunking if it ever matters). **Recommendation: swap.**

## Headline numbers

### Quality (Phase 2, standalone benchmark — 25 queries, 1 622-doc corpus)

| Metric | bge-m3 | e5-small | Δ | Verdict |
|---|---:|---:|---:|---|
| avg nDCG@5 | 0.5712 | 0.5520 | −0.0192 (−3.4 %) | acceptable |
| avg recall@5 | 0.1298 | 0.1229 | −0.0068 (−5.3 %) | acceptable |
| avg hits@5 (of avg 24.7 relevant) | 2.84 | 2.64 | −0.20 | acceptable |

Per-query picture is uneven: e5 wins on q04 (+0.34), q10 (+0.32), q16 (+0.21);
loses on q11 (−0.47), q09 (−0.34), q18 (−0.25). Three queries (q03, q19, q25)
both models fail — niche intents with 4-5 labels, doesn't bias the comparison.

### Resources — standalone (Phase 1, subprocess-isolated, 50-doc batch)

| Metric | bge-m3 | e5-small | Δ |
|---|---:|---:|---:|
| Embedding dim | 1024 | 384 | −640 |
| Cold-load time | 10.99 s | 22.52 s | +11.53 s (startup-only) |
| Warm encode (50 docs) | 8.69 s | 0.79 s | −7.90 s (**11 × faster**) |
| Peak RSS | 1 255 MiB | 776 MiB | −479 MiB |
| Model delta RSS | 922 MiB | 445 MiB | −477 MiB |

### Resources — E2E Docker (Phase 5, full stack, 233-doc real ingest via API)

| Metric | bge-m3 | e5-small | Δ |
|---|---:|---:|---:|
| Indexing 233 docs | 232.9 s | 19.2 s | −213.7 s (**12 × faster**) |
| Peak RAM during indexing | 3.30 GiB | 1.15 GiB | −2.15 GiB (**−65 %**) |
| Idle RAM (model resident) | 727 MiB | 743 MiB | +16 MiB (same) |
| ChromaDB storage | 4.5 MiB | 3.2 MiB | −1.3 MiB (−29 %) |
| Warm search latency (avg) | 193 ms | 56 ms | −137 ms (**3.4 × faster**) |
| Cold search latency (q1) | 510 ms | 67 ms | −443 ms (**7.6 × faster**) |
| Peak CPU during indexing | ~400 % | ~380 % | ~same (4-core saturated) |

### Truncation (Phase 3)

| Metric | e5-small (512) | bge-m3 (8192) |
|---|---:|---:|
| Full corpus mean tokens | 222.2 | 222.2 |
| p90 | 499 | 499 |
| p99 | 987 | 987 |
| prod-capped (4000 chars) max | 1 056 | 1 054 |
| % docs truncated | **9.63 %** | 0 % |
| Mean chars lost on truncated docs | 963 | — |
| Total chars lost across corpus | 156 890 | — |

Verdict: **MINOR TRUNCATION** (9.6 % < 25 % threshold). The truncated docs lose
trailing (lowest-rated) reviews per `build_doc.py:85` sort; header + top-rated
reviews survive. Phase 2's −3.4 % nDCG already includes this effect end-to-end.
Chunking (Phase 3.2) **not needed** for go/no-go.

## Recommendation

**Move to `intfloat/multilingual-e5-small`** in Sprint 11.

### Rationale

1. **Quality gap is bounded and even.** −3.4 % nDCG / −5.3 % recall is well
   inside noise for an Indonesian kos corpus of this size. Per-query deltas go
   both directions; some queries e5 wins decisively.
2. **Resource wins are decisive and production-shaped.** Phase 5 ran the actual
   Docker stack — same images, same API, same ChromaDB, same data flow. 12 ×
   faster indexing + 3-4 × faster search + 65 % lower peak RAM are not standalone
   artifacts; they show up at the API level.
3. **Enables smaller infrastructure.** bge-m3's 3.3 GiB peak indexing RAM
   requires ≥4 GiB VM; e5-small's 1.15 GiB peak fits in 2 GiB. Direct cost win
   for VPS SKU selection.
4. **Truncation is manageable.** 9.6 % truncation concentrated in long-tail
   docs. If we ever measure a regression in production, chunking is a localized
   follow-up that doesn't unwind the migration.
5. **Prefix wiring is localized.** Adding `"query: "` / `"passage: "` is two
   small edits in `search.py:41` and `ingest.py:88-90`. Centralize in one helper
   to prevent forgotten prefixes (the riskier failure mode per tasks.md).

### Counter-arguments considered

- **Cold-load regression** (e5-small 22.5 s vs bge-m3 11 s): startup-only via
  `model_cache.py` singleton. First-request latency unaffected after boot.
  Negligible operational impact.
- **Single-sample prefix ablation** showed cosine *slightly higher* without
  prefix — model card is clear that prefixes are mandatory on average; we use
  them.
- **q11 "24 jam" regression (−0.47 nDCG)**: largest single regression. Worth
  investigating in Sprint 11 acceptance tests, but not blocking — average is
  what matters for the swap decision.
- **3 queries both models fail (q03, q19, q25)**: niche intents with few
  labels. Not a model-quality issue; would need query expansion or more labels
  to evaluate. Out of scope for this decision.

## Migration plan (Sprint 11 draft)

Sprint 11 should land on top of current `main` (which has Sprint 8 in-process
+ Sprint 9 dashboard actions). Estimated 3-4 h of work:

### T1 — Prefix helper
- Add `services/rag-engine/src/prefixes.py` with two functions:
  - `prefix_query(s: str) -> str` → `"query: " + s`
  - `prefix_passage(s: str) -> str` → `"passage: " + s`
- Empty when `EMBED_MODEL` doesn't require prefixes (gated by model name).

### T2 — Wire prefixes
- `services/rag-engine/src/ingest.py:88-90` — wrap `safe_texts` with prefix.
- `services/rag-engine/src/search.py:39` (in-process path) — wrap query.
- Any other call site (grep for `model.encode(`).

### T3 — Default model + startup script
- `services/rag-engine/src/config.py:12` — default to `intfloat/multilingual-e5-small`.
- `scripts/docker-startup.sh:15-24` — replace hardcoded `BAAI/bge-m3` with
  `${EMBED_MODEL:-intfloat/multilingual-e5-small}`. This is the change we
  prototyped in Phase 5 (revertible on the POC branch via `git checkout`).

### T4 — ChromaDB wipe + re-ingest script
- New `scripts/migrate-e5-small.sh`:
  1. Stop API
  2. Backup `data/chroma_db/` → `data/chroma_db.bge-m3-backup.<timestamp>/`
  3. Wipe `data/chroma_db/`
  4. Start API (creates fresh 384-dim collection)
  5. Loop all `data/cleaned/*_docs.json` → POST `/pipeline/index` per area
  6. Verify count via `GET /pipeline/data`
- Estimated re-ingest time at Phase 5 rates: ~3-4 min for full 1 693-doc corpus.

### T5 — Acceptance tests
- Re-run `poc/bench_retrieval.py` against production `kos_indonesia` collection
  to confirm nDCG@5 ≈ Phase 2 numbers (sanity, not regression gate).
- Re-run `poc/truncation_report.py` against live ingest path to confirm no
  silent truncation regression.
- Manual smoke: open `http://localhost`, login, run 5 chat searches, verify
  sensible results.

### T6 — Docs
- Update all 1024-dim / 8192-token references (search `docs/sprint-*/`).
- Update `services/rag-engine/src/model_cache.py:1` docstring (says "bge-m3 ~2.3 GB").
- Update `services/rag-engine/src/ingest.py:82-83` comment about `MAX_DOC_CHARS`
  (the bge-m3 attention-buffer workaround may no longer apply to e5-small at
  512-token limit — likely can stay at 4000 chars since 4000 chars ≈ 1000
  tokens which exceeds 512 anyway, so the cap is moot for truncation).

### Risks for Sprint 11

| Risk | Mitigation |
|---|---|
| Prefix forgotten at a new call site | Centralize in `prefixes.py`, grep-gate in CI |
| Re-ingest fails mid-corpus | Per-area migration script with idempotent `existing_ids` check (already in `ingest.py:62-67`) |
| Dimension mismatch crash on stale vectors | Wipe is mandatory; document in migration script |
| Quality regression on unseen query types | Sprint 11 acceptance test re-runs `bench_retrieval.py`; rollback path = restore backup + revert `EMBED_MODEL` |
| `e5-base` might be a better middle ground | Out of scope unless Sprint 11 acceptance shows >10 % regression |

## Out of scope for Sprint 11

- `e5-base` / `e5-large` evaluation (only if e5-small NO-GO'd — it didn't)
- Quantization / FP16 / ONNX optimization
- GPU deployment
- Chunking strategy (deferred unless production regression is observed)
