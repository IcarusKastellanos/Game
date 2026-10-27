import { isPlayerSilenced, SILENCED_CHAT_MESSAGE, type AuraState } from '@witchcraft/shared';
import { gameState } from '../data/game-state';
import { network } from '../net/NetworkManager';
import { bindDomInput, shouldBlockGameHotkeys } from './input-focus';
import {
  loadChatPrefs,
  publishChatLayout,
  saveChatPrefs,
  type ChatPreferences,
} from './chat-prefs';

/** Guard for Phaser hotkeys — skip when typing in any DOM field */
export function guardGameHotkey(fn: () => void): () => void {
  return () => {
    if (shouldBlockGameHotkeys()) return;
    fn();
  };
}

export type ChatChannel = 'global' | 'local' | 'whisper' | 'system';

/** Global / local / whisper chat — tied to server chat-service */
export class ChatPanel {
  private root!: HTMLDivElement;
  private logEl!: HTMLDivElement;
  private inputEl!: HTMLInputElement;
  private shellEl!: HTMLDivElement;
  private expanded = true;
  private unread = 0;
  private prefs: ChatPreferences = loadChatPrefs();
  private iconBtn!: HTMLButtonElement;
  private unreadEl!: HTMLSpanElement;
  private resizing: 'width' | 'height' | null = null;
  private resizeStart = { x: 0, y: 0, width: 0, logHeight: 0 };

  constructor(_scene: Phaser.Scene) {
    this.build();
    window.addEventListener('game:chat', this.onChat as EventListener);
    window.addEventListener('game:focus-chat', this.onFocusChat as EventListener);
    window.addEventListener('resize', () => this.applySize(true));
    window.addEventListener('game:hud-ready', () => this.publishLayoutSoon());
  }

