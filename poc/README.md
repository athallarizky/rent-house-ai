# Sprint 10 — E5-Small POC

Standalone benchmark + E2E validation for swapping `BAAI/bge-m3` →
`intfloat/multilingual-e5-small`. See `docs/sprint-10/tasks.md` for the full
plan and decision criteria.

## Layout

| Path | Purpose | Tracked? |
|---|---|---|
| `e5_small_probe.py` | Phase 1 — load e5-small, assert dim=384, measure RSS/latency vs bge-m3 | yes |
| `queries.json` | Phase 2.1 — held-out Indonesian queries + hand-labeled relevant doc_ids | yes |
| `bench_retrieval.py` | Phase 2.2 — build two throwaway Chroma collections, compute nDCG@5 / recall@5 | yes |
| `truncation_report.py` | Phase 3.1 — tokenize all `data/cleaned/*_docs.json` with e5 tokenizer, report truncation stats | yes |
| `chunk_probe.py` | Phase 3.2 — conditional, one-passage-per-review chunking strategy | yes |
| `e2e_run.py` | Phase 5 — sampler for `docker stats` + API timings during E2E runs | yes |
| `e2e_resource_report.md` | Phase 5 — paper-style resource comparison output | yes |
| `requirements.txt` | POC venv deps | yes |
| `.venv/` | local virtualenv | **gitignored** |
| `_chroma/` | throwaway ChromaDB for standalone benchmark | **gitignored** |
| `_backups/` | `data/chroma_db/` backup before Phase 5 wipe | **gitignored** |
| `_e2e_logs/` | docker stats samples + API timings | **gitignored** |
| `_results/` | JSON results from probe scripts | **gitignored** |

## Setup (Phase 0)

```bash
# From repo root, on branch feat/e5-small-poc
python3 -m venv poc/.venv
source poc/.venv/bin/activate
pip install -r poc/requirements.txt
```

First run will download both models (~2.3 GB bge-m3 + ~449 MB e5-small) into
`~/.cache/huggingface`. Subsequent runs are warm.

## Running each phase

```bash
# Activate venv first (see Setup).
source poc/.venv/bin/activate

# Phase 1 — probe + resource measurement
python poc/e5_small_probe.py

# Phase 2.1 — queries.json is hand-edited; review before running 2.2.

# Phase 2.2 — retrieval benchmark
python poc/bench_retrieval.py

# Phase 3.1 — truncation report
python poc/truncation_report.py

# Phase 3.2 — only if 3.1 shows >25% truncation
python poc/chunk_probe.py
```

Phase 5 (E2E) does not run from this venv — it drives the production Docker
stack. See `docs/sprint-10/tasks.md` § Phase 5 for the protocol.

## Outputs

- Numbers from Phase 1/2/3 are printed and also dumped to `poc/_results/*.json`
  for the decision report.
- Phase 5 writes `poc/e2e_resource_report.md` + raw samples in
  `poc/_e2e_logs/`.
- Phase 6 consolidates everything into `docs/sprint-10/reports/decision.md`.

## What this POC does NOT touch

Production logic stays untouched: `services/rag-engine/src/`, `api/src/`,
`services/data-processor/src/`, `services/scraper/`, `web/src/`,
`docker-compose.yml`, `Dockerfile.*`. Only `scripts/docker-startup.sh` gets a
temporary env-var edit during Phase 5, reverted before the branch is mergeable.
