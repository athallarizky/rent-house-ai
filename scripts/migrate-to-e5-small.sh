#!/usr/bin/env bash
# ============================================================
#  Kos AI — Migrate embedding model: bge-m3 → e5-small
#  Sprint 11
# ============================================================
#
# Vector dimensions change (1024 → 384) so existing ChromaDB vectors are
# incompatible. This script:
#   1. Verifies the new EMBED_MODEL is configured
#   2. Backs up the existing data/chroma_db/
#   3. Wipes it
#   4. Restarts the API (loads e5-small + creates fresh collection)
#   5. Re-indexes every data/cleaned/*_docs.json via /pipeline/index
#   6. Verifies the final doc count via /pipeline/data
#
# Estimated time: ~3 minutes for a 1700-doc corpus on a 4-core VM
# (would be ~30 minutes if we were still on bge-m3).
#
# Usage:
#   ./scripts/migrate-to-e5-small.sh            # full migration
#   ./scripts/migrate-to-e5-small.sh --dry-run  # show plan without changes
#
# Requirements:
#   - Docker stack running (docker compose up -d)
#   - Admin credentials (defaults: admin@kos.ai / admin123)
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

# ----- config -----
API_URL="${API_URL:-http://localhost:4001}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@kos.ai}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"
NEW_MODEL="${EMBED_MODEL:-intfloat/multilingual-e5-small}"
DRY_RUN=false

# ----- colors -----
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
err()  { echo -e "  ${RED}✗${NC} $1"; }
info() { echo -e "  ${CYAN}➤${NC} $1"; }

# ----- parse args -----
for arg in "$@"; do
  case $arg in
    --dry-run) DRY_RUN=true ;;
    *) err "Unknown arg: $arg"; exit 2 ;;
  esac
done

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  Migrate: bge-m3 → multilingual-e5-small ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""

# ----- 0. sanity checks -----
info "Step 0: sanity checks"

if [ ! -f docker-compose.yml ]; then
  err "docker-compose.yml not found — run from repo root"
  exit 1
fi
ok "docker-compose.yml found"

if ! command -v curl >/dev/null; then
  err "curl required"
  exit 1
fi
ok "curl available"

# Stack up?
if ! curl -sf "$API_URL/health" >/dev/null 2>&1; then
  err "API not reachable at $API_URL — bring stack up first: docker compose up -d"
  exit 1
fi
ok "API reachable at $API_URL"

# Confirm EMBED_MODEL env / .env.docker is set to e5-small
if ! grep -q "EMBED_MODEL=$NEW_MODEL" .env.docker 2>/dev/null; then
  warn ".env.docker does not have EMBED_MODEL=$NEW_MODEL"
  warn "Edit .env.docker first, then docker compose down && up -d to apply."
  exit 1
fi
ok ".env.docker configured for $NEW_MODEL"

