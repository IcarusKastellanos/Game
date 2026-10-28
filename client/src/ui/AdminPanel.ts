import Phaser from 'phaser';
import { network } from '../net/NetworkManager';
import { gameState } from '../data/game-state';
import { bindDomInput } from './input-focus';

type AdminPlayer = {
  sessionId: string;
  displayName: string;
  username: string;
  scene: string;
  dbPlayerId: string;
  x: number;
  y: number;
  vanished: boolean;
};

/** Full-screen in-game admin GUI — /apanel in chat opens it, ` for the text console */
export class AdminPanel {
  private root!: HTMLElement;
  private playerListEl!: HTMLElement;
  private logEl!: HTMLElement;
  private visible = false;
  private selectedId: string | null = null;
  private players: AdminPlayer[] = [];
  private vanished = false;
  private itemOptions = '';

  constructor(private scene: Phaser.Scene) {
    this.build();
    this.hide();

    window.addEventListener('game:toggle-admin-panel', () => this.toggle());
    window.addEventListener('game:player-loaded', this.onLoaded as EventListener);
    network.room?.onMessage('admin_result', (data: AdminCommandResult) => {
      this.onResult(data);
    });
  }

  bindRoom(): void {
    network.room?.onMessage('admin_result', (data: AdminCommandResult) => {
      this.onResult(data);
    });
  }

  private onLoaded = (e: CustomEvent<{ isAdmin?: boolean }>): void => {
    if (e.detail.isAdmin) this.buildItemOptions();
  };

  private buildItemOptions(): void {
    const items = gameState.content?.ingredients ?? [];
    this.itemOptions = items
      .map((i) => `<option value="${i.id}">${i.name}</option>`)
      .join('');
    const sel = document.getElementById('admin-give-item') as HTMLSelectElement | null;
    if (sel) sel.innerHTML = `<option value="">Item…</option>${this.itemOptions}`;
  }

