#!/usr/bin/env bash
# =============================================================================
# Back up the production database, then import db/seed.sql.gz into it.
#
# Usage:
#   sudo -u telemetry bash /opt/telemetry-analyst/deploy/import-seed.sh
#
# Optional env vars:
#   APP_DIR       repo path on the server (default: /opt/telemetry-analyst)
#   COMPOSE_FILE  compose file to use (default: docker-compose.prod.yml)
#   SEED_PATH     seed file to import (default: db/seed.sql.gz)
#   BACKUP_DIR    where to write backups (default: backups)
# =============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/telemetry-analyst}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
SEED_PATH="${SEED_PATH:-db/seed.sql.gz}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

cd "$APP_DIR"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "ERROR: compose file '$COMPOSE_FILE' not found in $APP_DIR"
  exit 1
fi

if [ ! -f "$SEED_PATH" ]; then
  echo "ERROR: seed file '$SEED_PATH' not found in $APP_DIR"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

echo "==> Ensuring database service is running..."
docker compose -f "$COMPOSE_FILE" up -d db

echo "==> Waiting for database to become ready..."
docker compose -f "$COMPOSE_FILE" exec -T db sh -lc '
  until pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
    sleep 1
  done
'

BACKUP_PATH="$BACKUP_DIR/prod-db-$TIMESTAMP.sql.gz"
echo "==> Backing up current database to $BACKUP_PATH ..."
docker compose -f "$COMPOSE_FILE" exec -T db sh -lc '
  export PGPASSWORD="$POSTGRES_PASSWORD"
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"
' | gzip > "$BACKUP_PATH"

echo "==> Importing $SEED_PATH into the running database..."
gzip -dc "$SEED_PATH" | docker compose -f "$COMPOSE_FILE" exec -T db sh -lc '
  export PGPASSWORD="$POSTGRES_PASSWORD"
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"
'

echo "==> Seed import completed."
echo "==> Backup saved at: $APP_DIR/$BACKUP_PATH"
