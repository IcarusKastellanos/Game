import type { MagicTradition, PlayerStats } from '../types/index.js';
import { resolveStatValue, type StatDisplayKey } from './stats-catalog.js';
import { setReputationContent } from './reputation.js';
import { setXpSourcesContent } from './xp-sources.js';
import { setLevelCurveContent } from './level-curve.js';
import { setLevelProfiles } from './level-profiles.js';

export interface HungerDebuffBand {
  belowHunger: number;
  effects: {
    magicalEnergyRegenMultiplier?: number;
    staminaRegenMultiplier?: number;
    ritualStabilityModifier?: number;
  };
}

export interface SurvivalConfig {
  hungerDecayPerMinute: number;
  lowThreshold: number;
  criticalThreshold: number;
  staminaRegenPerMinute: { idle: number; eating: number; sleeping: number };
  sleepHealthRegenPerMinute: number;
  hungerDebuffs: HungerDebuffBand[];
}

export interface FocusWeightCategory {
  technical?: Partial<Record<StatDisplayKey, number>>;
  mental?: Partial<Record<StatDisplayKey, number>>;
}

export interface BookContentDef {
  id: string;
  title: string;
  pages: string[];
  grants?: {
    statXp?: Partial<Record<string, number>>;
    discoverItems?: string[];
    affinity?: MagicTradition;
    unlocks?: string[];
  };
}

/** Legacy shape used by progression-handlers. */
export interface BookContentLegacy {
  pages: string[];
  statBoost?: Record<string, number>;
  discoverItems?: string[];
  affinity?: MagicTradition;
}

export interface ProgressionContentState {
  survival: SurvivalConfig;
  statLabels: Record<string, string>;
  focusWeights: Record<string, FocusWeightCategory>;
  books: Record<string, BookContentLegacy>;
}

const DEFAULT_STAT_LABELS: Record<string, string> = {
  health: 'Health',
  hunger: 'Hunger',
  stamina: 'Stamina',
  magicalEnergy: 'Magical Energy',
  intuition: 'Intuition',
  awareness: 'Awareness',
  willpower: 'Willpower',
  memory: 'Memory',
  presence: 'Presence',
  authority: 'Authority',
  mediumship: 'Mediumship',
  ritualSkill: 'Ritual Skill',
  protection: 'Protection',
  hexWork: 'Hex Work',
  healing: 'Healing',
  herbalism: 'Herbalism',
  divination: 'Divination',
  potionMaking: 'Potion Making',
  spiritNegotiation: 'Spirit Negotiation',
};

const DEFAULT_FOCUS_WEIGHTS: Record<string, FocusWeightCategory> = {
  warding: {
    technical: { protection: 0.5, ritualSkill: 0.2 },
    mental: { willpower: 0.2, awareness: 0.2 },
  },
  protection: {
    technical: { protection: 0.5, ritualSkill: 0.2 },
    mental: { willpower: 0.2, awareness: 0.1 },
  },
  healing: {
    technical: { healing: 0.5, ritualSkill: 0.2 },
    mental: { willpower: 0.15, memory: 0.15 },
  },
  baneful: {
    technical: { hexWork: 0.5, ritualSkill: 0.2 },
    mental: { willpower: 0.15, authority: 0.15 },
  },
  binding: {
    technical: { hexWork: 0.5, ritualSkill: 0.2 },
    mental: { willpower: 0.15, authority: 0.15 },
  },
  divination: {
    technical: { divination: 0.45, ritualSkill: 0.15 },
    mental: { intuition: 0.2, awareness: 0.2 },
  },
  cleansing: {
    technical: { healing: 0.35, ritualSkill: 0.15 },
    mental: { awareness: 0.25, willpower: 0.25 },
  },
  reversal: {
    technical: { healing: 0.35, ritualSkill: 0.15 },
    mental: { awareness: 0.25, willpower: 0.25 },
  },
  luck: {
    technical: { ritualSkill: 0.25 },
    mental: { intuition: 0.5, presence: 0.25 },
  },
  default: {
    technical: { ritualSkill: 0.5 },
    mental: { intuition: 0.25, willpower: 0.25 },
  },
};

