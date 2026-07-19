import type {
  MapBuilderDocument,
  MapProjectMetadata,
  MapValidationIssue,
  MapValidationResult,
  MapWardPlacement,
} from './types.js';
import { getSpritePixelsFromProperties } from './sprite-pixels.js';
import { normalizePlacedRenderLevel } from './placement.js';
import {
  getInteractionDataFromProperties,
  getInteractionTypeFromProperties,
  getPropertyString,
} from './interaction.js';

export interface MapAssetLookup {
  furniture?: Record<string, { spriteRef: string; width: number; height: number; properties?: unknown }>;
  decorations?: Record<string, { spriteRef: string; properties?: unknown; wallMounted?: boolean }>;
}

export function createEmptyMapDocument(width: number, height: number): MapBuilderDocument {
  const emptyGrid = () => Array.from({ length: height }, () => Array(width).fill(0));
  return {
    layers: [
      { id: 'ground', kind: 'ground', name: 'Ground', visible: true, locked: false, order: 0, cells: emptyGrid() },
      { id: 'floor', kind: 'floor', name: 'Floor', visible: true, locked: false, order: 1, cells: emptyGrid() },
      { id: 'walls', kind: 'wall', name: 'Walls', visible: true, locked: false, order: 2, cells: emptyGrid() },
      { id: 'collision', kind: 'collision', name: 'Collision', visible: true, locked: false, order: 8, cells: emptyGrid() },
    ],
    collision: [],
    spawnpoints: [{ id: 'default', name: 'Default Spawn', type: 'default_player', x: 1, y: 1, facing: 'down', enabled: true, priority: 0 }],
    npcPlacements: [],
    spiritPlacements: [],
    wardPlacements: [],
    portals: [],
    lightingRegions: [],
    weatherRegions: [],
    audioRegions: [],
    magicalZones: [],
    placedFurniture: [],
    placedDecorations: [],
    interactionZones: [],
    interactables: [],
  };
}

export function createDefaultMapMetadata(partial?: Partial<MapProjectMetadata>): MapProjectMetadata {
  return {
    id: partial?.id ?? `map_${Date.now()}`,
    internalName: partial?.internalName ?? 'new_map',
    displayName: partial?.displayName ?? 'New Map',
    description: partial?.description ?? '',
    mapType: partial?.mapType ?? 'custom',
    biome: partial?.biome ?? 'temperate',
    theme: partial?.theme ?? 'default',
    sceneId: partial?.sceneId ?? 'town',
    width: partial?.width ?? 32,
    height: partial?.height ?? 24,
    tileSize: partial?.tileSize ?? 16,
    defaultLighting: partial?.defaultLighting ?? 'normal',
    defaultWeather: partial?.defaultWeather ?? 'clear',
    defaultMusic: partial?.defaultMusic ?? '',
    defaultAmbientSound: partial?.defaultAmbientSound ?? '',
    allowedPlayerCount: partial?.allowedPlayerCount ?? 50,
    isInstanced: partial?.isInstanced ?? false,
    isWardable: partial?.isWardable ?? true,
    allowUnbreakableWards: partial?.allowUnbreakableWards ?? false,
    allowSpirits: partial?.allowSpirits ?? true,
    allowFamiliars: partial?.allowFamiliars ?? true,
    allowNpcSchedules: partial?.allowNpcSchedules ?? true,
    accessLevel: partial?.accessLevel ?? 'public',
    status: partial?.status ?? 'draft',
    version: partial?.version ?? 1,
    createdBy: partial?.createdBy,
    updatedBy: partial?.updatedBy,
  };
}

