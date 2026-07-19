export * from './types.js';
export * from './sprite-pixels.js';
export * from './placement.js';
export * from './interaction.js';
export * from './interact-range.js';
export {
  createEmptyMapDocument,
  createDefaultMapMetadata,
  validateMapForPublish,
  documentToRuntimeMap,
} from './validation.js';
export type { MapAssetLookup } from './validation.js';
export {
  MAP_TILE_CATALOG,
  catalogEntryFromIndex,
  spriteKeyFromTileIndex,
  tileIndexFromSpriteKey,
  tilesForLayerKind,
  mapDocumentHasTilePaint,
  runtimeLayersHaveTiles,
  fillProceduralMapTiles,
  ensureMapDocumentTiles,
  defaultBrushForLayerKind,
} from './tile-catalog.js';
export type { MapTileCatalogEntry } from './tile-catalog.js';

export const MAP_BUILDER_SECTIONS = [
  { id: 'maps', label: 'Maps' },
  { id: 'rooms', label: 'Rooms' },
  { id: 'tilesets', label: 'Tilesets' },
  { id: 'tiles', label: 'Tiles' },
  { id: 'furniture', label: 'Furniture' },
  { id: 'decorations', label: 'Decorations' },
  { id: 'collision', label: 'Collision' },
  { id: 'spawnpoints', label: 'Spawnpoints' },
  { id: 'npcs', label: 'NPC Placement' },
  { id: 'spirits', label: 'Spirit Placement' },
  { id: 'wards', label: 'Ward Editor' },
  { id: 'portals', label: 'Portals & Exits' },
  { id: 'lighting', label: 'Lighting & Weather' },
  { id: 'audio', label: 'Audio Zones' },
  { id: 'versions', label: 'Version History' },
  { id: 'publish', label: 'Publish Queue' },
] as const;

export type MapBuilderSectionId = (typeof MAP_BUILDER_SECTIONS)[number]['id'];

export const MAP_TYPE_OPTIONS = [
  { value: 'town_exterior', label: 'Town Exterior' },
  { value: 'apartment_room', label: 'Apartment Room' },
  { value: 'shop_interior', label: 'Shop Interior' },
  { value: 'npc_home', label: 'NPC Home' },
  { value: 'forest', label: 'Forest' },
  { value: 'cemetery', label: 'Cemetery' },
  { value: 'museum', label: 'Museum' },
  { value: 'funeral_home', label: 'Funeral Home' },
  { value: 'metaphysical_shop', label: 'Metaphysical Shop' },
  { value: 'grocery_store', label: 'Grocery Store' },
  { value: 'pharmacy', label: 'Pharmacy' },
  { value: 'coven_grove', label: 'Coven Grove' },
  { value: 'ritual_chamber', label: 'Ritual Chamber' },
  { value: 'haunted_location', label: 'Haunted Location' },
  { value: 'astral_zone', label: 'Astral Zone' },
  { value: 'dream_zone', label: 'Dream Zone' },
  { value: 'event_map', label: 'Event Map' },
  { value: 'spirit_dungeon', label: 'Spirit Dungeon' },
  { value: 'custom', label: 'Custom' },
] as const;
