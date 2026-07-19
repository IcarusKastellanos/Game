import type {
  ContentHexagramRecipe,
  HexagramEnchantPayload,
  HexagramPreviewStats,
} from '@witchcraft/shared';
import {
  calculateHexagramPreview,
  validateHexagramSockets,
  MAX_POCKET_SPELLS,
  POCKET_SPELL_IDS,
  type PocketSpellId,
  addItemToInventory,
  hasItemInInventory,
  removeItemFromInventory,
  type InventorySlot,
  type ItemCategory,
  type PlayerProgression,
  type PlayerStats,
  type AuraState,
  computeBindingCastPenalty,
} from '@witchcraft/shared';
import { contentRegistry } from '../content/registry.js';
import { getEnchantKnotMetadata } from './enchant-system.js';

export interface HexagramEnchantResult {
  ok: boolean;
  error?: string;
  message?: string;
  inventory?: InventorySlot[];
  progression?: PlayerProgression;
  stats?: PlayerStats;
  preview?: HexagramPreviewStats;
  unstable?: boolean;
}

export class HexagramEnchantSystem {
  recipes = new Map<string, ContentHexagramRecipe>();

  loadFromJson(recipes: ContentHexagramRecipe[]): void {
    this.recipes.clear();
    for (const r of recipes) this.recipes.set(r.id, r);
  }

  listKnown(progression: PlayerProgression): ContentHexagramRecipe[] {
    return [...this.recipes.values()].filter((r) => progression.discoveredRecipes.includes(r.id));
  }

  preview(
    recipeId: string,
    payload: Pick<HexagramEnchantPayload, 'sockets' | 'augmentations'>,
    stats: PlayerStats
  ): HexagramPreviewStats | null {
    const recipe = this.recipes.get(recipeId);
    if (!recipe) return null;
    const categories = this.itemCategoryMap();
    return calculateHexagramPreview(recipe, payload.sockets, payload.augmentations, categories, stats as unknown as Record<string, number>);
  }

