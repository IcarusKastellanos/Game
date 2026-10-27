import { hashIconPixels } from '@witchcraft/shared';

/**
 * Hashes of the old procedural item icons (the flat tiles on a purple field).
 * Database copies of that art give way to the sprites shipped in ingredients.json.
 * Any other saved icon, including one painted in the admin editor, stays.
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
