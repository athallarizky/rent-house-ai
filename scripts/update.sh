#!/usr/bin/env bash
# ============================================================
#  Kos AI — Update VPS deployment (release/standalone)
#    ./scripts/update.sh             # pull + restart, reuse images
#    ./scripts/update.sh --rebuild   # pull + rebuild images (if Dockerfile changed)
# ============================================================
# Run this ON the VPS, inside the rent-house-ai checkout.
set -euo pipefail
cd "$(dirname "$0")/.."

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
info() { echo -e "  ${CYAN}➤${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }

REBUILD=0
if [ "${1:-}" = "--rebuild" ]; then
    REBUILD=1
fi

echo ""
echo -e "${CYAN}╔═══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   Kos AI — Update VPS Deployment     ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════╝${NC}"
echo ""

# Pre-flight: confirm we're on the right branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "release/standalone" ]; then
    warn "Currently on branch '$BRANCH', expected 'release/standalone'"
    read -p "  Continue anyway? [y/N] " ans
    [ "$ans" = "y" ] || exit 1
fi
ok "On branch: $BRANCH"

# Step 1: git fetch + show diff
info "Fetching latest from origin..."
BEFORE=$(git rev-parse HEAD)
git fetch origin "$BRANCH"
AFTER=$(git rev-parse "origin/$BRANCH")

if [ "$BEFORE" = "$AFTER" ]; then
    ok "Already up to date ($BEFORE)"
    echo ""
    echo "No changes to apply. Exiting."
    exit 0
fi

echo ""
echo "  Commits to pull:"
git log --oneline "$BEFORE..origin/$BRANCH" | sed 's/^/    /'

echo ""
info "Pulling..."
git pull --ff-only origin "$BRANCH"
ok "Updated to $(git rev-parse --short HEAD)"

# Step 2: docker compose
echo ""
if [ $REBUILD -eq 1 ]; then
    info "Rebuilding images (--rebuild)..."
    docker compose -f docker-compose.yml -f docker-compose.prod.yml build 2>&1 | grep -E "Built|ERROR|error" || true
    ok "Images rebuilt"
else
    ok "Reusing existing images (use --rebuild if Dockerfile changed)"
fi

info "Restarting services..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Step 3: health check
echo ""
info "Waiting for API to be healthy (max 120s)..."
for i in $(seq 1 24); do
    if curl -sf http://localhost:4000/api/health > /dev/null 2>&1; then
        ok "API healthy"
        HEALTH=$(curl -s http://localhost:4000/api/health)
        echo "    $HEALTH"
        echo ""
        echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
        echo -e "${GREEN}║   Update successful 🎉                ║${NC}"
        echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"
        exit 0
    fi
    sleep 5
done

echo ""
warn "API not healthy after 120s. Check logs:"
echo "    docker compose -f docker-compose.yml -f docker-compose.prod.yml logs api"
exit 1
