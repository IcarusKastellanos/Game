/**
 * Expansion 1: Coven system — designed, not fully implemented.
 * See content/rituals.json for multi-person rite definitions.
 */
export interface CovenConfig {
  minMembers: number;
  maxMembers: number;
  rentIntervalDays: number;
  treeUpgradeTiers: string[];
}

export const COVEN_CONFIG: CovenConfig = {
  minMembers: 3,
  maxMembers: 13,
  rentIntervalDays: 30,
  treeUpgradeTiers: ['sapling', 'young', 'mature', 'ancient'],
};

// TODO: CovenRoom Colyseus room for grove instances
// TODO: Shared ritual engine extending SpellEngine with participant merging
// TODO: Coven ward stacking stronger than individual wards
