import type { PlayerProgression } from '@witchcraft/shared';
import {
  customizeGrimoire,
  defaultGrimoire,
  licenseUnlocksSpirit,
  recordGrimoireSpirit,
  selectGrimoireSpirit,
  setGrimoireNotes,
  setGrimoireNpcNote,
  setGrimoireSpellNote,
  setGrimoireSpiritNote,
  type GrimoireInk,
} from '@witchcraft/shared';
import { contentRegistry } from '../content/registry.js';

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
  }
): PlayerProgression | null {
  let next = progression.grimoire ?? defaultGrimoire();
  const started = next;
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
  if (next === started) return null;
  return { ...progression, grimoire: next };
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
    return { progression, message: 'You have not met that spirit.', level: 'warn' };
  }
  const next = selectGrimoireSpirit(book, spiritId);
  return {
    progression: next === book ? progression : { ...progression, grimoire: next },
    message: `${known.name} is the name your book would call. The calling rite will use it once that rite is bound.`,
    level: 'info',
  };
}
