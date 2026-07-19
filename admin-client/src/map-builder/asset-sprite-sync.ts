import { mapBuilderApi } from './api.js';
import { getSpritePixels, getTilesetSprites } from './sprite-storage.js';
import { registerCustomSprite } from './tile-renderer.js';

/** Register all custom sprite pixels from DB so map editor previews match saved art. */
export async function syncCustomSpritesFromAssets(): Promise<void> {
  const [tiles, furniture, decorations, tilesets] = await Promise.all([
    mapBuilderApi.listTiles(true).catch(() => []),
    mapBuilderApi.listFurniture(true).catch(() => []),
    mapBuilderApi.listDecorations(true).catch(() => []),
    mapBuilderApi.listTilesets(true).catch(() => []),
  ]);

  for (const row of tiles as { spriteRef?: string; properties?: unknown }[]) {
    const px = getSpritePixels(row.properties);
    if (px && row.spriteRef) registerCustomSprite(row.spriteRef, px);
  }

  for (const row of furniture as { spriteRef?: string; width?: number; height?: number; properties?: unknown }[]) {
    const px = getSpritePixels(row.properties);
    if (px && row.spriteRef) {
      registerCustomSprite(row.spriteRef, px, (row.width ?? 1) * 16, (row.height ?? 1) * 16);
    }
  }

  for (const row of decorations as { spriteRef?: string; properties?: unknown }[]) {
    const px = getSpritePixels(row.properties);
    if (px && row.spriteRef) registerCustomSprite(row.spriteRef, px);
  }

  for (const row of tilesets as { data?: unknown }[]) {
    for (const [key, px] of Object.entries(getTilesetSprites(row.data))) {
      registerCustomSprite(key, px);
    }
  }
}
