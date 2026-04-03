#!/usr/bin/env bash
# =============================================================================
# Deploy latest code — run on the VM to pull code and pre-built images
#
# Usage:
#   sudo -u telemetry bash /opt/telemetry-analyst/deploy/deploy.sh
#
# Optional env vars:
#   APP_DIR       application directory (default: /opt/telemetry-analyst)
#   COMPOSE_FILE  compose file (default: docker-compose.prod.yml)
# =============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/telemetry-analyst}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
cd "$APP_DIR"

echo "==> Pulling latest code..."
git pull origin main

echo "==> Pulling latest images..."
docker compose -f "$COMPOSE_FILE" pull

echo "==> Restarting services..."
docker compose -f "$COMPOSE_FILE" up -d --force-recreate --remove-orphans

echo "==> Cleaning up old images..."
docker image prune -f

echo "==> Done! Current status:"
docker compose -f "$COMPOSE_FILE" ps
