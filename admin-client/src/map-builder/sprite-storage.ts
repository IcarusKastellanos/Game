/** Read/write custom sprite pixel arrays on map builder assets. */

export const SPRITE_PIXELS_KEY = 'spritePixels';

export function getSpritePixels(properties: unknown): string[] | undefined {
  if (!properties || typeof properties !== 'object') return undefined;
  const px = (properties as Record<string, unknown>)[SPRITE_PIXELS_KEY];
  if (!Array.isArray(px) || !px.length) return undefined;
  return px.map(String);
}

export function withSpritePixels(
  properties: Record<string, unknown> | undefined,
  pixels: string[] | undefined
): Record<string, unknown> {
  const base = { ...(properties ?? {}) };
  if (!pixels?.length) {
    delete base[SPRITE_PIXELS_KEY];
    return base;
  }
  base[SPRITE_PIXELS_KEY] = pixels;
  return base;
}

export function getTilesetSprites(data: unknown): Record<string, string[]> {
  if (!data || typeof data !== 'object') return {};
  const sprites = (data as Record<string, unknown>).sprites;
  if (!sprites || typeof sprites !== 'object') return {};
  const out: Record<string, string[]> = {};
  for (const [key, val] of Object.entries(sprites as Record<string, unknown>)) {
    if (Array.isArray(val) && val.length) out[key] = val.map(String);
  }
  return out;
}

export function setTilesetSprite(
  data: Record<string, unknown> | undefined,
  spriteKey: string,
  pixels: string[] | undefined
): Record<string, unknown> {
  const base = { ...(data ?? {}) };
  const sprites = { ...getTilesetSprites(base) };
  const key = spriteKey.trim();
  if (!key || !pixels?.length) {
    if (key) delete sprites[key];
  } else {
    sprites[key] = pixels;
  }
  if (Object.keys(sprites).length) base.sprites = sprites;
  else delete base.sprites;
  return base;
}

export function mapCategoryFillColor(category: string): string {
  const map: Record<string, string> = {
    floor: '#8b6914',
    wall: '#8b5a3c',
    ground: '#5a9e4b',
    altar: '#4a0080',
    bed: '#6b4c8a',
    counter: '#884422',
    shelf: '#8b6914',
    decoration: '#7b5ea7',
    default: '#7b5ea7',
  };
  return map[category] ?? map.default;
}
