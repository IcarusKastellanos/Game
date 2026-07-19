import type { AuraEffect, AuraState, PlayerStats, StatDisplayKey, WardState, PlayerProgression } from '@witchcraft/shared';
import {
  AMBIENT_WARD_SPELL_ID,
  DEFAULT_STATS,
  FAMILIAR_KNOT_LINK_SPELL_ID,
  STAT_DESCRIPTIONS,
  STAT_GROUPS,
  STAT_LABELS,
  STAT_VALUE_BADGES,
  isActiveAuraEffect,
  isSyntheticWardEffect,
  magicalEnergyCap,
  getSurvivalConfig,
  normalizePlayerStats,
  resolveStatMax,
  resolveStatValue,
  isTechnicalSkillKey,
  skillXpProgress,
} from '@witchcraft/shared';

export type FamiliarLinkState =
  | 'unlinked'
  | 'linked'
  | 'weakened'
  | 'blocked'
  | 'distant'
  | 'offline';

export type AuraSeverity = 'critical' | 'danger' | 'warning' | 'info' | 'stable';

export interface AuraMessage {
  severity: AuraSeverity;
  text: string;
}

export interface AttributeViewModel {
  key: StatDisplayKey;
  label: string;
  value: number;
  maxValue?: number;
  badge?: string;
  description: string;
  status: 'normal' | 'buffed' | 'debuffed' | 'critical';
  /** 0..1 fill for the progress bar (core resources only). */
  ratio?: number;
  /** Technical skill XP toward next point. */
  skillXp?: number;
  skillXpToNext?: number;
}

export interface AuraVisualState {
  /** 0..1 overall aura energy. */
  intensity: number;
  mood: 'dim' | 'stable' | 'bright' | 'distorted' | 'uneven' | 'radiant';
  hpRatio: number;
  glowColor: string;
}

export interface AuraScreenViewModel {
  alignment: { value: number; label: string };
  blessings: number;
  hexes: number;
  activeProtections: number;
  wardLayers: number;
  perimeterStrength: number;
  familiarLink: {
    linked: boolean;
    familiarName: string | null;
    integrity: number;
    state: FamiliarLinkState;
  };
  energeticDamage: number;
  coreAttributes: AttributeViewModel[];
  mentalAttributes: AttributeViewModel[];
  technicalSkills: AttributeViewModel[];
  visualState: AuraVisualState;
  statusMessage: AuraMessage;
}

