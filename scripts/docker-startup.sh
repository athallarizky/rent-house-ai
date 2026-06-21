#!/usr/bin/env bash
# Kos AI — Docker startup
# 1. Pre-download embedding model (first run only, shows progress)
# 2. Seed admin user
# 3. Start FastAPI
set -e

echo "========================================="
echo "  Kos AI — Starting..."
echo "========================================="

# Pre-download the embedding model (first run: large download).
# Sprint 10/11 POC: read model from $EMBED_MODEL env (default bge-m3) so the
# same script works for both the bge-m3 baseline run and the e5-small POC run.
# Revert before merging (Sprint 10 only).
EMBED_MODEL="${EMBED_MODEL:-BAAI/bge-m3}"
echo ""
echo "[1/2] Checking embedding model ($EMBED_MODEL)..."
python -c "
import os, sys, time
start = time.time()
model_name = os.environ.get('EMBED_MODEL', 'BAAI/bge-m3')
print(f'  Loading sentence-transformers ({model_name})...', flush=True)
from sentence_transformers import SentenceTransformer
print(f'  Downloading model (first run may take a while)...', flush=True)
model = SentenceTransformer(model_name)
elapsed = time.time() - start
print(f'  Model ready ({elapsed:.0f}s)', flush=True)
" && echo "  ✓ Embedding model ready" || echo "  ⚠ Model setup failed, will retry on first search"

# Seed admin user
echo ""
echo "[2/2] Starting API server..."
# Sprint 8: bge-m3 (~2.3 GB) is loaded resident in each worker. Multi-worker
# uvicorn would duplicate the model and OOM an 8 GB VM. Pin to 1 worker; scale
# out via a separate TEI/embedding container (Sprint 9), not more workers.
exec python -m uvicorn api.src.main:app --host 0.0.0.0 --port 8080 --workers 1
