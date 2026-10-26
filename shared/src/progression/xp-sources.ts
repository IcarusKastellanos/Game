import type { MagicTradition, PlayerStats } from '../types/index.js';
import { playerLevel } from '../types/index.js';
import { clampMagicalEnergy, clampPlayerStatValue, toFiniteNumber } from '../constants/index.js';
import { syncLevelDerivedStats } from '../balance/index.js';
import type { PlayerProgression } from './index.js';
import { grantSkillXp, resolveTechnicalSkillKey, type TechnicalSkillKey } from './skill-xp.js';
import {
  experienceCap,
  levelUpEventsBetween,
  practitionerXpProgressFromCurve,
  type LevelUpEventDef,
} from './level-curve.js';

export interface XpSourceDef {
  actionId: string;
  label: string;
  baseXp: number;
  skillTags: string[];
  tradition?: MagicTradition | null;
  cooldownMs: number;
}

export interface RecentXpEntry {
  actionId: string;
  label: string;
  amount: number;
  at: number;
  levelBefore: number;
  levelAfter: number;
}

// PlayerProgression.recentXp uses this shape — kept here to avoid circular value imports.

export interface GrantExperienceContext {
  now?: number;
  /** Multiply base XP (quest bonuses, events). */
  multiplier?: number;
  /** Override base XP from the registry. */
  amountOverride?: number;
  tradition?: MagicTradition;
  /** Extra skill tags merged with the source definition. */
  extraSkillTags?: string[];
}

export interface GrantExperienceResult {
  stats: PlayerStats;
  progression: PlayerProgression;
  granted: number;
  leveledUp: boolean;
  levelBefore: number;
  levelAfter: number;
  source: XpSourceDef | null;
  skippedReason?: 'unknown_source' | 'cooldown';
  /** Content onLevelUp events crossed by this grant. */
  levelUpEvents: LevelUpEventDef[];
}

const RECENT_XP_LIMIT = 12;

const DEFAULT_SOURCES: XpSourceDef[] = [
  {
    actionId: 'spell_cast_success',
    label: 'Successful spell or altar working',
    baseXp: 5,
    skillTags: ['ritualSkill'],
    cooldownMs: 0,
  },
  {
    actionId: 'read_book',
    label: 'Finish studying a book',
    baseXp: 8,
    skillTags: ['memory'],
    cooldownMs: 0,
  },
  {
    actionId: 'craft_success',
    label: 'Craft a recipe at a station',
    baseXp: 6,
    skillTags: ['herbalism', 'potionMaking'],
    cooldownMs: 0,
  },
  {
    actionId: 'quest_complete',
    label: 'Complete a quest',
    baseXp: 20,
    skillTags: [],
    cooldownMs: 0,
  },
];

let sourcesById = new Map<string, XpSourceDef>(DEFAULT_SOURCES.map((s) => [s.actionId, s]));
let skillXpFactor = 12;

function parseSource(raw: unknown): XpSourceDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const actionId = typeof o.actionId === 'string' ? o.actionId : null;
  const baseXp = toFiniteNumber(o.baseXp);
  if (!actionId || baseXp == null || baseXp < 0) return null;
  return {
    actionId,
    label: typeof o.label === 'string' ? o.label : actionId,
    baseXp,
    skillTags: Array.isArray(o.skillTags)
      ? o.skillTags.filter((t): t is string => typeof t === 'string')
      : [],
    tradition: (o.tradition as MagicTradition | null | undefined) ?? null,
    cooldownMs: Math.max(0, toFiniteNumber(o.cooldownMs) ?? 0),
  };
}

export function setXpSourcesContent(raw: unknown): void {
  const root = raw as { sources?: unknown[]; defaults?: { skillXpFactor?: unknown } } | null;
  if (root?.defaults) {
    const factor = toFiniteNumber(root.defaults.skillXpFactor);
    if (factor != null && factor > 0) skillXpFactor = factor;
  }
  const next = new Map<string, XpSourceDef>();
  const list = Array.isArray(root?.sources) ? root!.sources! : DEFAULT_SOURCES;
  for (const row of list) {
    const parsed = parseSource(row);
    if (parsed) next.set(parsed.actionId, parsed);
  }
  if (next.size === 0) {
    sourcesById = new Map(DEFAULT_SOURCES.map((s) => [s.actionId, s]));
    return;
  }
  sourcesById = next;
}

export function getXpSource(actionId: string): XpSourceDef | undefined {
  return sourcesById.get(actionId);
}

export function listXpSources(): XpSourceDef[] {
  return [...sourcesById.values()];
}

function pushRecent(
  progression: PlayerProgression,
  entry: RecentXpEntry
): PlayerProgression {
  const recentXp = [...(progression.recentXp ?? []), entry].slice(-RECENT_XP_LIMIT);
  return { ...progression, recentXp };
}

