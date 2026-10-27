import type { PlayerProgression } from '@witchcraft/shared';
import {
  customizeGrimoire,
  defaultGrimoire,
  deleteAuthoredGrimoirePage,
  deleteSharedGrimoirePage,
  licenseUnlocksSpirit,
  recordGrimoireSpirit,
  selectGrimoireSpirit,
  setAuthoredGrimoireActive,
  setGrimoireNotes,
  setGrimoireNpcNote,
  setGrimoireSpellNote,
  setGrimoireSpiritNote,
  setSharedGrimoireActive,
  upsertAuthoredGrimoirePage,
  type GrimoireInk,
} from '@witchcraft/shared';
import { contentRegistry } from '../content/registry.js';
import { getChatFilterWords } from '../systems/chat-filter.js';

const INKS = new Set<GrimoireInk>(['iron', 'violet', 'gold', 'moss', 'blood']);

export function mergeGrimoireWrite(
  progression: PlayerProgression,
  raw: {
    custom?: { title?: string; dedication?: string; ink?: string; showLockedShared?: boolean };
    notes?: unknown;
    notesActive?: unknown;
    spellNote?: { spellId?: string; note?: string };
    npcNote?: { npcId?: string; note?: string };
    spiritNote?: { spiritId?: string; note?: string };
    authoredPage?: { id?: string; title?: string; body?: string };
    authoredDeleteId?: string;
    authoredActive?: string;
    sharedDeleteId?: string;
    sharedActive?: string;
  }
): { progression: PlayerProgression | null; message?: string; level?: 'info' | 'warn' | 'success' } {
  let next = progression.grimoire ?? defaultGrimoire();
  const started = next;
  let message: string | undefined;
  let level: 'info' | 'warn' | 'success' | undefined;
  if (raw.custom && typeof raw.custom === 'object') {
    const ink = INKS.has(raw.custom.ink as GrimoireInk) ? (raw.custom.ink as GrimoireInk) : undefined;
    next = customizeGrimoire(next, {
      title: typeof raw.custom.title === 'string' ? raw.custom.title : undefined,
      dedication: typeof raw.custom.dedication === 'string' ? raw.custom.dedication : undefined,
      ink,
      showLockedShared: typeof raw.custom.showLockedShared === 'boolean' ? raw.custom.showLockedShared : undefined,
    });
  }
  if (Array.isArray(raw.notes)) {
    const pages = raw.notes.map((page) => String(page ?? ''));
    const active = typeof raw.notesActive === 'number' ? raw.notesActive : undefined;
    next = setGrimoireNotes(next, pages, active);
  } else if (typeof raw.notesActive === 'number') {
    next = setGrimoireNotes(next, next.notes, raw.notesActive);
  }
  if (raw.spellNote && typeof raw.spellNote.spellId === 'string') {
    next = setGrimoireSpellNote(next, raw.spellNote.spellId, String(raw.spellNote.note ?? ''));
  }
  if (raw.npcNote && typeof raw.npcNote.npcId === 'string') {
    next = setGrimoireNpcNote(next, raw.npcNote.npcId, String(raw.npcNote.note ?? ''));
  }
  if (raw.spiritNote && typeof raw.spiritNote.spiritId === 'string') {
    next = setGrimoireSpiritNote(next, raw.spiritNote.spiritId, String(raw.spiritNote.note ?? ''));
  }
  if (typeof raw.authoredDeleteId === 'string') {
    next = deleteAuthoredGrimoirePage(next, raw.authoredDeleteId);
  }
  if (raw.authoredPage && typeof raw.authoredPage === 'object') {
    const saved = upsertAuthoredGrimoirePage(next, raw.authoredPage, getChatFilterWords());
    next = saved.grimoire;
    if (saved.status === 'full') {
      message = 'Your Author section is full. Clear a page before writing another.';
      level = 'warn';
    } else if (saved.status === 'empty') {
      message = 'Write something on the page before saving it.';
      level = 'warn';
    } else {
      message = 'Author page saved.';
      level = 'success';
    }
  }
  if (typeof raw.authoredActive === 'string') {
    next = setAuthoredGrimoireActive(next, raw.authoredActive);
  }
  if (typeof raw.sharedDeleteId === 'string') {
    next = deleteSharedGrimoirePage(next, raw.sharedDeleteId);
  }
  if (typeof raw.sharedActive === 'string') {
    next = setSharedGrimoireActive(next, raw.sharedActive);
  }
  if (next === started) return { progression: null, message, level };
  return { progression: { ...progression, grimoire: next }, message, level };
}

export function petitionGrimoireSpirit(
  progression: PlayerProgression,
  spiritId: string
): { progression: PlayerProgression; message: string; level: 'info' | 'success' | 'warn' } {
  const spirit = contentRegistry.spirits.get(spiritId) as
    | { id: string; name?: string; description?: string; domains?: string[] }
    | undefined;
  if (!spirit) {
    return { progression, message: 'That presence is not in the records.', level: 'warn' };
  }
  if (!licenseUnlocksSpirit(spirit.id, progression)) {
    return { progression, message: 'That presence does not answer you yet.', level: 'warn' };
  }
  const domains = Array.isArray(spirit.domains) ? spirit.domains.map(String) : [];
  const recorded = recordGrimoireSpirit(progression.grimoire ?? defaultGrimoire(), {
    spiritId: spirit.id,
    spiritType: domains[0] || 'spirit',
    name: String(spirit.name ?? spirit.id),
    description: String(spirit.description ?? ''),
    domains,
  });
  if (recorded.status !== 'added') {
    return {
      progression,
      message: `${spirit.name ?? 'That spirit'} is already written in your book.`,
      level: 'info',
    };
  }
  return {
    progression: { ...progression, grimoire: recorded.grimoire },
    message: `${spirit.name ?? 'The spirit'} is written into your grimoire.`,
    level: 'success',
  };
}

export function recallGrimoireSpirit(
  progression: PlayerProgression,
  spiritId: string
): { progression: PlayerProgression; message: string; level: 'info' | 'warn' } {
  const book = progression.grimoire ?? defaultGrimoire();
  const known = book.spirits.find((s) => s.spiritId === spiritId);
  if (!known) {
    return { progression, message: 'That spirit is not written in your book yet.', level: 'warn' };
  }
  return {
    progression: { ...progression, grimoire: selectGrimoireSpirit(book, spiritId) },
    message: `${known.name} is the name your book would call.`,
    level: 'info',
  };
}
