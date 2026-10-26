import type {
  AltarState,
  ContentSpell,
  InventorySlot,
  PlayerStats,
  TaglockSelection,
  TaglockType,
} from '@witchcraft/shared';
import {
  HEX_INTENTS,
  TAGLOCK_STRENGTH,
  totalItemQuantity,
  levelFocusBonus,
  scalePotencyByLevel,
  calculateSpellFocus,
  getFocusWeights,
  getStatLabel,
  meetsMinLevel,
  levelGateMessage,
  playerLevel,
} from '@witchcraft/shared';
import { contentRegistry } from '../content/registry.js';
import { EVERWEED_INIT_ME_COST, EVERWEED_ITEM_ID, ritualHasEverweed } from './ward-feeding.js';

export interface CastContext {
  casterStats: PlayerStats;
  inventory: InventorySlot[];
  altar: AltarState;
  taglockType?: TaglockType;
  taglocks?: TaglockSelection[];
  targetProtection?: number;
  targetSelf?: boolean;
  familiarBonus?: number;
  effortReduction?: number;
  creatorId?: string;
  altarBuffs?: Record<string, number>;
  pentacleSlots?: { itemId: string; quantity: number }[];
  augmentSlots?: { itemId: string; quantity: number }[];
  hexIntents?: string[];
  magicOnly?: boolean;
  timing?: string;
  /** Added to focus difficulty from binding hexes on the caster. */
  bindingPenalty?: number;
}

export interface CastDiagnostics {
  code:
    | 'unknown_spell'
    | 'level_gate'
    | 'pentacle_overflow'
    | 'missing_ingredient'
    | 'insufficient_me'
    | 'missing_taglock'
    | 'missing_target'
    | 'focus_check'
    | 'magic_only_scatter';
  summary: string;
  difficultyRoll?: number;
  difficultyRequired?: number;
  missingIngredient?: string;
  meRequired?: number;
  meAvailable?: number;
  breakdown?: Record<string, number>;
}

export interface CastResult {
  success: boolean;
  potency: number;
  accuracy: number;
  message: string;
  consumedItems: { itemId: string; quantity: number }[];
  moralDelta: number;
  effects: Record<string, unknown>;
  detected?: boolean;
  diagnostics?: CastDiagnostics;
}

/**
 * Modular spell engine — ingredients, pentacle boosts, taglocks, magic-only casting.
 */
