/**
 * Personal grimoire stored on player progression.
 * Indexing a spell does not grant the right to cast it.
 * A malevolent spell written here gives a microscopic edge when that same working is turned on you.
 */

import { censorWords } from '../chat/filter.js';
import { sanitizeGrimoireMarkup } from '../grimoire/markup.js';
import type { InventorySlot, InventorySlotMetadata } from '../types/index.js';

export const GRIMOIRE_NOTE_COUNT = 5;
export const GRIMOIRE_MALEVOLENT_WARD = 1;
/** Tradeable page written in the Author section. Right-click copies it into Shared. */
export const GRIMOIRE_MANUSCRIPT_ITEM_ID = 'grimoire_manuscript';

export const GRIMOIRE_INKS = ['iron', 'violet', 'gold', 'moss', 'blood'] as const;
export type GrimoireInk = (typeof GRIMOIRE_INKS)[number];

export type GrimoireSpellSource = 'cast' | 'studied' | 'shared';

export interface GrimoireSpellEntry {
  spellId: string;
  source: GrimoireSpellSource;
  sharedByName?: string;
  firstRecordedAt: number;
  timesCast: number;
  lastCastAt?: number;
  note?: string;
}

export interface GrimoireIngredientEntry {
  itemId: string;
  firstHeldAt: number;
  timesGathered: number;
}

export interface GrimoireSpiritEncounter {
  spiritId: string;
  /** Primary domain, such as healing or hex. */
  spiritType: string;
  name: string;
  description: string;
  domains: string[];
  metAt: number;
  timesMet: number;
  note?: string;
}

export interface GrimoireNpcEntry {
  npcId: string;
  name: string;
  relationship: number;
  metAt: number;
  note?: string;
}

export interface GrimoireCustomization {
  title: string;
  dedication: string;
  ink: GrimoireInk;
  /** When false, sealed pages received from someone else stay in the index but off the open list. */
  showLockedShared: boolean;
}

/** A page the player wrote and may export as a tradeable manuscript. */
export interface GrimoireAuthoredPage {
  id: string;
  title: string;
  body: string;
  updatedAt: number;
}

/** A manuscript another practitioner sold or gave you, taken into the book. */
export interface GrimoireSharedPage {
  id: string;
  title: string;
  body: string;
  authorName: string;
  receivedAt: number;
}

export interface GrimoireState {
  custom: GrimoireCustomization;
  spells: GrimoireSpellEntry[];
  ingredients: GrimoireIngredientEntry[];
  spirits: GrimoireSpiritEncounter[];
  npcs: GrimoireNpcEntry[];
  selectedSpiritId?: string;
  notes: string[];
  notesActive: number;
  authored: GrimoireAuthoredPage[];
  authoredActive?: string;
  sharedPages: GrimoireSharedPage[];
  sharedActive?: string;
}

export interface GrimoireManuscriptMeta {
  manuscriptTitle: string;
  manuscriptBody: string;
  manuscriptAuthor: string;
  manuscriptAuthorId?: string;
  manuscriptAuthoredAt: number;
  manuscriptPageId: string;
}

export interface GrimoireSpiritDraft {
  spiritId: string;
  spiritType: string;
  name: string;
  description: string;
  domains: string[];
}

const MAX_SPELLS = 96;
const MAX_INGREDIENTS = 240;
const MAX_SPIRITS = 48;
const MAX_NPCS = 96;
const MAX_NOTE = 4000;
const MAX_MARGIN = 280;
const MAX_TITLE = 48;
const MAX_DEDICATION = 180;
const MAX_NAME = 80;
const MAX_AUTHORED = 24;
const MAX_SHARED_PAGES = 48;
const MAX_AUTHOR_TITLE = 80;
const DEFAULT_TITLE = 'Personal Grimoire';
const DEFAULT_PAGE_TITLE = 'Untitled page';

function clip(text: unknown, max: number): string {
  return String(text ?? '').replace(/\u0000/g, '').slice(0, max);
}

function finiteTime(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function clampCount(value: unknown, max = 9999): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
  return Math.max(0, Math.min(max, n));
}

function cleanId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const id = value.trim();
  if (!/^[a-zA-Z0-9_.:-]{1,64}$/.test(id)) return '';
  return id;
}

