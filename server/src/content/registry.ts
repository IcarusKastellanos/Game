import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ContentDecoration,
  ContentFamiliarTemplate,
  ContentIngredient,
  ContentMapDefinition,
  ContentNpc,
  ContentShop,
  ContentSpell,
  ContentTile,
  ContentQuest,
  ContentRecipe,
  ContentHexagramRecipe,
  MagicTradition,
} from '@witchcraft/shared';
import { setProgressionContent, getMaxPlayerLevel, findUnknownLevelUnlocks } from '@witchcraft/shared';
import { dialogueSystem, type DialogueTree } from '../systems/dialogue-system.js';
import { craftingSystem } from '../systems/crafting-system.js';
import { hexagramEnchantSystem } from '../systems/hexagram-enchant-system.js';
import { questSystem } from '../systems/quest-system.js';
import { shopSystem } from '../systems/shop-system.js';
import { applyCanonicalWorldMapsToRegistry, resolveMapForScene } from './canonical-maps.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = resolve(__dirname, '../../../content');

function loadJsonFile<T>(filename: string): T | null {
  const path = resolve(CONTENT_DIR, filename);
  if (!existsSync(path)) {
    console.warn(`[ContentRegistry] Missing ${filename}`);
    return null;
  }
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function loadJson<T>(filename: string): T[] {
  const data = loadJsonFile<T[]>(filename);
  return data ?? [];
}

/**
 * Central content registry — loads JSON at startup.
 * Admin routes can hot-reload; gameplay systems query here instead of hard-coding.
 */
export class ContentRegistry {
  ingredients = new Map<string, ContentIngredient>();
  spells = new Map<string, ContentSpell>();
  familiars = new Map<string, ContentFamiliarTemplate>();
  shops = new Map<string, ContentShop>();
  npcs = new Map<string, ContentNpc>();
  tiles = new Map<string, ContentTile>();
  decorations = new Map<string, ContentDecoration>();
  maps = new Map<string, ContentMapDefinition>();
  dialogues = new Map<string, DialogueTree>();
  spirits = new Map<string, { id: string; name: string; requiresLicense?: string; [key: string]: unknown }>();

  load(): void {
    this.ingredients.clear();
    this.spells.clear();
    this.familiars.clear();
    this.shops.clear();
    this.npcs.clear();
    this.tiles.clear();
    this.decorations.clear();
    this.maps.clear();
    this.dialogues.clear();
    this.spirits.clear();

    for (const item of loadJson<ContentIngredient>('ingredients.json')) {
      this.ingredients.set(item.id, item);
    }
    for (const spell of loadJson<ContentSpell>('spells.json')) {
      this.spells.set(spell.id, spell);
    }
    for (const fam of loadJson<ContentFamiliarTemplate>('familiars.json')) {
      this.familiars.set(fam.id, fam);
    }
    for (const shop of loadJson<ContentShop>('shops.json')) {
      this.shops.set(shop.id, shop);
    }
    shopSystem.captureBaselines(this.shops.values());
    for (const npc of loadJson<ContentNpc>('npcs.json')) {
      this.npcs.set(npc.id, npc);
    }
    for (const tile of loadJson<ContentTile>('tiles.json')) {
      this.tiles.set(tile.id, tile);
    }
    for (const dec of loadJson<ContentDecoration>('decorations.json')) {
      this.decorations.set(dec.id, dec);
    }
    for (const map of loadJson<ContentMapDefinition>('maps.json')) {
      this.maps.set(map.id, map);
    }
    for (const dlg of loadJson<DialogueTree>('dialogues.json')) {
      this.dialogues.set(dlg.id, dlg);
    }
    for (const spirit of loadJson<{ id: string; name: string; requiresLicense?: string }>('spirits.json')) {
      this.spirits.set(spirit.id, spirit);
    }
    craftingSystem.loadFromJson(loadJson<ContentRecipe>('recipes.json'));
    hexagramEnchantSystem.loadFromJson(loadJson<ContentHexagramRecipe>('hexagram-recipes.json'));
    questSystem.loadFromJson(loadJson<ContentQuest>('quests.json'));
    dialogueSystem.loadFromJson([...this.dialogues.values()]);

    setProgressionContent({
      statsJson: loadJsonFile('progression/stats.json'),
      statLabelsJson: loadJsonFile('progression/stat-labels.json'),
      focusWeightsJson: loadJsonFile('progression/focus-weights.json'),
      booksJson: loadJsonFile('books.json'),
      reputationPublicJson: loadJsonFile('progression/reputation-public.json'),
      reputationSpiritualJson: loadJsonFile('progression/reputation-spiritual.json'),
      xpSourcesJson: loadJsonFile('progression/xp-sources.json'),
      levelCurveJson: loadJsonFile('progression/level-curve.json'),
      levelProfilesJson: loadJsonFile('progression/levels.json'),
      recognitionTiersJson: loadJsonFile('progression/recognition-tiers.json'),
      licensesJson: loadJsonFile('progression/licenses.json'),
    });

    this.validateLevelGates();
    this.validateLevelUnlockCatalog();

    console.log(
      `[ContentRegistry] Loaded ${this.spells.size} spells, ${this.ingredients.size} ingredients, ${this.maps.size} maps, ${this.dialogues.size} dialogues, ${craftingSystem.recipes.size} recipes, ${hexagramEnchantSystem.recipes.size} hexagram recipes, ${questSystem.quests.size} quests`
    );
  }

  /** Warn on missing/out-of-range minLevel fields so content stays gateable. */
  private validateLevelGates(): void {
    const max = getMaxPlayerLevel();
    const warn = (kind: string, id: string, minLevel: number | undefined) => {
      if (minLevel == null) {
        console.warn(`[ContentRegistry] ${kind} ${id} has no minLevel — defaulting to open (Level 1).`);
        return;
      }
      if (minLevel < 1 || minLevel > max) {
        console.warn(`[ContentRegistry] ${kind} ${id} minLevel=${minLevel} outside 1…${max}`);
      }
    };
    for (const spell of this.spells.values()) warn('spell', spell.id, spell.minLevel);
    for (const recipe of craftingSystem.recipes.values()) warn('recipe', recipe.id, recipe.minLevel);
    for (const recipe of hexagramEnchantSystem.recipes.values()) {
      warn('hexagram', recipe.id, recipe.minLevel);
    }
    for (const quest of questSystem.quests.values()) warn('quest', quest.id, quest.minLevel);
  }

  /** Warn when levels.json references ids that are not in live content. */
  private validateLevelUnlockCatalog(): void {
    const shopItemIds = new Set<string>();
    for (const shop of this.shops.values()) {
      for (const listing of shop.inventory) shopItemIds.add(listing.itemId);
    }
    const unknown = findUnknownLevelUnlocks({
      spellIds: new Set(this.spells.keys()),
      recipeIds: new Set(craftingSystem.recipes.keys()),
      hexagramIds: new Set(hexagramEnchantSystem.recipes.keys()),
      shopItemIds,
      npcIds: new Set(this.npcs.keys()),
      questIds: new Set(questSystem.quests.keys()),
    });
    for (const row of unknown) {
      console.warn(
        `[ContentRegistry] levels.json ${row.bucket} lists unknown id "${row.id}" at level ${row.level}`
      );
    }
  }

  /** Overlay DB-published maps, then restore canonical town/apartment templates. */
  async mergePublishedMaps(): Promise<number> {
    const { mergePublishedMapsIntoRegistry } = await import('../admin/services/map-builder/index.js');
    const merged = await mergePublishedMapsIntoRegistry();
    applyCanonicalWorldMapsToRegistry(this);
    return merged;
  }

  /** Force canonical world templates from maps.json into the live registry. */
  applyCanonicalWorldMaps(): number {
    return applyCanonicalWorldMapsToRegistry(this);
  }

  getSpellsByTradition(tradition: MagicTradition): ContentSpell[] {
    return [...this.spells.values()].filter((s) => s.tradition === tradition);
  }

  getMapForScene(sceneId: string): ContentMapDefinition | undefined {
    return resolveMapForScene(this.maps.values(), sceneId);
  }
}

export const contentRegistry = new ContentRegistry();
