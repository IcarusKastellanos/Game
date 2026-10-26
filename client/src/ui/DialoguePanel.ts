import { meetsDialogueRecognitionGate, type PlayerProgression } from '@witchcraft/shared';
import { gameState } from '../data/game-state';
import { network } from '../net/NetworkManager';
import { escapeHtml, ledgerOverlayShell } from './ledger-chrome';

type DialogueChoiceRow = {
  label: string;
  requiresRecognition?: string;
  requiresLicense?: string;
  requiresAnyLicense?: string[];
};

type DialogueNodeRow = {
  id: string;
  text?: string;
  choices: DialogueChoiceRow[];
  requiresRecognition?: string;
  requiresLicense?: string;
  requiresAnyLicense?: string[];
};

type DialogueTreeRow = {
  id: string;
  nodes: DialogueNodeRow[];
};

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
    window.addEventListener('game:dialogue-update', this.onUpdate as EventListener);
  }

  show(npcId: string, dialogueTreeId: string, nodeId = 'start'): void {
    window.clearTimeout(this.closeTimer);
    this.treeId = dialogueTreeId;
    this.nodeId = nodeId;
    this.visible = true;
    this.root.classList.add('is-open');

    const npc = gameState.content?.npcs.find((n) => n.id === npcId);
    const tree = gameState.content?.dialogues?.find((d) => d.id === dialogueTreeId) as DialogueTreeRow | undefined;
    const node = tree?.nodes.find((n) => n.id === nodeId);
    const progression = this.progression();

    this.titleEl.textContent = npc?.name ?? 'A practitioner';
    this.subtitleEl.textContent = npc?.role ?? '';
    const frame = this.root.querySelector('.ledger-frame');
    frame?.setAttribute('aria-label', npc?.name ?? 'Conversation');

    if (node && !meetsDialogueRecognitionGate(node, progression)) {
      this.renderBody(
        `${npc?.name ?? 'They'} has nothing further to offer at your recognition.`,
        ''
      );
      return;
    }

    this.renderBody(node?.text ?? `${npc?.name ?? 'They'} has nothing to say.`, this.choiceHtml(node, progression));
  }

  hide(): void {
    window.clearTimeout(this.closeTimer);
    if (!this.visible) return;
    this.visible = false;
    this.root.classList.remove('is-open');
    this.scroller.innerHTML = '';
    if (gameState.activeUI === 'dialogue') gameState.activeUI = 'none';
  }

  private progression(): PlayerProgression {
    return (gameState.progression ?? {
      earnedLicenses: [],
      recognitionTierId: 'initiate',
    }) as PlayerProgression;
  }

  private renderBody(text: string, choices: string): void {
    this.scroller.innerHTML = `<p class="ledger-lead">${escapeHtml(text)}</p>${choices}`;
    this.scroller.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const choiceIndex = Number(btn.dataset.choice);
        if (!Number.isInteger(choiceIndex)) return;
        network.send('dialogue_choice', {
          dialogueTreeId: this.treeId,
          nodeId: this.nodeId,
          choiceIndex,
        });
      });
    });
  }

  private choiceHtml(node: DialogueNodeRow | undefined, progression: PlayerProgression): string {
    if (!node?.choices.length) {
      return '<p class="ledger-aside dim">There is nothing further to answer.</p>';
    }
    const rows = node.choices.flatMap((choice, originalIndex) => {
      if (!meetsDialogueRecognitionGate(choice, progression)) return [];
      return [
        `<button type="button" class="ledger-choice" data-choice="${originalIndex}"><span class="k">Answer</span>${escapeHtml(choice.label)}</button>`,
      ];
    });
    if (!rows.length) {
      return '<p class="ledger-aside dim">None of the remaining answers are open to you yet.</p>';
    }
    return `<div class="ledger-choices">${rows.join('')}</div>`;
  }

  private onUpdate = (e: CustomEvent<{
    ended: boolean;
    nodeId: string;
    message: string;
    dialogueTreeId: string;
  }>): void => {
    if (!this.visible) return;
    const { ended, nodeId, message, dialogueTreeId } = e.detail;
    if (ended) {
      this.renderBody(message, '');
      window.clearTimeout(this.closeTimer);
      this.closeTimer = window.setTimeout(() => this.hide(), 2000);
      return;
    }
    this.nodeId = nodeId;
    const tree = gameState.content?.dialogues?.find((d) => d.id === dialogueTreeId) as DialogueTreeRow | undefined;
    const node = tree?.nodes.find((n) => n.id === nodeId);
    this.renderBody(message, this.choiceHtml(node, this.progression()));
  };
}
