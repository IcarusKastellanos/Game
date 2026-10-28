import type {
  MapBuilderDocument,
  MapProjectMetadata,
  MapValidationResult,
} from '@witchcraft/shared';
import {
  createDefaultMapMetadata,
  createEmptyMapDocument,
  validateMapForPublish,
  MAP_TILE_CATALOG,
} from '@witchcraft/shared';
import { documentToRuntimeMapWithAssets } from './runtime-map.js';
import { ensureBuiltinFurnitureDefinitions } from './builtin-assets.js';
import { prisma } from '../../../services/db.js';
import { contentRegistry } from '../../../content/registry.js';
import {
  applyCanonicalWorldMapsToRegistry,
  ensureCanonicalMapProjects,
  isCanonicalWorldMapId,
} from '../../../content/canonical-maps.js';
import type { AuditContext } from '../../audit.js';
import { writeAuditLog } from '../../audit.js';

function rowToMeta(row: {
  id: string;
  internalName: string;
  displayName: string;
  description: string;
  mapType: string;
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
  accessLevel: string;
  status: string;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  publishedAt: Date | null;
  archivedAt: Date | null;
}): MapProjectMetadata {
  return {
    id: row.id,
    internalName: row.internalName,
    displayName: row.displayName,
    description: row.description,
    mapType: row.mapType as MapProjectMetadata['mapType'],
    biome: row.biome,
    theme: row.theme,
    sceneId: row.sceneId,
    width: row.width,
    height: row.height,
    tileSize: row.tileSize,
    defaultLighting: row.defaultLighting,
    defaultWeather: row.defaultWeather,
    defaultMusic: row.defaultMusic,
    defaultAmbientSound: row.defaultAmbientSound,
    allowedPlayerCount: row.allowedPlayerCount,
    isInstanced: row.isInstanced,
    isWardable: row.isWardable,
    allowUnbreakableWards: row.allowUnbreakableWards,
    allowSpirits: row.allowSpirits,
    allowFamiliars: row.allowFamiliars,
    allowNpcSchedules: row.allowNpcSchedules,
    accessLevel: row.accessLevel as MapProjectMetadata['accessLevel'],
    status: row.status as MapProjectMetadata['status'],
    version: row.version,
    createdBy: row.createdBy ?? undefined,
    updatedBy: row.updatedBy ?? undefined,
    publishedAt: row.publishedAt?.toISOString(),
    archivedAt: row.archivedAt?.toISOString(),
  };
}

export async function listMapProjects(includeArchived = false) {
  await ensureCanonicalMapProjects().catch((err) => {
    console.warn('[MapBuilder] ensureCanonicalMapProjects:', err);
  });
  const rows = await prisma.mapProject.findMany({
    where: includeArchived ? undefined : { status: { not: 'archived' } },
    orderBy: { updatedAt: 'desc' },
  });
  return rows.map(rowToMeta);
}

export async function getMapProject(id: string) {
  const row = await prisma.mapProject.findUnique({ where: { id } });
  if (!row) return null;
  const version = row.currentVersionId
    ? await prisma.mapVersion.findUnique({ where: { id: row.currentVersionId } })
    : null;
  return {
    metadata: rowToMeta(row),
    document: (version?.document as unknown as MapBuilderDocument) ?? createEmptyMapDocument(row.width, row.height),
    versionId: version?.id,
  };
}

export async function createMapProject(
  partial: Partial<MapProjectMetadata>,
  adminUsername: string,
  audit: AuditContext
) {
  const meta = createDefaultMapMetadata(partial);
  const doc = createEmptyMapDocument(meta.width, meta.height);
  const row = await prisma.mapProject.create({
    data: {
      id: meta.id,
      internalName: meta.internalName,
      displayName: meta.displayName,
      description: meta.description,
      mapType: meta.mapType,
      biome: meta.biome,
      theme: meta.theme,
      sceneId: meta.sceneId,
      width: meta.width,
      height: meta.height,
      tileSize: meta.tileSize,
      defaultLighting: meta.defaultLighting,
      defaultWeather: meta.defaultWeather,
      defaultMusic: meta.defaultMusic,
      defaultAmbientSound: meta.defaultAmbientSound,
      allowedPlayerCount: meta.allowedPlayerCount,
      isInstanced: meta.isInstanced,
      isWardable: meta.isWardable,
      allowUnbreakableWards: meta.allowUnbreakableWards,
      allowSpirits: meta.allowSpirits,
      allowFamiliars: meta.allowFamiliars,
      allowNpcSchedules: meta.allowNpcSchedules,
      accessLevel: meta.accessLevel,
      status: 'draft',
      version: 1,
      createdBy: adminUsername,
      updatedBy: adminUsername,
    },
  });
  const version = await prisma.mapVersion.create({
    data: {
      mapProjectId: row.id,
      version: 1,
      document: doc as never,
      changelog: 'Initial draft',
      createdBy: adminUsername,
    },
  });
  await prisma.mapProject.update({
    where: { id: row.id },
    data: { currentVersionId: version.id },
  });
  await writeAuditLog(audit, {
    action: 'map.create',
    objectType: 'map_project',
    objectId: row.id,
    newValue: meta,
  });
  return { metadata: rowToMeta(row), document: doc, versionId: version.id };
}

