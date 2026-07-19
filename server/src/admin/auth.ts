import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import type { AdminSession, PermissionSlug } from '@witchcraft/shared';
import { prisma } from '../services/db.js';
import { getAdminPermissions } from './rbac.js';

const JWT_SECRET = process.env.ADMIN_JWT_SECRET ?? 'dev-admin-secret-change-in-production';
const JWT_EXPIRY = '8h';

export async function loginAdmin(
  username: string,
  password: string
): Promise<{ token: string; session: AdminSession } | null> {
  const user = await prisma.adminUser.findUnique({
    where: { username: username.toLowerCase() },
    include: { roles: { include: { role: true } } },
  });

  if (!user?.active) return null;
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return null;

  const permissions = await getAdminPermissions(user.id);
  const roles = user.roles.map((r: { role: { slug: string } }) => r.role.slug);

  await prisma.adminUser.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const session: AdminSession = {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    permissions,
    roles,
  };

  const token = jwt.sign(session, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  return { token, session };
}

export function verifyAdminToken(token: string): AdminSession | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AdminSession;
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}
