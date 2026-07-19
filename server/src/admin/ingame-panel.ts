import type { Client } from '@colyseus/core';
import type { PermissionSlug, AdminCommandResult } from '@witchcraft/shared';
import type { GameRoom } from '../rooms/GameRoom.js';
import { executeCommand } from './commands/registry.js';
import type { AuditContext } from './audit.js';

export interface AdminPanelRequest {
  action: string;
  targetSessionId?: string;
  args?: string[];
}

export async function handleIngameAdminPanel(
  room: GameRoom,
  client: Client,
  admin: { userId: string; permissions: PermissionSlug[] },
  req: AdminPanelRequest
): Promise<AdminCommandResult> {
  const action = req.action.toLowerCase();
  const args = req.args ?? [];
  const audit: AuditContext = { adminUserId: admin.userId };

  if (action === 'list_players') {
    return {
      success: true,
      message: 'Online players',
      data: { players: room.getAdminPlayerList(client.sessionId) },
    };
  }

  if (action === 'vanish') {
    if (!admin.permissions.includes('player.teleport')) {
      return { success: false, message: 'Missing permission for vanish.' };
    }
    const on = room.toggleVanish(client.sessionId);
    return {
      success: true,
      message: on ? 'Vanish ON — you are hidden from others.' : 'Vanish OFF — you are visible again.',
      data: { vanished: on },
    };
  }

  if (action === 'goto') {
    if (!admin.permissions.includes('player.teleport')) {
      return { success: false, message: 'Missing permission for goto.' };
    }
    const targetId = req.targetSessionId;
    if (!targetId) return { success: false, message: 'Select a player first.' };
    const ok = room.adminGotoPlayer(client.sessionId, targetId);
    return ok
      ? { success: true, message: 'Teleported to player (apartment visit if at home).' }
      : { success: false, message: 'Could not reach that player.' };
  }

  if (action === 'summon') {
    if (!admin.permissions.includes('player.teleport')) {
      return { success: false, message: 'Missing permission for summon.' };
    }
    const targetId = req.targetSessionId;
    if (!targetId) return { success: false, message: 'Select a player first.' };
    const ok = room.adminSummonPlayer(client.sessionId, targetId);
    return ok
      ? { success: true, message: 'Player summoned to your location.' }
      : { success: false, message: 'Could not summon that player.' };
  }

  if (action === 'kick') {
    if (!admin.permissions.includes('player.moderate')) {
      return { success: false, message: 'Missing permission for kick.' };
    }
    const targetId = req.targetSessionId;
    if (!targetId) return { success: false, message: 'Select a player first.' };
    const reason = args.join(' ') || 'Removed by admin';
    room.adminKickPlayer(targetId, reason);
    return { success: true, message: `Kicked player (${reason}).` };
  }

  const targetSessionId = req.targetSessionId ?? client.sessionId;
  const commandMap: Record<string, string> = {
    heal: 'heal',
    give: 'give',
    setstat: 'setstat',
    tp: 'tp',
    ban: 'ban',
    inspect: 'inspect',
    reloadcontent: 'reloadcontent',
    event: 'event',
    help: 'help',
    logs: 'logs',
  };

  const cmdName = commandMap[action];
  if (!cmdName) return { success: false, message: `Unknown action: ${action}` };

  const result = await executeCommand(cmdName, args, {
    adminUserId: admin.userId,
    permissions: admin.permissions,
    audit,
    targetSessionId,
    room: room.getAdminCommandRoom(),
  });

  if (result.success) {
    room.applyAdminCommandEffects(cmdName, args, client.sessionId, targetSessionId, result);
  }

  return result;
}