const DEFAULT_SURVIVAL: SurvivalConfig = {
  hungerDecayPerMinute: 0.5,
  lowThreshold: 20,
  criticalThreshold: 10,
  staminaRegenPerMinute: { idle: 3, eating: 6, sleeping: 12 },
  sleepHealthRegenPerMinute: 0.5,
  hungerDebuffs: [
    {
      belowHunger: 20,
      effects: { magicalEnergyRegenMultiplier: 0.5, staminaRegenMultiplier: 0.75 },
    },
    {
      belowHunger: 10,
      effects: {
        magicalEnergyRegenMultiplier: 0.25,
        staminaRegenMultiplier: 0.4,
        ritualStabilityModifier: -0.15,
      },
    },
  ],
};

const DEFAULT_BOOKS: Record<string, BookContentLegacy> = {
  book_folk_magic: {
    pages: [
      "Chapter I — The Cunning Path\n\nEuropean folk magic weaves intention, timing, and humble tools. Salt circles, candle dressing, and spoken charms form the practitioner's daily craft.",
      'Chapter II — Correspondences\n\nRosemary guards thresholds. Bay leaf carries wishes to the wind. White candles invite clarity; black candles absorb what must not follow you home.',
      'Chapter III — First Workings\n\nA healing charm needs little more than focus and rosemary. Protection begins at the threshold — salt, flame, and a clear name for what you ward against.',
    ],
    statBoost: { herbalism: 2, ritualSkill: 1, willpower: 1, memory: 1 },
    discoverItems: ['rosemary', 'bay_leaf', 'white_candle', 'salt'],
    affinity: 'traditional_european',
  },
};

let state: ProgressionContentState = {
  survival: { ...DEFAULT_SURVIVAL, staminaRegenPerMinute: { ...DEFAULT_SURVIVAL.staminaRegenPerMinute } },
  statLabels: { ...DEFAULT_STAT_LABELS },
  focusWeights: { ...DEFAULT_FOCUS_WEIGHTS },
  books: { ...DEFAULT_BOOKS },
};

function toFiniteNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function bookDefToLegacy(def: BookContentDef): BookContentLegacy {
  const statBoost = def.grants?.statXp
    ? Object.fromEntries(
        Object.entries(def.grants.statXp).filter((entry): entry is [string, number] => entry[1] != null)
      )
    : undefined;
  return {
    pages: def.pages,
    statBoost,
    discoverItems: def.grants?.discoverItems,
    affinity: def.grants?.affinity,
  };
}

/** Hydrate runtime progression content from JSON blobs (server startup). Safe to call repeatedly. */
export function setProgressionContent(partial: {
  statsJson?: unknown;
  statLabelsJson?: unknown;
  focusWeightsJson?: unknown;
  booksJson?: unknown;
  reputationPublicJson?: unknown;
  reputationSpiritualJson?: unknown;
  xpSourcesJson?: unknown;
  levelCurveJson?: unknown;
  levelProfilesJson?: unknown;
}): void {
  if (partial.levelCurveJson !== undefined) {
    setLevelCurveContent(partial.levelCurveJson);
  }
  if (partial.levelProfilesJson !== undefined && partial.levelProfilesJson != null) {
    setLevelProfiles(partial.levelProfilesJson);
  }
  if (partial.reputationPublicJson !== undefined || partial.reputationSpiritualJson !== undefined) {
    setReputationContent({
      publicJson: partial.reputationPublicJson,
      spiritualJson: partial.reputationSpiritualJson,
    });
  }
  if (partial.xpSourcesJson !== undefined) {
    setXpSourcesContent(partial.xpSourcesJson);
  }

  const next: ProgressionContentState = {
    survival: { ...state.survival, staminaRegenPerMinute: { ...state.survival.staminaRegenPerMinute } },
    statLabels: { ...state.statLabels },
    focusWeights: { ...state.focusWeights },
    books: { ...state.books },
  };

  const stats = partial.statsJson as Record<string, unknown> | undefined;
  if (stats && typeof stats === 'object') {
    const hunger = stats.hunger as Record<string, unknown> | undefined;
    const stamina = stats.stamina as Record<string, unknown> | undefined;
    if (hunger) {
      const decay = toFiniteNumber(hunger.decayPerMinute);
      if (decay != null) next.survival.hungerDecayPerMinute = decay;
      const low = toFiniteNumber(hunger.lowThreshold);
      if (low != null) next.survival.lowThreshold = low;
      const crit = toFiniteNumber(hunger.criticalThreshold);
      if (crit != null) next.survival.criticalThreshold = crit;
      if (Array.isArray(hunger.hungerDebuffs)) {
        next.survival.hungerDebuffs = hunger.hungerDebuffs
          .map((b) => {
            const band = b as Record<string, unknown>;
            const below = toFiniteNumber(band.belowHunger);
            const effects = band.effects as HungerDebuffBand['effects'] | undefined;
            if (below == null || !effects) return null;
            return { belowHunger: below, effects };
          })
          .filter((b): b is HungerDebuffBand => b != null);
      }
    }
    if (stamina) {
      const idle = toFiniteNumber(stamina.idleRegenPerMinute);
      const eating = toFiniteNumber(stamina.eatingRegenPerMinute);
      const sleeping = toFiniteNumber(stamina.sleepingRegenPerMinute);
      const health = toFiniteNumber(stamina.sleepHealthRegenPerMinute);
      if (idle != null) next.survival.staminaRegenPerMinute.idle = idle;
      if (eating != null) next.survival.staminaRegenPerMinute.eating = eating;
      if (sleeping != null) next.survival.staminaRegenPerMinute.sleeping = sleeping;
      if (health != null) next.survival.sleepHealthRegenPerMinute = health;
    }
  }

  const labels = partial.statLabelsJson as Record<string, string> | undefined;
  if (labels && typeof labels === 'object') {
    next.statLabels = { ...next.statLabels, ...labels };
  }

  const focus = partial.focusWeightsJson as { categories?: Record<string, FocusWeightCategory> } | undefined;
  if (focus?.categories && typeof focus.categories === 'object') {
    for (const [key, weights] of Object.entries(focus.categories)) {
      if (weights && typeof weights === 'object') {
        next.focusWeights[key] = weights;
      }
    }
  }

  const books = partial.booksJson as { books?: BookContentDef[] } | undefined;
  if (books?.books && Array.isArray(books.books)) {
    for (const def of books.books) {
      if (def?.id && Array.isArray(def.pages)) {
        next.books[def.id] = bookDefToLegacy(def);
      }
    }
  }

  state = next;
}

