import Phaser from 'phaser';
import { isTransparentPixel, MAP_TRANSPARENT_PIXEL } from '@witchcraft/shared';

/** Stable hash so sprite edits get a new texture key instead of reusing stale cache. */
function hashPixelArray(pixels: string[]): string {
  let h = 2166136261;
  for (let i = 0; i < pixels.length; i++) {
    const color = pixels[i] ?? '';
    for (let j = 0; j < color.length; j++) {
      h ^= color.charCodeAt(j);
      h = Math.imul(h, 16777619);
    }
  }
  return (h >>> 0).toString(36);
}

function pixelTextureKey(spriteRef: string, widthPx: number, heightPx: number, pixels: string[]): string {
  return `${spriteRef}__px__${widthPx}x${heightPx}__${hashPixelArray(pixels)}`;
}

/** Register a map sprite texture from custom pixels (supports transparency). */
export function ensureMapSpriteTexture(
  scene: Phaser.Scene,
  key: string,
  widthPx: number,
  heightPx: number,
  pixels?: string[]
): string {
  if (!pixels?.length) {
    if (scene.textures.exists(key)) {
      return key;
    }
    const objKey = key.startsWith('obj_') ? key : `obj_${key}`;
    if (objKey !== key && scene.textures.exists(objKey)) {
      return objKey;
    }
    generateFallbackObjectTexture(scene, key, widthPx, heightPx);
    return key;
  }

  const texKey = pixelTextureKey(key, widthPx, heightPx, pixels);
  if (scene.textures.exists(texKey)) return texKey;

  const canvas = scene.textures.createCanvas(texKey, widthPx, heightPx);
  if (!canvas) return key;
  const ctx = canvas.getContext();
  ctx.clearRect(0, 0, widthPx, heightPx);
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < widthPx; x++) {
      const color = pixels[y * widthPx + x] ?? MAP_TRANSPARENT_PIXEL;
      if (isTransparentPixel(color)) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  canvas.refresh();
  return texKey;
}

function generateFallbackObjectTexture(scene: Phaser.Scene, key: string, widthPx: number, heightPx: number): void {
  const g = scene.make.graphics({ x: 0, y: 0 });
  g.fillStyle(0x8844aa, 1);
  g.fillRect(2, 2, Math.max(4, widthPx - 4), Math.max(4, heightPx - 4));
  g.lineStyle(1, 0xffffff, 0.4);
  g.strokeRect(2, 2, Math.max(4, widthPx - 4), Math.max(4, heightPx - 4));
  g.generateTexture(key, widthPx, heightPx);
  g.destroy();
}

export function mapSpriteTextureKey(spriteRef: string, widthPx: number, heightPx: number, pixels?: string[]): string {
  if (!pixels?.length) return spriteRef;
  return pixelTextureKey(spriteRef, widthPx, heightPx, pixels);
}

/** Drop cached pixel textures before rebuilding a map (avoids stale art after live updates). */
export function evictMapSpritePixelTextures(scene: Phaser.Scene): void {
  for (const key of scene.textures.getTextureKeys()) {
    if (key.includes('__px__')) scene.textures.remove(key);
  }
}