  private build(): void {
    this.root = document.createElement('div');
    this.root.id = 'admin-panel';
    this.root.innerHTML = `
      <div class="admin-panel-inner">
        <header class="admin-header">
          <h2>🌙 Admin Panel</h2>
          <span class="admin-hint">/apanel closes · \` console</span>
          <button type="button" id="admin-close" class="admin-btn secondary">Close</button>
        </header>
        <div class="admin-body">
          <aside class="admin-players">
            <div class="admin-section-head">
              <span>Online Players</span>
              <button type="button" id="admin-refresh" class="admin-btn secondary">Refresh</button>
            </div>
            <div id="admin-player-list" class="admin-player-list"></div>
          </aside>
          <main class="admin-actions">
            <div id="admin-selected" class="admin-selected muted">Select a player</div>
            <div class="admin-action-grid">
              <button type="button" class="admin-btn" data-action="heal">Heal</button>
              <button type="button" class="admin-btn" data-action="inspect">Inspect</button>
              <button type="button" class="admin-btn" data-action="goto">Go To (Apartment)</button>
              <button type="button" class="admin-btn" data-action="summon">Summon Here</button>
              <button type="button" class="admin-btn danger" data-action="kick">Kick</button>
              <button type="button" class="admin-btn danger" data-action="ban">Ban</button>
            </div>
            <div class="admin-row">
              <label>Give item
                <select id="admin-give-item"><option value="">Item…</option></select>
              </label>
              <input id="admin-give-qty" type="number" min="1" max="30" value="1" />
              <button type="button" id="admin-give-btn" class="admin-btn">Give</button>
            </div>
            <div class="admin-row">
              <label>TP coords <input id="admin-tp-x" type="number" placeholder="x" style="width:60px" />
              <input id="admin-tp-y" type="number" placeholder="y" style="width:60px" /></label>
              <button type="button" id="admin-tp-btn" class="admin-btn secondary">TP Target</button>
            </div>
            <div class="admin-row">
              <label>Stat <input id="admin-stat-name" placeholder="magicalEnergy" /></label>
              <input id="admin-stat-val" type="number" placeholder="value" style="width:80px" />
              <button type="button" id="admin-stat-btn" class="admin-btn secondary">Set Stat</button>
            </div>
            <hr class="admin-divider" />
            <div class="admin-section-head">Self</div>
            <div class="admin-action-grid">
              <button type="button" id="admin-vanish" class="admin-btn">Vanish: OFF</button>
              <button type="button" class="admin-btn" data-action="heal" data-self="1">Heal Self</button>
              <button type="button" class="admin-btn secondary" data-action="reloadcontent">Reload Content</button>
            </div>
            <div class="admin-row">
              <input id="admin-event-slug" placeholder="event slug" />
              <button type="button" id="admin-event-on" class="admin-btn secondary">Event ON</button>
              <button type="button" id="admin-event-off" class="admin-btn secondary">Event OFF</button>
            </div>
          </main>
        </div>
        <footer id="admin-log" class="admin-log"></footer>
      </div>`;
    document.body.appendChild(this.root);

    this.playerListEl = this.root.querySelector('#admin-player-list')!;
    this.logEl = this.root.querySelector('#admin-log')!;

    this.root.querySelector('#admin-close')!.addEventListener('click', () => this.hide());
    this.root.querySelector('#admin-refresh')!.addEventListener('click', () => this.refreshPlayers());
    this.root.querySelector('#admin-vanish')!.addEventListener('click', () => this.sendAction('vanish'));
    this.root.querySelector('#admin-give-btn')!.addEventListener('click', () => this.giveItem());
    this.root.querySelector('#admin-tp-btn')!.addEventListener('click', () => this.tpTarget());
    this.root.querySelector('#admin-stat-btn')!.addEventListener('click', () => this.setStat());
    this.root.querySelector('#admin-event-on')!.addEventListener('click', () => this.toggleEvent(true));
    this.root.querySelector('#admin-event-off')!.addEventListener('click', () => this.toggleEvent(false));

    this.root.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = (btn as HTMLElement).dataset.action!;
        const self = (btn as HTMLElement).dataset.self === '1';
        this.runAction(action, self);
      });
    });

    bindDomInput(this.root.querySelector('#admin-give-item') as HTMLSelectElement);
    bindDomInput(this.root.querySelector('#admin-give-qty') as HTMLInputElement);
    bindDomInput(this.root.querySelector('#admin-tp-x') as HTMLInputElement);
    bindDomInput(this.root.querySelector('#admin-tp-y') as HTMLInputElement);
    bindDomInput(this.root.querySelector('#admin-stat-name') as HTMLInputElement);
    bindDomInput(this.root.querySelector('#admin-stat-val') as HTMLInputElement);
    bindDomInput(this.root.querySelector('#admin-event-slug') as HTMLInputElement);

    this.scene.add.container(0, 0);
  }

  toggle(): void {
    if (!gameState.isAdmin) return;
    this.visible ? this.hide() : this.show();
  }

  show(): void {
    this.visible = true;
    this.root.style.display = 'flex';
    this.log('Admin panel open');
    this.refreshPlayers();
    this.buildItemOptions();
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
  }

  private log(msg: string): void {
    this.logEl.innerHTML += `<div>${msg.replace(/</g, '&lt;')}</div>`;
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  private targetId(self = false): string | undefined {
    if (self) return network.room?.sessionId;
    return this.selectedId ?? undefined;
  }

  private sendAction(action: string, targetSessionId?: string, args: string[] = []): void {
    network.send('admin_action', { action, targetSessionId, args });
  }

  private refreshPlayers(): void {
    this.sendAction('list_players');
  }

  private onResult(data: AdminCommandResult): void {
    if (data.data && (data.data as { players?: AdminPlayer[] }).players) {
      this.players = (data.data as { players: AdminPlayer[] }).players;
      this.renderPlayers();
      return;
    }
    if (data.data && typeof (data.data as { vanished?: boolean }).vanished === 'boolean') {
      this.vanished = !!(data.data as { vanished: boolean }).vanished;
      const btn = this.root.querySelector('#admin-vanish')!;
      btn.textContent = `Vanish: ${this.vanished ? 'ON' : 'OFF'}`;
      btn.classList.toggle('active', this.vanished);
    }
    if (data.success && data.message.startsWith('Online players')) return;
    this.log(data.success ? `[OK] ${data.message}` : `[ERR] ${data.message}`);
    if (data.success && data.data && (data.data as { stats?: unknown }).stats) {
      this.log(JSON.stringify((data.data as { stats: unknown }).stats, null, 2));
    }
  }

  private renderPlayers(): void {
    this.playerListEl.innerHTML = this.players
      .map(
        (p) =>
          `<button type="button" class="admin-player-row${p.sessionId === this.selectedId ? ' selected' : ''}" data-id="${p.sessionId}">
            <strong>${p.displayName}</strong>
            <span>${p.scene}${p.vanished ? ' · 👻' : ''}</span>
            <span class="muted">${p.username}</span>
          </button>`
      )
      .join('') || '<p class="muted">No players online.</p>';

    this.playerListEl.querySelectorAll('.admin-player-row').forEach((row) => {
      row.addEventListener('click', () => {
        this.selectedId = (row as HTMLElement).dataset.id!;
        const p = this.players.find((x) => x.sessionId === this.selectedId);
        (this.root.querySelector('#admin-selected')!).textContent = p
          ? `${p.displayName} (${p.scene}) @ ${p.x},${p.y}`
          : 'Select a player';
        this.renderPlayers();
      });
    });
  }

  private runAction(action: string, self = false): void {
    const tid = this.targetId(self);
    if (!self && !tid && action !== 'reloadcontent') {
      this.log('[ERR] Select a player first.');
      return;
    }
    if (action === 'kick') {
      const reason = prompt('Kick reason?') ?? 'Removed by admin';
      this.sendAction('kick', tid, [reason]);
      return;
    }
    if (action === 'ban') {
      const p = this.players.find((x) => x.sessionId === tid);
      if (!p?.dbPlayerId) return;
      const reason = prompt('Ban reason?') ?? 'Violation';
      this.sendAction('ban', tid, [p.dbPlayerId, reason]);
      return;
    }
    this.sendAction(action, tid);
  }

  private giveItem(): void {
    const itemId = (this.root.querySelector('#admin-give-item') as HTMLSelectElement).value;
    const qty = (this.root.querySelector('#admin-give-qty') as HTMLInputElement).value || '1';
    if (!itemId || !this.selectedId) return;
    this.sendAction('give', this.selectedId, [itemId, qty]);
  }

  private tpTarget(): void {
    const x = (this.root.querySelector('#admin-tp-x') as HTMLInputElement).value;
    const y = (this.root.querySelector('#admin-tp-y') as HTMLInputElement).value;
    if (!this.selectedId || !x || !y) return;
    this.sendAction('tp', this.selectedId, [x, y]);
  }

  private setStat(): void {
    const stat = (this.root.querySelector('#admin-stat-name') as HTMLInputElement).value.trim();
    const val = (this.root.querySelector('#admin-stat-val') as HTMLInputElement).value;
    if (!this.selectedId || !stat) return;
    this.sendAction('setstat', this.selectedId, [stat, val]);
  }

  private toggleEvent(on: boolean): void {
    const slug = (this.root.querySelector('#admin-event-slug') as HTMLInputElement).value.trim();
    if (!slug) return;
    this.sendAction('event', undefined, [slug, on ? 'on' : 'off']);
  }
}

type AdminCommandResult = {
  success: boolean;
  message: string;
  data?: unknown;
};
