# Sprint 10 — Embedding Refactor POC: `multilingual-e5-small`

> Status: ⬜ Pending | Created: 2026-06-20
> Branch: `feat/e5-small-poc`
> Based on: `feat/in-process-embedding` (Sprint 8)
> Type: **Research / POC — no production code changes this sprint**

Status legend: ⬜ pending | 🔵 in_progress | ✅ completed | ❌ blocked

---

## Goal

Validate replacing the current embedding model **`BAAI/bge-m3`** with
**`intfloat/multilingual-e5-small`** as a lighter, faster alternative. This
sprint is **POC + benchmark only** — the production swap (if the POC says go) is
a follow-up sprint. The deliverable is a decision report, not merged code.

Primary motivation: cut the model footprint from **~2.3 GB → ~449 MB** (~5×
smaller) and reduce CPU inference cost, which directly helps Sprint 8's
"in-process embedding" goal of running the model resident in the FastAPI process.

> ⚠️ **Scope guard:** every task below is a POC measurement or standalone script.
> Nothing in `services/rag-engine/src/`, `api/src/`, `docker-compose.yml`, or
> `scripts/docker-startup.sh` is modified for production this sprint. The actual
> refactor lives in a follow-up "Sprint 11 — E5 migration" *after* the go/no-go
> decision in Phase 4.

---

## Model Comparison

| Property | `multilingual-e5-small` (target) | `BAAI/bge-m3` (current) |
|---|---|---|
| **Embedding dim** | **384** | 1024 |
| **Max token context** | **512** | 8192 |
| **Model size** | **~449 MB** (safetensors) | ~2.3 GB |
| Architecture | 12-layer BERT (XLM-RoBERTa) | XLM-RoBERTa, much larger |
| Vocab size | 250 037 (XLM-R) | ~250k |
| Languages | 100, **`id` supported** | 100+, strong Indonesian |
| Library | `sentence-transformers` ✅ | `sentence-transformers` ✅ |
| License | MIT | MIT |
| Downloads | ~9.8M (very popular) | — |
| Init from | `microsoft/Multilingual-MiniLM-L12-H384` | — |
| Paper | arXiv 2402.05672 (Wang et al., 2024) | — |

Source: HuggingFace model card + `config.json`
(`hidden_size: 384`, `max_position_embeddings: 512`, `model_type: bert`).

---

## Critical Findings (the three things that decide this)

### 1. Mandatory `query:` / `passage:` prefix

From the model card FAQ:

> *"Do I need to add the prefix `query: ` and `passage: ` to input texts?*
> ***Yes**, this is how the model is trained, otherwise you will see a
> performance degradation."*

Rules of thumb:
- **Retrieval (asymmetric):** query → `"query: …"`, document → `"passage: …"`.
- **Symmetric tasks** (similarity, clustering): everything → `"query: …"`.

Impact on our code (in the **follow-up** migration sprint, NOT this one):
- `services/rag-engine/src/ingest.py:88-90` — document texts must be prefixed
  `"passage: "` before `model.encode(...)`.
- `services/rag-engine/src/search.py:41` — query must be prefixed `"query: "`.

Pooling (average pool) and L2-normalization are handled automatically by
`sentence-transformers` (the repo ships a `1_Pooling` module), so
`model.encode(texts, normalize_embeddings=True)` suffices. This is consistent
with ChromaDB's cosine metric.

### 2. Dimension change 1024 → 384 ⇒ full re-ingest required

ChromaDB is schemaless but **locks the collection dimensionality to the first
vector inserted.** The current `kos_indonesia` collection holds **1024-dim**
vectors (documented at `docs/sprint-1/reports/phase-4-report.md:113,133,159` and
`docs/sprint-3/AGENTS.md:66`). 384-dim vectors **cannot** be mixed in. A
production swap therefore requires:

- Wipe + recreate the `kos_indonesia` collection (or use a new collection name),
- Re-embed **all** indexed kos areas from their `data/cleaned/*_docs.json`.

This is a one-time, scriptable migration but it is the cost of switching.

### 3. Context window 8192 → 512 tokens (the biggest quality risk)

This is the most consequential change for our use case and the main thing the
POC must quantify.

- Today `ingest.py:85-86` caps each document at `MAX_DOC_CHARS = 4000`. That cap
  is a **bge-m3-specific workaround** for an attention-buffer OOM (RCA-005), not
  a model limit — bge-m3 natively supports 8192 tokens.
- A kos document bundles many Google Maps reviews
  (`services/data-processor/src/build_doc.py:28-55`), so a popular kos easily
  exceeds 512 tokens (~**1 500–2 000 Indonesian characters**).
