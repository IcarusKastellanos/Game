import { playerLevel, type PlayerStats } from '../types/index.js';
import {
  getSurvivalConfig,
  hungerRegenMultiplierFromContent,
} from '../progression/progression-content.js';

export const MAX_PLAYER_LEVEL = 100;

export function clampPlayerLevel(level: number): number {
  return Math.max(1, Math.min(MAX_PLAYER_LEVEL, level));
}

/**
 * Exponential power curve for spell output and ME scaling.
 * Level 1 ≈ 0.12 · Level 50 ≈ 1.0 · Level 100 ≈ 10
 */
export function levelPowerMultiplier(experience: number): number {
  const level = clampPlayerLevel(playerLevel(experience));
  const t = (level - 1) / (MAX_PLAYER_LEVEL - 1);
  return 0.12 * Math.pow(10 / 0.12, t);
}

/** Max ME pool — weak at low level, vast at apex */
export function magicalEnergyCapForLevel(experience: number): number {
  const level = playerLevel(experience);
  const linear = 55 + level * 2.5;
  const apex = Math.pow(level / MAX_PLAYER_LEVEL, 2.2) * 200;
  return Math.round(linear + apex);
}

/** ME restored each regen tick (server applies on ~30s interval) */
export function computeMeRegenAmount(stats: PlayerStats): number {
  const level = playerLevel(stats.experience);
  const mult = levelPowerMultiplier(stats.experience);
  return mult * (0.06 * level + stats.ritualSkill / 100);
}

/** Scale spell potency by practitioner level */
export function scalePotencyByLevel(potency: number, experience: number): number {
  return potency * levelPowerMultiplier(experience);
}

/** Level-scaled contribution for focus / difficulty checks */
export function levelFocusBonus(experience: number): number {
  return levelPowerMultiplier(experience) * 2.5;
}

/** Personal protection skill — 10 at L1, +0.25 per level (~34 at L100). Not spell layers. */
export function protectionSkillFromLevel(experience: number): number {
  const level = playerLevel(experience);
  return Math.round(10 + (level - 1) * 0.25);
}

/** Recompute stats that scale purely with practitioner level. */
export function syncLevelDerivedStats(stats: PlayerStats): PlayerStats {
  return {
    ...stats,
    protection: protectionSkillFromLevel(stats.experience),
  };
}

// ── Survival (hunger / stamina) ─────────────────────────────────────────────
// Rates default from progression-content (hydrated from content/progression/stats.json on server boot).
export const HUNGER_DECAY_PER_MINUTE = 0.5;
export const HUNGER_LOW_THRESHOLD = 20;
export const HUNGER_CRITICAL_THRESHOLD = 10;
export const STAMINA_REGEN_PER_MINUTE = { idle: 3, eating: 6, sleeping: 12 } as const;
export const HUNGER_LOW_EFFECTS = { magicalEnergyRegenMultiplier: 0.5, staminaRegenMultiplier: 0.75 } as const;
export const MAX_HUNGER = 100;
export const MAX_STAMINA = 100;
export const MAX_HEALTH = 100;

export type SurvivalActivity = 'idle' | 'eating' | 'sleeping';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Regen multiplier applied to ME/stamina while under-fed (content-driven bands). */
export function hungerRegenMultiplier(hunger: number, kind: 'stamina' | 'magicalEnergy'): number {
  return hungerRegenMultiplierFromContent(hunger, kind);
}

/**
 * Apply hunger decay + stamina regeneration for an elapsed span. Pure — returns a
 * new stats object. Hunger only decays while idle; stamina regen rate depends on
 * activity and is penalised when hunger is low.
 */
export function applySurvivalTick(
  stats: PlayerStats,
  elapsedMs: number,
  activity: SurvivalActivity = 'idle'
): PlayerStats {
  const cfg = getSurvivalConfig();
  const minutes = Math.max(0, elapsedMs) / 60000;
  const hunger =
    activity === 'idle'
      ? clamp(
          (stats.hunger ?? MAX_HUNGER) - cfg.hungerDecayPerMinute * minutes,
          0,
          MAX_HUNGER
        )
      : clamp(stats.hunger ?? MAX_HUNGER, 0, MAX_HUNGER);
  const staminaRate =
    cfg.staminaRegenPerMinute[activity] * hungerRegenMultiplier(hunger, 'stamina');
  const stamina = clamp((stats.stamina ?? MAX_STAMINA) + staminaRate * minutes, 0, MAX_STAMINA);
  const health =
    activity === 'sleeping'
      ? clamp(
          (stats.health ?? MAX_HEALTH) + cfg.sleepHealthRegenPerMinute * minutes,
          0,
          MAX_HEALTH
        )
      : stats.health ?? MAX_HEALTH;
  return { ...stats, hunger, stamina, health };
}
