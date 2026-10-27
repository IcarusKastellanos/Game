import { api } from '../api.js';

interface ManuscriptRow {
  pageId: string;
  title: string;
  body: string;
  authorName: string;
  authorPlayerId?: string;
  exportedAt: number;
  updatedAt: number;
  status: 'active' | 'archived';
  archivedAt?: number;
  itemCopies: number;
  sharedCopies: number;
  authorCopies: number;
}

export async function renderModerator(el: HTMLElement): Promise<void> {
  const [filterData, manuscriptData] = await Promise.all([
    api<{ words: string[] }>('/moderation/chat-filter'),
    api<{ manuscripts: ManuscriptRow[] }>('/moderation/manuscripts?includeArchived=1'),
  ]);
  const words = filterData.words ?? [];
  const manuscripts = manuscriptData.manuscripts ?? [];
  let selectedId = manuscripts.find((row) => row.status === 'active')?.pageId ?? manuscripts[0]?.pageId ?? '';
  let showArchived = false;

  const paint = (): void => {
    const visible = manuscripts.filter((row) => showArchived || row.status === 'active');
    const selected = manuscripts.find((row) => row.pageId === selectedId) ?? visible[0];
    if (selected) selectedId = selected.pageId;

    el.innerHTML = `
      <div class="card">
        <h2>Shared manuscripts</h2>
        <p class="lede">Every exported grimoire page that players trade or take into Shared. Edit rewrites every copy. Archive removes the item and the page from all players.</p>
        <label class="check-row"><input id="ms-show-archived" type="checkbox"${showArchived ? ' checked' : ''} /> Show archived</label>
        <div class="manuscript-admin">
          <div class="manuscript-admin__list">
            <ul>
              ${visible.map((row) => `
                <li>
                  <button type="button" class="ms-pick${row.pageId === selected?.pageId ? ' is-active' : ''}" data-id="${esc(row.pageId)}">
                    <strong>${esc(row.title)}</strong>
                    <span>${esc(row.authorName)} · ${row.itemCopies} item${row.itemCopies === 1 ? '' : 's'} · ${row.sharedCopies} shared</span>
                    ${row.status === 'archived' ? '<i>archived</i>' : ''}
                  </button>
                </li>`).join('') || '<li class="muted">No manuscripts yet. Players export pages from the Author tab.</li>'}
            </ul>
          </div>
          <div class="manuscript-admin__sheet">
            ${selected ? sheet(selected) : '<p class="muted">Choose a manuscript.</p>'}
          </div>
        </div>
      </div>
      <div class="card">
        <h2>Chat filter</h2>
        <p class="lede">Words here are replaced with **** before a message is posted. Matching ignores case and does not catch a word hidden inside a longer word. Author pages use the same list.</p>
        <div class="flex">
          <input id="filter-word" placeholder="Add a word" />
          <button class="btn" id="filter-add" type="button">Add</button>
        </div>
        <ul class="chip-list" id="filter-list">
          ${words.map((word) => `<li><span>${esc(word)}</span><button type="button" class="btn secondary filter-remove" data-word="${esc(word)}">Remove</button></li>`).join('') || '<li class="muted">No filtered words yet.</li>'}
        </ul>
      </div>
      <div class="card">
        <h2>Moderating a player</h2>
        <p class="lede">These are the tools that belong in this section. The filter and manuscript tools above are live. The rest are either already on Player Manager or still to be built.</p>
        <div class="mod-grid">
          <article>
            <h3>Already available</h3>
            <ul>
              <li>Ban, which blocks the next login, from Player Manager or <code>/ban</code>.</li>
              <li>Kick an online player from the in-game admin panel.</li>
              <li>Heal, rename, edit stats, grant items, and delete the account from Player Manager.</li>
              <li>Add XP or a practitioner level from the same player page.</li>
              <li>Edit or archive shared manuscripts everywhere.</li>
            </ul>
          </article>
          <article>
            <h3>Worth adding next</h3>
            <ul>
              <li>Timed mute, separate from a spell silence, with an expiry.</li>
              <li>A warn that the player sees, and a strike count on the account.</li>
              <li>Temporary bans, and a button to lift a ban or mute.</li>
              <li>A staff-only note on the player.</li>
              <li>The player's recent chat, so a report can be checked.</li>
              <li>A report queue, plus where they are standing right now.</li>
            </ul>
          </article>
        </div>
      </div>`;

    document.getElementById('ms-show-archived')?.addEventListener('change', (event) => {
      showArchived = (event.target as HTMLInputElement).checked;
      paint();
    });
    el.querySelectorAll('.ms-pick').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedId = (btn as HTMLElement).dataset.id ?? selectedId;
        paint();
      });
    });
    if (selected) bindSheet(selected);

    const commitFilter = async (next: string[]): Promise<void> => {
      await api('/moderation/chat-filter', { method: 'PUT', body: JSON.stringify({ words: next }) });
      await renderModerator(el);
    };
    document.getElementById('filter-add')!.onclick = async () => {
      const input = document.getElementById('filter-word') as HTMLInputElement;
      const word = input.value.trim().toLowerCase();
      if (!word) return;
      await commitFilter([...words, word]);
    };
    el.querySelectorAll('.filter-remove').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const word = (btn as HTMLElement).dataset.word ?? '';
        await commitFilter(words.filter((entry) => entry !== word));
      });
    });
  };

  const bindSheet = (row: ManuscriptRow): void => {
    document.getElementById('ms-save')?.addEventListener('click', async () => {
      if (row.status === 'archived') return;
      const title = (document.getElementById('ms-title') as HTMLInputElement).value;
      const body = (document.getElementById('ms-body') as HTMLTextAreaElement).value;
      try {
        const saved = await api<{ manuscript: ManuscriptRow }>(
          `/moderation/manuscripts/${encodeURIComponent(row.pageId)}`,
          { method: 'PUT', body: JSON.stringify({ title, body }) }
        );
        const idx = manuscripts.findIndex((entry) => entry.pageId === row.pageId);
        if (idx >= 0) manuscripts[idx] = saved.manuscript;
        else manuscripts.unshift(saved.manuscript);
        selectedId = saved.manuscript.pageId;
        paint();
      } catch (error) {
        window.alert(String(error));
      }
    });
    document.getElementById('ms-archive')?.addEventListener('click', async () => {
      if (row.status === 'archived') return;
      if (
        !window.confirm(
          `Archive "${row.title}"?\n\nThis removes every manuscript item and every Shared/Author copy of that page from all players.`
        )
      ) {
        return;
      }
      try {
        const saved = await api<{ manuscript: ManuscriptRow }>(
          `/moderation/manuscripts/${encodeURIComponent(row.pageId)}`,
          { method: 'DELETE' }
        );
        const idx = manuscripts.findIndex((entry) => entry.pageId === row.pageId);
        if (idx >= 0) manuscripts[idx] = saved.manuscript;
        selectedId = saved.manuscript.pageId;
        showArchived = true;
        paint();
      } catch (error) {
        window.alert(String(error));
      }
    });
  };

  paint();
}

function sheet(row: ManuscriptRow): string {
  const when = new Date(row.updatedAt).toLocaleString();
  return `
    <p class="muted">${esc(row.pageId)}</p>
    <p>By ${esc(row.authorName)} · ${row.itemCopies} bag cop${row.itemCopies === 1 ? 'y' : 'ies'} · ${row.sharedCopies} Shared · ${row.authorCopies} Author · updated ${esc(when)}</p>
    ${row.status === 'archived' ? '<p class="warn-text">Archived. Copies were stripped from every player.</p>' : ''}
    <label>Title
      <input id="ms-title" value="${esc(row.title)}" ${row.status === 'archived' ? 'disabled' : ''} />
    </label>
    <label>Body
      <textarea id="ms-body" rows="12" ${row.status === 'archived' ? 'disabled' : ''}>${esc(row.body)}</textarea>
    </label>
    <div class="flex" style="margin-top:12px">
      <button type="button" class="btn" id="ms-save" ${row.status === 'archived' ? 'disabled' : ''}>Save everywhere</button>
      <button type="button" class="btn secondary" id="ms-archive" ${row.status === 'archived' ? 'disabled' : ''}>Archive / delete everywhere</button>
    </div>`;
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
