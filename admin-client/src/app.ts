import { api, getToken, login, setToken, clearToken, getMe } from './api.js';
import { renderSpellList, renderSpellEditor } from './editors/spell-editor.js';
import { renderRecipeManager } from './editors/recipe-editor.js';
import { renderItemList, renderItemEditor } from './editors/item-editor.js';
import { renderNpcList, renderNpcEditor } from './editors/npc-editor.js';
import { renderWardManager, renderEventManager } from './editors/ward-event-manager.js';
import { renderMapBuilder } from './map-builder/index.js';
import { renderHudBuilder } from './hud-builder/index.js';

type Page = 'dashboard' | 'players' | 'spells' | 'recipes' | 'items' | 'npcs' | 'maps' | 'hud' | 'wards' | 'audit' | 'events' | 'spirits';

const NAV: { id: Page; label: string; perm?: string }[] = [
  { id: 'dashboard', label: 'Dashboard', perm: 'dashboard.view' },
  { id: 'players', label: 'Player Manager', perm: 'player.view' },
  { id: 'spells', label: 'Spell Editor', perm: 'content.spell.view' },
  { id: 'recipes', label: 'Recipe Manager', perm: 'content.item.view' },
  { id: 'items', label: 'Item Editor', perm: 'content.item.view' },
  { id: 'npcs', label: 'NPC Builder', perm: 'content.npc.view' },
  { id: 'maps', label: 'Map Builder', perm: 'content.map.view' },
  { id: 'hud', label: 'Player HUD', perm: 'content.hud.view' },
  { id: 'wards', label: 'Ward Manager', perm: 'ward.view' },
  { id: 'spirits', label: 'Spirit Builder', perm: 'content.spirit.edit' },
  { id: 'events', label: 'Event Manager', perm: 'content.event.edit' },
  { id: 'audit', label: 'Audit Log', perm: 'audit.view' },
];

let session: Awaited<ReturnType<typeof getMe>>['session'] | null = null;
let currentPage: Page = 'dashboard';
let editSpellId: string | null = null;
let editItemId: string | null = null;
let editNpcId: string | null = null;

export async function initApp(root: HTMLElement): Promise<void> {
  if (getToken()) {
    try {
      const me = await getMe();
      session = me.session;
      renderShell(root);
      return;
    } catch {
      clearToken();
    }
  }
  renderLogin(root);
}

function renderLogin(root: HTMLElement): void {
  root.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <h1>🌙 Witchcraft Admin</h1>
        <p>Secure administrator dashboard</p>
        <input id="user" placeholder="Username" value="admin" />
        <input id="pass" type="password" placeholder="Password" />
        <button id="login-btn" style="width:100%;margin-top:0.5rem">Sign In</button>
        <div id="login-err" class="error"></div>
      </div>
    </div>`;
  document.getElementById('login-btn')!.onclick = async () => {
    const u = (document.getElementById('user') as HTMLInputElement).value;
    const p = (document.getElementById('pass') as HTMLInputElement).value;
    try {
      const { token, session: s } = await login(u, p);
      setToken(token);
      session = s as typeof session;
      renderShell(root);
    } catch (e) {
      (document.getElementById('login-err')!).textContent = String(e);
    }
  };
}

function renderShell(root: HTMLElement): void {
  const perms = new Set(session?.permissions ?? []);
  const navItems = NAV.filter((n) => !n.perm || perms.has(n.perm));

  root.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="brand">Witchcraft Admin</div>
        <nav id="nav">${navItems.map((n) => `<a href="#" data-page="${n.id}">${n.label}</a>`).join('')}</nav>
      </aside>
      <div class="main">
        <div class="topbar">
          <span id="page-title">Dashboard</span>
          <span>${session?.displayName ?? ''} <button class="btn secondary" id="logout">Logout</button></span>
        </div>
        <div class="content" id="content"></div>
      </div>
    </div>`;

  document.getElementById('logout')!.onclick = () => { clearToken(); location.reload(); };
  document.querySelectorAll('#nav a').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      currentPage = (a as HTMLElement).dataset.page as Page;
      document.querySelectorAll('#nav a').forEach((x) => x.classList.remove('active'));
      a.classList.add('active');
      void loadPage();
    });
  });
  (document.querySelector('#nav a') as HTMLElement)?.classList.add('active');
  void loadPage();
}

