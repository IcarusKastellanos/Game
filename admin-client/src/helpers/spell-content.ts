/** Known gameplay effect keys used across content/spells.json */
export const SPELL_EFFECT_KEYS = [
  { value: 'protectionBonus', label: 'Protection Bonus', valueType: 'number' as const },
  { value: 'wardStrength', label: 'Ward Strength', valueType: 'number' as const },
  { value: 'apartmentProtection', label: 'Apartment Protection', valueType: 'number' as const },
  { value: 'detectionDifficulty', label: 'Detection Difficulty', valueType: 'number' as const },
  { value: 'healthRestore', label: 'Health Restore', valueType: 'number' as const },
  { value: 'cleansing', label: 'Cleansing Power', valueType: 'number' as const },
  { value: 'luckBonus', label: 'Luck Bonus', valueType: 'number' as const },
  { value: 'divinationBoost', label: 'Divination Boost', valueType: 'number' as const },
  { value: 'potencyScale', label: 'Potency Scale', valueType: 'number' as const },
  { value: 'hexType', label: 'Hex Type', valueType: 'string' as const },
  { value: 'bindAction', label: 'Bind Action', valueType: 'string' as const },
  { value: 'blessing', label: 'Blessing Tag', valueType: 'string' as const },
  { value: 'removeHex', label: 'Remove Hex', valueType: 'string' as const },
  { value: 'blockRemoval', label: 'Block Removal', valueType: 'boolean' as const },
  { value: 'removeAllMinorHexes', label: 'Remove All Minor Hexes', valueType: 'boolean' as const },
  { value: 'revealIncomingMagic', label: 'Reveal Incoming Magic', valueType: 'boolean' as const },
  { value: 'breakMajorCurse', label: 'Break Major Curse', valueType: 'boolean' as const },
  { value: 'shieldBreak', label: 'Shield Break', valueType: 'boolean' as const },
];

export function slugifyId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);
}

export function parseEffectValue(raw: string, valueType: 'number' | 'boolean' | 'string'): unknown {
  if (valueType === 'boolean') return raw === 'true' || raw === '1';
  if (valueType === 'number') {
    const n = Number(raw);
    return Number.isNaN(n) ? 0 : n;
  }
  return raw;
}

export function effectValueToString(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value ?? '');
}
