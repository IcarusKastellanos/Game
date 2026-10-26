import type { ContentHexagramRecipe, ContentQuest, ContentRecipe, ContentShop, ContentSpell, LevelDocument } from '@witchcraft/shared';
import { normalizeLevelDocument } from '@witchcraft/shared';
import { contentRegistry } from './registry.js';
import { readContentJson, readContentObject, writeContentJson, writeContentObject } from './json-persist.js';

type UnlockBucket = 'spellIds' | 'recipeIds' | 'hexagramIds' | 'shopItemIds' | 'questIds';

function unlockMap(doc: LevelDocument, bucket: UnlockBucket): Map<string, number> {
  const map = new Map<string, number>();
  for (const level of doc.levels) {
    for (const id of level[bucket]) {
      if (!map.has(id)) map.set(id, level.level);
    }
  }
  return map;
}

function syncListMinLevel<T extends { id: string; minLevel?: number }>(
  filename: string,
  doc: LevelDocument,
  bucket: UnlockBucket
): void {
  const list = readContentJson<T>(filename);
  const map = unlockMap(doc, bucket);
  const next = list.map((row) => ({ ...row, minLevel: map.get(row.id) ?? 1 }));
  writeContentJson(filename, next);
}

function syncShopListings(doc: LevelDocument): void {
  const map = unlockMap(doc, 'shopItemIds');
  const shops = readContentJson<ContentShop>('shops.json');
  const next = shops.map((shop) => ({
    ...shop,
    inventory: shop.inventory.map((listing) => {
      const min = map.get(listing.itemId);
      if (min == null) {
        const { minLevel: _drop, ...rest } = listing;
        return rest;
      }
      return { ...listing, minLevel: min };
    }),
  }));
  writeContentJson('shops.json', next);
}

function syncCurveFile(doc: LevelDocument): void {
  const curve = readContentObject<Record<string, unknown>>('progression/level-curve.json') ?? {};
  curve.maxLevel = doc.maxLevel;
  curve.xpPerLevel = doc.xpPerLevel;
  curve.onLevelUp = doc.levels
    .filter((level) => level.level > 1 && level.unlockMessage.trim())
    .map((level) => ({
      atLevel: level.level,
      eventId: `level_up_${level.level}`,
      message: level.unlockMessage.trim(),
    }));
  writeContentObject('progression/level-curve.json', curve);
}

/** Persist the level document and push unlocks into spell/recipe/shop/quest content. */
export function saveLevelDocument(raw: unknown): LevelDocument {
  // normalizeLevelDocument drops legacy keys (e.g. familiarIds) and enforces exclusive unlocks.
  const doc = normalizeLevelDocument(raw);
  writeContentObject('progression/levels.json', doc);
  syncCurveFile(doc);
  syncListMinLevel<ContentSpell>('spells.json', doc, 'spellIds');
  syncListMinLevel<ContentRecipe>('recipes.json', doc, 'recipeIds');
  syncListMinLevel<ContentHexagramRecipe>('hexagram-recipes.json', doc, 'hexagramIds');
  syncListMinLevel<ContentQuest>('quests.json', doc, 'questIds');
  syncShopListings(doc);
  contentRegistry.load();
  return doc;
}
