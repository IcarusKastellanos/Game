import { ICON_PIXEL_COUNT, hashIconPixels } from '@witchcraft/shared';

/**
 * Hashes of the old 16×16 procedural item icons (flat tiles on a purple field).
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

export function isValidItemIconPixels(pixels: string[] | null | undefined): boolean {
  return !!pixels && pixels.length === ICON_PIXEL_COUNT;
}

/**
 * Shipped / admin-persisted JSON icons win. Postgres copies are rewritten to match
 * on content:sync so stale DB art cannot stick across restarts.
 */
export function resolveStoredIngredientIconPixels(
  _stored: string[] | null | undefined,
  shipped: string[] | null | undefined
): string[] | null {
  if (isValidItemIconPixels(shipped)) return [...shipped!];
  return null;
}

/** DB icon overlay is disabled — ingredients.json + live admin saves own item art. */
export function shouldMergeStoredIngredientIcon(_stored: string[] | null | undefined): boolean {
  return false;
}
