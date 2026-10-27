import type { InventorySlot, PlayerProgression, PlayerStats, TaglockType } from '@witchcraft/shared';
import {
  publishDialogueChoices,
  resolveDialogueChoice,
  type DialogueActionContext,
  type DialogueChoiceOutcome,
  type DialogueTree,
} from '@witchcraft/shared';
import { contentRegistry } from '../content/registry.js';

export type { DialogueChoice, DialogueNode, DialogueTree, PublishedDialogueChoice } from '@witchcraft/shared';

export interface DialogueResolveContext {
  inventory: InventorySlot[];
  progression?: PlayerProgression;
  stats?: PlayerStats;
  coins?: number;
  actionCtx?: Partial<DialogueActionContext>;
}

/** Dialogue tree loader. Choice publication and resolution live in shared. */
export class DialogueSystem {
  trees = new Map<string, DialogueTree>();

  loadFromJson(trees: DialogueTree[]): void {
    this.trees.clear();
    for (const tree of trees) {
      this.trees.set(tree.id, tree);
    }
  }

  getTree(dialogueTreeId: string): DialogueTree | undefined {
    return this.trees.get(dialogueTreeId);
  }

  publish(
    dialogueTreeId: string,
    nodeId: string,
    progression: PlayerProgression,
    stats?: PlayerStats,
    coins?: number
  ) {
    return publishDialogueChoices(this.trees.get(dialogueTreeId), nodeId, progression, stats, coins);
  }

  resolve(
    dialogueTreeId: string,
    nodeId: string,
    choiceId: string,
    ctx: DialogueResolveContext
  ): DialogueChoiceOutcome {
    return resolveDialogueChoice(this.trees.get(dialogueTreeId), nodeId, choiceId, ctx, ctx.actionCtx);
  }
}

export const dialogueSystem = new DialogueSystem();

/** Map inventory taglock items to taglock types */
export function resolveTaglockFromInventory(
  inventory: InventorySlot[],
  taglockType?: TaglockType
): TaglockType | undefined {
  if (taglockType) return taglockType;

  const mapping: Record<string, TaglockType> = {
    taglock_hair: 'hair',
    taglock_written_name: 'written_name',
    taglock_personal_item: 'personal_item',
  };

  for (const slot of inventory) {
    if (mapping[slot.itemId] && slot.quantity > 0) {
      return mapping[slot.itemId];
    }
  }
  return undefined;
}

/** Re-export for callers that only need content registry dialogues. */
export function getDialogueNpcId(dialogueTreeId: string): string | undefined {
  return contentRegistry.dialogues.get(dialogueTreeId)?.npcId;
}
