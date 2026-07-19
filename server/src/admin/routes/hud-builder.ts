import { Router } from 'express';
import { adminAuthMiddleware, requirePerm, auditContext, type AdminRequest } from '../middleware.js';
import { param } from '../util.js';
import type { HudLayoutDocument } from '@witchcraft/shared';
import {
  archiveHudLayout,
  createHudLayout,
  deleteHudLayout,
  duplicateHudLayout,
  getHudLayout,
  importHudLayout,
  listHudAssets,
  listHudLayouts,
  listHudVersions,
  publishHudLayout,
  renameHudLayout,
  restoreHudLayout,
  restoreHudVersion,
  saveHudDraft,
  validateHudLayoutDoc,
} from '../services/hud-builder/index.js';

export const hudBuilderRouter = Router();
hudBuilderRouter.use(adminAuthMiddleware);

function adminUser(req: AdminRequest): string {
  return req.admin?.username ?? 'admin';
}

hudBuilderRouter.get('/', requirePerm('content.hud.view'), async (req, res) => {
  const includeArchived = req.query.archived === '1';
  res.json(await listHudLayouts(includeArchived));
});

hudBuilderRouter.get('/assets', requirePerm('content.hud.view'), (_req, res) => {
  res.json(listHudAssets());
});

hudBuilderRouter.get('/:id', requirePerm('content.hud.view'), async (req, res) => {
  const record = await getHudLayout(param(req, 'id'));
  if (!record) return res.status(404).json({ error: 'Not found' });
  res.json(record);
});

hudBuilderRouter.post('/', requirePerm('content.hud.edit'), async (req: AdminRequest, res) => {
  try {
    const { name, document } = req.body as { name?: string; document?: HudLayoutDocument };
    const record = await createHudLayout({ name, document }, adminUser(req), auditContext(req));
    res.status(201).json(record);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

hudBuilderRouter.put('/:id', requirePerm('content.hud.edit'), async (req: AdminRequest, res) => {
  const { document, changelog } = req.body as { document: HudLayoutDocument; changelog?: string };
  if (!document) return res.status(400).json({ error: 'document required' });
  try {
    const saved = await saveHudDraft(param(req, 'id'), document, adminUser(req), auditContext(req), changelog);
    if (!saved) return res.status(404).json({ error: 'Not found' });
    res.json(saved);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

hudBuilderRouter.patch('/:id/rename', requirePerm('content.hud.edit'), async (req: AdminRequest, res) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const meta = await renameHudLayout(param(req, 'id'), name.trim(), adminUser(req), auditContext(req));
  if (!meta) return res.status(404).json({ error: 'Not found' });
  res.json(meta);
});

hudBuilderRouter.delete('/:id', requirePerm('content.hud.edit'), async (req: AdminRequest, res) => {
  try {
    const ok = await deleteHudLayout(param(req, 'id'), auditContext(req));
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

hudBuilderRouter.post('/:id/duplicate', requirePerm('content.hud.edit'), async (req: AdminRequest, res) => {
  const dup = await duplicateHudLayout(param(req, 'id'), adminUser(req), auditContext(req));
  if (!dup) return res.status(404).json({ error: 'Not found' });
  res.status(201).json(dup);
});

hudBuilderRouter.post('/:id/archive', requirePerm('content.hud.edit'), async (req: AdminRequest, res) => {
  const meta = await archiveHudLayout(param(req, 'id'), adminUser(req), auditContext(req));
  if (!meta) return res.status(404).json({ error: 'Not found' });
  res.json(meta);
});

hudBuilderRouter.post('/:id/restore', requirePerm('content.hud.edit'), async (req: AdminRequest, res) => {
  const meta = await restoreHudLayout(param(req, 'id'), adminUser(req), auditContext(req));
  if (!meta) return res.status(404).json({ error: 'Not found' });
  res.json(meta);
});

hudBuilderRouter.post('/:id/validate', requirePerm('content.hud.view'), async (req, res) => {
  const record = await getHudLayout(param(req, 'id'));
  if (!record) return res.status(404).json({ error: 'Not found' });
  res.json(validateHudLayoutDoc(record.document, req.query.strict === '1'));
});

hudBuilderRouter.post('/:id/publish', requirePerm('content.hud.publish'), async (req: AdminRequest, res) => {
  const result = await publishHudLayout(param(req, 'id'), adminUser(req), auditContext(req), req.body?.changelog);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

hudBuilderRouter.get('/:id/versions', requirePerm('content.hud.view'), async (req, res) => {
  res.json(await listHudVersions(param(req, 'id')));
});

hudBuilderRouter.post('/:id/restore/:versionId', requirePerm('content.hud.edit'), async (req: AdminRequest, res) => {
  const saved = await restoreHudVersion(param(req, 'id'), param(req, 'versionId'), adminUser(req), auditContext(req));
  if (!saved) return res.status(404).json({ error: 'Not found' });
  res.json(saved);
});

hudBuilderRouter.get('/:id/export', requirePerm('content.hud.view'), async (req, res) => {
  const record = await getHudLayout(param(req, 'id'));
  if (!record) return res.status(404).json({ error: 'Not found' });
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${record.document.layoutId}.hud.json"`);
  res.send(JSON.stringify(record.document, null, 2));
});

hudBuilderRouter.post('/import', requirePerm('content.hud.edit'), async (req: AdminRequest, res) => {
  const { document, replaceId } = req.body as { document: HudLayoutDocument; replaceId?: string };
  if (!document) return res.status(400).json({ error: 'document required' });
  const result = await importHudLayout(document, adminUser(req), auditContext(req), { replaceId });
  if (!result.ok) return res.status(400).json(result);
  res.status(201).json(result);
});
