# Sprint 11 — E5 Migration: `bge-m3` → `multilingual-e5-small`

> Status: ⬜ Pending | Created: 2026-06-21
> Branch: `feat/e5-migration` (to be created off `main`)
> Based on: Sprint 10 POC decision (`docs/sprint-10/reports/decision.md`)
> Type: **Production migration — code changes land**
> Estimated effort: **~3-4 h** (6 tasks)

Status legend: ⬜ pending | 🔵 in_progress | ✅ completed | ❌ blocked

---

## Goal

Swap the production embedding model from `BAAI/bge-m3` (~2.3 GB, 1024-dim,
8192-token context) to `intfloat/multilingual-e5-small` (~449 MB, 384-dim,
512-token context). Sprint 10 measured: **−3.4 % nDCG, 12 × faster indexing,
3-4 × faster search, 65 % lower peak RAM, 29 % smaller ChromaDB** — net win.

This sprint lands the swap in production. All Phase 5 E2E numbers must
reproduce within ±10 % on the same Docker stack.

---

## Migration touch points (verified against current `main` HEAD `ab20cff`)

| File | Line(s) | Change |
|---|---|---|
| `services/rag-engine/src/prefixes.py` | (NEW) | Centralized prefix helper — single source of truth |
| `services/rag-engine/src/config.py` | 12 | Default `EMBED_MODEL` → `intfloat/multilingual-e5-small` |
| `services/rag-engine/src/ingest.py` | 88-90 | Wrap doc texts with `prefix_passage(...)` before encode |
| `services/rag-engine/src/search.py` | 39 | Wrap query with `prefix_query(...)` before encode |
| `services/rag-engine/src/model_cache.py` | 1, 4-5 | Update docstring (no logic change — already reads `EMBED_MODEL`) |
| `services/rag-engine/src/ingest.py` | 82-86 | Revisit `MAX_DOC_CHARS=4000` comment — was bge-m3 attention workaround; e5-small truncates at 512 tokens (~1 500-2 000 chars) anyway, so cap is now moot. Keep value, update comment. |
| `scripts/docker-startup.sh` | 15-24 | Hardcoded `BAAI/bge-m3` → `${EMBED_MODEL:-intfloat/multilingual-e5-small}` |
| ChromaDB `kos_indonesia` | — | Wipe + recreate (dim 1024 → 384). One-time op via `scripts/migrate-e5-small.sh` |
| `docs/sprint-*/...` | — | Replace 1024-dim / 8192-token references |

---

## Tasks

### Phase 1 — Code changes (~1.5 h)

