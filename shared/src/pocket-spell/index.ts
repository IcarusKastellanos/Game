import type { AuraState, PlayerStats } from '../types/index.js';
import { isActiveAuraEffect, computeBindingCastPenalty } from '../ward-web/index.js';
import { levelFocusBonus, protectionSkillFromLevel, scalePotencyByLevel } from '../balance/index.js';

export interface PocketSpellCraftMeta {
  storedMe: number;
  craftStability?: number;
  potencyBonus?: number;
  craftPower?: number;
  unstable?: boolean;
}

export interface PocketSpellReleaseSpell {
  id: string;
  category: string;
  difficulty: number;
  basePotency: number;
  moralEffect?: number;
  maintenanceCost?: number;
  name?: string;
}

export interface PocketSpellReleaseInput {
  spell: PocketSpellReleaseSpell;
  pocket: PocketSpellCraftMeta;
  caster: PlayerStats;
  casterAura?: AuraState;
  target?: PlayerStats;
  targetAura?: AuraState;
  targetIsSelf: boolean;
  /** Optional 0–100 roll for backlash resolution (server provides). */
  backlashRoll?: number;
}

export interface PocketSpellReleaseResult {
  releaseSuccess: boolean;
  releaseScore: number;
  releaseRequired: number;
  bindingPenalty: number;
  needsPenetration: boolean;
  penetrationRatio: number;
  targetWardStrength: number;
  casterStrike: number;
  effectivePotency: number;
  blocked: boolean;
  partial: boolean;
  detected: boolean;
  backlashChance: number;
  backlashTriggered: boolean;
  backlashSeverity: number;
  message: string;
  detailMessage: string;
}

export function pocketSpellCategoryFocus(category: string, stats: PlayerStats): number {
  switch (category) {
    case 'warding':
      return stats.warding * 2 + stats.protection * 0.5;
    case 'protection':
      return stats.protection * 2 + stats.warding * 0.5;
    case 'healing':
      return stats.healing * 2;
    case 'baneful':
    case 'binding':
      return stats.cursecraft * 2;
    case 'divination':
      return stats.divinationSkill * 2;
    case 'cleansing':
    case 'reversal':
      return stats.healing + stats.spiritualAwareness;
    case 'luck':
      return stats.intuition + stats.ritualSkill * 0.5;
    default:
      return stats.ritualSkill * 0.5;
  }
}

export function computeAuraWardStrength(aura: AuraState | undefined): number {
  if (!aura) return 0;
  let sum = 0;
  for (const p of aura.protections ?? []) {
    if (isActiveAuraEffect(p)) sum += (p.strength ?? 0) * 0.12;
  }
  for (const w of aura.wards ?? []) {
    if (isActiveAuraEffect(w)) sum += (w.strength ?? 0) * 0.1;
  }
  for (const h of aura.hexes ?? []) {
    if (isActiveAuraEffect(h)) sum += (h.strength ?? 0) * 0.04;
  }
  return sum;
}

