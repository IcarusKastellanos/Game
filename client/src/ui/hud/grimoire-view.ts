import {
  defaultProgression,
  formatContentLabel,
  grimoireBondLabel,
  isMalevolentSpell,
  levelGateMessage,
  licenseGateMessage,
  licenseUnlocksSpell,
  licenseUnlocksSpirit,
  meetsMinLevel,
  meetsSpellLicenseGate,
  playerLevel,
  selectGrimoireSpirit,
  setAuthoredGrimoireActive,
  setGrimoireNotes,
  setGrimoireNpcNote,
  setGrimoireSpellNote,
  setGrimoireSpiritNote,
  setSharedGrimoireActive,
  customizeGrimoire,
  sanitizeGrimoireMarkup,
  type ContentSpell,
  type GrimoireEntryKind,
  type GrimoireInk,
  type GrimoireSharedPage,
  type GrimoireSpellEntry,
  type GrimoireState,
  type PlayerProgression,
} from '@witchcraft/shared';
import { gameState } from '../../data/game-state.js';
import { network } from '../../net/NetworkManager.js';
import { escapeHtml } from '../ledger-chrome.js';
import { GRIMOIRE_NOTE_PAGES, loadGrimoireNotes } from './grimoire-notes.js';

const TABS = ['The Book', 'Spells', 'Ingredients', 'Spirits', 'People', 'Author', 'Shared', 'Notes'] as const;
export type GrimoireTab = (typeof TABS)[number];

const INK_LABELS: Record<GrimoireInk, string> = {
  iron: 'Iron gall',
  violet: 'Violet',
  gold: 'Gold',
  moss: 'Moss',
  blood: 'Blood',
};

const openId = { spell: '', item: '', npc: '', spirit: '' };
const timers = new Map<string, number>();

function book(): GrimoireState {
  return gameState.progression?.grimoire ?? defaultProgression().grimoire;
}

function experience(): number {
  try {
    const stats = JSON.parse(gameState.localPlayer?.statsJson ?? '{}') as { experience?: number };
    return typeof stats.experience === 'number' ? stats.experience : 0;
  } catch {
    return 0;
  }
}

function progression(): PlayerProgression {
  return gameState.progression ?? defaultProgression();
}

function debounce(key: string, fn: () => void, ms = 450): void {
  const prev = timers.get(key);
  if (prev) window.clearTimeout(prev);
  timers.set(key, window.setTimeout(fn, ms));
}

function publish(type: string, payload: Record<string, unknown>, next: GrimoireState): void {
  if (gameState.progression) gameState.progression = { ...gameState.progression, grimoire: next };
  network.send(type, payload);
}

function spells(): ContentSpell[] {
  return gameState.content?.spells ?? [];
}

function spellById(id: string): ContentSpell | undefined {
  return spells().find((spell) => spell.id === id);
}

function ingredientById(id: string): {
  id: string;
  name: string;
  category?: string;
  description?: string;
  rarity?: string;
  correspondences?: string[];
} | undefined {
  return (gameState.content?.ingredients ?? []).find((item) => item.id === id) as
    | {
        id: string;
        name: string;
        category?: string;
        description?: string;
        rarity?: string;
        correspondences?: string[];
      }
    | undefined;
}

function proseBlock(kind: GrimoireEntryKind, id: string, fallback: string): string {
  const markup = sanitizeGrimoireMarkup(gameState.content?.grimoireEntries?.[kind]?.[id] ?? '');
  if (markup) return `<div class="hud-grimoire__prose">${markup}</div>`;
  if (!fallback.trim()) return '';
  return `<p>${escapeHtml(fallback)}</p>`;
}

function entryName(kind: GrimoireEntryKind, id: string): string {
  return gameState.content?.grimoireEntryNames?.[kind]?.[id] || formatContentLabel(id);
}

function furtherPages(): string {
  const prog = progression();
  const known = new Set<string>();
  const blocks: string[] = [];
  const add = (kind: GrimoireEntryKind, id: string): void => {
    const key = `${kind}:${id}`;
    if (known.has(key)) return;
    const markup = sanitizeGrimoireMarkup(gameState.content?.grimoireEntries?.[kind]?.[id] ?? '');
    if (!markup) return;
    known.add(key);
    blocks.push(`<article class="hud-grimoire__entry"><h4>${escapeHtml(entryName(kind, id))}</h4><div class="hud-grimoire__prose">${markup}</div></article>`);
  };
  for (const id of prog.readBooks ?? []) add('books', id);
  for (const id of prog.discoveredRecipes ?? []) add('recipes', id);
  for (const id of Object.keys(prog.questProgress ?? {})) add('quests', id);
  if (gameState.familiar?.templateId) add('familiars', gameState.familiar.templateId);
  if (!blocks.length) return '';
  return `<h4 class="hud-grimoire__sub">Further pages</h4>${blocks.join('')}`;
}

