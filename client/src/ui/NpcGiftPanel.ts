import { gameState } from '../data/game-state';
import { network } from '../net/NetworkManager';
import { escapeHtml, ledgerOverlayShell } from './ledger-chrome';

export interface GiftWindowDetail {
  npcId: string;
  name?: string;
  canGive?: boolean;
  reason?: string;
  nextGiftAt?: number;
  reaction?: string;
  knownPreferences?: { line: string }[];
  items?: { slotIndex: number; itemId: string; name: string; quantity: number }[];
}

/** Server-built gift list. Hidden tastes stay off this panel until a gift reveals them. */
export class NpcGiftPanel {
  private root: HTMLDivElement;
  private scroller: HTMLElement;
  private titleEl: HTMLElement;
  private visible = false;
  private npcId = '';
  private pending = new Map<number, string>();

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'npc-gift-panel';
    this.root.className = 'ledger-overlay';
    this.root.innerHTML = ledgerOverlayShell({
      kicker: 'Gift',
      title: 'An offering',
      subtitle: '',
      foot: 'One gift a day. What they love stays theirs to show.',
    });
    document.body.appendChild(this.root);
    this.scroller = this.root.querySelector('.ledger-scroll') as HTMLElement;
    this.titleEl = this.root.querySelector('h1') as HTMLElement;
    this.root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-ledger-close]')) this.hide();
    });
  }

  show(detail: GiftWindowDetail): void {
    this.pending.clear();
    this.npcId = detail.npcId;
    this.visible = true;
    this.root.classList.add('is-open');
    this.titleEl.textContent = detail.name || 'An offering';
    this.root.querySelector('.ledger-frame')?.setAttribute('aria-label', this.titleEl.textContent ?? 'Gift');
    const known = detail.knownPreferences ?? [];
    const items = detail.items ?? [];
    const when = detail.nextGiftAt ? formatGiftTime(detail.nextGiftAt) : '';
    const status = detail.canGive
      ? 'They can receive a gift now.'
      : `${detail.reason || 'They cannot take a gift right now.'}${when ? ` Next gift: ${when}.` : ''}`;
    const tastes = known.length
      ? `<ul class="ledger-choices">${known.map((row) => `<li class="ledger-lead">${escapeHtml(row.line)}</li>`).join('')}</ul>`
      : '<p class="ledger-lead">You have not learned what they hope to receive.</p>';
    const rows = items
      .map((item) => {
        const disabled = detail.canGive ? '' : ' disabled';
        return `<button type="button" class="ledger-choice" data-slot="${item.slotIndex}" data-item="${escapeHtml(item.itemId)}"${disabled}><span class="k">Offer</span>${escapeHtml(item.name)} × ${item.quantity}</button>`;
      })
      .join('');
    this.scroller.innerHTML = `
      ${detail.reaction ? `<p class="ledger-lead">${escapeHtml(detail.reaction)}</p>` : ''}
      <p class="ledger-lead">${escapeHtml(status)}</p>
      <h2 class="ledger-kicker">What you know</h2>
      ${tastes}
      <h2 class="ledger-kicker">What you can offer</h2>
      ${rows ? `<div class="ledger-choices">${rows}</div>` : '<p class="ledger-lead">Nothing you are carrying is something they will take.</p>'}`;
    this.scroller.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach((button) => {
      button.addEventListener('click', () => {
        if (!this.visible || !detail.canGive) return;
        const slotIndex = Number(button.dataset.slot);
        const itemId = button.dataset.item ?? '';
        if (!Number.isInteger(slotIndex) || !itemId) return;
        const operationId = this.pending.get(slotIndex) || crypto.randomUUID();
        this.pending.set(slotIndex, operationId);
        network.send('npc_gift', { npcId: this.npcId, slotIndex, itemId, operationId });
      });
    });
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.pending.clear();
    this.root.classList.remove('is-open');
    this.scroller.innerHTML = '';
    if (gameState.activeUI === 'npc_gift') gameState.activeUI = 'none';
  }
}

function formatGiftTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
