/** Player-safe NPC encounter and People-page views. No secret affinity or hidden tastes. */

import type { ContentNpc, InventorySlot, PlayerStats } from '../types/index.js';
import type { ContentQuest, PlayerProgression } from '../progression/index.js';
import type { DialogueTree, NpcInteractionOffer } from '../dialogue/index.js';
import { buildNpcInteractionOffers } from '../dialogue/index.js';
import {
  bondJournal,
  getSocialDocument,
  npcAcceptsGifts,
  type NpcSocialProfile,
  type NpcUiFeedback,
} from '../social/index.js';
import { describeGiftWindow, type GiftItemFacts } from '../social/interactions.js';
import { knowledgeKnownByNpc, playerKnowsKnowledge } from './knowledge.js';
import { listLessonOffers } from './lessons.js';
import { personalityPrefersGuard, personalityPrefersHumor, type PersonalityProfile } from './personality.js';

export type NpcDemeanor = 'warm' | 'open' | 'neutral' | 'guarded' | 'wounded' | 'busy';
export type { NpcUiFeedback };

export interface NpcEncounterOffer extends NpcInteractionOffer {
  available?: boolean;
  requirement?: string;
  cooldownUntil?: number;
  kind?: 'talk' | 'trade' | 'quests' | 'gift' | 'favor' | 'train' | 'rumors' | 'social' | 'goodbye' | 'other';
}

export interface NpcEncounterRelationship {
  stageLabel?: string;
  demeanor: NpcDemeanor;
  /** Short player-facing lines (no numbers). */
  signals: string[];
  milestones: string[];
}

export interface NpcEncounterGiftSummary {
  acceptsGifts: boolean;
  canGive: boolean;
  reason?: string;
  nextGiftAt?: number;
  /** Only preferences the player has already discovered. */
  knownPreferences: string[];
}

export interface NpcEncounterView {
  npcId: string;
  name: string;
  role: string;
  biography?: string;
  notice?: string;
  relationship: NpcEncounterRelationship;
  gift?: NpcEncounterGiftSummary;
  options: NpcEncounterOffer[];
  services: {
    questsOpen: number;
    lessonsAvailable: number;
    lessonsCompleted: number;
    rumorsKnown: number;
    rumorsTotal: number;
  };
}

export interface PeopleDossierPatch {
  role?: string;
  biography?: string;
  knownLocations?: string[];
  knownSchedule?: string[];
  knownLikes?: string[];
  knownDislikes?: string[];
  services?: string[];
  discoveredRumors?: string[];
  unlockedTopics?: string[];
  stageLabel?: string;
  regard?: string[];
  memories?: string[];
}

