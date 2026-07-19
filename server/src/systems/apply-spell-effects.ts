import type { AuraState, PlayerStats } from '@witchcraft/shared';
import type { CastResult } from './spell-engine.js';

/** Apply spell gameplay effects to caster stats and aura after a successful cast */
export function applySpellEffectsToCaster(
  stats: PlayerStats,
  aura: AuraState,
  result: CastResult,
  spellId: string,
  spellName: string,
  magicOnly = false,
  casterId?: string,
  everweedBound = false
): { stats: PlayerStats; aura: AuraState } {
  const updatedStats = { ...stats };
  const updatedAura: AuraState = {
    ...aura,
    blessings: [...aura.blessings],
    hexes: [...aura.hexes],
    protections: [...aura.protections],
    wards: [...aura.wards],
  };

  const effects = result.effects;
  const scale = magicOnly ? 0.5 : 1;
  const durationMs = ((effects.duration as number) ?? 3600) * 1000;

  if (effects.healthRestore) {
    updatedStats.health = Math.min(100, updatedStats.health + (effects.healthRestore as number) * scale);
  }

  if (effects.protectionBonus) {
    updatedAura.protections.push({
      id: `prot_${Date.now()}`,
      type: 'protection',
      name: spellName,
      strength: (effects.protectionBonus as number) * scale,
      spellId,
      creatorId: casterId,
      source: casterId,
      permanent: everweedBound || undefined,
      expiresAt: everweedBound ? undefined : Date.now() + durationMs,
    });
  }

  if (effects.apartmentProtection || effects.wardStrength) {
    if (spellId !== 'household_ward') {
      const wardStrength =
        ((effects.apartmentProtection as number) ?? (effects.wardStrength as number) ?? 10) *
        (result.potency / 30) *
        scale;
      updatedAura.wards.push({
        id: `ward_${Date.now()}`,
        type: 'ward',
        name: spellName,
        strength: Math.max(5, wardStrength),
        spellId,
        creatorId: casterId,
        source: casterId,
        permanent: everweedBound || undefined,
        expiresAt: everweedBound ? undefined : Date.now() + durationMs,
      });
      updatedStats.warding = Math.min(100, updatedStats.warding + 1);
    } else {
      updatedStats.warding = Math.min(100, updatedStats.warding + 1);
    }
  }

  if (effects.blessing) {
    updatedAura.blessings.push({
      id: `bless_${Date.now()}`,
      type: 'blessing',
      name: String(effects.blessing),
      strength: result.potency * scale,
      expiresAt: Date.now() + durationMs,
    });
  }

  if (effects.luckBonus) {
    updatedAura.blessings.push({
      id: `luck_${Date.now()}`,
      type: 'blessing',
      name: 'Luck',
      strength: (effects.luckBonus as number) * scale,
      expiresAt: Date.now() + durationMs,
    });
  }

  if (effects.divinationBoost) {
    updatedStats.divinationSkill = Math.min(100, updatedStats.divinationSkill + 2 * scale);
  }

  return { stats: updatedStats, aura: updatedAura };
}