function sealText(spell: ContentSpell | undefined, prog: PlayerProgression): string | null {
  if (!spell) return 'This working is not in the common lists. The index remains, and it cannot be cast from here.';
  const xp = experience();
  if (!meetsMinLevel(xp, spell.minLevel)) {
    return levelGateMessage(spell.name, spell.minLevel ?? 1, playerLevel(xp));
  }
  if (!meetsSpellLicenseGate(spell, prog) || !licenseUnlocksSpell(spell.id, prog)) {
    const need = spell.requiresLicense ?? spell.requiresAnyLicense?.[0] ?? 'credential';
    return `${licenseGateMessage(need)} The page can stay in the book while the working remains sealed.`;
  }
  return null;
}

function writtenOn(at?: number): string {
  if (!at) return '';
  return new Date(at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function sourceLine(entry: GrimoireSpellEntry): string {
  if (entry.source === 'shared') {
    const who = entry.sharedByName?.trim() || 'Someone';
    return `${who} indexed this page for you on ${writtenOn(entry.firstRecordedAt) || 'a day you kept'}. The working stays sealed until your own level and license can cast it.`;
  }
  if (entry.timesCast > 0) {
    const times = entry.timesCast === 1 ? 'once' : `${entry.timesCast} times`;
    const last = entry.lastCastAt ? ` The last time was ${writtenOn(entry.lastCastAt)}.` : '';
    return `You have cast this ${times}.${last}`;
  }
  return `You studied this working and wrote it down${writtenOn(entry.firstRecordedAt) ? ` on ${writtenOn(entry.firstRecordedAt)}` : ''}. A completed cast will be counted here when one lands.`;
}

function maybeMigrate(current: GrimoireState): void {
  if (sessionStorage.getItem('witchcraft_grimoire_notes_migrated_v1')) return;
  if (current.notes.some((page) => page.trim())) {
    sessionStorage.setItem('witchcraft_grimoire_notes_migrated_v1', '1');
    return;
  }
  const local = loadGrimoireNotes();
  if (!local.pages.some((page) => page.trim())) return;
  sessionStorage.setItem('witchcraft_grimoire_notes_migrated_v1', '1');
  const notes = local.pages.slice(0, GRIMOIRE_NOTE_PAGES);
  while (notes.length < GRIMOIRE_NOTE_PAGES) notes.push('');
  const active = Math.min(GRIMOIRE_NOTE_PAGES - 1, Math.max(0, local.active));
  publish('grimoire_write', { notes, notesActive: active }, setGrimoireNotes(current, notes, active));
}

export function mountGrimoire(host: HTMLElement, tab: string, onTab: (tab: string) => void): void {
  const current = book();
  maybeMigrate(current);
  const active = (TABS as readonly string[]).includes(tab) ? tab : 'The Book';
  host.innerHTML = `
    <div class="hud-grimoire" data-ink="${escapeHtml(book().custom.ink)}">
      <nav class="hud-grimoire__tabs">
        ${TABS.map((name) => `<button type="button" class="hud-grimoire__tab${name === active ? ' is-active' : ''}" data-tab="${name}">${name}</button>`).join('')}
      </nav>
      <div class="hud-grimoire__page" id="grimoire-section"></div>
    </div>`;
  const section = host.querySelector('#grimoire-section');
  if (!section) return;
  paint(section, active);
  host.querySelectorAll('.hud-grimoire__tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = (btn as HTMLElement).dataset.tab ?? 'The Book';
      onTab(next);
      mountGrimoire(host, next, onTab);
    });
  });
}

function paint(section: Element, tab: string): void {
  const current = book();
  if (tab === 'The Book') paintBook(section, current);
  else if (tab === 'Spells') paintSpells(section, current);
  else if (tab === 'Ingredients') paintIngredients(section, current);
  else if (tab === 'Spirits') paintSpirits(section, current);
  else if (tab === 'People') paintPeople(section, current);
  else if (tab === 'Author') paintAuthor(section, current);
  else if (tab === 'Shared') paintShared(section, current);
  else paintNotes(section, current);
}

