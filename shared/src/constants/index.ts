import { magicalEnergyCapForLevel, syncLevelDerivedStats } from '../balance/index.js';
import type { MagicTradition, PlayerStats } from '../types/index.js';

export const GAME_VERSION = '0.1.0';

export const DEFAULT_STATS: PlayerStats = {
  health: 100,
  hunger: 80,
  magicalEnergy: 55,
  protection: 10,
  intuition: 4,
  spiritualAwareness: 4,
  divinationSkill: 2,
  herbalism: 2,
  cursecraft: 1,
  warding: 2,
  healing: 2,
  ritualSkill: 2,
  experience: 0,
  reputation: 0,
  publicReputation: 0,
  spiritualReputation: 0,
  morality: 0,
  affinities: {
    traditional_european: 8,
    chaos_magic: 0,
    vodou: 0,
    nordic_seidr: 0,
    greek_mageia: 0,
  },
  // Extended attributes
  stamina: 100,
  willpower: 1,
  memory: 1,
  presence: 1,
  authority: 1,
  mediumship: 1,
  potionMaking: 1,
  spiritNegotiation: 1,
};

/** Max value for core resources that are not level-scaled (ME uses magicalEnergyCap). */
export const CORE_STAT_MAX = {
  health: 100,
  hunger: 100,
  stamina: 100,
} as const;

/** Parse anything into a finite number, else null. Preserves valid 0. */
export function toFiniteNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export const STAT_MAX = 100;
/** Base ME pool before level bonus */
export const ME_CAP_BASE = 100;
/** +2 max ME per player level */
export const ME_CAP_PER_LEVEL = 2;

export function magicalEnergyCap(experience: number): number {
  return magicalEnergyCapForLevel(experience);
}

export function clampMagicalEnergy(magicalEnergy: number, experience: number): number {
  return Math.max(0, Math.min(magicalEnergyCap(experience), magicalEnergy));
}

/** Signed reputation / morality tracks use −100…100 (not 0…100). */
const SIGNED_STAT_KEYS = new Set([
  'reputation',
  'publicReputation',
  'spiritualReputation',
  'morality',
]);

/** Clamp a player stat — ME uses 100 + 2×level; most skills cap at STAT_MAX. */
export function clampPlayerStatValue(statKey: string, value: number, experience: number): number {
  if (statKey === 'magicalEnergy') return clampMagicalEnergy(value, experience);
  if (statKey === 'experience') return Math.max(0, value);
  if (SIGNED_STAT_KEYS.has(statKey)) return Math.max(-STAT_MAX, Math.min(STAT_MAX, value));
  return Math.max(0, Math.min(STAT_MAX, value));
}

const NUMERIC_STAT_KEYS: (keyof PlayerStats)[] = [
  'health',
  'hunger',
  'magicalEnergy',
  'protection',
  'intuition',
  'spiritualAwareness',
  'divinationSkill',
  'herbalism',
  'cursecraft',
  'warding',
  'healing',
  'ritualSkill',
  'experience',
  'reputation',
  'morality',
];

/**
 * Extended attribute keys added for the Aura & Wards screen. Each resolves from
 * its canonical key first, then a legacy alias, then the DEFAULT_STATS value.
 * Values are never derived from `||` so a valid stored 0 is preserved.
 */
const EXTENDED_STAT_ALIASES: Record<string, readonly string[]> = {
  stamina: ['stamina'],
  willpower: ['willpower'],
  memory: ['memory'],
  presence: ['presence'],
  authority: ['authority'],
  mediumship: ['mediumship'],
  potionMaking: ['potionMaking'],
  spiritNegotiation: ['spiritNegotiation'],
  spiritualReputation: ['spiritualReputation'],
};

/** Keys stored in PlayerStats.extendedStats (not as their own columns). */
export const EXTENDED_STAT_KEYS = Object.keys(EXTENDED_STAT_ALIASES);

/** JSON blob written to PlayerStats.extendedStats. */
export function extendedStatsRecord(stats: PlayerStats): Record<string, number> {
  const source = stats as unknown as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const key of EXTENDED_STAT_KEYS) {
    const value = toFiniteNumber(source[key]);
    const fallback = (DEFAULT_STATS as unknown as Record<string, unknown>)[key];
    out[key] = typeof value === 'number' ? value : (fallback as number);
  }
  // Dual reputation: public is also mirrored on the reputation column; spiritual is JSON-only.
  const publicRep =
    toFiniteNumber(source.publicReputation) ?? toFiniteNumber(source.reputation) ?? 0;
  out.publicReputation = publicRep;
  const spiritual =
    toFiniteNumber(source.spiritualReputation) ?? (DEFAULT_STATS.spiritualReputation as number);
  out.spiritualReputation = spiritual;
  return out;
}

/** True when a stored extendedStats object is missing a finite value for any extended key. */
export function extendedStatsNeedsMigration(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return true;
  const record = raw as Record<string, unknown>;
  return EXTENDED_STAT_KEYS.some((key) => toFiniteNumber(record[key]) == null);
}

