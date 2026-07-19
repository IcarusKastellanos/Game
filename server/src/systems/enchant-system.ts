export type EnchantIntent = 'familiar_protection' | 'ward_strength' | 'longevity';

export function getEnchantKnotMetadata(intent: EnchantIntent): {
  strengthBonus: number;
  durationHours: number;
} {
  switch (intent) {
    case 'familiar_protection':
      return { strengthBonus: 6, durationHours: 6 };
    case 'ward_strength':
      return { strengthBonus: 4, durationHours: 4 };
    case 'longevity':
      return { strengthBonus: 2, durationHours: 8 };
  }
}

export function readEnchantedKnotMetadata(metadata: Record<string, unknown> | undefined): {
  strength: number;
  durationMs: number;
} {
  if (!metadata?.enchanted) {
    return { strength: 8, durationMs: 4 * 60 * 60 * 1000 };
  }
  const strength = 8 + (Number(metadata.strengthBonus) || 0);
  const hours = Number(metadata.durationHours) || 4;
  return { strength, durationMs: hours * 60 * 60 * 1000 };
}
