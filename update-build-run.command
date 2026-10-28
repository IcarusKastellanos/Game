#!/bin/bash
# Double-click in Finder, or run: ./update-build-run.command
# Pulls latest main, installs deps, builds shared, starts Postgres (if Docker),
# syncs DB schema/content when possible, then runs client + server + admin.

set -euo pipefail
cd "$(dirname "$0")"

echo "========================================"
echo " Update · Build · Run Witchcraft Sim"
echo "========================================"
echo "Repo: $(pwd)"
echo

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: '$1' not found. $2"
    read -r -p "Press Enter to close…"
    exit 1
  fi
}

need git "Install Xcode Command Line Tools."
need node "Install Node.js 20+ from https://nodejs.org"
need npm "Install Node.js 20+ (includes npm)."

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "ERROR: Node.js 20+ required (found $(node -v))."
  read -r -p "Press Enter to close…"
  exit 1
fi

# Optional light sync — prefer equalize-with-github.command for a full wipe
if [ -f .git/MERGE_HEAD ] || [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ]; then
  echo "ERROR: Git is mid-merge/rebase. Run equalize-with-github.command first."
  read -r -p "Press Enter to close…"
  exit 1
fi

echo "→ Fetching + fast-forwarding main…"
git fetch origin
git checkout main
git pull --ff-only origin main || {
  echo "ERROR: Could not fast-forward main (local commits diverge)."
  echo "       Run equalize-with-github.command, then try again."
  read -r -p "Press Enter to close…"
  exit 1
}

if [ ! -f .env ]; then
  echo "→ Creating .env from .env.example…"
  cp .env.example .env
  echo "  Edit .env if your Postgres user/password differ from postgres/postgres."
fi

# Start Postgres via Docker when available (same defaults as .env.example)
if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    echo "→ Starting Postgres (docker compose)…"
    docker compose up -d
  else
    echo "⚠ Docker installed but not running — skipping compose."
    echo "  Start Docker Desktop, or use a local Postgres matching DATABASE_URL in .env."
  fi
else
  echo "⚠ Docker not found — using whatever Postgres DATABASE_URL points at (or in-memory)."
fi

echo "→ npm install…"
npm install

echo "→ Generating Prisma client…"
npm run db:generate

echo "→ Building shared package…"
npm run build -w shared

echo "→ Pushing DB schema (ok if DB is down — game has in-memory fallback)…"
if npm run db:push; then
  # Always push authored item sprites from ingredients.json into Postgres so stale
  # DB / cache art cannot beat the generated icons on boot.
  echo "→ Syncing content + installing authored item icons from ingredients.json…"
  npm run content:sync || echo "⚠ content:sync failed — continuing."
  echo "→ Seeding DB (idempotent)…"
  npm run db:seed || echo "⚠ db:seed failed — continuing."
else
  echo "⚠ db:push failed — continuing without DB persistence."
fi

echo
echo "Starting servers…"
echo "  Client:      http://localhost:5173"
echo "  Game server: http://localhost:2567"
echo "  Admin:       (Vite admin-client — see terminal for port)"
echo
echo "Stop with Ctrl+C"
echo "========================================"
echo

npm run dev
