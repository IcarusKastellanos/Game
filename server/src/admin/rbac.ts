import type { PermissionSlug } from '@witchcraft/shared';
import { PERMISSIONS } from '@witchcraft/shared';
import { prisma } from '../services/db.js';

/** Resolve effective permissions for an admin user */
export async function getAdminPermissions(userId: string): Promise<PermissionSlug[]> {
  const user = await prisma.adminUser.findUnique({
    where: { id: userId },
    include: {
      roles: {
        include: {
          role: {
            include: {
              permissions: { include: { permission: true } },
            },
          },
        },
      },
    },
  });

  if (!user?.active) return [];

  const set = new Set<PermissionSlug>();
  let isSuperAdmin = false;
  for (const ur of user.roles) {
    if (ur.role.slug === 'super_admin') isSuperAdmin = true;
    for (const rp of ur.role.permissions) {
      set.add(rp.permission.slug as PermissionSlug);
    }
  }

  if (isSuperAdmin) {
    for (const slug of Object.keys(PERMISSIONS) as PermissionSlug[]) {
      set.add(slug);
    }
  }

  return [...set];
}

export async function hasPermission(userId: string, permission: PermissionSlug): Promise<boolean> {
  const perms = await getAdminPermissions(userId);
  return perms.includes(permission);
}

export async function requirePermission(userId: string, permission: PermissionSlug): Promise<void> {
  const ok = await hasPermission(userId, permission);
  if (!ok) throw new AdminAuthError(`Missing permission: ${permission}`, 403);
}

export class AdminAuthError extends Error {
  constructor(
    message: string,
    public statusCode: number = 401
  ) {
    super(message);
  }
}

/** Check if a game username has in-game admin access */
export async function getIngameAdminByGameUsername(gameUsername: string): Promise<{
  userId: string;
  permissions: PermissionSlug[];
} | null> {
  const user = await prisma.adminUser.findFirst({
    where: {
      active: true,
      OR: [{ gameUsername: gameUsername.toLowerCase() }, { username: gameUsername.toLowerCase() }],
    },
  });
  if (!user) return null;
  const permissions = await getAdminPermissions(user.id);
  if (!permissions.includes('system.ingame' as PermissionSlug)) return null;
  return { userId: user.id, permissions };
}
