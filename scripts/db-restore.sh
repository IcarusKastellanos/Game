#!/usr/bin/env bash
# Restore witchcraft_sim from a custom (.dump) or plain (.sql) backup.
# Usage:
#   npm run db:restore -- ~/Downloads/witchcraft_sim_local_full.dump
#   npm run db:restore -- ./witchcraft_sim_synced.sql
#
# If the container is unhealthy after a Postgres major upgrade, recreate the volume:
#   docker compose down -v && npm run db:up && npm run db:restore -- ~/Downloads/....dump
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DUMP="${1:-}"
if [[ -z "$DUMP" ]]; then
  echo "Usage: npm run db:restore -- /path/to/backup.dump-or-sql"
  echo "Example: npm run db:restore -- ~/Downloads/witchcraft_sim_local_full.dump"
  exit 1
fi

DUMP="${DUMP/#\~/$HOME}"
if [[ ! -f "$DUMP" ]]; then
  echo "File not found: $DUMP"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Desktop, then retry."
  exit 1
fi

if lsof -nP -iTCP:5432 -sTCP:LISTEN >/dev/null 2>&1; then
  # If something other than docker-proxy holds 5432, warn (Homebrew Postgres is common on Mac)
  if ! docker compose ps --status running 2>/dev/null | grep -q postgres; then
    echo "[db-restore] Port 5432 is already in use. On Mac, stop Homebrew Postgres:"
    echo "  brew services stop postgresql@16"
    echo "  brew services stop postgresql@18"
    echo "Then retry. Listener:"
    lsof -nP -iTCP:5432 -sTCP:LISTEN || true
  fi
fi

echo "[db-restore] Ensuring Postgres is up..."
if ! docker compose up -d --wait; then
  echo ""
  echo "[db-restore] Postgres container is unhealthy."
  echo "This usually means an old Docker volume from Postgres 16 after upgrading to 18."
  echo "Recreate the empty DB volume (safe if you are about to restore a dump):"
  echo ""
  echo "  docker compose down -v"
  echo "  npm run db:up"
  echo "  npm run db:restore -- \"$DUMP\""
  echo ""
  echo "Container logs:"
  docker compose logs postgres --tail 40 || true
  exit 1
fi

echo "[db-restore] Resetting schema..."
docker compose exec -T postgres psql -U postgres -d witchcraft_sim -c \
  "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres; GRANT ALL ON SCHEMA public TO public;"

case "$DUMP" in
  *.dump|*.backup)
    echo "[db-restore] Restoring custom-format dump via pg_restore..."
    set +e
    docker compose exec -T postgres pg_restore -U postgres -d witchcraft_sim --no-owner --no-acl < "$DUMP"
    rc=$?
    set -e
    if [[ "$rc" -ne 0 ]]; then
      echo "[db-restore] pg_restore exit $rc (warnings are often OK). Verifying tables..."
    fi
    ;;
  *.sql)
    echo "[db-restore] Restoring plain SQL..."
    sed -E -e '/^\\restrict /d' -e '/^\\unrestrict/d' -e '/^SET transaction_timeout/d' "$DUMP" \
      | docker compose exec -T postgres psql -U postgres -d witchcraft_sim -v ON_ERROR_STOP=0
    ;;
  *)
    echo "Unknown extension. Use .dump or .sql"
    exit 1
    ;;
esac

echo "[db-restore] Spot-check:"
if ! docker compose exec -T postgres psql -U postgres -d witchcraft_sim -c \
  'SELECT COUNT(*) AS players FROM "Player"; SELECT COUNT(*) AS map_projects FROM "MapProject"; SELECT COUNT(*) AS content_maps FROM "ContentMap";'; then
  echo "[db-restore] Tables still missing — restore did not apply. Check dump path and container logs."
  exit 1
fi

echo "[db-restore] Done. Start the game with: npm run dev"
