import type { PlayerStats } from '../types/index.js';
import { playerLevelFromExperience, setLevelUpEvents, patchLevelCurve, type LevelUpEventDef } from './level-curve.js';

/** Stats an admin can raise as a floor when a practitioner reaches a level. */
export const LEVEL_STAT_FLOOR_KEYS = [
  'protection',
  'ritualSkill',
  'intuition',
  'spiritualAwareness',
  'willpower',
  'memory',
  'presence',
  'authority',
  'mediumship',
  'herbalism',
  'warding',
  'healing',
  'divinationSkill',
  'cursecraft',
  'potionMaking',
  'spiritNegotiation',
] as const;

export type LevelStatFloorKey = (typeof LEVEL_STAT_FLOOR_KEYS)[number];

export interface SpiritRangeDef {
  /** Short name shown to players, e.g. "Household wisps". */
  label: string;
  minPower: number;
  maxPower: number;
  traditions: string[];
  notes: string;
}

export interface PractitionerLevelProfile {
  level: number;
  title: string;
  rankLabel: string;
  /** Toast fired when the practitioner reaches this level. */
  unlockMessage: string;
  /** Freeform admin notes. Not shown in the HUD. */
  notes: string;
  /** Extra max ME added on top of the curve at this level. */
  meCapBonus: number;
  spellIds: string[];
  recipeIds: string[];
  hexagramIds: string[];
  shopItemIds: string[];
  npcIds: string[];
  questIds: string[];
  spiritRange: SpiritRangeDef;
  /** Minimum stat values once this level is reached (raises only). */
  statFloors: Partial<Record<LevelStatFloorKey, number>>;
}

export interface LevelDocument {
  schemaVersion: number;
  maxLevel: number;
  xpPerLevel: number;
  levels: PractitionerLevelProfile[];
}

const EMPTY_RANGE = (): SpiritRangeDef => ({
  label: '',
  minPower: 0,
  maxPower: 10,
  traditions: [],
  notes: '',
});

let documentState: LevelDocument = {
  schemaVersion: 1,
  maxLevel: 10,
  xpPerLevel: 100,
  levels: [],
};

function asStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((v): v is string => typeof v === 'string' && v.length > 0))];
}