export function defaultGrimoire(): GrimoireState {
  return {
    custom: {
      title: DEFAULT_TITLE,
      dedication: '',
      ink: 'iron',
      showLockedShared: true,
    },
    spells: [],
    ingredients: [],
    spirits: [],
    npcs: [],
    notes: Array.from({ length: GRIMOIRE_NOTE_COUNT }, () => ''),
    notesActive: 0,
    authored: [],
    sharedPages: [],
  };
}

function newPageId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function cleanAuthoredGrimoireTitle(raw: unknown, filterWords: readonly string[] = []): string {
  const plain = String(raw ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clip(censorWords(plain, filterWords), MAX_AUTHOR_TITLE).trim() || DEFAULT_PAGE_TITLE;
}

export function cleanAuthoredGrimoireBody(raw: unknown, filterWords: readonly string[] = []): string {
  return sanitizeGrimoireMarkup(censorWords(String(raw ?? ''), filterWords));
}

function parseAuthored(raw: unknown): GrimoireAuthoredPage[] {
  if (!Array.isArray(raw)) return [];
  const out: GrimoireAuthoredPage[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const id = cleanId(o.id) || newPageId('page');
    if (seen.has(id)) continue;
    seen.add(id);
    const title = cleanAuthoredGrimoireTitle(o.title);
    const body = cleanAuthoredGrimoireBody(o.body);
    if (!body && title === DEFAULT_PAGE_TITLE) continue;
    out.push({
      id,
      title,
      body,
      updatedAt: finiteTime(o.updatedAt, Date.now()),
    });
    if (out.length >= MAX_AUTHORED) break;
  }
  return out;
}

function parseSharedPages(raw: unknown): GrimoireSharedPage[] {
  if (!Array.isArray(raw)) return [];
  const out: GrimoireSharedPage[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const id = cleanId(o.id) || newPageId('shared');
    if (seen.has(id)) continue;
    seen.add(id);
    const body = cleanAuthoredGrimoireBody(o.body);
    if (!body) continue;
    out.push({
      id,
      title: cleanAuthoredGrimoireTitle(o.title),
      body,
      authorName: clip(o.authorName, MAX_NAME).trim() || 'Someone',
      receivedAt: finiteTime(o.receivedAt, Date.now()),
    });
    if (out.length >= MAX_SHARED_PAGES) break;
  }
  return out;
}

export function readManuscriptMeta(slot: InventorySlot | null | undefined): GrimoireManuscriptMeta | null {
  if (!slot || slot.itemId !== GRIMOIRE_MANUSCRIPT_ITEM_ID || !slot.metadata) return null;
  const meta = slot.metadata as InventorySlotMetadata;
  const body = cleanAuthoredGrimoireBody(meta.manuscriptBody);
  if (!body) return null;
  return {
    manuscriptTitle: cleanAuthoredGrimoireTitle(meta.manuscriptTitle),
    manuscriptBody: body,
    manuscriptAuthor: clip(meta.manuscriptAuthor, MAX_NAME).trim() || 'Someone',
    manuscriptAuthorId: cleanId(meta.manuscriptAuthorId) || undefined,
    manuscriptAuthoredAt: finiteTime(meta.manuscriptAuthoredAt, Date.now()),
    manuscriptPageId: cleanId(meta.manuscriptPageId) || newPageId('page'),
  };
}

export function manuscriptMetadataFromPage(
  page: GrimoireAuthoredPage,
  authorName: string,
  authorPlayerId?: string
): InventorySlotMetadata {
  return {
    manuscriptTitle: page.title,
    manuscriptBody: page.body,
    manuscriptAuthor: clip(authorName, MAX_NAME).trim() || 'Someone',
    manuscriptAuthorId: cleanId(authorPlayerId) || undefined,
    manuscriptAuthoredAt: page.updatedAt,
    manuscriptPageId: page.id,
  };
}

function parseSpells(raw: unknown): GrimoireSpellEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: GrimoireSpellEntry[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const spellId = cleanId(o.spellId);
    if (!spellId || seen.has(spellId)) continue;
    seen.add(spellId);
    const source: GrimoireSpellSource =
      o.source === 'shared' || o.source === 'studied' || o.source === 'cast' ? o.source : 'studied';
    const note = clip(o.note, MAX_MARGIN).trim();
    const sharedByName = clip(o.sharedByName, 40).trim();
    out.push({
      spellId,
      source,
      sharedByName: source === 'shared' && sharedByName ? sharedByName : undefined,
      firstRecordedAt: finiteTime(o.firstRecordedAt, Date.now()),
      timesCast: clampCount(o.timesCast),
      lastCastAt: typeof o.lastCastAt === 'number' && o.lastCastAt > 0 ? Math.floor(o.lastCastAt) : undefined,
      note: note || undefined,
    });
    if (out.length >= MAX_SPELLS) break;
  }
  return out;
}

