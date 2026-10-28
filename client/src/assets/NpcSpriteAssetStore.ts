/** Persistent local NPC sprite assets + one verify sync per login session */

import {
  NPC_PORTRAIT_PIXEL_COUNT,
  hashIconPixels,
  normalizeNpcAuthoredSpriteSheet,
  type NpcAuthoredSpriteSheet,
} from '@witchcraft/shared';

const ASSET_STORE_KEY = 'witchcraft_npc_sprites_v3';
const SESSION_VERIFY_KEY = 'witchcraft_npc_sprites_verified';

interface StoredSpriteAsset {
  hash: string;
  spritePixels?: string[];
  spriteSheet?: NpcAuthoredSpriteSheet;
}

interface SpriteAssetStore {
  revision: string;
  items: Record<string, StoredSpriteAsset>;
}

type ClientNpcLike = {
  id: string;
  spritePixels?: string[];
  spriteHash?: string;
  spriteSheet?: NpcAuthoredSpriteSheet;
};

function loadStore(): SpriteAssetStore {
  try {
    return JSON.parse(localStorage.getItem(ASSET_STORE_KEY) ?? '{"revision":"","items":{}}') as SpriteAssetStore;
  } catch {
    return { revision: '', items: {} };
  }
}

function saveStore(store: SpriteAssetStore): void {
  localStorage.setItem(ASSET_STORE_KEY, JSON.stringify(store));
}

export async function verifyNpcSpritesOncePerLogin(npcs: ClientNpcLike[]): Promise<void> {
  if (sessionStorage.getItem(SESSION_VERIFY_KEY) === '1') {
    applyLocalAssets(npcs);
    return;
  }

  const store = loadStore();
  const clientHashes: Record<string, string> = {};
  for (const npc of npcs) {
    const local = store.items[npc.id];
    clientHashes[npc.id] =
      local?.hash ??
      npc.spriteHash ??
      (npc.spritePixels?.length === NPC_PORTRAIT_PIXEL_COUNT ? hashIconPixels(npc.spritePixels) : `gen:${npc.id}`);
  }

  try {
    const res = await fetch('/api/content/npc-sprites/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: clientHashes }),
    });
    if (!res.ok) throw new Error(`verify failed ${res.status}`);
    const data = (await res.json()) as {
      revision: string;
      updates: Record<
        string,
        { hash: string; spritePixels?: string[]; spriteSheet?: NpcAuthoredSpriteSheet }
      >;
    };
    store.revision = data.revision ?? store.revision;
    for (const [npcId, payload] of Object.entries(data.updates ?? {})) {
      const sheet = normalizeNpcAuthoredSpriteSheet(payload.spriteSheet);
      store.items[npcId] = {
        hash: payload.hash,
        ...(payload.spritePixels?.length === NPC_PORTRAIT_PIXEL_COUNT ? { spritePixels: payload.spritePixels } : {}),
        ...(sheet ? { spriteSheet: sheet } : {}),
      };
      const npc = npcs.find((row) => row.id === npcId);
      if (npc) {
        if (payload.spritePixels?.length === NPC_PORTRAIT_PIXEL_COUNT) npc.spritePixels = payload.spritePixels;
        if (sheet) npc.spriteSheet = sheet;
        npc.spriteHash = payload.hash;
      }
    }
    applyLocalAssets(npcs);
    saveStore(store);
  } catch (err) {
    console.warn('[NpcSpriteAssetStore] verify failed, using bootstrap pixels:', err);
    applyLocalAssets(npcs);
  }

  sessionStorage.setItem(SESSION_VERIFY_KEY, '1');
}

function applyLocalAssets(npcs: ClientNpcLike[]): void {
  const store = loadStore();
  for (const npc of npcs) {
    const cached = store.items[npc.id];
    if (cached) {
      const sheet = normalizeNpcAuthoredSpriteSheet(cached.spriteSheet);
      if (
        cached.spritePixels?.length === NPC_PORTRAIT_PIXEL_COUNT &&
        (!npc.spriteHash || cached.hash === npc.spriteHash || !npc.spritePixels?.length)
      ) {
        npc.spritePixels = cached.spritePixels;
      }
      if (sheet && (!npc.spriteHash || cached.hash === npc.spriteHash || !npc.spriteSheet)) {
        npc.spriteSheet = sheet;
      }
      if (cached.hash) npc.spriteHash = cached.hash;
    } else if (npc.spritePixels?.length === NPC_PORTRAIT_PIXEL_COUNT || normalizeNpcAuthoredSpriteSheet(npc.spriteSheet)) {
      store.items[npc.id] = {
        hash: npc.spriteHash ?? hashIconPixels(npc.spritePixels),
        ...(npc.spritePixels?.length === NPC_PORTRAIT_PIXEL_COUNT ? { spritePixels: npc.spritePixels } : {}),
        ...(normalizeNpcAuthoredSpriteSheet(npc.spriteSheet)
          ? { spriteSheet: normalizeNpcAuthoredSpriteSheet(npc.spriteSheet) }
          : {}),
      };
    }
  }
  saveStore(store);
}

export function clearNpcSpriteVerifySession(): void {
  sessionStorage.removeItem(SESSION_VERIFY_KEY);
}
