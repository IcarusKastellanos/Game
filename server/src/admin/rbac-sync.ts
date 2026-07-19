import { ADMIN_ROLES, PERMISSIONS } from '@witchcraft/shared';
import { prisma } from '../services/db.js';

/** Keep DB permissions/roles aligned with shared catalog (safe to run on every startup). */
export async function syncAdminRbacFromCatalog(): Promise<void> {
  for (const [slug, description] of Object.entries(PERMISSIONS)) {
    const category = slug.split('.')[0];
    await prisma.adminPermission.upsert({
      where: { slug },
      create: { slug, name: slug.replace(/\./g, ' '), category, description },
      update: { description, category },
    });
  }

  for (const [slug, roleDef] of Object.entries(ADMIN_ROLES)) {
    const role = await prisma.adminRole.upsert({
      where: { slug },
      create: {
        slug,
        name: roleDef.name,
        description: roleDef.description,
        system: true,
      },
      update: { name: roleDef.name, description: roleDef.description },
    });

    await prisma.adminRolePermission.deleteMany({ where: { roleId: role.id } });

    for (const permSlug of roleDef.permissions) {
      const perm = await prisma.adminPermission.findUnique({ where: { slug: permSlug } });
      if (perm) {
        await prisma.adminRolePermission.create({
          data: { roleId: role.id, permissionId: perm.id },
        });
      }
    }
  }

  const admin = await prisma.adminUser.findUnique({ where: { username: 'admin' } });
  const superRole = await prisma.adminRole.findUnique({ where: { slug: 'super_admin' } });
  if (admin && superRole) {
    await prisma.adminUserRole.upsert({
      where: { userId_roleId: { userId: admin.id, roleId: superRole.id } },
      create: { userId: admin.id, roleId: superRole.id },
      update: {},
    });
  }
}