function parseIngredients(raw: unknown): GrimoireIngredientEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: GrimoireIngredientEntry[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const itemId = cleanId(o.itemId);
    if (!itemId || seen.has(itemId)) continue;
    seen.add(itemId);
    out.push({
      itemId,
      firstHeldAt: finiteTime(o.firstHeldAt, Date.now()),
      timesGathered: Math.max(1, clampCount(o.timesGathered)),
    });
    if (out.length >= MAX_INGREDIENTS) break;
  }
  return out;
}

function parseSpirits(raw: unknown): GrimoireSpiritEncounter[] {
  if (!Array.isArray(raw)) return [];
  const out: GrimoireSpiritEncounter[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const spiritId = cleanId(o.spiritId);
    if (!spiritId || seen.has(spiritId)) continue;
    seen.add(spiritId);
    const domains = Array.isArray(o.domains)
      ? o.domains.map((d) => clip(d, 32).trim()).filter(Boolean).slice(0, 6)
      : [];
    const note = clip(o.note, MAX_MARGIN).trim();
    out.push({
      spiritId,
      spiritType: clip(o.spiritType, 32).trim() || domains[0] || 'spirit',
      name: clip(o.name, MAX_NAME).trim() || spiritId,
      description: clip(o.description, 360).trim(),
      domains,
      metAt: finiteTime(o.metAt, Date.now()),
      timesMet: Math.max(1, clampCount(o.timesMet, 999)),
      note: note || undefined,
    });
    if (out.length >= MAX_SPIRITS) break;
  }
  return out;
}

function parseNpcs(raw: unknown): GrimoireNpcEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: GrimoireNpcEntry[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const npcId = cleanId(o.npcId);
    if (!npcId || seen.has(npcId)) continue;
    seen.add(npcId);
    const note = clip(o.note, MAX_MARGIN).trim();
    const relationship = typeof o.relationship === 'number' && Number.isFinite(o.relationship) ? o.relationship : 0;
    out.push({
      npcId,
      name: clip(o.name, MAX_NAME).trim() || npcId,
      relationship: Math.max(0, Math.min(100, Math.round(relationship))),
      metAt: finiteTime(o.metAt, Date.now()),
      note: note || undefined,
    });
    if (out.length >= MAX_NPCS) break;
  }
  return out;
}

export function parseGrimoire(raw: unknown): GrimoireState {
  const base = defaultGrimoire();
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Record<string, unknown>;
  const customRaw = o.custom && typeof o.custom === 'object' ? (o.custom as Record<string, unknown>) : {};
  const ink = GRIMOIRE_INKS.includes(customRaw.ink as GrimoireInk) ? (customRaw.ink as GrimoireInk) : 'iron';
  const notes = Array.isArray(o.notes) ? o.notes.slice(0, GRIMOIRE_NOTE_COUNT).map((n) => clip(n, MAX_NOTE)) : [];
  while (notes.length < GRIMOIRE_NOTE_COUNT) notes.push('');
  const spirits = parseSpirits(o.spirits);
  const selected = cleanId(o.selectedSpiritId);
  const authored = parseAuthored(o.authored);
  const sharedPages = parseSharedPages(o.sharedPages);
  const authoredActive = cleanId(o.authoredActive);
  const sharedActive = cleanId(o.sharedActive);
  return {
    custom: {
      title: clip(customRaw.title, MAX_TITLE).trim() || DEFAULT_TITLE,
      dedication: clip(customRaw.dedication, MAX_DEDICATION),
      ink,
      showLockedShared: customRaw.showLockedShared !== false,
    },
    spells: parseSpells(o.spells),
    ingredients: parseIngredients(o.ingredients),
    spirits,
    npcs: parseNpcs(o.npcs),
    selectedSpiritId: selected && spirits.some((s) => s.spiritId === selected) ? selected : undefined,
    notes,
    notesActive: Math.min(
      GRIMOIRE_NOTE_COUNT - 1,
      Math.max(0, Math.floor(Number(o.notesActive) || 0))
    ),
    authored,
    authoredActive: authoredActive && authored.some((page) => page.id === authoredActive) ? authoredActive : undefined,
    sharedPages,
    sharedActive: sharedActive && sharedPages.some((page) => page.id === sharedActive) ? sharedActive : undefined,
  };
}

