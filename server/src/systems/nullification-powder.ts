import type { AuraState } from '@witchcraft/shared';

/** Strip personal magical layers from aura — household perimeter is re-applied by ward web refresh. */
export function applyNullificationPowder(aura: AuraState): AuraState {
  return {
    ...aura,
    hexes: [],
    blessings: [],
    attachments: [],
    parasites: [],
    protections: [],
    wards: [],
    curseResidue: [],
    energeticDamage: 0,
  };
}