async function loadPage(): Promise<void> {
  const el = document.getElementById('content')!;
  const title = NAV.find((n) => n.id === currentPage)?.label ?? '';
  (document.getElementById('page-title')!).textContent = title;

  if (currentPage !== 'spells') editSpellId = null;
  if (currentPage !== 'items') editItemId = null;
  if (currentPage !== 'npcs') editNpcId = null;

  switch (currentPage) {
    case 'dashboard': return renderDashboard(el);
    case 'players': return renderPlayers(el);
    case 'spells':
      if (editSpellId === '__new__' || editSpellId) {
        return renderSpellEditor(el, editSpellId, () => { editSpellId = null; void loadPage(); });
      }
      return renderSpellList(el, (id) => { editSpellId = id; void loadPage(); });
    case 'recipes':
      return renderRecipeManager(el);
    case 'items':
      if (editItemId === '__new__' || editItemId) {
        return renderItemEditor(el, editItemId, () => { editItemId = null; void loadPage(); });
      }
      return renderItemList(el, (id) => { editItemId = id; void loadPage(); });
    case 'npcs':
      if (editNpcId) return renderNpcEditor(el, editNpcId, () => { editNpcId = null; void loadPage(); });
      return renderNpcList(el, (id) => { editNpcId = id; void loadPage(); });
    case 'maps':
      return renderMapBuilder(el, session?.permissions ?? []);
    case 'hud':
      return renderHudBuilder(el, session?.permissions ?? []);
    case 'wards': return renderWardManager(el);
    case 'audit': return renderAudit(el);
    case 'events': return renderEventManager(el);
    case 'spirits': return renderSpirits(el);
  }
}

async function renderDashboard(el: HTMLElement): Promise<void> {
  const stats = await api<Record<string, unknown>>('/dashboard');
  const s = stats as { players: { total: number; online: number }; content: { spells: number; activeWards: number }; server: { uptime: number; memoryMb: number }; activeEvents: number; recentAudit: unknown[] };
  el.innerHTML = `
    <div class="grid">
      <div class="stat"><div class="val">${s.players.online}/${s.players.total}</div><div class="lbl">Players Online</div></div>
      <div class="stat"><div class="val">${s.content.spells}</div><div class="lbl">Spells</div></div>
      <div class="stat"><div class="val">${s.content.activeWards}</div><div class="lbl">Active Wards</div></div>
      <div class="stat"><div class="val">${s.activeEvents}</div><div class="lbl">Live Events</div></div>
      <div class="stat"><div class="val">${Math.round(s.server.uptime)}s</div><div class="lbl">Uptime</div></div>
      <div class="stat"><div class="val">${s.server.memoryMb}MB</div><div class="lbl">Memory</div></div>
    </div>
    <div class="card mt"><h2>Recent Admin Actions</h2>
      <table><thead><tr><th>Action</th><th>Admin</th><th>Time</th></tr></thead>
      <tbody>${(s.recentAudit as { action: string; adminUser: { username: string }; createdAt: string }[]).map((l) =>
        `<tr><td>${l.action}</td><td>${l.adminUser?.username}</td><td>${new Date(l.createdAt).toLocaleString()}</td></tr>`
      ).join('')}</tbody></table>
    </div>`;
}

