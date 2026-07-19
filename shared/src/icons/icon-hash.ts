import { ICON_PIXEL_COUNT } from './item-icon-pixels.js';

/** Stable hash for 16×16 icon pixel arrays (or "gen" when procedural). */
export function hashIconPixels(pixels: string[] | undefined | null): string {
  if (!pixels?.length) return 'gen';
  let h = 2166136261;
  for (const px of pixels) {
    for (let i = 0; i < px.length; i++) {
      h ^= px.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return (h >>> 0).toString(36);
}

export function getIngredientIconHash(item: {
  id: string;
  iconPixels?: string[];
}): string {
  if (item.iconPixels?.length === ICON_PIXEL_COUNT) return hashIconPixels(item.iconPixels);
  return `gen:${item.id}`;
}

export function computeIconManifestRevision(hashes: Record<string, string>): string {
  const keys = Object.keys(hashes).sort();
  let h = 2166136261;
  for (const key of keys) {
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const val = hashes[key] ?? '';
    for (let i = 0; i < val.length; i++) {
      h ^= val.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return (h >>> 0).toString(36);
}
