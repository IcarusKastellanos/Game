import type { InventorySlot, PlayerProgression, PlayerStats, TaglockType } from '@witchcraft/shared';
import {
  addItemToInventory,
  getLicense,
  getVow,
  holdsActiveLicense,
  issueLicense,
  meetsDialogueRecognitionGate,
  meetsLicenseExamRequirements,
} from '@witchcraft/shared';
import { contentRegistry } from '../content/registry.js';

export interface DialogueChoice {
  label: string;
  next: string;
  relationshipDelta?: number;
  statBoost?: Record<string, number>;
  grantItem?: string;
  /** Minimum recognition tier id (rank) required to select this choice. */
  requiresRecognition?: string;
  /** License id required to select this choice. */
  requiresLicense?: string;
  requiresAnyLicense?: string[];
  /** Coin fee charged when the choice succeeds. */
  chargeCoins?: number;
  /** Vow id recorded when granting a license. */
  acceptVow?: string;
  /** License id granted on success (Magical Council exam). */
  grantLicense?: string;
  /** Holistic exam eligibility check for this license id. */
  requiresExamEligibility?: string;
}

export interface DialogueNode {
  id: string;
  text: string;
  choices: DialogueChoice[];
  requiresRecognition?: string;
  requiresLicense?: string;
  requiresAnyLicense?: string[];
}

export interface DialogueTree {
  id: string;
  npcId: string;
  nodes: DialogueNode[];
}

export interface DialogueResolveContext {
  inventory: InventorySlot[];
  progression?: PlayerProgression;
  stats?: PlayerStats;
  coins?: number;
}

export interface DialogueResolveResult {
  nextNodeId: string;
  ended: boolean;
  message: string;
  inventory?: InventorySlot[];
  statBoost?: Record<string, number>;
  relationshipDelta?: number;
  coinsDelta?: number;
  progression?: PlayerProgression;
  notification?: string;
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

  /** Choices the practitioner may select at this node. */
  availableChoices(
    dialogueTreeId: string,
    nodeId: string,
    progression: PlayerProgression,
    stats?: PlayerStats,
    coins?: number
  ): { choice: DialogueChoice; originalIndex: number }[] {
    const tree = this.trees.get(dialogueTreeId);
    const node = tree?.nodes.find((n) => n.id === nodeId);
    if (!node) return [];
    if (!meetsDialogueRecognitionGate(node, progression)) return [];
    return node.choices
      .map((choice, originalIndex) => ({ choice, originalIndex }))
      .filter(({ choice }) => {
        if (!meetsDialogueRecognitionGate(choice, progression)) return false;
        if (choice.chargeCoins != null && choice.chargeCoins > 0 && (coins ?? 0) < choice.chargeCoins) {
          return false;
        }
        if (choice.requiresExamEligibility) {
          const license = getLicense(choice.requiresExamEligibility);
          if (!license || !stats) return false;
          if (holdsActiveLicense(progression, license.id)) return false;
          return meetsLicenseExamRequirements(license, stats, progression).ok;
        }
        return true;
      });
  }

  resolveChoice(
    dialogueTreeId: string,
    nodeId: string,
    choiceIndex: number,
    inventoryOrCtx: InventorySlot[] | DialogueResolveContext,
    progressionArg?: PlayerProgression
  ): DialogueResolveResult | null {
    const ctx: DialogueResolveContext = Array.isArray(inventoryOrCtx)
      ? { inventory: inventoryOrCtx, progression: progressionArg }
      : inventoryOrCtx;

    const tree = this.trees.get(dialogueTreeId);
    if (!tree) return null;

    const node = tree.nodes.find((n) => n.id === nodeId);
    if (!node) return null;

    const progression = ctx.progression;
    if (progression && !meetsDialogueRecognitionGate(node, progression)) {
      return null;
    }

    const choice = node.choices[choiceIndex];
    if (!choice) return null;

    if (progression && !meetsDialogueRecognitionGate(choice, progression)) {
      return null;
    }

    let nextProgression = progression;
    let coinsDelta = 0;
    let notification: string | undefined;

    if (choice.requiresExamEligibility) {
      const license = getLicense(choice.requiresExamEligibility);
      if (!license || !ctx.stats || !progression) return null;
      if (holdsActiveLicense(progression, license.id)) {
        return null;
      }
      const exam = meetsLicenseExamRequirements(license, ctx.stats, progression);
      if (!exam.ok) {
        return null;
      }
    }

    if (choice.chargeCoins != null && choice.chargeCoins > 0) {
      const coins = ctx.coins ?? 0;
      if (coins < choice.chargeCoins) {
        return null;
      }
      coinsDelta = -choice.chargeCoins;
    }

    if (choice.grantLicense && progression) {
      if (choice.acceptVow) {
        const vow = getVow(choice.acceptVow);
        if (!vow) return null;
      }
      const issued = issueLicense(progression, choice.grantLicense);
      if (!issued) return null;
      nextProgression = issued.progression;
      notification = issued.alreadyHeld
        ? `${issued.license.label} marks restored after re-examination.`
        : `Credential granted: ${issued.license.label}.`
          + (choice.acceptVow && getVow(choice.acceptVow)
            ? ` Vow sealed: “${getVow(choice.acceptVow)!.text}”`
            : '');
    }

    let updatedInv = ctx.inventory;
    if (choice.grantItem) {
      updatedInv = addItemToInventory(ctx.inventory, choice.grantItem, 1);
    }

    const nextNode = tree.nodes.find((n) => n.id === choice.next);
    return {
      nextNodeId: choice.next,
      ended: choice.next === 'end' || !nextNode,
      message: nextNode?.text ?? 'Farewell.',
      inventory: choice.grantItem ? updatedInv : undefined,
      statBoost: choice.statBoost,
      relationshipDelta: choice.relationshipDelta,
      coinsDelta: coinsDelta || undefined,
      progression: nextProgression !== progression ? nextProgression : undefined,
      notification,
    };
  }
}

export const dialogueSystem = new DialogueSystem();

/** Labels the client may render. Indexes stay the server's choice positions. */
export function publicDialogueChoices(
  dialogueTreeId: string,
  nodeId: string,
  progression: PlayerProgression,
  stats?: PlayerStats,
  coins?: number
): { index: number; label: string }[] {
  return dialogueSystem
    .availableChoices(dialogueTreeId, nodeId, progression, stats, coins)
    .map(({ choice, originalIndex }) => ({
      index: originalIndex,
      label: choice.label,
    }));
}

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
