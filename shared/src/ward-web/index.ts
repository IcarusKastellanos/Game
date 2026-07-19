import type { AuraEffect, AuraState, FamiliarState, WardState } from '../types/index.js';

export const AMBIENT_WARD_SPELL_ID = 'ambient_household_ward';
export const AMBIENT_WARD_PROTECTION_ID = 'ambient_household';
export const FAMILIAR_KNOT_LINK_SPELL_ID = 'familiar_knot_link';
export const PRACTITIONER_WARD_MIRROR_SPELL_ID = 'practitioner_ward_mirror';
export const PLAYER_WARD_MIRROR_SPELL_ID = 'player_ward_mirror';

const SYNTHETIC_SPELL_IDS = new Set([
  AMBIENT_WARD_SPELL_ID,
  FAMILIAR_KNOT_LINK_SPELL_ID,
  PRACTITIONER_WARD_MIRROR_SPELL_ID,
  PLAYER_WARD_MIRROR_SPELL_ID,
]);

export type WardWebLayerSource = 'knot' | 'household' | 'practitioner' | 'linked';

export interface WardWebLayer {
  id: string;
  label: string;
  strength: number;
  source: WardWebLayerSource;
  expiresAt?: number;
  permanent?: boolean;
}

export function isSyntheticWardEffect(effect: AuraEffect): boolean {
  return SYNTHETIC_SPELL_IDS.has(effect.spellId ?? '');
}

export function isActiveAuraEffect(effect: Pick<AuraEffect, 'expiresAt' | 'permanent'>): boolean {
  if (effect.permanent) return true;
  if (effect.expiresAt == null) return true;
  return effect.expiresAt > Date.now();
}

export const SILENCED_CHAT_MESSAGE =
  'You try to speak, but your vocal cords do not respond.';

export function isSilencingHex(hex: AuraEffect): boolean {
  if (!isActiveAuraEffect(hex)) return false;
  if (hex.bindAction === 'speech_bind') return true;
  if (hex.spellId === 'pocket_silencing_touch') return true;
  const name = hex.name?.toLowerCase() ?? '';
  return name.includes('silenc');
}

export function isPlayerSilenced(aura: AuraState | undefined | null): boolean {
  if (!aura) return false;
  return (aura.hexes ?? []).some(isSilencingHex);
}

const BINDING_SPELL_IDS = new Set([
  'pocket_sleep_charm',
  'pocket_binding_touch',
  'pocket_silencing_touch',
  'binding_spell',
]);

export function isBindingHex(hex: AuraEffect): boolean {
  if (!isActiveAuraEffect(hex)) return false;
  if (hex.bindAction) return true;
  if (hex.spellId && BINDING_SPELL_IDS.has(hex.spellId)) return true;
  if (isSilencingHex(hex)) return true;
  const name = hex.name?.toLowerCase() ?? '';
  return name.includes('binding') || name.includes('sleep') || name.includes('drows');
}

/** Focus / difficulty penalty from active binding hexes on the caster (0–62). */
export function computeBindingCastPenalty(aura: AuraState | undefined | null): number {
  if (!aura) return 0;
  const bindings = (aura.hexes ?? []).filter(isBindingHex);
  if (!bindings.length) return 0;
  let total = 0;
  for (const h of bindings) {
    total += 28 + (h.strength ?? 12) * 0.35;
  }
  if (bindings.length > 1) total += (bindings.length - 1) * 8;
  return Math.min(62, Math.round(total));
}

export const BINDING_CAST_MESSAGE =
  'Bindings on your body and spirit thwart the working — your focus will not hold.';

/** Drop expired protection / ward layers before cross-link or UI display. */
export function pruneExpiredWardLayers(aura: AuraState): AuraState {
  return {
    ...aura,
    protections: (aura.protections ?? []).filter(isActiveAuraEffect),
    wards: (aura.wards ?? []).filter(isActiveAuraEffect),
  };
}

export function stripSyntheticProtections(effects: AuraEffect[] | undefined): AuraEffect[] {
  return (effects ?? []).filter((e) => !isSyntheticWardEffect(e));
}

export function stripSyntheticFromAura(aura: AuraState): AuraState {
  return { ...aura, protections: stripSyntheticProtections(aura.protections) };
}

function stripAmbientFromFamiliar(familiar: FamiliarState): FamiliarState {
  return {
    ...familiar,
    protections: stripSyntheticProtections(familiar.protections),
  };
}

