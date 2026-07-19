# Map Building System — Architecture

Admin-only worldbuilding tool for creating, editing, publishing, and managing playable maps without code changes.

## Layers

| Layer | Location | Role |
|-------|----------|------|
| Shared types & validation | `shared/src/map-builder/` | Map document format, publish validation, runtime conversion |
| Database | `prisma/schema.prisma` | `MapProject`, `MapVersion`, tile/furniture/decoration defs, publish log, preview invites |
| Server service | `server/src/admin/services/map-builder/` | CRUD, draft versioning, publish, audit |
| Admin API | `server/src/admin/routes/map-builder.ts` | RBAC-gated REST under `/admin/api/v1/map-builder` |
| Admin UI | `admin-client/src/map-builder/` | Map manager, visual editor, subsection shell |
| Runtime | `server/src/content/registry.ts` | JSON maps + DB-published maps merged at boot |

## Map document format

`MapBuilderDocument` (stored in `MapVersion.document` JSON):

- **layers[]** — tile grids per layer kind (ground, floor, wall, collision, …)
- **collision[]** — separate collision cells (full/partial/polygon modes)
- **spawnpoints[]**, **npcPlacements[]**, **spiritPlacements[]**, **wardPlacements[]**, **portals[]**
- **lightingRegions[]**, **weatherRegions[]**, **audioRegions[]**, **magicalZones[]**
- **placedFurniture[]**, **placedDecorations[]**

On publish, `documentToRuntimeMap()` converts to legacy `ContentMapDefinition` for the game client/server.

## Permissions

| Slug | Purpose |
|------|---------|
| `content.map.view` | Browse maps and assets |
| `content.map.edit` | Create/edit drafts |
| `content.map.publish` | Publish/unpublish |
| `content.map.preview` | Send preview invites |
| `content.map.ward.unbreakable` | Place unbreakable wards |

Roles `developer` and `world_builder` include map permissions.

## Publish workflow

1. Edit draft → autosave/manual save creates new `MapVersion`
2. Validate → `validateMapForPublish()` checks spawns, portals, wards, metadata
3. Publish → validation pass, upsert `ContentMap`, hot-load into `contentRegistry`
4. Unpublish/archive → remove from registry

## Admin UI sections

Subsections defined in `MAP_BUILDER_SECTIONS` (`shared/src/map-builder/index.ts`):

Maps/Rooms → Map Manager + visual editor  
Tilesets/Tiles/Furniture/Decorations → asset CRUD editors (`asset-editors.ts`) with seed defaults  
Collision/Spawnpoints/NPCs/Spirits/Wards/Portals → editor tools + inspector panels  
Lighting/Audio → region editors (TODO)  
Version History / Publish Queue → list views

## Visual editor (starter)

`admin-client/src/map-builder/map-editor.ts`:

- Canvas tile painter with layers, zoom, grid, minimap
- Tools: brush, fill, erase, spawn, collision, NPC, spirit, ward, portal
- Inspector tabs for metadata, spawns, collision, NPCs, spirits, wards, portals
- Undo/redo, validate, save draft, publish, preview invite modal
- Unbreakable ward confirmation + visual warning

## TODO (advanced)

- Tileset image upload + slice UI (metadata editor exists; image URL field only)
- Rectangle/line/select/move/rotate tools, copy/paste
- Furniture/decoration placement with footprint preview
- Polygon collision editor, pathfinding preview
- Lighting/weather/audio region drawing
- Preview invite delivery via GameRoom (mirror apartment invites)
- Version diff/compare UI
- Import legacy `content/maps.json` into MapProject
- Autosave interval
- Magical zone editor overlay

## API endpoints

See `server/src/admin/routes/map-builder.ts` for full list. All routes require admin auth + permission checks.

## Database migration

After pulling schema changes:

```bash
npx prisma migrate dev --schema prisma/schema.prisma
```

Or `npm run db:push` for dev.
