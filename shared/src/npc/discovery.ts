/** Unified NPC discovery pipeline — rumors, clues, and People-page facts. */

import type { PlayerProgression } from '../progression/index.js';
import type { PlayerStats } from '../types/index.js';
import {
  getKnowledgeDocument,
  knowledgeById,
  knowledgeKnownByNpc,
  playerKnowsKnowledge,
  tryRevealKnowledge,
  type KnowledgeEntry,
  type KnowledgeReliability,
  type WorldKnowledgeStore,
} from './knowledge.js';

export type DiscoverySource =
  | 'conversation'
  | 'quest'
  | 'interact'
  | 'observe'
  | 'lesson'
  | 'gift'
  | 'event'
  | 'activity'
  | 'meet';

export interface DiscoveryEvent {
  source: DiscoverySource;
  progression: PlayerProgression;
  stats?: PlayerStats;
  worldStore?: WorldKnowledgeStore;
  npcId?: string;
  questId?: string;
  objectiveId?: string;
  interactableId?: string;
  locationId?: string;
  lessonId?: string;
  giftPreferenceId?: string;
  eventId?: string;
  activityId?: string;
  knowledgeId?: string;
  playerId?: string;
  now?: number;
}

export interface DiscoveryReveal {
  id: string;
  text: string;
  alreadyKnown: boolean;
  reliability: KnowledgeReliability;
  npcIds: string[];
}

export interface DiscoveryEventResult {
  progression: PlayerProgression;
  worldStore?: WorldKnowledgeStore;
  revealed: DiscoveryReveal[];
  notifications: string[];
}

export interface DiscoveredClueView {
  id: string;
  text: string;
  reliability: KnowledgeReliability;
  status: 'confirmed' | 'partial' | 'unconfirmed' | 'outdated' | 'conflicting' | 'clarified';
  note?: string;
}

/**
 * Apply a gameplay discovery event. Matching knowledge entries are revealed only when
 * every server-side gate holds. Repeats do not re-grant unlocks.
 */
export function applyDiscoveryEvent(input: DiscoveryEvent): DiscoveryEventResult {
  const now = input.now ?? Date.now();
  let progression = input.progression;
  let worldStore = input.worldStore;
  const revealed: DiscoveryReveal[] = [];
  const notifications: string[] = [];
  const candidates = matchingEntries(input);

  for (const entry of candidates) {
    const npcId = input.npcId ?? entry.knownByNpcIds[0];
    if (!npcId) continue;
    const result = tryRevealKnowledge({
      knowledgeId: entry.id,
      npcId,
      progression,
      stats: input.stats,
      worldStore,
      now,
      playerId: input.playerId,
      source: input.source,
    });
    if (!result.ok) continue;
    progression = result.progression;
    if (result.worldStore) worldStore = result.worldStore;
    revealed.push({
      id: entry.id,
      text: result.text,
      alreadyKnown: result.alreadyKnown,
      reliability: entry.reliability,
      npcIds: entry.knownByNpcIds,
    });
    if (!result.alreadyKnown) notifications.push(result.text);
  }

  return {
    progression,
    ...(worldStore ? { worldStore } : {}),
    revealed,
    notifications,
  };
}

/** Player-facing clue list for one NPC — never includes undiscovered entries. */
export function listDiscoveredCluesForNpc(
  npcId: string,
  progression: PlayerProgression,
  worldStore?: WorldKnowledgeStore
): DiscoveredClueView[] {
  const known = knowledgeKnownByNpc(npcId).filter((entry) =>
    playerKnowsKnowledge(progression, entry, worldStore)
  );
  const knownIds = new Set(known.map((entry) => entry.id));
  return known.map((entry) => clueView(entry, knownIds, progression, worldStore));
}

export function formatClueLine(clue: DiscoveredClueView): string {
  const tag =
    clue.status === 'confirmed'
      ? null
      : clue.status === 'partial'
        ? 'partial'
        : clue.status === 'unconfirmed'
          ? 'unconfirmed'
          : clue.status === 'outdated'
            ? 'outdated'
            : clue.status === 'conflicting'
              ? 'conflicting'
              : clue.status === 'clarified'
                ? 'clarified'
                : null;
  const prefix = tag ? `[${tag}] ` : '';
  const note = clue.note ? ` (${clue.note})` : '';
  return `${prefix}${clue.text}${note}`;
}

