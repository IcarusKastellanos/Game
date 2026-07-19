import type { AltarState } from '@witchcraft/shared';
import { contentRegistry } from '../content/registry.js';

/** Compute altar buffs from placed altar objects and decorations */
export function computeAltarBuffs(altar: AltarState): Record<string, number> {
  const buffs: Record<string, number> = {};

  for (const decId of altar.decorationIds ?? []) {
    const dec = contentRegistry.decorations.get(decId);
    if (!dec?.altarBuffs) continue;
    for (const [category, value] of Object.entries(dec.altarBuffs)) {
      buffs[category] = (buffs[category] ?? 0) + (value ?? 0);
    }
  }

  return buffs;
}
