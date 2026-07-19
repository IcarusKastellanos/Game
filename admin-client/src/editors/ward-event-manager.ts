import { api } from '../api.js';
import { esc, field, textInput, numberInput, textarea, selectInput } from '../helpers/form-html.js';

type WardRow = {
  id: string;
  targetType: string;
  targetId: string;
  spellId?: string | null;
  strength: number;
  duration: number;
  maintenanceCost: number;
  detectionDifficulty: number;
  permanent: boolean;
  active: boolean;
  expiresAt?: string | null;
  creator?: { username: string; displayName: string };
  creatorId?: string;
};

export async function renderWardManager(el: HTMLElement): Promise<void> {
  const load = async () => {
    const activeOnly = (document.getElementById('ward-active') as HTMLSelectElement)?.value ?? 'true';
    const ownerId = (document.getElementById('ward-owner') as HTMLInputElement)?.value.trim() ?? '';
    const qs = new URLSearchParams({ active: activeOnly });
    if (ownerId) qs.set('ownerId', ownerId);
    const wards = await api<WardRow[]>(`/wards?${qs.toString()}`);

    (document.getElementById('ward-table')!).innerHTML = `
      <table><thead><tr>
        <th>Target</th><th>Strength</th><th>Spell</th><th>Creator</th><th>Expires</th><th>Active</th><th></th>
      </tr></thead>
      <tbody>${wards.map((w) =>
        `<tr>
          <td><span class="badge">${esc(w.targetType)}</span> ${esc(w.targetId)}</td>
          <td>${w.strength.toFixed(1)}</td>
          <td>${esc(w.spellId ?? '—')}</td>
          <td>${esc(w.creator?.displayName ?? w.creator?.username ?? w.creatorId ?? '?')}</td>
          <td>${w.permanent ? 'Permanent' : w.expiresAt ? new Date(w.expiresAt).toLocaleString() : '—'}</td>
          <td>${w.active ? '✓' : '—'}</td>
          <td>${w.active ? `<button class="btn danger ward-shatter" data-id="${esc(w.id)}">Shatter</button>` : ''}</td>
        </tr>`
      ).join('') || '<tr><td colspan="7">No wards match filters.</td></tr>'}</tbody></table>`;

    document.querySelectorAll('.ward-shatter').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const wardId = (btn as HTMLElement).dataset.id!;
        if (!confirm(`Shatter ward ${wardId}? This applies in-game ward-break effects.`)) return;
        await api(`/wards/${wardId}`, { method: 'DELETE', body: JSON.stringify({ reason: 'Admin shatter' }) });
        void load();
      });
    });
  };

  el.innerHTML = `
    <div class="card">
      <h2>Ward Manager</h2>
      <p class="muted-text">Shatter applies Shield Breaker-style effects to online players and deactivates the ward in the database.</p>
      <div class="flex" style="gap:8px;align-items:flex-end;">
        ${field('Creator player ID', textInput('ward-owner', ''), 'inline-field')}
        ${field('Status', selectInput('ward-active', [
          { value: 'true', label: 'Active only' },
          { value: 'false', label: 'All wards' },
        ], 'true'), 'inline-field')}
        <button class="btn" id="ward-filter">Apply Filters</button>
      </div>
      <div id="ward-table" class="mt"></div>
    </div>`;

  document.getElementById('ward-filter')!.onclick = () => void load();
  void load();
}

type ContentEvent = {
  id: string;
  name: string;
  slug: string;
  description: string;
  startAt?: string | null;
  endAt?: string | null;
  modifiers: Record<string, unknown>;
  active: boolean;
  updatedAt?: string;
};

let editEventId: string | null = null;