export async function saveMapDraft(
  id: string,
  metadata: MapProjectMetadata,
  document: MapBuilderDocument,
  adminUsername: string,
  audit: AuditContext,
  changelog?: string
) {
  const existing = await prisma.mapProject.findUnique({ where: { id } });
  if (!existing) return null;
  if (existing.status === 'archived') throw new Error('Cannot edit archived map.');

  const nextVersion = existing.version + 1;
  const version = await prisma.mapVersion.create({
    data: {
      mapProjectId: id,
      version: nextVersion,
      document: document as never,
      changelog: changelog ?? `Draft save v${nextVersion}`,
      createdBy: adminUsername,
    },
  });

  const row = await prisma.mapProject.update({
    where: { id },
    data: {
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
      version: nextVersion,
      updatedBy: adminUsername,
      currentVersionId: version.id,
    },
  });

  await writeAuditLog(audit, {
    action: 'map.draft.save',
    objectType: 'map_project',
    objectId: id,
    newValue: { version: nextVersion },
  });

  return { metadata: rowToMeta(row), document, versionId: version.id };
}

export async function validateMap(id: string, hasUnbreakablePerm: boolean): Promise<MapValidationResult | null> {
  const pack = await getMapProject(id);
  if (!pack) return null;
  return validateMapForPublish(pack.metadata, pack.document, { hasUnbreakableWardPermission: hasUnbreakablePerm });
}

export async function publishMapProject(
  id: string,
  adminUsername: string,
  audit: AuditContext,
  changelog?: string,
  hasUnbreakablePerm = false
) {
  const pack = await getMapProject(id);
  if (!pack) return { ok: false as const, error: 'Map not found' };

  const validation = validateMapForPublish(pack.metadata, pack.document, {
    hasUnbreakableWardPermission: hasUnbreakablePerm,
  });
  if (!validation.valid) {
    return { ok: false as const, error: 'Validation failed', validation };
  }

  const runtimeMap = await documentToRuntimeMapWithAssets(pack.metadata, pack.document);
  contentRegistry.maps.set(runtimeMap.id, runtimeMap as never);

  await prisma.contentMap.upsert({
    where: { id: runtimeMap.id },
    create: runtimeMap as never,
    update: runtimeMap as never,
  });

  // Guard against empty publishes wiping doors/shops/altar on shared world maps
  const publishEmpty =
    (runtimeMap.interactables?.length ?? 0) === 0 &&
    (runtimeMap.placedFurniture?.length ?? 0) === 0 &&
    (runtimeMap.placedDecorations?.length ?? 0) === 0;
  if (isCanonicalWorldMapId(runtimeMap.id) && publishEmpty) {
    applyCanonicalWorldMapsToRegistry(contentRegistry);
  }

  const row = await prisma.mapProject.update({
    where: { id },
    data: { status: 'published', publishedAt: new Date(), updatedBy: adminUsername },
  });

  await prisma.mapPublishLog.create({
    data: {
      mapProjectId: id,
      version: row.version,
      action: 'publish',
      changelog,
      publishedBy: adminUsername,
    },
  });

  await writeAuditLog(audit, {
    action: 'map.publish',
    objectType: 'map_project',
    objectId: id,
    newValue: { version: row.version, runtimeMap },
    reason: changelog,
  });

  return { ok: true as const, metadata: rowToMeta(row), validation };
}

export async function unpublishMapProject(id: string, adminUsername: string, audit: AuditContext) {
  const row = await prisma.mapProject.update({
    where: { id },
    data: { status: 'draft', updatedBy: adminUsername },
  });
  contentRegistry.maps.delete(id);
  await prisma.mapPublishLog.create({
    data: { mapProjectId: id, version: row.version, action: 'unpublish', publishedBy: adminUsername },
  });
  await writeAuditLog(audit, { action: 'map.unpublish', objectType: 'map_project', objectId: id });
  return rowToMeta(row);
}

