/** NPC knowledge, rumors, and secrets — server-validated discovery. */

import type { PlayerProgression } from '../progression/index.js';
import type { PlayerStats } from '../types/index.js';
import { bondBlockReason, type BondGate, scopeValue } from '../social/index.js';

export type KnowledgeKind =
  | 'rumor'
  | 'lore'
  | 'secret'
  | 'location'
  | 'recipe'
  | 'history'
  | 'faction'
  | 'other';

export type KnowledgeReliability = 'complete' | 'partial' | 'outdated' | 'unreliable' | 'hint';
export type KnowledgeScope = 'personal' | 'world';

export interface KnowledgeUnlocks {
  questId?: string;
  locationId?: string;
  itemId?: string;
  achievementId?: string;
  recipeId?: string;
  spellId?: string;
  storyFlag?: string;
}

export type DiscoverySourceId =
  | 'conversation'
  | 'quest'
  | 'interact'
  | 'observe'
  | 'lesson'
  | 'gift'
  | 'event'
  | 'activity'
  | 'meet';

/** Optional automatic reveal rules. Conversation unlocks still use dialogue actions. */
export interface KnowledgeTrigger {
  sources?: DiscoverySourceId[];
  onQuestComplete?: string[];
  /** `questId:objectiveId` keys. */
  onQuestObjective?: string[];
  onInteractableId?: string[];
  onLocationId?: string[];
  onLessonId?: string[];
  onGiftPreferenceId?: string[];
  onEventId?: string[];
  onActivityId?: string[];
  onNpcMeet?: string[];
  /** Other knowledge that must already be known before this clue can surface. */
  requiresKnowledge?: string[];
}

export interface KnowledgeNpcFact {
  field: 'biography' | 'location' | 'schedule' | 'interest' | 'history' | 'topic' | 'identity';
  value: string;
}

export interface KnowledgeEntry {
  id: string;
  kind: KnowledgeKind;
  /** Player-facing reveal text (may be incomplete or wrong when reliability is not complete). */
  text: string;
  /** Optional content reference (location id, recipe id, lore key). */
  reference?: string;
  reliability: KnowledgeReliability;
  knownByNpcIds: string[];
  /** Bond / reputation / quest / flag gates. */
  reveal?: {
    bond?: BondGate;
    questIds?: string[];
    storyFlags?: string[];
    publicReputationMin?: number;
    spiritualReputationMin?: number;
    scopeId?: string;
    scopeMin?: number;
  };
  discoveryScope: KnowledgeScope;
  unlocks?: KnowledgeUnlocks;
  /** Optional alternate text when reliability is unreliable/outdated. */
  alternateText?: string;
  trigger?: KnowledgeTrigger;
  /** Structured People-page fact unlocked with this discovery. */
  npcFact?: KnowledgeNpcFact;
  /** Other rumor ids this account disagrees with. */
  conflictsWith?: string[];
  /** Clue ids this discovery clarifies once both are known. */
  clarifies?: string[];
}

export interface KnowledgeDocument {
  entries: KnowledgeEntry[];
}

export interface WorldKnowledgeStore {
  discoveries: Record<string, { discoveredAt: number; byPlayerId?: string }>;
}

export interface KnowledgeRevealResult {
  ok: true;
  entry: KnowledgeEntry;
  text: string;
  alreadyKnown: boolean;
  progression: PlayerProgression;
  worldStore?: WorldKnowledgeStore;
  unlocks?: KnowledgeUnlocks;
}

export interface KnowledgeRevealFailure {
  ok: false;
  reason: string;
}

let documentState: KnowledgeDocument | null = null;

export function setKnowledgeContent(raw: unknown): void {
  documentState = parseKnowledgeDocument(raw);
}

export function getKnowledgeDocument(): KnowledgeDocument | null {
  return documentState;
}

export function emptyWorldKnowledgeStore(): WorldKnowledgeStore {
  return { discoveries: {} };
}

