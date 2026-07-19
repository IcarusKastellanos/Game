import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { prisma } from '../services/db.js';
import { hashPassword } from '../admin/auth.js';
import { syncAdminRbacFromCatalog } from '../admin/rbac-sync.js';

/** Seed RBAC roles, permissions, and default super admin */
export async function seedAdminFramework(): Promise<void> {
  console.log('[seed-admin] Seeding permissions and roles...');
  await syncAdminRbacFromCatalog();

  const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD ?? 'admin123';
  const hash = await hashPassword(defaultPassword);

  const admin = await prisma.adminUser.upsert({
    where: { username: 'admin' },
    create: {
      username: 'admin',
      email: 'admin@witchcraft.local',
      passwordHash: hash,
      displayName: 'Super Admin',
      gameUsername: 'admin',
    },
    update: {},
  });

  const superRole = await prisma.adminRole.findUnique({ where: { slug: 'super_admin' } });
  if (superRole) {
    await prisma.adminUserRole.upsert({
      where: { userId_roleId: { userId: admin.id, roleId: superRole.id } },
      create: { userId: admin.id, roleId: superRole.id },
      update: {},
    });
  }

  console.log('[seed-admin] Default admin: username=admin password=' + defaultPassword);
}

const isDirectRun =
  process.argv[1] != null &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isDirectRun) {
  seedAdminFramework()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
}
