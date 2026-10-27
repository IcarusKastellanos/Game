import type { AuraState, PlayerStats, PocketSpell } from '@witchcraft/shared';
import {
  applyPocketSpellBacklash,
  calculatePocketSpellRelease,
  clampPlayerStatValue,
} from '@witchcraft/shared';
import { contentRegistry } from '../content/registry.js';
import { applySpellEffectsToCaster } from './apply-spell-effects.js';
import type { CastResult } from './spell-engine.js';

export interface PocketCastResult {
  ok: boolean;
  error?: string;
  stats?: PlayerStats;
  progression?: import('@witchcraft/shared').PlayerProgression;
  spellId?: string;
  storedMe?: number;
}

export class PocketSpellSystem {
  cast(
    pocketId: string,
    progression: import('@witchcraft/shared').PlayerProgression,
    stats: PlayerStats
  ): PocketCastResult {
    const idx = progression.pocketSpells.findIndex((p) => p.id === pocketId);
    if (idx < 0) return { ok: false, error: 'Pocket spell not found.' };

    const pocket = progression.pocketSpells[idx];
    const remaining = progression.pocketSpells.filter((p) => p.id !== pocketId);

    return {
      ok: true,
      stats: { ...stats, magicalEnergy: stats.magicalEnergy - pocket.storedMe },
      progression: { ...progression, pocketSpells: remaining },
      spellId: pocket.spellId,
      storedMe: pocket.storedMe,
    };
  }
}

export const pocketSpellSystem = new PocketSpellSystem();

export interface PocketReleaseOutcome {
  cast: PocketCastResult;
  resolution: ReturnType<typeof calculatePocketSpellRelease>;
  appliedToTarget: boolean;
}

export function resolveAndReleasePocketSpell(
  pocket: PocketSpell,
  progression: import('@witchcraft/shared').PlayerProgression,
  casterStats: PlayerStats,
  targetStats: PlayerStats | undefined,
  targetAura: AuraState | undefined,
  targetIsSelf: boolean,
  casterAura?: AuraState,
  targetGrimoireWard = 0
): PocketReleaseOutcome | { ok: false; error: string } {
  const spell = contentRegistry.spells.get(pocket.spellId);
  if (!spell) return { ok: false, error: 'Unknown spell.' };

  const cast = pocketSpellSystem.cast(pocket.id, progression, casterStats);
  if (!cast.ok) return { ok: false, error: cast.error ?? 'Release failed.' };

  const resolution = calculatePocketSpellRelease({
    spell: {
      id: spell.id,
      name: spell.name,
      category: spell.category,
      difficulty: spell.difficulty,
      basePotency: spell.basePotency,
      moralEffect: spell.moralEffect,
      maintenanceCost: spell.maintenanceCost,
    },
    pocket: {
      storedMe: pocket.storedMe,
      craftStability: pocket.craftStability,
      potencyBonus: pocket.potencyBonus,
      craftPower: pocket.craftPower,
      unstable: pocket.unstable,
    },
    caster: cast.stats!,
    casterAura,
    target: targetStats,
    targetAura,
    targetIsSelf,
    backlashRoll: Math.random() * 100,
    targetGrimoireWard,
  });

  let casterStatsOut = cast.stats!;
  if (resolution.backlashTriggered) {
    casterStatsOut = applyPocketSpellBacklash(casterStatsOut, resolution.backlashSeverity);
  }

  return {
    cast: { ...cast, stats: casterStatsOut },
    resolution,
    appliedToTarget: !resolution.blocked && resolution.effectivePotency > 0,
  };
}

function scaleEffect(potency: number, basePotency: number, value: number): number {
  return value * (potency / Math.max(1, basePotency || 10));
}

function durationMs(spellDurationSec: number | undefined, defaultSec = 3600): number {
  return (spellDurationSec ?? defaultSec) * 1000;
}