/** Mirror active perimeter wards onto player aura for UI + inner shield layer. */
export function applyAmbientAuraProtection(
  aura: AuraState,
  ambientWards: WardState[],
  hostDbPlayerId: string
): AuraState {
  const protections = stripSyntheticProtections(aura.protections);
  if (!ambientWards.length) {
    return { ...aura, protections };
  }

  const totalStrength = ambientWards.reduce((sum, w) => sum + w.strength, 0);
  const expiresAt = ambientWards
    .map((w) => w.expiresAt)
    .filter((t): t is number => typeof t === 'number')
    .sort((a, b) => a - b)[0];

  const ambient: AuraEffect = {
    id: AMBIENT_WARD_PROTECTION_ID,
    type: 'protection',
    name: 'Household Ambient Ward',
    strength: totalStrength,
    spellId: AMBIENT_WARD_SPELL_ID,
    creatorId: hostDbPlayerId,
    expiresAt,
  };

  return { ...aura, protections: [...protections, ambient] };
}

/** Familiar shares the household ward web while inside a warded apartment. */
export function applyAmbientFamiliarProtection(
  familiar: FamiliarState,
  ambientWards: WardState[],
  hostDbPlayerId: string
): FamiliarState {
  const protections = stripSyntheticProtections(familiar.protections);
  if (!ambientWards.length) {
    return { ...familiar, protections };
  }

  const totalStrength = ambientWards.reduce((sum, w) => sum + w.strength, 0);
  const expiresAt = ambientWards
    .map((w) => w.expiresAt)
    .filter((t): t is number => typeof t === 'number')
    .sort((a, b) => a - b)[0];

  return {
    ...familiar,
    protections: [
      ...protections,
      {
        id: 'fambient_household',
        type: 'protection',
        name: 'Household Ambient Ward',
        strength: totalStrength,
        spellId: AMBIENT_WARD_SPELL_ID,
        creatorId: hostDbPlayerId,
        expiresAt,
      },
    ],
  };
}

export interface WardWebCrossLinkInput {
  playerAura: AuraState;
  familiar: FamiliarState | null | undefined;
  ambientWards: WardState[];
  hostDbPlayerId: string;
  inApartment: boolean;
}

export interface WardWebCrossLinkResult {
  playerAura: AuraState;
  familiar: FamiliarState | null;
}

/** Cross-link practitioner aura, familiar knot wards, and household perimeter into one web. */
export function computeWardWebCrossLink(input: WardWebCrossLinkInput): WardWebCrossLinkResult {
  let playerAura = pruneExpiredWardLayers(stripSyntheticFromAura(input.playerAura));
  let familiar = input.familiar ? stripAmbientFromFamiliar(input.familiar) : null;

  if (familiar) {
    familiar = {
      ...familiar,
      protections: (familiar.protections ?? []).filter(isActiveAuraEffect),
    };
  }

  if (input.inApartment && input.ambientWards.length) {
    playerAura = applyAmbientAuraProtection(playerAura, input.ambientWards, input.hostDbPlayerId);
    if (familiar) {
      familiar = applyAmbientFamiliarProtection(familiar, input.ambientWards, input.hostDbPlayerId);
    }
  }

  if (!familiar || !familiar.chosen) {
    return { playerAura: { ...playerAura, familiarLink: undefined }, familiar };
  }

  const chosenFamiliar = familiar;

  const knotWards = stripSyntheticProtections(chosenFamiliar.protections).filter(
    (p) => p.name === 'Knot Ward' && isActiveAuraEffect(p)
  );
  const householdOnPerimeter = input.inApartment && input.ambientWards.length > 0;
  const practitionerProts = stripSyntheticProtections(playerAura.protections).filter((p) => {
    if (p.spellId === AMBIENT_WARD_SPELL_ID) return false;
    if (householdOnPerimeter && p.spellId === 'household_ward') return false;
    return isActiveAuraEffect(p);
  });
  const practitionerWards = (playerAura.wards ?? []).filter((w) => {
    if (householdOnPerimeter && w.spellId === 'household_ward') return false;
    return isActiveAuraEffect(w);
  });

  const playerLinked: AuraEffect[] = knotWards.map((p) => ({
    id: `flink_${p.id}`,
    type: 'protection',
    name: `${chosenFamiliar.publicName} Knot (linked)`,
    strength: Math.round(p.strength * 50) / 100,
    spellId: FAMILIAR_KNOT_LINK_SPELL_ID,
    creatorId: chosenFamiliar.ownerId,
    expiresAt: p.expiresAt,
  }));

  const famMirrorProts: AuraEffect[] = practitionerProts.map((p) => ({
    id: `pmirror_${p.id}`,
    type: 'protection',
    name: `Linked: ${p.name}`,
    strength: Math.max(1, Math.round(p.strength * 40) / 100),
    spellId: PRACTITIONER_WARD_MIRROR_SPELL_ID,
    creatorId: p.creatorId,
    expiresAt: p.expiresAt,
  }));

  const famMirrorWards: AuraEffect[] = practitionerWards.map((w) => ({
    id: `wmirror_${w.id}`,
    type: 'protection',
    name: `Linked: ${w.name}`,
    strength: Math.max(1, Math.round(w.strength * 30) / 100),
    spellId: PLAYER_WARD_MIRROR_SPELL_ID,
    creatorId: w.creatorId,
    expiresAt: w.expiresAt,
    permanent: w.permanent,
  }));

  const ambientStrength = input.inApartment
    ? input.ambientWards.reduce((sum, w) => sum + w.strength, 0)
    : 0;
  const totalStrength =
    knotWards.reduce((s, p) => s + p.strength, 0) +
    practitionerProts.reduce((s, p) => s + p.strength, 0) +
    practitionerWards.reduce((s, w) => s + w.strength, 0) +
    ambientStrength;

  playerAura = {
    ...playerAura,
    protections: [...playerAura.protections, ...playerLinked],
    familiarLink: {
      familiarId: chosenFamiliar.id,
      strength: Math.min(1, Math.max(chosenFamiliar.loyalty / 100, totalStrength / 120)),
    },
  };

  familiar = {
    ...chosenFamiliar,
    protections: [...(chosenFamiliar.protections ?? []), ...famMirrorProts, ...famMirrorWards].slice(-10),
  };

  return { playerAura, familiar };
}

