import type { AuraEffect, FamiliarState, InventorySlot, PlayerStats } from '@witchcraft/shared';
import { contentRegistry } from '../content/registry.js';
import { inventorySystem } from './inventory-ward-aura.js';
import { readEnchantedKnotMetadata } from './enchant-system.js';

const XP_PER_LEVEL = 100;
const BOND_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const HEAL_ME_COST = 3;
const FEED_ITEM = 'familiar_food';
const PROTECT_ITEM = 'familiar_knot';

export interface CareContext {
  stats: PlayerStats;
  inventory: InventorySlot[];
}

export interface CareResult {
  ok: boolean;
  error?: string;
  familiar?: FamiliarState;
  stats?: PlayerStats;
  inventory?: InventorySlot[];
}

/** Familiar care, XP, leveling, and stat bonuses */
export class FamiliarSystem {
  createFromTemplate(
    templateId: string,
    ownerId: string,
    trueName: string,
    publicName: string
  ): FamiliarState | null {
    const template = contentRegistry.familiars.get(templateId);
    if (!template) return null;

    const mainFunction = this.mainFunctionForTemplate(templateId);
    return {
      id: `fam_${ownerId}_${Date.now()}`,
      species: template.species,
      templateId,
      publicName,
      trueName,
      hunger: 80,
      affection: 50,
      energy: 70,
      spiritualStability: 60,
      loyalty: 50,
      experience: 0,
      level: 1,
      mainFunction,
      chosen: true,
      ownerId,
      protections: [],
    };
  }

  mainFunctionForTemplate(templateId: string): string {
    const map: Record<string, string> = {
      cat_familiar: 'magicalEnergy',
      owl_familiar: 'divinationSkill',
      frog_familiar: 'herbalism',
      rat_familiar: 'health',
      snake_familiar: 'cursecraft',
    };
    return map[templateId] ?? 'ritualSkill';
  }

  applyBonuses(stats: PlayerStats, familiar: FamiliarState): PlayerStats {
    const template = [...contentRegistry.familiars.values()].find((f) => f.species === familiar.species);
    if (!template?.statBonuses) return stats;

    const updated = { ...stats };
    for (const [key, val] of Object.entries(template.statBonuses)) {
      const k = key as keyof PlayerStats;
      if (typeof updated[k] === 'number') {
        (updated[k] as number) += val ?? 0;
      }
    }
    const mainKey = familiar.mainFunction as keyof PlayerStats;
    if (typeof updated[mainKey] === 'number') {
      (updated[mainKey] as number) += familiar.level;
    }
    return updated;
  }

  /** Reverse applyBonuses — persist base stats only, not familiar runtime bonuses */
  stripBonuses(stats: PlayerStats, familiar: FamiliarState): PlayerStats {
    const template = [...contentRegistry.familiars.values()].find((f) => f.species === familiar.species);
    if (!template?.statBonuses) return stats;

    const updated = { ...stats };
    for (const [key, val] of Object.entries(template.statBonuses)) {
      const k = key as keyof PlayerStats;
      if (typeof updated[k] === 'number') {
        (updated[k] as number) = Math.max(0, (updated[k] as number) - (val ?? 0));
      }
    }
    const mainKey = familiar.mainFunction as keyof PlayerStats;
    if (typeof updated[mainKey] === 'number') {
      (updated[mainKey] as number) = Math.max(0, (updated[mainKey] as number) - familiar.level);
    }
    return updated;
  }

  getEffortReduction(familiar: FamiliarState, spellCategory: string, assistEnabled = true): number {
    if (!assistEnabled || !familiar.chosen) return 0;
    if (familiar.hunger < 20 || familiar.loyalty < 30) return 0;
    if (familiar.templateId === 'cat_familiar') return 4;
    if (
      familiar.templateId === 'snake_familiar' &&
      (spellCategory === 'baneful' || spellCategory === 'binding')
    ) {
      return 7;
    }
    return 0;
  }

  /** Whether this familiar can assist the given spell when toggled on */
  canAssistSpell(familiar: FamiliarState, spellCategory: string, familiarInteractions?: string[]): boolean {
    if (!familiar.chosen) return false;
    if (familiar.templateId === 'cat_familiar' || familiar.templateId === 'snake_familiar') return true;
    if (!familiarInteractions?.length) return false;
    const key = familiar.templateId.replace('_familiar', '_boost');
    return familiarInteractions.includes(key);
  }

