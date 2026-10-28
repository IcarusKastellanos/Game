import { api } from '../api.js';

type Summary = {
  sampleSize: number;
  sinceMs: number | null;
  ratePerMinute: number;
  byKind: Record<string, { ok: number; blocked: number }>;
  byNpc: Record<string, { ok: number; blocked: number; kinds: Record<string, number> }>;
  byProvenance: Record<string, number>;
  topBlockedReasons: { reason: string; count: number }[];
};

type EventRow = {
  id: string;
  at: number;
  kind: string;
  npcId: string;
  success: boolean;
  reason?: string;
  provenance: string;
};

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bar(ok: number, blocked: number): string {
  const total = Math.max(ok + blocked, 1);
  const okPct = Math.round((ok / total) * 100);
  const blockedPct = 100 - okPct;
  return `<div class="flex" style="gap:4px;align-items:center">
    <div style="flex:1;background:#2a2a2a;height:10px;border-radius:2px;overflow:hidden;display:flex">
      <div style="width:${okPct}%;background:#5a8" title="ok ${ok}"></div>
      <div style="width:${blockedPct}%;background:#a55" title="blocked ${blocked}"></div>
    </div>
    <span class="muted-text">${ok}/${blocked}</span>
  </div>`;
}

export async function renderNpcInsights(el: HTMLElement): Promise<void> {
  el.innerHTML = `<p class="muted-text">Loading NPC simulation insights…</p>`;
  try {
    const [{ summary }, { events }, npcs] = await Promise.all([
      api<{ summary: Summary }>('/content/npc-events/summary'),
      api<{ events: EventRow[] }>('/content/npc-events?limit=40'),
      api<{ id: string; name: string }[]>('/content/npcs').catch(() => [] as { id: string; name: string }[]),
    ]);
    const names = new Map(npcs.map((npc) => [npc.id, npc.name]));
    const kindRows = Object.entries(summary.byKind)
      .sort((a, b) => b[1].ok + b[1].blocked - (a[1].ok + a[1].blocked))
      .map(
        ([kind, row]) =>
          `<tr><td>${esc(kind)}</td><td>${bar(row.ok, row.blocked)}</td><td>${row.ok + row.blocked}</td></tr>`
      )
      .join('');
    const npcRows = Object.entries(summary.byNpc)
      .sort((a, b) => b[1].ok + b[1].blocked - (a[1].ok + a[1].blocked))
      .slice(0, 12)
      .map(([npcId, row]) => {
        const label = names.get(npcId) ?? npcId;
        return `<tr><td>${esc(label)}</td><td>${bar(row.ok, row.blocked)}</td><td>${row.ok + row.blocked}</td></tr>`;
      })
      .join('');
    const reasonRows = (summary.topBlockedReasons ?? [])
      .map((row) => `<tr><td>${esc(row.reason)}</td><td>${row.count}</td></tr>`)
      .join('');
    const eventRows = events
      .map(
        (row) =>
          `<tr><td>${new Date(row.at).toLocaleString()}</td><td>${esc(row.kind)}</td><td>${esc(names.get(row.npcId) ?? row.npcId)}</td><td>${row.success ? 'ok' : 'blocked'}</td><td>${esc(row.provenance)}</td><td>${esc(row.reason ?? '')}</td></tr>`
      )
      .join('');

    el.innerHTML = `
      <p class="muted-text">Read-only aggregates from the in-memory NPC event ring buffer. Sample size and provenance matter — low samples are not design verdicts. Live affinity and private prefs are never included.</p>
      <div class="grid">
        <div class="stat"><div class="val">${summary.sampleSize}</div><div class="lbl">Sample size</div></div>
        <div class="stat"><div class="val">${summary.ratePerMinute}</div><div class="lbl">Events / min</div></div>
        <div class="stat"><div class="val">${summary.byProvenance.observed ?? 0}</div><div class="lbl">Observed</div></div>
        <div class="stat"><div class="val">${summary.byProvenance.synthetic ?? 0}</div><div class="lbl">Synthetic</div></div>
        <div class="stat"><div class="val">${summary.byProvenance.admin ?? 0}</div><div class="lbl">Admin</div></div>
      </div>
      <div class="card mt"><h2>By event kind</h2>
        <table><thead><tr><th>Kind</th><th>Ok / blocked</th><th>n</th></tr></thead>
        <tbody>${kindRows || '<tr><td colspan="3">No events yet</td></tr>'}</tbody></table>
      </div>
      <div class="card mt"><h2>By NPC</h2>
        <table><thead><tr><th>NPC</th><th>Ok / blocked</th><th>n</th></tr></thead>
        <tbody>${npcRows || '<tr><td colspan="3">No events yet</td></tr>'}</tbody></table>
      </div>
      <div class="card mt"><h2>Top blocked reasons</h2>
        <table><thead><tr><th>Reason</th><th>Count</th></tr></thead>
        <tbody>${reasonRows || '<tr><td colspan="2">None</td></tr>'}</tbody></table>
      </div>
      <div class="card mt"><h2>Recent events</h2>
        <table><thead><tr><th>When</th><th>Kind</th><th>NPC</th><th>Result</th><th>Provenance</th><th>Reason</th></tr></thead>
        <tbody>${eventRows || '<tr><td colspan="6">No events yet</td></tr>'}</tbody></table>
      </div>`;
  } catch (error) {
    el.innerHTML = `<p class="muted-text">Could not load NPC insights: ${esc(String(error))}</p>`;
  }
}