export function grimoireKnowsSpell(grimoire: GrimoireState | undefined, spellId: string): boolean {
  if (!grimoire || !spellId) return false;
  return grimoire.spells.some((s) => s.spellId === spellId);
}

export function isMalevolentSpell(spell: { category?: string; moralEffect?: number } | undefined | null): boolean {
  if (!spell) return false;
  if (spell.category === 'baneful') return true;
  return typeof spell.moralEffect === 'number' && spell.moralEffect < 0;
}

/** +1 focus the caster must clear, only for a malevolent spell indexed in the target's book. */
export function malevolentGrimoireWard(
  grimoire: GrimoireState | undefined,
  spell: { id: string; category?: string; moralEffect?: number } | undefined | null
): number {
  if (!spell || !isMalevolentSpell(spell)) return 0;
  if (!grimoireKnowsSpell(grimoire, spell.id)) return 0;
  return GRIMOIRE_MALEVOLENT_WARD;
}

export function grimoireBondLabel(relationship: number): string {
  if (relationship >= 80) return 'dear to you';
  if (relationship >= 55) return 'trusted';
  if (relationship >= 30) return 'a friend';
  if (relationship >= 10) return 'an acquaintance';
  return 'newly met';
}

export function recordGrimoireCast(
  grimoire: GrimoireState,
  spellId: string,
  success: boolean,
  at = Date.now()
): GrimoireState {
  const id = cleanId(spellId);
  if (!id) return grimoire;
  const existing = grimoire.spells.find((s) => s.spellId === id);
  if (existing) {
    if (!success) return grimoire;
    return {
      ...grimoire,
      spells: grimoire.spells.map((s) =>
        s.spellId === id
          ? {
              ...s,
              source: 'cast',
              timesCast: clampCount(s.timesCast + 1),
              lastCastAt: at,
            }
          : s
      ),
    };
  }
  if (grimoire.spells.length >= MAX_SPELLS) return grimoire;
  return {
    ...grimoire,
    spells: [
      ...grimoire.spells,
      {
        spellId: id,
        source: success ? 'cast' : 'studied',
        firstRecordedAt: at,
        timesCast: success ? 1 : 0,
        lastCastAt: success ? at : undefined,
      },
    ],
  };
}

export function recordGrimoireStudied(grimoire: GrimoireState, spellId: string, at = Date.now()): GrimoireState {
  const id = cleanId(spellId);
  if (!id) return grimoire;
  const existing = grimoire.spells.find((s) => s.spellId === id);
  if (existing) {
    if (existing.source !== 'shared') return grimoire;
    return {
      ...grimoire,
      spells: grimoire.spells.map((s) => (s.spellId === id ? { ...s, source: 'studied' } : s)),
    };
  }
  if (grimoire.spells.length >= MAX_SPELLS) return grimoire;
  return {
    ...grimoire,
    spells: [
      ...grimoire.spells,
      { spellId: id, source: 'studied', firstRecordedAt: at, timesCast: 0 },
    ],
  };
}

