/**
 * Expansion 2: Astral plane — designed, not fully implemented.
 * Entry via trance, sleep, dreamwork, herbs, or spirit-guided rituals.
 */
export type AstralEntryMethod =
  | 'trance'
  | 'sleep'
  | 'dreamwork'
  | 'herb'
  | 'spirit_guided';

export interface AstralConfig {
  minSpiritualAwareness: number;
  energyCostPerMinute: number;
}

export const ASTRAL_CONFIG: AstralConfig = {
  minSpiritualAwareness: 25,
  energyCostPerMinute: 2,
};

// TODO: AstralRoom separate Colyseus room with symbolic combat
// TODO: Spirit entity registry (ghosts, demons, thoughtforms)
// TODO: Familiar true-form reveal in astral vision