/** Validate map before publish */
export function validateMapForPublish(
  meta: MapProjectMetadata,
  doc: MapBuilderDocument,
  opts?: { hasUnbreakableWardPermission?: boolean }
): MapValidationResult {
  const issues: MapValidationIssue[] = [];

  if (!meta.displayName?.trim()) {
    issues.push({ severity: 'error', code: 'meta.displayName', message: 'Display name is required.' });
  }
  if (!meta.sceneId?.trim()) {
    issues.push({ severity: 'error', code: 'meta.sceneId', message: 'Scene ID is required.' });
  }
  if (meta.width < 4 || meta.height < 4) {
    issues.push({ severity: 'error', code: 'meta.dimensions', message: 'Map must be at least 4×4 tiles.' });
  }

  const playerSpawns = doc.spawnpoints.filter((s) => s.enabled && s.type === 'default_player');
  if (!playerSpawns.length) {
    issues.push({ severity: 'error', code: 'spawn.missing', message: 'At least one enabled default player spawnpoint is required.' });
  }

  for (const sp of doc.spawnpoints) {
    if (sp.x < 0 || sp.y < 0 || sp.x >= meta.width || sp.y >= meta.height) {
      issues.push({ severity: 'error', code: 'spawn.bounds', message: `Spawnpoint "${sp.name}" is outside map bounds.`, path: sp.id });
    }
  }

  for (const portal of doc.portals) {
    if (!portal.targetMapId?.trim()) {
      issues.push({ severity: 'error', code: 'portal.target', message: `Portal "${portal.name}" has no target map.`, path: portal.id });
    }
    if (!portal.targetSpawnId?.trim()) {
      issues.push({ severity: 'warning', code: 'portal.spawn', message: `Portal "${portal.name}" has no target spawn.`, path: portal.id });
    }
  }

  for (const npc of doc.npcPlacements) {
    if (!npc.npcTemplateId?.trim()) {
      issues.push({ severity: 'error', code: 'npc.template', message: 'NPC placement missing template reference.', path: npc.id });
    }
  }

  for (const ward of doc.wardPlacements) {
    validateWardPlacement(ward, meta, issues, opts?.hasUnbreakableWardPermission ?? false);
  }

  if (!meta.defaultMusic && meta.mapType !== 'apartment_room') {
    issues.push({ severity: 'info', code: 'meta.music', message: 'No default music assigned.' });
  }

  return { valid: !issues.some((i) => i.severity === 'error'), issues };
}

function validateWardPlacement(
  ward: MapWardPlacement,
  meta: MapProjectMetadata,
  issues: MapValidationIssue[],
  hasUnbreakablePerm: boolean
): void {
  if (!meta.isWardable) {
    issues.push({ severity: 'error', code: 'ward.disabled', message: `Ward "${ward.name}" placed on non-wardable map.`, path: ward.id });
  }
  if (ward.unbreakable || ward.breakability === 'unbreakable' || ward.wardType === 'unbreakable') {
    if (!meta.allowUnbreakableWards) {
      issues.push({ severity: 'error', code: 'ward.unbreakable.map', message: `Unbreakable ward "${ward.name}" not allowed on this map.`, path: ward.id });
    }
    if (!hasUnbreakablePerm) {
      issues.push({ severity: 'error', code: 'ward.unbreakable.perm', message: 'Creating unbreakable wards requires admin ward permission.', path: ward.id });
    }
  }
}

