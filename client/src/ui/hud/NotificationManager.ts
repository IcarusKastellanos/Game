import type { HUDNotification } from './types.js';

export interface ChatLayoutDetail {
  left: number;
  top: number;
  width: number;
  height: number;
  bottom: number;
}

/**
 * Bottom-left parchment notices — pinned above the chat box, matching its width.
 * Mounted on document.body (not hud-root) so HUD scale cannot shrink them.
 */
export class NotificationManager {
  private root!: HTMLDivElement;
  private queue: HUDNotification[] = [];
  private showing: HUDNotification | null = null;
  private timer = 0;
  private layout: ChatLayoutDetail | null = null;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'hud-notifications';
    this.root.id = 'hud-notifications';
    document.body.appendChild(this.root);

    window.addEventListener('game:chat-layout', ((e: CustomEvent<ChatLayoutDetail>) => {
      this.layout = e.detail;
      this.applyLayout();
    }) as EventListener);
    window.addEventListener('resize', () => this.syncFromChat());
    window.addEventListener('game:hud-scale-changed', () => this.syncFromChat());

    // Initial sync once chat exists.
    requestAnimationFrame(() => this.syncFromChat());
    setTimeout(() => this.syncFromChat(), 250);
  }

  push(note: HUDNotification): void {
    this.queue.push(note);
    if (!this.showing) this.showNext();
  }

  showInfo(title: string, body?: string, actionLabel?: string, onAction?: () => void): void {
    this.push({
      id: `n-${Date.now()}`,
      kind: 'info',
      title,
      body,
      actionLabel,
      onAction,
      durationMs: 6000,
    });
  }

  showError(title: string, body?: string): void {
    this.push({ id: `e-${Date.now()}`, kind: 'error', title, body, durationMs: 5000 });
  }

  private syncFromChat(): void {
    const chat = document.getElementById('chat-panel');
    if (!chat) return;
    const rect = chat.getBoundingClientRect();
    this.layout = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      bottom: window.innerHeight - rect.bottom,
    };
    this.applyLayout();
  }

  private applyLayout(): void {
    const L = this.layout;
    if (!L || L.width <= 0) return;
    const gap = 10;
    this.root.style.left = `${Math.round(L.left)}px`;
    this.root.style.width = `${Math.round(L.width)}px`;
    this.root.style.right = 'auto';
    this.root.style.transform = 'none';
    // Sit just above the chat box.
    this.root.style.bottom = `${Math.round(window.innerHeight - L.top + gap)}px`;
  }

  private showNext(): void {
    const next = this.queue.shift();
    if (!next) {
      this.showing = null;
      this.root.innerHTML = '';
      return;
    }
    this.showing = next;
    this.syncFromChat();
    const kindClass = `hud-notification--${next.kind}`;
    this.root.innerHTML = `
      <article class="hud-notification ${kindClass} hud-notification--enter">
        <div class="hud-notification__sigil" aria-hidden="true"></div>
        <div class="hud-notification__body">
          <div class="hud-notification__title">${escapeHtml(next.title)}</div>
          ${next.body ? `<div class="hud-notification__text">${escapeHtml(next.body)}</div>` : ''}
          ${next.actionLabel ? `<div class="hud-notification__action">[${escapeHtml(next.actionHotkey ?? 'Click')}] ${escapeHtml(next.actionLabel)}</div>` : ''}
        </div>
      </article>`;

    const card = this.root.querySelector('.hud-notification') as HTMLElement;
    card?.addEventListener('click', () => {
      next.onAction?.();
      this.dismiss();
    });

    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.dismiss(), next.durationMs ?? 5500);
  }

  dismiss(): void {
    const card = this.root.querySelector('.hud-notification');
    if (card) {
      card.classList.add('hud-notification--exit');
      window.setTimeout(() => this.showNext(), 380);
    } else {
      this.showNext();
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const notificationManager = new NotificationManager();
