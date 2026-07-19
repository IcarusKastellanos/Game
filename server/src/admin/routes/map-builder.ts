import { Router } from 'express';
import { adminAuthMiddleware, requirePerm, auditContext, type AdminRequest } from '../middleware.js';
import { param } from '../util.js';
import {
  archiveMapProject,
  createMapProject,
  createPreviewInvite,
  deleteDraftMap,
  duplicateMapProject,
  getMapProject,
  listDecorationDefinitions,
  listFurnitureDefinitions,
  listMapProjects,
  listMapVersions,
  listPublishHistory,
  listPublishQueue,
  listTileDefinitions,
  listTilesets,
  mergePublishedMapsIntoRegistry,
  publishMapProject,
  restoreMapProject,
  rollbackMapVersion,
  saveMapDraft,
  unpublishMapProject,
  upsertDecorationDefinition,
  upsertFurnitureDefinition,
  upsertTileDefinition,
  upsertTileset,
  seedDefaultMapAssets,
  validateMap,
} from '../services/map-builder/index.js';
import { applyCanonicalWorldMapsToRegistry, ensureCanonicalMapProjects } from '../../content/canonical-maps.js';
import { contentRegistry } from '../../content/registry.js';
import type { MapBuilderDocument, MapProjectMetadata } from '@witchcraft/shared';

export const mapBuilderRouter = Router();
mapBuilderRouter.use(adminAuthMiddleware);

function adminUser(req: AdminRequest): string {
  return req.admin?.username ?? 'admin';
}

function hasPerm(req: AdminRequest, slug: string): boolean {
  return (req.admin?.permissions ?? []).includes(slug as never);
}

// --- Maps ---
mapBuilderRouter.get('/maps', requirePerm('content.map.view'), async (req, res) => {
  const includeArchived = req.query.archived === '1';
  res.json(await listMapProjects(includeArchived));
});

mapBuilderRouter.get('/maps/:id', requirePerm('content.map.view'), async (req, res) => {
  const pack = await getMapProject(param(req, 'id'));
  if (!pack) return res.status(404).json({ error: 'Not found' });
  res.json(pack);
});