| ID | Task | Where | Est | Status |
|----|------|-------|-----|--------|
| 1.1 | Create `prefixes.py` with `prefix_query()` and `prefix_passage()` (no-op for models that don't require prefixes, gated by model name) | `services/rag-engine/src/prefixes.py` | 0.25 h | ⬜ |
| 1.2 | Wire prefix helper at the two encode call sites: `ingest.py:88` (docs) and `search.py:39` (query) | `services/rag-engine/src/{ingest,search}.py` | 0.25 h | ⬜ |
| 1.3 | Change default `EMBED_MODEL` in `config.py:12` to `intfloat/multilingual-e5-small` | `services/rag-engine/src/config.py` | 0.1 h | ⬜ |
| 1.4 | Update `scripts/docker-startup.sh` to read `$EMBED_MODEL` env (matches the temporary POC edit from Sprint 10 Phase 5 — see `feat/e5-small-poc` history) | `scripts/docker-startup.sh` | 0.25 h | ⬜ |
| 1.5 | Grep all `model.encode(` / `SentenceTransformer(` call sites — verify none missed | whole repo | 0.25 h | ⬜ |
| 1.6 | Update docstrings/comments referencing "bge-m3 ~2.3 GB" or 1024-dim (model_cache.py, ingest.py comment block, etc.) | `services/rag-engine/src/` | 0.25 h | ⬜ |
| 1.7 | Add a unit test for `prefixes.py` (model-name gating + prefix correctness) | `services/rag-engine/tests/test_prefixes.py` | 0.15 h | ⬜ |

### Phase 2 — Migration tooling (~1 h)

| ID | Task | Where | Est | Status |
|----|------|-------|-----|--------|
| 2.1 | Write `scripts/migrate-e5-small.sh`: backup `data/chroma_db/`, wipe, restart API, loop `data/cleaned/*_docs.json` → POST `/pipeline/index` per area, verify counts | `scripts/migrate-e5-small.sh` | 0.5 h | ⬜ |
| 2.2 | Dry-run the migration on local Docker (Sprint 10 Phase 5 stack). Time the full 1 693-doc reingest. Expected: ~3-4 min per Phase 5 extrapolation | local | 0.5 h | ⬜ |

### Phase 3 — Acceptance tests (~1 h)

| ID | Task | Est | Status |
|----|------|-----|--------|
| 3.1 | Re-run `poc/bench_retrieval.py` against the freshly-migrated production collection. Confirm avg nDCG@5 ≈ 0.55 (matches Phase 2 within ±5 %) | 0.25 h | ⬜ |
| 3.2 | Re-run `poc/truncation_report.py` to confirm tokenizer still truncates ~9-10 % of docs (sanity, not regression gate) | 0.15 h | ⬜ |
| 3.3 | Manual UI smoke: open `http://localhost`, login, run 5 chat searches, verify sensible results. Pay attention to q11 "akses 24 jam" (largest Phase 2 regression) | 0.25 h | ⬜ |
| 3.4 | Re-measure indexing + search latency via `poc/e2e_run.py`. Confirm 12 × faster indexing + 3-4 × faster search reproduce within ±10 % | 0.25 h | ⬜ |
| 3.5 | Run for 24 h soak on local Docker; check for memory leaks, model reloads, or unexpected errors | 0.1 h (setup) + wait | ⬜ |

### Phase 4 — Rollout + docs (~0.5 h)

| ID | Task | Est | Status |
|----|------|-----|--------|
| 4.1 | Update `docs/sprint-*/...` references to 1024-dim / 8192-token → 384-dim / 512-token | 0.25 h | ⬜ |
| 4.2 | Merge `feat/e5-migration` → `main`. Tag release. | 0.15 h | ⬜ |
| 4.3 | Production rollout: SSH to VPS, `git pull`, run `scripts/migrate-e5-small.sh`, monitor `/pipeline/data` + `/health` for 1 h | 0.5 h | ⬜ |

---

## Rollback plan

If acceptance tests fail (nDCG drops >10 %, search slower than expected,
ingest crashes):

1. `git revert` the merge commit on `main`.
2. On VPS: `git pull` (back to bge-m3 default).
3. Restore `data/chroma_db/` from `data/chroma_db.bge-m3-backup.<timestamp>/` created by `migrate-e5-small.sh`.
4. Restart API.

Total rollback time: <5 min. Backup is mandatory before migration script runs.

---

## Out of scope

- `e5-base` / `e5-large` evaluation — only revisit if Sprint 11 acceptance shows >10 % regression (Sprint 10 says it won't).
- Chunking for the 9.6 % truncated long-tail docs — defer unless production regression observed.
- Quantization / FP16 / ONNX — separate optimization track.
- GPU deployment — not needed at current scale.

---

## References

- Sprint 10 decision report: `docs/sprint-10/reports/decision.md`
- Sprint 10 E2E resource comparison: `poc/e2e_resource_report.md`
- Sprint 10 standalone benchmark: `poc/_results/bench_retrieval_results.json`
- Sprint 10 truncation analysis: `poc/_results/truncation_report.json`
- Sprint 8 baseline (pre-Sprint-8-subprocess baseline): `docs/sprint-8/baseline.md`
