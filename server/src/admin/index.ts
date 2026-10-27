import { Router } from 'express';
import { adminAuthRouter } from './routes/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { playersRouter } from './routes/players.js';
import { contentRouter } from './routes/content.js';
import { mapBuilderRouter } from './routes/map-builder.js';
import { hudBuilderRouter } from './routes/hud-builder.js';
import { wardsRouter, auditRouter } from './routes/wards-audit.js';
import { moderationRouter } from './routes/moderation.js';

/** Admin API v1 — shared by browser dashboard and in-game console */
export const adminApiRouter = Router();

adminApiRouter.use('/auth', adminAuthRouter);
adminApiRouter.use('/dashboard', dashboardRouter);
adminApiRouter.use('/players', playersRouter);
adminApiRouter.use('/content', contentRouter);
adminApiRouter.use('/map-builder', mapBuilderRouter);
adminApiRouter.use('/hud-layouts', hudBuilderRouter);
adminApiRouter.use('/wards', wardsRouter);
adminApiRouter.use('/audit', auditRouter);
adminApiRouter.use('/moderation', moderationRouter);

adminApiRouter.get('/permissions', (_req, res) => {
  import('@witchcraft/shared').then(({ PERMISSIONS, ADMIN_ROLES }) => {
    res.json({ permissions: PERMISSIONS, roles: ADMIN_ROLES });
  });
});
