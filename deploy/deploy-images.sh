#!/usr/bin/env bash
# =============================================================================
# Deploy pre-built images (pull + restart) — run on the VM
#
# Prereqs on the VM:
#   - Docker + Docker Compose plugin installed
#   - (Once) docker login to the registry (e.g. ghcr.io)
#
# Usage:
#   sudo -u telemetry bash /opt/telemetry-analyst/deploy/deploy-images.sh
#
# Optional env vars:
#   COMPOSE_FILE  compose file (default: docker-compose.prod.yml)
# =============================================================================
set -euo pipefail

APP_DIR="/opt/telemetry-analyst"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

cd "$APP_DIR"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "ERROR: $COMPOSE_FILE not found in $APP_DIR"
  exit 1
fi

echo "==> Pulling latest images..."
docker compose -f "$COMPOSE_FILE" pull

echo "==> Restarting services..."
docker compose -f "$COMPOSE_FILE" up -d --force-recreate --remove-orphans

echo "==> Cleaning up old images..."
docker image prune -f

echo "==> Done! Current status:"
docker compose -f "$COMPOSE_FILE" ps