export class SpellEngine {
  cast(spellId: string, ctx: CastContext): CastResult {
    const spell = contentRegistry.spells.get(spellId);
    if (!spell) return this.fail('Unknown spell.', 'unknown_spell');

    if (!meetsMinLevel(ctx.casterStats.experience ?? 0, spell.minLevel)) {
      const current = playerLevel(ctx.casterStats.experience ?? 0);
      return this.fail(
        levelGateMessage(spell.name, spell.minLevel ?? 1, current),
        'level_gate'
      );
    }

    const consumed: { itemId: string; quantity: number }[] = [];

    if (ctx.magicOnly) {
      return this.castMagicOnly(spell, ctx);
    }

    const pentacleTypes = new Set((ctx.pentacleSlots ?? []).map((s) => s.itemId));
    if (pentacleTypes.size > 5) {
      return this.fail('The pentacle holds at most five ingredient types.', 'pentacle_overflow');
    }

    const ingredientCheck = this.validateIngredients(spell, ctx.inventory, ctx.pentacleSlots);
    if (!ingredientCheck.ok) {
      return this.fail(ingredientCheck.reason!, 'missing_ingredient', {
        missingIngredient: ingredientCheck.missingItemId,
      });
    }
    consumed.push(...ingredientCheck.consumed);

    if (ctx.augmentSlots?.length) {
      for (const aug of ctx.augmentSlots) {
        consumed.push({ itemId: aug.itemId, quantity: aug.quantity });
      }
    }

    const hasEverweed = ritualHasEverweed(ctx.pentacleSlots, ctx.augmentSlots);
    const isProtectionWork = spell.category === 'protection' || spell.category === 'warding';
    if (hasEverweed) {
      if (!isProtectionWork) {
        return this.fail('Everweed may only be added to protection or warding workings.', 'missing_ingredient');
      }
      const everweedOnPentacle = (ctx.pentacleSlots ?? []).find((s) => s.itemId === EVERWEED_ITEM_ID);
      if (everweedOnPentacle && !consumed.some((c) => c.itemId === EVERWEED_ITEM_ID)) {
        consumed.push({ itemId: EVERWEED_ITEM_ID, quantity: 1 });
      }
    }

    const meCost =
      spell.maintenanceCost +
      (ctx.pentacleSlots?.length ? 0 : 2) +
      (hasEverweed && isProtectionWork ? EVERWEED_INIT_ME_COST : 0);
    if (ctx.casterStats.magicalEnergy < meCost) {
      return this.fail('Not enough Magical Energy.', 'insufficient_me', {
        meRequired: meCost,
        meAvailable: ctx.casterStats.magicalEnergy,
      });
    }

    const taglock = this.resolveTaglock(spell, ctx);
    if (!taglock.satisfied) {
      return this.fail(
        taglock.message ?? 'This spell requires one taglock connection to the target.',
        'missing_taglock'
      );
    }

    const pentacleBoost = this.computePentacleBoost(spell, ctx.pentacleSlots ?? []);
    const augmentBoost = this.computeAugmentBoost(ctx.hexIntents ?? [], ctx.augmentSlots ?? []);
    const skillBonus = (ctx.casterStats.ritualSkill + ctx.casterStats.spiritualAwareness) / 10;
    const affinityBonus = (ctx.casterStats.affinities[spell.tradition] ?? 0) / 20;
    const altarBonus = this.computeAltarBonus(spell, ctx.altarBuffs ?? {});
    const familiarBonus = ctx.familiarBonus ?? 0;
    const timingBonus = ctx.timing === 'now' ? 0.05 : ctx.timing === 'midnight' ? 0.1 : 0;
    const categoryFocus = this.categoryFocus(spell.category, ctx.casterStats);
    const affinityPoints = affinityBonus * 10;
    const pentaclePoints = pentacleBoost * 20;
    const effectiveDifficulty =
      Math.max(1, spell.difficulty - (ctx.effortReduction ?? 0)) + (ctx.bindingPenalty ?? 0);

    let potency =
      spell.basePotency *
      taglock.multiplier *
      (1 + skillBonus / 10 + affinityBonus + altarBonus + familiarBonus / 100 + pentacleBoost + augmentBoost + timingBonus);

    const breakdown = {
      ritualSkill: ctx.casterStats.ritualSkill,
      intuition: ctx.casterStats.intuition,
      categoryFocus,
      affinity: affinityPoints,
      pentacle: pentaclePoints,
      effortReduction: ctx.effortReduction ?? 0,
    };
    const difficultyRoll =
      breakdown.ritualSkill +
      breakdown.intuition +
      breakdown.categoryFocus +
      breakdown.affinity +
      breakdown.pentacle +
      levelFocusBonus(ctx.casterStats.experience);
    let accuracy = Math.min(0.98, 0.55 + difficultyRoll / (spell.difficulty * 2));
    if (taglock.guaranteedAccuracy) accuracy = 0.98;
    const success = difficultyRoll >= effectiveDifficulty;

    if (!success) {
      const shortfall = effectiveDifficulty - difficultyRoll;
      const diagnostics: CastDiagnostics = {
        code: 'focus_check',
        summary:
          `Focus check failed — score ${difficultyRoll.toFixed(1)} vs required ${effectiveDifficulty}` +
          (effectiveDifficulty !== spell.difficulty ? ` (base ${spell.difficulty}, −${ctx.effortReduction ?? 0} familiar)` : '') +
          ` (short by ${shortfall.toFixed(1)}).`,
        difficultyRoll,
        difficultyRequired: effectiveDifficulty,
        breakdown,
      };
      return {
        success: false,
        potency: potency * 0.3,
        accuracy: accuracy * 0.5,
        message:
          (ctx.bindingPenalty ?? 0) > 0
            ? `Bindings thwart your focus — score ${difficultyRoll.toFixed(0)}/${effectiveDifficulty}. The working scatters.`
            : `The working fizzles — focus ${difficultyRoll.toFixed(0)}/${effectiveDifficulty}. ` +
              `Raise Ritual Skill, Intuition, or ${this.categoryStatLabel(spell.category)}, or add extra ingredients to the pentacle.`,
        consumedItems: this.fizzleConsume(consumed),
        moralDelta: spell.moralEffect * 0.5,
        effects: {},
        diagnostics,
      };
    }

    const detected =
      ctx.targetProtection !== undefined && ctx.casterStats.intuition < (ctx.targetProtection ?? 0);

    potency = scalePotencyByLevel(potency, ctx.casterStats.experience);

    const effects = {
      ...spell.gameplayEffect,
      duration: spell.duration,
      hexIntents: ctx.hexIntents,
      everweedBound: hasEverweed && isProtectionWork,
    };

    const successMessage =
      hasEverweed && isProtectionWork
        ? `${spell.name} completed — Everweed binds the working permanently.`
        : `${spell.name} completed successfully.`;

    return {
      success: true,
      potency,
      accuracy,
      message: successMessage,
      consumedItems: consumed,
      moralDelta: spell.moralEffect,
      effects,
      detected,
    };
  }

