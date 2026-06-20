#!/usr/bin/env bash
# Build the Google Maps scraper Go binary for Linux (Docker).
# Run this ONCE before docker compose up.
# Output: services/scraper/google-maps-scraper/gmaps-scraper (linux/amd64 binary)

set -euo pipefail
cd "$(dirname "$0")/.."

SCRAPER_DIR="services/scraper/google-maps-scraper"
BINARY_PATH="$SCRAPER_DIR/gmaps-scraper"

echo "==> Building Go scraper binary for Linux..."
echo "    This may take a few minutes on first run (downloading Go toolchain + deps)."

docker run --rm \
    -v "$(pwd)/$SCRAPER_DIR":/build \
    -w /build \
    -e GOTOOLCHAIN=auto \
    -e CGO_ENABLED=0 \
    -e GOOS=linux \
    golang:1.24-bullseye \
    go build -ldflags="-w -s" -o gmaps-scraper .

echo "    Binary built: $BINARY_PATH"
ls -lh "$BINARY_PATH"
echo "==> Done."
