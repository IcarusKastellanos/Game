/** Canvas 2D tile drawing — matches client SpriteGenerator stardew tiles */

import { isTransparentPixel, MAP_TRANSPARENT_PIXEL } from '@witchcraft/shared';

const TILE = 16;

const PAL = {
  grass: '#5a9e4b',
  grassDark: '#3d7a35',
  grassLight: '#7bc96f',
  wood: '#8b6914',
  woodDark: '#5c4510',
  path: '#c4a574',
  brick: '#8b5a3c',
  brickDark: '#6b3a24',
};

type DrawFn = (ctx: CanvasRenderingContext2D, ox: number, oy: number, size: number) => void;

function fillCircle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

const DRAWERS: Record<string, DrawFn> = {
  tile_grass(ctx, ox, oy, size) {
    const s = size / TILE;
    ctx.fillStyle = PAL.grass;
    ctx.fillRect(ox, oy, size, size);
    ctx.fillStyle = PAL.grassLight;
    ctx.globalAlpha = 0.4;
    ctx.fillRect(ox + 2 * s, oy + 2 * s, 3 * s, 3 * s);
    ctx.fillRect(ox + 10 * s, oy + 8 * s, 2 * s, 2 * s);
    ctx.globalAlpha = 1;
    ctx.fillStyle = PAL.grassDark;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(ox + 12 * s, oy + 12 * s, 3 * s, 3 * s);
    ctx.globalAlpha = 1;
  },
  tile_path(ctx, ox, oy, size) {
    const s = size / TILE;
    ctx.fillStyle = PAL.path;
    ctx.fillRect(ox, oy, size, size);
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    for (let i = 0; i < 4; i++) ctx.fillRect(ox + i * 4 * s, oy + ((i * 3) % 12) * s, 2 * s, 2 * s);
  },
  tile_floor_wood(ctx, ox, oy, size) {
    const s = size / TILE;
    ctx.fillStyle = PAL.wood;
    ctx.fillRect(ox, oy, size, size);
    ctx.strokeStyle = PAL.woodDark;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = Math.max(1, s);
    ctx.beginPath();
    ctx.moveTo(ox, oy + 8 * s);
    ctx.lineTo(ox + size, oy + 8 * s);
    ctx.stroke();
    ctx.globalAlpha = 1;
  },
  tile_floor_stone(ctx, ox, oy, size) {
    const s = size / TILE;
    ctx.fillStyle = '#888899';
    ctx.fillRect(ox, oy, size, size);
    ctx.fillStyle = 'rgba(102,102,119,0.5)';
    ctx.fillRect(ox + 1 * s, oy + 1 * s, 6 * s, 6 * s);
    ctx.fillRect(ox + 9 * s, oy + 9 * s, 6 * s, 6 * s);
  },
  tile_wall_brick(ctx, ox, oy, size) {
    const s = size / TILE;
    ctx.fillStyle = PAL.brick;
    ctx.fillRect(ox, oy, size, size);
    ctx.fillStyle = 'rgba(107,58,36,0.6)';
    ctx.fillRect(ox, oy + 7 * s, size, 2 * s);
    ctx.fillRect(ox + 7 * s, oy, 2 * s, 7 * s);
  },
  tile_fence(ctx, ox, oy, size) {
    const s = size / TILE;
    ctx.fillStyle = 'rgba(61,122,53,0.3)';
    ctx.fillRect(ox, oy, size, size);
    ctx.fillStyle = PAL.woodDark;
    ctx.fillRect(ox + 2 * s, oy + 4 * s, 3 * s, 10 * s);
    ctx.fillRect(ox + 11 * s, oy + 4 * s, 3 * s, 10 * s);
    ctx.fillRect(ox, oy + 6 * s, size, 2 * s);
    ctx.fillRect(ox, oy + 12 * s, size, 2 * s);
  },
  obj_altar(ctx, ox, oy, size) {
    const s = size / TILE;
    ctx.fillStyle = PAL.woodDark;
    ctx.fillRect(ox + 2 * s, oy + 8 * s, 12 * s, 6 * s);
    ctx.fillStyle = '#4a0080';
    ctx.fillRect(ox + 4 * s, oy + 4 * s, 8 * s, 4 * s);
    ctx.fillStyle = 'rgba(255,221,136,0.8)';
    ctx.fillRect(ox + 6 * s, oy + 2 * s, 4 * s, 3 * s);
  },
  obj_door(ctx, ox, oy, size) {
    const s = size / TILE;
    ctx.fillStyle = PAL.wood;
    ctx.fillRect(ox + 3 * s, oy + 2 * s, 10 * s, 12 * s);
    ctx.fillStyle = PAL.woodDark;
    ctx.fillRect(ox + 3 * s, oy + 2 * s, 10 * s, 2 * s);
    fillCircle(ctx, ox + 11 * s, oy + 8 * s, 1 * s, '#ffcc44');
  },
  obj_tree(ctx, ox, oy, size) {
    const s = size / TILE;
    ctx.fillStyle = PAL.woodDark;
    ctx.fillRect(ox + 6 * s, oy + 10 * s, 4 * s, 6 * s);
    fillCircle(ctx, ox + 8 * s, oy + 6 * s, 7 * s, PAL.grassDark);
    fillCircle(ctx, ox + 7 * s, oy + 5 * s, 5 * s, PAL.grass);
  },
  obj_shop(ctx, ox, oy, size) {
    const s = size / TILE;
    ctx.fillStyle = PAL.brick;
    ctx.fillRect(ox + 1 * s, oy + 4 * s, 14 * s, 11 * s);
    ctx.fillStyle = '#884422';
    ctx.fillRect(ox + 3 * s, oy + 8 * s, 10 * s, 6 * s);
    ctx.fillStyle = '#ffeecc';
    ctx.fillRect(ox + 5 * s, oy + 2 * s, 6 * s, 3 * s);
  },
  obj_shelf(ctx, ox, oy, size) {
    const s = size / TILE;
    ctx.fillStyle = PAL.wood;
    ctx.fillRect(ox + 2 * s, oy + 4 * s, 12 * s, 10 * s);
    ctx.strokeStyle = PAL.woodDark;
    ctx.lineWidth = Math.max(1, s);
    ctx.beginPath();
    ctx.moveTo(ox + 2 * s, oy + 8 * s);
    ctx.lineTo(ox + 14 * s, oy + 8 * s);
    ctx.stroke();
  },
  obj_bed(ctx, ox, oy, size) {
    const s = size / TILE;
    ctx.fillStyle = PAL.wood;
    ctx.fillRect(ox + 1 * s, oy + 6 * s, 14 * s, 8 * s);
    ctx.fillStyle = '#6b4c8a';
    ctx.fillRect(ox + 2 * s, oy + 3 * s, 12 * s, 5 * s);
  },
  obj_red_bed(ctx, ox, oy, size) {
    const s = size / TILE;
    ctx.fillStyle = PAL.wood;
    ctx.fillRect(ox + 1 * s, oy + 6 * s, 14 * s, 8 * s);
    ctx.fillStyle = '#cc3333';
    ctx.fillRect(ox + 2 * s, oy + 3 * s, 12 * s, 5 * s);
  },
};

