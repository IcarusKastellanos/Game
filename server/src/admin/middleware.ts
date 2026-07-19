import type { NextFunction, Request, Response } from 'express';
import type { PermissionSlug, AdminSession } from '@witchcraft/shared';
import { verifyAdminToken } from './auth.js';
import { getAdminPermissions, AdminAuthError } from './rbac.js';

export interface AdminRequest extends Request {
  admin?: AdminSession;
}

export function adminAuthMiddleware(req: AdminRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : req.cookies?.admin_token;
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const session = verifyAdminToken(token);
  if (!session) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
  req.admin = session;
  next();
}

export function requirePerm(permission: PermissionSlug) {
  return async (req: AdminRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.admin) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const perms = await getAdminPermissions(req.admin.userId);
    if (!perms.includes(permission)) {
      res.status(403).json({ error: `Missing permission: ${permission}` });
      return;
    }
    req.admin.permissions = perms;
    next();
  };
}

export function auditContext(req: AdminRequest) {
  return {
    adminUserId: req.admin!.userId,
    ipAddress: req.ip ?? req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
  };
}

export function adminErrorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AdminAuthError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  console.error('[Admin]', err);
  res.status(500).json({ error: 'Internal server error' });
}
