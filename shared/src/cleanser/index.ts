import type { AuraState } from '../types/index.js';

export const CLEANSER_MORALITY_COST = 10;

export interface CleanserRemovalCounts {
  hexes: number;
  curseResidue: number;
  parasites: number;
  attachments: number;
  energeticDamage: number;
}

export interface CleanserResult {
  aura: AuraState;
  removed: CleanserRemovalCounts;
  totalRemoved: number;
}

/** Strip baneful aura layers — hexes, curses, parasites, attachments, energetic damage. */
export function applyCleanserToAura(aura: AuraState): CleanserResult {
  const removed: CleanserRemovalCounts = {
    hexes: aura.hexes?.length ?? 0,
    curseResidue: aura.curseResidue?.length ?? 0,
    parasites: aura.parasites?.length ?? 0,
    attachments: aura.attachments?.length ?? 0,
    energeticDamage: (aura.energeticDamage ?? 0) > 0 ? 1 : 0,
  };

  const totalRemoved =
    removed.hexes +
    removed.curseResidue +
    removed.parasites +
    removed.attachments +
    removed.energeticDamage;

  return {
    aura: {
      ...aura,
      hexes: [],
      curseResidue: [],
      parasites: [],
      attachments: [],
      energeticDamage: 0,
    },
    removed,
    totalRemoved,
  };
}

export function formatCleanserMessage(removed: CleanserRemovalCounts, totalRemoved: number): string {
  const cost = `−${CLEANSER_MORALITY_COST} morality`;
  if (totalRemoved <= 0) {
    return `The cleanser runs over you — nothing baneful clings, but the working still costs you (${cost}).`;
  }

  const parts: string[] = [];
  if (removed.hexes) parts.push(`${removed.hexes} hex${removed.hexes === 1 ? '' : 'es'}`);
  if (removed.curseResidue) {
    parts.push(`${removed.curseResidue} curse layer${removed.curseResidue === 1 ? '' : 's'}`);
  }
  if (removed.parasites) {
    parts.push(`${removed.parasites} parasite${removed.parasites === 1 ? '' : 's'}`);
  }
  if (removed.attachments) {
    parts.push(`${removed.attachments} attachment${removed.attachments === 1 ? '' : 's'}`);
  }
  if (removed.energeticDamage) parts.push('energetic damage');

  return `The cleanser washes away ${parts.join(', ')}. The price is paid (${cost}).`;
}