interface CustomSprite {
  pixels: string[];
  width: number;
  height: number;
}

const cache = new Map<string, HTMLCanvasElement>();
const customSprites = new Map<string, CustomSprite>();

function canvasToPixels(c: HTMLCanvasElement): string[] {
  const ctx = c.getContext('2d')!;
  const { width, height } = c;
  const img = ctx.getImageData(0, 0, width, height);
  const out: string[] = [];
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i]!;
    const g = img.data[i + 1]!;
    const b = img.data[i + 2]!;
    const a = img.data[i + 3]!;
    if (a === 0) out.push('#00000000');
    else out.push(`#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`);
  }
  return out;
}

function drawBuiltinTile(ctx: CanvasRenderingContext2D, spriteKey: string, ox: number, oy: number, size: number): void {
  const draw = DRAWERS[spriteKey];
  if (draw) draw(ctx, ox, oy, size);
  else {
    ctx.fillStyle = '#444466';
    ctx.fillRect(ox, oy, size, size);
    ctx.fillStyle = '#888899';
    ctx.fillRect(ox + 2, oy + 2, size - 4, size - 4);
  }
}

function buildCanvasFromPixels(pixels: string[], width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = pixels[y * width + x] ?? MAP_TRANSPARENT_PIXEL;
      if (isTransparentPixel(color)) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

export function registerCustomSprite(spriteKey: string, pixels: string[], widthPx?: number, heightPx?: number): void {
  if (!spriteKey || !pixels.length) return;
  let width = widthPx;
  let height = heightPx;
  if (!width || !height) {
    const side = Math.round(Math.sqrt(pixels.length));
    if (side * side === pixels.length) {
      width = side;
      height = side;
    } else if (widthPx && !heightPx) {
      width = widthPx;
      height = Math.max(1, Math.ceil(pixels.length / width));
    } else {
      width = width ?? side;
      height = height ?? Math.max(1, Math.ceil(pixels.length / width));
    }
  }
  customSprites.set(spriteKey, { pixels: [...pixels], width, height });
  cache.delete(spriteKey);
}

export function unregisterCustomSprite(spriteKey: string): void {
  customSprites.delete(spriteKey);
  cache.delete(spriteKey);
}

export function rasterizeBuiltinSprite(spriteKey: string, widthTiles = 1, heightTiles = 1): string[] | null {
  const w = widthTiles * TILE;
  const h = heightTiles * TILE;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  for (let ty = 0; ty < heightTiles; ty++) {
    for (let tx = 0; tx < widthTiles; tx++) {
      drawBuiltinTile(ctx, spriteKey, tx * TILE, ty * TILE, TILE);
    }
  }
  return canvasToPixels(c);
}

export function getTileCanvas(spriteKey: string): HTMLCanvasElement {
  const cached = cache.get(spriteKey);
  if (cached) return cached;

  const custom = customSprites.get(spriteKey);
  if (custom) {
    const c = buildCanvasFromPixels(custom.pixels, custom.width, custom.height);
    cache.set(spriteKey, c);
    return c;
  }

  const c = document.createElement('canvas');
  c.width = TILE;
  c.height = TILE;
  const ctx = c.getContext('2d')!;
  drawBuiltinTile(ctx, spriteKey, 0, 0, TILE);
  cache.set(spriteKey, c);
  return c;
}

export function drawTileSprite(
  ctx: CanvasRenderingContext2D,
  spriteKey: string,
  dx: number,
  dy: number,
  size: number
): void {
  drawSpriteRect(ctx, spriteKey, dx, dy, size, size);
}

export function drawSpriteRect(
  ctx: CanvasRenderingContext2D,
  spriteKey: string,
  dx: number,
  dy: number,
  width: number,
  height: number
): void {
  const tile = getTileCanvas(spriteKey);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tile, dx, dy, width, height);
}

