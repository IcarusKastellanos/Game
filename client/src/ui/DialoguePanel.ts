import Phaser from 'phaser';
import { meetsDialogueRecognitionGate, type PlayerProgression } from '@witchcraft/shared';
import { gameState } from '../data/game-state';
import { network } from '../net/NetworkManager';

type DialogueChoiceRow = {
  label: string;
  requiresRecognition?: string;
  requiresLicense?: string;
};

type DialogueNodeRow = {
  id: string;
  text?: string;
  choices: DialogueChoiceRow[];
  requiresRecognition?: string;
  requiresLicense?: string;
};

type DialogueTreeRow = {
  id: string;
  nodes: DialogueNodeRow[];
};

/** NPC dialogue tree renderer */
export class DialoguePanel {
  private container!: Phaser.GameObjects.Container;
  private dynamic: Phaser.GameObjects.GameObject[] = [];
  private npcText!: Phaser.GameObjects.Text;
  private treeId = '';
  private nodeId = 'start';

  constructor(private scene: Phaser.Scene) {
    this.build();
    this.hide();
    window.addEventListener('game:dialogue-update', this.onUpdate as EventListener);
  }

  private build(): void {
    const bg = this.scene.add.rectangle(256, 192, 440, 260, 0x0a1020, 0.95).setStrokeStyle(2, 0x6688aa);
    const title = this.scene.add.text(256, 80, '◆ DIALOGUE ◆', {
      fontSize: '11px', color: '#aaccff', fontFamily: 'monospace',
    }).setOrigin(0.5);

    this.npcText = this.scene.add.text(256, 120, '', {
      fontSize: '8px', color: '#ddeeff', fontFamily: 'monospace',
      wordWrap: { width: 400 }, align: 'center',
    }).setOrigin(0.5);

    const closeBtn = this.scene.add.text(450, 75, '[X]', {
      fontSize: '10px', color: '#ff6666', fontFamily: 'monospace',
    }).setInteractive({ useHandCursor: true }).on('pointerdown', () => this.hide());

    this.container = this.scene.add.container(0, 0, [bg, title, this.npcText, closeBtn]);
    this.container.setDepth(2000).setScrollFactor(0);
  }

  show(npcId: string, dialogueTreeId: string, nodeId = 'start'): void {
    this.treeId = dialogueTreeId;
    this.nodeId = nodeId;
    this.container.setVisible(true);

    const npc = gameState.content?.npcs.find((n) => n.id === npcId);
    const tree = gameState.content?.dialogues?.find((d) => d.id === dialogueTreeId) as DialogueTreeRow | undefined;
    const node = tree?.nodes.find((n) => n.id === nodeId);
    const progression = (gameState.progression ?? { earnedLicenses: [], recognitionTierId: 'initiate' }) as PlayerProgression;

    if (node && !meetsDialogueRecognitionGate(node, progression)) {
      this.npcText.setText(`${npc?.name ?? 'NPC'} has nothing further to offer at your recognition.`);
      this.clearDynamic();
      return;
    }

    this.npcText.setText(node?.text ?? `${npc?.name ?? 'NPC'} has nothing to say.`);
    this.renderChoices(tree, nodeId, progression);
  }

  hide(): void {
    this.container.setVisible(false);
    this.clearDynamic();
  }

  private clearDynamic(): void {
    this.dynamic.forEach((o) => o.destroy());
    this.dynamic = [];
  }

  private renderChoices(
    tree: DialogueTreeRow | undefined,
    nodeId: string,
    progression: PlayerProgression
  ): void {
    this.clearDynamic();
    const node = tree?.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    let y = 180;
    node.choices.forEach((choice, originalIndex) => {
      if (!meetsDialogueRecognitionGate(choice, progression)) return;
      const btn = this.scene.add.text(256, y, choice.label, {
        fontSize: '8px', color: '#bbddff', fontFamily: 'monospace',
        backgroundColor: '#223344', padding: { x: 6, y: 3 },
      }).setOrigin(0.5).setInteractive({ useHandCursor: true })
        .setScrollFactor(0).setDepth(2001)
        .on('pointerdown', () => {
          network.send('dialogue_choice', {
            dialogueTreeId: this.treeId,
            nodeId: this.nodeId,
            choiceIndex: originalIndex,
          });
        });
      this.dynamic.push(btn);
      y += 22;
    });
  }

  private onUpdate = (e: CustomEvent<{
    ended: boolean; nodeId: string; message: string; dialogueTreeId: string;
  }>): void => {
    if (!this.container.visible) return;
    const { ended, nodeId, message, dialogueTreeId } = e.detail;
    if (ended) {
      this.npcText.setText(message);
      this.clearDynamic();
      setTimeout(() => this.hide(), 2000);
      return;
    }
    this.nodeId = nodeId;
    this.npcText.setText(message);
    const tree = gameState.content?.dialogues?.find((d) => d.id === dialogueTreeId) as DialogueTreeRow | undefined;
    const progression = (gameState.progression ?? { earnedLicenses: [], recognitionTierId: 'initiate' }) as PlayerProgression;
    this.renderChoices(tree, nodeId, progression);
  };
}
