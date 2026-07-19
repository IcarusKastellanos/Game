import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ContentMapDefinition, TaglockType } from '@witchcraft/shared';
import { contentRegistry } from '../content/registry.js';
import { spellEngine } from './spell-engine.js';
import { wardSystem } from './inventory-ward-aura.js';

/** Place a household ward at an apartment ward point */
export function placeWardAtPoint(
  spellId: string,
  wardPointId: string,
  mapDef: ContentMapDefinition | undefined,
  ctx: Parameters<typeof spellEngine.cast>[1]
): {
  success: boolean;
  message: string;
  ward?: ReturnType<typeof wardSystem.createWard>;
  castResult: ReturnType<typeof spellEngine.cast>;
} {
  const wardPoint = mapDef?.interactables.find(
    (i) => i.id === wardPointId && i.type === 'ward_point'
  );
  if (!wardPoint) {
    return {
      success: false,
      message: 'Invalid ward point.',
      castResult: {
        success: false,
        potency: 0,
        accuracy: 0,
        message: 'Invalid ward point.',
        consumedItems: [],
        moralDelta: 0,
        effects: {},
        diagnostics: { code: 'unknown_spell', summary: 'Invalid ward point.' },
      },
    };
  }

  const result = spellEngine.cast(spellId, ctx);
  if (!result.success) {
    return { success: false, message: result.message, castResult: result };
  }

  const ward = wardSystem.createWard({
    targetType: 'apartment',
    targetId: wardPointId,
    strength: (result.effects.apartmentProtection as number) ?? result.potency,
    duration: (result.effects.duration as number) ?? 86400,
    maintenanceCost: 3,
    feedingRequirement: 'magical_energy',
    ingredientRequirement: ['salt'],
    vulnerabilities: ['reversal'],
    creatorId: ctx.creatorId ?? 'unknown',
    detectionDifficulty: (result.effects.detectionDifficulty as number) ?? 40,
    expiresAt: Date.now() + 86400000,
  });

  return {
    success: true,
    message: `Household ward placed at ${(wardPoint.data?.label as string) ?? 'threshold'}.`,
    ward,
    castResult: result,
  };
}

/** Apply offensive spell effects to a target player's aura */
export function applySpellToTarget(
  spellId: string,
  potency: number,
  taglockType?: TaglockType
): { hexName: string; strength: number } | null {
  const spell = contentRegistry.spells.get(spellId);
  if (!spell || spell.targetType !== 'player') return null;

  return {
    hexName: spell.name,
    strength: potency * (taglockType ? 1.1 : 0.7),
  };
}
