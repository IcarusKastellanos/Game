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
  | 'visual'
  | 'capabilities'
  | 'conversationPolicy'
> & {
  /** Public resting place only — not the full authored routine. */
  schedule?: { locationId: string; activity?: string; interaction?: string }[];
  /** Sprite content hash for verify/cache (mirrors ingredient icons). */
  spriteHash?: string;
};

export function toClientNpc(npc: ContentNpc, opts?: { omitSpritePixels?: boolean }): ClientNpc {
  const schedule = (npc.schedule ?? [])
    .filter((row) => row.interaction !== 'away')
    .slice(0, 6)
    .map((row) => ({
      locationId: row.locationId,
      ...(row.activity ? { activity: row.activity } : {}),
      ...(row.interaction ? { interaction: row.interaction } : {}),
    }));
  const spriteHash =
    npc.spritePixels?.length === 256
      ? hashSpritePixels(npc.spritePixels)
      : `gen:${npc.id}`;
  return {
    id: npc.id,
    name: npc.name,
    role: npc.role,
    locationId: npc.locationId,
    dialogueTreeId: npc.dialogueTreeId,
    ...(npc.shopId ? { shopId: npc.shopId } : {}),
    ...(npc.faction ? { faction: npc.faction } : {}),
    ...(npc.biography ? { biography: npc.biography } : {}),
    ...(!opts?.omitSpritePixels && npc.spritePixels?.length === 256
      ? { spritePixels: npc.spritePixels }
      : {}),
    spriteHash,
    ...(npc.visual ? { visual: npc.visual } : {}),
    ...(npc.capabilities?.length ? { capabilities: npc.capabilities } : {}),
    ...(npc.conversationPolicy ? { conversationPolicy: npc.conversationPolicy } : {}),
    ...(schedule.length ? { schedule } : {}),
  };
}

function hashSpritePixels(pixels: string[]): string {
  let h = 2166136261;
  for (const px of pixels) {
    for (let i = 0; i < px.length; i++) {
      h ^= px.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return (h >>> 0).toString(36);
}

export function toClientNpcs(npcs: Iterable<ContentNpc>, opts?: { omitSpritePixels?: boolean }): ClientNpc[] {
  return [...npcs].map((npc) => toClientNpc(npc, opts));
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
