import { Prisma } from '@prisma/client';
import {
  GRIMOIRE_MANUSCRIPT_ITEM_ID,
  applyManuscriptEditToGrimoire,
  applyManuscriptEditToInventory,
  cleanAuthoredGrimoireBody,
  cleanAuthoredGrimoireTitle,
  parseProgression,
  purgeManuscriptFromGrimoire,
  purgeManuscriptFromInventory,
  readManuscriptMeta,
} from '@witchcraft/shared';
import { prisma } from '../../services/db.js';
import { getChatFilterWords as liveFilterWords } from '../../systems/chat-filter.js';
import {
  archiveManuscriptRecord,
  getManuscriptRecord,
  listManuscriptRecords,
  loadManuscriptRegistry,
  updateManuscriptRecord,
  upsertManuscriptRecord,
  type ManuscriptRecord,
} from '../../systems/manuscript-registry.js';
import { syncOnlinePlayerByDbId } from '../../rooms/game-room-registry.js';
import { writeAuditLog, type AuditContext } from '../audit.js';
import { inventoryRowsToGrid, persistInventoryGridForModeration } from './player-admin.js';

export interface ManuscriptAdminRow extends ManuscriptRecord {
  itemCopies: number;
  sharedCopies: number;
  authorCopies: number;
}

async function persistProgression(playerId: string, progression: unknown): Promise<void> {
  await prisma.player.update({
    where: { id: playerId },
    data: { progression: progression as Prisma.InputJsonValue },
  });
}

function emptyCounts(): { itemCopies: number; sharedCopies: number; authorCopies: number } {
  return { itemCopies: 0, sharedCopies: 0, authorCopies: 0 };
}

async function presenceMap(): Promise<Map<string, { itemCopies: number; sharedCopies: number; authorCopies: number }>> {
  const counts = new Map<string, { itemCopies: number; sharedCopies: number; authorCopies: number }>();
  const bump = (
    pageId: string,
    key: 'itemCopies' | 'sharedCopies' | 'authorCopies',
    amount = 1
  ): void => {
    const row = counts.get(pageId) ?? emptyCounts();
    row[key] += amount;
    counts.set(pageId, row);
  };

  const items = await prisma.inventoryItem.findMany({
    where: { itemId: GRIMOIRE_MANUSCRIPT_ITEM_ID },
  });
  for (const item of items) {
    const meta = readManuscriptMeta({
      itemId: item.itemId,
      quantity: item.quantity,
      metadata: (item.metadata as Record<string, unknown>) ?? undefined,
    });
    if (!meta) continue;
    bump(meta.manuscriptPageId, 'itemCopies', Math.max(1, item.quantity));
  }

  const players = await prisma.player.findMany({ select: { progression: true } });
  for (const player of players) {
    const book = parseProgression(player.progression).grimoire;
    if (!book) continue;
    for (const page of book.sharedPages) {
      const pageId = page.manuscriptPageId || page.id;
      if (pageId) bump(pageId, 'sharedCopies');
    }
    for (const page of book.authored) {
      if (page.id) bump(page.id, 'authorCopies');
    }
  }
  return counts;
}

export async function discoverManuscriptsFromPlayers(): Promise<void> {
  loadManuscriptRegistry();
  const items = await prisma.inventoryItem.findMany({
    where: { itemId: GRIMOIRE_MANUSCRIPT_ITEM_ID },
  });
  for (const item of items) {
    const meta = readManuscriptMeta({
      itemId: item.itemId,
      quantity: item.quantity,
      metadata: (item.metadata as Record<string, unknown>) ?? undefined,
    });
    if (!meta) continue;
    if (getManuscriptRecord(meta.manuscriptPageId)?.status === 'archived') continue;
    upsertManuscriptRecord({
      pageId: meta.manuscriptPageId,
      title: meta.manuscriptTitle,
      body: meta.manuscriptBody,
      authorName: meta.manuscriptAuthor,
      authorPlayerId: meta.manuscriptAuthorId,
      exportedAt: meta.manuscriptAuthoredAt,
      status: 'active',
    });
  }

  const players = await prisma.player.findMany({
    select: { progression: true },
  });
  for (const player of players) {
    const progression = parseProgression(player.progression);
    for (const page of progression.grimoire?.sharedPages ?? []) {
      const pageId = page.manuscriptPageId || page.id;
      if (!pageId || !page.body) continue;
      if (getManuscriptRecord(pageId)?.status === 'archived') continue;
      upsertManuscriptRecord({
        pageId,
        title: page.title,
        body: page.body,
        authorName: page.authorName,
        exportedAt: page.receivedAt,
        status: 'active',
      });
    }
  }
}

