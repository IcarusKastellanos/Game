/** Item icon rendering — local asset cache + shared pixel art */

import {
  ICON_PIXEL_SIZE,
  getIngredientIconHash,
  isTransparentPixel,
  MAP_TRANSPARENT_PIXEL,
  resolveItemIconPixels,
} from '@witchcraft/shared';
import {
  cacheIconLocally,
  getCachedIconDataUrl,
} from '../assets/ItemIconAssetStore';

const ICON_SIZE = ICON_PIXEL_SIZE;

function renderCustomPixels(ctx: CanvasRenderingContext2D, pixels: string[]): void {
  for (let y = 0; y < ICON_SIZE; y++) {
    for (let x = 0; x < ICON_SIZE; x++) {
      const color = pixels[y * ICON_SIZE + x] ?? MAP_TRANSPARENT_PIXEL;
      if (isTransparentPixel(color)) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

function pixelsToDataUrl(pixels: string[]): string {
  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
  renderCustomPixels(ctx, pixels);
  return canvas.toDataURL('image/png');
}

export function getItemIconUrl(
  itemId: string,
  category?: string,
  name?: string,
  iconPixels?: string[]
): string {
  const resolved = resolveItemIconPixels({
    id: itemId,
    category: category ?? 'default',
    name: name ?? itemId,
    iconPixels,
  });
  const hash = getIngredientIconHash({ id: itemId, iconPixels: resolved });

  const cached = getCachedIconDataUrl(itemId, hash);
  if (cached) return cached;

  return cacheIconLocally(itemId, resolved, hash);
}

export function preloadItemIcons(
  items: { id: string; category: string; name: string; iconPixels?: string[] }[]
): void {
  for (const item of items) {
    getItemIconUrl(item.id, item.category, item.name, item.iconPixels);
  }
}

export function iconImgHtml(
  itemId: string,
  category?: string,
  name?: string,
  size = 32,
  iconPixels?: string[]
): string {
  const url = getItemIconUrl(itemId, category, name, iconPixels);
  return `<img src="${url}" width="${size}" height="${size}" alt="${itemId}" draggable="true" data-item-id="${itemId}" class="item-icon" style="image-rendering:pixelated" />`;
}

export { resolveItemIconPixels, generateItemIconPixels } from '@witchcraft/shared';
export { verifyItemIconsOncePerLogin, clearIconVerifySession } from '../assets/ItemIconAssetStore';