export interface AuraViewModelContext {
  aura: AuraState;
  stats: PlayerStats;
  apartmentWards: WardState[];
  familiarName: string | null;
  familiarChosen: boolean;
  isOther: boolean;
  progression?: PlayerProgression | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const CAP_TITLE: Record<string, string> = {
  neutral: 'Neutral',
  benevolent: 'Benevolent',
  malevolent: 'Malevolent',
};

/** Parse a stats JSON blob into a normalized stats object with safe defaults. */
export function parseStats(statsJson: string | undefined | null): PlayerStats {
  if (!statsJson) return normalizePlayerStats({ ...DEFAULT_STATS });
  try {
    const parsed = JSON.parse(statsJson) as Partial<PlayerStats>;
    return normalizePlayerStats({
      ...DEFAULT_STATS,
      ...parsed,
      affinities: { ...DEFAULT_STATS.affinities, ...parsed.affinities },
    });
  } catch {
    return normalizePlayerStats({ ...DEFAULT_STATS });
  }
}

function countActiveProtections(aura: AuraState): number {
  return (aura.protections ?? []).filter(
    (p) => isActiveAuraEffect(p) && (!isSyntheticWardEffect(p) || p.spellId === FAMILIAR_KNOT_LINK_SPELL_ID)
  ).length;
}

function activeWards(aura: AuraState, hasPerimeter: boolean): AuraEffect[] {
  return (aura.wards ?? []).filter((w) => {
    if (!isActiveAuraEffect(w)) return false;
    if (hasPerimeter && w.spellId === 'household_ward') return false;
    if (w.spellId === AMBIENT_WARD_SPELL_ID) return false;
    return true;
  });
}

function familiarLinkState(chosen: boolean, integrity: number): FamiliarLinkState {
  if (!chosen) return 'unlinked';
  if (integrity <= 0) return 'blocked';
  if (integrity < 0.4) return 'distant';
  if (integrity < 0.75) return 'weakened';
  return 'linked';
}

function buildAttribute(
  stats: PlayerStats,
  key: StatDisplayKey,
  progression?: PlayerProgression | null
): AttributeViewModel {
  const value = Math.round(resolveStatValue(stats, key));
  const maxValue = resolveStatMax(stats, key);
  const ratio = maxValue && maxValue > 0 ? clamp(value / maxValue, 0, 1) : undefined;

  let status: AttributeViewModel['status'] = 'normal';
  const cfg = getSurvivalConfig();
  if (key === 'hunger') {
    if (value <= cfg.criticalThreshold) status = 'critical';
    else if (value <= cfg.lowThreshold) status = 'debuffed';
  } else if (key === 'health' && ratio != null) {
    if (ratio <= 0.25) status = 'critical';
    else if (ratio <= 0.5) status = 'debuffed';
  } else if (key === 'stamina' && ratio != null && ratio <= 0.25) {
    status = 'debuffed';
  } else if (key === 'magicalEnergy' && ratio != null && ratio <= 0.15) {
    status = 'debuffed';
  }

  let skillXp: number | undefined;
  let skillXpToNext: number | undefined;
  if (progression && isTechnicalSkillKey(key)) {
    const prog = skillXpProgress(progression, stats, key);
    skillXp = prog.xp;
    skillXpToNext = prog.xpToNext;
  }

  return {
    key,
    label: STAT_LABELS[key],
    value,
    maxValue,
    badge: STAT_VALUE_BADGES[key],
    description: STAT_DESCRIPTIONS[key],
    status,
    ratio,
    skillXp,
    skillXpToNext,
  };
}

function getStatusMessage(vm: {
  energeticDamage: number;
  hexes: number;
  wardLayers: number;
  meRatio: number;
  familiar: { chosen: boolean; state: FamiliarLinkState };
  activeProtections: number;
  perimeterStrength: number;
  isOther: boolean;
}): AuraMessage {
  if (vm.energeticDamage >= 75) {
    return { severity: 'critical', text: 'Severe energetic damage is destabilising your aura.' };
  }
  if (vm.hexes > 0) {
    return { severity: 'danger', text: 'A hostile magical influence is distorting your aura.' };
  }
  if (!vm.isOther && vm.wardLayers === 0) {
    return {
      severity: 'info',
      text: 'No active wards — cast Household Ward at the altar to raise perimeter and aura layers.',
    };
  }
  if (vm.meRatio < 0.2) {
    return { severity: 'warning', text: 'Your magical energy is low — rest or feed to recover before working.' };
  }
  if (vm.familiar.chosen && (vm.familiar.state === 'distant' || vm.familiar.state === 'weakened')) {
    return { severity: 'warning', text: 'Your familiar link is weakening — bond with your familiar to restore it.' };
  }
  if (vm.perimeterStrength > 0 || vm.activeProtections > 0) {
    return { severity: 'stable', text: 'Your aura is stable and your protections are holding.' };
  }
  return { severity: 'stable', text: 'Your aura is calm and steady.' };
}

export function buildAuraViewModel(ctx: AuraViewModelContext): AuraScreenViewModel {
  const { aura, stats, apartmentWards, isOther } = ctx;

  const hasPerimeter = !isOther && apartmentWards.length > 0;
  const wards = activeWards(aura, hasPerimeter);
  const perimeterStrength = hasPerimeter
    ? apartmentWards.reduce((sum, w) => sum + (w.strength ?? 0), 0)
    : 0;
  const wardLayers = wards.length + (hasPerimeter ? apartmentWards.length : 0);
  const activeProtections = countActiveProtections(aura);

  const blessings = aura.blessings?.filter(isActiveAuraEffect).length ?? 0;
  const hexes = aura.hexes?.filter(isActiveAuraEffect).length ?? 0;
  const energeticDamage = Math.round(aura.energeticDamage ?? 0);

  const integrity = aura.familiarLink ? clamp(aura.familiarLink.strength, 0, 1) : 0;
  const famState = familiarLinkState(ctx.familiarChosen && !isOther, integrity);

  const maxMe = magicalEnergyCap(stats.experience ?? 0);
  const meRatio = maxMe > 0 ? clamp((stats.magicalEnergy ?? 0) / maxMe, 0, 1) : 0;
  const damageNorm = clamp(energeticDamage / 100, 0, 1);
  const blessingMod = clamp(blessings * 0.08, 0, 0.3);
  const hexMod = clamp(hexes * 0.12, 0, 0.5);
  const intensity = clamp(meRatio - damageNorm * 0.45 + blessingMod - hexMod, 0, 1);

  let mood: AuraVisualState['mood'] = 'stable';
  if (damageNorm > 0.35) mood = 'distorted';
  else if (hexes > 0) mood = 'uneven';
  else if (blessings > 0 && intensity > 0.6) mood = 'radiant';
  else if (intensity > 0.8) mood = 'bright';
  else if (intensity < 0.25) mood = 'dim';

  const maxHp = resolveStatMax(stats, 'health') ?? 100;
  const hpRatio = clamp((stats.health ?? 0) / Math.max(1, maxHp), 0, 1);
  const glowColor =
    hexes > blessings
      ? '#ff556688'
      : blessings > 0
        ? '#66ffaa55'
        : aura.alignment === 'malevolent'
          ? '#aa224677'
          : aura.alignment === 'benevolent'
            ? '#5588ff66'
            : '#8866cc55';

  const statusMessage = getStatusMessage({
    energeticDamage,
    hexes,
    wardLayers,
    meRatio,
    familiar: { chosen: ctx.familiarChosen && !isOther, state: famState },
    activeProtections,
    perimeterStrength,
    isOther,
  });

  return {
    alignment: {
      value: aura.moralityScore ?? 0,
      label: CAP_TITLE[aura.alignment ?? 'neutral'] ?? 'Neutral',
    },
    blessings,
    hexes,
    activeProtections,
    wardLayers,
    perimeterStrength,
    familiarLink: {
      linked: famState !== 'unlinked' && famState !== 'blocked',
      familiarName: ctx.familiarChosen && !isOther ? ctx.familiarName : null,
      integrity,
      state: famState,
    },
    energeticDamage,
    coreAttributes: STAT_GROUPS.core.map((k) => buildAttribute(stats, k, ctx.progression)),
    mentalAttributes: STAT_GROUPS.mental.map((k) => buildAttribute(stats, k, ctx.progression)),
    technicalSkills: STAT_GROUPS.technical.map((k) => buildAttribute(stats, k, ctx.progression)),
    visualState: { intensity, mood, hpRatio, glowColor },
    statusMessage,
  };
}
