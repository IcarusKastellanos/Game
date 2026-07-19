import type { ContentNpc } from '@witchcraft/shared';
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

function npcToDb(npc: ContentNpc) {
  const { spritePixels, ...core } = npc;
  return {
    ...core,
    data: { spritePixels: spritePixels?.length === 256 ? spritePixels : null },
  };
}

export { npcToDb };
