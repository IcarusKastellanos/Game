export * from './types/index.js';
export * from './admin/permissions.js';
export * from './balance/index.js';
export * from './display/labels.js';
export * from './constants/index.js';
export * from './messages/index.js';
export * from './validation/names.js';
export * from './icons/item-icon-pixels.js';
export * from './icons/icon-hash.js';
export * from './inventory/index.js';
export * from './ward-web/index.js';
export * from './map-builder/index.js';
export * from './hud/index.js';
export * from './hud/intuition.js';
export * from './progression/index.js';
export * from './progression/stats-catalog.js';
export * from './progression/progression-content.js';
export * from './progression/skill-xp.js';
export * from './progression/reputation.js';
export * from './progression/xp-sources.js';
export * from './progression/level-curve.js';
export * from './progression/level-profiles.js';
export * from './progression/recognition.js';
export * from './hexagram/index.js';
export * from './pocket-spell/index.js';
export * from './cleanser/index.js';

// Explicit re-exports for Vite / ESM consumers when using source directly
export {
  HEX_INTENTS,
  MAX_ITEM_STACK,
  ME_CAP_BASE,
  ME_CAP_PER_LEVEL,
  PENTACLE_SLOT_CATEGORIES,
  TAGLOCK_STRENGTH,
  TILE_SIZE,
  PLAYER_SPEED,
  DEFAULT_STATS,
  CORE_STAT_MAX,
  toFiniteNumber,
  magicalEnergyCap,
  clampMagicalEnergy,
  clampPlayerStatValue,
  normalizePlayerStats,
  EXTENDED_STAT_KEYS,
  extendedStatsRecord,
  extendedStatsNeedsMigration,
  NULLIFICATION_POWDER_ITEM_ID,
} from './constants/index.js';
export {
  MAX_PLAYER_LEVEL,
  clampPlayerLevel,
  levelPowerMultiplier,
  magicalEnergyCapForLevel,
  computeMeRegenAmount,
  scalePotencyByLevel,
  levelFocusBonus,
  protectionSkillFromLevel,
  syncLevelDerivedStats,
} from './balance/index.js';
export { formatContentLabel, resolveDisplayLabel } from './display/labels.js';
