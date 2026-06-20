#!/usr/bin/env bash
# ============================================================
#  Kos AI — One-command setup
#    ./scripts/setup.sh
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
err()  { echo -e "  ${RED}✗${NC} $1"; }
info() { echo -e "  ${CYAN}➤${NC} $1"; }

echo ""
echo -e "${CYAN}╔═══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║         Kos AI — Setup               ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════╝${NC}"
echo ""

# ── Check Docker ──
if ! command -v docker &> /dev/null; then
    err "Docker tidak ditemukan. Install dulu:"
    echo "    https://docs.docker.com/desktop/"
    exit 1
fi
ok "Docker $(docker --version 2>/dev/null | cut -d' ' -f3 | cut -d',' -f1)"

if ! docker compose version &> /dev/null; then
    err "docker compose tidak tersedia."
    exit 1
fi
ok "docker compose ready"
echo ""

# ── Build Go binary ──
SCRAPER_BIN="services/scraper/google-maps-scraper/gmaps-scraper"
if [ -f "$SCRAPER_BIN" ] && file "$SCRAPER_BIN" 2>/dev/null | grep -q "ELF"; then
    ok "Go scraper binary ready ($(du -h "$SCRAPER_BIN" | cut -f1))"
else
    info "Building Go scraper binary (~2 min)..."
    ./scripts/build-scraper.sh 2>&1 | while IFS= read -r line; do
        echo "    $line"
    done
    ok "Go binary built"
fi
echo ""

# ── Build & Start ──
info "Building Docker images..."
docker compose build 2>&1 | grep -E "Built|ERROR|error" || true
ok "Images ready"

echo ""
info "Starting services..."
docker compose up -d 2>&1

# ── Wait ──
echo ""
info "Waiting for services..."
sleep 3
ATTEMPTS=0
MAX=36
while [ $ATTEMPTS -lt $MAX ]; do
    STATUS=$(docker compose ps --format json 2>/dev/null | python3 -c "
import sys, json
lines = [l.strip() for l in sys.stdin.read().strip().split('\n') if l.strip()]
all_ok = True
for line in lines:
    try:
        item = json.loads(line)
        if 'Health' in item and item['Health'] != 'healthy':
            all_ok = False
    except: pass
print('ok' if all_ok and lines else 'waiting')
" 2>/dev/null || echo "waiting")

    if [ "$STATUS" = "ok" ]; then
        echo ""
        echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
        echo -e "${GREEN}║      Semua service berjalan! 🎉      ║${NC}"
        echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"
        echo ""
        echo -e "  Buka di browser:  ${CYAN}http://localhost${NC}"
        echo ""
        echo    "  Login:"
        echo -e "    Email:    ${CYAN}admin@kos.ai${NC}"
        echo -e "    Password: ${CYAN}admin123${NC}"
        echo ""
        echo -e "  ${YELLOW}Catatan:${NC} Pencarian pertama akan lambat (~2-5 menit)"
        echo    "  karena download model AI. Selanjutnya akan cepat."
        echo ""
        exit 0
    fi

    sleep 5
    ATTEMPTS=$((ATTEMPTS + 1))
    if [ $((ATTEMPTS % 6)) -eq 0 ]; then
        warn "Masih menunggu (${ATTEMPTS}s)..."
    fi
done

echo ""
warn "Timeout. Cek status manual:"
echo "  docker compose ps"
echo "  docker compose logs api"
echo ""
echo "Kalau halaman muncul di http://localhost, setup berhasil."