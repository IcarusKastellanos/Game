/** Validated dialogue action registry — no arbitrary code from content. */

import type { InventorySlot, PlayerStats } from '../types/index.js';
import type { PlayerProgression } from '../progression/index.js';
import { addItemToInventory } from '../inventory/index.js';
import { applySocialEvent, type SocialMemoryDraft } from '../social/index.js';
import { tryRevealKnowledge, type WorldKnowledgeStore } from '../npc/knowledge.js';
import { purchaseLesson } from '../npc/lessons.js';

export type DialogueActionType =
  | 'set_flag'
  | 'clear_flag'
  | 'start_quest'
  | 'advance_quest'
  | 'grant_item'
  | 'charge_coins'
  | 'unlock_knowledge'
  | 'unlock_lesson'
  | 'social_event'
  | 'record_memory'
  | 'unlock_service'
  | 'end_conversation';

export interface DialogueAction {
  type: DialogueActionType;
  flag?: string;
  questId?: string;
  itemId?: string;
  quantity?: number;
  coins?: number;
  knowledgeId?: string;
  lessonId?: string;
  socialEvent?: string;
  memory?: SocialMemoryDraft;
  serviceId?: string;
}

export interface DialogueActionContext {
  npcId: string;
  playerId?: string;
  progression: PlayerProgression;
  stats: PlayerStats;
  inventory: InventorySlot[];
  coins: number;
  worldKnowledge?: WorldKnowledgeStore;
  now?: number;
  /** Called for quest start/advance — host supplies the quest engine. */
  applyQuest?: (questId: string, kind: 'start' | 'advance') => PlayerProgression;
  /** Record that a service unlock flag was granted. */
  unlockService?: (serviceId: string, progression: PlayerProgression) => PlayerProgression;
}

export interface DialogueActionResult {
  ok: true;
  progression: PlayerProgression;
  stats: PlayerStats;
  inventory: InventorySlot[];
  coins: number;
  worldKnowledge?: WorldKnowledgeStore;
  notifications: string[];
  ended?: boolean;
  /** Quest ids that should start after the whole action batch succeeds. */
  pendingQuests?: { questId: string; kind: 'start' | 'advance' }[];
}

export interface DialogueActionFailure {
  ok: false;
  reason: string;
}

const ACTION_TYPES = new Set<DialogueActionType>([
  'set_flag',
  'clear_flag',
  'start_quest',
  'advance_quest',
  'grant_item',
  'charge_coins',
  'unlock_knowledge',
  'unlock_lesson',
  'social_event',
  'record_memory',
  'unlock_service',
  'end_conversation',
]);

export function parseDialogueActions(raw: unknown): DialogueAction[] {
  if (!Array.isArray(raw)) return [];
  const out: DialogueAction[] = [];
  for (const value of raw) {
    const action = parseAction(value);
    if (action) out.push(action);
  }
  return out;
}

export function validateDialogueAction(
  raw: unknown
): { ok: true; action: DialogueAction } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Action must be an object.' };
  const o = raw as Record<string, unknown>;
  if (!ACTION_TYPES.has(o.type as DialogueActionType)) {
    return { ok: false, error: `Unsupported dialogue action: ${String(o.type)}` };
  }
  const action = parseAction(raw);
  if (!action) return { ok: false, error: 'Invalid dialogue action payload.' };
  return { ok: true, action };
}

/**
 * Apply a batch of actions transactionally: if any step fails, none of the
 * mutations from this call are kept (caller discards the result).
 */
