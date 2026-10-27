import type { NpcInteractionOffer } from '@witchcraft/shared';
import { gameState } from '../data/game-state';
import { network } from '../net/NetworkManager';
import { escapeHtml, ledgerOverlayShell } from './ledger-chrome';

/** Server-built list of what this NPC will do right now. */
export class NpcActionPanel {
  private root: HTMLDivElement;
  private scroller: HTMLElement;
  private titleEl: HTMLElement;
  private subtitleEl: HTMLElement;
  private visible = false;
  private npcId = '';

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'npc-action-panel';
    this.root.className = 'ledger-overlay';
    this.root.innerHTML = ledgerOverlayShell({
      kicker: 'Encounter',
      title: 'A practitioner',
      subtitle: '',
      foot: 'Choose what you mean to do. The street will still be there.',
    });
    document.body.appendChild(this.root);
    this.scroller = this.root.querySelector('.ledger-scroll') as HTMLElement;
    this.titleEl = this.root.querySelector('h1') as HTMLElement;
    this.subtitleEl = this.root.querySelector('.ledger-type') as HTMLElement;
    this.root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-ledger-close]')) this.hide();
    });
  }

  show(detail: { npcId: string; name?: string; role?: string; options?: NpcInteractionOffer[] }): void {
    this.npcId = detail.npcId;
    this.visible = true;
    this.root.classList.add('is-open');
    const npc = gameState.content?.npcs.find((entry) => entry.id === detail.npcId);
    this.titleEl.textContent = detail.name || npc?.name || 'A practitioner';
    this.subtitleEl.textContent = detail.role || npc?.role || '';
    this.root.querySelector('.ledger-frame')?.setAttribute('aria-label', this.titleEl.textContent ?? 'Encounter');
    const options = detail.options ?? [];
    const rows = options
      .map(
        (option) =>
          `<button type="button" class="ledger-choice" data-action="${escapeHtml(option.id)}"><span class="k">Choose</span>${escapeHtml(option.label)}</button>`
      )
      .join('');
    this.scroller.innerHTML = rows
      ? `<div class="ledger-choices">${rows}</div>`
      : '<p class="ledger-lead">They have nothing for you just now.</p>';
    this.scroller.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const actionId = button.dataset.action;
        if (!actionId || !this.visible || !this.npcId) return;
        network.send('npc_action', { npcId: this.npcId, actionId });
      });
    });
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.root.classList.remove('is-open');
    this.scroller.innerHTML = '';
    if (gameState.activeUI === 'npc_actions') gameState.activeUI = 'none';
  }
}
