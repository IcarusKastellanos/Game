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
export * from './progression/licenses.js';
export * from './chat/filter.js';
export * from './grimoire/markup.js';
export * from './dialogue/index.js';
export * from './dialogue/actions.js';
export * from './npc/schedule.js';
export * from './npc/personality.js';
export * from './npc/knowledge.js';
export * from './npc/lessons.js';
export * from './npc/behavior.js';
export * from './npc/encounter.js';
export * from './npc/discovery.js';
export * from './npc/client-export.js';
export * from './npc/authoring.js';
export * from './npc/sync.js';
export * from './npc/ownership.js';
export * from './npc/diagnostics.js';
export * from './npc/presence-diff.js';
export * from './npc/experiment.js';
export * from './npc/visual.js';
export * from './npc/teacher-gates.js';
export * from './quests/engine.js';
export * from './social/index.js';
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
