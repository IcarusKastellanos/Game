import { prisma } from '../../services/db.js';
import { writeAuditLog, type AuditContext } from '../audit.js';
import {
  magicalEnergyCap,
  migrateInventoryToGrid,
  loadInventoryFromDbRows,
  applySlotIndicesForSave,
  addItemToInventory,
  totalItemQuantity,
  isEmptyInventorySlot,
  INVENTORY_MAX_SLOTS,
  parseProgression,
  EXTENDED_STAT_KEYS,
  type InventorySlot,
  type PlayerProgression,
} from '@witchcraft/shared';
import { formatDisplayName, normalizeUsername, validateDisplayName, validateUsername } from '@witchcraft/shared';
import { syncOnlinePlayerByDbId } from '../../rooms/game-room-registry.js';
import { Prisma } from '@prisma/client';

type DbInventoryRow = {
  itemId: string;
  quantity: number;
  metadata?: Record<string, unknown> | null;
};

export function inventoryRowsToGrid(rows: DbInventoryRow[]): InventorySlot[] {
  return migrateInventoryToGrid(
    loadInventoryFromDbRows(
      rows.map((row) => ({
        itemId: row.itemId,
        quantity: row.quantity,
        metadata: row.metadata ?? undefined,
      }))
    )
  );
}

export function getAdminInventorySlots(rows: DbInventoryRow[]) {
  return inventoryRowsToGrid(rows)
    .map((slot, slotIndex) => ({
      slotIndex,
      itemId: slot.itemId,
      quantity: slot.quantity,
      metadata: slot.metadata,
    }))
    .filter((slot) => !isEmptyInventorySlot(slot));
}

async function persistInventoryGrid(playerId: string, grid: InventorySlot[]): Promise<void> {
  await prisma.inventoryItem.deleteMany({ where: { playerId } });
  const slotsToSave = applySlotIndicesForSave(grid).filter((slot) => slot.itemId && slot.quantity > 0);
  if (!slotsToSave.length) return;

  await prisma.inventoryItem.createMany({
    data: slotsToSave.map((slot) => ({
      playerId,
      itemId: slot.itemId,
      quantity: slot.quantity,
      metadata: (slot.metadata as Prisma.InputJsonValue) ?? undefined,
    })),
  });
}

export async function searchPlayers(query: {
  username?: string;
  displayName?: string;
  limit?: number;
}) {
  const { username, displayName, limit = 25 } = query;
  return prisma.player.findMany({
    where: {
      ...(username ? { username: { contains: username, mode: 'insensitive' } } : {}),
      ...(displayName ? { displayName: { contains: displayName, mode: 'insensitive' } } : {}),
    },
    include: {
      stats: true,
      familiar: { select: { publicName: true, species: true, trueName: true } },
      aura: true,
      _count: { select: { spellHistory: true, inventory: true } },
    },
    take: limit,
    orderBy: { updatedAt: 'desc' },
  });
}

export async function getPlayerDetail(playerId: string) {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: {
      stats: true,
      inventory: true,
      apartment: true,
      familiar: true,
      aura: true,
      wards: { where: { active: true } },
      spellHistory: { orderBy: { createdAt: 'desc' }, take: 50 },
    },
  });
  if (!player?.stats) return player;
  const extended =
    player.stats.extendedStats && typeof player.stats.extendedStats === 'object'
      ? (player.stats.extendedStats as Record<string, unknown>)
      : {};
  return {
    ...player,
    stats: { ...player.stats, ...extended },
  };
}