  /** Half ingredients lost when a rite fizzles (round up per stack). */
  private fizzleConsume(consumed: { itemId: string; quantity: number }[]): { itemId: string; quantity: number }[] {
    return consumed
      .map((c) => ({ itemId: c.itemId, quantity: Math.ceil(c.quantity / 2) }))
      .filter((c) => c.quantity > 0);
  }

  /** Weak casting with ME only — low accuracy, higher cost, weaker effects */
  private castMagicOnly(spell: ContentSpell, ctx: CastContext): CastResult {
    const meCost = spell.maintenanceCost * 2.5;
    if (ctx.casterStats.magicalEnergy < meCost) {
      return this.fail('Not enough Magical Energy for raw casting.', 'insufficient_me', {
        meRequired: meCost,
        meAvailable: ctx.casterStats.magicalEnergy,
      });
    }

    const bindingPenalty = ctx.bindingPenalty ?? 0;
    const skillBonus = (ctx.casterStats.ritualSkill + ctx.casterStats.intuition) / 20;
    const accuracy = Math.min(0.45, Math.max(0.02, 0.15 + skillBonus / 10 - bindingPenalty / 120));
    const roll = Math.random();
    const success = roll < accuracy;

    const potency = scalePotencyByLevel(spell.basePotency * 0.35 * (success ? 1 : 0.2), ctx.casterStats.experience);

    return {
      success,
      potency,
      accuracy,
      message: success
        ? `${spell.name} manifests weakly from will alone.`
        : bindingPenalty > 0
          ? 'Bindings on your spirit scatter the raw working before it can form.'
          : 'Your raw working scatters — focus and ingredients would help.',
      consumedItems: [],
      moralDelta: spell.moralEffect * (success ? 0.8 : 0.3),
      effects: success ? { ...spell.gameplayEffect, duration: spell.duration * 0.5, magicOnly: true } : {},
      diagnostics: success
        ? undefined
        : {
            code: 'magic_only_scatter',
            summary: `Raw magic scatter — ${(accuracy * 100).toFixed(0)}% chance, roll failed.`,
          },
    };
  }

  /** Category-relevant stat contribution to the focus / difficulty check */
  private categoryFocus(category: string, stats: PlayerStats): number {
    return calculateSpellFocus(stats, category);
  }

  private categoryStatLabel(category: string): string {
    const weights = getFocusWeights(category);
    const technical = Object.entries(weights.technical ?? {}).sort((a, b) => b[1] - a[1]);
    const mental = Object.entries(weights.mental ?? {}).sort((a, b) => b[1] - a[1]);
    if (technical[0]) return getStatLabel(technical[0][0]);
    if (mental[0]) return getStatLabel(mental[0][0]);
    return 'Ritual Skill';
  }