export function shareSpellIntoGrimoire(
  grimoire: GrimoireState,
  spellId: string,
  sharedByName: string,
  at = Date.now()
): { grimoire: GrimoireState; status: 'added' | 'already' | 'full' } {
  const id = cleanId(spellId);
  if (!id) return { grimoire, status: 'already' };
  if (grimoire.spells.some((s) => s.spellId === id)) return { grimoire, status: 'already' };
  if (grimoire.spells.length >= MAX_SPELLS) return { grimoire, status: 'full' };
  const name = clip(sharedByName, 40).trim() || 'a coven mate';
  return {
    status: 'added',
    grimoire: {
      ...grimoire,
      spells: [
        ...grimoire.spells,
        {
          spellId: id,
          source: 'shared',
          sharedByName: name,
          firstRecordedAt: at,
          timesCast: 0,
        },
      ],
    },
  };
}

type IngredientTouch = string | { itemId: string; count?: number };

export function recordGrimoireIngredients(
  grimoire: GrimoireState,
  entries: IngredientTouch[],
  at = Date.now()
): GrimoireState {
  let ingredients = grimoire.ingredients;
  let changed = false;
  for (const entry of entries) {
    const itemId = cleanId(typeof entry === 'string' ? entry : entry.itemId);
    if (!itemId || itemId.startsWith('taglock') || itemId === GRIMOIRE_MANUSCRIPT_ITEM_ID) continue;
    const count = Math.max(1, Math.min(99, clampCount(typeof entry === 'string' ? 1 : entry.count ?? 1, 99) || 1));
    const idx = ingredients.findIndex((row) => row.itemId === itemId);
    if (idx >= 0) {
      const row = ingredients[idx];
      if (!changed) ingredients = ingredients.slice();
      ingredients[idx] = { ...row, timesGathered: clampCount(row.timesGathered + count) };
      changed = true;
      continue;
    }
    if (ingredients.length >= MAX_INGREDIENTS) continue;
    if (!changed) ingredients = ingredients.slice();
    ingredients.push({ itemId, firstHeldAt: at, timesGathered: count });
    changed = true;
  }
  return changed ? { ...grimoire, ingredients } : grimoire;
}

/** Add ingredients the player already holds, without raising the count on pages already written. */
export function backfillGrimoireIngredients(
  grimoire: GrimoireState,
  itemIds: string[],
  at = Date.now()
): GrimoireState {
  const have = new Set(grimoire.ingredients.map((row) => row.itemId));
  const missing = [...new Set(itemIds.map((id) => cleanId(id)).filter((id) => id && !have.has(id)))];
  if (!missing.length) return grimoire;
  return recordGrimoireIngredients(grimoire, missing, at);
}

export function recordGrimoireSpirit(
  grimoire: GrimoireState,
  draft: GrimoireSpiritDraft,
  at = Date.now(),
  repeat = false
): { grimoire: GrimoireState; status: 'added' | 'again' | 'full' } {
  const spiritId = cleanId(draft.spiritId);
  if (!spiritId) return { grimoire, status: 'again' };
  const existing = grimoire.spirits.find((s) => s.spiritId === spiritId);
  if (existing) {
    if (!repeat) return { grimoire, status: 'again' };
    return {
      status: 'again',
      grimoire: {
        ...grimoire,
        spirits: grimoire.spirits.map((s) =>
          s.spiritId === spiritId ? { ...s, timesMet: clampCount(s.timesMet + 1, 999) } : s
        ),
      },
    };
  }
  if (grimoire.spirits.length >= MAX_SPIRITS) return { grimoire, status: 'full' };
  const domains = (draft.domains ?? []).map((d) => clip(d, 32).trim()).filter(Boolean).slice(0, 6);
  return {
    status: 'added',
    grimoire: {
      ...grimoire,
      spirits: [
        ...grimoire.spirits,
        {
          spiritId,
          spiritType: clip(draft.spiritType, 32).trim() || domains[0] || 'spirit',
          name: clip(draft.name, MAX_NAME).trim() || spiritId,
          description: clip(draft.description, 360).trim(),
          domains,
          metAt: at,
          timesMet: 1,
        },
      ],
    },
  };
}

export function selectGrimoireSpirit(grimoire: GrimoireState, spiritId: string): GrimoireState {
  const id = cleanId(spiritId);
  if (!id || !grimoire.spirits.some((s) => s.spiritId === id)) return grimoire;
  if (grimoire.selectedSpiritId === id) return grimoire;
  return { ...grimoire, selectedSpiritId: id };
}