function matchingEntries(input: DiscoveryEvent): KnowledgeEntry[] {
  const doc = getKnowledgeDocument();
  if (!doc?.entries.length) return [];
  const out: KnowledgeEntry[] = [];
  for (const entry of doc.entries) {
    if (input.knowledgeId && entry.id !== input.knowledgeId) continue;
    if (!entryMatchesEvent(entry, input)) continue;
    out.push(entry);
  }
  return out;
}

function entryMatchesEvent(entry: KnowledgeEntry, input: DiscoveryEvent): boolean {
  const trigger = entry.trigger;
  // Explicit knowledge ask from conversation / lesson still goes through tryRevealKnowledge directly.
  if (input.knowledgeId) return entry.id === input.knowledgeId;

  if (!trigger) {
    // Legacy entries without triggers only fire from explicit knowledge unlocks.
    return false;
  }

  const sources = trigger.sources;
  if (sources?.length && !sources.includes(input.source)) return false;

  if (input.source === 'quest') {
    if (input.questId && trigger.onQuestComplete?.includes(input.questId)) return true;
    if (
      input.questId &&
      input.objectiveId &&
      trigger.onQuestObjective?.includes(`${input.questId}:${input.objectiveId}`)
    ) {
      return true;
    }
    return false;
  }
  if (input.source === 'interact' || input.source === 'observe') {
    if (input.interactableId && trigger.onInteractableId?.includes(input.interactableId)) return true;
    if (input.locationId && trigger.onLocationId?.includes(input.locationId)) return true;
    return false;
  }
  if (input.source === 'lesson') {
    return !!(input.lessonId && trigger.onLessonId?.includes(input.lessonId));
  }
  if (input.source === 'gift') {
    return !!(input.giftPreferenceId && trigger.onGiftPreferenceId?.includes(input.giftPreferenceId));
  }
  if (input.source === 'event') {
    return !!(input.eventId && trigger.onEventId?.includes(input.eventId));
  }
  if (input.source === 'activity') {
    return !!(input.activityId && trigger.onActivityId?.includes(input.activityId));
  }
  if (input.source === 'meet') {
    return !!(input.npcId && trigger.onNpcMeet?.includes(input.npcId));
  }
  if (input.source === 'conversation') {
    // Conversation discoveries use explicit unlock_knowledge actions.
    return false;
  }
  return false;
}

function clueView(
  entry: KnowledgeEntry,
  knownIds: Set<string>,
  progression: PlayerProgression,
  worldStore?: WorldKnowledgeStore
): DiscoveredClueView {
  const conflicts = (entry.conflictsWith ?? []).filter((id) => knownIds.has(id));
  const clarifiedBy = (getKnowledgeDocument()?.entries ?? []).filter(
    (other) => other.clarifies?.includes(entry.id) && knownIds.has(other.id)
  );
  let status: DiscoveredClueView['status'] = 'confirmed';
  let note: string | undefined;
  let text = entry.text;

  if (clarifiedBy.length) {
    status = 'clarified';
    text = clarifiedBy[0]?.text || entry.text;
    note = 'Later events made this clearer.';
  } else if (conflicts.length) {
    status = 'conflicting';
    note = 'Another account disagrees.';
  } else if (entry.reliability === 'partial' || entry.reliability === 'hint') {
    status = 'partial';
  } else if (entry.reliability === 'unreliable') {
    status = 'unconfirmed';
    text = entry.alternateText ?? entry.text;
  } else if (entry.reliability === 'outdated') {
    status = 'outdated';
    text = entry.alternateText ?? entry.text;
  }

  // Meaningful-after later: if requiresKnowledge are incomplete, still listed when known but marked partial.
  const pending = (entry.trigger?.requiresKnowledge ?? []).filter((id) => {
    const need = knowledgeById(id);
    return need ? !playerKnowsKnowledge(progression, need, worldStore) : true;
  });
  if (pending.length && status === 'confirmed') {
    status = 'partial';
    note = 'You sense this matters more than you can yet say.';
  }

  return {
    id: entry.id,
    text,
    reliability: entry.reliability,
    status,
    ...(note ? { note } : {}),
  };
}
