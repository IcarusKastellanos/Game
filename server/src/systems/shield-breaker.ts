import type { AuraState, WardState } from '@witchcraft/shared';

export interface ShieldLayer {
  kind: 'apartment_ward' | 'aura_ward' | 'protection';
  id: string;
  name: string;
  strength: number;
  creatorId?: string;
}

export interface BrokenShieldLayer {
  kind: ShieldLayer['kind'];
  id: string;
  name: string;
  damageApplied: number;
  wasWard: boolean;
}

export interface ShieldBreakOutcome {
  totalDamage: number;
  broken: BrokenShieldLayer[];
  anyBroken: boolean;
  anyWardBroken: boolean;
  message: string;
  aura: AuraState;
  apartmentWards: WardState[];
}

/** Outermost layers first: apartment perimeter → aura wards → protections. */
export function buildShieldLayers(aura: AuraState, apartmentWards: WardState[]): ShieldLayer[] {
  const layers: ShieldLayer[] = [];

  for (const w of apartmentWards) {
    layers.push({
      kind: 'apartment_ward',
      id: w.id,
      name: 'Apartment Ward',
      strength: w.strength,
      creatorId: w.creatorId,
    });
  }
  for (const w of aura.wards) {
    layers.push({
      kind: 'aura_ward',
      id: w.id,
      name: w.name,
      strength: w.strength,
      creatorId: w.creatorId ?? w.source,
    });
  }
  for (const p of aura.protections) {
    layers.push({
      kind: 'protection',
      id: p.id,
      name: p.name,
      strength: p.strength,
      creatorId: p.creatorId ?? p.source,
    });
  }

  return layers;
}

/** Damage = caster cursecraft × 2 + hex strength (potency). Overflow pierces inward. */
export function applyShieldBreaker(
  aura: AuraState,
  apartmentWards: WardState[],
  cursecraft: number,
  hexStrength: number
): ShieldBreakOutcome {
  const totalDamage = cursecraft * 2 + hexStrength;
  let remaining = totalDamage;
  const broken: BrokenShieldLayer[] = [];

  const nextAura: AuraState = {
    ...aura,
    wards: [...aura.wards],
    protections: [...aura.protections],
  };
  let nextApartment = [...apartmentWards];

  const layers = buildShieldLayers(aura, apartmentWards);

  for (const layer of layers) {
    if (remaining <= 0) break;

    const applied = Math.min(layer.strength, remaining);
    const newStrength = layer.strength - remaining;

    if (newStrength <= 0) {
      broken.push({
        kind: layer.kind,
        id: layer.id,
        name: layer.name,
        damageApplied: layer.strength,
        wasWard: layer.kind === 'apartment_ward' || layer.kind === 'aura_ward',
      });
      remaining -= layer.strength;

      if (layer.kind === 'apartment_ward') {
        nextApartment = nextApartment.filter((w) => w.id !== layer.id);
      } else if (layer.kind === 'aura_ward') {
        nextAura.wards = nextAura.wards.filter((w) => w.id !== layer.id);
      } else {
        nextAura.protections = nextAura.protections.filter((p) => p.id !== layer.id);
      }
    } else {
      if (layer.kind === 'apartment_ward') {
        nextApartment = nextApartment.map((w) =>
          w.id === layer.id ? { ...w, strength: newStrength } : w
        );
      } else if (layer.kind === 'aura_ward') {
        nextAura.wards = nextAura.wards.map((w) =>
          w.id === layer.id ? { ...w, strength: newStrength } : w
        );
      } else {
        nextAura.protections = nextAura.protections.map((p) =>
          p.id === layer.id ? { ...p, strength: newStrength } : p
        );
      }
      broken.push({
        kind: layer.kind,
        id: layer.id,
        name: layer.name,
        damageApplied: applied,
        wasWard: layer.kind === 'apartment_ward' || layer.kind === 'aura_ward',
      });
      remaining = 0;
    }
  }

  const anyWardBroken = broken.some((b) => b.wasWard);
  const anyBroken = broken.length > 0;
  let message: string;
  if (!layers.length) {
    message = 'No wards or protections to break.';
  } else if (!anyBroken) {
    message = 'The working glances off layered defenses.';
  } else if (remaining > 0) {
    message = `Shields shattered — ${broken.length} layer(s) destroyed, ${Math.round(remaining)} damage unspent.`;
  } else {
    message = `Shield Breaker cracked ${broken.length} layer(s).`;
  }

  return {
    totalDamage,
    broken,
    anyBroken,
    anyWardBroken,
    message,
    aura: nextAura,
    apartmentWards: nextApartment,
  };
}
