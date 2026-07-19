import { Router } from 'express';
import { prisma } from '../../services/db.js';
import { adminAuthMiddleware, requirePerm, auditContext, type AdminRequest } from '../middleware.js';
import { writeAuditLog, searchAuditLogs } from '../audit.js';
import { param } from '../util.js';
import { adminShatterWard } from '../services/ward-shatter.js';

export const wardsRouter = Router();
wardsRouter.use(adminAuthMiddleware);

wardsRouter.get('/', requirePerm('ward.view'), async (req, res) => {
  const { ownerId, active = 'true' } = req.query;
  const wards = await prisma.ward.findMany({
    where: {
      ...(active === 'true' ? { active: true } : {}),
      ...(ownerId ? { creatorId: String(ownerId) } : {}),
    },
    include: { creator: { select: { username: true, displayName: true } } },
    orderBy: { strength: 'desc' },
    take: 100,
  });
  res.json(wards);
});

wardsRouter.delete('/:id', requirePerm('ward.edit'), async (req: AdminRequest, res) => {
  const id = param(req, 'id');
  const before = await prisma.ward.findUnique({ where: { id } });
  const adminName = req.admin?.displayName ?? req.admin?.username ?? 'Admin';
  const reason = (req.body as { reason?: string })?.reason ?? 'Admin shatter';
  const result = await adminShatterWard(id, adminName, reason);
  await writeAuditLog(auditContext(req), {
    action: 'ward.shatter',
    objectType: 'ward',
    objectId: id,
    previousValue: before,
    reason,
    newValue: { ...result, live: result.live },
  });
  res.json(result);
});

export const auditRouter = Router();
auditRouter.use(adminAuthMiddleware);

auditRouter.get('/', requirePerm('audit.view'), async (req, res) => {
  const logs = await searchAuditLogs({
    action: req.query.action as string,
    objectType: req.query.objectType as string,
    limit: Number(req.query.limit ?? 50),
    offset: Number(req.query.offset ?? 0),
  });
  res.json(logs);
});