- With e5-small, everything past 512 tokens is **silently truncated**. Queries
  like `"wifi kenceng"` / `"ac dingin parkir luas"` may lose the relevant
  reviews → **retrieval quality regression**, worst for high-review kos.
- Mitigations to evaluate in the POC: per-review chunking, lowering
  `MAX_DOC_CHARS` to fit 512 tokens, or per-field embedding. All are extra
  pipeline complexity that bge-m3 lets us avoid today.

---

## Quality: Indonesian specifically

Mr. TyDi benchmark (model card) — MRR@10:

| Model | Avg | **id (Indonesia)** | en | ja | ko |
|---|---|---|---|---|---|
| multilingual-e5-small | 64.4 | **63.2** | 54.5 | 55.4 | 54.3 |
| multilingual-e5-base | 65.9 | 64.9 | 58.5 | 56.6 | 55.8 |
| multilingual-e5-large | **70.5** | 68.5 | 60.8 | 62.5 | 61.6 |

e5-small's Indonesian score (63.2) is respectable. bge-m3 is generally regarded
as multilingual SOTA and is a larger model (1024-dim, 16× the context), so it is
expected to outperform e5-small on raw quality — especially on long documents.
**The POC's job is to measure the actual gap on *our* data**, not assume it.

---

## Migration Touch Points (for the follow-up sprint — awareness only)

| File | Line(s) | Change |
|---|---|---|
| `services/rag-engine/src/config.py` | 12 | Default `EMBED_MODEL` |
| `services/rag-engine/src/ingest.py` | 85-90 | `passage:` prefix; revisit `MAX_DOC_CHARS`; possible chunking |
| `services/rag-engine/src/search.py` | 41 | `query:` prefix |
| `services/rag-engine/src/model_cache.py` | 8-21 | Transparent (already uses `SentenceTransformer(EMBED_MODEL)`) |
| `scripts/docker-startup.sh` | 15-24 | **Hardcoded `BAAI/bge-m3`** — must update (does NOT read the env var today) |
| ChromaDB `kos_indonesia` | — | Wipe + recreate (dimension 1024 → 384) |
| `docs/sprint-*/...` | — | Update 1024-dim / 8192-token references |

---

## Tasks

### Phase 1 — POC Harness (standalone, no production edits)

| ID | Task | Where | Est | Status |
|----|------|-------|-----|--------|
| 1.1 | Standalone script: load `intfloat/multilingual-e5-small` via `sentence-transformers`, verify dim = 384, confirm `query:`/`passage:` prefix behavior, print a sample embedding | `poc/e5_small_probe.py` (NEW, gitignored or under `docs/sprint-10/poc/`) | 0.5h | ⬜ |
| 1.2 | Resource measurement: peak RSS, cold-load time, and per-encode latency for e5-small vs bge-m3 on the same 50-doc batch (CPU). Record numbers in this doc's Phase 4 | `poc/e5_small_probe.py` | 0.5h | ⬜ |

### Phase 2 — Retrieval Quality Benchmark

| ID | Task | Where | Est | Status |
|----|------|-------|-----|--------|
| 2.1 | Build a held-out query set (20–30 realistic Indonesian kos queries, e.g. `"wifi kenceng"`, `"ac dingin parkir luas"`, `"kos putri depan stasiun"`) with hand-labeled relevant kos per area | `poc/queries.json` | 0.75h | ⬜ |
| 2.2 | Build two **separate, throwaway** ChromaDB collections: one indexed with bge-m3 (existing behavior) and one with e5-small (+ correct prefixes). Query both, compute nDCG@5 / recall@5 per query set | `poc/bench_retrieval.py` | 1.5h | ⬜ |

### Phase 3 — Truncation Impact Analysis

| ID | Task | Where | Est | Status |
|----|--------|-------|-----|--------|
| 3.1 | For every doc in `data/cleaned/*_docs.json`, tokenize with the e5-small tokenizer and report: % of docs fully under 512 tokens, mean/median tokens, and how many characters of review text are lost on the over-long ones | `poc/truncation_report.py` | 0.75h | ⬜ |
| 3.2 | If loss is material (>25% of docs truncated), prototype one chunking strategy (e.g. one passage per review) and re-measure retrieval from 2.2 to see if chunking recovers the gap | `poc/chunk_probe.py` | 1.0h | ⬜ |

### Phase 4 — Decision Report

| ID | Task | Est | Status |
|----|------|-----|--------|
| 4.1 | Write decision report here (§ Decision below): go/no-go on e5-small, with the measured numbers, the truncation verdict, and a recommended model (small vs base vs keep bge-m3) | 0.5h | ⬜ |
| 4.2 | If GO: draft the follow-up "Sprint 11 — E5 migration" task list (prefix wiring, chunking if needed, ChromaDB wipe script, startup-script fix, re-ingest). If NO-GO: record why and close | 0.5h | ⬜ |

