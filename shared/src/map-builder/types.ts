/** Map Builder — database-driven worldbuilding types */

export type MapProjectStatus = 'draft' | 'published' | 'archived' | 'pending_review';
export type MapAccessLevel =
  | 'public'
  | 'private'
  | 'instance_only'
  | 'apartment_only'
  | 'coven_only'
  | 'event_only'
  | 'admin_only';

export type MapTypeCategory =
  | 'town_exterior'
  | 'apartment_room'
  | 'shop_interior'
  | 'npc_home'
  | 'forest'
  | 'cemetery'
  | 'museum'
  | 'funeral_home'
  | 'metaphysical_shop'
  | 'grocery_store'
  | 'pharmacy'
  | 'coven_grove'
  | 'ritual_chamber'
  | 'haunted_location'
  | 'astral_zone'
  | 'dream_zone'
  | 'event_map'
  | 'spirit_dungeon'
  | 'custom';

export type MapLayerKind =
  | 'ground'
  | 'floor'
  | 'wall'
  | 'upper_wall'
  | 'roof'
  | 'decoration'
  | 'furniture'
  | 'collision'
  | 'interactable'
  | 'spawnpoint'
  | 'npc'
  | 'spirit'
  | 'portal'
  | 'ward'
  | 'lighting';

export type SpawnpointType =
  | 'default_player'
  | 'room_entrance'
  | 'apartment'
  | 'shop_entrance'
  | 'npc'
  | 'familiar'
  | 'spirit'
  | 'event'
  | 'admin_teleport'
  | 'coven_ritual'
  | 'astral_entry'
  | 'respawn'
  | 'death_recovery';

export type WardPlacementType =
  | 'player_created'
  | 'npc_created'
  | 'coven_created'
  | 'environmental'
  | 'story'
  | 'admin'
  | 'unbreakable'
  | 'temporary_event'
  | 'anti_spirit'
  | 'anti_curse'
  | 'anti_entry'
  | 'anti_divination'
  | 'anti_teleport'
  | 'aura_shield'
  | 'threshold';

export type PreviewPersona = 'player' | 'high_awareness' | 'admin' | 'npc' | 'spirit' | 'familiar';

export interface MapProjectMetadata {
  id: string;
  internalName: string;
  displayName: string;
  description: string;
  mapType: MapTypeCategory;
  biome: string;
  theme: string;
  sceneId: string;
  width: number;
  height: number;
  tileSize: number;
  defaultLighting: string;
  defaultWeather: string;
  defaultMusic: string;
  defaultAmbientSound: string;
  allowedPlayerCount: number;
  isInstanced: boolean;
  isWardable: boolean;
  allowUnbreakableWards: boolean;
  allowSpirits: boolean;
  allowFamiliars: boolean;
  allowNpcSchedules: boolean;
  accessLevel: MapAccessLevel;
  status: MapProjectStatus;
  version: number;
  createdBy?: string;
  updatedBy?: string;
  publishedAt?: string;
  archivedAt?: string;
}

export interface MapLayerState {
  id: string;
  kind: MapLayerKind;
  name: string;
  visible: boolean;
  locked: boolean;
  order: number;
  /** tile index grid — row-major [y][x] */
  cells: number[][];
}

export interface CollisionCell {
  x: number;
  y: number;
  mode:
    | 'full'
    | 'partial'
    | 'polygon'
    | 'rectangle'
    | 'circle'
    | 'one_way'
    | 'player_only'
    | 'npc_only'
    | 'familiar_only'
    | 'spirit_only'
    | 'line_of_sight'
    | 'magic_block';
  data?: Record<string, unknown>;
}

export interface MapSpawnpoint {
  id: string;
  name: string;
  type: SpawnpointType;
  x: number;
  y: number;
  facing: 'up' | 'down' | 'left' | 'right';
  enabled: boolean;
  priority: number;
  allowedRoles?: string[];
  minLevel?: number;
  linkedPortalId?: string;
  linkedMapId?: string;
  conditionRules?: Record<string, unknown>;
}

export interface MapNpcPlacement {
  id: string;
  npcTemplateId: string;
  x: number;
  y: number;
  homeX?: number;
  homeY?: number;
  workX?: number;
  workY?: number;
  staticPosition: boolean;
  shopId?: string;
  dialogueContext?: string;
  patrolRoute?: { x: number; y: number }[];
  spawnConditions?: Record<string, unknown>;
}

export interface MapSpiritPlacement {
  id: string;
  spiritTemplateId?: string;
  zoneType: 'spawn_zone' | 'entity';
  x: number;
  y: number;
  radius?: number;
  temperament?: string;
  visibilityRules?: Record<string, unknown>;
  respawnRules?: Record<string, unknown>;
}

export interface MapWardPlacement {
  id: string;
  name: string;
  description: string;
  wardType: WardPlacementType;
  x: number;
  y: number;
  strength: number;
  visibility: 'hidden' | 'subtle' | 'visible';
  durationMs?: number;
  unbreakable: boolean;
  adminLocked: boolean;
  breakability: 'normal' | 'hard' | 'unbreakable';
  blocksTeleportation?: boolean;
  blocksDivination?: boolean;
  blocksCurses?: boolean;
  blocksSpirits?: boolean;
  blocksAllMagic?: boolean;
  allowedPlayers?: string[];
  blockedPlayers?: string[];
}