function paintBook(section: Element, current: GrimoireState): void {
  const prog = progression();
  const sealedShared = current.spells.filter((entry) => entry.source === 'shared' && sealText(spellById(entry.spellId), prog)).length;
  section.innerHTML = `
    <p class="hud-grimoire__kicker">Kept by ${escapeHtml(gameState.displayName || 'you')}</p>
    <h3 class="hud-grimoire__lede">${escapeHtml(current.custom.title)}</h3>
    <p>${escapeHtml(current.custom.dedication.trim() || 'No dedication yet. A grimoire can carry a name, a line to someone you love, and the color of your own ink.')}</p>
    <ul class="hud-grimoire__census">
      <li><strong>${current.spells.length}</strong> workings indexed</li>
      <li><strong>${current.ingredients.length}</strong> ingredients noted</li>
      <li><strong>${current.spirits.length}</strong> spirits met</li>
      <li><strong>${current.npcs.length}</strong> people remembered</li>
      <li><strong>${(current.authored ?? []).length}</strong> pages authored</li>
      <li><strong>${(current.sharedPages ?? []).length}</strong> shared pages kept</li>
    </ul>
    <p>Casting, gathering, meeting a spirit your license can reach, and speaking with someone in town all leave a page. Author lets you write freely and export a manuscript for trade. Right-clicking a manuscript takes that writing into Shared.</p>
    <p>A malevolent spell written here — cast, studied, or shared — gives you a thread of resistance when someone turns that same spell on you. The difference is a single point of focus.</p>
    ${sealedShared ? `<p class="hud-muted">${sealedShared} shared ${sealedShared === 1 ? 'page is' : 'pages are'} still sealed.</p>` : ''}
    <label class="hud-grimoire__field">Title
      <input id="grimoire-title" class="hud-grimoire__input" maxlength="48" value="${escapeHtml(current.custom.title)}" />
    </label>
    <label class="hud-grimoire__field">Dedication
      <textarea id="grimoire-dedication" class="hud-grimoire__margin" maxlength="180">${escapeHtml(current.custom.dedication)}</textarea>
    </label>
    <p class="hud-grimoire__label">Ink</p>
    <div class="hud-grimoire__inks">
      ${(Object.keys(INK_LABELS) as GrimoireInk[]).map((ink) => `<button type="button" class="hud-grimoire__ink${ink === current.custom.ink ? ' is-active' : ''}" data-ink="${ink}"><span class="hud-grimoire__swatch" data-ink="${ink}"></span>${INK_LABELS[ink]}</button>`).join('')}
    </div>
    <label class="hud-grimoire__check"><input id="grimoire-show-shared" type="checkbox"${current.custom.showLockedShared ? ' checked' : ''} /> Show sealed pages that were shared with you</label>
    ${furtherPages()}`;

  const title = section.querySelector('#grimoire-title') as HTMLInputElement | null;
  const dedication = section.querySelector('#grimoire-dedication') as HTMLTextAreaElement | null;
  const sendCustom = (): void => {
    const next = customizeGrimoire(book(), {
      title: title?.value ?? '',
      dedication: dedication?.value ?? '',
      ink: book().custom.ink,
      showLockedShared: book().custom.showLockedShared,
    });
    publish('grimoire_write', { custom: next.custom }, next);
  };
  title?.addEventListener('input', () => debounce('title', sendCustom));
  dedication?.addEventListener('input', () => debounce('dedication', sendCustom));
  section.querySelectorAll('.hud-grimoire__ink').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ink = (btn as HTMLElement).dataset.ink as GrimoireInk;
      const next = customizeGrimoire(book(), { ink });
      publish('grimoire_write', { custom: { ink } }, next);
      const root = section.closest('.hud-grimoire') as HTMLElement | null;
      if (root) root.dataset.ink = ink;
      section.querySelectorAll('.hud-grimoire__ink').forEach((other) => {
        other.classList.toggle('is-active', (other as HTMLElement).dataset.ink === ink);
      });
    });
  });
  section.querySelector('#grimoire-show-shared')?.addEventListener('change', (event) => {
    const showLockedShared = (event.target as HTMLInputElement).checked;
    const next = customizeGrimoire(book(), { showLockedShared });
    publish('grimoire_write', { custom: { showLockedShared } }, next);
  });
}

