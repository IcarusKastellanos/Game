import {
  emptyGrimoireEntryMap,
  isGrimoireEntryKind,
  sanitizeGrimoireMarkup,
  type GrimoireEntryKind,
  type GrimoireEntryMap,
} from '@witchcraft/shared';
import { readContentObject, writeContentObject } from './json-persist.js';
import { contentRegistry } from './registry.js';
import { craftingSystem } from '../systems/crafting-system.js';
import { hexagramEnchantSystem } from '../systems/hexagram-enchant-system.js';
import { questSystem } from '../systems/quest-system.js';

const FILE = 'grimoire-entries.json';

let entries: GrimoireEntryMap = emptyGrimoireEntryMap();

export interface GrimoireCatalogRecord {
  id: string;
  name: string;
  plain: string;
  grimoireEntry: string;
}

function clipPlain(text: unknown): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

export function loadGrimoireEntries(): void {
  const next = emptyGrimoireEntryMap();
  const raw = readContentObject<Partial<Record<string, Record<string, unknown>>>>(FILE);
  if (raw) {
    for (const kind of Object.keys(next) as GrimoireEntryKind[]) {
      const bucket = raw[kind];
      if (!bucket || typeof bucket !== 'object') continue;
      for (const [id, value] of Object.entries(bucket)) {
        const clean = sanitizeGrimoireMarkup(value);
        if (id && clean) next[kind][id] = clean;
      }
    }
  }
  entries = next;
}

export function getGrimoireEntries(): GrimoireEntryMap {
  const copy = emptyGrimoireEntryMap();
  for (const kind of Object.keys(copy) as GrimoireEntryKind[]) {
    copy[kind] = { ...entries[kind] };
  }
  return copy;
}

export function setGrimoireEntry(kind: string, id: string, raw: unknown): string | null {
  if (!isGrimoireEntryKind(kind)) return null;
  const recordId = String(id ?? '').trim();
  if (!recordId || recordId.length > 80) return null;
  const clean = sanitizeGrimoireMarkup(raw);
  if (clean) entries[kind][recordId] = clean;
  else delete entries[kind][recordId];
  writeContentObject(FILE, entries);
  return clean;
}

function bookRecords(): GrimoireCatalogRecord[] {
  const doc = readContentObject<{ books?: { id: string; title?: string; pages?: string[] }[] }>('books.json');
  return (doc?.books ?? []).map((book) => ({
    id: book.id,
    name: book.title?.trim() || book.id,
    plain: clipPlain(book.pages?.[0] ?? ''),
    grimoireEntry: entries.books[book.id] ?? '',
  }));
}

export function grimoireCatalog(kind: GrimoireEntryKind): GrimoireCatalogRecord[] {
  const stored = entries[kind] ?? {};
  if (kind === 'spells') {
    return [...contentRegistry.spells.values()].map((spell) => ({
      id: spell.id,
      name: spell.name,
      plain: clipPlain(spell.description),
      grimoireEntry: stored[spell.id] ?? '',
    }));
  }
  if (kind === 'items') {
    return [...contentRegistry.ingredients.values()].map((item) => ({
      id: item.id,
      name: item.name,
      plain: clipPlain(item.description),
      grimoireEntry: stored[item.id] ?? '',
    }));
  }
  if (kind === 'spirits') {
    return [...contentRegistry.spirits.values()].map((spirit) => {
      const row = spirit as { id: string; name?: string; description?: string };
      return {
        id: row.id,
        name: row.name?.trim() || row.id,
        plain: clipPlain(row.description),
        grimoireEntry: stored[row.id] ?? '',
      };
    });
  }
  if (kind === 'npcs') {
    return [...contentRegistry.npcs.values()].map((npc) => ({
      id: npc.id,
      name: npc.name,
      plain: clipPlain(npc.role),
      grimoireEntry: stored[npc.id] ?? '',
    }));
  }
  if (kind === 'familiars') {
    return [...contentRegistry.familiars.values()].map((familiar) => ({
      id: familiar.id,
      name: familiar.defaultPublicName || familiar.id,
      plain: clipPlain(familiar.description),
      grimoireEntry: stored[familiar.id] ?? '',
    }));
  }
  if (kind === 'recipes') {
    const crafts = [...craftingSystem.recipes.values()].map((recipe) => ({
      id: recipe.id,
      name: recipe.name,
      plain: clipPlain(recipe.description),
      grimoireEntry: stored[recipe.id] ?? '',
    }));
    const hexes = [...hexagramEnchantSystem.recipes.values()].map((recipe) => ({
      id: recipe.id,
      name: recipe.name,
      plain: clipPlain(recipe.description),
      grimoireEntry: stored[recipe.id] ?? '',
    }));
    return [...crafts, ...hexes];
  }
  if (kind === 'books') return bookRecords();
  return [...questSystem.quests.values()].map((quest) => ({
    id: quest.id,
    name: quest.name,
    plain: clipPlain(quest.description),
    grimoireEntry: stored[quest.id] ?? '',
  }));
}

export function grimoireEntryNames(): Record<GrimoireEntryKind, Record<string, string>> {
  const names = emptyGrimoireEntryMap();
  for (const kind of Object.keys(names) as GrimoireEntryKind[]) {
    if (!Object.keys(entries[kind]).length) continue;
    for (const record of grimoireCatalog(kind)) {
      if (entries[kind][record.id]) names[kind][record.id] = record.name;
    }
  }
  return names;
}

export function grimoireRecordExists(kind: GrimoireEntryKind, id: string): boolean {
  return grimoireCatalog(kind).some((record) => record.id === id);
}