export function parseWorldKnowledgeStore(raw: unknown): WorldKnowledgeStore {
  const store = emptyWorldKnowledgeStore();
  if (!raw || typeof raw !== 'object') return store;
  const discoveries = (raw as { discoveries?: unknown }).discoveries;
  if (!discoveries || typeof discoveries !== 'object') return store;
  for (const [id, value] of Object.entries(discoveries as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const at = (value as { discoveredAt?: unknown }).discoveredAt;
    if (typeof at !== 'number' || !Number.isFinite(at)) continue;
    const by = (value as { byPlayerId?: unknown }).byPlayerId;
    store.discoveries[id] = {
      discoveredAt: at,
      ...(typeof by === 'string' && by ? { byPlayerId: by } : {}),
    };
  }
  return store;
}

export function knowledgeById(id: string): KnowledgeEntry | undefined {
  return documentState?.entries.find((entry) => entry.id === id);
}

export function knowledgeKnownByNpc(npcId: string): KnowledgeEntry[] {
  return (documentState?.entries ?? []).filter((entry) => entry.knownByNpcIds.includes(npcId));
}

export function playerKnowsKnowledge(
  progression: PlayerProgression,
  entry: KnowledgeEntry,
  worldStore?: WorldKnowledgeStore
): boolean {
  if (progression.discoveredKnowledge?.includes(entry.id)) return true;
  if (entry.discoveryScope === 'world' && worldStore?.discoveries[entry.id]) return true;
  return false;
}

export function knowledgeRevealBlockReason(
  entry: KnowledgeEntry,
  npcId: string,
  progression: PlayerProgression,
  stats?: PlayerStats,
  worldStore?: WorldKnowledgeStore
): string | null {
  if (!entry.knownByNpcIds.includes(npcId)) {
    return 'They do not know that.';
  }
  for (const needId of entry.trigger?.requiresKnowledge ?? []) {
    const need = knowledgeById(needId);
    if (!need || !playerKnowsKnowledge(progression, need, worldStore)) {
      return 'That clue is still murky.';
    }
  }
  const reveal = entry.reveal;
  if (!reveal) return null;
  if (reveal.bond) {
    const bond = bondBlockReason(progression, npcId, reveal.bond);
    if (bond) return bond;
  }
  for (const questId of reveal.questIds ?? []) {
    if (!progression.questProgress?.[questId]?.completedAt) {
      return 'That path is not open yet.';
    }
  }
  for (const flag of reveal.storyFlags ?? []) {
    if (!progression.storyFlags?.includes(flag)) {
      return 'That path is not open yet.';
    }
  }
  const publicRep =
    typeof stats?.publicReputation === 'number' ? stats.publicReputation : (stats?.reputation ?? 0);
  if (reveal.publicReputationMin != null && publicRep < reveal.publicReputationMin) {
    return 'Your standing in town is not enough.';
  }
  if (reveal.spiritualReputationMin != null && (stats?.spiritualReputation ?? 0) < reveal.spiritualReputationMin) {
    return 'Your spiritual standing is not enough.';
  }
  if (reveal.scopeId && reveal.scopeMin != null && scopeValue(progression, reveal.scopeId) < reveal.scopeMin) {
    return 'Your standing with that circle is not enough.';
  }
  return null;
}

/**
 * Reveal knowledge. The client may only ask by id; the server verifies the NPC knows it
 * and that every reveal condition holds. Personal vs world persistence is enforced here.
 */
export function tryRevealKnowledge(input: {
  knowledgeId: string;
  npcId: string;
  progression: PlayerProgression;
  stats?: PlayerStats;
  worldStore?: WorldKnowledgeStore;
  now?: number;
  playerId?: string;
  /** Presentational only — gates stay server-side. */
  source?: DiscoverySourceId;
}): KnowledgeRevealResult | KnowledgeRevealFailure {
  void input.source;
  const entry = knowledgeById(input.knowledgeId);
  if (!entry) return { ok: false, reason: 'That rumor is not recorded here.' };
  const block = knowledgeRevealBlockReason(
    entry,
    input.npcId,
    input.progression,
    input.stats,
    input.worldStore
  );
  if (block) return { ok: false, reason: block };

  const personallyKnown = input.progression.discoveredKnowledge?.includes(entry.id) === true;
  const text =
    entry.reliability === 'unreliable' || entry.reliability === 'outdated'
      ? entry.alternateText ?? entry.text
      : entry.text;

  if (personallyKnown) {
    return {
      ok: true,
      entry,
      text,
      alreadyKnown: true,
      progression: input.progression,
      ...(input.worldStore ? { worldStore: input.worldStore } : {}),
    };
  }

  const now = input.now ?? Date.now();
  let progression = input.progression;
  let worldStore = input.worldStore;

  if (entry.discoveryScope === 'world') {
    worldStore = parseWorldKnowledgeStore(worldStore);
    if (!worldStore.discoveries[entry.id]) {
      worldStore = {
        discoveries: {
          ...worldStore.discoveries,
          [entry.id]: {
            discoveredAt: now,
            ...(input.playerId ? { byPlayerId: input.playerId } : {}),
          },
        },
      };
    }
  }

  const discovered = new Set(progression.discoveredKnowledge ?? []);
  discovered.add(entry.id);
  progression = { ...progression, discoveredKnowledge: [...discovered] };

  if (entry.unlocks?.storyFlag) {
    const flags = new Set(progression.storyFlags ?? []);
    flags.add(entry.unlocks.storyFlag);
    progression = { ...progression, storyFlags: [...flags] };
  }
  if (entry.unlocks?.recipeId) {
    const recipes = new Set(progression.discoveredRecipes ?? []);
    recipes.add(entry.unlocks.recipeId);
    progression = { ...progression, discoveredRecipes: [...recipes] };
  }

  return {
    ok: true,
    entry,
    text,
    alreadyKnown: false,
    progression,
    ...(worldStore ? { worldStore } : {}),
    ...(entry.unlocks ? { unlocks: entry.unlocks } : {}),
  };
}

export function validateKnowledgeDocument(
  raw: unknown
): { ok: true; document: KnowledgeDocument } | { ok: false; error: string } {
  const parsed = parseKnowledgeDocument(raw);
  if (!parsed) return { ok: false, error: 'Knowledge document must list entries.' };
  const ids = new Set<string>();
  for (const entry of parsed.entries) {
    if (ids.has(entry.id)) return { ok: false, error: `Duplicate knowledge id: ${entry.id}` };
    ids.add(entry.id);
    if (!entry.knownByNpcIds.length) {
      return { ok: false, error: `Knowledge ${entry.id} needs at least one NPC.` };
    }
  }
  return { ok: true, document: parsed };
}

function parseKnowledgeDocument(raw: unknown): KnowledgeDocument | null {
  if (!raw || typeof raw !== 'object') return null;
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { entries?: unknown }).entries)
      ? ((raw as { entries: unknown[] }).entries)
      : null;
  if (!list) return null;
  const entries: KnowledgeEntry[] = [];
  for (const value of list) {
    const entry = parseEntry(value);
    if (entry) entries.push(entry);
  }
  return { entries };
}