export async function archiveMapProject(id: string, adminUsername: string, audit: AuditContext) {
  const row = await prisma.mapProject.update({
    where: { id },
    data: { status: 'archived', archivedAt: new Date(), updatedBy: adminUsername },
  });
  contentRegistry.maps.delete(id);
  await writeAuditLog(audit, { action: 'map.archive', objectType: 'map_project', objectId: id });
  return rowToMeta(row);
}

export async function restoreMapProject(id: string, adminUsername: string, audit: AuditContext) {
  const row = await prisma.mapProject.update({
    where: { id },
    data: { status: 'draft', archivedAt: null, updatedBy: adminUsername },
  });
  await writeAuditLog(audit, { action: 'map.restore', objectType: 'map_project', objectId: id });
  return rowToMeta(row);
}

export async function duplicateMapProject(id: string, adminUsername: string, audit: AuditContext) {
  const pack = await getMapProject(id);
  if (!pack) return null;
  const newId = `${id}_copy_${Date.now().toString(36)}`;
  await createMapProject(
    {
      ...pack.metadata,
      id: newId,
      internalName: `${pack.metadata.internalName}_copy`,
      displayName: `${pack.metadata.displayName} (Copy)`,
      status: 'draft',
      version: 1,
    },
    adminUsername,
    audit
  );
  await saveMapDraft(newId, { ...pack.metadata, id: newId }, pack.document, adminUsername, audit, `Duplicated from ${id}`);
  await writeAuditLog(audit, { action: 'map.duplicate', objectType: 'map_project', objectId: newId, newValue: { sourceId: id } });
  return getMapProject(newId);
}

export async function deleteDraftMap(id: string, audit: AuditContext) {
  const row = await prisma.mapProject.findUnique({ where: { id } });
  if (!row) return false;
  if (row.status === 'published') throw new Error('Unpublish before deleting.');
  await prisma.mapProject.delete({ where: { id } });
  await writeAuditLog(audit, { action: 'map.delete', objectType: 'map_project', objectId: id, previousValue: row });
  return true;
}

export async function listMapVersions(id: string) {
  return prisma.mapVersion.findMany({
    where: { mapProjectId: id },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, changelog: true, createdBy: true, createdAt: true },
  });
}

export async function rollbackMapVersion(id: string, versionId: string, adminUsername: string, audit: AuditContext) {
  const version = await prisma.mapVersion.findFirst({ where: { id: versionId, mapProjectId: id } });
  if (!version) return null;
  const doc = version.document as unknown as MapBuilderDocument;
  const pack = await getMapProject(id);
  if (!pack) return null;
  const saved = await saveMapDraft(id, pack.metadata, doc, adminUsername, audit, `Rollback to v${version.version}`);
  await prisma.mapPublishLog.create({
    data: { mapProjectId: id, version: version.version, action: 'rollback', publishedBy: adminUsername },
  });
  await writeAuditLog(audit, { action: 'map.rollback', objectType: 'map_project', objectId: id, newValue: { version: version.version } });
  return saved;
}

export async function createPreviewInvite(
  mapId: string,
  targetUsername: string,
  invitedBy: string,
  persona: string,
  audit: AuditContext
) {
  const pack = await getMapProject(mapId);
  if (!pack?.versionId) return null;
  const invite = await prisma.mapPreviewInvite.create({
    data: {
      mapProjectId: mapId,
      mapVersionId: pack.versionId,
      targetUsername: targetUsername.toLowerCase(),
      invitedBy,
      persona,
      status: 'pending',
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    },
  });
  await writeAuditLog(audit, {
    action: 'map.preview.invite',
    objectType: 'map_preview_invite',
    objectId: invite.id,
    newValue: { mapId, targetUsername, persona },
  });
  // TODO: push map_preview_invite to GameRoom for online player (apartment-invite pattern)
  return invite;
}

export async function mergePublishedMapsIntoRegistry(): Promise<number> {
  try {
    await ensureBuiltinFurnitureDefinitions();
    const published = await prisma.mapProject.findMany({ where: { status: 'published' } });
    let count = 0;
    for (const row of published) {
      if (!row.currentVersionId) continue;
      const version = await prisma.mapVersion.findUnique({ where: { id: row.currentVersionId } });
      if (!version) continue;
      const meta = rowToMeta(row);
      const doc = version.document as unknown as MapBuilderDocument;
      const runtime = await documentToRuntimeMapWithAssets(meta, doc);
      contentRegistry.maps.set(runtime.id, runtime as never);
      count++;
    }
    applyCanonicalWorldMapsToRegistry(contentRegistry);
    return count;
  } catch (err) {
    console.warn(
      '[MapBuilder] Published map merge failed; using JSON maps only:',
      err instanceof Error ? err.message : err
    );
    applyCanonicalWorldMapsToRegistry(contentRegistry);
    return 0;
  }
}