function paintSpells(section: Element, current: GrimoireState): void {
  const prog = progression();
  const visible = current.spells.filter((entry) => {
    if (current.custom.showLockedShared) return true;
    if (entry.source !== 'shared') return true;
    return !sealText(spellById(entry.spellId), prog);
  });
  const hidden = current.spells.length - visible.length;
  if (!visible.length) {
    section.innerHTML = `
      <h3>Spells</h3>
      <p>Nothing is indexed yet. Cast a working and it will be written here. A friend can also index a page that is still sealed for you. You will see the spell, its nature, and who gave it to you. Casting waits on your own level and license.</p>
      ${hidden ? `<p class="hud-muted">${hidden} sealed shared ${hidden === 1 ? 'page is' : 'pages are'} hidden. The Book can show them again.</p>` : ''}`;
    return;
  }
  if (!visible.some((entry) => entry.spellId === openId.spell)) openId.spell = visible[0].spellId;
  const entry = visible.find((row) => row.spellId === openId.spell) ?? visible[0];
  const spell = spellById(entry.spellId);
  const seal = sealText(spell, prog);
  const name = spell?.name ?? formatContentLabel(entry.spellId);
  const nearby = gameState.nearbyPlayers.filter((person) => person.sessionId && person.sessionId !== gameState.localPlayer?.sessionId);
  const friends = (gameState.friendPresence ?? []).filter((friend) => friend.online);
  const options = [
    ...nearby.map((person) => `<option value="session:${escapeHtml(person.sessionId)}">${escapeHtml(person.displayName)} — beside you</option>`),
    ...friends.map((friend) => `<option value="friend:${escapeHtml(friend.playerId)}">${escapeHtml(friend.displayName)} — friend</option>`),
  ].join('');

  section.innerHTML = `
    <h3>Spells</h3>
    <p class="hud-muted">Indexed pages, including workings you cannot cast yet.${hidden ? ` ${hidden} sealed shared ${hidden === 1 ? 'page is' : 'pages are'} hidden.` : ''}</p>
    <div class="hud-grimoire__index">
      ${visible.map((row) => {
        const known = spellById(row.spellId);
        const rowSeal = sealText(known, prog);
        const label = known?.name ?? formatContentLabel(row.spellId);
        return `<button type="button" class="hud-grimoire__index-btn${row.spellId === entry.spellId ? ' is-active' : ''}" data-spell="${escapeHtml(row.spellId)}">${escapeHtml(label)}${rowSeal ? '<span class="hud-grimoire__seal">Sealed</span>' : ''}</button>`;
      }).join('')}
    </div>
    <article class="hud-grimoire__entry">
      <h4>${escapeHtml(name)}${seal ? '<span class="hud-grimoire__seal">Sealed</span>' : ''}</h4>
      <p class="hud-grimoire__meta">${escapeHtml(spell ? `${formatContentLabel(spell.category)} · ${formatContentLabel(spell.tradition)} · difficulty ${spell.difficulty}` : 'Unlisted working')}</p>
      ${proseBlock('spells', entry.spellId, spell?.description?.trim() || 'No common description is kept for this working. What you write in the margin is the description that matters.')}
      <p>${escapeHtml(sourceLine(entry))}</p>
      ${seal ? `<p class="hud-grimoire__sealed">${escapeHtml(seal)}</p>` : '<p>This working is yours to cast when you have the focus, the tools, and the will.</p>'}
      ${spell && isMalevolentSpell(spell) ? '<p>This is malevolent magic. Because it is written in your book, another practitioner finds it a thread harder to set on you. The difference is microscopic.</p>' : ''}
      ${spell?.ingredients?.length ? `<p class="hud-muted">Common ingredients: ${spell.ingredients.map((item) => escapeHtml(`${item.quantity} ${ingredientById(item.itemId)?.name ?? formatContentLabel(item.itemId)}`)).join(', ')}.</p>` : ''}
      <label class="hud-grimoire__field">Margin note
        <textarea id="grimoire-spell-note" class="hud-grimoire__margin" maxlength="280">${escapeHtml(entry.note ?? '')}</textarea>
      </label>
      <div class="hud-grimoire__share">
        <label>Index this page for someone
          <select id="grimoire-share-target"${options ? '' : ' disabled'}><option value="">Choose</option>${options}</select>
        </label>
        <button type="button" class="hud-btn" id="grimoire-share"${options ? '' : ' disabled'}>Share page</button>
      </div>
      ${options ? '' : '<p class="hud-muted">No one is beside you, and no friend is online.</p>'}
    </article>`;

  section.querySelectorAll('[data-spell]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openId.spell = (btn as HTMLElement).dataset.spell ?? '';
      paint(section, 'Spells');
    });
  });
  const note = section.querySelector('#grimoire-spell-note') as HTMLTextAreaElement | null;
  if (note) {
    let pending = note.value;
    note.addEventListener('input', () => {
      pending = note.value;
      const spellId = entry.spellId;
      debounce(`spell:${spellId}`, () => {
        publish('grimoire_write', { spellNote: { spellId, note: pending } }, setGrimoireSpellNote(book(), spellId, pending));
      });
    });
  }
  section.querySelector('#grimoire-share')?.addEventListener('click', () => {
    const value = (section.querySelector('#grimoire-share-target') as HTMLSelectElement | null)?.value ?? '';
    if (!value) return;
    if (value.startsWith('session:')) network.send('grimoire_share', { spellId: entry.spellId, targetSessionId: value.slice(8) });
    else if (value.startsWith('friend:')) network.send('grimoire_share', { spellId: entry.spellId, friendPlayerId: value.slice(7) });
  });
}

