import { magicalEnergyCap } from '../constants/index.js';
import type { PlayerStats } from '../types/index.js';

/**
 * Single source of truth for the Aura & Wards attribute panels.
 *
 * Display keys are stable, human-facing identifiers. Some map to legacy
 * PlayerStats fields via {@link STAT_ALIASES} so no destructive rename is
 * required (awareness→spiritualAwareness, hexWork→cursecraft,
 * divination→divinationSkill, protection→warding).
 */
export type AttributeGroup = 'core' | 'mental' | 'technical';

export type StatDisplayKey =
  | 'health'
  | 'hunger'
  | 'stamina'
  | 'magicalEnergy'
  | 'intuition'
  | 'awareness'
  | 'willpower'
  | 'memory'
  | 'presence'
  | 'authority'
  | 'mediumship'
  | 'ritualSkill'
  | 'protection'
  | 'hexWork'
  | 'healing'
  | 'herbalism'
  | 'divination'
  | 'potionMaking'
  | 'spiritNegotiation';

/** Display key → underlying PlayerStats fields, tried in order. */
export const STAT_ALIASES: Record<StatDisplayKey, readonly (keyof PlayerStats)[]> = {
  health: ['health'],
  hunger: ['hunger'],
  stamina: ['stamina'],
  magicalEnergy: ['magicalEnergy'],
  intuition: ['intuition'],
  awareness: ['spiritualAwareness'],
  willpower: ['willpower'],
  memory: ['memory'],
  presence: ['presence'],
  authority: ['authority'],
  mediumship: ['mediumship'],
  ritualSkill: ['ritualSkill'],
  protection: ['warding'],
  hexWork: ['cursecraft'],
  healing: ['healing'],
  herbalism: ['herbalism'],
  divination: ['divinationSkill'],
  potionMaking: ['potionMaking'],
  spiritNegotiation: ['spiritNegotiation'],
};

export const STAT_LABELS: Record<StatDisplayKey, string> = {
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

/** Short prefix badge shown before the value, e.g. "HP 100" / "ME 42/58". */
export const STAT_VALUE_BADGES: Partial<Record<StatDisplayKey, string>> = {
  health: 'HP',
  magicalEnergy: 'ME',
};

export const STAT_DESCRIPTIONS: Record<StatDisplayKey, string> = {
  health: 'Your physical vitality. Reduced by hex damage and parasites; restored by food, rest, and healing.',
  hunger: 'How well fed you are. When low, magical-energy and stamina regeneration are penalised.',
  stamina: 'Physical endurance for actions, travel, carrying offerings, and long-ritual steadiness.',
  magicalEnergy: 'Your working reserve. Spent on spells and rituals; regenerates over time.',
  intuition: 'Sensitivity of the Intuition Meter and early warning of nearby or hidden magic.',
  awareness: 'Spiritual awareness — perceiving spirits, energies, and subtle magical nuance.',
  willpower: 'Resists bindings, holds focus while hexed, and steadies long rituals.',
  memory: 'Grimoire recall, recasting without notes, and retaining ritual sequences.',
  presence: 'First impressions with NPCs and spirits; helps lead group ritual.',
  authority: 'Commanding spirits, enforcing ward terms, and formal ritual leadership.',
  mediumship: 'Quality of spirit communication, channeling, and astral perception.',
  ritualSkill: 'Altar focus rolls, ritual execution, timing, and ceremonial precision.',
  protection: 'Personal and household wards, banishings, and defensive spell success.',
  hexWork: 'Baneful workings, curses, and hostile bindings.',
  healing: 'Magical healing, aura restoration, and cleansing support.',
  herbalism: 'Herb identification, harvest quality, and ingredient preparation.',
  divination: 'Scrying, readings, and interpreting omens.',
  potionMaking: 'Brewing success, potency, balance, and contamination risk.',
  spiritNegotiation: 'Pacts, offerings, banishment terms, and de-escalation with entities.',
};

export const STAT_GROUPS: Record<AttributeGroup, StatDisplayKey[]> = {
  core: ['health', 'hunger', 'stamina', 'magicalEnergy'],
  mental: ['intuition', 'awareness', 'willpower', 'memory', 'presence', 'authority', 'mediumship'],
  technical: [
    'ritualSkill',
    'protection',
    'hexWork',
    'healing',
    'herbalism',
    'divination',
    'potionMaking',
    'spiritNegotiation',
  ],
};

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Resolve a display stat's current value from a (possibly partial) stats object. */
export function resolveStatValue(stats: Partial<PlayerStats> | null | undefined, key: StatDisplayKey): number {
  if (!stats) return 0;
  for (const field of STAT_ALIASES[key]) {
    const v = toNumber((stats as Record<string, unknown>)[field as string]);
    if (v != null) return v;
  }
  return 0;
}

/** Maximum for a display stat, or undefined for skills with no meaningful max bar. */
export function resolveStatMax(
  stats: Partial<PlayerStats> | null | undefined,
  key: StatDisplayKey
): number | undefined {
  switch (key) {
    case 'health':
    case 'hunger':
    case 'stamina':
      return 100;
    case 'magicalEnergy':
      return magicalEnergyCap(toNumber(stats?.experience) ?? 0);
    default:
      return undefined;
  }
}
