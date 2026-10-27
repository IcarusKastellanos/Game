import { api } from '../api.js';

export async function renderModerator(el: HTMLElement): Promise<void> {
  const data = await api<{ words: string[] }>('/moderation/chat-filter');
  const words = data.words ?? [];
  el.innerHTML = `
    <div class="card">
      <h2>Chat filter</h2>
      <p class="lede">Words here are replaced with **** before a message is posted. Matching ignores case and does not catch a word hidden inside a longer word.</p>
      <div class="flex">
        <input id="filter-word" placeholder="Add a word" />
        <button class="btn" id="filter-add" type="button">Add</button>
      </div>
      <ul class="chip-list" id="filter-list">
        ${words.map((word) => `<li><span>${escapeHtml(word)}</span><button type="button" class="btn secondary filter-remove" data-word="${escapeHtml(word)}">Remove</button></li>`).join('') || '<li class="muted">No filtered words yet.</li>'}
      </ul>
    </div>
    <div class="card">
      <h2>Moderating a player</h2>
      <p class="lede">These are the tools that belong in this section. The filter above is live. The rest are either already on Player Manager or still to be built.</p>
      <div class="mod-grid">
        <article>
          <h3>Already available</h3>
          <ul>
            <li>Ban, which blocks the next login, from Player Manager or <code>/ban</code>.</li>
            <li>Kick an online player from the in-game admin panel.</li>
            <li>Heal, rename, edit stats, grant items, and delete the account from Player Manager.</li>
            <li>Add XP or a practitioner level from the same player page.</li>
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

  const commit = async (next: string[]): Promise<void> => {
    await api('/moderation/chat-filter', { method: 'PUT', body: JSON.stringify({ words: next }) });
    await renderModerator(el);
  };

  document.getElementById('filter-add')!.onclick = async () => {
    const input = document.getElementById('filter-word') as HTMLInputElement;
    const word = input.value.trim().toLowerCase();
    if (!word) return;
    await commit([...words, word]);
  };
  el.querySelectorAll('.filter-remove').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const word = (btn as HTMLElement).dataset.word ?? '';
      await commit(words.filter((entry) => entry !== word));
    });
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
