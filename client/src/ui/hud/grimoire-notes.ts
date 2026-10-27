const KEY = 'witchcraft_grimoire_notes_v1';
export const GRIMOIRE_NOTE_PAGES = 5;

export interface GrimoireNotes {
  active: number;
  pages: string[];
}

function emptyNotes(): GrimoireNotes {
  return { active: 0, pages: Array.from({ length: GRIMOIRE_NOTE_PAGES }, () => '') };
}

export function loadGrimoireNotes(): GrimoireNotes {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '') as { active?: unknown; pages?: unknown };
    const pages = Array.isArray(raw.pages) ? raw.pages.map((page) => String(page ?? '')) : [];
    while (pages.length < GRIMOIRE_NOTE_PAGES) pages.push('');
    const active = Math.min(GRIMOIRE_NOTE_PAGES - 1, Math.max(0, Math.floor(Number(raw.active) || 0)));
    return { active, pages: pages.slice(0, GRIMOIRE_NOTE_PAGES) };
  } catch {
    return emptyNotes();
  }
}

export function saveGrimoireNotes(notes: GrimoireNotes): void {
  const pages = notes.pages.slice(0, GRIMOIRE_NOTE_PAGES).map((page) => String(page ?? ''));
  while (pages.length < GRIMOIRE_NOTE_PAGES) pages.push('');
  const active = Math.min(GRIMOIRE_NOTE_PAGES - 1, Math.max(0, Math.floor(notes.active) || 0));
  localStorage.setItem(KEY, JSON.stringify({ active, pages }));
}
