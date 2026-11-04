#!/usr/bin/env bash
# Restore witchcraft_sim from a custom (.dump) or plain (.sql) backup.
# Usage:
#   npm run db:restore -- ~/Downloads/witchcraft_sim_local_full.dump
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DUMP="${1:-}"
if [[ -z "$DUMP" ]]; then
  echo "Usage: npm run db:restore -- /path/to/backup.dump-or-sql"
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

echo "[db-restore] Ensuring Postgres is up..."
if ! docker compose up -d --wait; then
  echo ""
  echo "[db-restore] Postgres is unhealthy. Recreate the volume, then retry:"
  echo "  docker compose down -v"
  echo "  docker compose pull"
  echo "  npm run db:up"
  echo "  npm run db:restore -- \"$DUMP\""
  echo ""
  docker compose logs postgres --tail 40 || true
  exit 1
fi

echo "[db-restore] Resetting schema..."
docker compose exec -T postgres psql -U postgres -d witchcraft_sim -c \
  "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres; GRANT ALL ON SCHEMA public TO public;"

# Compose project network + DB container hostname
NETWORK="$(docker inspect "$(docker compose ps -q postgres)" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')"
DB_HOST="$(docker compose ps -q postgres | xargs -I{} docker inspect {} --format '{{.Config.Hostname}}')"
# Fallback hostname used by compose
SERVICE_HOST="postgres"

case "$DUMP" in
  *.dump|*.backup)
    echo "[db-restore] Restoring custom-format dump (via postgres:18 client → postgres:16 server)..."
    # PG18 custom dumps need pg_restore 18; server stays on stable 16
    set +e
    docker run --rm -i --network "$NETWORK" \
      -e PGPASSWORD=postgres \
      postgres:18-alpine \
      pg_restore -h "$SERVICE_HOST" -U postgres -d witchcraft_sim --no-owner --no-acl \
      < "$DUMP"
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
  echo "[db-restore] Tables still missing — restore did not apply."
  exit 1
fi

echo "[db-restore] Done. Start the game with: npm run dev"
