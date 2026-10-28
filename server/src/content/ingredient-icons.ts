import type { ContentIngredient } from '@witchcraft/shared';
import {
  ICON_PIXEL_COUNT,
  computeIconManifestRevision,
  getIngredientIconHash,
  resolveItemIconPixels,
} from '@witchcraft/shared';
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

/**
 * Item art comes from ingredients.json (and live admin saves into the registry/file).
 * Stale Postgres iconPixels are intentionally not overlaid — sync rewrites DB to match JSON.
 */
export async function mergeIngredientIconsFromDb(): Promise<number> {
  return 0;
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
