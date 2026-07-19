/** Sub-tile placement step for furniture and decorations (tile units). */
export const TILE_HALF_STEP = 0.5;

export const RENDER_LEVEL_MIN = 0;
export const RENDER_LEVEL_MAX = 100;

/** Default for placed props — above floor (1) but below the player (50). */
export const DEFAULT_PLACED_RENDER_LEVEL = 10;

/** Actors (local player, remotes) sort near the middle of the 0–100 range. */
export const RENDER_LEVEL_PLAYER = 50;

export function snapTileCoord(v: number, step: number): number {
  if (!Number.isFinite(v)) return 0;
  if (step <= 0) return v;
  return Math.round(v / step) * step;
}

export function tileCoordStep(useHalfTiles: boolean): number {
  return useHalfTiles ? TILE_HALF_STEP : 1;
}

export function clampPlacementCoord(
  v: number,
  mapSize: number,
  footprint: number,
  useHalfTiles: boolean
): number {
  const step = tileCoordStep(useHalfTiles);
  const max = Math.max(0, mapSize - footprint);
  const snapped = snapTileCoord(v, step);
  return Math.min(max, Math.max(0, snapped));
}

export function clampRenderLevel(v: number): number {
  const n = Number.isFinite(v) ? v : DEFAULT_PLACED_RENDER_LEVEL;
  return Math.min(RENDER_LEVEL_MAX, Math.max(RENDER_LEVEL_MIN, Math.round(n)));
}

export function normalizePlacedRenderLevel(v?: number): number {
  return v == null ? DEFAULT_PLACED_RENDER_LEVEL : clampRenderLevel(v);
}

/** Combine render level (0=background … 100=foreground) with feet Y for top-down depth. */
export function placedObjectDepth(renderLevel: number, feetY: number): number {
  return clampRenderLevel(renderLevel) + feetY / 100_000;
}

export function formatTileCoord(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
