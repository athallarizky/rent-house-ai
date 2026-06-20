#!/usr/bin/env bash
# Build the Google Maps scraper Go binary for Linux (Docker).
# Run this ONCE before docker compose up.
# Output: services/scraper/google-maps-scraper/gmaps-scraper (linux/amd64 binary)
#
# Tries Docker golang image first; falls back to local Go if Docker image
# doesn't support the required Go version (go.mod).

set -euo pipefail
cd "$(dirname "$0")/.."

SCRAPER_DIR="services/scraper/google-maps-scraper"
BINARY_PATH="$SCRAPER_DIR/gmaps-scraper"

echo "==> Building Go scraper binary for Linux..."

# Read required Go version from go.mod
REQUIRED_GO=$(grep -oP '^go \K[0-9]+\.[0-9]+' "$SCRAPER_DIR/go.mod" 2>/dev/null || echo "1.24")
echo "    go.mod requires go $REQUIRED_GO"

# Try Docker first
DOCKER_IMAGE="golang:${REQUIRED_GO}-bullseye"
echo "    Trying Docker image: $DOCKER_IMAGE"

if docker pull "$DOCKER_IMAGE" 2>/dev/null; then
    echo "    Building with $DOCKER_IMAGE..."
    docker run --rm \
        -v "$(pwd)/$SCRAPER_DIR":/build \
        -w /build \
        -e GOTOOLCHAIN=auto \
        -e CGO_ENABLED=0 \
        -e GOOS=linux \
        "$DOCKER_IMAGE" \
        go build -ldflags="-w -s" -o gmaps-scraper .
elif command -v go &>/dev/null && go version 2>/dev/null | grep -q "go${REQUIRED_GO}"; then
    echo "    Docker image not available. Building with local Go..."
    cd "$SCRAPER_DIR"
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-w -s" -o gmaps-scraper .
    cd - >/dev/null
else
    echo "ERROR: Cannot build Go scraper."
    echo "  - Docker image $DOCKER_IMAGE not found on Docker Hub"
    echo "  - Local Go version doesn't match required $REQUIRED_GO"
    echo ""
    echo "Workaround: build manually with:"
    echo "  cd $SCRAPER_DIR && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags=\"-w -s\" -o gmaps-scraper ."
    exit 1
fi

echo "    Binary built: $BINARY_PATH"
ls -lh "$BINARY_PATH"
echo "==> Done."
