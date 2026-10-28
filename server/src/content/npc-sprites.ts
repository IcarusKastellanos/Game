import type { ContentNpc } from '@witchcraft/shared';
import { computeIconManifestRevision, hashIconPixels } from '@witchcraft/shared';
import { prisma } from '../services/db.js';
import { contentRegistry } from './registry.js';

export function hydrateNpcSprite(npc: ContentNpc & { data?: { spritePixels?: string[] | null } }): ContentNpc {
  if (npc.spritePixels?.length === 256) return npc;
  const fromData = npc.data?.spritePixels;
  if (fromData?.length === 256) return { ...npc, spritePixels: fromData };
  return npc;
}

/** Overlay custom spritePixels from DB onto JSON-loaded NPC registry entries. */
export async function mergeNpcSpritesFromDb(): Promise<number> {
  let merged = 0;
  try {
    const rows = await prisma.contentNpc.findMany({ select: { id: true, data: true } });
    for (const row of rows) {
      const existing = contentRegistry.npcs.get(row.id);
      if (!existing) continue;
      const data = (row.data ?? {}) as { spritePixels?: string[] | null };
      if (data.spritePixels?.length === 256) {
        contentRegistry.npcs.set(row.id, { ...existing, spritePixels: data.spritePixels });
        merged++;
      }
    }
    if (merged > 0) {
      console.log(`[ContentRegistry] Merged spritePixels from DB for ${merged} NPC(s)`);
    }
  } catch (err) {
    console.warn('[ContentRegistry] Could not merge NPC sprites from DB:', err);
  }
  return merged;
}

export function getNpcSpriteHash(npc: { id: string; spritePixels?: string[] }): string {
  if (npc.spritePixels?.length === 256) return hashIconPixels(npc.spritePixels);
  return `gen:${npc.id}`;
}

export function getNpcSpriteManifest(): { revision: string; items: Record<string, string> } {
  const items: Record<string, string> = {};
  for (const npc of contentRegistry.npcs.values()) {
    items[npc.id] = getNpcSpriteHash(npc);
  }
  return { revision: computeIconManifestRevision(items), items };
}

export function verifyNpcSpriteHashes(clientHashes: Record<string, string>): {
  revision: string;
  updates: Record<string, { hash: string; spritePixels: string[] }>;
} {
  const manifest = getNpcSpriteManifest();
  const updates: Record<string, { hash: string; spritePixels: string[] }> = {};
  for (const npc of contentRegistry.npcs.values()) {
    const serverHash = getNpcSpriteHash(npc);
    if (clientHashes[npc.id] === serverHash) continue;
    if (npc.spritePixels?.length === 256) {
      updates[npc.id] = { hash: serverHash, spritePixels: npc.spritePixels };
    }
  }
  return { revision: manifest.revision, updates };
}

function npcToDb(npc: ContentNpc, previousData?: unknown) {
  const prev =
    previousData && typeof previousData === 'object' && !Array.isArray(previousData)
      ? { ...(previousData as Record<string, unknown>) }
      : {};
  const spritePixels = npc.spritePixels?.length === 256 ? npc.spritePixels : prev.spritePixels ?? null;
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
      scheduleOverride: npc.scheduleOverride ?? null,
    },
  };
}

export { npcToDb };