  private build(): void {
    this.root = document.createElement('div');
    this.root.id = 'chat-panel';
    this.root.className = 'chat-panel-root';

    this.shellEl = document.createElement('div');
    this.shellEl.className = 'chat-panel-shell';

    const tabs = document.createElement('div');
    tabs.className = 'chat-panel-tabs';
    tabs.innerHTML = `
      <button type="button" id="chat-tab-local" class="chat-tab active">Local</button>
      <button type="button" id="chat-tab-global" class="chat-tab">Global</button>
      <button type="button" id="chat-collapse" class="chat-collapse" title="Collapse chat" aria-label="Collapse chat">▾</button>`;

    this.logEl = document.createElement('div');
    this.logEl.className = 'chat-panel-log';

    this.shellEl.appendChild(tabs);
    this.shellEl.appendChild(this.logEl);

    this.inputEl = document.createElement('input');
    this.inputEl.type = 'text';
    this.inputEl.className = 'chat-panel-input';
    this.inputEl.placeholder = 'Enter to send · /msg "Name" text · [T] focus';

    const resizeE = document.createElement('div');
    resizeE.className = 'chat-panel-resize chat-panel-resize--e';
    resizeE.title = 'Drag to resize chat width';
    const resizeN = document.createElement('div');
    resizeN.className = 'chat-panel-resize chat-panel-resize--n';
    resizeN.title = 'Drag to resize chat height';

    this.iconBtn = document.createElement('button');
    this.iconBtn.type = 'button';
    this.iconBtn.className = 'chat-panel-icon';
    this.iconBtn.title = 'Open chat';
    this.iconBtn.setAttribute('aria-label', 'Open chat');
    this.iconBtn.innerHTML = `
      <svg class="chat-panel-icon__glyph" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/>
      </svg>`;
    this.unreadEl = document.createElement('span');
    this.unreadEl.className = 'chat-panel-icon__count';
    this.unreadEl.hidden = true;
    this.iconBtn.appendChild(this.unreadEl);
    this.iconBtn.addEventListener('click', () => this.toggleExpanded(true));

    this.root.appendChild(this.shellEl);
    this.root.appendChild(this.inputEl);
    this.root.appendChild(resizeE);
    this.root.appendChild(resizeN);
    this.root.appendChild(this.iconBtn);
    document.body.appendChild(this.root);

    this.applySize(false);
    this.publishLayoutSoon();

    bindDomInput(this.inputEl);

    this.inputEl.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        this.inputEl.blur();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        this.submit();
      }
    });

    tabs.querySelector('#chat-tab-local')!.addEventListener('click', () => this.setChannel('local'));
    tabs.querySelector('#chat-tab-global')!.addEventListener('click', () => this.setChannel('global'));
    tabs.querySelector('#chat-collapse')!.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleExpanded(false);
    });

    resizeE.addEventListener('pointerdown', (e) => this.beginResize(e, 'width'));
    resizeN.addEventListener('pointerdown', (e) => this.beginResize(e, 'height'));
    window.addEventListener('pointermove', this.onResizeMove);
    window.addEventListener('pointerup', this.endResize);
    window.addEventListener('pointercancel', this.endResize);

    this.setChannel('local');
    this.log('System', 'Chat ready. Local = this room. Global = all players. /msg "Name" message', 'system');
    if (this.prefs.collapsed) this.toggleExpanded(false);
  }

  private beginResize(e: PointerEvent, mode: 'width' | 'height'): void {
    e.preventDefault();
    e.stopPropagation();
    this.resizing = mode;
    this.resizeStart = {
      x: e.clientX,
      y: e.clientY,
      width: this.prefs.width,
      logHeight: this.prefs.logHeight,
    };
    document.body.classList.add(mode === 'width' ? 'is-resizing-chat-x' : 'is-resizing-chat-y');
  }

  private onResizeMove = (e: PointerEvent): void => {
    if (!this.resizing) return;
    if (this.resizing === 'width') {
      const dx = e.clientX - this.resizeStart.x;
      this.prefs.width = Math.round(
        Math.max(280, Math.min(window.innerWidth - 24, this.resizeStart.width + dx))
      );
    } else {
      // Dragging the top edge: moving up increases height.
      const dy = this.resizeStart.y - e.clientY;
      this.prefs.logHeight = Math.round(
        Math.max(80, Math.min(window.innerHeight * 0.5, this.resizeStart.logHeight + dy))
      );
    }
    this.applySize(false);
  };

  private endResize = (): void => {
    if (!this.resizing) return;
    this.resizing = null;
    document.body.classList.remove('is-resizing-chat-x', 'is-resizing-chat-y');
    saveChatPrefs(this.prefs);
    this.publishLayoutSoon();
  };

  private applySize(clampToViewport: boolean): void {
    if (clampToViewport) {
      this.prefs.width = Math.max(280, Math.min(this.prefs.width, window.innerWidth - 24));
      this.prefs.logHeight = Math.max(80, Math.min(this.prefs.logHeight, window.innerHeight * 0.5));
    }
    if (!this.expanded) {
      this.root.style.width = '';
      this.publishLayoutSoon();
      return;
    }
    this.root.style.width = `${this.prefs.width}px`;
    this.shellEl.style.height = `${this.prefs.logHeight}px`;
    this.publishLayoutSoon();
  }

  private publishLayoutSoon(): void {
    requestAnimationFrame(() => {
      if (this.root.isConnected) publishChatLayout(this.root);
    });
  }

  focusInput(prefix = ''): void {
    if (!this.expanded) this.toggleExpanded(true);
    if (prefix) this.inputEl.value = prefix;
    this.inputEl.focus();
  }

  private onFocusChat = (e: CustomEvent<{ prefix?: string }>): void => {
    this.focusInput(e.detail.prefix ?? '');
  };

  toggleExpanded(show?: boolean): void {
    this.expanded = show ?? !this.expanded;
    this.root.classList.toggle('chat-panel-root--collapsed', !this.expanded);
    this.iconBtn.setAttribute('aria-pressed', this.expanded ? 'false' : 'true');
    this.iconBtn.hidden = this.expanded;
    if (this.expanded) {
      this.unread = 0;
      this.updateUnread();
      this.applySize(false);
      this.logEl.scrollTop = this.logEl.scrollHeight;
    } else {
      this.inputEl.blur();
      this.root.style.width = '';
      this.publishLayoutSoon();
    }
    this.prefs.collapsed = !this.expanded;
    saveChatPrefs(this.prefs);
  }

  private updateUnread(): void {
    if (this.unread <= 0) {
      this.unreadEl.hidden = true;
      this.unreadEl.textContent = '';
      return;
    }
    this.unreadEl.hidden = false;
    this.unreadEl.textContent = this.unread > 9 ? '9+' : String(this.unread);
  }

  private setChannel(channel: 'local' | 'global'): void {
    gameState.chatChannel = channel;
    const localBtn = document.getElementById('chat-tab-local');
    const globalBtn = document.getElementById('chat-tab-global');
    localBtn?.classList.toggle('active', channel === 'local');
    globalBtn?.classList.toggle('active', channel === 'global');
    this.inputEl.placeholder =
      channel === 'global'
        ? 'Global chat (Enter) · /msg "Name" text'
        : 'Local chat (Enter) · /msg "Name" text';
  }

  private localAura(): AuraState | null {
    try {
      return JSON.parse(gameState.localPlayer?.auraJson ?? '{}') as AuraState;
    } catch {
      return null;
    }
  }

  private submit(): void {
    const text = this.inputEl.value.trim();
    if (!text) return;

    if (isPlayerSilenced(this.localAura())) {
      this.inputEl.value = '';
      this.log('System', SILENCED_CHAT_MESSAGE, 'system');
      return;
    }

    this.inputEl.value = '';

    if (text.toLowerCase().startsWith('/msg ')) {
      network.send('chat', { message: text, channel: 'local' });
      return;
    }

    network.send('chat', { message: text, channel: gameState.chatChannel });
  }

  private log(from: string, message: string, channel: ChatChannel): void {
    const colors: Record<ChatChannel, string> = {
      global: '#ffcc88',
      local: '#aaffaa',
      whisper: '#aaccff',
      system: '#ff8888',
    };
    const tags: Record<ChatChannel, string> = {
      global: '[G]',
      local: '[L]',
      whisper: '[W]',
      system: '[!]',
    };
    const ch = channel in tags ? channel : 'local';
    const safe = message.replace(/</g, '&lt;');
    const line = document.createElement('div');
    line.style.color = colors[ch];
    line.innerHTML = `<span style="opacity:0.7">${tags[ch]}</span> <b>${from.replace(/</g, '&lt;')}</b>: ${safe}`;
    this.logEl.appendChild(line);
    this.logEl.scrollTop = this.logEl.scrollHeight;
    if (!this.expanded && channel !== 'system') {
      this.unread += 1;
      this.updateUnread();
    }
  }

  private onChat = (
    e: CustomEvent<{
      from: string;
      message: string;
      channel?: string;
    }>
  ): void => {
    const ch = (e.detail.channel ?? 'local') as ChatChannel;
    this.log(e.detail.from, e.detail.message, ch);
  };
}
