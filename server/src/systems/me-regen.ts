import type { FamiliarState, PlayerStats } from '@witchcraft/shared';

import { clampMagicalEnergy, computeMeRegenAmount } from '@witchcraft/shared';



const FAST_FAMILIARS = new Set(['cat_familiar', 'owl_familiar', 'frog_familiar']);



export function meRegenIntervalMs(familiar: FamiliarState | null | undefined): number {

  if (familiar?.templateId && FAST_FAMILIARS.has(familiar.templateId)) return 25000;

  return 30000;

}



export { computeMeRegenAmount };



export function applyMeRegen(stats: PlayerStats, amount: number): PlayerStats {

  return {

    ...stats,

    magicalEnergy: clampMagicalEnergy(stats.magicalEnergy + amount, stats.experience),

  };

}

