import { TILE_SIZE } from '../constants/index.js';
import type { ContentMapDefinition } from '../types/index.js';

export type MapInteractable = ContentMapDefinition['interactables'][number];

/**
 * How far (in tiles) the player can stand from an interactable footprint edge and still use it.
 * 2 tiles covers standing one tile away when collision blocks the adjacent cell (common on statues).
 */
export const INTERACT_RANGE_FROM_EDGE_TILES = 2;

export function interactRangeFromEdgePx(): number {
  return TILE_SIZE * INTERACT_RANGE_FROM_EDGE_TILES;
}

export function interactableFootprintTiles(inter: MapInteractable): { w: number; h: number } {
  const w = Number(inter.data?.footprintWidth ?? inter.data?.width ?? 1);
  const h = Number(inter.data?.footprintHeight ?? inter.data?.height ?? 1);
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

/** Pixel center of interactable footprint (matches client MapBuilder placement). */
export function interactableCenterPixels(inter: MapInteractable): { x: number; y: number } {
  const { w, h } = interactableFootprintTiles(inter);
  if (inter.data?.centerTileCoords === true) {
    return { x: inter.x * TILE_SIZE, y: inter.y * TILE_SIZE };
  }
  return {
    x: inter.x * TILE_SIZE + (w * TILE_SIZE) / 2,
    y: inter.y * TILE_SIZE + (h * TILE_SIZE) / 2,
  };
}

/** Shortest distance from a point to the interactable footprint rectangle (0 = inside). */
export function distanceToInteractableFootprintPx(
  pxX: number,
  pxY: number,
  inter: MapInteractable
): number {
  const { w, h } = interactableFootprintTiles(inter);
  const { x: cx, y: cy } = interactableCenterPixels(inter);
  const halfW = (w * TILE_SIZE) / 2;
  const halfH = (h * TILE_SIZE) / 2;
  const dx = Math.max(0, Math.abs(pxX - cx) - halfW);
  const dy = Math.max(0, Math.abs(pxY - cy) - halfH);
  return Math.hypot(dx, dy);
}

export function isWithinInteractRange(pxX: number, pxY: number, inter: MapInteractable): boolean {
  return distanceToInteractableFootprintPx(pxX, pxY, inter) <= interactRangeFromEdgePx();
}