async function renderPlayers(el: HTMLElement): Promise<void> {
  el.innerHTML = `<div class="flex"><input id="pq" placeholder="Search username..." /><button id="ps">Search</button></div><div id="pl"></div>`;
  const search = async () => {
    const q = (document.getElementById('pq') as HTMLInputElement).value;
    const players = await api<unknown[]>(`/players?q=${encodeURIComponent(q)}`);
    (document.getElementById('pl')!).innerHTML = `
      <table class="mt"><thead><tr><th>Username</th><th>Name</th><th>XP</th><th>Spells</th><th></th></tr></thead>
      <tbody>${(players as { id: string; username: string; displayName: string; stats?: { experience: number }; _count?: { spellHistory: number } }[]).map((p) =>
        `<tr><td><a href="#" class="player-link" data-id="${p.id}" style="color:#fc8">${p.username}</a></td><td>${p.displayName}</td><td>${p.stats?.experience ?? 0}</td><td>${p._count?.spellHistory ?? 0}</td>
        <td><button class="btn secondary" data-id="${p.id}">Manage</button></td></tr>`
      ).join('')}</tbody></table>`;
    document.querySelectorAll('[data-id]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.preventDefault();
        void showPlayer(String((b as HTMLElement).dataset.id));
      });
    });
  };
  document.getElementById('ps')!.onclick = search;
  void search();
}

