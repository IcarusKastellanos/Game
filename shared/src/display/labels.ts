/** Known internal ids → formal in-game labels */
const KNOWN_LABELS: Record<string, string> = {
  ambient_household_ward: 'Ambient Household Ward',
  ambient_household: 'Household Ambient Ward',
  familiar_knot_link: 'Familiar Knot Link',
  practitioner_ward_mirror: 'Practitioner Ward Mirror',
  player_ward_mirror: 'Player Ward Mirror',
  protection_candle: 'Protection Candle',
  household_ward: 'Household Ward',
  shield_breaker: 'Shield Breaker',
  everweed: 'Everweed',
  nullification_powder: 'Nullification Powder',
  familiar_food: 'Familiar Food',
  familiar_knot: 'Familiar Knot',
  white_candle: 'White Candle',
  written_petition: 'Written Petition',
};

/** Turn snake_case content ids into formal Title Case labels */
export function formatContentLabel(id: string): string {
  if (!id) return '';
  const known = KNOWN_LABELS[id];
  if (known) return known;
  return id
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** Prefer a proper name; fall back to slug formatting when stored as an id */
export function resolveDisplayLabel(name?: string, slug?: string): string {
  const primary = name?.trim();
  if (primary && !/^[a-z][a-z0-9_]*$/.test(primary)) return primary;
  return formatContentLabel(primary || slug || '');
}
