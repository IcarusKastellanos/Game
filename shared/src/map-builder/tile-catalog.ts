import type { ContentMapDefinition } from '../types/index.js';
import type { MapBuilderDocument, MapLayerKind } from './types.js';

/** Paintable map tiles — indices stored in layer cells (1-based; 0 = empty) */
export interface MapTileCatalogEntry {
  id: string;
  name: string;
  spriteKey: string;
  layerKind: 'floor' | 'wall' | 'ground';
}

export const MAP_TILE_CATALOG: MapTileCatalogEntry[] = [
  { id: 'floor_grass', name: 'Grass', spriteKey: 'tile_grass', layerKind: 'floor' },
  { id: 'floor_path', name: 'Dirt Path', spriteKey: 'tile_path', layerKind: 'floor' },
  { id: 'floor_wood', name: 'Oak Floor', spriteKey: 'tile_floor_wood', layerKind: 'floor' },
  { id: 'floor_stone', name: 'Stone Tile', spriteKey: 'tile_floor_stone', layerKind: 'floor' },
  { id: 'wall_brick', name: 'Brick Wall', spriteKey: 'tile_wall_brick', layerKind: 'wall' },
  { id: 'wall_fence', name: 'Fence', spriteKey: 'tile_fence', layerKind: 'wall' },
  { id: 'wall_plaster', name: 'Plaster Wall', spriteKey: 'tile_wall_plaster', layerKind: 'wall' },
  { id: 'wall_window', name: 'Window Wall', spriteKey: 'tile_wall_window', layerKind: 'wall' },
];

export function catalogEntryFromIndex(index: number): MapTileCatalogEntry | undefined {
  if (index < 1) return undefined;
  return MAP_TILE_CATALOG[index - 1];
}

export function spriteKeyFromTileIndex(index: number): string | undefined {
  return catalogEntryFromIndex(index)?.spriteKey;
}

export function tileIndexFromSpriteKey(spriteKey: string): number {
  const idx = MAP_TILE_CATALOG.findIndex((t) => t.spriteKey === spriteKey);
  return idx >= 0 ? idx + 1 : 0;
}

export function tilesForLayerKind(kind: MapLayerKind): MapTileCatalogEntry[] {
  if (kind === 'wall' || kind === 'upper_wall' || kind === 'roof') {
    return MAP_TILE_CATALOG.filter((t) => t.layerKind === 'wall');
  }
  return MAP_TILE_CATALOG.filter((t) => t.layerKind === 'floor' || t.layerKind === 'ground');
}

function cellsHavePaint(cells: number[][] | undefined): boolean {
  return !!cells?.some((row) => row.some((v) => v > 0));
}

export function mapDocumentHasTilePaint(doc: MapBuilderDocument): boolean {
  return doc.layers.some((l) => cellsHavePaint(l.cells));
}

export function runtimeLayersHaveTiles(map: ContentMapDefinition): boolean {
  return cellsHavePaint(map.layers.floor) || cellsHavePaint(map.layers.walls) || cellsHavePaint(map.layers.objects);
}

function apartmentWallKeyAt(x: number, y: number, width: number, height: number): string {
  const doorX = Math.floor(width / 2);
  const isBorder = x === 0 || y === 0 || x === width - 1 || y === height - 1;
  if (!isBorder) return 'tile_wall_plaster';
  // Door opening on the bottom center — leave empty (floor shows through)
  if (y === height - 1 && x === doorX) return '';
  // Large modern windows along the top wall (skip corners)
  if (y === 0 && x >= 2 && x <= width - 3) return 'tile_wall_window';
  return 'tile_wall_plaster';
}

export function fillProceduralMapTiles(
  doc: MapBuilderDocument,
  width: number,
  height: number,
  sceneId: string
): void {
  const floorKey = sceneId === 'apartment' ? 'tile_floor_wood' : 'tile_grass';
  const wallKey = sceneId === 'apartment' ? 'tile_wall_plaster' : 'tile_fence';
  const pathKey = 'tile_path';

  const floorLayer = doc.layers.find((l) => l.kind === 'floor');
  const wallLayer = doc.layers.find((l) => l.kind === 'wall' || l.id === 'walls');
  const groundLayer = doc.layers.find((l) => l.kind === 'ground');

  const floorIdx = tileIndexFromSpriteKey(floorKey);
  const wallIdx = tileIndexFromSpriteKey(wallKey);
  const pathIdx = tileIndexFromSpriteKey(pathKey);
  const groundIdx = tileIndexFromSpriteKey(floorKey);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isBorder = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (sceneId === 'apartment') {
        const aptWall = apartmentWallKeyAt(x, y, width, height);
        if (aptWall && wallLayer) {
          wallLayer.cells[y][x] = tileIndexFromSpriteKey(aptWall);
        } else if (floorLayer) {
          floorLayer.cells[y][x] = floorIdx;
        }
        if (groundLayer && !aptWall) {
          groundLayer.cells[y][x] = groundIdx;
        }
        continue;
      }

      if (isBorder && wallLayer) {
        wallLayer.cells[y][x] = wallIdx;
      } else if (floorLayer) {
        const isPath = x === Math.floor(width / 2) || y === Math.floor(height / 2);
        floorLayer.cells[y][x] = isPath ? pathIdx : floorIdx;
      }
      if (groundLayer && !isBorder) {
        groundLayer.cells[y][x] = groundIdx;
      }
    }
  }
}

export function ensureMapDocumentTiles(
  doc: MapBuilderDocument,
  width: number,
  height: number,
  sceneId: string
): boolean {
  if (mapDocumentHasTilePaint(doc)) return false;
  fillProceduralMapTiles(doc, width, height, sceneId);
  return true;
}

export function defaultBrushForLayerKind(kind: MapLayerKind, sceneId: string): number {
  if (kind === 'wall' || kind === 'upper_wall' || kind === 'roof') {
    return tileIndexFromSpriteKey(sceneId === 'apartment' ? 'tile_wall_plaster' : 'tile_fence');
  }
  return tileIndexFromSpriteKey(sceneId === 'apartment' ? 'tile_floor_wood' : 'tile_grass');
}