export function buildNpcEncounterView(input: {
  npc: ContentNpc;
  dialogue?: DialogueTree | null;
  progression: PlayerProgression;
  stats: PlayerStats;
  inventory: InventorySlot[];
  coins: number;
  contextShopId?: string;
  quests?: Pick<ContentQuest, 'id' | 'name' | 'npcId' | 'npcIds' | 'offer'>[];
  notice?: string;
  giftSlots?: { slotIndex: number; quantity: number; facts: GiftItemFacts }[];
  now?: number;
}): NpcEncounterView {
  const now = input.now ?? Date.now();
  const journal = bondJournal(input.progression, input.npc.id, now);
  const profile = getSocialDocument()?.npcs[input.npc.id];
  const feedback = resolveUiFeedback(profile);
  const personality = input.npc.personality ?? profile?.personality;
  const demeanor = encounterDemeanor(journal.stageLabel, personality, input.notice, input.progression, input.npc.id);
  const baseOffers = buildNpcInteractionOffers({
    npc: input.npc,
    dialogue: input.dialogue,
    contextShopId: input.contextShopId,
    quests: input.quests,
    questProgress: input.progression.questProgress,
    acceptsGifts: npcAcceptsGifts(input.npc.id),
    progression: input.progression,
    now,
  });

  const giftWindow = npcAcceptsGifts(input.npc.id)
    ? describeGiftWindow(input.progression, input.npc.id, input.giftSlots ?? [], now)
    : null;

  const lessons = listLessonOffers(input.npc.id, input.progression, input.coins, input.inventory);
  const knowledge = knowledgeKnownByNpc(input.npc.id);
  const rumorsKnown = knowledge.filter((entry) => playerKnowsKnowledge(input.progression, entry)).length;

  const options: NpcEncounterOffer[] = baseOffers.map((offer) => enrichOffer(offer, lessons, giftWindow, now));

  const signals: string[] = [];
  if (feedback.showStage && journal.stageLabel) {
    signals.push(`They regard you as ${journal.stageLabel.toLowerCase()}.`);
  }
  if (feedback.showRegard) {
    for (const line of journal.regard.slice(0, 2)) signals.push(line);
  }
  if (feedback.showDemeanor) {
    if (demeanor === 'wounded') signals.push('There is a wound still open between you.');
    if (demeanor === 'guarded') signals.push('Their manner is careful.');
    if (demeanor === 'warm') signals.push('Their manner is open.');
    if (demeanor === 'busy') signals.push('They seem occupied.');
  }
  if (input.notice) signals.push(input.notice);

  const milestones = feedback.showMilestones ? (journal.memories ?? []).slice(0, 4) : [];

  return {
    npcId: input.npc.id,
    name: input.npc.name,
    role: input.npc.role,
    ...(input.npc.biography ? { biography: input.npc.biography } : {}),
    ...(input.notice ? { notice: input.notice } : {}),
    relationship: {
      ...(feedback.showStage && journal.stageLabel ? { stageLabel: journal.stageLabel } : {}),
      demeanor,
      signals,
      milestones,
    },
    ...(feedback.showGiftSummary
      ? giftWindow
        ? {
            gift: {
              acceptsGifts: true,
              canGive: giftWindow.canGive,
              ...(giftWindow.reason ? { reason: giftWindow.reason } : {}),
              ...(giftWindow.nextGiftAt ? { nextGiftAt: giftWindow.nextGiftAt } : {}),
              knownPreferences: giftWindow.knownPreferences.map((row) => row.line),
            },
          }
        : { gift: { acceptsGifts: false, canGive: false, knownPreferences: [] } }
      : {}),
    options,
    services: feedback.showServices
      ? {
          questsOpen: baseOffers.some((offer) => offer.id === 'quests') ? 1 : 0,
          lessonsAvailable: lessons.filter((lesson) => lesson.available).length,
          lessonsCompleted: lessons.filter((lesson) => lesson.completed).length,
          rumorsKnown,
          rumorsTotal: knowledge.length,
        }
      : {
          questsOpen: 0,
          lessonsAvailable: 0,
          lessonsCompleted: 0,
          rumorsKnown: 0,
          rumorsTotal: 0,
        },
  };
}

export function buildPeopleDossierPatch(input: {
  npc: ContentNpc;
  progression: PlayerProgression;
  now?: number;
}): PeopleDossierPatch {
  const now = input.now ?? Date.now();
  const journal = bondJournal(input.progression, input.npc.id, now);
  const profile = getSocialDocument()?.npcs[input.npc.id];
  const feedback = resolveUiFeedback(profile);
  const knownLikes: string[] = [];
  const knownDislikes: string[] = [];
  for (const pref of profile?.giftPreferences ?? []) {
    if (pref.visibility === 'hidden') {
      if (!input.progression.social?.bonds[input.npc.id]?.knownPreferences.includes(pref.id)) continue;
      const line = pref.discoveredLine || pref.hint;
      if (!line) continue;
      if (pref.tier === 'hated' || pref.tier === 'disliked') knownDislikes.push(line);
      else knownLikes.push(line);
      continue;
    }
    if (pref.visibility === 'hinted') {
      if (!pref.hint) continue;
      if (pref.tier === 'hated' || pref.tier === 'disliked') knownDislikes.push(pref.hint);
      else knownLikes.push(pref.hint);
      continue;
    }
    const line = pref.publicLine || pref.hint;
    if (!line) continue;
    if (pref.tier === 'hated' || pref.tier === 'disliked') knownDislikes.push(line);
    else knownLikes.push(line);
  }

  const services: string[] = [];
  if (feedback.showServices) {
    if (input.npc.shopId) services.push('Keeps a shop.');
    const lessons = listLessonOffers(input.npc.id, input.progression);
    if (lessons.some((lesson) => lesson.completed)) services.push('Has taught you.');
    if (lessons.some((lesson) => lesson.available || lesson.completed)) services.push('Offers lessons.');
  }
  const knowledge = knowledgeKnownByNpc(input.npc.id);
  const discoveredRumors = knowledge
    .filter((entry) => playerKnowsKnowledge(input.progression, entry))
    .map((entry) => entry.text);

  const knownLocations: string[] = [];
  if (input.npc.locationId) knownLocations.push(input.npc.locationId.replace(/_/g, ' '));

  const knownSchedule: string[] = [];
  if (feedback.showSchedule) {
    for (const row of input.npc.schedule ?? []) {
      if (row.interaction === 'away') continue;
      const activity = row.activity || row.label;
      if (!activity) continue;
      const place = (row.locationId || input.npc.locationId).replace(/_/g, ' ');
      knownSchedule.push(`${activity} at the ${place}`);
      if (knownSchedule.length >= 3) break;
    }
  }

  const dialogueState = input.progression.dialogueState?.[input.npc.dialogueTreeId];
  const unlockedTopics = (dialogueState?.completedNodeIds ?? [])
    .filter((id) => id !== 'start' && id !== 'end')
    .slice(0, 8)
    .map((id) => id.replace(/_/g, ' '));

  return {
    role: input.npc.role,
    ...(input.npc.biography ? { biography: input.npc.biography } : {}),
    ...(knownLocations.length ? { knownLocations } : {}),
    ...(knownSchedule.length ? { knownSchedule } : {}),
    ...(knownLikes.length ? { knownLikes } : {}),
    ...(knownDislikes.length ? { knownDislikes } : {}),
    ...(services.length ? { services } : {}),
    ...(discoveredRumors.length ? { discoveredRumors } : {}),
    ...(unlockedTopics.length ? { unlockedTopics } : {}),
    ...(feedback.showStage ? { stageLabel: journal.stageLabel } : {}),
    ...(feedback.showRegard ? { regard: journal.regard } : {}),
    ...(feedback.showMilestones ? { memories: journal.memories } : {}),
  };
}

