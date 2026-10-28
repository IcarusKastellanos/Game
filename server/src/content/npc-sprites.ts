import type { ContentNpc, NpcAuthoredSpriteSheet } from '@witchcraft/shared';
import {
  computeIconManifestRevision,
  normalizeNpcAuthoredSpriteSheet,
  npcVisualContentHash,
} from '@witchcraft/shared';
import { prisma } from '../services/db.js';
import { contentRegistry } from './registry.js';

type NpcSpriteData = {
  spritePixels?: string[] | null;
  spriteSheet?: NpcAuthoredSpriteSheet | null;
};

export function hydrateNpcSprite(
  npc: ContentNpc & { data?: NpcSpriteData | null }
): ContentNpc {
  let next: ContentNpc = npc;
  if (!(npc.spritePixels?.length === 256)) {
    const fromData = npc.data?.spritePixels;
    if (fromData?.length === 256) next = { ...next, spritePixels: fromData };
  }
  if (!normalizeNpcAuthoredSpriteSheet(npc.spriteSheet)) {
    const fromData = normalizeNpcAuthoredSpriteSheet(npc.data?.spriteSheet);
    if (fromData) next = { ...next, spriteSheet: fromData };
  } else {
    next = { ...next, spriteSheet: normalizeNpcAuthoredSpriteSheet(npc.spriteSheet) };
  }
  return next;
}

/** Overlay custom portrait + authored sheets from DB onto JSON-loaded NPC registry entries. */
export async function mergeNpcSpritesFromDb(): Promise<number> {
  let merged = 0;
  try {
    const rows = await prisma.contentNpc.findMany({ select: { id: true, data: true } });
    for (const row of rows) {
      const existing = contentRegistry.npcs.get(row.id);
      if (!existing) continue;
      const data = (row.data ?? {}) as NpcSpriteData;
      let next = existing;
      let changed = false;
      if (data.spritePixels?.length === 256) {
        next = { ...next, spritePixels: data.spritePixels };
        changed = true;
      }
      const sheet = normalizeNpcAuthoredSpriteSheet(data.spriteSheet);
      if (sheet) {
        next = { ...next, spriteSheet: sheet };
        changed = true;
      }
      if (changed) {
        contentRegistry.npcs.set(row.id, next);
        merged++;
      }
    }
    if (merged > 0) {
      console.log(`[ContentRegistry] Merged NPC sprite assets from DB for ${merged} NPC(s)`);
    }
  } catch (err) {
    console.warn('[ContentRegistry] Could not merge NPC sprites from DB:', err);
  }
  return merged;
}

export function getNpcSpriteHash(npc: {
  id: string;
  spritePixels?: string[];
  spriteSheet?: NpcAuthoredSpriteSheet | null;
}): string {
  return npcVisualContentHash(npc);
}

export function getNpcSpriteManifest(): { revision: string; items: Record<string, string> } {
  const items: Record<string, string> = {};
  for (const npc of contentRegistry.npcs.values()) {
    items[npc.id] = getNpcSpriteHash(npc);
  }
  return { revision: computeIconManifestRevision(items), items };
}

export type NpcSpriteVerifyUpdate = {
  hash: string;
  spritePixels?: string[];
  spriteSheet?: NpcAuthoredSpriteSheet;
};

export function verifyNpcSpriteHashes(clientHashes: Record<string, string>): {
  revision: string;
  updates: Record<string, NpcSpriteVerifyUpdate>;
} {
  const manifest = getNpcSpriteManifest();
  const updates: Record<string, NpcSpriteVerifyUpdate> = {};
  for (const npc of contentRegistry.npcs.values()) {
    const serverHash = getNpcSpriteHash(npc);
    if (clientHashes[npc.id] === serverHash) continue;
    const portrait = npc.spritePixels?.length === 256 ? npc.spritePixels : undefined;
    const sheet = normalizeNpcAuthoredSpriteSheet(npc.spriteSheet);
    if (!portrait && !sheet) continue;
    updates[npc.id] = {
      hash: serverHash,
      ...(portrait ? { spritePixels: portrait } : {}),
      ...(sheet ? { spriteSheet: sheet } : {}),
    };
  }
  return { revision: manifest.revision, updates };
}

function npcToDb(
  npc: ContentNpc,
  previousData?: unknown,
  opts?: { clearSpriteSheet?: boolean }
) {
  const prev =
    previousData && typeof previousData === 'object' && !Array.isArray(previousData)
      ? { ...(previousData as Record<string, unknown>) }
      : {};
  const spritePixels = npc.spritePixels?.length === 256 ? npc.spritePixels : prev.spritePixels ?? null;
  const sheet = normalizeNpcAuthoredSpriteSheet(npc.spriteSheet);
  const spriteSheet = sheet
    ? sheet
    : opts?.clearSpriteSheet
      ? null
      : (prev.spriteSheet ?? null);
  return {
    id: npc.id,
    name: npc.name,
    role: npc.role,
    locationId: npc.locationId,
    schedule: npc.schedule ?? [],
    relationshipLevel: npc.relationshipLevel ?? 0,
    magicalKnowledge: npc.magicalKnowledge ?? 0,
    dialogueTreeId: npc.dialogueTreeId,
    shopId: npc.shopId ?? null,
    faction: npc.faction ?? null,
    secrets: npc.secrets ?? null,
    data: {
      ...prev,
      spritePixels,
      spriteSheet,
      scheduleOverride: npc.scheduleOverride ?? null,
      ...(npc.visual ? { visual: npc.visual } : {}),
    },
  };
}

export { npcToDb };
