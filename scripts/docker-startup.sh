#!/usr/bin/env bash
# Kos AI — Docker startup
# 1. Pre-download embedding model (first run only, shows progress)
# 2. Seed admin user
# 3. Start FastAPI
set -e

echo "========================================="
echo "  Kos AI — Starting..."
echo "========================================="

# Pre-download the embedding model (first run: ~2.3GB download)
echo ""
echo "[1/2] Checking embedding model..."
python -c "
import sys, time
start = time.time()
print('  Loading sentence-transformers (bge-m3)...', flush=True)
from sentence_transformers import SentenceTransformer
print('  Downloading model (first run may take 2-5 min)...', flush=True)
model = SentenceTransformer('BAAI/bge-m3')
elapsed = time.time() - start
print(f'  Model ready ({elapsed:.0f}s)', flush=True)
" && echo "  ✓ Embedding model ready" || echo "  ⚠ Model setup failed, will retry on first search"

# Seed admin user
echo ""
echo "[2/2] Starting API server..."
exec python -m uvicorn api.src.main:app --host 0.0.0.0 --port 8080