export function getSurvivalConfig(): SurvivalConfig {
  return state.survival;
}

export function getStatLabel(key: string): string {
  return state.statLabels[key] ?? DEFAULT_STAT_LABELS[key] ?? key;
}

export function getFocusWeights(category: string): FocusWeightCategory {
  return state.focusWeights[category] ?? state.focusWeights.default ?? DEFAULT_FOCUS_WEIGHTS.default!;
}

export function getBookContent(bookId: string): BookContentLegacy | undefined {
  return state.books[bookId];
}

/** @deprecated Use getBookContent — kept for existing imports. */
export function getAllBookContent(): Record<string, BookContentLegacy> {
  return { ...state.books };
}

function weightedStatSum(
  stats: PlayerStats,
  weights: Partial<Record<StatDisplayKey, number>> | undefined
): number {
  if (!weights) return 0;
  return Object.entries(weights).reduce((sum, [key, weight]) => {
    const w = toFiniteNumber(weight);
    if (w == null || w <= 0) return sum;
    const statKey = key as StatDisplayKey;
    return sum + resolveStatValue(stats, statKey) * w;
  }, 0);
}

/** Spell-category focus score from content weights × normalized player stats. */
export function calculateSpellFocus(stats: PlayerStats, spellCategory: string): number {
  const weights = getFocusWeights(spellCategory);
  const technical = weightedStatSum(stats, weights.technical);
  const mental = weightedStatSum(stats, weights.mental);
  return technical + mental;
}

/** Strongest matching hunger debuff band for a given hunger value. */
export function resolveHungerDebuff(hunger: number): HungerDebuffBand['effects'] | null {
  const bands = [...state.survival.hungerDebuffs].sort((a, b) => a.belowHunger - b.belowHunger);
  let match: HungerDebuffBand | null = null;
  for (const band of bands) {
    if (hunger <= band.belowHunger) match = band;
  }
  return match?.effects ?? null;
}

export function hungerRegenMultiplierFromContent(
  hunger: number,
  kind: 'stamina' | 'magicalEnergy'
): number {
  const debuff = resolveHungerDebuff(hunger);
  if (!debuff) return 1;
  const key = kind === 'stamina' ? 'staminaRegenMultiplier' : 'magicalEnergyRegenMultiplier';
  const mult = debuff[key];
  return mult != null && mult > 0 ? mult : 1;
}