  enchant(
    payload: HexagramEnchantPayload,
    inventory: InventorySlot[],
    progression: PlayerProgression,
    stats: PlayerStats,
    casterAura?: AuraState
  ): HexagramEnchantResult {
    const recipe = this.recipes.get(payload.recipeId);
    if (!recipe) return { ok: false, error: 'Unknown enchantment.' };
    if (!progression.discoveredRecipes.includes(recipe.id)) {
      return { ok: false, error: 'Enchantment not yet discovered.' };
    }

    const categories = this.itemCategoryMap();
    const validation = validateHexagramSockets(recipe, payload.sockets, categories);
    if (!validation.ok) {
      return {
        ok: false,
        error: validation.invalid.length
          ? 'Incorrect correspondence in the hexagram.'
          : 'The hexagram is incomplete.',
      };
    }

    const preview = calculateHexagramPreview(
      recipe,
      payload.sockets,
      payload.augmentations,
      categories,
      stats as unknown as Record<string, number>
    );

    if (recipe.meCost > stats.magicalEnergy) {
      return { ok: false, error: `Requires ${recipe.meCost} Magical Energy.` };
    }

    const toConsume = this.collectItems(recipe, payload);
    for (const { itemId, quantity } of toConsume) {
      if (!hasItemInInventory(inventory, itemId, quantity)) {
        const name = contentRegistry.ingredients.get(itemId)?.name ?? itemId;
        return { ok: false, error: `Need ${quantity}× ${name}.` };
      }
    }

    const roll = Math.random() * 100;
    const bindingPenalty = computeBindingCastPenalty(casterAura);
    const failThreshold = preview.failureChance + bindingPenalty * 0.85;
    const backlashThreshold = preview.backlashChance + bindingPenalty * 0.35;

    let inv = inventory;
    for (const { itemId, quantity } of toConsume) {
      const removed = removeItemFromInventory(inv, itemId, quantity);
      if (!removed.ok) return { ok: false, error: 'Could not consume ingredients.' };
      inv = removed.inventory;
    }

    let prog = progression;
    let statsOut = { ...stats, magicalEnergy: stats.magicalEnergy - recipe.meCost };

    if (roll < failThreshold) {
      const destroyCount = Math.ceil(toConsume.length * (roll < backlashThreshold ? 0.5 : 0.25));
      return {
        ok: false,
        error: roll < backlashThreshold ? 'Magical backlash!' : 'The working fizzles.',
        message:
          roll < backlashThreshold
            ? bindingPenalty > 0
              ? 'The hexagram cracks — bindings on your spirit scatter the working. Some components are lost.'
              : 'The hexagram cracks — unstable energy scatters. Some components are lost.'
            : bindingPenalty > 0
              ? 'Bindings interfere — the enchantment fails to cohere. Ingredients are spent.'
              : 'The enchantment fails to cohere. Ingredients are spent.',
        inventory: inv,
        progression: prog,
        stats: statsOut,
        preview,
        unstable: roll < backlashThreshold,
      };
    }

    const unstable = preview.stability < 55;

    if (recipe.effect === 'pocket_spell') {
      if (!recipe.spellId || !(POCKET_SPELL_IDS as readonly string[]).includes(recipe.spellId)) {
        return { ok: false, error: 'Invalid pocket spell recipe.' };
      }
      if (prog.pocketSpells.length >= MAX_POCKET_SPELLS) {
        return { ok: false, error: `You can only hold ${MAX_POCKET_SPELLS} pocket spells at once.` };
      }
      const spell = contentRegistry.spells.get(recipe.spellId);
      const storedMe = recipe.meCost + Math.floor(preview.potencyBonus / 2);
      prog = {
        ...prog,
        pocketSpells: [
          ...prog.pocketSpells,
          {
            id: `pocket_${Date.now()}`,
            spellId: recipe.spellId as PocketSpellId,
            storedMe,
            preparedAt: Date.now(),
            craftStability: preview.stability,
            potencyBonus: preview.potencyBonus,
            craftPower: preview.power,
            unstable: unstable || preview.stability < 55,
          },
        ],
      };
      return {
        ok: true,
        message: unstable
          ? `Prepared pocket ${spell?.name ?? recipe.spellId} — the working feels unstable.`
          : `Prepared pocket ${spell?.name ?? recipe.spellId} (${storedMe} ME stored).`,
        inventory: inv,
        progression: prog,
        stats: statsOut,
        preview,
        unstable,
      };
    }

    if (recipe.effect === 'enchant_knot') {
      const intent = recipe.enchantIntent ?? 'familiar_protection';
      const meta = getEnchantKnotMetadata(intent);
      const bonus = Math.floor(preview.power / 10) + Math.floor(preview.potencyBonus / 3);
      inv = addItemToInventory(inv, 'familiar_knot', 1, {
        enchanted: true,
        enchantIntent: intent,
        strengthBonus: meta.strengthBonus + bonus,
        durationHours: meta.durationHours + Math.floor(preview.durationBonus / 4),
        enchantedAt: Date.now(),
      });
      return {
        ok: true,
        message: unstable
          ? 'The familiar knot hums — but the weave feels fragile.'
          : 'The familiar knot hums with woven intention.',
        inventory: inv,
        progression: prog,
        stats: statsOut,
        preview,
        unstable,
      };
    }

    if (recipe.output) {
      inv = addItemToInventory(inv, recipe.output.itemId, recipe.output.quantity);
      const name = contentRegistry.ingredients.get(recipe.output.itemId)?.name ?? recipe.output.itemId;
      return {
        ok: true,
        message: unstable
          ? `Created ${name}, though the charm wavers.`
          : `Created ${name}.`,
        inventory: inv,
        progression: prog,
        stats: statsOut,
        preview,
        unstable,
      };
    }

    return { ok: false, error: 'Recipe has no output.' };
  }

  private collectItems(
    recipe: ContentHexagramRecipe,
    payload: HexagramEnchantPayload
  ): { itemId: string; quantity: number }[] {
    const counts = new Map<string, number>();
    const add = (itemId: string, qty = 1) => counts.set(itemId, (counts.get(itemId) ?? 0) + qty);
    for (const req of recipe.sockets) {
      const id = payload.sockets[req.socket];
      if (id) add(id);
    }
    for (const aug of payload.augmentations) add(aug);
    return [...counts.entries()].map(([itemId, quantity]) => ({ itemId, quantity }));
  }

  private itemCategoryMap(): Record<string, ItemCategory | undefined> {
    const map: Record<string, ItemCategory | undefined> = {};
    for (const [id, ing] of contentRegistry.ingredients) {
      map[id] = ing.category as ItemCategory;
    }
    return map;
  }
}

export const hexagramEnchantSystem = new HexagramEnchantSystem();