  getCastingBonus(familiar: FamiliarState, assistEnabled = true): number {
    if (!assistEnabled || !familiar.chosen) return 0;
    if (familiar.hunger < 20 || familiar.loyalty < 30) return 0;
    const healthAvg =
      (familiar.hunger + familiar.affection + familiar.energy + familiar.loyalty) / 4;
    return Math.floor(healthAvg / 10) + Math.floor(familiar.level / 2);
  }

  grantExperience(familiar: FamiliarState, amount: number, context?: string): FamiliarState {
    let updated = { ...familiar, experience: familiar.experience + amount };
    while (updated.experience >= XP_PER_LEVEL * updated.level) {
      updated = this.levelUp(updated);
    }
    if (context) {
      updated.affection = Math.min(100, updated.affection + 1);
    }
    return updated;
  }

  levelUp(familiar: FamiliarState): FamiliarState {
    return {
      ...familiar,
      level: familiar.level + 1,
      experience: familiar.experience - XP_PER_LEVEL * familiar.level,
    };
  }

  care(familiar: FamiliarState, action: 'feed' | 'bond' | 'heal' | 'protect', ctx: CareContext): CareResult {
    let inventory = ctx.inventory;
    let stats = { ...ctx.stats };
    let updated: FamiliarState = {
      ...familiar,
      protections: [...(familiar.protections ?? [])],
    };

    switch (action) {
      case 'feed': {
        const removed = inventorySystem.removeItem(inventory, FEED_ITEM, 1);
        if (!removed.ok) return { ok: false, error: 'Requires Familiar Food.' };
        inventory = removed.inventory;
        updated.hunger = Math.min(100, updated.hunger + 20);
        updated = this.grantExperience(updated, 3, action);
        break;
      }
      case 'bond': {
        const last = updated.lastBondAt ?? 0;
        const remaining = BOND_COOLDOWN_MS - (Date.now() - last);
        if (remaining > 0) {
          const hrs = Math.ceil(remaining / (60 * 60 * 1000));
          return { ok: false, error: `Bonding requires rest — try again in ~${hrs}h.` };
        }
        updated.affection = Math.min(100, updated.affection + 10);
        updated.loyalty = Math.min(100, updated.loyalty + 4);
        updated.lastBondAt = Date.now();
        updated = this.grantExperience(updated, 5, action);
        break;
      }
      case 'heal': {
        if (stats.magicalEnergy < HEAL_ME_COST) {
          return { ok: false, error: `Heal costs ${HEAL_ME_COST} Magical Energy.` };
        }
        stats.magicalEnergy -= HEAL_ME_COST;
        updated.energy = Math.min(100, updated.energy + 1);
        updated.spiritualStability = Math.min(100, updated.spiritualStability + 1);
        updated = this.grantExperience(updated, 2, action);
        break;
      }
      case 'protect': {
        const knotSlot = inventory.find((s) => s.itemId === PROTECT_ITEM && s.quantity > 0);
        const removed = inventorySystem.removeItem(inventory, PROTECT_ITEM, 1);
        if (!removed.ok) return { ok: false, error: 'Requires a Familiar Knot.' };
        inventory = removed.inventory;
        const meta = knotSlot?.metadata as Record<string, unknown> | undefined;
        const { strength, durationMs } = readEnchantedKnotMetadata(meta);
        const protection: AuraEffect = {
          id: `fprot_${Date.now()}`,
          type: 'protection',
          name: meta?.enchanted ? 'Enchanted Knot Ward' : 'Knot Ward',
          strength,
          expiresAt: Date.now() + durationMs,
        };
        updated.protections = [...(updated.protections ?? []), protection].slice(-5);
        updated.spiritualStability = Math.min(100, updated.spiritualStability + 5);
        updated.loyalty = Math.min(100, updated.loyalty + 2);
        updated = this.grantExperience(updated, 4, action);
        break;
      }
    }

    return { ok: true, familiar: updated, stats, inventory };
  }

  tick(familiar: FamiliarState): FamiliarState {
    const now = Date.now();
    const protections = (familiar.protections ?? []).filter((p) => !p.expiresAt || p.expiresAt > now);
    return {
      ...familiar,
      protections,
      hunger: Math.max(0, familiar.hunger - 0.5),
      affection: Math.max(0, familiar.affection - 0.1),
      energy: Math.max(0, familiar.energy - 0.2),
    };
  }
}

export const familiarSystem = new FamiliarSystem();