function num(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseSpiritRange(raw: unknown): SpiritRangeDef {
  if (!raw || typeof raw !== 'object') return EMPTY_RANGE();
  const o = raw as Record<string, unknown>;
  return {
    label: typeof o.label === 'string' ? o.label : '',
    minPower: num(o.minPower, 0),
    maxPower: num(o.maxPower, 10),
    traditions: asStringList(o.traditions),
    notes: typeof o.notes === 'string' ? o.notes : '',
  };
}

function parseFloors(raw: unknown): PractitionerLevelProfile['statFloors'] {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  const out: PractitionerLevelProfile['statFloors'] = {};
  for (const key of LEVEL_STAT_FLOOR_KEYS) {
    if (o[key] == null || o[key] === '') continue;
    const n = num(o[key], NaN);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}

function blankProfile(level: number): PractitionerLevelProfile {
  return {
    level,
    title: `Level ${level}`,
    rankLabel: `Rank ${level}`,
    unlockMessage: '',
    notes: '',
    meCapBonus: 0,
    spellIds: [],
    recipeIds: [],
    hexagramIds: [],
    shopItemIds: [],
    npcIds: [],
    questIds: [],
    spiritRange: EMPTY_RANGE(),
    statFloors: {},
  };
}

function parseProfile(raw: unknown, fallbackLevel: number): PractitionerLevelProfile {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const level = Math.max(1, Math.round(num(o.level, fallbackLevel)));
  const base = blankProfile(level);
  return {
    ...base,
    level,
    title: typeof o.title === 'string' && o.title.trim() ? o.title.trim() : base.title,
    rankLabel: typeof o.rankLabel === 'string' && o.rankLabel.trim() ? o.rankLabel.trim() : base.rankLabel,
    unlockMessage: typeof o.unlockMessage === 'string' ? o.unlockMessage : '',
    notes: typeof o.notes === 'string' ? o.notes : '',
    meCapBonus: num(o.meCapBonus, 0),
    spellIds: asStringList(o.spellIds),
    recipeIds: asStringList(o.recipeIds),
    hexagramIds: asStringList(o.hexagramIds),
    shopItemIds: asStringList(o.shopItemIds),
    npcIds: asStringList(o.npcIds),
    questIds: asStringList(o.questIds),
    spiritRange: parseSpiritRange(o.spiritRange),
    statFloors: parseFloors(o.statFloors),
  };
}

/** One content id belongs to the lowest level that lists it. */
function exclusiveBuckets(levels: PractitionerLevelProfile[]): PractitionerLevelProfile[] {
  const seen = new Map<string, string>();
  return levels.map((level) => {
    const take = (bucket: string, ids: string[]): string[] => {
      const kept: string[] = [];
      for (const id of ids) {
        const key = `${bucket}:${id}`;
        if (seen.has(key)) continue;
        seen.set(key, String(level.level));
        kept.push(id);
      }
      return kept;
    };
    return {
      ...level,
      spellIds: take('spell', level.spellIds),
      recipeIds: take('recipe', level.recipeIds),
      hexagramIds: take('hex', level.hexagramIds),
      shopItemIds: take('shop', level.shopItemIds),
      npcIds: take('npc', level.npcIds),
      questIds: take('quest', level.questIds),
    };
  });
}

export function normalizeLevelDocument(raw: unknown): LevelDocument {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const maxLevel = Math.max(1, Math.min(50, Math.round(num(o.maxLevel, 10))));
  const xpPerLevel = Math.max(1, Math.round(num(o.xpPerLevel, 100)));
  const incoming = Array.isArray(o.levels) ? o.levels.map((row, i) => parseProfile(row, i + 1)) : [];
  const byLevel = new Map<number, PractitionerLevelProfile>();
  for (const row of incoming) {
    if (row.level >= 1 && row.level <= maxLevel && !byLevel.has(row.level)) {
      byLevel.set(row.level, row);
    }
  }
  const levels: PractitionerLevelProfile[] = [];
  for (let level = 1; level <= maxLevel; level++) {
    levels.push(byLevel.get(level) ?? blankProfile(level));
  }
  return {
    schemaVersion: 1,
    maxLevel,
    xpPerLevel,
    levels: exclusiveBuckets(levels),
  };
}

export function setLevelProfiles(raw: unknown): void {
  documentState = normalizeLevelDocument(raw);
  const events: LevelUpEventDef[] = documentState.levels
    .filter((level) => level.level > 1 && level.unlockMessage.trim())
    .map((level) => ({
      atLevel: level.level,
      eventId: `level_up_${level.level}`,
      message: level.unlockMessage.trim(),
    }));
  if (events.length) setLevelUpEvents(events);
  patchLevelCurve({ maxLevel: documentState.maxLevel, xpPerLevel: documentState.xpPerLevel });
}

export function getLevelDocument(): LevelDocument {
  return documentState;
}

export function getLevelProfile(level: number): PractitionerLevelProfile | undefined {
  return documentState.levels.find((row) => row.level === level);
}

export function getLevelTitle(level: number): string {
  return getLevelProfile(level)?.title ?? `Level ${level}`;
}

export function getLevelRankLabel(level: number): string {
  return getLevelProfile(level)?.rankLabel ?? `Rank ${level}`;
}

export function spiritRangeForLevel(level: number): SpiritRangeDef {
  return getLevelProfile(level)?.spiritRange ?? EMPTY_RANGE();
}

type UnlockBucket = 'spellIds' | 'recipeIds' | 'hexagramIds' | 'shopItemIds' | 'npcIds' | 'questIds';

/** Level that unlocks this id, or null when it is not assigned (open to everyone). */
export function assignedUnlockLevel(bucket: UnlockBucket, id: string): number | null {
  for (const level of documentState.levels) {
    if (level[bucket].includes(id)) return level.level;
  }
  return null;
}

export function meetsAssignedUnlock(bucket: UnlockBucket, id: string, experience: number): boolean {
  const need = assignedUnlockLevel(bucket, id);
  if (need == null) return true;
  return playerLevelFromExperience(experience) >= need;
}

/** Highest floor for each stat across levels the practitioner has reached. */
export function cumulativeStatFloors(level: number): Partial<Record<LevelStatFloorKey, number>> {
  const out: Partial<Record<LevelStatFloorKey, number>> = {};
  for (const row of documentState.levels) {
    if (row.level > level) continue;
    for (const key of LEVEL_STAT_FLOOR_KEYS) {
      const floor = row.statFloors[key];
      if (floor == null) continue;
      const prev = out[key];
      out[key] = prev == null ? floor : Math.max(prev, floor);
    }
  }
  return out;
}

export function levelMeCapBonus(level: number): number {
  return getLevelProfile(level)?.meCapBonus ?? 0;
}

/** Raise stats that sit under the level's floors. Never lowers a stat. */
export function applyLevelStatFloors(stats: PlayerStats): PlayerStats {
  const level = playerLevelFromExperience(stats.experience ?? 0);
  const floors = cumulativeStatFloors(level);
  const next: PlayerStats = { ...stats };
  for (const key of LEVEL_STAT_FLOOR_KEYS) {
    const floor = floors[key];
    if (floor == null) continue;
    const current = next[key];
    if (typeof current === 'number' && current < floor) {
      (next as unknown as Record<string, number>)[key] = floor;
    }
  }
  return next;
}