function paintIngredients(section: Element, current: GrimoireState): void {
  if (!current.ingredients.length) {
    section.innerHTML = `
      <h3>Ingredients</h3>
      <p>Buy, gather, craft, or trade for something and its name, nature, and the times it has come to you are written here. Reading a book that names a correspondence does the same.</p>`;
    return;
  }
  if (!current.ingredients.some((row) => row.itemId === openId.item)) openId.item = current.ingredients[0].itemId;
  const entry = current.ingredients.find((row) => row.itemId === openId.item) ?? current.ingredients[0];
  const item = ingredientById(entry.itemId);
  const tags = (item?.correspondences ?? []).map((tag) => formatContentLabel(tag)).join(', ');
  section.innerHTML = `
    <h3>Ingredients</h3>
    <div class="hud-grimoire__index">
      ${current.ingredients.map((row) => {
        const known = ingredientById(row.itemId);
        return `<button type="button" class="hud-grimoire__index-btn${row.itemId === entry.itemId ? ' is-active' : ''}" data-item="${escapeHtml(row.itemId)}">${escapeHtml(known?.name ?? formatContentLabel(row.itemId))}</button>`;
      }).join('')}
    </div>
    <article class="hud-grimoire__entry">
      <h4>${escapeHtml(item?.name ?? formatContentLabel(entry.itemId))}</h4>
      <p class="hud-grimoire__meta">${escapeHtml([item?.category ? formatContentLabel(item.category) : '', item?.rarity ? formatContentLabel(item.rarity) : ''].filter(Boolean).join(' · ') || 'Ingredient')}</p>
      ${proseBlock('items', entry.itemId, item?.description?.trim() || 'You know this ingredient by use. A fuller description has not been copied into the common lists.')}
      ${tags ? `<p>Correspondences: ${escapeHtml(tags)}.</p>` : ''}
      <p>It has come into your hands or your notes ${entry.timesGathered === 1 ? 'once' : `${entry.timesGathered} times`}. First written ${escapeHtml(writtenOn(entry.firstHeldAt) || 'when you acquired it')}.</p>
    </article>`;
  section.querySelectorAll('[data-item]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openId.item = (btn as HTMLElement).dataset.item ?? '';
      paint(section, 'Ingredients');
    });
  });
}

