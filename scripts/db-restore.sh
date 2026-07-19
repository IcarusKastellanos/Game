#!/usr/bin/env bash
# Restore witchcraft_sim from a custom (.dump) or plain (.sql) backup.
# Usage:
#   npm run db:restore -- ~/Downloads/witchcraft_sim_local_full.dump
#   npm run db:restore -- ./witchcraft_sim_synced.sql
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DUMP="${1:-}"
if [[ -z "$DUMP" ]]; then
  echo "Usage: npm run db:restore -- /path/to/backup.dump-or-sql"
  echo "Example: npm run db:restore -- ~/Downloads/witchcraft_sim_local_full.dump"
  exit 1
fi

# Expand ~
DUMP="${DUMP/#\~/$HOME}"
if [[ ! -f "$DUMP" ]]; then
  echo "File not found: $DUMP"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Desktop, then retry."
  exit 1
fi

echo "[db-restore] Ensuring Postgres is up..."
docker compose up -d --wait

echo "[db-restore] Resetting schema..."
docker compose exec -T postgres psql -U postgres -d witchcraft_sim -c \
  "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres; GRANT ALL ON SCHEMA public TO public;"

case "$DUMP" in
  *.dump|*.backup)
    echo "[db-restore] Restoring custom-format dump via pg_restore..."
    # Prefer restore inside the container (image must be postgres:18+ for PG18 dumps)
    docker compose exec -T postgres pg_restore -U postgres -d witchcraft_sim --no-owner --no-acl < "$DUMP" \
      || echo "[db-restore] pg_restore reported warnings (often OK)."
    ;;
  *.sql)
    echo "[db-restore] Restoring plain SQL..."
    # Strip PG18-only psql bits that break older clients
    sed -E -e '/^\\restrict /d' -e '/^\\unrestrict/d' -e '/^SET transaction_timeout/d' "$DUMP" \
      | docker compose exec -T postgres psql -U postgres -d witchcraft_sim -v ON_ERROR_STOP=0
    ;;
  *)
    echo "Unknown extension. Use .dump or .sql"
    exit 1
    ;;
esac

echo "[db-restore] Done. Spot-check:"
docker compose exec -T postgres psql -U postgres -d witchcraft_sim -c \
  'SELECT COUNT(*) AS players FROM "Player"; SELECT COUNT(*) AS map_projects FROM "MapProject"; SELECT COUNT(*) AS content_maps FROM "ContentMap";'

echo "[db-restore] Restart the game with: npm run dev"