# Confirm cleaned docs exist
N_AREAS=$(ls data/cleaned/*_docs.json 2>/dev/null | wc -l | tr -d ' ')
if [ "$N_AREAS" -eq 0 ]; then
  err "no data/cleaned/*_docs.json files — nothing to re-index"
  exit 1
fi
ok "$N_AREAS area docs file(s) found in data/cleaned/"

# Confirm chroma_db exists and has content (otherwise nothing to migrate)
if [ ! -d data/chroma_db ] || [ -z "$(ls -A data/chroma_db 2>/dev/null)" ]; then
  warn "data/chroma_db is empty or missing — no migration needed (fresh install)"
  exit 0
fi
CHROMA_SIZE=$(du -sh data/chroma_db 2>/dev/null | cut -f1)
ok "current chroma_db size: $CHROMA_SIZE"

echo ""
if [ "$DRY_RUN" = true ]; then
  info "Dry-run mode — no changes will be made. Plan:"
  echo "  1. Backup data/chroma_db/ → data/chroma_db.bge-m3-backup.<timestamp>/"
  echo " 2. Wipe data/chroma_db/"
  echo "  3. Restart kos-api: docker compose restart api"
  echo "  4. Re-index $N_AREAS areas via POST /pipeline/index"
  echo "  5. Verify via GET /pipeline/data"
  exit 0
fi

# ----- 1. backup -----
info "Step 1: backup current chroma_db"
TS=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="data/chroma_db.bge-m3-backup.$TS"
mv data/chroma_db "$BACKUP_DIR"
mkdir -p data/chroma_db
ok "backed up to $BACKUP_DIR"

# ----- 2. restart API -----
info "Step 2: restart kos-api (loads $NEW_MODEL)"
docker compose restart api >/dev/null
ok "restart issued"

info "waiting for API to come back healthy..."
MAX_WAIT=300
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
  if curl -sf "$API_URL/health" >/dev/null 2>&1; then
    HEALTH=$(curl -s "$API_URL/health")
    if echo "$HEALTH" | grep -q '"model_ready":true'; then
      ok "API healthy + model ready (waited ${WAITED}s)"
      break
    fi
  fi
  sleep 5
  WAITED=$((WAITED + 5))
  if [ $((WAITED % 30)) -eq 0 ]; then
    warn "  still waiting (${WAITED}s)..."
  fi
done
if [ $WAITED -ge $MAX_WAIT ]; then
  err "API did not become healthy within ${MAX_WAIT}s"
  err "Restore backup: mv $BACKUP_DIR data/chroma_db && docker compose restart api"
  exit 1
fi

# ----- 3. login -----
info "Step 3: login as $ADMIN_EMAIL"
TOKEN=$(curl -s -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  "$API_URL/auth/login" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('token',''))" 2>/dev/null || echo "")
if [ -z "$TOKEN" ]; then
  err "login failed"
  exit 1
fi
ok "got token (${#TOKEN} chars)"

# ----- 4. re-index each area -----
info "Step 4: re-index $N_AREAS area(s) via /pipeline/index"
TOTAL_INDEXED_BEFORE=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_URL/pipeline/data" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(sum(a.get('indexed_count', 0) for a in d.get('areas', [])))
" 2>/dev/null || echo "0")
ok "indexed docs before reindex: $TOTAL_INDEXED_BEFORE"

for docs_file in data/cleaned/*_docs.json; do
  area=$(basename "$docs_file" _docs.json)
  echo ""
  info "indexing area: $area"

  # Trigger
  RESP=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"area\":\"$area\"}" "$API_URL/pipeline/index")
  if ! echo "$RESP" | grep -q "pipeline_started"; then
    if echo "$RESP" | grep -q "pipeline_blocked\|already running"; then
      warn "  pipeline busy, waiting for it to finish..."
    else
      warn "  unexpected response: $RESP"
    fi
  fi

  # Poll until done (or timeout 600s per area)
  MAX_POLL=600
  POLLED=0
  while [ $POLLED -lt $MAX_POLL ]; do
    STATUS=$(curl -s -H "Authorization: Bearer $TOKEN" "$API_URL/pipeline/status" \
      | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('status','?'))" 2>/dev/null || echo "?")
    if [ "$STATUS" = "completed" ] || [ "$STATUS" = "idle" ]; then
      PROGRESS=$(curl -s -H "Authorization: Bearer $TOKEN" "$API_URL/pipeline/status" \
        | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('progress','?'))" 2>/dev/null || echo "?")
      ok "  done: $PROGRESS"
      break
    fi
    sleep 5
    POLLED=$((POLLED + 5))
    if [ $((POLLED % 30)) -eq 0 ]; then
      warn "  still $STATUS after ${POLLED}s..."
    fi
  done
  if [ $POLLED -ge $MAX_POLL ]; then
    err "  area $area timed out after ${MAX_POLL}s"
  fi
done

# ----- 5. verify -----
echo ""
info "Step 5: verify final state"
TOTAL_INDEXED_AFTER=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_URL/pipeline/data" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(sum(a.get('indexed_count', 0) for a in d.get('areas', [])))
" 2>/dev/null || echo "0")
N_INDEXED_AREAS=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_URL/pipeline/data" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(sum(1 for a in d.get('areas', []) if a.get('indexed_count', 0) > 0))
" 2>/dev/null || echo "0")
ok "indexed docs after reindex: $TOTAL_INDEXED_AFTER  (across $N_INDEXED_AREAS areas)"

CHROMA_SIZE_NEW=$(du -sh data/chroma_db 2>/dev/null | cut -f1)
ok "new chroma_db size: $CHROMA_SIZE_NEW  (was $CHROMA_SIZE)"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Migration complete! 🎉                  ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo "  Backup location: $BACKUP_DIR"
echo "  Verify searches work:"
echo "    curl -H \"Authorization: Bearer $TOKEN\" \\"
echo "      -d '{\"query\":\"wifi kenceng\",\"area\":\"Cengkareng\",\"mode\":\"rag\"}' \\"
echo "      -H 'Content-Type: application/json' \\"
echo "      $API_URL/search | python3 -m json.tool"
echo ""
echo "  Rollback (if needed):"
echo "    docker compose down"
echo "    rm -rf data/chroma_db"
echo "    mv $BACKUP_DIR data/chroma_db"
echo "    # revert EMBED_MODEL in .env.docker to BAAI/bge-m3"
echo "    docker compose up -d"
echo ""
