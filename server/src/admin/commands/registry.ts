import type { PermissionSlug, AdminCommandResult } from '@witchcraft/shared';
import { contentRegistry } from '../../content/registry.js';
import { mergeIngredientIconsFromDb } from '../../content/ingredient-icons.js';
import { mergeNpcSpritesFromDb } from '../../content/npc-sprites.js';
import { inventorySystem } from '../../systems/inventory-ward-aura.js';
import { prisma } from '../../services/db.js';
import { writeAuditLog, type AuditContext } from '../audit.js';

export interface CommandContext {
  adminUserId: string;
  permissions: PermissionSlug[];
  audit: AuditContext;
  /** Target player session in room */
  targetSessionId?: string;
  room?: { sendToSession: (sid: string, type: string, data: unknown) => void; getPlayer: (sid: string) => PlayerSnap | undefined };
}

interface PlayerSnap {
  sessionId: string;
  displayName: string;
  x: number;
  y: number;
  statsJson: string;
  inventoryJson: string;
}

type CommandHandler = (ctx: CommandContext, args: string[]) => Promise<AdminCommandResult>;

const COMMANDS: Record<string, { permission: PermissionSlug; description: string; handler: CommandHandler }> = {
  help: {
    permission: 'system.ingame',
    description: 'List available commands',
    handler: async (ctx) => ({
      success: true,
      message: Object.entries(COMMANDS)
        .filter(([_, c]) => ctx.permissions.includes(c.permission))
        .map(([name, c]) => `/${name} — ${c.description}`)
        .join('\n'),
    }),
  },
  tp: {
    permission: 'player.teleport',
    description: 'Teleport: /tp <x> <y>',
    handler: async (ctx, args) => {
      const x = Number(args[0]);
      const y = Number(args[1]);
      if (!ctx.targetSessionId || !ctx.room) return { success: false, message: 'No target' };
      ctx.room.sendToSession(ctx.targetSessionId, 'admin_tp', { x, y });
      return { success: true, message: `Teleported to (${x}, ${y})` };
    },
  },
  give: {
    permission: 'player.edit',
    description: 'Give item: /give <itemId> [qty]',
    handler: async (ctx, args) => {
      const itemId = args[0];
      const qty = Number(args[1] ?? 1);
      if (!itemId || !ctx.room || !ctx.targetSessionId) return { success: false, message: 'Usage: /give <itemId> [qty]' };
      const p = ctx.room.getPlayer(ctx.targetSessionId);
      if (!p) return { success: false, message: 'Player not found' };
      const inv = JSON.parse(p.inventoryJson);
      const updated = inventorySystem.addItem(inv, itemId, qty);
      const pSchema = ctx.room.getPlayer(ctx.targetSessionId);
      if (pSchema) {
        ctx.room.sendToSession(ctx.targetSessionId, 'admin_inventory', { inventory: updated });
      }
      await writeAuditLog(ctx.audit, { action: 'ingame.give', objectType: 'player', objectId: ctx.targetSessionId, newValue: { itemId, qty } });
      return { success: true, message: `Gave ${qty}x ${itemId}`, data: { inventory: updated } };
    },
  },
  heal: {
    permission: 'player.heal',
    description: 'Restore health, hunger, ME',
    handler: async (ctx) => {
      if (!ctx.room || !ctx.targetSessionId) return { success: false, message: 'No target' };
      ctx.room.sendToSession(ctx.targetSessionId, 'admin_heal', {});
      return { success: true, message: 'Healed.' };
    },
  },
  setstat: {
    permission: 'player.edit',
    description: 'Set stat: /setstat <name> <value>',
    handler: async (ctx, args) => {
      const [stat, val] = args;
      if (!stat || !ctx.room || !ctx.targetSessionId) return { success: false, message: 'Usage: /setstat <name> <value>' };
      ctx.room.sendToSession(ctx.targetSessionId, 'admin_setstat', { stat, value: Number(val) });
      return { success: true, message: `Set ${stat} = ${val}` };
    },
  },
  reloadcontent: {
    permission: 'system.reload',
    description: 'Reload JSON content registries and push published maps to online players',
    handler: async (ctx) => {
      contentRegistry.load();
      await mergeIngredientIconsFromDb();
      await mergeNpcSpritesFromDb();
      const { pushLiveMapsToAllClients } = await import('../../content/live-map-push.js');
      const push = await pushLiveMapsToAllClients({ resnapSpawns: true });
      await writeAuditLog(ctx.audit, { action: 'ingame.reload', objectType: 'system', objectId: 'content' });
      const warn = push.warnings.length ? ` Warnings: ${push.warnings.join(' ')}` : '';
      return {
        success: true,
        message: `Content reloaded; ${push.clientsNotified} client(s) updated (map revision ${push.revision}).${warn}`,
      };
    },
  },
  inspect: {
    permission: 'player.view',
    description: 'Inspect self stats and aura',
    handler: async (ctx) => {
      if (!ctx.room || !ctx.targetSessionId) return { success: false, message: 'No target' };
      const p = ctx.room.getPlayer(ctx.targetSessionId);
      if (!p) return { success: false, message: 'Not found' };
      return { success: true, message: 'Player data', data: { stats: JSON.parse(p.statsJson), displayName: p.displayName } };
    },
  },
  ban: {
    permission: 'player.moderate',
    description: 'Ban player: /ban <playerId> <reason>',
    handler: async (ctx, args) => {
      const [playerId, ...reasonParts] = args;
      if (!playerId) return { success: false, message: 'Usage: /ban <playerId> <reason>' };
      await prisma.playerModeration.create({
        data: { playerId, type: 'ban', reason: reasonParts.join(' ') || 'No reason', adminId: ctx.adminUserId, active: true },
      });
      await writeAuditLog(ctx.audit, { action: 'ingame.ban', objectType: 'player', objectId: playerId, reason: reasonParts.join(' ') });
      return { success: true, message: `Banned ${playerId}` };
    },
  },
  event: {
    permission: 'content.event.edit',
    description: 'Toggle event: /event <slug> on|off',
    handler: async (ctx, args) => {
      const [slug, state] = args;
      const active = state === 'on';
      await prisma.contentEvent.updateMany({ where: { slug }, data: { active } });
      return { success: true, message: `Event ${slug} ${active ? 'activated' : 'deactivated'}` };
    },
  },
  logs: {
    permission: 'audit.view',
    description: 'Show recent audit entries',
    handler: async (ctx) => {
      const logs = await prisma.adminAuditLog.findMany({
        where: { adminUserId: ctx.adminUserId },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
      return { success: true, message: logs.map((l: { action: string; createdAt: Date }) => `${l.action} @ ${l.createdAt.toISOString()}`).join('\n') || 'No logs' };
    },
  },
};

export function listCommands(permissions: PermissionSlug[]): string[] {
  return Object.keys(COMMANDS).filter((k) => permissions.includes(COMMANDS[k].permission));
}

export async function executeCommand(
  name: string,
  args: string[],
  ctx: CommandContext
): Promise<AdminCommandResult> {
  const cmd = COMMANDS[name.toLowerCase()];
  if (!cmd) return { success: false, message: `Unknown command: /${name}. Try /help` };
  if (!ctx.permissions.includes(cmd.permission)) {
    return { success: false, message: `Missing permission for /${name}` };
  }
  return cmd.handler(ctx, args);
}

export { COMMANDS };