export async function listManuscriptsForAdmin(includeArchived = false): Promise<ManuscriptAdminRow[]> {
  await discoverManuscriptsFromPlayers();
  const presence = await presenceMap();
  return listManuscriptRecords(includeArchived).map((row) => ({
    ...row,
    ...(presence.get(row.pageId) ?? emptyCounts()),
  }));
}

export async function editManuscriptEverywhere(
  ctx: AuditContext,
  pageId: string,
  rawTitle: string,
  rawBody: string
): Promise<ManuscriptAdminRow> {
  const filter = liveFilterWords();
  const title = cleanAuthoredGrimoireTitle(rawTitle, filter);
  const body = cleanAuthoredGrimoireBody(rawBody, filter);
  if (!body) throw new Error('Page body cannot be empty');

  const before = getManuscriptRecord(pageId);
  if (before?.status === 'archived') throw new Error('That manuscript is archived');

  const updated =
    updateManuscriptRecord(pageId, title, body) ??
    upsertManuscriptRecord({ pageId, title, body, status: 'active' });

  const players = await prisma.player.findMany({
    include: { inventory: true },
  });
  const touched: string[] = [];
  for (const player of players) {
    const progression = parseProgression(player.progression);
    const nextBook = applyManuscriptEditToGrimoire(progression.grimoire, pageId, title, body);
    const grid = inventoryRowsToGrid(
      player.inventory.map((row) => ({
        itemId: row.itemId,
        quantity: row.quantity,
        metadata: (row.metadata as Record<string, unknown>) ?? null,
      }))
    );
    const nextInv = applyManuscriptEditToInventory(grid, pageId, title, body);
    const bookChanged = nextBook !== progression.grimoire;
    const invChanged = nextInv !== grid;
    if (!bookChanged && !invChanged) continue;
    if (bookChanged) {
      await persistProgression(player.id, { ...progression, grimoire: nextBook });
    }
    if (invChanged) {
      await persistInventoryGridForModeration(player.id, nextInv);
    }
    touched.push(player.id);
  }

  for (const playerId of touched) {
    await syncOnlinePlayerByDbId(playerId);
  }

  await writeAuditLog(ctx, {
    action: 'moderation.manuscript.update',
    objectType: 'manuscript',
    objectId: pageId,
    previousValue: before ?? null,
    newValue: updated,
  });

  const presence = await presenceMap();
  return { ...updated, ...(presence.get(pageId) ?? emptyCounts()) };
}

export async function archiveManuscriptEverywhere(
  ctx: AuditContext,
  pageId: string
): Promise<ManuscriptAdminRow> {
  const before = getManuscriptRecord(pageId);
  const archived =
    archiveManuscriptRecord(pageId) ??
    upsertManuscriptRecord({
      pageId,
      title: before?.title ?? pageId,
      body: before?.body ?? '',
      authorName: before?.authorName,
      status: 'archived',
    });

  const players = await prisma.player.findMany({
    include: { inventory: true },
  });
  const touched: string[] = [];
  for (const player of players) {
    const progression = parseProgression(player.progression);
    const nextBook = purgeManuscriptFromGrimoire(progression.grimoire, pageId);
    const grid = inventoryRowsToGrid(
      player.inventory.map((row) => ({
        itemId: row.itemId,
        quantity: row.quantity,
        metadata: (row.metadata as Record<string, unknown>) ?? null,
      }))
    );
    const nextInv = purgeManuscriptFromInventory(grid, pageId);
    const bookChanged = nextBook !== progression.grimoire;
    const invChanged = nextInv !== grid;
    if (!bookChanged && !invChanged) continue;
    if (bookChanged) {
      await persistProgression(player.id, { ...progression, grimoire: nextBook });
    }
    if (invChanged) {
      await persistInventoryGridForModeration(player.id, nextInv);
    }
    touched.push(player.id);
  }

  for (const playerId of touched) {
    await syncOnlinePlayerByDbId(playerId);
  }

  await writeAuditLog(ctx, {
    action: 'moderation.manuscript.archive',
    objectType: 'manuscript',
    objectId: pageId,
    previousValue: before ?? null,
    newValue: archived,
  });

  return { ...archived, itemCopies: 0, sharedCopies: 0, authorCopies: 0 };
}