/** Apply resolved pocket spell potency to the recipient's stats and aura. */
export function applyPocketSpellToRecipient(
  spellId: string,
  effectivePotency: number,
  stats: PlayerStats,
  aura: AuraState,
  casterId?: string,
  casterName?: string
): { stats: PlayerStats; aura: AuraState } {
  const spell = contentRegistry.spells.get(spellId);
  if (!spell || effectivePotency <= 0) return { stats, aura };

  const potency = effectivePotency;
  const base = spell.basePotency || 10;
  const effects = (spell.gameplayEffect ?? {}) as Record<string, unknown>;
  const { healthRestore, divinationBoost, ...effectRest } = effects;

  let statsOut = { ...stats };
  if (healthRestore) {
    statsOut.health = clampPlayerStatValue(
      'health',
      statsOut.health + scaleEffect(potency, base, Number(healthRestore)),
      statsOut.experience
    );
  }

  if (divinationBoost) {
    statsOut.divinationSkill = clampPlayerStatValue(
      'divinationSkill',
      statsOut.divinationSkill + scaleEffect(potency, base, Number(divinationBoost)),
      statsOut.experience
    );
  }

  const castResult: CastResult = {
    success: true,
    potency,
    accuracy: 100,
    message: '',
    consumedItems: [],
    moralDelta: spell.moralEffect ?? 0,
    effects: { ...effectRest, duration: spell.duration ?? 3600 },
  };

  let applied = applySpellEffectsToCaster(statsOut, aura, castResult, spellId, spell.name, false, casterId);

  if (effects.weakenMagicalEnergy) {
    const drop = scaleEffect(potency, base, Number(effects.weakenMagicalEnergy));
    applied = {
      ...applied,
      stats: {
        ...applied.stats,
        magicalEnergy: clampPlayerStatValue(
          'magicalEnergy',
          applied.stats.magicalEnergy - drop,
          applied.stats.experience
        ),
      },
    };
  }

  if (effects.weakenProtection) {
    const drop = scaleEffect(potency, base, Number(effects.weakenProtection));
    applied = {
      ...applied,
      stats: {
        ...applied.stats,
        protection: clampPlayerStatValue('protection', applied.stats.protection - drop, applied.stats.experience),
      },
    };
  }

  if (effects.weakenDivination) {
    const drop = scaleEffect(potency, base, Number(effects.weakenDivination));
    applied = {
      ...applied,
      stats: {
        ...applied.stats,
        divinationSkill: clampPlayerStatValue(
          'divinationSkill',
          applied.stats.divinationSkill - drop,
          applied.stats.experience
        ),
      },
    };
  }

  if (effects.weakenIntuition) {
    const drop = scaleEffect(potency, base, Number(effects.weakenIntuition));
    applied = {
      ...applied,
      stats: {
        ...applied.stats,
        intuition: clampPlayerStatValue('intuition', applied.stats.intuition - drop, applied.stats.experience),
      },
    };
  }

  if (effects.harmHealth) {
    const harm = scaleEffect(potency, base, Number(effects.harmHealth));
    applied = {
      ...applied,
      stats: {
        ...applied.stats,
        health: clampPlayerStatValue('health', applied.stats.health - harm, applied.stats.experience),
      },
    };
  }

  if (effects.luckPenalty) {
    const penalty = scaleEffect(potency, base, Number(effects.luckPenalty));
    applied = {
      ...applied,
      aura: {
        ...applied.aura,
        hexes: [
          ...applied.aura.hexes,
          {
            id: `hex_luck_${Date.now()}`,
            type: 'hex',
            name: 'Misfortune',
            strength: penalty,
            spellId,
            creatorId: casterId,
            source: casterName,
            expiresAt: Date.now() + durationMs(spell.duration),
          },
        ],
      },
    };
  }

  if (effects.curseResidue) {
    const strength = scaleEffect(potency, base, Number(effects.curseResidue));
    applied = {
      ...applied,
      aura: {
        ...applied.aura,
        curseResidue: [
          ...applied.aura.curseResidue,
          {
            id: `curse_${Date.now()}`,
            type: 'curse_residue',
            name: spell.name,
            strength,
            spellId,
            creatorId: casterId,
            source: casterName,
            expiresAt: Date.now() + durationMs(spell.duration, 7200),
          },
        ],
      },
    };
  }

  if (effects.addHex || effects.hexType || effects.bindAction) {
    const hexLabel = effects.hexType ? String(effects.hexType).replace(/_/g, ' ') : spell.name;
    const hexStrength = potency * (effects.potencyScale ? Number(effects.potencyScale) : 1);
    applied = {
      ...applied,
      aura: {
        ...applied.aura,
        hexes: [
          ...applied.aura.hexes,
          {
            id: `hex_${Date.now()}`,
            type: 'hex',
            name: hexLabel.charAt(0).toUpperCase() + hexLabel.slice(1),
            strength: hexStrength,
            spellId,
            creatorId: casterId,
            source: casterName,
            bindAction: effects.bindAction ? String(effects.bindAction) : undefined,
            expiresAt: Date.now() + durationMs(spell.duration),
          },
        ],
      },
    };
  }

  if (effects.removeHex) {
    const tag = String(effects.removeHex).toLowerCase();
    applied = {
      ...applied,
      aura: {
        ...applied.aura,
        hexes: applied.aura.hexes.filter(
          (h) =>
            !h.name.toLowerCase().includes(tag) &&
            !(h.spellId?.toLowerCase().includes(tag) ?? false)
        ),
      },
    };
  }

  if (effects.cleansing) {
    const threshold = Number(effects.cleansing) * (potency / base);
    applied = {
      ...applied,
      aura: {
        ...applied.aura,
        hexes: applied.aura.hexes.filter((h) => (h.strength ?? 0) <= threshold),
      },
    };
  }

  if ((effects.protectionBonus || effects.wardStrength) && spell.category === 'protection') {
    applied = {
      ...applied,
      stats: {
        ...applied.stats,
        protection: clampPlayerStatValue(
          'protection',
          applied.stats.protection + Math.max(3, Math.floor(potency / 2)),
          applied.stats.experience
        ),
      },
    };
  }

  if (effects.shieldBreak) {
    applied = {
      ...applied,
      stats: {
        ...applied.stats,
        protection: clampPlayerStatValue(
          'protection',
          applied.stats.protection - Math.max(5, Math.floor(potency / 2)),
          applied.stats.experience
        ),
      },
      aura: {
        ...applied.aura,
        protections: applied.aura.protections.filter((p) => (p.strength ?? 0) < potency),
        wards: applied.aura.wards.filter((w) => (w.strength ?? 0) < potency * 0.8),
      },
    };
  }

  return applied;
}