export function recordGrimoireNpc(
  grimoire: GrimoireState,
  npc: { npcId: string; name: string; relationship: number },
  at = Date.now()
): GrimoireState {
  const npcId = cleanId(npc.npcId);
  if (!npcId) return grimoire;
  const name = clip(npc.name, MAX_NAME).trim() || npcId;
  const relationship = Math.max(0, Math.min(100, Math.round(npc.relationship || 0)));
  const existing = grimoire.npcs.find((row) => row.npcId === npcId);
  if (existing) {
    if (existing.name === name && existing.relationship === relationship) return grimoire;
    return {
      ...grimoire,
      npcs: grimoire.npcs.map((row) => (row.npcId === npcId ? { ...row, name, relationship } : row)),
    };
  }
  if (grimoire.npcs.length >= MAX_NPCS) return grimoire;
  return {
    ...grimoire,
    npcs: [...grimoire.npcs, { npcId, name, relationship, metAt: at }],
  };
}

export function customizeGrimoire(
  grimoire: GrimoireState,
  patch: Partial<GrimoireCustomization>
): GrimoireState {
  const title = patch.title !== undefined ? clip(patch.title, MAX_TITLE).trim() || DEFAULT_TITLE : grimoire.custom.title;
  const dedication = patch.dedication !== undefined ? clip(patch.dedication, MAX_DEDICATION) : grimoire.custom.dedication;
  const ink = patch.ink && GRIMOIRE_INKS.includes(patch.ink) ? patch.ink : grimoire.custom.ink;
  const showLockedShared =
    patch.showLockedShared !== undefined ? !!patch.showLockedShared : grimoire.custom.showLockedShared;
  if (
    title === grimoire.custom.title &&
    dedication === grimoire.custom.dedication &&
    ink === grimoire.custom.ink &&
    showLockedShared === grimoire.custom.showLockedShared
  ) {
    return grimoire;
  }
  return { ...grimoire, custom: { title, dedication, ink, showLockedShared } };
}

export function setGrimoireNotes(grimoire: GrimoireState, pages: string[], active?: number): GrimoireState {
  const notes = pages.slice(0, GRIMOIRE_NOTE_COUNT).map((page) => clip(page, MAX_NOTE));
  while (notes.length < GRIMOIRE_NOTE_COUNT) notes.push('');
  const notesActive =
    active === undefined
      ? grimoire.notesActive
      : Math.min(GRIMOIRE_NOTE_COUNT - 1, Math.max(0, Math.floor(active) || 0));
  if (notesActive === grimoire.notesActive && notes.every((page, i) => page === grimoire.notes[i])) return grimoire;
  return { ...grimoire, notes, notesActive };
}

export function setGrimoireSpellNote(grimoire: GrimoireState, spellId: string, note: string): GrimoireState {
  const id = cleanId(spellId);
  const idx = grimoire.spells.findIndex((s) => s.spellId === id);
  if (idx < 0) return grimoire;
  const clipped = clip(note, MAX_MARGIN).trim();
  if ((grimoire.spells[idx].note ?? '') === clipped) return grimoire;
  const spells = grimoire.spells.slice();
  spells[idx] = { ...spells[idx], note: clipped || undefined };
  return { ...grimoire, spells };
}

export function setGrimoireNpcNote(grimoire: GrimoireState, npcId: string, note: string): GrimoireState {
  const id = cleanId(npcId);
  const idx = grimoire.npcs.findIndex((s) => s.npcId === id);
  if (idx < 0) return grimoire;
  const clipped = clip(note, MAX_MARGIN).trim();
  if ((grimoire.npcs[idx].note ?? '') === clipped) return grimoire;
  const npcs = grimoire.npcs.slice();
  npcs[idx] = { ...npcs[idx], note: clipped || undefined };
  return { ...grimoire, npcs };
}

export function setGrimoireSpiritNote(grimoire: GrimoireState, spiritId: string, note: string): GrimoireState {
  const id = cleanId(spiritId);
  const idx = grimoire.spirits.findIndex((s) => s.spiritId === id);
  if (idx < 0) return grimoire;
  const clipped = clip(note, MAX_MARGIN).trim();
  if ((grimoire.spirits[idx].note ?? '') === clipped) return grimoire;
  const spirits = grimoire.spirits.slice();
  spirits[idx] = { ...spirits[idx], note: clipped || undefined };
  return { ...grimoire, spirits };
}

