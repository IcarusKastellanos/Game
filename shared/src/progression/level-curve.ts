/** Local parse — avoid importing constants (breaks types ↔ balance cycles). */
function toFiniteNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export interface LevelUpEventDef {
  atLevel: number;
  eventId: string;
  message: string;
}

export interface LevelCurveConfig {
  maxLevel: number;
  xpPerLevel: number;
  power: { minMultiplier: number; maxMultiplier: number };
  meCap: { base: number; perLevel: number; apexScale: number; apexExponent: number };
  protection: { base: number; perLevel: number };
  onLevelUp: LevelUpEventDef[];
}

const DEFAULT_CURVE: LevelCurveConfig = {
  maxLevel: 10,
  xpPerLevel: 100,
  power: { minMultiplier: 0.12, maxMultiplier: 2.5 },
  meCap: { base: 55, perLevel: 4, apexScale: 35, apexExponent: 1.8 },
  protection: { base: 10, perLevel: 1.5 },
  onLevelUp: [],
};

let curve: LevelCurveConfig = { ...DEFAULT_CURVE, onLevelUp: [] };

function parseOnLevelUp(raw: unknown): LevelUpEventDef[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const o = row as Record<string, unknown>;
      const atLevel = toFiniteNumber(o.atLevel);
      const eventId = typeof o.eventId === 'string' ? o.eventId : null;
      const message = typeof o.message === 'string' ? o.message : null;
      if (atLevel == null || !eventId || !message) return null;
      return { atLevel: Math.round(atLevel), eventId, message };
    })
    .filter((e): e is LevelUpEventDef => e != null);
}

/** Hydrate level curve from `content/progression/level-curve.json`. */
export function setLevelCurveContent(raw: unknown): void {
  if (!raw || typeof raw !== 'object') {
    curve = { ...DEFAULT_CURVE, onLevelUp: [...DEFAULT_CURVE.onLevelUp] };
    return;
  }
  const o = raw as Record<string, unknown>;
  const power = (o.power as Record<string, unknown> | undefined) ?? {};
  const meCap = (o.meCap as Record<string, unknown> | undefined) ?? {};
  const protection = (o.protection as Record<string, unknown> | undefined) ?? {};
  curve = {
    maxLevel: Math.max(1, Math.round(toFiniteNumber(o.maxLevel) ?? DEFAULT_CURVE.maxLevel)),
    xpPerLevel: Math.max(1, Math.round(toFiniteNumber(o.xpPerLevel) ?? DEFAULT_CURVE.xpPerLevel)),
    power: {
      minMultiplier: toFiniteNumber(power.minMultiplier) ?? DEFAULT_CURVE.power.minMultiplier,
      maxMultiplier: toFiniteNumber(power.maxMultiplier) ?? DEFAULT_CURVE.power.maxMultiplier,
    },
    meCap: {
      base: toFiniteNumber(meCap.base) ?? DEFAULT_CURVE.meCap.base,
      perLevel: toFiniteNumber(meCap.perLevel) ?? DEFAULT_CURVE.meCap.perLevel,
      apexScale: toFiniteNumber(meCap.apexScale) ?? DEFAULT_CURVE.meCap.apexScale,
      apexExponent: toFiniteNumber(meCap.apexExponent) ?? DEFAULT_CURVE.meCap.apexExponent,
    },
    protection: {
      base: toFiniteNumber(protection.base) ?? DEFAULT_CURVE.protection.base,
      perLevel: toFiniteNumber(protection.perLevel) ?? DEFAULT_CURVE.protection.perLevel,
    },
    onLevelUp: parseOnLevelUp(o.onLevelUp),
  };
}

export function getLevelCurve(): LevelCurveConfig {
  return curve;
}

/** Runtime max Practitioner Level (content-driven; default 10). */
export function getMaxPlayerLevel(): number {
  return curve.maxLevel;
}

/** XP required to advance one practitioner level. */
export function getXpPerLevel(): number {
  return curve.xpPerLevel;
}

/** Total XP at which a level is reached (level 1 = 0). */
export function experienceForLevel(level: number): number {
  const capped = Math.max(1, Math.min(curve.maxLevel, Math.floor(level)));
  return (capped - 1) * curve.xpPerLevel;
}

/** Soft cap so grants cannot push past max level. */
export function experienceCap(): number {
  return experienceForLevel(curve.maxLevel);
}

export function playerLevelFromExperience(experience: number): number {
  const xp = Math.max(0, experience);
  return Math.min(curve.maxLevel, 1 + Math.floor(xp / curve.xpPerLevel));
}

export function clampPlayerLevelValue(level: number): number {
  return Math.max(1, Math.min(curve.maxLevel, level));
}

export function meetsMinLevel(experience: number, minLevel: number | null | undefined): boolean {
  if (minLevel == null || minLevel <= 1) return true;
  return playerLevelFromExperience(experience) >= minLevel;
}

export function levelGateMessage(contentName: string, minLevel: number, currentLevel: number): string {
  return `${contentName} requires Practitioner Level ${minLevel} (you are Level ${currentLevel}).`;
}

/**
 * Exponential power curve for spell output — scales between content min/max
 * across levels 1…maxLevel.
 */
export function levelPowerMultiplierFromCurve(experience: number): number {
  const level = clampPlayerLevelValue(playerLevelFromExperience(experience));
  const span = Math.max(1, curve.maxLevel - 1);
  const t = (level - 1) / span;
  const { minMultiplier, maxMultiplier } = curve.power;
  return minMultiplier * Math.pow(maxMultiplier / minMultiplier, t);
}

export function magicalEnergyCapFromCurve(experience: number): number {
  const level = playerLevelFromExperience(experience);
  const { base, perLevel, apexScale, apexExponent } = curve.meCap;
  const linear = base + level * perLevel;
  const apex = Math.pow(level / curve.maxLevel, apexExponent) * apexScale;
  return Math.round(linear + apex);
}

export function protectionSkillFromCurve(experience: number): number {
  const level = playerLevelFromExperience(experience);
  return Math.round(curve.protection.base + (level - 1) * curve.protection.perLevel);
}

/** Content events fired when crossing into `levelAfter` (inclusive of multi-level jumps). */
export function levelUpEventsBetween(levelBefore: number, levelAfter: number): LevelUpEventDef[] {
  if (levelAfter <= levelBefore) return [];
  return curve.onLevelUp.filter((e) => e.atLevel > levelBefore && e.atLevel <= levelAfter);
}

/** XP progress within the current practitioner level. */
export function practitionerXpProgressFromCurve(experience: number): {
  level: number;
  xpIntoLevel: number;
  xpToNext: number;
  ratio: number;
  isMaxLevel: boolean;
} {
  const level = playerLevelFromExperience(experience);
  const isMaxLevel = level >= curve.maxLevel;
  if (isMaxLevel) {
    return { level, xpIntoLevel: curve.xpPerLevel, xpToNext: curve.xpPerLevel, ratio: 1, isMaxLevel: true };
  }
  const xpIntoLevel = experience % curve.xpPerLevel;
  return {
    level,
    xpIntoLevel,
    xpToNext: curve.xpPerLevel,
    ratio: xpIntoLevel / curve.xpPerLevel,
    isMaxLevel: false,
  };
}
