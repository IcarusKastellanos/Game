import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ContentMapDefinition } from '@witchcraft/shared';
import type { MapBuilderDocument, MapProjectMetadata } from '@witchcraft/shared';
import { createDefaultMapMetadata, createEmptyMapDocument, ensureMapDocumentTiles, craftStationTypeFromInteractable, isCraftingInteractable } from '@witchcraft/shared';
import { prisma } from '../services/db.js';
import type { ContentRegistry } from './registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = resolve(__dirname, '../../../content');

/** Shared world layouts — not per-player apartment instances */
export const CANONICAL_WORLD_MAP_IDS = ['town_main', 'apartment_main'] as const;
export type CanonicalWorldMapId = (typeof CANONICAL_WORLD_MAP_IDS)[number];

const SCENE_TO_CANONICAL: Record<string, CanonicalWorldMapId> = {
  town: 'town_main',
  apartment: 'apartment_main',
};

function loadMapsJson(): ContentMapDefinition[] {
  const path = resolve(CONTENT_DIR, 'maps.json');
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, 'utf-8')) as ContentMapDefinition[];
}

export function loadCanonicalWorldMaps(): ContentMapDefinition[] {
  const ids = new Set<string>(CANONICAL_WORLD_MAP_IDS);
  return loadMapsJson().filter((m) => ids.has(m.id));
}

/** Prefer canonical map ids when resolving a playable scene */
export function resolveMapForScene(
  maps: Iterable<ContentMapDefinition>,
  sceneId: string
): ContentMapDefinition | undefined {
  const list = [...maps];
  const canonicalId = SCENE_TO_CANONICAL[sceneId];
  if (canonicalId) {
    const canon = list.find((m) => m.id === canonicalId);
    if (canon) return canon;
  }
  return list.find((m) => m.sceneId === sceneId);
}

/** Ensure canonical crafting stations exist on published maps (fixes legacy generic `crafting` zones). */
export function mergeCraftingInteractablesFromTemplate(
  existing: ContentMapDefinition,
  template: ContentMapDefinition
): ContentMapDefinition {
  const templateCraft = template.interactables.filter((i) => isCraftingInteractable(i.type));
  const templateCraftIds = new Set(templateCraft.map((i) => i.id));

  let interactables = existing.interactables.filter((i) => {
    if (!isCraftingInteractable(i.type)) return true;
    // Furniture-spawned crafting stations (map builder) are never template-managed.
    if (i.data?.fromFurniture === true) return true;
    return templateCraftIds.has(i.id);
  });
  let changed = interactables.length !== existing.interactables.length;

  if (!templateCraft.length) {
    return changed ? { ...existing, interactables } : existing;
  }

  for (const canon of templateCraft) {
    const idx = interactables.findIndex((i) => i.id === canon.id);
    if (idx === -1) {
      interactables.push(structuredClone(canon));
      changed = true;
      continue;
    }
    const current = interactables[idx]!;
    if (!isCraftingInteractable(current.type)) continue;

    const canonStation = craftStationTypeFromInteractable(canon);
    const currentStation = craftStationTypeFromInteractable(current);
    const needsUpdate =
      current.type !== canon.type ||
      currentStation !== canonStation ||
      current.type === 'crafting';

    if (needsUpdate) {
      interactables[idx] = {
        ...current,
        type: canon.type,
        data: { ...current.data, ...canon.data, stationType: canonStation },
      };
      changed = true;
    }
  }

  return changed ? { ...existing, interactables } : existing;
}

/** Re-apply town + apartment templates from maps.json when registry copies are missing or stripped. */
export function applyCanonicalWorldMapsToRegistry(registry: ContentRegistry, force = false): number {
  let count = 0;
  for (const map of loadCanonicalWorldMaps()) {
    const existing = registry.maps.get(map.id);
    const broken =
      !existing ||
      ((existing.interactables?.length ?? 0) === 0 &&
        (existing.placedFurniture?.length ?? 0) === 0 &&
        (existing.placedDecorations?.length ?? 0) === 0);
    if (force || broken) {
      registry.maps.set(map.id, structuredClone(map));
      count++;
    } else if (existing) {
      const merged = mergeCraftingInteractablesFromTemplate(existing, map);
      if (merged !== existing) {
        registry.maps.set(map.id, merged);
        count++;
      }
    }
  }
  if (count > 0) {
    console.log(`[ContentRegistry] Restored ${count} canonical world map template(s) from maps.json`);
  }
  return count;
}

export function runtimeMapToBuilderDocument(map: ContentMapDefinition): MapBuilderDocument {
  const doc = createEmptyMapDocument(map.width, map.height);

  const applyLayer = (kind: 'floor' | 'wall' | 'decoration', cells: number[][] | undefined) => {
    if (!cells?.length) return;
    const layer = doc.layers.find((l) => l.kind === kind || (kind === 'wall' && l.id === 'walls'));
    if (!layer) return;
    for (let y = 0; y < Math.min(map.height, cells.length); y++) {
      for (let x = 0; x < Math.min(map.width, cells[y]?.length ?? 0); x++) {
        layer.cells[y][x] = cells[y][x] ?? 0;
      }
    }
  };

  applyLayer('floor', map.layers.floor);
  applyLayer('wall', map.layers.walls);
  applyLayer('decoration', map.layers.objects);

  ensureMapDocumentTiles(doc, map.width, map.height, map.sceneId);

  doc.spawnpoints = map.spawnPoints.map((sp) => ({
    id: sp.id,
    name: sp.id === 'default' ? 'Default Spawn' : sp.id,
    type: sp.id === 'door' ? 'room_entrance' : 'default_player',
    x: sp.x,
    y: sp.y,
    facing: 'down' as const,
    enabled: true,
    priority: sp.id === 'default' ? 0 : 1,
  }));

  doc.interactables = map.interactables.map((inter) => ({
    id: inter.id,
    type: inter.type,
    x: inter.x,
    y: inter.y,
    targetScene: inter.targetScene,
    targetSpawn: inter.targetSpawn,
    data: inter.data,
  }));

  for (const inter of map.interactables) {
    if (inter.type === 'door' && inter.targetScene) {
      doc.portals.push({
        id: inter.id,
        name: String(inter.data?.label ?? inter.id),
        sourceX: inter.x,
        sourceY: inter.y,
        targetMapId: inter.targetScene,
        targetSpawnId: inter.targetSpawn ?? 'default',
        direction: 'down',
        twoWay: true,
        visible: true,
      });
    }
    if (inter.type === 'npc' && inter.data?.npcId) {
      doc.npcPlacements.push({
        id: inter.id,
        npcTemplateId: String(inter.data.npcId),
        x: inter.x,
        y: inter.y,
        staticPosition: true,
      });
    }
  }

  return doc;
}