export function applyDialogueActions(
  actions: DialogueAction[],
  ctx: DialogueActionContext
): DialogueActionResult | DialogueActionFailure {
  let progression = ctx.progression;
  let stats = ctx.stats;
  let inventory = ctx.inventory;
  let coins = ctx.coins;
  let worldKnowledge = ctx.worldKnowledge;
  const notifications: string[] = [];
  const pendingQuests: { questId: string; kind: 'start' | 'advance' }[] = [];
  let ended = false;

  for (const action of actions) {
    if (action.type === 'end_conversation') {
      ended = true;
      continue;
    }
    if (action.type === 'set_flag' && action.flag) {
      const flags = new Set(progression.storyFlags ?? []);
      flags.add(action.flag);
      progression = { ...progression, storyFlags: [...flags] };
      continue;
    }
    if (action.type === 'clear_flag' && action.flag) {
      progression = {
        ...progression,
        storyFlags: (progression.storyFlags ?? []).filter((flag) => flag !== action.flag),
      };
      continue;
    }
    if ((action.type === 'start_quest' || action.type === 'advance_quest') && action.questId) {
      pendingQuests.push({
        questId: action.questId,
        kind: action.type === 'start_quest' ? 'start' : 'advance',
      });
      if (ctx.applyQuest) {
        progression = ctx.applyQuest(action.questId, action.type === 'start_quest' ? 'start' : 'advance');
      }
      continue;
    }
    if (action.type === 'grant_item' && action.itemId) {
      inventory = addItemToInventory(inventory, action.itemId, Math.max(1, action.quantity ?? 1));
      continue;
    }
    if (action.type === 'charge_coins') {
      const cost = Math.max(0, action.coins ?? 0);
      if (coins < cost) return { ok: false, reason: `That costs ${cost} coins.` };
      coins -= cost;
      continue;
    }
    if (action.type === 'unlock_knowledge' && action.knowledgeId) {
      const revealed = tryRevealKnowledge({
        knowledgeId: action.knowledgeId,
        npcId: ctx.npcId,
        progression,
        stats,
        worldStore: worldKnowledge,
        now: ctx.now,
        playerId: ctx.playerId,
        source: 'conversation',
      });
      if (!revealed.ok) return { ok: false, reason: revealed.reason };
      progression = revealed.progression;
      if (revealed.worldStore) worldKnowledge = revealed.worldStore;
      if (!revealed.alreadyKnown) notifications.push(revealed.text);
      continue;
    }
    if (action.type === 'unlock_lesson' && action.lessonId) {
      const bought = purchaseLesson({
        lessonId: action.lessonId,
        npcId: ctx.npcId,
        progression,
        stats,
        coins,
        inventory,
        now: ctx.now,
      });
      if (!bought.ok) return { ok: false, reason: bought.reason };
      progression = bought.progression;
      if (bought.stats) stats = bought.stats;
      if (bought.inventory) inventory = bought.inventory;
      if (bought.coinsDelta) coins = Math.max(0, coins + bought.coinsDelta);
      notifications.push(bought.notification);
      continue;
    }
    if (action.type === 'social_event' && action.socialEvent) {
      const applied = applySocialEvent(progression, stats, {
        eventId: action.socialEvent,
        npcId: ctx.npcId,
        now: ctx.now,
      });
      progression = applied.progression;
      stats = applied.stats;
      if (applied.feedback) notifications.push(applied.feedback);
      continue;
    }
    if (action.type === 'record_memory' && action.memory) {
      const applied = applySocialEvent(progression, stats, {
        eventId: '__dialogue_memory__',
        npcId: ctx.npcId,
        now: ctx.now,
      });
      // Direct memory write via a synthetic path: reuse social apply with a one-off effect.
      // Prefer embedding memory through socialEvent content; this path uses a helper on the bond.
      progression = recordMemoryOnBond(progression, ctx.npcId, action.memory, ctx.now ?? Date.now());
      void applied;
      continue;
    }
    if (action.type === 'unlock_service' && action.serviceId) {
      if (ctx.unlockService) {
        progression = ctx.unlockService(action.serviceId, progression);
      } else {
        const flags = new Set(progression.storyFlags ?? []);
        flags.add(`service:${action.serviceId}`);
        progression = { ...progression, storyFlags: [...flags] };
      }
      continue;
    }
    return { ok: false, reason: 'That dialogue action is not supported.' };
  }

  return {
    ok: true,
    progression,
    stats,
    inventory,
    coins,
    ...(worldKnowledge ? { worldKnowledge } : {}),
    notifications,
    ...(ended ? { ended: true } : {}),
    ...(pendingQuests.length ? { pendingQuests } : {}),
  };
}

function parseAction(raw: unknown): DialogueAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!ACTION_TYPES.has(o.type as DialogueActionType)) return null;
  const action: DialogueAction = { type: o.type as DialogueActionType };
  if (typeof o.flag === 'string') action.flag = o.flag;
  if (typeof o.questId === 'string') action.questId = o.questId;
  if (typeof o.itemId === 'string') action.itemId = o.itemId;
  if (typeof o.quantity === 'number' && Number.isFinite(o.quantity)) action.quantity = Math.floor(o.quantity);
  if (typeof o.coins === 'number' && Number.isFinite(o.coins)) action.coins = Math.floor(o.coins);
  if (typeof o.knowledgeId === 'string') action.knowledgeId = o.knowledgeId;
  if (typeof o.lessonId === 'string') action.lessonId = o.lessonId;
  if (typeof o.socialEvent === 'string') action.socialEvent = o.socialEvent;
  if (o.memory && typeof o.memory === 'object') action.memory = o.memory as SocialMemoryDraft;
  if (typeof o.serviceId === 'string') action.serviceId = o.serviceId;
  return action;
}

function recordMemoryOnBond(
  progression: PlayerProgression,
  npcId: string,
  memory: SocialMemoryDraft,
  now: number
): PlayerProgression {
  const social = progression.social ?? { bonds: {}, scopes: {} };
  const bond = social.bonds[npcId] ?? {
    axes: {},
    grudges: [],
    memories: [],
    onceEvents: [],
    giftCounts: {},
    giftReceipts: [],
    knownPreferences: [],
    actionNextAt: {},
    actionReceipts: [],
  };
  const nextMemory = {
    id: memory.id,
    kind: memory.kind,
    importance: memory.importance,
    at: now,
    visible: memory.visible,
    text: memory.text,
    ...(memory.ttlHours != null ? { expiresAt: now + memory.ttlHours * 3_600_000 } : {}),
  };
  const memories = [nextMemory, ...bond.memories.filter((entry) => entry.id !== memory.id)].slice(0, 24);
  return {
    ...progression,
    social: {
      ...social,
      bonds: {
        ...social.bonds,
        [npcId]: { ...bond, memories },
      },
    },
  };
}
