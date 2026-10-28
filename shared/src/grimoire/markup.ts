/** Kinds of record that can carry a formatted grimoire page. */
export const GRIMOIRE_ENTRY_KINDS = [
  'spells',
  'items',
  'spirits',
  'npcs',
  'familiars',
  'recipes',
  'books',
  'quests',
] as const;

export type GrimoireEntryKind = (typeof GRIMOIRE_ENTRY_KINDS)[number];

export type GrimoireEntryMap = Record<GrimoireEntryKind, Record<string, string>>;

const ALLOWED = new Set(['b', 'strong', 'i', 'em', 'u', 'br', 'p', 'ul', 'ol', 'li']);

function decodeBasic(text: string): string {
  return text
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function emptyGrimoireEntryMap(): GrimoireEntryMap {
  return {
    spells: {},
    items: {},
    spirits: {},
    npcs: {},
    familiars: {},
    recipes: {},
    books: {},
    quests: {},
  };
}

export function isGrimoireEntryKind(value: string): value is GrimoireEntryKind {
  return (GRIMOIRE_ENTRY_KINDS as readonly string[]).includes(value);
}

/**
 * Keep bold, italic, underline, and simple paragraphs.
 * Everything else is removed, and leftover text is escaped.
 */
export function sanitizeGrimoireMarkup(raw: unknown): string {
  let src = String(raw ?? '').replace(/\u0000/g, '').slice(0, 12000);
  src = src.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  src = src.replace(/<span\b[^>]*font-weight:\s*(?:bold|[6-9]00)[^>]*>([\s\S]*?)<\/span>/gi, '<strong>$1</strong>');
  src = src.replace(/<span\b[^>]*font-style:\s*italic[^>]*>([\s\S]*?)<\/span>/gi, '<em>$1</em>');
  src = src.replace(/<span\b[^>]*text-decoration:[^;">]*underline[^>]*>([\s\S]*?)<\/span>/gi, '<u>$1</u>');
  src = src.replace(/<div\b[^>]*>/gi, '<p>').replace(/<\/div>/gi, '</p>');

  let out = '';
  let i = 0;
  while (i < src.length) {
    if (src[i] !== '<') {
      const next = src.indexOf('<', i);
      const end = next === -1 ? src.length : next;
      out += escapeText(decodeBasic(src.slice(i, end)));
      i = end;
      continue;
    }
    const close = src.indexOf('>', i + 1);
    if (close === -1) {
      out += escapeText(decodeBasic(src.slice(i)));
      break;
    }
    const token = src.slice(i, close + 1);
    const tag = /^<\s*(\/)?\s*([a-z0-9]+)/i.exec(token);
    i = close + 1;
    if (!tag) continue;
    const name = tag[2].toLowerCase();
    if (!ALLOWED.has(name)) continue;
    out += name === 'br' ? '<br>' : tag[1] ? `</${name}>` : `<${name}>`;
  }

  return out.replace(/^(?:<p>\s*<\/p>|<br>|\s)+|(?:<p>\s*<\/p>|<br>|\s)+$/g, '').slice(0, 8000);
}