async function showPlayer(id: string): Promise<void> {
  const p = await api<Record<string, unknown>>(`/players/${id}`);
  const inv =
    (p.inventorySlots as { slotIndex: number; itemId: string; quantity: number }[]) ??
    (p.inventory as { slotIndex?: number; itemId: string; quantity: number }[]) ??
    [];
  const stats = (p.stats as Record<string, number>) ?? {};
  const progression = (p.progression as { discoveredRecipes?: string[]; pocketSpells?: unknown[] }) ?? {};
  const discovered = new Set(progression.discoveredRecipes ?? []);
  const items = await api<{ id: string; name: string }[]>('/content/items').catch(() => [] as { id: string; name: string }[]);
  type AdminRecipe = {
    id: string;
    name: string;
    stationType?: string;
    effect?: string;
    description?: string;
    category?: string;
    recipeKind?: 'craft' | 'hexagram';
    inputs?: { itemId: string; quantity: number }[];
  };
  const recipes = await api<AdminRecipe[]>('/content/recipes').catch(() => [] as AdminRecipe[]);
  const recipeCategory = (r: AdminRecipe): 'recipes' | 'crafts' => {
    if (r.recipeKind === 'hexagram') {
      return r.category === 'pocket_spell' || r.effect === 'pocket_spell' || r.effect === 'enchant_knot'
        ? 'recipes'
        : 'crafts';
    }
    if (r.effect === 'pocket_spell' || r.effect === 'enchant_knot' || r.stationType === 'potion_shelf') {
      return 'recipes';
    }
    return 'crafts';
  };
  const playerLevel = Math.min(10, 1 + Math.floor((stats.experience ?? 0) / 100));
  const statFields = ['health', 'hunger', 'stamina', 'magicalEnergy', 'protection', 'intuition', 'spiritualAwareness', 'ritualSkill', 'experience', 'reputation', 'publicReputation', 'spiritualReputation', 'morality', 'divinationSkill', 'herbalism', 'cursecraft', 'warding', 'healing', 'willpower', 'memory', 'presence', 'authority', 'mediumship', 'potionMaking', 'spiritNegotiation'];
  const el = document.getElementById('content')!;
  el.innerHTML = `
    <button class="btn secondary" id="back">← Back</button>
    <div class="card mt"><h2>${p.displayName} (<span style="color:#fc8">${p.username}</span>)</h2>
      <p style="font-size:11px;color:#888;">Level ${playerLevel} · XP ${stats.experience ?? 0}</p>
      <div class="flex mt" style="gap:8px;flex-wrap:wrap;">
        <button class="btn" id="heal">Heal</button>
        <button class="btn danger" id="ban">Ban</button>
        <button class="btn danger" id="delete-player">Delete from DB</button>
      </div>
      <h3 class="mt">Rename (permanent identity)</h3>
      <div class="flex" style="gap:8px;flex-wrap:wrap;align-items:center;">
        <input id="new-username" placeholder="Username" value="${p.username}" style="padding:6px;background:#221133;color:#fff;border:1px solid #664;" />
        <input id="new-display" placeholder="Display name" value="${p.displayName}" style="padding:6px;background:#221133;color:#fff;border:1px solid #664;" />
        <button class="btn" id="save-profile">Save Names</button>
      </div>
      <h3 class="mt">Stats</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;">
        ${statFields.map((k) =>
          `<label style="font-size:11px;">${k}<input type="number" step="0.5" id="stat-${k}" value="${stats[k] ?? 0}" style="width:100%;padding:4px;background:#221133;color:#fff;border:1px solid #664;" /></label>`
        ).join('')}
      </div>
      <button class="btn mt" id="save-stats">Save Stats</button>
      <h3 class="mt">Recipes / Crafts</h3>
      <div class="flex" style="align-items:center;gap:8px;">
        <select id="recipe-filter" style="padding:6px;background:#221133;color:#fff;border:1px solid #664;">
          <option value="">Select...</option>
          <option value="recipes">Recipes</option>
          <option value="crafts">Crafts</option>
        </select>
      </div>
      <div id="recipe-list" class="mt"></div>
      <h3 class="mt">Inventory</h3>
      <table><thead><tr><th>Item</th><th>Qty</th><th></th></tr></thead>
      <tbody>${inv.map((i) => {
        const name = (items as { id: string; name: string }[]).find((x) => x.id === i.itemId)?.name ?? i.itemId;
        const slotIndex = i.slotIndex ?? 0;
        return `<tr><td>${name}</td><td>${i.quantity}</td><td><button type="button" class="btn danger inv-del" data-slot="${slotIndex}" data-item="${i.itemId}" title="Remove stack">✕</button></td></tr>`;
      }).join('')}</tbody></table>
      <div class="flex mt" style="align-items:center;gap:8px;">
        <select id="give-item" style="flex:1;padding:6px;background:#221133;color:#fff;border:1px solid #664;">
          <option value="">Select item...</option>
          ${(items as { id: string; name: string }[]).map((i) => `<option value="${i.id}">${i.name}</option>`).join('')}
        </select>
        <input id="give-qty" type="number" min="1" max="30" value="1" style="width:60px;padding:6px;background:#221133;color:#fff;border:1px solid #664;" />
        <button class="btn" id="give-btn">Give Item</button>
      </div>
    </div>`;

  const renderRecipeList = (): void => {
    const filter = (document.getElementById('recipe-filter') as HTMLSelectElement).value as '' | 'recipes' | 'crafts';
    const listEl = document.getElementById('recipe-list')!;
    if (!filter) {
      listEl.innerHTML = '';
      return;
    }
    const filtered = recipes.filter((r) => recipeCategory(r) === filter);
    if (!filtered.length) {
      listEl.innerHTML = '<p style="font-size:11px;color:#888;">No entries in this category.</p>';
      return;
    }
    listEl.innerHTML = `
      <table><thead><tr><th>Name</th><th>Station</th><th>Discovered</th><th></th></tr></thead>
      <tbody>${filtered.map((r) => {
        const known = discovered.has(r.id);
        return `<tr>
          <td title="${r.description ?? ''}">${r.name}${r.recipeKind === 'hexagram' ? ' <span style="color:#a8f;font-size:9px;">(hexagram)</span>' : ''}</td>
          <td style="font-size:11px;color:#aaa;">${r.recipeKind === 'hexagram' ? 'enchanting_table' : (r.stationType ?? '—')}</td>
          <td>${known ? '<span style="color:#8f8;">Yes</span>' : '<span style="color:#888;">No</span>'}</td>
          <td><button type="button" class="btn ${known ? 'secondary' : ''} recipe-toggle" data-id="${r.id}" data-known="${known ? '1' : '0'}">${known ? 'Revoke' : 'Grant'}</button></td>
        </tr>`;
      }).join('')}</tbody></table>`;
    listEl.querySelectorAll('.recipe-toggle').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const recipeId = (btn as HTMLElement).dataset.id;
        const known = (btn as HTMLElement).dataset.known === '1';
        if (!recipeId) return;
        try {
          await api(`/players/${id}/recipes/${known ? 'forget' : 'discover'}`, {
            method: 'POST',
            body: JSON.stringify({ recipeId, reason: known ? 'Admin revoke recipe' : 'Admin grant recipe' }),
          });
          void showPlayer(id);
        } catch (e) {
          alert(String(e));
        }
      });
    });
  };

  document.getElementById('recipe-filter')!.onchange = renderRecipeList;
  renderRecipeList();
  document.getElementById('back')!.onclick = () => { currentPage = 'players'; void loadPage(); };
  document.getElementById('heal')!.onclick = async () => {
    await api(`/players/${id}/heal`, { method: 'POST', body: JSON.stringify({ reason: 'Admin heal' }) });
    alert('Healed');
    void showPlayer(id);
  };
  document.getElementById('ban')!.onclick = async () => {
    const reason = prompt('Ban reason?') ?? 'Violation';
    await api(`/players/${id}/moderate`, { method: 'POST', body: JSON.stringify({ type: 'ban', reason }) });
    alert('Banned');
  };
  document.getElementById('delete-player')!.onclick = async () => {
    if (!confirm('Permanently delete this player from the database? They will be logged out.')) return;
    await api(`/players/${id}`, { method: 'DELETE', body: JSON.stringify({ reason: 'Admin delete' }) });
    alert('Player deleted.');
    currentPage = 'players';
    void loadPage();
  };
  document.getElementById('save-profile')!.onclick = async () => {
    const username = (document.getElementById('new-username') as HTMLInputElement).value;
    const displayName = (document.getElementById('new-display') as HTMLInputElement).value;
    try {
      await api(`/players/${id}/profile`, { method: 'PATCH', body: JSON.stringify({ username, displayName, reason: 'Admin rename' }) });
      alert('Profile updated.');
      void showPlayer(id);
    } catch (e) {
      alert(String(e));
    }
  };
  document.getElementById('save-stats')!.onclick = async () => {
    const updates: Record<string, number> = {};
    statFields.forEach((k) => {
      updates[k] = Number((document.getElementById(`stat-${k}`) as HTMLInputElement).value);
    });
    await api(`/players/${id}/stats`, { method: 'PATCH', body: JSON.stringify({ stats: updates, reason: 'Admin edit' }) });
    alert('Stats saved.');
  };
  document.getElementById('give-btn')!.onclick = async () => {
    const itemId = (document.getElementById('give-item') as HTMLSelectElement).value;
    const quantity = Number((document.getElementById('give-qty') as HTMLInputElement).value) || 1;
    if (!itemId) return;
    try {
      await api(`/players/${id}/give`, {
        method: 'POST',
        body: JSON.stringify({ itemId, quantity: Math.min(30, quantity), reason: 'Admin grant' }),
      });
      void showPlayer(id);
    } catch (e) {
      alert(String(e));
    }
  };
  el.querySelectorAll('.inv-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const slotIndex = Number((btn as HTMLElement).dataset.slot);
      const itemId = (btn as HTMLElement).dataset.item;
      if (!Number.isFinite(slotIndex) || !itemId) return;
      try {
        await api(`/players/${id}/inventory/remove`, {
          method: 'POST',
          body: JSON.stringify({ slotIndex, itemId, reason: 'Admin remove' }),
        });
        void showPlayer(id);
      } catch (e) {
        alert(String(e));
      }
    });
  });
}

async function renderAudit(el: HTMLElement): Promise<void> {
  const logs = await api<unknown[]>('/audit');
  el.innerHTML = `<table><thead><tr><th>Action</th><th>Object</th><th>Admin</th><th>Time</th></tr></thead>
    <tbody>${(logs as { action: string; objectType: string; objectId: string; adminUser: { username: string }; createdAt: string }[]).map((l) =>
      `<tr><td>${l.action}</td><td>${l.objectType}:${l.objectId ?? ''}</td><td>${l.adminUser?.username}</td><td>${new Date(l.createdAt).toLocaleString()}</td></tr>`
    ).join('')}</tbody></table>`;
}

async function renderSpirits(el: HTMLElement): Promise<void> {
  const spirits = await api<unknown[]>('/content/spirits');
  el.innerHTML = `<p>Spirit Builder — ancestors, ghosts, demons, thoughtforms</p>
    <pre>${JSON.stringify(spirits, null, 2) || '[]'}</pre>`;
}
