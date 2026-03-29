#!/usr/bin/env bash
# =============================================================================
# Deploy latest code — run on the VM to pull code and pre-built images
#
# Usage:
#   sudo -u telemetry bash /opt/telemetry-analyst/deploy/deploy.sh
# =============================================================================
set -euo pipefail

APP_DIR="/opt/telemetry-analyst"
cd "$APP_DIR"

echo "==> Pulling latest code..."
git pull origin main

echo "==> Pulling latest images..."
docker compose -f docker-compose.prod.yml pull

echo "==> Restarting services..."
docker compose -f docker-compose.prod.yml up -d --force-recreate --remove-orphans

echo "==> Cleaning up old images..."
docker image prune -f

echo "==> Done! Current status:"
docker compose ps
