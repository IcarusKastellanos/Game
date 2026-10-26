import type { ContentRecipe, InventorySlot, PlayerProgression, PlayerStats, PocketSpell } from '@witchcraft/shared';
import {
  MAX_POCKET_SPELLS,
  POCKET_SPELL_IDS,
  type PocketSpellId,
  addItemToInventory,
  hasItemInInventory,
  removeItemFromInventory,
  meetsMinLevel,
  levelGateMessage,
  playerLevel,
} from '@witchcraft/shared';
import { contentRegistry } from '../content/registry.js';
import { getEnchantKnotMetadata } from './enchant-system.js';

export interface CraftResult {
  ok: boolean;
  error?: string;
  inventory?: InventorySlot[];
  progression?: PlayerProgression;
  stats?: PlayerStats;
  outputItemId?: string;
  message?: string;
}

function recipeMeCost(recipe: ContentRecipe, spellDifficulty?: number): number {
  if (recipe.meCost != null) return recipe.meCost;
  if (recipe.effect === 'pocket_spell') {
    return Math.max(5, Math.ceil((spellDifficulty ?? 10) / 2));
  }
  if (recipe.effect === 'enchant_knot') return 8;
  return 0;
}

export class CraftingSystem {
  recipes = new Map<string, ContentRecipe>();

  loadFromJson(recipes: ContentRecipe[]): void {
    this.recipes.clear();
    for (const r of recipes) this.recipes.set(r.id, r);
  }

  listKnownRecipes(progression: PlayerProgression, stationType?: string): ContentRecipe[] {
    return [...this.recipes.values()].filter(
      (r) =>
        progression.discoveredRecipes.includes(r.id) &&
        (!stationType || r.stationType === stationType)
    );
  }

  craft(
    recipeId: string,
    inventory: InventorySlot[],
    progression: PlayerProgression,
    stats: PlayerStats
  ): CraftResult {
    const recipe = this.recipes.get(recipeId);
    if (!recipe) return { ok: false, error: 'Unknown recipe.' };
    if (!progression.discoveredRecipes.includes(recipeId)) {
      return { ok: false, error: 'Recipe not yet discovered.' };
    }
    if (!meetsMinLevel(stats.experience ?? 0, recipe.minLevel)) {
      return {
        ok: false,
        error: levelGateMessage(recipe.name, recipe.minLevel ?? 1, playerLevel(stats.experience ?? 0)),
      };
    }

    const effect = recipe.effect ?? 'item';
    const spell =
      effect === 'pocket_spell' && recipe.spellId
        ? contentRegistry.spells.get(recipe.spellId)
        : undefined;
    const meCost = recipeMeCost(recipe, spell?.difficulty);

    if (meCost > 0 && stats.magicalEnergy < meCost) {
      return { ok: false, error: `Requires ${meCost} Magical Energy.` };
    }

    if (effect === 'pocket_spell') {
      if (!recipe.spellId || !(POCKET_SPELL_IDS as readonly string[]).includes(recipe.spellId)) {
        return { ok: false, error: 'Invalid pocket spell recipe.' };
      }
      if (progression.pocketSpells.length >= MAX_POCKET_SPELLS) {
        return { ok: false, error: `You can only hold ${MAX_POCKET_SPELLS} pocket spells at once.` };
      }
    }

    for (const input of recipe.inputs) {
      if (!hasItemInInventory(inventory, input.itemId, input.quantity)) {
        const name = contentRegistry.ingredients.get(input.itemId)?.name ?? input.itemId;
        return { ok: false, error: `Need ${input.quantity}× ${name}.` };
      }
    }

    let inv = inventory;
    for (const input of recipe.inputs) {
      const removed = removeItemFromInventory(inv, input.itemId, input.quantity);
      if (!removed.ok) return { ok: false, error: 'Could not consume ingredients.' };
      inv = removed.inventory;
    }

    let prog = progression;
    let statsOut = stats;

    if (effect === 'pocket_spell' && recipe.spellId) {
      const pocket: PocketSpell = {
        id: `pocket_${Date.now()}`,
        spellId: recipe.spellId as PocketSpellId,
        storedMe: meCost,
        preparedAt: Date.now(),
        craftStability: 65,
      };
      prog = { ...prog, pocketSpells: [...prog.pocketSpells, pocket] };
      statsOut = { ...statsOut, magicalEnergy: statsOut.magicalEnergy - meCost };
      return {
        ok: true,
        inventory: inv,
        progression: prog,
        stats: statsOut,
        message: `Prepared pocket ${spell?.name ?? recipe.spellId} (${meCost} ME stored).`,
      };
    }

    if (effect === 'enchant_knot') {
      const intent = recipe.enchantIntent ?? 'familiar_protection';
      const meta = getEnchantKnotMetadata(intent);
      inv = addItemToInventory(inv, 'familiar_knot', 1, {
        enchanted: true,
        enchantIntent: intent,
        strengthBonus: meta.strengthBonus,
        durationHours: meta.durationHours,
        enchantedAt: Date.now(),
      });
      statsOut = { ...statsOut, magicalEnergy: statsOut.magicalEnergy - meCost };
      return {
        ok: true,
        inventory: inv,
        progression: prog,
        stats: statsOut,
        outputItemId: 'familiar_knot',
        message: 'The familiar knot hums with woven intention.',
      };
    }

    if (!recipe.output) {
      return { ok: false, error: 'Recipe has no output.' };
    }

    inv = addItemToInventory(inv, recipe.output.itemId, recipe.output.quantity);

    if (recipe.discoverOnCraft) {
      const discovered = new Set(prog.discoveredCorrespondences);
      for (const input of recipe.inputs) discovered.add(input.itemId);
      discovered.add(recipe.output.itemId);
      prog = { ...prog, discoveredCorrespondences: [...discovered] };
    }

    return {
      ok: true,
      inventory: inv,
      progression: prog,
      stats: statsOut,
      outputItemId: recipe.output.itemId,
      message: `Crafted ${contentRegistry.ingredients.get(recipe.output.itemId)?.name ?? recipe.output.itemId}.`,
    };
  }

  /** Combine ingredients to discover a hidden recipe or correspondence */
  experiment(
    itemIds: string[],
    inventory: InventorySlot[],
    progression: PlayerProgression
  ): CraftResult {
    const sorted = [...itemIds].sort().join('+');
    const match = [...this.recipes.values()].find((r) => {
      const key = r.inputs.map((i) => i.itemId).sort().join('+');
      return key === sorted && !progression.discoveredRecipes.includes(r.id);
    });

    if (match) {
      const prog = {
        ...progression,
        discoveredRecipes: [...progression.discoveredRecipes, match.id],
        discoveredCorrespondences: [
          ...new Set([...progression.discoveredCorrespondences, ...itemIds]),
        ],
      };
      return {
        ok: true,
        inventory,
        progression: prog,
        message: `Discovered recipe: ${match.name}.`,
      };
    }

    const prog = {
      ...progression,
      discoveredCorrespondences: [
        ...new Set([...progression.discoveredCorrespondences, ...itemIds]),
      ],
    };
    return { ok: true, inventory, progression: prog, message: 'You note new correspondences in your journal.' };
  }
}

export const craftingSystem = new CraftingSystem();