function enrichOffer(
  offer: NpcInteractionOffer,
  lessons: ReturnType<typeof listLessonOffers>,
  giftWindow: ReturnType<typeof describeGiftWindow> | null,
  now: number
): NpcEncounterOffer {
  const kind = offerKind(offer.id);
  if (offer.available === false) {
    return {
      ...offer,
      kind,
      available: false,
      ...(offer.requirement ? { requirement: offer.requirement } : {}),
      ...(offer.cooldownUntil && offer.cooldownUntil > now ? { cooldownUntil: offer.cooldownUntil } : {}),
    };
  }
  if (offer.id === 'gift' && giftWindow && !giftWindow.canGive) {
    return {
      ...offer,
      kind,
      available: false,
      requirement: giftWindow.reason ?? 'They are not taking gifts right now.',
      ...(giftWindow.nextGiftAt && giftWindow.nextGiftAt > now ? { cooldownUntil: giftWindow.nextGiftAt } : {}),
    };
  }
  if (offer.id === 'train') {
    const open = lessons.filter((lesson) => lesson.available).length;
    const done = lessons.filter((lesson) => lesson.completed).length;
    if (!open && done) {
      return { ...offer, kind, available: false, requirement: 'You already know what they will teach for now.' };
    }
    if (!open) {
      return { ...offer, kind, available: false, requirement: 'No lesson is open to you yet.' };
    }
  }
  return { ...offer, kind, available: true };
}

function resolveUiFeedback(profile: NpcSocialProfile | undefined): Required<NpcUiFeedback> {
  const ui = profile?.uiFeedback;
  return {
    showStage: ui?.showStage !== false,
    showRegard: ui?.showRegard !== false,
    showDemeanor: ui?.showDemeanor !== false,
    showMilestones: ui?.showMilestones !== false,
    showGiftSummary: ui?.showGiftSummary !== false,
    showServices: ui?.showServices !== false,
    showSchedule: ui?.showSchedule !== false,
  };
}

function offerKind(id: string): NpcEncounterOffer['kind'] {
  if (id.startsWith('social:')) return 'social';
  if (
    id === 'talk' ||
    id === 'trade' ||
    id === 'quests' ||
    id === 'gift' ||
    id === 'favor' ||
    id === 'train' ||
    id === 'rumors' ||
    id === 'goodbye'
  ) {
    return id;
  }
  return 'other';
}

function encounterDemeanor(
  stageLabel: string,
  personality: PersonalityProfile | undefined,
  notice: string | undefined,
  progression: PlayerProgression,
  npcId: string
): NpcDemeanor {
  if (notice) return 'busy';
  const bond = progression.social?.bonds[npcId];
  if (bond?.grudges.length) return 'wounded';
  const stage = stageLabel.toLowerCase();
  if (stage.includes('hostile') || stage.includes('disliked') || stage.includes('suspicious')) return 'guarded';
  if (personalityPrefersGuard(personality)) return 'guarded';
  if (stage.includes('close') || stage.includes('friendly') || personalityPrefersHumor(personality)) return 'warm';
  if (stage.includes('familiar') || stage.includes('trusted')) return 'open';
  return 'neutral';
}
