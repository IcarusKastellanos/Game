import type { PublishedDialogueChoice } from '@witchcraft/shared';
import { gameState } from '../data/game-state';
import { network } from '../net/NetworkManager';
import { escapeHtml, ledgerOverlayShell } from './ledger-chrome';

/** NPC conversation, drawn as a practitioner-ledger page. */
export class DialoguePanel {
  private root: HTMLDivElement;
  private scroller: HTMLElement;
  private titleEl: HTMLElement;
  private subtitleEl: HTMLElement;
  private visible = false;
  private treeId = '';
  private nodeId = 'start';
  private closeTimer = 0;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'dialogue-panel';
    this.root.className = 'ledger-overlay';
    this.root.innerHTML = ledgerOverlayShell({
      kicker: 'Conversation',
      title: 'A practitioner',
      subtitle: '',
      foot: 'Listen, answer, or close the page. The street will still be there.',
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
    window.addEventListener('game:dialogue-update', this.onUpdate as EventListener);
  }

  show(
    npcId: string,
    dialogueTreeId: string,
    nodeId = 'start',
    text = '',
    choices: PublishedDialogueChoice[] = [],
    notice = ''
  ): void {
    window.clearTimeout(this.closeTimer);
    this.treeId = dialogueTreeId;
    this.nodeId = nodeId;
    this.visible = true;
    this.root.classList.add('is-open');

    const npc = gameState.content?.npcs.find((n) => n.id === npcId);
    this.titleEl.textContent = npc?.name ?? 'A practitioner';
    this.subtitleEl.textContent = npc?.role ?? '';
    const frame = this.root.querySelector('.ledger-frame');
    frame?.setAttribute('aria-label', npc?.name ?? 'Conversation');
    this.renderBody(text || `${npc?.name ?? 'They'} has nothing to say.`, this.choiceHtml(choices), notice);
  }

  hide(): void {
    window.clearTimeout(this.closeTimer);
    if (!this.visible) return;
    this.visible = false;
    this.root.classList.remove('is-open');
    this.scroller.innerHTML = '';
    if (gameState.activeUI === 'dialogue') gameState.activeUI = 'none';
  }

  private renderBody(text: string, choices: string, notice = ''): void {
    const note = notice ? `<p class="ledger-aside">${escapeHtml(notice)}</p>` : '';
    this.scroller.innerHTML = `<p class="ledger-lead">${escapeHtml(text)}</p>${note}${choices}`;
    this.scroller.querySelectorAll<HTMLButtonElement>('[data-choice-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const choiceId = btn.dataset.choiceId;
        if (!choiceId || btn.disabled) return;
        network.send('dialogue_choice', {
          dialogueTreeId: this.treeId,
          nodeId: this.nodeId,
          choiceId,
        });
      });
    });
  }

  private choiceHtml(choices: PublishedDialogueChoice[]): string {
    if (!choices.length) {
      return '<p class="ledger-aside dim">There is nothing further to answer.</p>';
    }
    const rows = choices.map((choice) => {
      const requirement = choice.requirement ? `<small>${escapeHtml(choice.requirement)}</small>` : '';
      return `<button type="button" class="ledger-choice" data-choice-id="${escapeHtml(choice.id)}"${choice.available ? '' : ' disabled'}><span class="k">Answer</span>${escapeHtml(choice.label)}${requirement}</button>`;
    });
    return `<div class="ledger-choices">${rows.join('')}</div>`;
  }

  private onUpdate = (e: CustomEvent<{
    ended: boolean;
    nodeId: string;
    message: string;
    dialogueTreeId: string;
    choices?: PublishedDialogueChoice[];
    notice?: string;
  }>): void => {
    if (!this.visible) return;
    const { ended, nodeId, message, choices, notice } = e.detail;
    if (ended) {
      this.renderBody(message, '', notice ?? '');
      window.clearTimeout(this.closeTimer);
      this.closeTimer = window.setTimeout(() => this.hide(), 2000);
      return;
    }
    this.nodeId = nodeId;
    this.renderBody(message, this.choiceHtml(choices ?? []), notice ?? '');
  };
}
