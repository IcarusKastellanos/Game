/** Escape text for safe HTML insertion. */
export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function field(label: string, inner: string, className = ''): string {
  return `<label class="form-field ${className}"><span class="form-label">${esc(label)}</span>${inner}</label>`;
}

export function textInput(id: string, value: string, placeholder = ''): string {
  return `<input id="${esc(id)}" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}" />`;
}

export function numberInput(id: string, value: number, step = 1): string {
  return `<input id="${esc(id)}" type="number" step="${step}" value="${value}" />`;
}

export function textarea(id: string, value: string, rows = 4): string {
  return `<textarea id="${esc(id)}" rows="${rows}">${esc(value)}</textarea>`;
}

export function selectInput(id: string, options: { value: string; label: string }[], selected: string): string {
  return `<select id="${esc(id)}">${options
    .map((o) => `<option value="${esc(o.value)}"${o.value === selected ? ' selected' : ''}>${esc(o.label)}</option>`)
    .join('')}</select>`;
}

export function checkboxGroup(
  idPrefix: string,
  options: { value: string; label: string }[],
  selected: string[]
): string {
  const set = new Set(selected);
  return `<div class="checkbox-group">${options
    .map(
      (o) =>
        `<label class="checkbox-chip"><input type="checkbox" id="${esc(idPrefix)}-${esc(o.value)}" value="${esc(o.value)}"${set.has(o.value) ? ' checked' : ''} /> ${esc(o.label)}</label>`
    )
    .join('')}</div>`;
}

export function readCheckboxGroup(idPrefix: string, options: { value: string }[]): string[] {
  return options
    .filter((o) => (document.getElementById(`${idPrefix}-${o.value}`) as HTMLInputElement | null)?.checked)
    .map((o) => o.value);
}

export const MAGIC_TRADITIONS = [
  { value: 'traditional_european', label: 'Traditional European' },
  { value: 'chaos_magic', label: 'Chaos Magic' },
  { value: 'vodou', label: 'Vodou' },
  { value: 'nordic_seidr', label: 'Nordic Seidr' },
  { value: 'greek_mageia', label: 'Greek Mageia' },
] as const;

export const SPELL_CATEGORIES = [
  'protection', 'healing', 'baneful', 'cleansing', 'divination', 'spirit_work',
  'love_friendship', 'luck', 'binding', 'reversal', 'prosperity', 'dreamwork', 'warding',
] as const;

export const SPELL_TARGETS = [
  'self', 'player', 'familiar', 'apartment', 'room', 'object', 'area',
] as const;

export const ITEM_CATEGORIES = [
  'herbs', 'candles', 'incense', 'oils', 'minerals', 'tools', 'poppets',
  'written_petitions', 'charms', 'food', 'medicine', 'books', 'decorations',
  'offerings', 'familiar_care', 'ritual_clothing',
] as const;

export const ITEM_RARITIES = ['common', 'uncommon', 'rare', 'exotic'] as const;

export const MAP_LOCATIONS = [
  'apartment', 'metaphysical_shop', 'grocery', 'pharmacy', 'museum', 'funeral_home',
  'park', 'library', 'cafe', 'study_circle', 'apartment_building',
] as const;

export const TAGLOCK_TYPES = [
  'true_name', 'hair', 'blood', 'personal_item', 'written_name', 'photo', 'social_bond', 'familiar_name', 'self',
] as const;