/** Clamp all numeric stats (fixes legacy inflated values on load/save). */
export function normalizePlayerStats(stats: PlayerStats): PlayerStats {
  const experience = stats.experience ?? 0;
  const normalized = { ...stats, affinities: { ...stats.affinities } };
  for (const key of NUMERIC_STAT_KEYS) {
    if (key === 'protection') continue;
    (normalized[key] as number) = clampPlayerStatValue(key, Number(stats[key] ?? 0), experience);
  }
  const source = stats as unknown as Record<string, unknown>;
  const target = normalized as unknown as Record<string, unknown>;
  for (const [key, aliases] of Object.entries(EXTENDED_STAT_ALIASES)) {
    let raw: number | null = null;
    for (const alias of aliases) {
      raw = toFiniteNumber(source[alias]);
      if (raw != null) break;
    }
    const fallback = (DEFAULT_STATS as unknown as Record<string, unknown>)[key] as number;
    target[key] = clampPlayerStatValue(key, raw ?? fallback, experience);
  }

  // Reputation split: legacy `reputation` becomes publicReputation when missing.
  const publicRaw =
    toFiniteNumber(source.publicReputation) ?? toFiniteNumber(source.reputation) ?? 0;
  const publicRep = clampPlayerStatValue('reputation', publicRaw, experience);
  normalized.publicReputation = publicRep;
  normalized.reputation = publicRep;
  const spiritualRaw = toFiniteNumber(source.spiritualReputation) ?? 0;
  normalized.spiritualReputation = clampPlayerStatValue('reputation', spiritualRaw, experience);

  for (const tradition of Object.keys(normalized.affinities) as MagicTradition[]) {
    normalized.affinities[tradition] = clampPlayerStatValue(
      'affinity',
      Number(normalized.affinities[tradition] ?? 0),
      experience
    );
  }
  return syncLevelDerivedStats(normalized);
}
export const INVENTORY_MAX_SLOTS = 40;
export const MAX_ITEM_STACK = 30;

export const NULLIFICATION_POWDER_ITEM_ID = 'nullification_powder';

/** Taglock strength multipliers for spell accuracy/potency */
export const TAGLOCK_STRENGTH: Record<string, number> = {
  true_name: 1.0,
  blood: 0.95,
  hair: 0.85,
  personal_item: 0.75,
  written_name: 0.65,
  photo: 0.6,
  social_bond: 0.5,
  familiar_name: 0.9,
  self: 1.0,
};

/** Hex intent options for baneful workings */
export const HEX_INTENTS = [
  { id: 'weaken_power', label: 'Weaken their power', ingredient: 'black_salt' },
  { id: 'harm_wards', label: 'Harm wards/protections', ingredient: 'rusty_nail' },
  { id: 'harm_health', label: 'Harm their health', ingredient: 'glass_shard' },
  { id: 'harm_familiar', label: 'Harm their familiar', ingredient: 'thorn_branch' },
  { id: 'drain_energy', label: 'Drain magical energy', ingredient: 'black_candle' },
] as const;

export type HexIntentId = (typeof HEX_INTENTS)[number]['id'];

/** Ingredient category → pentacle slot mapping */
export const PENTACLE_SLOT_CATEGORIES: Record<string, string> = {
  candles: 'candles',
  herbs: 'herbs',
  incense: 'incense',
  oils: 'herbs',
  minerals: 'herbs',
  tools: 'herbs',
  poppets: 'poppets',
  written_petitions: 'petitions',
  offerings: 'herbs',
  food: 'herbs',
  medicine: 'herbs',
};

/** Registered magic systems — add new traditions without rewriting core.
 * TEMPORARY: all packs stay disabled in UI until tradition packs ship. Data keys remain. */
export const MAGIC_SYSTEMS: Record<
  MagicTradition,
  { label: string; enabled: boolean; description: string }
> = {
  traditional_european: {
    label: 'Traditional European Folk Magic',
    enabled: false, // was true — TEMPORARY: hide from player-facing tradition UI
    description: 'Candles, herbs, poppets, wards, and household charms.',
  },
  chaos_magic: {
    label: 'Chaos Magic',
    enabled: false,
    description: 'Sigils, belief-shifting, and experimental practice.',
  },
  vodou: {
    label: 'Vodou-Inspired Practice',
    enabled: false,
    description: 'Loa veneration, offerings, and spirit work.',
  },
  nordic_seidr: {
    label: 'Nordic Seidr',
    enabled: false,
    description: 'Seidr trance, runes, and ancestral magic.',
  },
  greek_mageia: {
    label: 'Greek Mageia',
    enabled: false,
    description: 'Phylacteries, defixiones, and Hellenistic ritual.',
  },
};

export const TILE_SIZE = 32;
/** Keep ~5 tiles/sec after the 16→32 art scale. */
export const PLAYER_SPEED = 160;

export const SCENE_TRANSITIONS: Record<string, { target: string; spawn: string }> = {
  apartment_door: { target: 'town', spawn: 'apartment_building' },
  town_apartment: { target: 'apartment', spawn: 'door' },
};