export function upsertAuthoredGrimoirePage(
  grimoire: GrimoireState,
  draft: { id?: string; title?: string; body?: string },
  filterWords: readonly string[] = [],
  at = Date.now()
): { grimoire: GrimoireState; page: GrimoireAuthoredPage | null; status: 'saved' | 'full' | 'empty' } {
  const title = cleanAuthoredGrimoireTitle(draft.title, filterWords);
  const body = cleanAuthoredGrimoireBody(draft.body, filterWords);
  if (!body) return { grimoire, page: null, status: 'empty' };
  const id = cleanId(draft.id);
  const existingIdx = id ? grimoire.authored.findIndex((page) => page.id === id) : -1;
  if (existingIdx < 0 && grimoire.authored.length >= MAX_AUTHORED) {
    return { grimoire, page: null, status: 'full' };
  }
  const page: GrimoireAuthoredPage = {
    id: existingIdx >= 0 ? grimoire.authored[existingIdx].id : id || newPageId('page'),
    title,
    body,
    updatedAt: at,
  };
  const authored =
    existingIdx >= 0
      ? grimoire.authored.map((row, index) => (index === existingIdx ? page : row))
      : [...grimoire.authored, page];
  return { grimoire: { ...grimoire, authored, authoredActive: page.id }, page, status: 'saved' };
}

export function deleteAuthoredGrimoirePage(grimoire: GrimoireState, pageId: string): GrimoireState {
  const id = cleanId(pageId);
  if (!id) return grimoire;
  if (!grimoire.authored.some((page) => page.id === id)) return grimoire;
  const authored = grimoire.authored.filter((page) => page.id !== id);
  return {
    ...grimoire,
    authored,
    authoredActive: grimoire.authoredActive === id ? authored[0]?.id : grimoire.authoredActive,
  };
}

export function setAuthoredGrimoireActive(grimoire: GrimoireState, pageId: string): GrimoireState {
  const id = cleanId(pageId);
  if (!id || !grimoire.authored.some((page) => page.id === id)) return grimoire;
  if (grimoire.authoredActive === id) return grimoire;
  return { ...grimoire, authoredActive: id };
}

export function receiveSharedGrimoirePage(
  grimoire: GrimoireState,
  manuscript: GrimoireManuscriptMeta,
  at = Date.now()
): { grimoire: GrimoireState; page: GrimoireSharedPage | null; status: 'added' | 'full' | 'empty' } {
  const body = cleanAuthoredGrimoireBody(manuscript.manuscriptBody);
  if (!body) return { grimoire, page: null, status: 'empty' };
  if (grimoire.sharedPages.length >= MAX_SHARED_PAGES) return { grimoire, page: null, status: 'full' };
  const page: GrimoireSharedPage = {
    id: newPageId('shared'),
    title: cleanAuthoredGrimoireTitle(manuscript.manuscriptTitle),
    body,
    authorName: clip(manuscript.manuscriptAuthor, MAX_NAME).trim() || 'Someone',
    receivedAt: at,
  };
  return {
    status: 'added',
    page,
    grimoire: {
      ...grimoire,
      sharedPages: [...grimoire.sharedPages, page],
      sharedActive: page.id,
    },
  };
}

export function setSharedGrimoireActive(grimoire: GrimoireState, pageId: string): GrimoireState {
  const id = cleanId(pageId);
  if (!id || !grimoire.sharedPages.some((page) => page.id === id)) return grimoire;
  if (grimoire.sharedActive === id) return grimoire;
  return { ...grimoire, sharedActive: id };
}

export function deleteSharedGrimoirePage(grimoire: GrimoireState, pageId: string): GrimoireState {
  const id = cleanId(pageId);
  if (!id) return grimoire;
  if (!grimoire.sharedPages.some((page) => page.id === id)) return grimoire;
  const sharedPages = grimoire.sharedPages.filter((page) => page.id !== id);
  return {
    ...grimoire,
    sharedPages,
    sharedActive: grimoire.sharedActive === id ? sharedPages[0]?.id : grimoire.sharedActive,
  };
}
