import {
  ICON_PIXEL_COUNT,
  generateItemIconPixels,
  hashIconPixels,
} from '@witchcraft/shared';

/**
 * Hashes of the old 16×16 procedural item icons (flat tiles on a purple field).
 * Database copies of that art give way to the sprites shipped in ingredients.json.
 */
const LEGACY_PROCEDURAL_ICON_HASHES = new Set<string>([
  '10zcew3',
  '1448mgh',
  '1akxkpx',
  '1cp0xa5',
  '1im3j8b',
  '1k49lvt',
  '1kfx85r',
  '1o42lc1',
  '1qv5pmv',
  '1s3ae8b',
  '1wrt5yx',
  '1xmcm21',
  '6rf1rl',
  '7i48yt',
  '9j1cth',
  'e3a4tt',
  'elrgyt',
  'g3lbhz',
  'gq22bx',
  'lq1kjx',
  'pvuwr5',
  'r7jo7h',
  'rq667b',
  'tulcbb',
  'v5asq5',
  'wvzjng',
  'z0vfl5',
]);

export function isLegacyProceduralIcon(pixels: string[] | null | undefined): boolean {
  if (!pixels || pixels.length !== 256) return false;
  return LEGACY_PROCEDURAL_ICON_HASHES.has(hashIconPixels(pixels));
}

export type IngredientIconItem = {
  id: string;
  category: string;
  name?: string;
};

/**
 * Prefer shipped JSON icons over stale DB copies of procedural / legacy art.
 * Keeps true admin-painted overrides (anything that is not shipped and not generator output).
 *
 * Set FORCE_SHIPPED_ITEM_ICONS=1 to always write ingredients.json pixels (startup scripts).
 */
export function resolveStoredIngredientIconPixels(
  stored: string[] | null | undefined,
  shipped: string[] | null | undefined,
  item: IngredientIconItem,
  opts?: { forceShipped?: boolean }
): string[] | null {
  const force =
    opts?.forceShipped === true ||
    process.env.FORCE_SHIPPED_ITEM_ICONS === '1' ||
    process.env.FORCE_SHIPPED_ITEM_ICONS === 'true';

  const shippedOk = shipped?.length === ICON_PIXEL_COUNT ? shipped : null;
  if (force && shippedOk) return [...shippedOk];

  if (!stored?.length) return shippedOk ? [...shippedOk] : null;
  if (isLegacyProceduralIcon(stored)) return shippedOk ? [...shippedOk] : null;
  if (stored.length !== ICON_PIXEL_COUNT) return shippedOk ? [...shippedOk] : null;

  const storedHash = hashIconPixels(stored);
  if (shippedOk && storedHash === hashIconPixels(shippedOk)) return [...shippedOk];

  const procedural = generateItemIconPixels(item.id, item.category, item.name ?? item.id);
  if (storedHash === hashIconPixels(procedural)) {
    return shippedOk ? [...shippedOk] : null;
  }

  // Admin (or other) painted override — keep.
  return [...stored];
}

/** True when a DB icon should overlay the JSON registry at runtime. */
export function shouldMergeStoredIngredientIcon(
  stored: string[] | null | undefined,
  shipped: string[] | null | undefined,
  item: IngredientIconItem
): boolean {
  if (!stored?.length || stored.length !== ICON_PIXEL_COUNT) return false;
  if (isLegacyProceduralIcon(stored)) return false;
  const resolved = resolveStoredIngredientIconPixels(stored, shipped, item);
  if (!resolved) return false;
  // Only merge when we intentionally kept the stored custom art.
  return hashIconPixels(resolved) === hashIconPixels(stored);
}