  private resolveTaglock(
    spell: ContentSpell,
    ctx: CastContext
  ): { satisfied: boolean; multiplier: number; guaranteedAccuracy: boolean; message?: string } {
    const requirements = spell.taglockRequirement ?? [];
    if (!requirements.length) {
      return { satisfied: true, multiplier: 1, guaranteedAccuracy: false };
    }

    if (ctx.targetSelf) {
      return { satisfied: true, multiplier: TAGLOCK_STRENGTH.self, guaranteedAccuracy: true };
    }

    const provided: TaglockType[] = [
      ...(ctx.taglocks?.map((t) => t.type) ?? []),
      ...(ctx.taglockType ? [ctx.taglockType] : []),
    ];

    const matched = provided.filter((t) => requirements.includes(t));
    if (!matched.length) {
      return {
        satisfied: false,
        multiplier: 1,
        guaranteedAccuracy: false,
        message: `Need one taglock: ${requirements.join(', ')}.`,
      };
    }

    const multiplier = Math.max(...matched.map((t) => TAGLOCK_STRENGTH[t] ?? 0.5));
    return { satisfied: true, multiplier, guaranteedAccuracy: false };
  }

  /** @deprecated use resolveTaglock */
  private computeTaglockMultiplier(taglocks?: TaglockSelection[], fallback?: TaglockType): number {
    if (taglocks?.length) {
      return taglocks.reduce((sum, t) => sum + (TAGLOCK_STRENGTH[t.type] ?? 0.5), 0) / taglocks.length;
    }
    return fallback ? (TAGLOCK_STRENGTH[fallback] ?? 0.5) : 1;
  }

  /** Extra quantity beyond minimum boosts potency (up to +3 per ingredient type) */
  private computePentacleBoost(
    spell: ContentSpell,
    slots: { itemId: string; quantity: number }[]
  ): number {
    let boost = 0;
    for (const slot of slots) {
      const req = spell.ingredients.find((i) => i.itemId === slot.itemId);
      if (!req) continue;
      const extra = Math.max(0, slot.quantity - req.quantity);
      boost += Math.min(3, extra) * 0.05;
    }
    return boost;
  }

  private computeAugmentBoost(
    hexIntents: string[],
    augmentSlots: { itemId: string; quantity: number }[]
  ): number {
    let boost = 0;
    for (const intent of hexIntents) {
      const def = HEX_INTENTS.find((h) => h.id === intent);
      if (!def) continue;
      const has = augmentSlots.some((s) => s.itemId === def.ingredient);
      if (has) boost += 0.08;
    }
    return boost;
  }

  private validateIngredients(
    spell: ContentSpell,
    inventory: InventorySlot[],
    pentacleSlots?: { itemId: string; quantity: number }[]
  ): { ok: boolean; reason?: string; missingItemId?: string; consumed: { itemId: string; quantity: number }[] } {
    const consumed: { itemId: string; quantity: number }[] = [];
    const source = pentacleSlots?.length ? pentacleSlots : spell.ingredients.map((r) => ({ itemId: r.itemId, quantity: r.quantity }));

    for (const req of spell.ingredients) {
      const slot = source.find((s) => s.itemId === req.itemId);
      const invQty = totalItemQuantity(inventory, req.itemId);
      const qty = slot?.quantity ?? invQty;
      if (qty < req.quantity) {
        const ing = contentRegistry.ingredients.get(req.itemId);
        return {
          ok: false,
          reason: `Missing ${ing?.name ?? req.itemId} (need ${req.quantity}, have ${qty}).`,
          missingItemId: req.itemId,
          consumed: [],
        };
      }
      consumed.push({ itemId: req.itemId, quantity: slot?.quantity ?? req.quantity });
    }
    return { ok: true, consumed };
  }

  private computeAltarBonus(spell: ContentSpell, buffs: Record<string, number>): number {
    return (buffs[spell.category] ?? 0) / 100;
  }

  private fail(
    message: string,
    code: CastDiagnostics['code'],
    extra?: Partial<CastDiagnostics>
  ): CastResult {
    return {
      success: false,
      potency: 0,
      accuracy: 0,
      message,
      consumedItems: [],
      moralDelta: 0,
      effects: {},
      diagnostics: {
        code,
        summary: message,
        ...extra,
      },
    };
  }
}

export const spellEngine = new SpellEngine();
