#!/usr/bin/env bash
# ============================================================
#  Kos AI — One-command setup
#  Jalankan dari root project:
#    ./scripts/setup.sh
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

echo "========================================="
echo "  Kos AI — Setup"
echo "========================================="
echo ""

# 1. Check Docker
if ! command -v docker &> /dev/null; then
    echo "[ERROR] Docker tidak ditemukan. Install Docker dulu:"
    echo "  macOS:  https://docs.docker.com/desktop/setup/mac/"
    echo "  Linux:  curl -fsSL https://get.docker.com | sh"
    exit 1
fi
echo "[✓] Docker tersedia: $(docker --version)"

if ! docker compose version &> /dev/null; then
    echo "[ERROR] docker compose tidak tersedia."
    exit 1
fi
echo "[✓] docker compose tersedia"
echo ""

# 2. Build Go scraper binary (first time only — skip if already exists)
SCRAPER_BIN="services/scraper/google-maps-scraper/gmaps-scraper"
if [ -f "$SCRAPER_BIN" ]; then
    echo "[✓] Go scraper binary sudah ada: $SCRAPER_BIN ($(du -h "$SCRAPER_BIN" | cut -f1))"
else
    echo "[*] Membangun Go scraper binary..."
    ./scripts/build-scraper.sh
fi
echo ""

# 3. Build Docker images (only if needed)
echo "[*] Membangun Docker images (skip jika sudah ada)..."
docker compose build
echo ""

# 4. Start services
echo "[*] Menjalankan semua service..."
docker compose up -d
echo ""

# 5. Wait for healthy
echo "[*] Menunggu service siap..."
sleep 5
ATTEMPTS=0
MAX_ATTEMPTS=24
while [ $ATTEMPTS -lt $MAX_ATTEMPTS ]; do
    STATUS=$(docker compose ps --format json 2>/dev/null | python3 -c "
import sys, json
lines = sys.stdin.read().strip().split('\n')
if not lines or lines[0] == '': 
    print('waiting')
    sys.exit(0)
all_ok = True
for line in lines:
    try:
        item = json.loads(line)
        if 'Health' in item and item['Health'] != 'healthy':
            all_ok = False
    except: pass
print('ok' if all_ok else 'waiting')
" 2>/dev/null || echo "waiting")
    if [ "$STATUS" = "ok" ]; then
        echo ""
        echo "========================================="
        echo "  Semua service berjalan!"
        echo "========================================="
        echo ""
        echo "  Buka di browser:"
        echo "    http://localhost"
        echo ""
        echo "  Login:"
        echo "    Email:    admin@kos.ai"
        echo "    Password: admin123"
        echo ""
        echo "  Setup selesai! 🎉"
        exit 0
    fi
    sleep 5
    ATTEMPTS=$((ATTEMPTS + 1))
    if [ $((ATTEMPTS % 4)) -eq 0 ]; then
        echo "  ... masih menunggu (${ATTEMPTS}s) ..."
        docker compose ps 2>/dev/null | head -5
    fi
done

echo "[WARN] Timeout menunggu service. Cek status:"
docker compose ps
echo ""
echo "Coba buka http://localhost — kalau halaman muncul, setup berhasil."