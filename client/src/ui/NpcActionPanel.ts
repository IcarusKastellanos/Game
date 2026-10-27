import type { NpcEncounterOffer, NpcEncounterView, NpcInteractionOffer } from '@witchcraft/shared';
import { gameState } from '../data/game-state';
import { network } from '../net/NetworkManager';
import { escapeHtml, ledgerOverlayShell } from './ledger-chrome';

type EncounterDetail = {
  npcId: string;
  name?: string;
  role?: string;
  options?: NpcInteractionOffer[];
  notice?: string;
  encounter?: NpcEncounterView;
};

/** Server-built list of what this NPC will do right now. */
export class NpcActionPanel {
  private root: HTMLDivElement;
  private scroller: HTMLElement;
  private titleEl: HTMLElement;
  private subtitleEl: HTMLElement;
  private visible = false;
  private npcId = '';
  private pendingAction: string | null = null;
  private reconnectHint = false;

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
    this.root.addEventListener('keydown', (event) => {
      if (!this.visible) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        this.hide();
      }
    });
    window.addEventListener('game:connection-lost', this.onConnectionLost);
    window.addEventListener('game:connection-restored', this.onConnectionRestored);
  }

  show(detail: EncounterDetail): void {
    this.npcId = detail.npcId;
    this.visible = true;
    this.pendingAction = null;
    this.root.classList.add('is-open');
    const npc = gameState.content?.npcs.find((entry) => entry.id === detail.npcId);
    const encounter = detail.encounter;
    this.titleEl.textContent = encounter?.name || detail.name || npc?.name || 'A practitioner';
    this.subtitleEl.textContent = encounter?.role || detail.role || npc?.role || '';
    this.root.querySelector('.ledger-frame')?.setAttribute('aria-label', this.titleEl.textContent ?? 'Encounter');
    this.render(detail);
    const first = this.scroller.querySelector<HTMLButtonElement>('button.ledger-choice:not([disabled])');
    first?.focus();
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.pendingAction = null;
    this.root.classList.remove('is-open');
    this.scroller.innerHTML = '';
    if (gameState.activeUI === 'npc_actions') gameState.activeUI = 'none';
  }

  private render(detail: EncounterDetail): void {
    const encounter = detail.encounter;
    const options = (encounter?.options ?? detail.options ?? []) as NpcEncounterOffer[];
    const signals = encounter?.relationship?.signals ?? [];
    const milestones = encounter?.relationship?.milestones ?? [];
    const gift = encounter?.gift;
    const services = encounter?.services;

    const parts: string[] = [];
    if (this.reconnectHint) {
      parts.push(`<p class="ledger-aside" role="status">Connection restored. Choose again if a gesture did not land.</p>`);
    }
    if (detail.notice || encounter?.notice) {
      parts.push(`<p class="ledger-aside">${escapeHtml(detail.notice || encounter?.notice || '')}</p>`);
    }
    if (signals.length) {
      parts.push(
        `<div class="ledger-aside npc-relation" aria-live="polite">${signals
          .map((line) => `<p>${escapeHtml(line)}</p>`)
          .join('')}</div>`
      );
    }
    if (gift?.acceptsGifts) {
      const giftLine = gift.canGive
        ? gift.knownPreferences[0] || 'They will accept a gift.'
        : gift.reason || 'They are not taking gifts right now.';
      parts.push(`<p class="ledger-aside dim">${escapeHtml(giftLine)}</p>`);
    }
    if (services && (services.lessonsAvailable || services.questsOpen || services.rumorsKnown)) {
      const bits: string[] = [];
      if (services.questsOpen) bits.push('quests waiting');
      if (services.lessonsAvailable) bits.push(`${services.lessonsAvailable} lesson${services.lessonsAvailable === 1 ? '' : 's'} open`);
      if (services.rumorsKnown) bits.push(`${services.rumorsKnown} rumor${services.rumorsKnown === 1 ? '' : 's'} known`);
      if (bits.length) parts.push(`<p class="ledger-aside dim">${escapeHtml(bits.join(' · '))}</p>`);
    }
    if (milestones.length) {
      parts.push(
        `<ul class="ledger-aside dim">${milestones.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
      );
    }

    const rows = options
      .map((option) => {
        const available = option.available !== false;
        const busy = this.pendingAction === option.id;
        const disabled = !available || !!this.pendingAction;
        const requirement = !available && option.requirement
          ? `<small>${escapeHtml(option.requirement)}</small>`
          : busy
            ? `<small>Sending…</small>`
            : '';
        const kicker = optionKindLabel(option);
        return `<button type="button" class="ledger-choice" data-action="${escapeHtml(option.id)}"${disabled ? ' disabled' : ''} aria-disabled="${disabled ? 'true' : 'false'}"><span class="k">${escapeHtml(kicker)}</span>${escapeHtml(option.label)}${requirement}</button>`;
      })
      .join('');

    this.scroller.innerHTML = rows
      ? `${parts.join('')}<div class="ledger-choices">${rows}</div>`
      : `${parts.join('')}<p class="ledger-lead">They have nothing for you just now.</p>`;

    this.scroller.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
      button.addEventListener('click', () => this.choose(button));
    });
  }

  private choose(button: HTMLButtonElement): void {
    const actionId = button.dataset.action;
    if (!actionId || !this.visible || !this.npcId || this.pendingAction) return;
    if (button.disabled) return;
    this.pendingAction = actionId;
    button.setAttribute('aria-busy', 'true');
    const small = document.createElement('small');
    small.textContent = 'Sending…';
    button.appendChild(small);
    this.scroller.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((entry) => {
      if (entry !== button) entry.disabled = true;
    });

    if (actionId.startsWith('social:')) {
      const operationId = button.dataset.operation || crypto.randomUUID();
      button.dataset.operation = operationId;
      network.send('npc_social', { npcId: this.npcId, actionId, operationId });
      window.setTimeout(() => {
        if (this.pendingAction === actionId) {
          this.pendingAction = null;
          this.hide();
        }
      }, 400);
      return;
    }
    if (actionId === 'goodbye') {
      network.send('npc_action', { npcId: this.npcId, actionId });
      this.hide();
      return;
    }
    network.send('npc_action', { npcId: this.npcId, actionId });
    // Talk / trade / gift open another UI; keep a short busy lock then clear if still here.
    window.setTimeout(() => {
      if (this.visible && this.pendingAction === actionId && gameState.activeUI === 'npc_actions') {
        this.pendingAction = null;
      }
    }, 800);
  }

  private onConnectionLost = (): void => {
    if (!this.visible) return;
    this.reconnectHint = true;
    this.pendingAction = null;
    const note = this.scroller.querySelector('.ledger-aside');
    if (!note) {
      this.scroller.insertAdjacentHTML(
        'afterbegin',
        `<p class="ledger-aside" role="status">Connection lost. Wait a moment, then try again.</p>`
      );
    }
    this.scroller.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
      button.disabled = true;
    });
  };

  private onConnectionRestored = (): void => {
    if (!this.visible) return;
    this.reconnectHint = true;
    this.pendingAction = null;
    this.scroller.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
      const available = button.getAttribute('aria-disabled') !== 'true' || button.dataset.wasAvailable === '1';
      if (button.dataset.action && !button.querySelector('small')) button.disabled = false;
      void available;
    });
  };
}

function optionKindLabel(option: NpcEncounterOffer): string {
  switch (option.kind) {
    case 'talk':
      return 'Speak';
    case 'trade':
      return 'Trade';
    case 'quests':
      return 'Quest';
    case 'gift':
      return 'Gift';
    case 'favor':
      return 'Favor';
    case 'train':
      return 'Lesson';
    case 'rumors':
      return 'Rumor';
    case 'social':
      return 'Gesture';
    case 'goodbye':
      return 'Leave';
    default:
      return 'Choose';
  }
}