mapBuilderRouter.post('/maps', requirePerm('content.map.edit'), async (req: AdminRequest, res) => {
  try {
    const created = await createMapProject(req.body as Partial<MapProjectMetadata>, adminUser(req), auditContext(req));
    res.status(201).json(created);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

mapBuilderRouter.put('/maps/:id', requirePerm('content.map.edit'), async (req: AdminRequest, res) => {
  const id = param(req, 'id');
  const { metadata, document, changelog } = req.body as {
    metadata: MapProjectMetadata;
    document: MapBuilderDocument;
    changelog?: string;
  };
  try {
    const saved = await saveMapDraft(id, metadata, document, adminUser(req), auditContext(req), changelog);
    if (!saved) return res.status(404).json({ error: 'Not found' });
    res.json(saved);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

mapBuilderRouter.delete('/maps/:id', requirePerm('content.map.edit'), async (req: AdminRequest, res) => {
  try {
    await deleteDraftMap(param(req, 'id'), auditContext(req));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

mapBuilderRouter.post('/maps/:id/duplicate', requirePerm('content.map.edit'), async (req: AdminRequest, res) => {
  const dup = await duplicateMapProject(param(req, 'id'), adminUser(req), auditContext(req));
  if (!dup) return res.status(404).json({ error: 'Not found' });
  res.status(201).json(dup);
});

mapBuilderRouter.post('/maps/:id/archive', requirePerm('content.map.edit'), async (req: AdminRequest, res) => {
  res.json(await archiveMapProject(param(req, 'id'), adminUser(req), auditContext(req)));
});

mapBuilderRouter.post('/maps/:id/restore', requirePerm('content.map.edit'), async (req: AdminRequest, res) => {
  res.json(await restoreMapProject(param(req, 'id'), adminUser(req), auditContext(req)));
});

mapBuilderRouter.post('/maps/:id/validate', requirePerm('content.map.view'), async (req: AdminRequest, res) => {
  const result = await validateMap(param(req, 'id'), hasPerm(req, 'content.map.ward.unbreakable'));
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json(result);
});

mapBuilderRouter.post('/maps/:id/publish', requirePerm('content.map.publish'), async (req: AdminRequest, res) => {
  const result = await publishMapProject(
    param(req, 'id'),
    adminUser(req),
    auditContext(req),
    req.body.changelog,
    hasPerm(req, 'content.map.ward.unbreakable')
  );
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

mapBuilderRouter.post('/maps/:id/unpublish', requirePerm('content.map.publish'), async (req: AdminRequest, res) => {
  res.json(await unpublishMapProject(param(req, 'id'), adminUser(req), auditContext(req)));
});

mapBuilderRouter.get('/maps/:id/versions', requirePerm('content.map.view'), async (req, res) => {
  res.json(await listMapVersions(param(req, 'id')));
});

mapBuilderRouter.post('/maps/:id/rollback/:versionId', requirePerm('content.map.edit'), async (req: AdminRequest, res) => {
  const saved = await rollbackMapVersion(param(req, 'id'), param(req, 'versionId'), adminUser(req), auditContext(req));
  if (!saved) return res.status(404).json({ error: 'Not found' });
  res.json(saved);
});

mapBuilderRouter.post('/maps/:id/preview-invite', requirePerm('content.map.preview'), async (req: AdminRequest, res) => {
  const { username, persona } = req.body as { username: string; persona?: string };
  if (!username?.trim()) return res.status(400).json({ error: 'username required' });
  const invite = await createPreviewInvite(param(req, 'id'), username, adminUser(req), persona ?? 'player', auditContext(req));
  if (!invite) return res.status(404).json({ error: 'Map not found' });
  res.status(201).json(invite);
});

// --- Tilesets & tiles ---
mapBuilderRouter.get('/tilesets', requirePerm('content.map.view'), async (req, res) => {
  const includeArchived = req.query.archived === '1';
  res.json(await listTilesets(includeArchived));
});

mapBuilderRouter.put('/tilesets/:id', requirePerm('content.map.edit'), async (req: AdminRequest, res) => {
  res.json(await upsertTileset({ ...req.body, id: param(req, 'id') }, auditContext(req)));
});

mapBuilderRouter.get('/tiles', requirePerm('content.map.view'), async (req, res) => {
  const includeArchived = req.query.archived === '1';
  res.json(await listTileDefinitions(includeArchived));
});

mapBuilderRouter.put('/tiles/:id', requirePerm('content.map.edit'), async (req: AdminRequest, res) => {
  res.json(await upsertTileDefinition({ ...req.body, id: param(req, 'id') }, auditContext(req)));
});

// --- Furniture & decorations ---
mapBuilderRouter.get('/furniture', requirePerm('content.map.view'), async (req, res) => {
  const includeArchived = req.query.archived === '1';
  res.json(await listFurnitureDefinitions(includeArchived));
});

mapBuilderRouter.put('/furniture/:id', requirePerm('content.map.edit'), async (req: AdminRequest, res) => {
  res.json(await upsertFurnitureDefinition({ ...req.body, id: param(req, 'id') }, auditContext(req)));
});

mapBuilderRouter.get('/decorations', requirePerm('content.map.view'), async (req, res) => {
  const includeArchived = req.query.archived === '1';
  res.json(await listDecorationDefinitions(includeArchived));
});

mapBuilderRouter.put('/decorations/:id', requirePerm('content.map.edit'), async (req: AdminRequest, res) => {
  res.json(await upsertDecorationDefinition({ ...req.body, id: param(req, 'id') }, auditContext(req)));
});

mapBuilderRouter.post('/seed-default-assets', requirePerm('content.map.edit'), async (req: AdminRequest, res) => {
  try {
    res.json(await seedDefaultMapAssets(auditContext(req)));
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// --- Publish queue & history ---
mapBuilderRouter.get('/publish-queue', requirePerm('content.map.view'), async (_req, res) => {
  res.json(await listPublishQueue());
});

mapBuilderRouter.get('/publish-history', requirePerm('content.map.view'), async (req, res) => {
  const mapId = typeof req.query.mapId === 'string' ? req.query.mapId : undefined;
  res.json(await listPublishHistory(mapId));
});

mapBuilderRouter.post('/push-live', requirePerm('content.map.publish'), async (req: AdminRequest, res) => {
  try {
    const resnapSpawns = req.body?.resnapSpawns !== false;
    const { pushLiveMapsToAllClients } = await import('../../content/live-map-push.js');
    const result = await pushLiveMapsToAllClients({ resnapSpawns });
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

mapBuilderRouter.post('/sync-canonical', requirePerm('content.map.edit'), async (_req, res) => {
  await ensureCanonicalMapProjects();
  const restored = applyCanonicalWorldMapsToRegistry(contentRegistry);
  res.json({ ok: true, restored });
});

mapBuilderRouter.post('/sync-registry', requirePerm('system.reload'), async (_req, res) => {
  const count = await mergePublishedMapsIntoRegistry();
  res.json({ ok: true, merged: count });
});

// TODO: POST /tilesets/upload — multipart tileset image upload + auto-slice
// TODO: GET /maps/:id/pathfinding-preview — server-side reachability check
// TODO: POST /maps/:id/import-json — import legacy maps.json entry into builder document