function paintSpirits(section: Element, current: GrimoireState): void {
  const prog = progression();
  const contentSpirits = (gameState.content?.spirits ?? []) as {
    id: string;
    name: string;
    description?: string;
    domains?: string[];
    requiresLicense?: string;
  }[];
  const unmet = contentSpirits.filter(
    (spirit) => !current.spirits.some((met) => met.spiritId === spirit.id) && licenseUnlocksSpirit(spirit.id, prog)
  );
  const selected = current.spirits.find((spirit) => spirit.spiritId === current.selectedSpiritId);
  if (!current.spirits.some((spirit) => spirit.spiritId === openId.spirit) && current.spirits[0]) {
    openId.spirit = current.spirits[0].spiritId;
  }
  const entry = current.spirits.find((spirit) => spirit.spiritId === openId.spirit);
  section.innerHTML = `
    <h3>Spirits</h3>
    <p>Each entry is a kind of spirit you have met. When a calling rite is bound, it will use the name you keep below.</p>
    <label class="hud-grimoire__field">Spirit to call back
      <select id="grimoire-spirit-select"${current.spirits.length ? '' : ' disabled'}>
        ${current.spirits.length ? '' : '<option value="">You have not met a spirit yet</option>'}
        ${current.spirits.map((spirit) => `<option value="${escapeHtml(spirit.spiritId)}"${spirit.spiritId === current.selectedSpiritId ? ' selected' : ''}>${escapeHtml(spirit.name)} — ${escapeHtml(formatContentLabel(spirit.spiritType))}</option>`).join('')}
      </select>
    </label>
    <p>${selected ? `${escapeHtml(selected.name)} is the name your book would call. The calling rite will use it once that rite is bound.` : 'Choose a spirit you have already met. The choice is kept with the book.'}</p>
    ${current.spirits.length ? `<div class="hud-grimoire__index">${current.spirits.map((spirit) => `<button type="button" class="hud-grimoire__index-btn${spirit.spiritId === entry?.spiritId ? ' is-active' : ''}" data-spirit="${escapeHtml(spirit.spiritId)}">${escapeHtml(spirit.name)}</button>`).join('')}</div>` : '<p class="hud-muted">No meetings are written yet.</p>'}
    ${entry ? `
      <article class="hud-grimoire__entry">
        <h4>${escapeHtml(entry.name)}</h4>
        <p class="hud-grimoire__meta">${escapeHtml(entry.domains.length ? entry.domains.map((domain) => formatContentLabel(domain)).join(' · ') : formatContentLabel(entry.spiritType))}</p>
        ${proseBlock('spirits', entry.spiritId, entry.description || 'You met this presence and wrote down the kind of spirit it is. A longer account can live in the margin.')}
        <p>Met ${entry.timesMet === 1 ? 'once' : `${entry.timesMet} times`}. First written ${escapeHtml(writtenOn(entry.metAt) || 'when you petitioned')}.</p>
        <label class="hud-grimoire__field">Margin note
          <textarea id="grimoire-spirit-note" class="hud-grimoire__margin" maxlength="280">${escapeHtml(entry.note ?? '')}</textarea>
        </label>
      </article>` : ''}
    <h4 class="hud-grimoire__sub">Presences your credentials can reach</h4>
    ${unmet.length ? `<ul class="hud-grimoire__list">${unmet.map((spirit) => `<li><strong>${escapeHtml(spirit.name)}</strong> — ${escapeHtml((spirit.domains ?? []).map((domain) => formatContentLabel(domain)).join(', ') || 'spirit')}. ${proseBlock('spirits', spirit.id, spirit.description ?? '')} <button type="button" class="hud-btn" data-petition="${escapeHtml(spirit.id)}">Write the meeting</button></li>`).join('')}</ul>` : '<p class="hud-muted">Every spirit your credentials admit is already written here.</p>'}`;

  section.querySelector('#grimoire-spirit-select')?.addEventListener('change', (event) => {
    const spiritId = (event.target as HTMLSelectElement).value;
    if (!spiritId) return;
    publish('grimoire_recall', { spiritId }, selectGrimoireSpirit(book(), spiritId));
    paint(section, 'Spirits');
  });
  section.querySelectorAll('[data-spirit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openId.spirit = (btn as HTMLElement).dataset.spirit ?? '';
      paint(section, 'Spirits');
    });
  });
  const spiritNote = section.querySelector('#grimoire-spirit-note') as HTMLTextAreaElement | null;
  if (spiritNote && entry) {
    let pending = spiritNote.value;
    const spiritId = entry.spiritId;
    spiritNote.addEventListener('input', () => {
      pending = spiritNote.value;
      debounce(`spirit:${spiritId}`, () => {
        publish(
          'grimoire_write',
          { spiritNote: { spiritId, note: pending } },
          setGrimoireSpiritNote(book(), spiritId, pending)
        );
      });
    });
  }
  section.querySelectorAll('[data-petition]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const spiritId = (btn as HTMLElement).dataset.petition ?? '';
      if (!spiritId) return;
      openId.spirit = spiritId;
      network.send('grimoire_petition', { spiritId });
    });
  });
}

