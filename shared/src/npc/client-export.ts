/** Strip server-only NPC fields before any client-facing content payload. */

import type { ContentNpc } from '../types/index.js';
import type { DialogueChoice, DialogueTree } from '../dialogue/index.js';

/**
 * Public NPC shape the game client may cache.
 * Secrets, personality scores, and privileged schedule override control stay server-side.
 * Biography and role are public catalog text; discovery still gates deeper People facts.
 */
export type ClientNpc = Pick<
  ContentNpc,
  | 'id'
  | 'name'
  | 'role'
  | 'locationId'
  | 'dialogueTreeId'
  | 'shopId'
  | 'faction'
  | 'biography'
  | 'spritePixels'
  | 'capabilities'
  | 'conversationPolicy'
> & {
  /** Public resting place only — not the full authored routine. */
  schedule?: { locationId: string; activity?: string; interaction?: string }[];
};

export function toClientNpc(npc: ContentNpc): ClientNpc {
  const schedule = (npc.schedule ?? [])
    .filter((row) => row.interaction !== 'away')
    .slice(0, 6)
    .map((row) => ({
      locationId: row.locationId,
      ...(row.activity ? { activity: row.activity } : {}),
      ...(row.interaction ? { interaction: row.interaction } : {}),
    }));
  return {
    id: npc.id,
    name: npc.name,
    role: npc.role,
    locationId: npc.locationId,
    dialogueTreeId: npc.dialogueTreeId,
    ...(npc.shopId ? { shopId: npc.shopId } : {}),
    ...(npc.faction ? { faction: npc.faction } : {}),
    ...(npc.biography ? { biography: npc.biography } : {}),
    ...(npc.spritePixels?.length === 256 ? { spritePixels: npc.spritePixels } : {}),
    ...(npc.capabilities?.length ? { capabilities: npc.capabilities } : {}),
    ...(npc.conversationPolicy ? { conversationPolicy: npc.conversationPolicy } : {}),
    ...(schedule.length ? { schedule } : {}),
  };
}

export function toClientNpcs(npcs: Iterable<ContentNpc>): ClientNpc[] {
  return [...npcs].map(toClientNpc);
}

/** Fields that must never appear on client NPC exports. */
export const CLIENT_NPC_FORBIDDEN_KEYS = [
  'secrets',
  'personality',
  'scheduleOverride',
  'relationshipLevel',
  'magicalKnowledge',
  'data',
  'revision',
] as const;

/** Choice fields that spoil rewards / private gates when shipped wholesale. */
export const CLIENT_DIALOGUE_CHOICE_FORBIDDEN_KEYS = [
  'grantItem',
  'actions',
  'relationshipDelta',
  'statBoost',
  'socialEvent',
  'requiresBond',
  'requiresRecognition',
] as const;

/**
 * Dialogue trees for client bootstrap — keep structure/text for offline cache,
 * strip reward and private gate payloads (server publishes live choices).
 */
export function toClientDialogue(tree: DialogueTree): DialogueTree {
  return {
    ...tree,
    nodes: tree.nodes.map((node) => ({
      ...node,
      choices: (node.choices ?? []).map((choice) => toClientDialogueChoice(choice)),
    })),
  };
}

export function toClientDialogues(trees: Iterable<DialogueTree>): DialogueTree[] {
  return [...trees].map(toClientDialogue);
}

function toClientDialogueChoice(choice: DialogueChoice): DialogueChoice {
  const next: DialogueChoice = {
    id: choice.id,
    label: choice.label,
    next: choice.next,
  };
  return next;
}
