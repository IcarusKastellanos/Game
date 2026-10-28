/**
 * Local item-icon cache. Server `/api/content/all` (admin → DB → registry) is authoritative;
 * this store only speeds redraws and must never override fresher server pixels.
 */

import {
  ICON_PIXEL_COUNT,
  ICON_PIXEL_SIZE,
  computeIconManifestRevision,
  getIngredientIconHash,
  hashIconPixels,
  resolveItemIconPixels,
} from '@witchcraft/shared';

/** Bump when authority rules change so old local overrides are discarded. */
const ASSET_STORE_KEY = 'witchcraft_icon_assets_v4';

const ICON_SIZE = ICON_PIXEL_SIZE;
const PIXEL_ART_SIZE = ICON_PIXEL_SIZE;

interface StoredIconAsset {
  hash: string;
  dataUrl: string;
  iconPixels: string[];
}

interface IconAssetStore {
  revision: string;
  items: Record<string, StoredIconAsset>;
}

function loadStore(): IconAssetStore {
  try {
    return JSON.parse(localStorage.getItem(ASSET_STORE_KEY) ?? '{"revision":"","items":{}}') as IconAssetStore;
  } catch {
    return { revision: '', items: {} };
  }
}

function saveStore(store: IconAssetStore): void {
  localStorage.setItem(ASSET_STORE_KEY, JSON.stringify(store));
}

function renderPixelsToDataUrl(pixels: string[]): string {
  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1a1025';
  ctx.fillRect(0, 0, ICON_SIZE, ICON_SIZE);
  const scale = ICON_SIZE / PIXEL_ART_SIZE;
  for (let y = 0; y < PIXEL_ART_SIZE; y++) {
    for (let x = 0; x < PIXEL_ART_SIZE; x++) {
      ctx.fillStyle = pixels[y * PIXEL_ART_SIZE + x] ?? '#1a1025';
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return canvas.toDataURL('image/png');
}

function storeAsset(
  store: IconAssetStore,
  itemId: string,
  iconPixels: string[],
  hash?: string
): void {
  const h = hash ?? hashIconPixels(iconPixels);
  store.items[itemId] = {
    hash: h,
    iconPixels: [...iconPixels],
    dataUrl: renderPixelsToDataUrl(iconPixels),
  };
}

export function getCachedIconDataUrl(itemId: string, expectedHash?: string): string | null {
  const entry = loadStore().items[itemId];
  if (!entry) return null;
  if (expectedHash && entry.hash !== expectedHash) return null;
  return entry.dataUrl;
}

export function getCachedIconPixels(itemId: string): string[] | null {
  return loadStore().items[itemId]?.iconPixels ?? null;
}

export function cacheIconLocally(
  itemId: string,
  iconPixels: string[],
  hash?: string
): string {
  const store = loadStore();
  storeAsset(store, itemId, iconPixels, hash);
  saveStore(store);
  return store.items[itemId]!.dataUrl;
}

/**
 * Adopt icons from the live content bundle (admin saves → DB → /api/content/all).
 * Always trusts the server payload; refreshes the local cache to match.
 */
export async function verifyItemIconsOncePerLogin(
  ingredients: { id: string; category: string; name: string; iconPixels?: string[] }[]
): Promise<void> {
  const store = loadStore();
  const hashes: Record<string, string> = {};

  for (const ing of ingredients) {
    const pixels = resolveItemIconPixels(ing);
    ing.iconPixels = pixels;
    const hash = getIngredientIconHash({ ...ing, iconPixels: pixels });
    hashes[ing.id] = hash;
    const cached = store.items[ing.id];
    if (!cached || cached.hash !== hash || cached.iconPixels?.length !== ICON_PIXEL_COUNT) {
      storeAsset(store, ing.id, pixels, hash);
    }
  }

  store.revision = computeIconManifestRevision(hashes);
  saveStore(store);
}

export function clearIconVerifySession(): void {
  /* no session gate — server icons win on every content load */
}
