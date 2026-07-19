import type { InventorySlot, TaglockType } from '@witchcraft/shared';
import { addItemToInventory } from '@witchcraft/shared';
import { contentRegistry } from '../content/registry.js';

export interface DialogueNode {
  id: string;
  text: string;
  choices: {
    label: string;
    next: string;
    relationshipDelta?: number;
    statBoost?: Record<string, number>;
    grantItem?: string;
  }[];
}

export interface DialogueTree {
  id: string;
  npcId: string;
  nodes: DialogueNode[];
}

/** Dialogue tree loader and choice resolver */
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

  resolveChoice(
    dialogueTreeId: string,
    nodeId: string,
    choiceIndex: number,
    inventory: InventorySlot[]
  ): {
    nextNodeId: string;
    ended: boolean;
    message: string;
    inventory?: InventorySlot[];
    statBoost?: Record<string, number>;
    relationshipDelta?: number;
  } | null {
    const tree = this.trees.get(dialogueTreeId);
    if (!tree) return null;

    const node = tree.nodes.find((n) => n.id === nodeId);
    if (!node) return null;

    const choice = node.choices[choiceIndex];
    if (!choice) return null;

    let updatedInv = inventory;
    if (choice.grantItem) {
      updatedInv = addItemToInventory(inventory, choice.grantItem, 1);
    }

    const nextNode = tree.nodes.find((n) => n.id === choice.next);
    return {
      nextNodeId: choice.next,
      ended: choice.next === 'end' || !nextNode,
      message: nextNode?.text ?? 'Farewell.',
      inventory: choice.grantItem ? updatedInv : undefined,
      statBoost: choice.statBoost,
      relationshipDelta: choice.relationshipDelta,
    };
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
