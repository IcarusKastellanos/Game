/** Strip server-only NPC fields before any client-facing content payload. */

import type { ContentNpc } from '../types/index.js';
import type { DialogueChoice, DialogueTree } from '../dialogue/index.js';
import {
  NPC_PORTRAIT_PIXEL_COUNT,
  hashNpcAuthoredSpriteSheet,
  normalizeNpcAuthoredSpriteSheet,
  type NpcAuthoredSpriteSheet,
} from './visual.js';
import { hashIconPixels } from '../icons/icon-hash.js';

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
  | 'spriteSheet'
  | 'capabilities'
  | 'conversationPolicy'
> & {
  /** Public resting place only — not the full authored routine. */
  schedule?: { locationId: string; activity?: string; interaction?: string }[];
  /** Sprite content hash for verify/cache (portrait + authored sheets). */
  spriteHash?: string;
};

export function npcVisualContentHash(npc: {
  id: string;
  spritePixels?: string[];
  spriteSheet?: NpcAuthoredSpriteSheet | null;
}): string {
  const portrait =
    npc.spritePixels?.length === NPC_PORTRAIT_PIXEL_COUNT ? hashIconPixels(npc.spritePixels) : '';
  const sheet = hashNpcAuthoredSpriteSheet(npc.spriteSheet);
  if (!portrait && !sheet) return `gen:${npc.id}`;
  return [portrait || 'gen', sheet ?? '-'].join('|');
}

export function toClientNpc(npc: ContentNpc, opts?: { omitSpritePixels?: boolean }): ClientNpc {
  const schedule = (npc.schedule ?? [])
    .filter((row) => row.interaction !== 'away')
    .slice(0, 6)
    .map((row) => ({
      locationId: row.locationId,
      ...(row.activity ? { activity: row.activity } : {}),
      ...(row.interaction ? { interaction: row.interaction } : {}),
    }));
  const spriteSheet = normalizeNpcAuthoredSpriteSheet(npc.spriteSheet);
  const spriteHash = npcVisualContentHash(npc);
  return {
    id: npc.id,
    name: npc.name,
    role: npc.role,
    locationId: npc.locationId,
    dialogueTreeId: npc.dialogueTreeId,
    ...(npc.shopId ? { shopId: npc.shopId } : {}),
    ...(npc.faction ? { faction: npc.faction } : {}),
    ...(npc.biography ? { biography: npc.biography } : {}),
    ...(!opts?.omitSpritePixels && npc.spritePixels?.length === NPC_PORTRAIT_PIXEL_COUNT
      ? { spritePixels: npc.spritePixels }
      : {}),
    spriteHash,
    ...(npc.visual ? { visual: npc.visual } : {}),
    ...(!opts?.omitSpritePixels && spriteSheet ? { spriteSheet } : {}),
    ...(npc.capabilities?.length ? { capabilities: npc.capabilities } : {}),
    ...(npc.conversationPolicy ? { conversationPolicy: npc.conversationPolicy } : {}),
    ...(schedule.length ? { schedule } : {}),
  };
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
  'requiresTraditionAffinity',
  'requiresSpiritualReputation',
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