function paintPeople(section: Element, current: GrimoireState): void {
  if (!current.npcs.length) {
    section.innerHTML = `
      <h3>People</h3>
      <p>Speak with someone in town and their name is written here, with the regard between you. Friendship with a player is kept in the Social Circle. This page is for the people who live in the world.</p>`;
    return;
  }
  if (!current.npcs.some((row) => row.npcId === openId.npc)) openId.npc = current.npcs[0].npcId;
  const entry = current.npcs.find((row) => row.npcId === openId.npc) ?? current.npcs[0];
  section.innerHTML = `
    <h3>People</h3>
    <div class="hud-grimoire__index">
      ${current.npcs.map((row) => `<button type="button" class="hud-grimoire__index-btn${row.npcId === entry.npcId ? ' is-active' : ''}" data-npc="${escapeHtml(row.npcId)}">${escapeHtml(row.name)}</button>`).join('')}
    </div>
    <article class="hud-grimoire__entry">
      <h4>${escapeHtml(entry.name)}</h4>
      ${proseBlock('npcs', entry.npcId, '')}
      <p class="hud-grimoire__meta">${entry.stageLabel ? escapeHtml(entry.stageLabel) : `${escapeHtml(grimoireBondLabel(entry.relationship))} · regard ${entry.relationship}`}</p>
      ${entry.stageLabel
        ? `${(entry.regard ?? []).map((line) => `<p>${escapeHtml(line)}</p>`).join('')}${(entry.memories ?? []).map((line) => `<p>${escapeHtml(line)}</p>`).join('')}<p>First written ${escapeHtml(writtenOn(entry.metAt) || 'when you spoke')}.</p>`
        : `<p>${escapeHtml(bondSentence(entry.name, entry.relationship))} First written ${escapeHtml(writtenOn(entry.metAt) || 'when you spoke')}.</p>`}
      <label class="hud-grimoire__field">What you want to remember
        <textarea id="grimoire-npc-note" class="hud-grimoire__margin" maxlength="280">${escapeHtml(entry.note ?? '')}</textarea>
      </label>
    </article>`;
  section.querySelectorAll('[data-npc]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openId.npc = (btn as HTMLElement).dataset.npc ?? '';
      paint(section, 'People');
    });
  });
  const note = section.querySelector('#grimoire-npc-note') as HTMLTextAreaElement | null;
  if (note) {
    let pending = note.value;
    const npcId = entry.npcId;
    note.addEventListener('input', () => {
      pending = note.value;
      debounce(`npc:${npcId}`, () => {
        publish('grimoire_write', { npcNote: { npcId, note: pending } }, setGrimoireNpcNote(book(), npcId, pending));
      });
    });
  }
}

function bondSentence(name: string, relationship: number): string {
  if (relationship >= 80) return `${name} is dear to you. The regard between you is deep.`;
  if (relationship >= 55) return `${name} is trusted. You have kept faith with each other.`;
  if (relationship >= 30) return `${name} is a friend. The tie is warm enough to matter.`;
  if (relationship >= 10) return `${name} is an acquaintance. You know one another's names.`;
  return `${name} is newly met. This page is only a first impression.`;
}

function paintAuthor(section: Element, current: GrimoireState): void {
  const pages = current.authored ?? [];
  const activeId = pages.some((page) => page.id === current.authoredActive)
    ? current.authoredActive!
    : pages[0]?.id ?? '';
  const page = pages.find((row) => row.id === activeId);
  section.innerHTML = `
    <h3>Author</h3>
    <p>Write any page you like. Filtered words are masked when you save. Export binds a copy as a manuscript you can trade for coin. Right-clicking a manuscript takes the writing into Shared.</p>
    <div class="hud-grimoire__index">
      ${pages.map((row) => `<button type="button" class="hud-grimoire__index-btn${row.id === page?.id ? ' is-active' : ''}" data-authored="${escapeHtml(row.id)}">${escapeHtml(row.title)}</button>`).join('') || '<p class="hud-muted">No authored pages yet.</p>'}
      <button type="button" class="hud-btn" id="grimoire-author-new">New page</button>
    </div>
    ${page ? `
      <article class="hud-grimoire__entry">
        <label class="hud-grimoire__field">Title
          <input id="grimoire-author-title" class="hud-grimoire__input" maxlength="80" value="${escapeHtml(page.title)}" />
        </label>
        <div class="hud-grimoire__tools">
          <button type="button" class="hud-btn secondary" data-cmd="bold"><b>B</b></button>
          <button type="button" class="hud-btn secondary" data-cmd="italic"><i>I</i></button>
          <button type="button" class="hud-btn secondary" data-cmd="underline"><u>U</u></button>
        </div>
        <div id="grimoire-author-body" class="hud-grimoire__sheet" contenteditable="true" spellcheck="true">${sanitizeGrimoireMarkup(page.body)}</div>
        <div class="hud-grimoire__share">
          <button type="button" class="hud-btn" id="grimoire-author-save">Save page</button>
          <button type="button" class="hud-btn" id="grimoire-author-export">Export manuscript</button>
          <button type="button" class="hud-btn secondary" id="grimoire-author-delete">Delete</button>
        </div>
      </article>` : '<p class="hud-muted">Start a new page to begin writing.</p>'}`;

  section.querySelectorAll('[data-authored]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.authored ?? '';
      publish('grimoire_write', { authoredActive: id }, setAuthoredGrimoireActive(book(), id));
      paint(section, 'Author');
    });
  });
  section.querySelector('#grimoire-author-new')?.addEventListener('click', () => {
    network.send('grimoire_write', { authoredPage: { title: 'Untitled page', body: '<p>Write freely.</p>' } });
  });
  if (!page) return;
  const sheet = section.querySelector('#grimoire-author-body') as HTMLElement | null;
  section.querySelectorAll('[data-cmd]').forEach((btn) => {
    btn.addEventListener('mousedown', (event) => event.preventDefault());
    btn.addEventListener('click', () => {
      sheet?.focus();
      document.execCommand((btn as HTMLElement).dataset.cmd ?? 'bold', false);
    });
  });
  section.querySelector('#grimoire-author-save')?.addEventListener('click', () => {
    const title = (section.querySelector('#grimoire-author-title') as HTMLInputElement | null)?.value ?? page.title;
    network.send('grimoire_write', {
      authoredPage: { id: page.id, title, body: sheet?.innerHTML ?? page.body },
    });
  });
  section.querySelector('#grimoire-author-export')?.addEventListener('click', () => {
    network.send('grimoire_export', { pageId: page.id });
  });
  section.querySelector('#grimoire-author-delete')?.addEventListener('click', () => {
    if (!window.confirm('Delete this Author page?')) return;
    network.send('grimoire_write', { authoredDeleteId: page.id });
  });
}