export function pocketSpellNeedsPenetration(
  category: string,
  moralEffect: number,
  targetIsSelf: boolean
): boolean {
  if (targetIsSelf) return false;
  if (category === 'healing' || category === 'cleansing' || category === 'luck') return false;
  if (category === 'protection') return false;
  if (category === 'divination' && moralEffect >= 0) return false;
  return category === 'baneful' || category === 'binding' || moralEffect < 0;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Resolve release focus, ward penetration, effective potency, and backlash risk. */
export function calculatePocketSpellRelease(input: PocketSpellReleaseInput): PocketSpellReleaseResult {
  const { spell, pocket, caster, target, targetAura, targetIsSelf } = input;
  const stability = pocket.craftStability ?? 70;
  const potencyBonus = pocket.potencyBonus ?? 0;
  const craftPower = pocket.craftPower ?? 0;
  const meRef = Math.max(3, spell.maintenanceCost ?? pocket.storedMe);
  const bindingPenalty = computeBindingCastPenalty(input.casterAura);

  let releaseScore =
    caster.ritualSkill +
    caster.intuition * 0.5 +
    pocketSpellCategoryFocus(spell.category, caster) +
    levelFocusBonus(caster.experience) +
    stability / 5 +
    pocket.storedMe * 0.4 +
    craftPower / 8 -
    bindingPenalty;

  const releaseRequired = Math.max(8, spell.difficulty * 0.6);
  const releaseSuccess = releaseScore >= releaseRequired;

  const needsPenetration = pocketSpellNeedsPenetration(spell.category, spell.moralEffect ?? 0, targetIsSelf);

  let penetrationRatio = 1;
  let targetWardStrength = 0;
  let casterStrike = 0;

  if (needsPenetration && target) {
    targetWardStrength =
      target.protection +
      protectionSkillFromLevel(target.experience) * 0.35 +
      target.warding * 0.45 +
      computeAuraWardStrength(targetAura);

    casterStrike =
      caster.cursecraft * 1.5 +
      caster.intuition +
      caster.ritualSkill * 0.5 +
      pocket.storedMe * 0.85 +
      potencyBonus * 0.55 +
      craftPower / 10;

    const margin = casterStrike - targetWardStrength;
    penetrationRatio = clamp(0.2 + margin / 35, 0, 1);
    if (!releaseSuccess) penetrationRatio *= 0.65;
  }

  let potencyBase =
    spell.basePotency *
    (pocket.storedMe / meRef) *
    (1 + potencyBonus / 25) *
    (1 + craftPower / 100);

  if (!releaseSuccess) potencyBase *= 0.25;
  potencyBase *= penetrationRatio;
  potencyBase *= stability / 100;
  if (pocket.unstable || stability < 55) potencyBase *= 0.85;

  let effectivePotency = scalePotencyByLevel(potencyBase, caster.experience);

  const blocked = needsPenetration && penetrationRatio < 0.08;
  const partial = needsPenetration && penetrationRatio >= 0.08 && penetrationRatio < 0.55;

  if (blocked) effectivePotency = 0;

  let backlashChance =
    10 +
    Math.abs(Math.min(0, spell.moralEffect ?? 0)) * 2.5 +
    Math.max(0, spell.difficulty - 15) * 0.4;
  if (stability < 55) backlashChance += 18;
  if (pocket.unstable) backlashChance += 12;
  if (!releaseSuccess) backlashChance += 22;
  if (needsPenetration && penetrationRatio < 0.35) backlashChance += 15;
  backlashChance -= caster.spiritualAwareness * 0.25;
  backlashChance = clamp(Math.round(backlashChance), 2, 85);

  const backlashRoll = input.backlashRoll ?? 50;
  const backlashTriggered = backlashRoll < backlashChance;
  const backlashSeverity = backlashTriggered
    ? Math.round(
        (backlashChance - backlashRoll) / 10 +
          (pocket.unstable ? 4 : 0) +
          (needsPenetration && penetrationRatio < 0.2 ? 3 : 0)
      )
    : 0;

  const detected =
    !!target &&
    needsPenetration &&
    target.intuition > caster.intuition * 0.85 &&
    penetrationRatio < 0.92;

  const spellName = spell.name ?? spell.id;
  let message = '';
  let detailMessage = `Release ${releaseScore.toFixed(1)}/${releaseRequired.toFixed(0)}`;

  if (blocked) {
    message = `${spellName} fails against ${target?.protection ? 'thick' : 'the target\'s'} wards.`;
    detailMessage += ` · Wards ${targetWardStrength.toFixed(1)} vs strike ${casterStrike.toFixed(1)} (${Math.round(penetrationRatio * 100)}% through)`;
  } else if (!releaseSuccess) {
    message = bindingPenalty > 0
      ? `${spellName} unravels — bindings interfere with your release.`
      : `${spellName} unravels unevenly as you release it.`;
    detailMessage += bindingPenalty > 0
      ? ` · Focus failed (binding −${bindingPenalty})`
      : ` · Focus failed`;
  } else if (partial) {
    message = `${spellName} partially pierces the target's protections.`;
    detailMessage += ` · ${Math.round(penetrationRatio * 100)}% penetration`;
  } else if (needsPenetration) {
    message = `${spellName} pierces the target's wards (potency ${Math.round(effectivePotency)}).`;
    detailMessage += ` · ${Math.round(penetrationRatio * 100)}% penetration`;
  } else {
    message = `${spellName} releases cleanly (potency ${Math.round(effectivePotency)}).`;
  }

  if (backlashTriggered) {
    message += ' Magical backlash!';
    detailMessage += ` · Backlash ${backlashChance}%`;
  }
  if (detected) {
    detailMessage += ' · Target may have sensed the working';
  }

  return {
    releaseSuccess,
    releaseScore,
    releaseRequired,
    bindingPenalty,
    needsPenetration,
    penetrationRatio,
    targetWardStrength,
    casterStrike,
    effectivePotency,
    blocked,
    partial,
    detected,
    backlashChance,
    backlashTriggered,
    backlashSeverity,
    message,
    detailMessage,
  };
}

/** Apply backlash from a failed or resisted pocket release to the caster. */
export function applyPocketSpellBacklash(
  stats: PlayerStats,
  severity: number
): PlayerStats {
  const meLoss = Math.min(stats.magicalEnergy, 3 + severity * 2);
  const hpLoss = Math.min(stats.health - 1, severity * 1.5);
  return {
    ...stats,
    magicalEnergy: Math.max(0, stats.magicalEnergy - meLoss),
    health: Math.max(1, stats.health - hpLoss),
  };
}