export async function updatePlayerStats(
  ctx: AuditContext,
  playerId: string,
  updates: Record<string, number>,
  reason?: string
) {
  const before = await prisma.playerStats.findUnique({ where: { playerId } });

  // Extended attributes live in the extendedStats JSON column, not as columns.
  const EXTENDED_KEYS = new Set<string>([...EXTENDED_STAT_KEYS, 'publicReputation', 'spiritualReputation']);
  const columnUpdates: Record<string, number> = {};
  const extendedUpdates: Record<string, number> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (EXTENDED_KEYS.has(key)) extendedUpdates[key] = value;
    else columnUpdates[key] = value;
  }

  // Keep legacy reputation column synchronized with publicReputation edits.
  if (extendedUpdates.publicReputation != null) {
    columnUpdates.reputation = extendedUpdates.publicReputation;
  } else if (columnUpdates.reputation != null) {
    extendedUpdates.publicReputation = columnUpdates.reputation;
  }

  const data: Record<string, unknown> = { ...columnUpdates };
  if (Object.keys(extendedUpdates).length) {
    const existing =
      before && typeof (before as { extendedStats?: unknown }).extendedStats === 'object'
        ? ((before as { extendedStats?: Record<string, unknown> }).extendedStats ?? {})
        : {};
    data.extendedStats = { ...existing, ...extendedUpdates };
  }

  const after = await prisma.playerStats.update({
    where: { playerId },
    data,
  });

  if (Number.isFinite(updates.morality)) {
    const score = Math.max(-100, Math.min(100, updates.morality));
    let alignment: 'neutral' | 'benevolent' | 'malevolent' = 'neutral';
    if (score > 20) alignment = 'benevolent';
    if (score < -20) alignment = 'malevolent';
    await prisma.aura.updateMany({
      where: { playerId },
      data: { moralityScore: score, alignment },
    });
  }

  await writeAuditLog(ctx, {
    action: 'player.stats.update',
    objectType: 'player',
    objectId: playerId,
    previousValue: before,
    newValue: after,
    reason,
  });
  await syncOnlinePlayerByDbId(playerId);
  return after;
}

export async function giveItem(
  ctx: AuditContext,
  playerId: string,
  itemId: string,
  quantity: number,
  reason?: string
) {
  const trimmedItemId = itemId?.trim();
  const qty = Math.floor(Number(quantity));
  if (!trimmedItemId || !Number.isFinite(qty) || qty <= 0) {
    throw new Error('Invalid item or quantity');
  }

  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: { inventory: true },
  });
  if (!player) throw new Error('Player not found');

  const grid = inventoryRowsToGrid(
    player.inventory.map((row) => ({
      itemId: row.itemId,
      quantity: row.quantity,
      metadata: (row.metadata as Record<string, unknown>) ?? null,
    }))
  );

  const beforeQty = totalItemQuantity(grid, trimmedItemId);
  const updated = addItemToInventory(grid, trimmedItemId, qty);
  const added = totalItemQuantity(updated, trimmedItemId) - beforeQty;

  if (added <= 0) throw new Error('Inventory full');

  await persistInventoryGrid(playerId, updated);

  await writeAuditLog(ctx, {
    action: 'player.inventory.give',
    objectType: 'player',
    objectId: playerId,
    newValue: { itemId: trimmedItemId, requested: qty, added },
    reason,
  });

  await syncOnlinePlayerByDbId(playerId);
  return { ok: true, itemId: trimmedItemId, requested: qty, added };
}

export async function removeInventorySlot(
  ctx: AuditContext,
  playerId: string,
  slotIndex: number,
  itemId?: string,
  reason?: string
) {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: { inventory: true },
  });
  if (!player) throw new Error('Player not found');

  const grid = inventoryRowsToGrid(
    player.inventory.map((row) => ({
      itemId: row.itemId,
      quantity: row.quantity,
      metadata: (row.metadata as Record<string, unknown>) ?? null,
    }))
  );

  if (slotIndex < 0 || slotIndex >= INVENTORY_MAX_SLOTS) {
    throw new Error('Invalid inventory slot');
  }

  const slot = grid[slotIndex];
  if (isEmptyInventorySlot(slot) || (itemId && slot.itemId !== itemId)) {
    throw new Error('Inventory item not found');
  }

  const removed = { slotIndex, itemId: slot.itemId, quantity: slot.quantity, metadata: slot.metadata };
  grid[slotIndex] = { itemId: '', quantity: 0 };

  await persistInventoryGrid(playerId, grid);

  await writeAuditLog(ctx, {
    action: 'player.inventory.remove',
    objectType: 'player',
    objectId: playerId,
    previousValue: removed,
    reason,
  });

  await syncOnlinePlayerByDbId(playerId);
  return { ok: true };
}