function paintShared(section: Element, current: GrimoireState): void {
  const pages = current.sharedPages ?? [];
  const activeId = pages.some((page) => page.id === current.sharedActive)
    ? current.sharedActive!
    : pages[0]?.id ?? '';
  const page = pages.find((row) => row.id === activeId) as GrimoireSharedPage | undefined;
  section.innerHTML = `
    <h3>Shared</h3>
    <p>Pages taken from manuscripts you bought or were given. Right-click a Grimoire Manuscript in your bag to bring its writing here.</p>
    <div class="hud-grimoire__index">
      ${pages.map((row) => `<button type="button" class="hud-grimoire__index-btn${row.id === page?.id ? ' is-active' : ''}" data-shared="${escapeHtml(row.id)}">${escapeHtml(row.title)}</button>`).join('') || '<p class="hud-muted">No shared pages yet.</p>'}
    </div>
    ${page ? `
      <article class="hud-grimoire__entry">
        <h4>${escapeHtml(page.title)}</h4>
        <p class="hud-grimoire__meta">By ${escapeHtml(page.authorName)} · taken ${escapeHtml(writtenOn(page.receivedAt) || 'recently')}</p>
        <div class="hud-grimoire__prose">${sanitizeGrimoireMarkup(page.body)}</div>
        <button type="button" class="hud-btn secondary" id="grimoire-shared-delete">Remove from Shared</button>
      </article>` : ''}`;
  section.querySelectorAll('[data-shared]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.shared ?? '';
      publish('grimoire_write', { sharedActive: id }, setSharedGrimoireActive(book(), id));
      paint(section, 'Shared');
    });
  });
  if (!page) return;
  section.querySelector('#grimoire-shared-delete')?.addEventListener('click', () => {
    if (!window.confirm('Remove this page from Shared?')) return;
    network.send('grimoire_write', { sharedDeleteId: page.id });
  });
}

function paintNotes(section: Element, current: GrimoireState): void {
  const marks = Array.from({ length: GRIMOIRE_NOTE_PAGES }, (_, index) => {
    const label = ['I', 'II', 'III', 'IV', 'V'][index];
    return `<button type="button" class="hud-grimoire__mark${index === current.notesActive ? ' is-active' : ''}" data-note="${index}">${label}</button>`;
  }).join('');
  section.innerHTML = `
    <h3>Notes</h3>
    <p class="hud-muted">Five bookmarks in your own hand. The page is kept with your account, and it saves as you write.</p>
    <div class="hud-grimoire__marks">${marks}</div>
    <textarea id="grimoire-note" class="hud-grimoire__note" maxlength="4000" spellcheck="false">${escapeHtml(current.notes[current.notesActive] ?? '')}</textarea>`;
  const field = section.querySelector('#grimoire-note') as HTMLTextAreaElement | null;
  if (!field) return;
  field.addEventListener('input', () => {
    const active = book().notesActive;
    debounce('notes', () => {
      const notes = book().notes.slice();
      notes[active] = field.value;
      publish('grimoire_write', { notes, notesActive: active }, setGrimoireNotes(book(), notes, active));
    });
  });
  section.querySelectorAll('.hud-grimoire__mark').forEach((btn) => {
    btn.addEventListener('click', () => {
      const notes = book().notes.slice();
      notes[book().notesActive] = field.value;
      const active = Number((btn as HTMLElement).dataset.note) || 0;
      const next = setGrimoireNotes(book(), notes, active);
      publish('grimoire_write', { notes, notesActive: active }, next);
      paint(section, 'Notes');
    });
  });
}