export function describeFamiliarWardWebLayers(
  familiar: FamiliarState,
  playerAura: AuraState | null | undefined,
  apartmentWards: WardState[],
  inApartment: boolean
): WardWebLayer[] {
  const layers: WardWebLayer[] = [];

  for (const p of familiar.protections ?? []) {
    if (!isActiveAuraEffect(p)) continue;
    if (p.spellId === AMBIENT_WARD_SPELL_ID) {
      layers.push({
        id: p.id,
        label: 'Household perimeter (shared)',
        strength: p.strength,
        source: 'household',
        expiresAt: p.expiresAt,
      });
    } else if (p.spellId === PRACTITIONER_WARD_MIRROR_SPELL_ID || p.spellId === PLAYER_WARD_MIRROR_SPELL_ID) {
      layers.push({
        id: p.id,
        label: p.name,
        strength: p.strength,
        source: 'linked',
        expiresAt: p.expiresAt,
        permanent: p.permanent,
      });
    } else if (p.name === 'Knot Ward') {
      layers.push({
        id: p.id,
        label: 'Knot Ward (personal)',
        strength: p.strength,
        source: 'knot',
        expiresAt: p.expiresAt,
      });
    }
  }

  if (inApartment && apartmentWards.length && !layers.some((l) => l.source === 'household')) {
    layers.push({
      id: 'perimeter_local',
      label: 'Household perimeter',
      strength: apartmentWards.reduce((s, w) => s + w.strength, 0),
      source: 'household',
      permanent: apartmentWards.some((w) => w.permanent),
      expiresAt: apartmentWards
        .map((w) => w.expiresAt)
        .filter((t): t is number => typeof t === 'number')
        .sort((a, b) => a - b)[0],
    });
  }

  const practitionerCount =
    (playerAura?.wards?.length ?? 0) +
    stripSyntheticProtections(playerAura?.protections).filter((p) => p.spellId !== AMBIENT_WARD_SPELL_ID).length;
  if (practitionerCount > 0 && !layers.some((l) => l.source === 'linked')) {
    layers.push({
      id: 'practitioner_web',
      label: 'Practitioner aura (linked)',
      strength: Math.round(familiar.loyalty / 10),
      source: 'practitioner',
    });
  }

  return layers;
}

export function totalWardWebStrength(layers: WardWebLayer[]): number {
  return layers.reduce((sum, layer) => sum + layer.strength, 0);
}
