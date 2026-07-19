import { TILE_SIZE } from '@witchcraft/shared';

/** Convert sprite pixel position to world tile coordinates (float, center-aligned). */
export function pixelsToWorldTiles(px: number, py: number): { x: number; y: number } {
  return {
    x: (px - TILE_SIZE / 2) / TILE_SIZE,
    y: (py - TILE_SIZE / 2) / TILE_SIZE,
  };
}

/** Convert world tile coordinates to sprite pixel position (center-aligned). */
export function worldTilesToPixels(tx: number, ty: number): { x: number; y: number } {
  return {
    x: tx * TILE_SIZE + TILE_SIZE / 2,
    y: ty * TILE_SIZE + TILE_SIZE / 2,
  };
}
