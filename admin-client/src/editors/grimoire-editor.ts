import { api } from '../api.js';

interface GrimoireRecord {
  id: string;
  name: string;
  plain: string;
  grimoireEntry: string;
}

interface GrimoireKind {
  kind: string;
  label: string;
  playerNote: string;
  canEdit: boolean;
  records: GrimoireRecord[];
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function renderGrimoireEditor(el: HTMLElement): Promise<void> {
  const data = await api<{ kinds: GrimoireKind[] }>('/content/grimoire-entries');
  const kinds = data.kinds ?? [];
  let kindId = kinds[0]?.kind ?? '';
  let recordId = '';
  let dirty = false;
  let draftHtml = '';

  const paint = (keepSearch = false): void => {
    const live = document.getElementById('grim-sheet');
    if (live && dirty) draftHtml = live.innerHTML;
    const kind = kinds.find((row) => row.kind === kindId) ?? kinds[0];
    const query = (document.getElementById('grim-search') as HTMLInputElement | null)?.value ?? '';
    const needle = query.trim().toLowerCase();
    const records = (kind?.records ?? []).filter((record) => {
      if (!needle) return true;
      return record.name.toLowerCase().includes(needle) || record.id.toLowerCase().includes(needle);
    });
    const record = kind?.records.find((row) => row.id === recordId);
    el.innerHTML = `
      <div class="card">
        <h2>Grimoire pages</h2>
        <p class="muted-text">Write the page a player reads for any spell, item, spirit type, NPC, familiar, recipe, book, or quest. Bold, italic, and underline are kept. Other markup is removed when you save.</p>
        <div class="grimoire-admin__kinds">
          ${kinds.map((row) => `<button type="button" class="btn secondary grim-kind${row.kind === kind?.kind ? ' is-active' : ''}" data-kind="${esc(row.kind)}">${esc(row.label)}</button>`).join('')}
        </div>
      </div>
      <div class="grimoire-admin">
        <div class="card grimoire-admin__list">
          <input id="grim-search" placeholder="Search name or id" value="${esc(query)}" />
          <ul>
            ${records.map((row) => `<li><button type="button" class="grim-record${row.id === record?.id ? ' is-active' : ''}" data-id="${esc(row.id)}"><span>${esc(row.name)}</span>${row.grimoireEntry ? '<i>written</i>' : ''}</button></li>`).join('') || '<li class="muted-text">Nothing matches.</li>'}
          </ul>
        </div>
        <div class="card grimoire-admin__sheet-wrap">
          ${record && kind ? sheet(kind, record) : '<p class="muted-text">Choose a record to edit its grimoire page.</p>'}
        </div>
      </div>`;

    const search = document.getElementById('grim-search') as HTMLInputElement | null;
    search?.addEventListener('input', () => paint(true));
    if (keepSearch && search) {
      search.focus();
      search.setSelectionRange(query.length, query.length);
    }
    el.querySelectorAll('.grim-kind').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!guardDirty()) return;
        kindId = (btn as HTMLElement).dataset.kind ?? kindId;
        recordId = '';
        dirty = false;
        draftHtml = '';
        paint();
      });
    });
    el.querySelectorAll('.grim-record').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = (btn as HTMLElement).dataset.id ?? '';
        if (next === recordId) return;
        if (!guardDirty()) return;
        recordId = next;
        dirty = false;
        draftHtml = '';
        paint();
      });
    });
    bindSheet(kind, record);
  };

  const guardDirty = (): boolean => !dirty || window.confirm('This page has unsaved writing. Leave it?');

  const bindSheet = (kind: GrimoireKind | undefined, record: GrimoireRecord | undefined): void => {
    const sheetEl = document.getElementById('grim-sheet');
    if (!kind || !record || !sheetEl) return;
    sheetEl.innerHTML = dirty ? draftHtml : record.grimoireEntry;
    sheetEl.addEventListener('input', () => {
      dirty = true;
      draftHtml = sheetEl.innerHTML;
    });
    el.querySelectorAll('[data-cmd]').forEach((btn) => {
      btn.addEventListener('mousedown', (event) => event.preventDefault());
      btn.addEventListener('click', () => {
        sheetEl.focus();
        document.execCommand((btn as HTMLElement).dataset.cmd ?? 'bold', false);
        dirty = true;
        draftHtml = sheetEl.innerHTML;
      });
    });
    document.getElementById('grim-save')?.addEventListener('click', async () => {
      if (!kind.canEdit) return;
      try {
        const saved = await api<{ grimoireEntry: string }>(
          `/content/grimoire-entries/${encodeURIComponent(kind.kind)}/${encodeURIComponent(record.id)}`,
          { method: 'PUT', body: JSON.stringify({ grimoireEntry: sheetEl.innerHTML }) }
        );
        record.grimoireEntry = saved.grimoireEntry;
        dirty = false;
        paint();
      } catch (error) {
        window.alert(String(error));
      }
    });
    document.getElementById('grim-clear')?.addEventListener('click', async () => {
      if (!kind.canEdit) return;
      if (!window.confirm('Clear this grimoire page? The plain record will show until you write it again.')) return;
      try {
        const saved = await api<{ grimoireEntry: string }>(
          `/content/grimoire-entries/${encodeURIComponent(kind.kind)}/${encodeURIComponent(record.id)}`,
          { method: 'PUT', body: JSON.stringify({ grimoireEntry: '' }) }
        );
        record.grimoireEntry = saved.grimoireEntry;
        dirty = false;
        paint();
      } catch (error) {
        window.alert(String(error));
      }
    });
  };

  paint();
}

function sheet(kind: GrimoireKind, record: GrimoireRecord): string {
  return `
    <p class="grimoire-admin__kicker">${esc(kind.label)}</p>
    <h2>${esc(record.name)}</h2>
    <p class="muted-text">${esc(record.id)}</p>
    <p>${esc(kind.playerNote)}</p>
    <div class="grimoire-admin__tools">
      <button type="button" class="btn secondary" data-cmd="bold" ${kind.canEdit ? '' : 'disabled'}><b>B</b> Bold</button>
      <button type="button" class="btn secondary" data-cmd="italic" ${kind.canEdit ? '' : 'disabled'}><i>I</i> Italic</button>
      <button type="button" class="btn secondary" data-cmd="underline" ${kind.canEdit ? '' : 'disabled'}><u>U</u> Underline</button>
    </div>
    <div id="grim-sheet" class="grimoire-admin__sheet" contenteditable="${kind.canEdit ? 'true' : 'false'}" spellcheck="true"></div>
    <p class="muted-text">Plain record, used when this page is blank:</p>
    <p class="grimoire-admin__plain">${esc(record.plain || 'No plain description is stored.')}</p>
    <div class="grimoire-admin__actions">
      <button type="button" class="btn" id="grim-save" ${kind.canEdit ? '' : 'disabled'}>Save page</button>
      <button type="button" class="btn secondary" id="grim-clear" ${kind.canEdit ? '' : 'disabled'}>Clear page</button>
    </div>`;
}
