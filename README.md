# Witchcraft Sim

A 16-bit multiplayer browser life-sim/RPG grounded in historical folk magic practice. Built with Phaser 3, Colyseus, Express, PostgreSQL, and Prisma.

## Quick Start

**Requires Node.js 20+**

```bash
# Install dependencies (builds shared package automatically)
npm install

# Copy environment config (Windows)
copy .env.example .env

# Generate Prisma client
npm run db:generate
```

### Optional: PostgreSQL persistence (local install — no Docker)

The game runs without a database (in-memory fallback). For save/load across sessions, use your **local PostgreSQL** install.

**1. Edit `.env`** with your PostgreSQL username and password:

```
DATABASE_URL="postgresql://YOUR_USER:YOUR_PASSWORD@localhost:5432/witchcraft_sim?schema=public"
```

Common defaults: user `postgres`, port `5432`. Special characters in passwords must be URL-encoded.

**2. Create the database** (once) — pick one method:

- **pgAdmin:** connect to your server → right-click **Databases** → **Create** → name: `witchcraft_sim`
- **SQL:** run `scripts/create-database.sql` in the Query Tool

**3. Push schema and seed content:**

```bash
npm run db:generate
npm run db:push
npm run content:sync
npm run db:seed
```

**4. Restart** `npm run dev` if the server was already running.

> Docker is optional. If you prefer it later, `docker compose up -d` uses the same database name and credentials as `.env.example`.

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
docker-compose.yml      PostgreSQL for local persistence
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
