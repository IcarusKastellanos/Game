import type { PlayerStats } from '../types/index.js';
import { clampPlayerStatValue } from '../constants/index.js';
import { STAT_ALIASES, STAT_GROUPS, type StatDisplayKey } from './stats-catalog.js';
import type { PlayerProgression } from './index.js';

export type TechnicalSkillKey = (typeof STAT_GROUPS.technical)[number];

export const TECHNICAL_SKILL_KEYS = STAT_GROUPS.technical as readonly TechnicalSkillKey[];

export function isTechnicalSkillKey(key: string): key is TechnicalSkillKey {
  return (TECHNICAL_SKILL_KEYS as readonly string[]).includes(key);
}

/**
 * Practice required to raise a technical skill one rank.
 * The cost climbs with the current rank, so later aptitude takes longer to earn.
 */
export function skillXpThreshold(skillLevel: number): number {
  const level = Math.max(0, Math.floor(skillLevel));
  return Math.max(20, Math.round(24 + level * 10 + level * level * 3));
}

export function getSkillXp(progression: PlayerProgression, skillKey: TechnicalSkillKey): number {
  const raw = progression.skillXp?.[skillKey];
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, raw) : 0;
}

function readSkillValue(stats: PlayerStats, skillKey: TechnicalSkillKey): number {
  for (const field of STAT_ALIASES[skillKey]) {
    const v = stats[field];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return 0;
}

function writeSkillValue(stats: PlayerStats, skillKey: TechnicalSkillKey, value: number): PlayerStats {
  const field = STAT_ALIASES[skillKey][0];
  return {
    ...stats,
    [field]: clampPlayerStatValue(String(field), value, stats.experience ?? 0),
  };
}

export interface GrantSkillXpResult {
  stats: PlayerStats;
  progression: PlayerProgression;
  gainedLevels: number;
  skillKey: TechnicalSkillKey;
  xp: number;
  xpToNext: number;
}

/**
 * Apply technical-skill XP. Levels raise the underlying PlayerStats skill when
 * the pool crosses {@link skillXpThreshold}. Display-only pools live on progression.
 */
export function grantSkillXp(
  stats: PlayerStats,
  progression: PlayerProgression,
  skillKey: TechnicalSkillKey,
  amount: number
): GrantSkillXpResult {
  const add = Math.max(0, Math.floor(amount));
  let nextStats = stats;
  let xp = getSkillXp(progression, skillKey) + add;
  let gainedLevels = 0;
  let skillLevel = readSkillValue(nextStats, skillKey);

  while (add > 0 && xp >= skillXpThreshold(skillLevel)) {
    xp -= skillXpThreshold(skillLevel);
    skillLevel += 1;
    gainedLevels += 1;
    nextStats = writeSkillValue(nextStats, skillKey, skillLevel);
  }

  const skillXp = { ...(progression.skillXp ?? {}), [skillKey]: xp };
  return {
    stats: nextStats,
    progression: { ...progression, skillXp },
    gainedLevels,
    skillKey,
    xp,
    xpToNext: skillXpThreshold(readSkillValue(nextStats, skillKey)),
  };
}

/** Map free-form grant keys (books, content) onto technical display keys when possible. */
export function resolveTechnicalSkillKey(raw: string): TechnicalSkillKey | null {
  if (isTechnicalSkillKey(raw)) return raw;
  const aliases: Record<string, TechnicalSkillKey> = {
    cursecraft: 'hexWork',
    warding: 'protection',
    divinationSkill: 'divination',
    ritual: 'ritualSkill',
  };
  return aliases[raw] ?? null;
}

export function skillXpProgress(
  progression: PlayerProgression,
  stats: PlayerStats,
  skillKey: TechnicalSkillKey
): { xp: number; xpToNext: number; ratio: number } {
  const xp = getSkillXp(progression, skillKey);
  const xpToNext = skillXpThreshold(readSkillValue(stats, skillKey));
  return { xp, xpToNext, ratio: xpToNext > 0 ? Math.min(1, xp / xpToNext) : 0 };
}

export type { StatDisplayKey };
