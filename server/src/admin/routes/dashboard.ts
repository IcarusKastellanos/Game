import { Router } from 'express';
import { adminAuthMiddleware, requirePerm, auditContext, type AdminRequest } from '../middleware.js';
import { getDashboardStats, getOnlinePlayerCount } from '../services/dashboard.js';

export const dashboardRouter = Router();
dashboardRouter.use(adminAuthMiddleware);

dashboardRouter.get('/', requirePerm('dashboard.view'), async (_req, res) => {
  const stats = await getDashboardStats();
  stats.players.online = getOnlinePlayerCount();
  res.json(stats);
});

dashboardRouter.get('/health', requirePerm('dashboard.view'), (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});