---

## Detailed Notes

### T1.1 — Probe script skeleton

```python
# poc/e5_small_probe.py  — standalone, run outside Docker against local torch
from sentence_transformers import SentenceTransformer

MODEL = "intfloat/multilingual-e5-small"
model = SentenceTransformer(MODEL)

q = model.encode(["query: wifi kenceng"], normalize_embeddings=True)
p = model.encode(["passage: kos dengan wifi fiber 100Mbps..."], normalize_embeddings=True)
print("dim:", q.shape[1])              # expect 384
print("cos:", float((q @ p.T)[0][0]))  # sanity
```

### T2.2 — Benchmark fairness

- Both collections must use **cosine** (`metadata={"hnsw:space": "cosine"}`,
  matching `ingest.py:25`) and the **same `top_k`** as production
  (`SEARCH_TOP_K`, default 20, `config.py:34`).
- Prefix e5-small correctly (`passage:` for docs, `query:` for the query);
  leave bge-m3 unprefixed (it needs none). Mixing conventions would bias the
  result against e5-small.

### T3.1 — Why truncation is the swing factor

A kos document today is: header (alamat, rating, fasilitas, tipe, harga) + N
reviews. The header is short and high-signal; the reviews are long and where
search terms like `"wifi lemot"` actually live. If 512 tokens cuts into the
reviews, the header alone may still retrieve on obvious terms but miss the
nuanced ones — which is exactly what this RAG is for. **The truncation report is
the single most decision-relevant output of this sprint.**

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **512-token truncation loses review content** | Quality regression on nuanced queries | Phase 3 measures it; chunking (T3.2) is the fallback, but adds pipeline complexity — may tip the decision to `e5-base` or to keep bge-m3 |
| Re-ingest cost (1024 → 384) on swap | One-time op, but blocks the cut-over | Script it in Sprint 11; can run per-area with progress visible on the Sprint-7 dashboard |
| `query:`/`passage:` prefix forgotten at a call site | Silent quality degradation | Centralize prefixing in one helper used by both `ingest.py` and `search.py` (Sprint 10 design) |
| e5-small underperforms bge-m3 on our data | POC yields NO-GO | That is an acceptable POC outcome; `e5-base` (768-dim, ~2.2 GB) is a middle ground to re-evaluate |
| Interaction with Sprint 8 (in-process) | Both touch `model_cache.py` / `ingest.py` / `search.py` | Sequence: land Sprint 8 first (in-process with bge-m3), then Sprint 10 model swap on top — avoids double-editing the same files |

---

## Sequencing Note

This sprint branches from `feat/pipeline-dashboard` (Sprint 7), **before** Sprint
8 (in-process embedding). Recommendation:

1. **Sprint 8 first** — move bge-m3 in-process (the bigger, riskier change).
2. **Sprint 10 POC** — can run in parallel; it's standalone scripts, no shared
   files.
3. **Sprint 11 (if GO)** — swap the model; small diff on top of Sprint 8's
   in-process architecture, since prefixes are a localized change.

The Sprint-7 pipeline dashboard is the observation tool for re-ingest progress
(Sprint 11) and for watching the in-process speedup (Sprint 8).

---

## Out of Scope

- **Any production code change** — `config.py`, `ingest.py`, `search.py`,
  `model_cache.py`, `docker-compose.yml`, `scripts/docker-startup.sh` stay
  untouched this sprint. That is the entire Sprint 10.
- **ChromaDB wipe / re-ingest of `kos_indonesia`** — Sprint 10.
- **`e5-base` / `e5-large` deep dive** — only revisited if e5-small NO-GOs and a
  middle ground is wanted (Phase 4.1).
- **Quantization / FP16 / ONNX** — separate optimization track; out of scope.
- **GPU** — not needed at current scale; CPU inference is the target.

---

## Summary

| Phase | Tasks | Est |
|-------|-------|-----|
| 1 — POC harness + resource measurement | 2 | 1.0h |
| 2 — Retrieval quality benchmark | 2 | 2.25h |
| 3 — Truncation impact analysis | 2 | 1.75h |
| 4 — Decision report + Sprint 10 draft | 2 | 1.0h |
| **Total** | **8** | **~6.0h** |

---

## Decision (fill in during Phase 4)

> *To be completed after POC. Record: chosen model, measured quality delta,
> measured resource delta, truncation verdict, and go/no-go with rationale.*

- **Quality delta (nDCG@5 e5-small vs bge-m3):** _TBD_
- **Resource delta (RSS / load time / encode latency):** _TBD_
- **Truncation verdict (% docs cut, chars lost):** _TBD_
- **Recommendation:** _keep bge-m3 / move to e5-small / move to e5-base_
- **Rationale:** _TBD_
