# Administrator Framework

The admin system is a first-class subsystem shared by the **browser dashboard** and **in-game console**. All actions are permission-based (RBAC) and written to immutable audit logs.

## Quick Start

```powershell
cd C:\Users\gjern\OneDrive\Desktop\Game
npm install
npm run db:push
npm run db:seed:admin
npm run dev
```

| Service | URL |
|---------|-----|
| Game client | http://localhost:5173 |
| Admin dashboard | http://localhost:5174 |
| Server API | http://localhost:2567/admin/api/v1 |

**Default credentials** (change after first login):

- Username: `admin`
- Password: `admin123` (or `ADMIN_DEFAULT_PASSWORD` in `.env`)

Set `ADMIN_JWT_SECRET` in `.env` for production.

## Architecture

```
shared/src/admin/permissions.ts   ← granular permissions + role templates
server/src/admin/                 ← auth, RBAC, audit, REST API, commands
admin-client/                     ← browser dashboard (Vite SPA)
client/src/ui/AdminConsole.ts     ← in-game console (` or F1)
prisma/schema.prisma              ← AdminUser, AdminRole, AdminAuditLog, etc.
```

Both interfaces call the same backend:

- **Dashboard:** JWT auth → `/admin/api/v1/*`
- **In-game:** Colyseus `admin_command` message → `server/src/admin/commands/registry.ts`

Link in-game access by setting `AdminUser.gameUsername` to the player's login username. The account must have the `system.ingame` permission (included in Super Admin and Developer roles).

## Roles

| Role | Purpose |
|------|---------|
| Super Administrator | Full access |
| Developer | Content + debug + kill/heal |
| Game Master | Players, events, moderation |
| Moderator | Warn/mute/ban |
| Content Designer | Spells, items, NPCs |
| World Builder | Maps, environment |
| Economy Manager | Prices, drops |
| Event Manager | Live server events |
| Read-Only Auditor | View-only + audit export |

Permissions are **granular** (`player.heal`, `content.spell.edit`, etc.) and assigned to roles in the database—not hard-coded per role in application logic.

## In-Game Console

Press `` ` `` or **F1** when logged in as a linked admin account.

Examples:

```
/help
/tp 10 12
/give white_candle 5
/heal
/setstat health 100
/ban <playerId> reason
/event blood_moon on
/reloadcontent
/inspect
/logs
/debug collision
/debug aura
```

`/debug <flag>` toggles client-side overlays (collision, aura, wards, etc.).

## Audit Logs

Every admin action records:

- Administrator ID
- Action name
- Object type / ID
- Previous and new values (JSON)
- Timestamp, IP, user agent
- Optional reason

Browse logs in the dashboard **Audit Log** section or via `/logs` in-game.

## Content Registry

Spells, items, NPCs, maps, spirits, events, and more are stored in PostgreSQL content tables and synced from `/content` JSON. Editors in the dashboard write to both the live registry and the database, with audit entries on each change.

## Graphics

Procedural Stardew-inspired sprites are generated at boot (`client/src/graphics/SpriteGenerator.ts`):

- 8-direction walk animations (`player_walk`, `player_other_walk`)
- Grass, path, wood, brick tiles
- Altar, door, tree, shop objects
