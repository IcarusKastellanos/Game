import type { AuditLogEntry } from '@witchcraft/shared';
import { prisma } from '../services/db.js';

export interface AuditContext {
  adminUserId: string;
  ipAddress?: string;
  userAgent?: string;
}

/** Append-only audit log — every admin mutation should call this */
export async function writeAuditLog(
  ctx: AuditContext,
  entry: AuditLogEntry
): Promise<void> {
  try {
    await prisma.adminAuditLog.create({
      data: {
        adminUserId: ctx.adminUserId,
        action: entry.action,
        objectType: entry.objectType,
        objectId: entry.objectId,
        previousValue: entry.previousValue ?? undefined,
        newValue: entry.newValue ?? undefined,
        reason: entry.reason,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  } catch (err) {
    console.error('[Audit] Failed to write log:', err);
  }
}

export async function searchAuditLogs(params: {
  action?: string;
  objectType?: string;
  adminUserId?: string;
  limit?: number;
  offset?: number;
}) {
  const { action, objectType, adminUserId, limit = 50, offset = 0 } = params;
  return prisma.adminAuditLog.findMany({
    where: {
      ...(action ? { action: { contains: action } } : {}),
      ...(objectType ? { objectType } : {}),
      ...(adminUserId ? { adminUserId } : {}),
    },
    include: { adminUser: { select: { username: true, displayName: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });
}