function cooldownMap(progression: PlayerProgression): Record<string, number> {
  return { ...(progression.xpSourceCooldowns ?? {}) };
}

/**
 * Central XP grant. All gameplay handlers should call this instead of mutating
 * `stats.experience` directly.
 */
export function grantExperience(
  stats: PlayerStats,
  progression: PlayerProgression,
  sourceId: string,
  context: GrantExperienceContext = {}
): GrantExperienceResult {
  const source = getXpSource(sourceId) ?? null;
  if (!source) {
    const level = playerLevel(stats.experience ?? 0);
    return {
      stats,
      progression,
      granted: 0,
      leveledUp: false,
      levelBefore: level,
      levelAfter: level,
      source: null,
      skippedReason: 'unknown_source',
      levelUpEvents: [],
    };
  }

  const now = context.now ?? Date.now();
  const cooldowns = cooldownMap(progression);
  const readyAt = cooldowns[source.actionId] ?? 0;
  if (source.cooldownMs > 0 && now < readyAt) {
    const level = playerLevel(stats.experience ?? 0);
    return {
      stats,
      progression,
      granted: 0,
      leveledUp: false,
      levelBefore: level,
      levelAfter: level,
      source,
      skippedReason: 'cooldown',
      levelUpEvents: [],
    };
  }

  const mult = context.multiplier != null && context.multiplier > 0 ? context.multiplier : 1;
  const rawAmount =
    context.amountOverride != null ? context.amountOverride : source.baseXp * mult;
  const levelBefore = playerLevel(stats.experience ?? 0);
  const beforeXp = stats.experience ?? 0;
  const cap = experienceCap();
  const room = Math.max(0, cap - beforeXp);
  const granted = Math.max(0, Math.min(room, Math.round(rawAmount)));

  let nextStats: PlayerStats = {
    ...stats,
    experience: clampPlayerStatValue('experience', beforeXp + granted, beforeXp),
  };
  nextStats = syncLevelDerivedStats(nextStats);
  const levelAfter = playerLevel(nextStats.experience ?? 0);
  const levelUpEvents = levelUpEventsBetween(levelBefore, levelAfter);

  let nextProgression: PlayerProgression = { ...progression };
  if (source.cooldownMs > 0) {
    nextProgression = {
      ...nextProgression,
      xpSourceCooldowns: { ...cooldowns, [source.actionId]: now + source.cooldownMs },
    };
  }

  const tags = [...source.skillTags, ...(context.extraSkillTags ?? [])];
  for (const tag of tags) {
    const tech = resolveTechnicalSkillKey(tag);
    if (tech) {
      const skillGrant = grantSkillXp(
        nextStats,
        nextProgression,
        tech,
        Math.max(1, Math.round(granted * (skillXpFactor / 12)))
      );
      nextStats = skillGrant.stats;
      nextProgression = skillGrant.progression;
      continue;
    }
    // Soft mental/core bumps from skillTags that aren't technical skills
    const key = tag as keyof PlayerStats;
    if (typeof nextStats[key] === 'number' && tag !== 'experience') {
      nextStats = {
        ...nextStats,
        [key]: clampPlayerStatValue(
          tag,
          (nextStats[key] as number) + Math.max(0.1, granted * 0.05),
          nextStats.experience
        ),
      };
    }
  }

  const tradition = context.tradition ?? source.tradition ?? null;
  if (tradition) {
    nextStats = {
      ...nextStats,
      affinities: {
        ...nextStats.affinities,
        [tradition]: clampPlayerStatValue(
          'affinity',
          (nextStats.affinities[tradition] ?? 0) + Math.max(0.2, granted * 0.05),
          nextStats.experience
        ),
      },
    };
  }

  nextStats = syncLevelDerivedStats(nextStats);
  nextStats = {
    ...nextStats,
    magicalEnergy: clampMagicalEnergy(nextStats.magicalEnergy, nextStats.experience ?? 0),
  };

  if (granted > 0) {
    nextProgression = pushRecent(nextProgression, {
      actionId: source.actionId,
      label: source.label,
      amount: granted,
      at: now,
      levelBefore,
      levelAfter,
    });
  }

  return {
    stats: nextStats,
    progression: nextProgression,
    granted,
    leveledUp: levelAfter > levelBefore,
    levelBefore,
    levelAfter,
    source,
    levelUpEvents,
  };
}

/** XP progress within the current practitioner level (content curve). */
export function practitionerXpProgress(experience: number): {
  level: number;
  xpIntoLevel: number;
  xpToNext: number;
  ratio: number;
  isMaxLevel?: boolean;
} {
  return practitionerXpProgressFromCurve(experience);
}

export type { TechnicalSkillKey };