export interface MapPortal {
  id: string;
  name: string;
  sourceX: number;
  sourceY: number;
  targetMapId: string;
  targetSpawnId: string;
  direction: 'up' | 'down' | 'left' | 'right';
  twoWay: boolean;
  visible: boolean;
  /** Paired return portal id on the target map (two-way links) */
  linkedPortalId?: string;
  levelRequirement?: number;
  keyItemId?: string;
  questId?: string;
}

export interface MapRegionBase {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  enabled: boolean;
}

export interface MapLightingRegion extends MapRegionBase {
  brightness: number;
  color?: string;
  flicker?: boolean;
}

export interface MapWeatherRegion extends MapRegionBase {
  weather: 'rain' | 'fog' | 'snow' | 'storm' | 'wind' | 'ash' | 'spirit_mist' | 'magical_haze' | 'clear';
  intensity: number;
}

export interface MapAudioRegion extends MapRegionBase {
  trackId: string;
  loop: boolean;
  volume: number;
}

export type MagicalZoneType =
  | 'ley_line'
  | 'haunted'
  | 'blessed_ground'
  | 'cursed_ground'
  | 'ritual_hotspot'
  | 'divination_amplifier'
  | 'spirit_crossing'
  | 'astral_thin'
  | 'anti_magic'
  | 'healing'
  | 'protection'
  | 'familiar_comfort'
  | 'dangerous_aura';

export interface MapMagicalZone extends MapRegionBase {
  zoneType: MagicalZoneType;
  radius?: number;
  effects: Record<string, unknown>;
  detectionDifficulty: number;
}

export interface PlacedFurniture {
  id: string;
  furnitureDefId: string;
  /** Tile-space origin (top-left); supports 0.5 steps for stacking. */
  x: number;
  y: number;
  rotation: 0 | 90 | 180 | 270;
  /** Draw priority 0–100 (0=background, 1=floor, higher=in front). */
  renderLevel?: number;
  flipped?: boolean;
}

/** Invisible 1×1 interaction trigger placed in the map editor (like spawn points). */
export interface PlacedInteractionZone {
  id: string;
  name: string;
  /** Tile-space center; supports 0.5 steps. */
  x: number;
  y: number;
  interactionType: string;
  data?: Record<string, unknown>;
  targetScene?: string;
  targetSpawn?: string;
}

export interface PlacedDecoration {
  id: string;
  decorationDefId: string;
  /** Tile-space origin; supports 0.5 steps for stacking. */
  x: number;
  y: number;
  rotation: 0 | 90 | 180 | 270;
  /** Draw priority 0–100 (0=background, 1=floor, higher=in front). */
  renderLevel?: number;
  scale?: number;
  wallMounted?: boolean;
}

/** Full editable map document stored in MapVersion.document */
export interface MapBuilderDocument {
  layers: MapLayerState[];
  collision: CollisionCell[];
  spawnpoints: MapSpawnpoint[];
  npcPlacements: MapNpcPlacement[];
  spiritPlacements: MapSpiritPlacement[];
  wardPlacements: MapWardPlacement[];
  portals: MapPortal[];
  lightingRegions: MapLightingRegion[];
  weatherRegions: MapWeatherRegion[];
  audioRegions: MapAudioRegion[];
  magicalZones: MapMagicalZone[];
  placedFurniture: PlacedFurniture[];
  placedDecorations: PlacedDecoration[];
  /** Invisible interaction triggers (altar, shop, crafting, etc.) */
  interactionZones?: PlacedInteractionZone[];
  /** Legacy runtime compat — derived on publish */
  interactables?: {
    id: string;
    type: string;
    x: number;
    y: number;
    targetScene?: string;
    targetSpawn?: string;
    data?: Record<string, unknown>;
  }[];
}

export interface MapValidationIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  path?: string;
}

export interface MapValidationResult {
  valid: boolean;
  issues: MapValidationIssue[];
}

export interface TileDefinition {
  id: string;
  name: string;
  description: string;
  tilesetId: string;
  category: string;
  tags: string[];
  spriteRef: string;
  walkable: boolean;
  blocksMovement: boolean;
  blocksSpiritMovement: boolean;
  animated: boolean;
  properties: Record<string, unknown>;
  archived: boolean;
}

export interface TilesetDefinition {
  id: string;
  name: string;
  imageUrl?: string;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
  tags: string[];
  archived: boolean;
}

export interface FurnitureDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  spriteRef: string;
  width: number;
  height: number;
  rotationStates: number[];
  collisionFootprint: { x: number; y: number }[];
  interactionType?: string;
  magicalBuffs?: Record<string, number>;
  placementRules?: Record<string, unknown>;
  rarity?: string;
  shopPrice?: number;
  archived: boolean;
}

export interface DecorationDefinition {
  id: string;
  name: string;
  description: string;
  spriteRef: string;
  wallMounted: boolean;
  animated: boolean;
  lightEmission?: number;
  placementRules?: Record<string, unknown>;
  archived: boolean;
}

export interface MapPreviewInvite {
  id: string;
  mapProjectId: string;
  mapVersionId: string;
  targetUsername: string;
  invitedBy: string;
  persona: PreviewPersona;
  status: 'pending' | 'active' | 'ended' | 'declined' | 'expired';
  createdAt: string;
  expiresAt: string;
}

export interface MapPublishRecord {
  id: string;
  mapProjectId: string;
  version: number;
  action: 'publish' | 'unpublish' | 'rollback';
  changelog?: string;
  publishedBy: string;
  createdAt: string;
}
