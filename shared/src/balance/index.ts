import { playerLevel, type PlayerStats } from '../types/index.js';
import {
  getSurvivalConfig,
  hungerRegenMultiplierFromContent,
} from '../progression/progression-content.js';
import {
  getMaxPlayerLevel,
  levelPowerMultiplierFromCurve,
  magicalEnergyCapFromCurve,
  protectionSkillFromCurve,
  clampPlayerLevelValue,
  playerLevelFromExperience,
} from '../progression/level-curve.js';
import { applyLevelStatFloors, levelMeCapBonus } from '../progression/level-profiles.js';

/** @deprecated Prefer getMaxPlayerLevel() — kept as a live getter for importers. */
export const MAX_PLAYER_LEVEL = 10;

export function clampPlayerLevel(level: number): number {
  return clampPlayerLevelValue(level);
}

/**
 * Exponential power curve for spell output and ME scaling.
 * Tuned via content/progression/level-curve.json (default max Level 10).
 */
export function levelPowerMultiplier(experience: number): number {
  return levelPowerMultiplierFromCurve(experience);
}

/** Max ME pool — curve plus the admin per-level ME bonus. */
export function magicalEnergyCapForLevel(experience: number): number {
  const bonus = levelMeCapBonus(playerLevelFromExperience(experience));
  return magicalEnergyCapFromCurve(experience) + Math.round(bonus);
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

/** Personal protection skill — content curve (default 10 at L1, +1.5/level). */
export function protectionSkillFromLevel(experience: number): number {
  return protectionSkillFromCurve(experience);
}

/** Recompute stats that scale purely with practitioner level, then raise stat floors. */
export function syncLevelDerivedStats(stats: PlayerStats): PlayerStats {
  return applyLevelStatFloors({
    ...stats,
    protection: protectionSkillFromLevel(stats.experience),
  });
}

// Re-export live max for call sites that previously imported the constant.
export { getMaxPlayerLevel };

// ── Survival (hunger / stamina) ─────────────────────────────────────────────
// Rates default from progression-content (hydrated from content/progression/stats.json on server boot).
/** Two-thirds of the previous 0.5-per-minute drain. Live ticks read getSurvivalConfig(). */
export const HUNGER_DECAY_PER_MINUTE = 1 / 3;
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