export async function listTilesets(includeArchived = false) {
  return prisma.mapTileset.findMany({
    where: includeArchived ? undefined : { archived: false },
    orderBy: { name: 'asc' },
  });
}

export async function upsertTileset(data: Record<string, unknown>, audit: AuditContext) {
  const id = String(data.id);
  const row = await prisma.mapTileset.upsert({ where: { id }, create: data as never, update: data as never });
  await writeAuditLog(audit, { action: 'map.tileset.upsert', objectType: 'map_tileset', objectId: id, newValue: row });
  return row;
}

export async function listTileDefinitions(includeArchived = false) {
  const db = await prisma.mapTileDefinition.findMany({
    where: includeArchived ? undefined : { archived: false },
    orderBy: { name: 'asc' },
  });
  if (db.length) return db;
  return MAP_TILE_CATALOG.map((t) => ({
    id: t.id,
    name: t.name,
    tilesetId: 'default',
    category: t.layerKind,
    tags: [],
    spriteRef: t.spriteKey,
    walkable: t.layerKind !== 'wall',
    properties: {},
    archived: false,
  }));
}

export async function upsertTileDefinition(data: Record<string, unknown>, audit: AuditContext) {
  const id = String(data.id);
  const row = await prisma.mapTileDefinition.upsert({ where: { id }, create: data as never, update: data as never });
  await writeAuditLog(audit, { action: 'map.tile.upsert', objectType: 'map_tile', objectId: id, newValue: row });
  return row;
}

export async function listFurnitureDefinitions(includeArchived = false) {
  await ensureBuiltinFurnitureDefinitions();
  return prisma.mapFurnitureDefinition.findMany({
    where: includeArchived ? undefined : { archived: false },
    orderBy: { name: 'asc' },
  });
}

export async function upsertFurnitureDefinition(data: Record<string, unknown>, audit: AuditContext) {
  const id = String(data.id);
  const row = await prisma.mapFurnitureDefinition.upsert({ where: { id }, create: data as never, update: data as never });
  await writeAuditLog(audit, { action: 'map.furniture.upsert', objectType: 'map_furniture', objectId: id, newValue: row });
  await mergePublishedMapsIntoRegistry();
  return row;
}

export async function listDecorationDefinitions(includeArchived = false) {
  return prisma.mapDecorationDefinition.findMany({
    where: includeArchived ? undefined : { archived: false },
    orderBy: { name: 'asc' },
  });
}

export async function upsertDecorationDefinition(data: Record<string, unknown>, audit: AuditContext) {
  const id = String(data.id);
  const row = await prisma.mapDecorationDefinition.upsert({ where: { id }, create: data as never, update: data as never });
  await writeAuditLog(audit, { action: 'map.decoration.upsert', objectType: 'map_decoration', objectId: id, newValue: row });
  await mergePublishedMapsIntoRegistry();
  return row;
}

export async function seedDefaultMapAssets(audit: AuditContext) {
  const tilesetData = {
    id: 'default',
    name: 'Default Tileset',
    imageUrl: null,
    tileWidth: 16,
    tileHeight: 16,
    columns: 16,
    rows: 16,
    tags: [],
    archived: false,
  };
  await upsertTileset(tilesetData, audit);

  let tiles = 0;
  for (const t of MAP_TILE_CATALOG) {
    await upsertTileDefinition(
      {
        id: t.id,
        name: t.name,
        tilesetId: 'default',
        category: t.layerKind,
        spriteRef: t.spriteKey,
        walkable: t.layerKind !== 'wall',
        tags: [],
        archived: false,
      },
      audit
    );
    tiles++;
  }

  await writeAuditLog(audit, {
    action: 'map.assets.seed_defaults',
    objectType: 'map_tileset',
    objectId: 'default',
    newValue: { tiles },
  });

  return { ok: true, tilesetId: 'default', tiles };
}

export async function listPublishQueue() {
  return prisma.mapProject.findMany({
    where: { status: { in: ['draft', 'pending_review'] } },
    orderBy: { updatedAt: 'desc' },
  });
}

export async function listPublishHistory(mapId?: string) {
  return prisma.mapPublishLog.findMany({
    where: mapId ? { mapProjectId: mapId } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}
