/** Persistent local item icon assets + one verify sync per login session */

import {
  getIngredientIconHash,
  hashIconPixels,
  resolveItemIconPixels,
  type ContentIngredient,
} from '@witchcraft/shared';

const ASSET_STORE_KEY = 'witchcraft_icon_assets_v1';
const SESSION_VERIFY_KEY = 'witchcraft_icons_verified';

const ICON_SIZE = 32;
const PIXEL_ART_SIZE = 16;

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

/** Apply server updates to local store and game content ingredients */
export function applyIconUpdatesToContent(
  ingredients: { id: string; category: string; name: string; iconPixels?: string[] }[],
  updates: Record<string, { hash: string; iconPixels: string[] }>,
  revision: string
): void {
  const store = loadStore();
  store.revision = revision;

  for (const [itemId, payload] of Object.entries(updates)) {
    storeAsset(store, itemId, payload.iconPixels, payload.hash);
    const ing = ingredients.find((i) => i.id === itemId);
    if (ing) ing.iconPixels = payload.iconPixels;
  }

  for (const ing of ingredients) {
    const hash = getIngredientIconHash(ing);
    if (store.items[ing.id]?.hash === hash) {
      ing.iconPixels = store.items[ing.id].iconPixels;
      continue;
    }
    const pixels = resolveItemIconPixels(ing);
    if (!store.items[ing.id] || store.items[ing.id].hash !== hash) {
      storeAsset(store, ing.id, pixels, hash);
    }
    ing.iconPixels = pixels;
  }

  saveStore(store);
}

/** One POST per browser session after login — sync stale icons from server */
export async function verifyItemIconsOncePerLogin(
  ingredients: { id: string; category: string; name: string; iconPixels?: string[] }[]
): Promise<void> {
  if (sessionStorage.getItem(SESSION_VERIFY_KEY) === '1') {
    applyLocalAssetsToIngredients(ingredients);
    return;
  }

  const store = loadStore();
  const clientHashes: Record<string, string> = {};
  for (const ing of ingredients) {
    const local = store.items[ing.id];
    clientHashes[ing.id] = local?.hash ?? getIngredientIconHash(ing);
  }

  try {
    const res = await fetch('/api/content/icons/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: clientHashes }),
    });
    if (!res.ok) throw new Error(`verify failed ${res.status}`);
    const data = (await res.json()) as {
      revision: string;
      updates: Record<string, { hash: string; iconPixels: string[] }>;
    };
    applyIconUpdatesToContent(ingredients, data.updates ?? {}, data.revision ?? '');
  } catch (err) {
    console.warn('[ItemIconAssetStore] verify failed, using local/cache fallback:', err);
    applyLocalAssetsToIngredients(ingredients);
  }

  sessionStorage.setItem(SESSION_VERIFY_KEY, '1');
}

function applyLocalAssetsToIngredients(
  ingredients: { id: string; category: string; name: string; iconPixels?: string[] }[]
): void {
  const store = loadStore();
  for (const ing of ingredients) {
    const cached = store.items[ing.id];
    if (cached?.iconPixels?.length === 256) {
      ing.iconPixels = cached.iconPixels;
    } else if (!ing.iconPixels?.length) {
      ing.iconPixels = resolveItemIconPixels(ing);
    }
  }
}

export function clearIconVerifySession(): void {
  sessionStorage.removeItem(SESSION_VERIFY_KEY);
}
