import { Router } from 'express';
import { z } from 'zod';
import { loginAdmin } from '../auth.js';
import { adminAuthMiddleware, type AdminRequest } from '../middleware.js';
import { getAdminPermissions } from '../rbac.js';

export const adminAuthRouter = Router();

adminAuthRouter.post('/login', async (req, res) => {
  const schema = z.object({ username: z.string(), password: z.string() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid credentials format' });

  const result = await loginAdmin(parsed.data.username, parsed.data.password);
  if (!result) return res.status(401).json({ error: 'Invalid username or password' });

  res.json(result);
});

adminAuthRouter.get('/me', adminAuthMiddleware, async (req: AdminRequest, res) => {
  if (!req.admin) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const permissions = await getAdminPermissions(req.admin.userId);
  res.json({
    session: {
      ...req.admin,
      permissions,
    },
  });
});

adminAuthRouter.post('/logout', adminAuthMiddleware, (_req, res) => {
  res.json({ ok: true });
});
