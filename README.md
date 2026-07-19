# Witchcraft Sim

A 16-bit multiplayer browser life-sim/RPG grounded in historical folk magic practice. Built with Phaser 3, Colyseus, Express, PostgreSQL, and Prisma.

## Quick Start

**Requires:** Node.js 20+ and [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for PostgreSQL).

The database uses **one shared `DATABASE_URL` on every machine** via Docker — do not change it to your OS username.

```bash
# Install deps + start universal Postgres + push schema + seed admin
npm run setup

# Or step by step:
npm install
npm run db:setup   # writes .env, starts Docker Postgres, db:push, seed admin
```

`npm run db:setup` always sets:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/witchcraft_sim?schema=public"
```

That matches `docker-compose.yml` everywhere (Mac, Windows, Linux).

**Mac tip:** if Homebrew Postgres is already on port 5432, stop it first:

```bash
brew services stop postgresql@16
```

Useful DB commands:

| Command | What it does |
|---------|----------------|
| `npm run db:up` | Start Docker Postgres |
| `npm run db:down` | Stop Docker Postgres |
| `npm run db:env` | Reset `.env` `DATABASE_URL` to the universal value |
| `npm run db:setup` | Env + up + push schema + seed admin |
| `npm run db:restore -- ~/Downloads/file.dump` | Replace DB from a `.dump` / `.sql` backup |

If the server says tables like `ContentIngredient` do not exist, the database is empty — restore a backup or run `npm run db:setup`.

**Restore from another computer’s dump (Mac):**

```bash
# Stop npm run dev (Ctrl+C). Stop Homebrew Postgres if it owns 5432:
brew services stop postgresql@16

# Recreate Docker DB on Postgres 18 (needed for .dump files from modern Postgres)
docker compose down -v
npm run db:up
npm run db:restore -- ~/Downloads/witchcraft_sim_local_full.dump

# Optional: refresh map-builder tables from the wrapped SQL
sed -E -e '/^\\restrict /d' -e '/^SET transaction_timeout/d' \
  ~/Downloads/map-builder-restore-wrapped.sql \
  | docker compose exec -T postgres psql -U postgres -d witchcraft_sim

npm run dev
```

The game can still run without Postgres (in-memory fallback). Persistence needs Docker running (`npm run db:up`).

### Run the game

```bash
npm run dev
```

- **Client:** http://localhost:5173
- **Server:** http://localhost:2567
- **Content API:** http://localhost:2567/api/content/all

Enter a username on the login screen — progress saves to PostgreSQL when configured.

## Controls

| Key | Action |
|-----|--------|
| WASD / Arrows | Move |
| E | Interact (altar, door, shop, NPC, ward point) |
| D | Decoration placement mode (apartment) |
| I | Inventory |
| A | Aura & wards (inspect self or nearby players) |
| F | Familiar care |
| ESC | Close UI panels |

## Build

```bash
npm run build          # shared + server + client
npm run build -w shared
npm run build -w server
npm run build -w client
```

## Troubleshooting (Windows)

**`EPERM` during `npm run db:generate`**

Prisma cannot overwrite its query engine while the game server is running (or while OneDrive locks files).

1. Stop `npm run dev` (**Ctrl+C**) and close any extra Node terminals
2. Run `npm run db:generate` again

If it still fails and the project lives under **OneDrive** (`Desktop\Game`), pause OneDrive sync or move the repo to a non-synced folder (e.g. `C:\dev\Game`). OneDrive often locks `node_modules\.prisma\`.

## Project Structure

```
/client                 Phaser 3 + Vite frontend
/server                 Express + Colyseus backend
/shared                 Shared TypeScript types & constants
/prisma                 PostgreSQL schema
/content                JSON registries (spells, NPCs, dialogues, maps, etc.)
docker-compose.yml      Universal PostgreSQL (same credentials every machine)
```

## v0.2 Features

- **Player persistence** — load/create on join, save on leave (PostgreSQL or fallback)
- **Login screen** — username stored in localStorage
- **Enhanced altar** — slots, intent, timing, taglocks, player targeting, spell list
- **NPC dialogues** — branching trees from `content/dialogues.json`
- **Wards** — place household ward at apartment threshold (E → ward point)
- **Decorations** — click-to-place furniture in apartment [D]
- **Aura inspection** — view self or inspect other players (depth gated by Intuition)
- **Taglock items** — hair, written name, personal item in shops/inventory

## Admin API

```bash
# Reload JSON content without restart
curl -X POST http://localhost:2567/api/admin/reload
```

## Architecture

- **Modular spell engine** — JSON-driven; evaluates ingredients, taglocks, altar buffs, skills
- **Pluggable magic traditions** — `MAGIC_SYSTEMS` registry (Traditional European enabled)
- **Content registry** — JSON at startup + admin hot-reload
- **Colyseus rooms** — `apartment` and `town` with synced multiplayer state

## Next Milestones

See [TODO.md](./TODO.md) for the full roadmap (v0.3 crafting, Covens, Astral, art pass).

## License

Private — all rights reserved.
