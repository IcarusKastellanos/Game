import { mergeIngredientIconsFromDb } from './ingredient-icons.js';
import { mergeNpcSpritesFromDb } from './npc-sprites.js';
import { contentRegistry } from './registry.js';

/**
 * JSON reload replaces the live registry. Published maps and editor-saved
 * sprites live in the database and must be laid back on top, or the apartment
 * and item icons fall back to the older files on disk.
 */
export async function rehydrateContentOverlays(): Promise<number> {
  await mergeIngredientIconsFromDb();
  await mergeNpcSpritesFromDb();
  return contentRegistry.mergePublishedMaps();
}
