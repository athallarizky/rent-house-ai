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
# Default since Sprint 11 is intfloat/multilingual-e5-small (~449 MB, 384-dim).
# Override with EMBED_MODEL env to swap models (e.g. back to BAAI/bge-m3).
EMBED_MODEL="${EMBED_MODEL:-intfloat/multilingual-e5-small}"
echo ""
echo "[1/2] Checking embedding model ($EMBED_MODEL)..."
python -c "
import os, sys, time
start = time.time()
model_name = os.environ.get('EMBED_MODEL', 'intfloat/multilingual-e5-small')
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
# The embedding model (~449 MB for e5-small, ~2.3 GB for bge-m3) is loaded
# resident in each worker. Multi-worker uvicorn would duplicate the model and
# OOM a small VM. Pin to 1 worker; scale out via a separate embedding
# container if needed, not more workers.
exec python -m uvicorn api.src.main:app --host 0.0.0.0 --port 8080 --workers 1