/** Convert Map Builder document to legacy ContentMapDefinition for game runtime */
export function documentToRuntimeMap(
  meta: MapProjectMetadata,
  doc: MapBuilderDocument,
  assets?: MapAssetLookup
) {
  const floorCells = doc.layers.find((l) => l.kind === 'floor' || l.id === 'floor')?.cells ?? [];
  const groundCells = doc.layers.find((l) => l.kind === 'ground')?.cells ?? [];
  const walls = doc.layers.find((l) => l.kind === 'wall' || l.id === 'walls')?.cells ?? [];
  const objects = doc.layers.find((l) => l.kind === 'decoration')?.cells ?? [];

  const floor = floorCells.map((row, y) =>
    row.map((v, x) => v || groundCells[y]?.[x] || 0)
  );

  type RuntimeInteractable = NonNullable<MapBuilderDocument['interactables']>[number];
  const byId = new Map<string, RuntimeInteractable>();

  const hasFurnitureAltar = (doc.placedFurniture ?? []).some((f) => {
    const def = assets?.furniture?.[f.furnitureDefId];
    return getInteractionTypeFromProperties(def?.properties) === 'altar';
  });

  for (const inter of doc.interactables ?? []) {
    if (hasFurnitureAltar && inter.type === 'altar') continue;
    byId.set(inter.id, inter);
  }

  for (const p of doc.portals) {
    if (byId.has(p.id)) continue;
    byId.set(p.id, {
      id: p.id,
      type: 'door',
      x: p.sourceX,
      y: p.sourceY,
      targetScene: p.targetMapId,
      targetSpawn: p.targetSpawnId,
      data: { portalName: p.name, twoWay: p.twoWay },
    });
  }

  for (const n of doc.npcPlacements) {
    if (byId.has(n.id)) continue;
    byId.set(n.id, {
      id: n.id,
      type: 'npc',
      x: n.x,
      y: n.y,
      data: { npcId: n.npcTemplateId, shopId: n.shopId },
    });
  }

  const placedFurniture = (doc.placedFurniture ?? []).map((f) => {
    const def = assets?.furniture?.[f.furnitureDefId];
    const width = def?.width ?? 1;
    const height = def?.height ?? 1;
    return {
      id: f.id,
      furnitureDefId: f.furnitureDefId,
      spriteRef: def?.spriteRef ?? f.furnitureDefId,
      x: f.x,
      y: f.y,
      width,
      height,
      rotation: f.rotation,
      renderLevel: normalizePlacedRenderLevel(f.renderLevel),
      spritePixels: getSpritePixelsFromProperties(def?.properties),
    };
  });

  const placedDecorations = (doc.placedDecorations ?? []).map((d) => {
    const def = assets?.decorations?.[d.decorationDefId];
    return {
      id: d.id,
      decorationDefId: d.decorationDefId,
      spriteRef: def?.spriteRef ?? d.decorationDefId,
      x: d.x,
      y: d.y,
      rotation: d.rotation,
      renderLevel: normalizePlacedRenderLevel(d.renderLevel),
      wallMounted: d.wallMounted ?? def?.wallMounted,
      spritePixels: getSpritePixelsFromProperties(def?.properties),
    };
  });

  for (const f of doc.placedFurniture ?? []) {
    if (byId.has(f.id)) continue;
    const def = assets?.furniture?.[f.furnitureDefId];
    const interactionType = getInteractionTypeFromProperties(def?.properties);
    if (!interactionType) continue;
    const width = def?.width ?? 1;
    const height = def?.height ?? 1;
    const extraData = getInteractionDataFromProperties(def?.properties) ?? {};
    byId.set(f.id, {
      id: f.id,
      type: interactionType,
      x: f.x + width / 2,
      y: f.y + height / 2,
      targetScene: getPropertyString(def?.properties, 'targetScene'),
      targetSpawn: getPropertyString(def?.properties, 'targetSpawn'),
      data: {
        ...extraData,
        invisible: false,
        fromFurniture: true,
        centerTileCoords: true,
        footprintWidth: width,
        footprintHeight: height,
      },
    });
  }

  for (const zone of doc.interactionZones ?? []) {
    if (byId.has(zone.id)) continue;
    byId.set(zone.id, {
      id: zone.id,
      type: zone.interactionType,
      x: zone.x,
      y: zone.y,
      targetScene: zone.targetScene,
      targetSpawn: zone.targetSpawn,
      data: {
        ...(zone.data ?? {}),
        invisible: true,
        zoneName: zone.name,
        centerTileCoords: true,
      },
    });
  }

  return {
    id: meta.id,
    name: meta.displayName,
    sceneId: meta.sceneId,
    width: meta.width,
    height: meta.height,
    tileSize: meta.tileSize,
    layers: { floor, walls, objects },
    spawnPoints: doc.spawnpoints.map((s) => ({ id: s.id, x: s.x, y: s.y })),
    interactables: [...byId.values()],
    placedFurniture,
    placedDecorations,
    collision: (doc.collision ?? []).map((c) => ({
      x: c.x,
      y: c.y,
      mode: c.mode,
    })),
  };
}
