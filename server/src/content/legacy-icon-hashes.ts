import { ICON_PIXEL_COUNT, hashIconPixels } from '@witchcraft/shared';

/**
 * Hashes of the old 16×16 procedural item icons (flat tiles on a purple field).
 * Those never overlay admin / shipped 32×32 art.
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
 * Item icons are owned by admin (Postgres + live registry).
 * Sync may seed from ingredients.json only when the DB has no valid icon yet.
 * Valid DB icons are never replaced by JSON / startup scripts.
 */
export function resolveStoredIngredientIconPixels(
  stored: string[] | null | undefined,
  shipped: string[] | null | undefined
): string[] | null {
  if (isValidItemIconPixels(stored) && !isLegacyProceduralIcon(stored)) {
    return [...stored!];
  }
  if (isValidItemIconPixels(shipped)) {
    return [...shipped!];
  }
  return null;
}

/** DB icon overlays JSON whenever it is a valid 32×32 plane. */
export function shouldMergeStoredIngredientIcon(stored: string[] | null | undefined): boolean {
  return isValidItemIconPixels(stored) && !isLegacyProceduralIcon(stored);
}
