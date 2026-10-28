import type { ContentIngredient } from '@witchcraft/shared';
import {
  ICON_PIXEL_COUNT,
  computeIconManifestRevision,
  getIngredientIconHash,
  resolveItemIconPixels,
} from '@witchcraft/shared';
import { prisma } from '../services/db.js';
import { shouldMergeStoredIngredientIcon } from './legacy-icon-hashes.js';
import { contentRegistry } from './registry.js';

export function hydrateIngredientIcon(item: ContentIngredient): ContentIngredient {
  if (item.iconPixels?.length === ICON_PIXEL_COUNT) return item;
  return item;
}

export function getPublicIngredients(): ContentIngredient[] {
  return [...contentRegistry.ingredients.values()].map((item) => {
    const pixels = resolveItemIconPixels(item);
    return pixels === item.iconPixels ? item : { ...item, iconPixels: pixels };
  });
}

/** Overlay custom (non-legacy) iconPixels from DB onto JSON-loaded registry. */
export async function mergeIngredientIconsFromDb(): Promise<number> {
  let merged = 0;
  try {
    const rows = await prisma.contentIngredient.findMany({
      select: { id: true, data: true },
    });
    for (const row of rows) {
      const existing = contentRegistry.ingredients.get(row.id);
      if (!existing) continue;
      const data = (row.data ?? {}) as { iconPixels?: string[] | null };
      if (
        !shouldMergeStoredIngredientIcon(data.iconPixels, existing.iconPixels, {
          id: existing.id,
          category: existing.category,
          name: existing.name,
        })
      ) {
        continue;
      }
      contentRegistry.ingredients.set(row.id, {
        ...existing,
        iconPixels: data.iconPixels as string[],
      });
      merged++;
    }
    if (merged > 0) {
      console.log(`[ContentRegistry] Merged custom iconPixels from DB for ${merged} item(s)`);
    }
  } catch (err) {
    console.warn('[ContentRegistry] Could not merge icons from DB:', err);
  }
  return merged;
}

export function getIconManifest(): { revision: string; items: Record<string, string> } {
  const items: Record<string, string> = {};
  for (const ing of contentRegistry.ingredients.values()) {
    items[ing.id] = getIngredientIconHash(ing);
  }
  return { revision: computeIconManifestRevision(items), items };
}

export function verifyIconHashes(clientHashes: Record<string, string>): {
  revision: string;
  updates: Record<string, { hash: string; iconPixels: string[] }>;
} {
  const manifest = getIconManifest();
  const updates: Record<string, { hash: string; iconPixels: string[] }> = {};

  for (const ing of contentRegistry.ingredients.values()) {
    const serverHash = getIngredientIconHash(ing);
    const clientHash = clientHashes[ing.id];
    if (clientHash === serverHash) continue;
    const iconPixels = resolveItemIconPixels(ing);
    updates[ing.id] = { hash: serverHash, iconPixels };
  }

  return { revision: manifest.revision, updates };
}