export async function renderEventManager(el: HTMLElement): Promise<void> {
  if (editEventId === '__new__') return renderEventEditor(el, null, () => { editEventId = null; void renderEventManager(el); });
  if (editEventId) return renderEventEditor(el, editEventId, () => { editEventId = null; void renderEventManager(el); });

  const events = await api<ContentEvent[]>('/content/events');
  el.innerHTML = `
    <div class="card">
      <h2>Event Manager</h2>
      <p class="muted-text">Schedule world modifiers like Blood Moon or Solstice. Toggle active to apply in-game via admin commands and future runtime hooks.</p>
      <button class="btn" id="new-event">+ New Event</button>
      <table class="mt"><thead><tr><th>Name</th><th>Slug</th><th>Active</th><th>Window</th><th></th></tr></thead>
      <tbody>${events.map((ev) =>
        `<tr>
          <td><a href="#" class="event-link" data-id="${esc(ev.id)}" style="color:#fc8">${esc(ev.name)}</a></td>
          <td>${esc(ev.slug)}</td>
          <td><button class="btn secondary event-toggle" data-id="${esc(ev.id)}" data-active="${ev.active}">${ev.active ? 'Live' : 'Off'}</button></td>
          <td>${formatWindow(ev)}</td>
          <td>
            <button class="btn secondary event-edit" data-id="${esc(ev.id)}">Edit</button>
            <button class="btn danger secondary event-del" data-id="${esc(ev.id)}">Delete</button>
          </td>
        </tr>`
      ).join('') || '<tr><td colspan="5">No events yet.</td></tr>'}</tbody></table>
    </div>`;

  document.getElementById('new-event')!.onclick = () => { editEventId = '__new__'; void renderEventManager(el); };
  document.querySelectorAll('.event-link, .event-edit').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      editEventId = (a as HTMLElement).dataset.id!;
      void renderEventManager(el);
    });
  });
  document.querySelectorAll('.event-toggle').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = (btn as HTMLElement).dataset.id!;
      const active = (btn as HTMLElement).dataset.active !== 'true';
      await api(`/content/events/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) });
      void renderEventManager(el);
    });
  });
  document.querySelectorAll('.event-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = (btn as HTMLElement).dataset.id!;
      if (!confirm('Delete this event?')) return;
      await api(`/content/events/${id}`, { method: 'DELETE' });
      void renderEventManager(el);
    });
  });
}

async function renderEventEditor(
  el: HTMLElement,
  id: string | null,
  onBack: () => void
): Promise<void> {
  const event = id && id !== '__new__'
    ? await api<ContentEvent>(`/content/events/${id}`)
    : {
        id: `evt_${Date.now().toString(36)}`,
        name: '',
        slug: '',
        description: '',
        startAt: null,
        endAt: null,
        modifiers: {},
        active: false,
      };

  el.innerHTML = `
    <button class="btn secondary" id="back-event">← Back</button>
    <div class="card mt editor-form-wide">
      <h2>${id && id !== '__new__' ? 'Edit Event' : 'New Event'}</h2>
      <div class="form-grid">
        ${field('ID', textInput('ev-id', event.id))}
        ${field('Name', textInput('ev-name', event.name))}
        ${field('Slug', textInput('ev-slug', event.slug))}
        ${field('Start (ISO, optional)', textInput('ev-start', event.startAt ?? ''))}
        ${field('End (ISO, optional)', textInput('ev-end', event.endAt ?? ''))}
        ${field('Active', selectInput('ev-active', [
          { value: 'false', label: 'Off' },
          { value: 'true', label: 'Live' },
        ], event.active ? 'true' : 'false'))}
      </div>
      ${field('Description', textarea('ev-desc', event.description, 3))}
      ${field('Modifiers (JSON)', textarea('ev-mod', JSON.stringify(event.modifiers ?? {}, null, 2), 8))}
      <button class="btn mt" id="save-event">Save Event</button>
    </div>`;

  document.getElementById('back-event')!.onclick = onBack;
  document.getElementById('save-event')!.onclick = async () => {
    try {
      let modifiers: Record<string, unknown> = {};
      try {
        modifiers = JSON.parse((document.getElementById('ev-mod') as HTMLTextAreaElement).value || '{}');
      } catch {
        alert('Modifiers must be valid JSON');
        return;
      }
      const payload = {
        id: (document.getElementById('ev-id') as HTMLInputElement).value.trim(),
        name: (document.getElementById('ev-name') as HTMLInputElement).value.trim(),
        slug: (document.getElementById('ev-slug') as HTMLInputElement).value.trim(),
        description: (document.getElementById('ev-desc') as HTMLTextAreaElement).value,
        startAt: (document.getElementById('ev-start') as HTMLInputElement).value.trim() || null,
        endAt: (document.getElementById('ev-end') as HTMLInputElement).value.trim() || null,
        active: (document.getElementById('ev-active') as HTMLSelectElement).value === 'true',
        modifiers,
      };
      if (!payload.slug) { alert('Slug required'); return; }
      if (id && id !== '__new__') {
        await api(`/content/events/${payload.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await api('/content/events', { method: 'POST', body: JSON.stringify(payload) });
      }
      alert('Saved');
      onBack();
    } catch (e) {
      alert(String(e));
    }
  };
}

function formatWindow(ev: ContentEvent): string {
  if (!ev.startAt && !ev.endAt) return 'Always eligible';
  const start = ev.startAt ? new Date(ev.startAt).toLocaleDateString() : '—';
  const end = ev.endAt ? new Date(ev.endAt).toLocaleDateString() : '—';
  return `${start} → ${end}`;
}
