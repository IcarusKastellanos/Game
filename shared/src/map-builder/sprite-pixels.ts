/** Transparent pixel token for map / item sprite editors */

import { TILE_SIZE } from '../constants/index.js';

export const MAP_TRANSPARENT_PIXEL = '#00000000';
export const SPRITE_PIXELS_KEY = 'spritePixels';

/** Art was authored at 16px/tile before the global 32px scale. */
export const LEGACY_SPRITE_TILE_PX = 16;

export function isTransparentPixel(color: string | undefined): boolean {
  if (!color) return true;
  const c = color.toLowerCase();
  return c === MAP_TRANSPARENT_PIXEL || c === 'transparent';
}

export function getSpritePixelsFromProperties(properties: unknown): string[] | undefined {
  if (!properties || typeof properties !== 'object') return undefined;
  const px = (properties as Record<string, unknown>)[SPRITE_PIXELS_KEY];
  if (!Array.isArray(px) || !px.length) return undefined;
  return px.map(String);
}

/** Nearest-neighbor resample of a flat pixel buffer into a new size. */
export function nearestNeighborResizePixels(
  pixels: string[],
  fromW: number,
  fromH: number,
  toW: number,
  toH: number
): string[] {
  const out = Array(toW * toH).fill(MAP_TRANSPARENT_PIXEL) as string[];
  if (fromW <= 0 || fromH <= 0 || toW <= 0 || toH <= 0) return out;
  for (let y = 0; y < toH; y++) {
    const sy = Math.min(fromH - 1, Math.floor(((y + 0.5) * fromH) / toH));
    for (let x = 0; x < toW; x++) {
      const sx = Math.min(fromW - 1, Math.floor(((x + 0.5) * fromW) / toW));
      out[y * toW + x] = pixels[sy * fromW + sx] ?? MAP_TRANSPARENT_PIXEL;
    }
  }
  return out;
}

export type SpritePixelSizeHint = {
  /** Declared footprint in tiles (furniture width/height). */
  widthTiles?: number;
  heightTiles?: number;
  /** Current game tile size (defaults to TILE_SIZE). */
  tilePx?: number;
  /** Legacy authored tile size (defaults to 16). */
  legacyTilePx?: number;
};

/**
 * Infer source width/height for a flat pixel buffer that may still be 16px/tile.
 */
export function inferSpritePixelSize(
  pixels: string[],
  targetW: number,
  targetH: number,
  hint?: SpritePixelSizeHint
): { width: number; height: number } {
  const len = pixels.length;
  if (len === targetW * targetH) return { width: targetW, height: targetH };

  const side = Math.round(Math.sqrt(len));
  if (side * side === len) return { width: side, height: side };

  const widthTiles = Math.max(1, hint?.widthTiles ?? Math.max(1, Math.round(targetW / (hint?.tilePx ?? TILE_SIZE))));
  const heightTiles = Math.max(1, hint?.heightTiles ?? Math.max(1, Math.round(targetH / (hint?.tilePx ?? TILE_SIZE))));
  const legacyTile = hint?.legacyTilePx ?? LEGACY_SPRITE_TILE_PX;
  const legacyW = widthTiles * legacyTile;
  const legacyH = heightTiles * legacyTile;
  if (len === legacyW * legacyH) return { width: legacyW, height: legacyH };

  // Last resort: assume target width as stride.
  return { width: targetW, height: Math.max(1, Math.ceil(len / targetW)) };
}

/**
 * Ensure a pixel plane matches the destination canvas size.
 * Upscales legacy 16px/tile furniture/decoration buffers with nearest-neighbor.
 */
export function normalizeSpritePixelsToSize(
  pixels: string[] | undefined,
  targetW: number,
  targetH: number,
  hint?: SpritePixelSizeHint
): string[] {
  const expected = targetW * targetH;
  if (!pixels?.length) return Array(expected).fill(MAP_TRANSPARENT_PIXEL);
  if (pixels.length === expected) return [...pixels];
  const { width, height } = inferSpritePixelSize(pixels, targetW, targetH, hint);
  return nearestNeighborResizePixels(pixels, width, height, targetW, targetH);
}