/** Draw a sprite rotated in 90° steps around the center of its footprint rect. */
export function drawSpriteRectRotated(
  ctx: CanvasRenderingContext2D,
  spriteKey: string,
  dx: number,
  dy: number,
  width: number,
  height: number,
  rotationDegrees = 0
): void {
  if (!rotationDegrees) {
    drawSpriteRect(ctx, spriteKey, dx, dy, width, height);
    return;
  }
  ctx.save();
  ctx.translate(dx + width / 2, dy + height / 2);
  ctx.rotate((rotationDegrees * Math.PI) / 180);
  drawSpriteRect(ctx, spriteKey, -width / 2, -height / 2, width, height);
  ctx.restore();
}

export function strokeRectRotated(
  ctx: CanvasRenderingContext2D,
  dx: number,
  dy: number,
  width: number,
  height: number,
  rotationDegrees = 0
): void {
  if (!rotationDegrees) {
    ctx.strokeRect(dx, dy, width, height);
    return;
  }
  ctx.save();
  ctx.translate(dx + width / 2, dy + height / 2);
  ctx.rotate((rotationDegrees * Math.PI) / 180);
  ctx.strokeRect(-width / 2, -height / 2, width, height);
  ctx.restore();
}

export function drawTileIndex(
  ctx: CanvasRenderingContext2D,
  tileIndex: number,
  resolveKey: (index: number) => string | undefined,
  dx: number,
  dy: number,
  size: number
): void {
  const key = resolveKey(tileIndex);
  if (!key) return;
  drawTileSprite(ctx, key, dx, dy, size);
}

export function spritePreviewDataUrl(spriteKey: string, pixels?: string[], widthPx = TILE, heightPx = TILE): string {
  if (pixels?.length) return buildCanvasFromPixels(pixels, widthPx, heightPx).toDataURL('image/png');
  return getTileCanvas(spriteKey).toDataURL('image/png');
}

export { TILE as SPRITE_TILE_SIZE, DRAWERS as BUILTIN_SPRITE_KEYS };