export async function moderatePlayer(
  ctx: AuditContext,
  playerId: string,
  type: string,
  reason: string,
  expiresAt?: Date
) {
  const mod = await prisma.playerModeration.create({
    data: { playerId, type, reason, adminId: ctx.adminUserId, expiresAt, active: true },
  });
  await writeAuditLog(ctx, {
    action: `player.moderate.${type}`,
    objectType: 'player',
    objectId: playerId,
    newValue: mod,
    reason,
  });
  return mod;
}

export async function healPlayer(ctx: AuditContext, playerId: string, reason?: string) {
  const stats = await prisma.playerStats.findUnique({ where: { playerId } });
  const meCap = magicalEnergyCap(stats?.experience ?? 0);
  return updatePlayerStats(ctx, playerId, { health: 100, hunger: 100, magicalEnergy: meCap }, reason);
}

export async function modifyAura(
  ctx: AuditContext,
  playerId: string,
  effects: unknown,
  reason?: string
) {
  const before = await prisma.aura.findUnique({ where: { playerId } });
  const after = await prisma.aura.update({
    where: { playerId },
    data: { effects: effects as object },
  });
  await writeAuditLog(ctx, {
    action: 'player.aura.update',
    objectType: 'player',
    objectId: playerId,
    previousValue: before,
    newValue: after,
    reason,
  });
  return after;
}

export async function updatePlayerProfile(
  ctx: AuditContext,
  playerId: string,
  data: { username?: string; displayName?: string },
  reason?: string
) {
  const before = await prisma.player.findUnique({ where: { id: playerId } });
  if (!before) throw new Error('Player not found');

  const updates: { username?: string; displayName?: string } = {};
  if (data.username !== undefined) {
    const user = normalizeUsername(data.username);
    const err = validateUsername(user);
    if (err) throw new Error(err);
    const taken = await prisma.player.findFirst({ where: { username: user, NOT: { id: playerId } } });
    if (taken) throw new Error('Username already taken.');
    updates.username = user;
  }
  if (data.displayName !== undefined) {
    const name = formatDisplayName(data.displayName);
    const err = validateDisplayName(name);
    if (err) throw new Error(err);
    updates.displayName = name;
  }

  const after = await prisma.player.update({ where: { id: playerId }, data: updates });
  await writeAuditLog(ctx, {
    action: 'player.profile.update',
    objectType: 'player',
    objectId: playerId,
    previousValue: before,
    newValue: after,
    reason,
  });
  return after;
}

export async function deletePlayer(ctx: AuditContext, playerId: string, reason?: string) {
  const before = await prisma.player.findUnique({ where: { id: playerId } });
  if (!before) throw new Error('Player not found');
  await prisma.player.delete({ where: { id: playerId } });
  await writeAuditLog(ctx, {
    action: 'player.delete',
    objectType: 'player',
    objectId: playerId,
    previousValue: before,
    reason,
  });
  return { ok: true };
}

export async function getPlayerProgression(playerId: string): Promise<PlayerProgression> {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { progression: true },
  });
  if (!player) throw new Error('Player not found');
  return parseProgression(player.progression);
}

export async function setPlayerRecipeDiscovered(
  ctx: AuditContext,
  playerId: string,
  recipeId: string,
  discovered: boolean,
  reason?: string
): Promise<PlayerProgression> {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player) throw new Error('Player not found');

  const progression = parseProgression(player.progression);
  const before = [...progression.discoveredRecipes];
  const set = new Set(progression.discoveredRecipes);
  if (discovered) set.add(recipeId);
  else set.delete(recipeId);

  const after = { ...progression, discoveredRecipes: [...set] };
  await prisma.player.update({
    where: { id: playerId },
    data: { progression: after as unknown as Prisma.InputJsonValue },
  });

  await writeAuditLog(ctx, {
    action: discovered ? 'player.recipe.discover' : 'player.recipe.forget',
    objectType: 'player',
    objectId: playerId,
    previousValue: { recipeId, discoveredRecipes: before },
    newValue: { recipeId, discoveredRecipes: after.discoveredRecipes },
    reason,
  });

  await syncOnlinePlayerByDbId(playerId);
  return after;
}