export function runtimeMapToMetadata(map: ContentMapDefinition): MapProjectMetadata {
  const isApartment = map.id === 'apartment_main';
  return createDefaultMapMetadata({
    id: map.id,
    internalName: isApartment ? 'apartment_general_template' : map.id,
    displayName: isApartment ? 'Apartment General Template' : map.name,
    description: isApartment
      ? 'Shared apartment layout for all players. Player decorations and wards are per-instance overlays.'
      : 'Hollow Creek town starting map — shared by all players.',
    mapType: map.sceneId === 'town' ? 'town_exterior' : 'apartment_room',
    sceneId: map.sceneId,
    width: map.width,
    height: map.height,
    tileSize: map.tileSize,
    isInstanced: false,
    isWardable: true,
    allowSpirits: map.sceneId === 'town',
    status: 'published',
  });
}

/** Ensure Map Builder DB has town + apartment general templates for admin editing. */
export async function ensureCanonicalMapProjects(): Promise<void> {
  for (const map of loadCanonicalWorldMaps()) {
    const existing = await prisma.mapProject.findUnique({ where: { id: map.id } });
    const metadata = runtimeMapToMetadata(map);
    const document = runtimeMapToBuilderDocument(map);

    if (!existing) {
      const row = await prisma.mapProject.create({
        data: {
          id: metadata.id,
          internalName: metadata.internalName,
          displayName: metadata.displayName,
          description: metadata.description,
          mapType: metadata.mapType,
          biome: metadata.biome,
          theme: metadata.theme,
          sceneId: metadata.sceneId,
          width: metadata.width,
          height: metadata.height,
          tileSize: metadata.tileSize,
          defaultLighting: metadata.defaultLighting,
          defaultWeather: metadata.defaultWeather,
          defaultMusic: metadata.defaultMusic,
          defaultAmbientSound: metadata.defaultAmbientSound,
          allowedPlayerCount: metadata.allowedPlayerCount,
          isInstanced: metadata.isInstanced,
          isWardable: metadata.isWardable,
          allowUnbreakableWards: metadata.allowUnbreakableWards,
          allowSpirits: metadata.allowSpirits,
          allowFamiliars: metadata.allowFamiliars,
          allowNpcSchedules: metadata.allowNpcSchedules,
          accessLevel: metadata.accessLevel,
          status: 'published',
          version: 1,
          createdBy: 'system',
          updatedBy: 'system',
          publishedAt: new Date(),
        },
      });
      const version = await prisma.mapVersion.create({
        data: {
          mapProjectId: row.id,
          version: 1,
          document: document as never,
          changelog: 'Seeded from maps.json canonical template',
          createdBy: 'system',
        },
      });
      await prisma.mapProject.update({
        where: { id: row.id },
        data: { currentVersionId: version.id },
      });
      await prisma.contentMap.upsert({
        where: { id: map.id },
        create: map as never,
        update: map as never,
      });
      console.log(`[MapBuilder] Seeded canonical map project: ${metadata.displayName}`);
      continue;
    }

    // Repair published canonical rows stripped by an empty editor publish
    const version = existing.currentVersionId
      ? await prisma.mapVersion.findUnique({ where: { id: existing.currentVersionId } })
      : null;
    const doc = version?.document as MapBuilderDocument | undefined;
    const hasInteractables = (doc?.interactables?.length ?? 0) > 0 || (doc?.portals?.length ?? 0) > 0;
    if (!hasInteractables) {
      const restoredDoc = runtimeMapToBuilderDocument(map);
      const nextVersion = existing.version + 1;
      const newVersion = await prisma.mapVersion.create({
        data: {
          mapProjectId: existing.id,
          version: nextVersion,
          document: restoredDoc as never,
          changelog: 'Restored canonical template from maps.json',
          createdBy: 'system',
        },
      });
      await prisma.mapProject.update({
        where: { id: existing.id },
        data: {
          displayName: metadata.displayName,
          internalName: metadata.internalName,
          description: metadata.description,
          version: nextVersion,
          status: 'published',
          currentVersionId: newVersion.id,
          updatedBy: 'system',
        },
      });
      await prisma.contentMap.upsert({
        where: { id: map.id },
        create: map as never,
        update: map as never,
      });
      console.log(`[MapBuilder] Repaired canonical map project: ${metadata.displayName}`);
    }
  }
}

export function isCanonicalWorldMapId(id: string): id is CanonicalWorldMapId {
  return (CANONICAL_WORLD_MAP_IDS as readonly string[]).includes(id);
}
