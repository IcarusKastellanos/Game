/** Transparent pixel token for map / item sprite editors */

export const MAP_TRANSPARENT_PIXEL = '#00000000';
export const SPRITE_PIXELS_KEY = 'spritePixels';

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
