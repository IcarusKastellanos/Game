/** Supported interaction types for invisible zones and interactive furniture. */
export const INTERACTION_TYPE_OPTIONS = [
  { value: 'altar', label: 'Altar' },
  { value: 'shop', label: 'Shop' },
  { value: 'potion_shelf', label: 'Potion shelf' },
  { value: 'enchanting_table', label: 'Enchanting table' },
  { value: 'craft_mirror', label: 'Scrying mirror' },
  { value: 'crafting', label: 'Crafting station (legacy)' },
  { value: 'door', label: 'Door / portal' },
  { value: 'ward_point', label: 'Ward point' },
  { value: 'cleanser', label: 'Cleanser' },
  { value: 'bed', label: 'Bed / rest' },
] as const;

export type MapInteractionType = (typeof INTERACTION_TYPE_OPTIONS)[number]['value'];

export function getInteractionTypeFromProperties(properties: unknown): string | undefined {
  if (!properties || typeof properties !== 'object') return undefined;
  const t = (properties as Record<string, unknown>).interactionType;
  return typeof t === 'string' && t.trim() ? t.trim() : undefined;
}

export function getInteractionDataFromProperties(properties: unknown): Record<string, unknown> | undefined {
  if (!properties || typeof properties !== 'object') return undefined;
  const d = (properties as Record<string, unknown>).interactionData;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return undefined;
  return d as Record<string, unknown>;
}

export function getPropertyString(properties: unknown, key: string): string | undefined {
  if (!properties || typeof properties !== 'object') return undefined;
  const v = (properties as Record<string, unknown>)[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export function interactionTypeLabel(type: string): string {
  return INTERACTION_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

export function interactionTypeGlyph(type: string): string {
  switch (type) {
    case 'altar': return 'A';
    case 'shop': return '$';
    case 'potion_shelf': return 'P';
    case 'enchanting_table': return 'E';
    case 'craft_mirror': return 'M';
    case 'crafting': return 'C';
    case 'door': return 'D';
    case 'ward_point': return 'W';
    case 'cleanser': return 'X';
    case 'bed': return 'Z';
    default: return type.slice(0, 1).toUpperCase() || '?';
  }
}