function parseEntry(raw: unknown): KnowledgeEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id.trim()) return null;
  if (typeof o.text !== 'string') return null;
  const kind = isKind(o.kind) ? o.kind : 'other';
  const reliability = isReliability(o.reliability) ? o.reliability : 'complete';
  const discoveryScope = o.discoveryScope === 'world' ? 'world' : 'personal';
  const knownByNpcIds = Array.isArray(o.knownByNpcIds)
    ? o.knownByNpcIds.filter((id): id is string => typeof id === 'string' && !!id.trim())
    : [];
  const trigger = parseTrigger(o.trigger);
  const npcFact = parseNpcFact(o.npcFact);
  const conflictsWith = stringIds(o.conflictsWith);
  const clarifies = stringIds(o.clarifies);
  return {
    id: o.id.trim(),
    kind,
    text: o.text,
    ...(typeof o.reference === 'string' && o.reference ? { reference: o.reference } : {}),
    reliability,
    knownByNpcIds,
    ...(o.reveal && typeof o.reveal === 'object' ? { reveal: o.reveal as KnowledgeEntry['reveal'] } : {}),
    discoveryScope,
    ...(o.unlocks && typeof o.unlocks === 'object' ? { unlocks: o.unlocks as KnowledgeUnlocks } : {}),
    ...(typeof o.alternateText === 'string' ? { alternateText: o.alternateText } : {}),
    ...(trigger ? { trigger } : {}),
    ...(npcFact ? { npcFact } : {}),
    ...(conflictsWith.length ? { conflictsWith } : {}),
    ...(clarifies.length ? { clarifies } : {}),
  };
}

function stringIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === 'string' && !!id.trim()).map((id) => id.trim());
}

function parseTrigger(raw: unknown): KnowledgeTrigger | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const sources = Array.isArray(o.sources)
    ? o.sources.filter((value): value is DiscoverySourceId => isSource(value))
    : undefined;
  const trigger: KnowledgeTrigger = {
    ...(sources?.length ? { sources } : {}),
    ...(stringIds(o.onQuestComplete).length ? { onQuestComplete: stringIds(o.onQuestComplete) } : {}),
    ...(stringIds(o.onQuestObjective).length ? { onQuestObjective: stringIds(o.onQuestObjective) } : {}),
    ...(stringIds(o.onInteractableId).length ? { onInteractableId: stringIds(o.onInteractableId) } : {}),
    ...(stringIds(o.onLocationId).length ? { onLocationId: stringIds(o.onLocationId) } : {}),
    ...(stringIds(o.onLessonId).length ? { onLessonId: stringIds(o.onLessonId) } : {}),
    ...(stringIds(o.onGiftPreferenceId).length ? { onGiftPreferenceId: stringIds(o.onGiftPreferenceId) } : {}),
    ...(stringIds(o.onEventId).length ? { onEventId: stringIds(o.onEventId) } : {}),
    ...(stringIds(o.onActivityId).length ? { onActivityId: stringIds(o.onActivityId) } : {}),
    ...(stringIds(o.onNpcMeet).length ? { onNpcMeet: stringIds(o.onNpcMeet) } : {}),
    ...(stringIds(o.requiresKnowledge).length ? { requiresKnowledge: stringIds(o.requiresKnowledge) } : {}),
  };
  return Object.keys(trigger).length ? trigger : undefined;
}

function parseNpcFact(raw: unknown): KnowledgeNpcFact | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const field = o.field;
  const value = typeof o.value === 'string' ? o.value.trim() : '';
  if (!value) return undefined;
  if (
    field !== 'biography' &&
    field !== 'location' &&
    field !== 'schedule' &&
    field !== 'interest' &&
    field !== 'history' &&
    field !== 'topic' &&
    field !== 'identity'
  ) {
    return undefined;
  }
  return { field, value };
}

function isSource(value: unknown): value is DiscoverySourceId {
  return (
    value === 'conversation' ||
    value === 'quest' ||
    value === 'interact' ||
    value === 'observe' ||
    value === 'lesson' ||
    value === 'gift' ||
    value === 'event' ||
    value === 'activity' ||
    value === 'meet'
  );
}

function isKind(value: unknown): value is KnowledgeKind {
  return (
    value === 'rumor' ||
    value === 'lore' ||
    value === 'secret' ||
    value === 'location' ||
    value === 'recipe' ||
    value === 'history' ||
    value === 'faction' ||
    value === 'other'
  );
}

function isReliability(value: unknown): value is KnowledgeReliability {
  return (
    value === 'complete' ||
    value === 'partial' ||
    value === 'outdated' ||
    value === 'unreliable' ||
    value === 'hint'
  );
}
