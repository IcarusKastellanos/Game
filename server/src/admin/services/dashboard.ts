import { prisma } from '../../services/db.js';
import os from 'node:os';

export async function getDashboardStats() {
  const [playerCount, spellCount, wardCount, recentAudit, onlineEstimate] = await Promise.all([
    prisma.player.count(),
    prisma.contentSpell.count(),
    prisma.ward.count({ where: { active: true } }),
    prisma.adminAuditLog.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: { adminUser: { select: { username: true } } },
    }),
    Promise.resolve(0), // filled by room registry
  ]);

  const mem = process.memoryUsage();
  return {
    players: { total: playerCount, online: onlineEstimate },
    content: { spells: spellCount, activeWards: wardCount },
    server: {
      uptime: process.uptime(),
      memoryMb: Math.round(mem.heapUsed / 1024 / 1024),
      cpuCount: os.cpus().length,
      nodeVersion: process.version,
    },
    database: { status: 'connected' },
    recentAudit,
    activeEvents: await prisma.contentEvent.count({ where: { active: true } }),
  };
}

export function setOnlinePlayerCount(count: number): void {
  onlineCache = count;
}

let onlineCache = 0;

export function getOnlinePlayerCount(): number {
  return onlineCache;
}
