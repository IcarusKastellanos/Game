import type { InventorySlot, PlayerStats } from '../types/index.js';
import type { ContentQuest, PlayerProgression } from '../progression/index.js';
import { getNpcRelationshipLevel, withGrimoire } from '../progression/index.js';
import { recordGrimoireNpc } from '../progression/grimoire.js';
import { applyReputationDelta } from '../progression/reputation.js';
import { removeItemFromInventory } from '../inventory/index.js';

export type SocialAxis = 'affinity' | 'trust' | 'respect' | 'fear' | 'familiarity';
export type SocialEventScope = 'npc' | 'reputation' | 'both';
export type SocialRepeat = 'once' | 'always';

export interface SocialScopeDef {
  id: string;
  label: string;
  kind: 'settlement' | 'faction' | 'institution' | 'profession' | 'region' | 'global';
}

export interface StageWhen {
  grudge?: string;
  affinityMin?: number;
  affinityMax?: number;
  trustMin?: number;
  respectMin?: number;
  fearMin?: number;
  familiarityMin?: number;
  familiarityMax?: number;
}

export interface StageDef {
  id: string;
  label: string;
  rank: number;
  when: StageWhen;
}

export interface SocialMemoryDraft {
  id: string;
  kind: string;
  importance: number;
  visible: boolean;
  text: string;
  /** Hours until the memory fades. Omit for a permanent memory. */
  ttlHours?: number;
}

export interface SocialEffect {
  target: 'axis' | 'reputation' | 'memory' | 'grudge' | 'clearGrudge';
  axis?: SocialAxis;
  amount?: number;
  /** `public`, `spiritual`, or a scope id from the social document. */
  reputation?: string;
  grudge?: string;
  memory?: SocialMemoryDraft;
}

export interface SocialEventDef {
  id: string;
  scope: SocialEventScope;
  source: string;
  repeat: SocialRepeat;
  npcIds?: string[];
  effects: SocialEffect[];
  feedback?: string;
}

export interface GiftMatch {
  itemIds?: string[];
  categories?: string[];
  tags?: string[];
  rarities?: string[];
  provenance?: string[];
}

export interface GiftPreference {
  id: string;
  match: GiftMatch;
  tier: string;
  visibility: 'public' | 'hinted' | 'hidden';
  publicLine?: string;
  hint?: string;
  discoveredLine?: string;
  /** Best reaction waits until this quest is complete. elseTier is used before then. */
  requiresQuest?: string;
  elseTier?: string;
  extraAxes?: Partial<Record<SocialAxis, number>>;
}

export interface GiftTierDef {
  axes?: Partial<Record<SocialAxis, number>>;
  reaction: string;
  memory?: SocialMemoryDraft;
}

export interface GiftPolicy {
  /** Elapsed real-world time. The world hour follows the real hour, so gift days use this clock. */
  clock: 'real' | 'game';
  cooldownHours: number;
  refusedConsumesCooldown: boolean;
  repeatDecay: number;
  maxCountedRepeats: number;
  negativeAffinityCap: number;
  coldAffinity: number;
  coldScale: number;
  defaultTier: string;
  deniedCategories: string[];
  deniedItemIds: string[];
}

export interface SocialActionDef {
  id: string;
  label: string;
  cooldownHours: number;
  feedback: string;
  effects?: SocialEffect[];
  requires?: BondGate;
  requiresQuest?: string;
  requiresAnyMemory?: string[];
  requiresMemoryPrefix?: string;
  activityId?: string;
  suppressEffectsWhenGrudge?: string;
  grudgeFeedback?: string;
}

export interface NpcSocialProfile {
  axes?: SocialAxis[];
  stages?: StageDef[];
  acceptsGifts?: boolean;
  appreciatedGifts?: string[];
  giftPreferences?: GiftPreference[];
  giftPersonality?: { affinityScale?: number };
  /** Full personality profile. Soft-modulates gifts and greetings only. */
  personality?: import('../npc/personality.js').PersonalityProfile;
  actionIds?: string[];
  shopDiscount?: { minStage: string; multiplier: number };
  acknowledgements?: { memoryId: string; text: string }[];
  /** Absence greeting after this many real days. */
  absenceDays?: number;
  absenceLine?: string;
}

export interface SocialDocument {
  scopes: SocialScopeDef[];
  axes: SocialAxis[];
  defaultAxes: SocialAxis[];
  stages: StageDef[];
  npcs: Record<string, NpcSocialProfile>;
  events: SocialEventDef[];
  giftPolicy?: GiftPolicy;
  giftTiers?: Record<string, GiftTierDef>;
  actions?: SocialActionDef[];
  defaultActionIds?: string[];
  supportedActivities?: string[];
}

export interface NpcMemory {
  id: string;
  kind: string;
  importance: number;
  at: number;
  expiresAt?: number;
  visible: boolean;
  text: string;
}

export interface SocialReceipt {
  operationId: string;
  at: number;
  ok: boolean;
  reaction: string;
  itemId?: string;
  tier?: string;
  actionId?: string;
}

export interface NpcBond {
  axes: Partial<Record<SocialAxis, number>>;
  grudges: string[];
  memories: NpcMemory[];
  onceEvents: string[];
  giftNextAt?: number;
  giftCounts: Record<string, number>;
  giftReceipts: SocialReceipt[];
  knownPreferences: string[];
  actionNextAt: Record<string, number>;
  actionReceipts: SocialReceipt[];
  /** Last real-time conversation with this player. */
  lastSeenAt?: number;
}

export interface PlayerSocial {
  bonds: Record<string, NpcBond>;
  scopes: Record<string, number>;
}

export interface BondGate {
  stage?: string;
  trustMin?: number;
  affinityMin?: number;
  respectMin?: number;
  familiarityMin?: number;
  fearMin?: number;
  memory?: string;
  grudge?: string;
  noGrudge?: string;
}

export interface SocialApplyResult {
  progression: PlayerProgression;
  stats: PlayerStats;
  applied: boolean;
  duplicate: boolean;
  feedback?: string;
  notable?: string;
}

const AXES: SocialAxis[] = ['affinity', 'trust', 'respect', 'fear', 'familiarity'];
const MAX_MEMORIES = 24;
const MAX_ONCE = 80;

let documentState: SocialDocument | null = null;

export function setSocialContent(raw: unknown): void {
  documentState = parseSocialDocument(raw);
}

export function getSocialDocument(): SocialDocument | null {
  return documentState;
}

export function emptySocial(): PlayerSocial {
  return { bonds: {}, scopes: {} };
}

export function parsePlayerSocial(raw: unknown, legacyRelationships?: Record<string, number>): PlayerSocial {
  const social = emptySocial();
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (o.bonds && typeof o.bonds === 'object') {
      for (const [npcId, value] of Object.entries(o.bonds as Record<string, unknown>)) {
        const bond = parseBond(value);
        if (bond) social.bonds[npcId] = bond;
      }
    }
    if (o.scopes && typeof o.scopes === 'object') {
      for (const [scopeId, value] of Object.entries(o.scopes as Record<string, unknown>)) {
        if (typeof value === 'number' && Number.isFinite(value)) social.scopes[scopeId] = clamp(value, -100, 100);
      }
    }
  }
  if (legacyRelationships) {
    for (const [npcId, value] of Object.entries(legacyRelationships)) {
      if (!social.bonds[npcId] && typeof value === 'number' && Number.isFinite(value)) {
        social.bonds[npcId] = emptyBond();
        social.bonds[npcId].axes.familiarity = clamp(value, 0, 100);
      }
    }
  }
  return social;
}

export function applySocialEvent(
  progression: PlayerProgression,
  stats: PlayerStats,
  input: {
    eventId: string;
    npcId?: string;
    /** Multiplies effect amounts. Dialogue regard uses the authored delta. */
    scale?: number;
    /** Distinguishes one-shot events that share an id, such as two different quests. */
    idempotencyKey?: string;
    now?: number;
  }
): SocialApplyResult {
  const event = documentState?.events.find((entry) => entry.id === input.eventId);
  if (!event) return { progression, stats, applied: false, duplicate: false };
  if (event.npcIds?.length && input.npcId && !event.npcIds.includes(input.npcId)) {
    return { progression, stats, applied: false, duplicate: false };
  }
  const now = input.now ?? Date.now();
  const scale = input.scale ?? 1;
  const npcId = input.npcId;
  const social = cloneSocial(progression.social, progression.npcRelationships);
  const bond = npcId ? ensureBond(social, npcId) : undefined;
  const onceKey = input.idempotencyKey ? `${event.id}:${input.idempotencyKey}` : event.id;
  if (event.repeat === 'once' && bond && bond.onceEvents.includes(onceKey)) {
    return { progression, stats, applied: false, duplicate: true };
  }
  if (event.repeat === 'once' && !bond && socialHasOnce(social, onceKey)) {
    return { progression, stats, applied: false, duplicate: true };
  }

  const beforeFamiliarity = bond ? axisValue(bond, 'familiarity') : 0;
  let nextStats = stats;
  let changed = false;
  const touchesNpc = event.scope === 'npc' || event.scope === 'both';
  const touchesReputation = event.scope === 'reputation' || event.scope === 'both';

  for (const effect of event.effects) {
    if (effect.target === 'axis' && touchesNpc && bond && npcId && effect.axis) {
      if (!axesFor(npcId).has(effect.axis)) continue;
      const amount = Math.round((effect.amount ?? 0) * scale);
      if (!amount) continue;
      bond.axes[effect.axis] = clampAxis(effect.axis, axisValue(bond, effect.axis) + amount);
      changed = true;
    } else if (effect.target === 'reputation' && touchesReputation && effect.reputation) {
      const amount = Math.round((effect.amount ?? 0) * scale);
      if (!amount) continue;
      if (effect.reputation === 'public' || effect.reputation === 'spiritual') {
        nextStats = applyReputationDelta(nextStats, effect.reputation, amount);
      } else {
        social.scopes[effect.reputation] = clamp((social.scopes[effect.reputation] ?? 0) + amount, -100, 100);
      }
      changed = true;
    } else if (effect.target === 'grudge' && bond && effect.grudge) {
      if (!bond.grudges.includes(effect.grudge)) bond.grudges.push(effect.grudge);
      changed = true;
    } else if (effect.target === 'clearGrudge' && bond && effect.grudge) {
      const next = bond.grudges.filter((id) => id !== effect.grudge);
      if (next.length !== bond.grudges.length) changed = true;
      bond.grudges = next;
    } else if (effect.target === 'memory' && bond && effect.memory) {
      upsertMemory(bond, effect.memory, now);
      changed = true;
    }
  }

  if (event.repeat === 'once') {
    if (bond) {
      bond.onceEvents = [...bond.onceEvents, onceKey].slice(-MAX_ONCE);
    } else {
      rememberScopeOnce(social, onceKey);
    }
    changed = true;
  }
  if (bond) expireMemories(bond, now);

  if (!changed && event.repeat !== 'once') {
    return { progression, stats, applied: false, duplicate: false };
  }

  const nextProgression: PlayerProgression = {
    ...progression,
    social,
    npcRelationships: bond && npcId ? mirroredRelationships(progression, social, npcId) : progression.npcRelationships,
  };
  const afterFamiliarity = bond ? axisValue(bond, 'familiarity') : beforeFamiliarity;
  return {
    progression: nextProgression,
    stats: nextStats,
    applied: true,
    duplicate: false,
    feedback: event.feedback,
    notable: notableFamiliarity(beforeFamiliarity, afterFamiliarity),
  };
}

export function bondBlockReason(
  progression: PlayerProgression | undefined,
  npcId: string | undefined,
  gate: BondGate | undefined
): string | null {
  if (!gate || !npcId) return null;
  if (!documentState) return null;
  const bond = bondOf(progression, npcId);
  if (gate.grudge && !bond.grudges.includes(gate.grudge)) return 'They have not marked you that way.';
  if (gate.noGrudge && bond.grudges.includes(gate.noGrudge)) return 'That wound is still between you.';
  if (gate.memory && !bond.memories.some((memory) => memory.id === gate.memory && !memoryExpired(memory))) {
    return 'They have no reason to speak of that yet.';
  }
  if (gate.trustMin != null && axisValue(bond, 'trust') < gate.trustMin) return 'They do not trust you with that.';
  if (gate.affinityMin != null && axisValue(bond, 'affinity') < gate.affinityMin) return 'They are not fond enough of you for that.';
  if (gate.respectMin != null && axisValue(bond, 'respect') < gate.respectMin) return 'They do not regard your conduct highly enough.';
  if (gate.fearMin != null && axisValue(bond, 'fear') < gate.fearMin) return 'You have not given them cause to be cautious.';
  if (gate.familiarityMin != null && axisValue(bond, 'familiarity') < gate.familiarityMin) {
    return 'They do not know you well enough for that.';
  }
  if (gate.stage) {
    const need = stageById(npcId, gate.stage);
    const have = currentStage(npcId, bond);
    if (!need || have.rank < need.rank) return 'You are not close enough for that.';
  }
  return null;
}

export function bondAllowsQuest(progression: PlayerProgression, quest: Pick<ContentQuest, 'npcId' | 'minStage'>): boolean {
  if (!quest.minStage || !quest.npcId) return true;
  return bondBlockReason(progression, quest.npcId, { stage: quest.minStage }) == null;
}

export function npcAcceptsGifts(npcId: string): boolean {
  return documentState?.npcs[npcId]?.acceptsGifts === true;
}

export function bondShopMultiplier(progression: PlayerProgression | undefined, npcId: string | undefined): number {
  if (!progression || !npcId || !documentState) return 1;
  const discount = documentState.npcs[npcId]?.shopDiscount;
  if (!discount || discount.multiplier <= 0 || discount.multiplier > 1) return 1;
  if (bondBlockReason(progression, npcId, { stage: discount.minStage })) return 1;
  return discount.multiplier;
}

export function bondGreeting(npcId: string, progression: PlayerProgression | undefined, now = Date.now()): string | null {
  if (!progression) return null;
  const profile = documentState?.npcs[npcId];
  const bond = bondOf(progression, npcId);
  if (profile?.absenceLine && profile.absenceDays != null && bond.lastSeenAt != null) {
    const days = (now - bond.lastSeenAt) / 86_400_000;
    if (days >= profile.absenceDays) return profile.absenceLine;
  }
  const lines = profile?.acknowledgements ?? [];
  if (!lines.length) return null;
  const memories = bond.memories.filter((memory) => memory.visible && !memoryExpired(memory, now));
  memories.sort((a, b) => b.importance - a.importance || b.at - a.at);
  for (const memory of memories) {
    const line = lines.find((entry) => entry.memoryId === memory.id);
    if (line?.text) return line.text;
  }
  return null;
}

export function bondJournal(progression: PlayerProgression | undefined, npcId: string, now = Date.now()): {
  stageLabel: string;
  regard: string[];
  memories: string[];
} {
  const bond = bondOf(progression, npcId);
  const stage = currentStage(npcId, bond);
  const axes = axesFor(npcId);
  const regard: string[] = [];
  if (axes.has('familiarity')) regard.push(familiarityPhrase(axisValue(bond, 'familiarity')));
  if (axes.has('affinity')) regard.push(affinityPhrase(axisValue(bond, 'affinity')));
  if (axes.has('trust')) regard.push(trustPhrase(axisValue(bond, 'trust')));
  if (axes.has('respect')) regard.push(respectPhrase(axisValue(bond, 'respect')));
  if (axes.has('fear')) regard.push(fearPhrase(axisValue(bond, 'fear')));
  const memories = bond.memories
    .filter((memory) => memory.visible && memory.text && !memoryExpired(memory, now))
    .sort((a, b) => b.importance - a.importance || b.at - a.at)
    .slice(0, 6)
    .map((memory) => memory.text);
  return { stageLabel: stage.label, regard, memories };
}

export function withBondJournal(progression: PlayerProgression, npcId: string, name: string): PlayerProgression {
  const view = bondJournal(progression, npcId);
  return withGrimoire(progression, (grimoire) =>
    recordGrimoireNpc(grimoire, {
      npcId,
      name,
      relationship: getNpcRelationshipLevel(progression, npcId),
      stageLabel: view.stageLabel,
      regard: view.regard,
      memories: view.memories,
    })
  );
}

export function takeAppreciatedGift(
  inventory: InventorySlot[],
  npcId: string
): { ok: true; inventory: InventorySlot[]; itemId: string } | { ok: false; reason: string } {
  const profile = documentState?.npcs[npcId];
  if (!profile?.acceptsGifts) return { ok: false, reason: 'They are not taking gifts.' };
  const giftId = (profile.appreciatedGifts ?? []).find((itemId) =>
    inventory.some((slot) => slot.itemId === itemId && slot.quantity > 0)
  );
  if (!giftId) return { ok: false, reason: 'They are not interested in what you are carrying.' };
  const removed = removeItemFromInventory(inventory, giftId, 1);
  if (!removed.ok) return { ok: false, reason: 'They are not interested in what you are carrying.' };
  return { ok: true, inventory: removed.inventory, itemId: giftId };
}

export function scopeValue(progression: PlayerProgression | undefined, scopeId: string): number {
  return progression?.social?.scopes[scopeId] ?? 0;
}

function parseSocialDocument(raw: unknown): SocialDocument | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<SocialDocument>;
  if (!Array.isArray(o.stages) || !Array.isArray(o.events)) return null;
  return {
    scopes: Array.isArray(o.scopes) ? o.scopes : [],
    axes: Array.isArray(o.axes) ? o.axes.filter(isAxis) : AXES,
    defaultAxes: Array.isArray(o.defaultAxes) && o.defaultAxes.length ? o.defaultAxes.filter(isAxis) : ['familiarity'],
    stages: o.stages,
    npcs: o.npcs && typeof o.npcs === 'object' ? o.npcs : {},
    events: o.events,
    giftPolicy: parseGiftPolicy(o.giftPolicy),
    giftTiers: o.giftTiers && typeof o.giftTiers === 'object' ? o.giftTiers : {},
    actions: Array.isArray(o.actions) ? o.actions : [],
    defaultActionIds: Array.isArray(o.defaultActionIds)
      ? o.defaultActionIds.filter((id): id is string => typeof id === 'string')
      : ['greet'],
    supportedActivities: Array.isArray(o.supportedActivities)
      ? o.supportedActivities.filter((id): id is string => typeof id === 'string')
      : [],
  };
}

function parseGiftPolicy(raw: unknown): GiftPolicy {
  const o = raw && typeof raw === 'object' ? (raw as Partial<GiftPolicy>) : {};
  const clock = o.clock === 'game' ? 'game' : 'real';
  return {
    clock,
    cooldownHours: typeof o.cooldownHours === 'number' && o.cooldownHours > 0 ? o.cooldownHours : 24,
    refusedConsumesCooldown: o.refusedConsumesCooldown === true,
    repeatDecay: typeof o.repeatDecay === 'number' && o.repeatDecay >= 0 ? o.repeatDecay : 0.5,
    maxCountedRepeats: typeof o.maxCountedRepeats === 'number' ? Math.max(1, Math.floor(o.maxCountedRepeats)) : 3,
    negativeAffinityCap: typeof o.negativeAffinityCap === 'number' ? o.negativeAffinityCap : -4,
    coldAffinity: typeof o.coldAffinity === 'number' ? o.coldAffinity : -15,
    coldScale: typeof o.coldScale === 'number' ? o.coldScale : 0.5,
    defaultTier: typeof o.defaultTier === 'string' && o.defaultTier ? o.defaultTier : 'neutral',
    deniedCategories: Array.isArray(o.deniedCategories) ? o.deniedCategories.filter((id): id is string => typeof id === 'string') : ['books', 'tools', 'familiar_care'],
    deniedItemIds: Array.isArray(o.deniedItemIds) ? o.deniedItemIds.filter((id): id is string => typeof id === 'string') : [],
  };
}

function parseBond(raw: unknown): NpcBond | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const bond = emptyBond();
  if (o.axes && typeof o.axes === 'object') {
    for (const axis of AXES) {
      const value = (o.axes as Record<string, unknown>)[axis];
      if (typeof value === 'number' && Number.isFinite(value)) bond.axes[axis] = clampAxis(axis, value);
    }
  }
  if (Array.isArray(o.grudges)) bond.grudges = o.grudges.filter((id): id is string => typeof id === 'string').slice(0, 24);
  if (Array.isArray(o.memories)) {
    for (const entry of o.memories) {
      if (!entry || typeof entry !== 'object') continue;
      const memory = entry as Partial<NpcMemory>;
      if (typeof memory.id !== 'string' || typeof memory.text !== 'string') continue;
      bond.memories.push({
        id: memory.id,
        kind: typeof memory.kind === 'string' ? memory.kind : 'note',
        importance: typeof memory.importance === 'number' ? memory.importance : 1,
        at: typeof memory.at === 'number' ? memory.at : 0,
        expiresAt: typeof memory.expiresAt === 'number' ? memory.expiresAt : undefined,
        visible: memory.visible !== false,
        text: memory.text,
      });
    }
  }
  if (Array.isArray(o.onceEvents)) {
    bond.onceEvents = o.onceEvents.filter((id): id is string => typeof id === 'string').slice(-MAX_ONCE);
  }
  if (typeof o.giftNextAt === 'number' && Number.isFinite(o.giftNextAt)) bond.giftNextAt = o.giftNextAt;
  if (typeof o.lastSeenAt === 'number' && Number.isFinite(o.lastSeenAt)) bond.lastSeenAt = o.lastSeenAt;
  if (o.giftCounts && typeof o.giftCounts === 'object') {
    for (const [itemId, count] of Object.entries(o.giftCounts as Record<string, unknown>)) {
      if (typeof count === 'number' && Number.isFinite(count) && count > 0) bond.giftCounts[itemId] = Math.floor(count);
    }
  }
  bond.giftReceipts = parseReceipts(o.giftReceipts);
  bond.actionReceipts = parseReceipts(o.actionReceipts);
  if (Array.isArray(o.knownPreferences)) {
    bond.knownPreferences = o.knownPreferences.filter((id): id is string => typeof id === 'string').slice(0, 32);
  }
  if (o.actionNextAt && typeof o.actionNextAt === 'object') {
    for (const [actionId, at] of Object.entries(o.actionNextAt as Record<string, unknown>)) {
      if (typeof at === 'number' && Number.isFinite(at)) bond.actionNextAt[actionId] = at;
    }
  }
  return bond;
}

function parseReceipts(raw: unknown): SocialReceipt[] {
  if (!Array.isArray(raw)) return [];
  const receipts: SocialReceipt[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const receipt = entry as Partial<SocialReceipt>;
    if (typeof receipt.operationId !== 'string' || typeof receipt.reaction !== 'string') continue;
    receipts.push({
      operationId: receipt.operationId,
      at: typeof receipt.at === 'number' ? receipt.at : 0,
      ok: receipt.ok === true,
      reaction: receipt.reaction,
      itemId: typeof receipt.itemId === 'string' ? receipt.itemId : undefined,
      tier: typeof receipt.tier === 'string' ? receipt.tier : undefined,
      actionId: typeof receipt.actionId === 'string' ? receipt.actionId : undefined,
    });
  }
  return receipts.slice(-12);
}

function emptyBond(): NpcBond {
  return {
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
}

function cloneSocial(social: PlayerSocial | undefined, legacy: Record<string, number>): PlayerSocial {
  const parsed = parsePlayerSocial(social ?? { bonds: {}, scopes: {} }, legacy);
  return {
    scopes: { ...parsed.scopes },
    bonds: Object.fromEntries(Object.entries(parsed.bonds).map(([id, bond]) => [id, copyBond(bond)])),
  };
}

function copyBond(bond: NpcBond): NpcBond {
  return {
    axes: { ...bond.axes },
    grudges: [...bond.grudges],
    memories: bond.memories.map((memory) => ({ ...memory })),
    onceEvents: [...bond.onceEvents],
    giftNextAt: bond.giftNextAt,
    giftCounts: { ...bond.giftCounts },
    giftReceipts: bond.giftReceipts.map((receipt) => ({ ...receipt })),
    knownPreferences: [...bond.knownPreferences],
    actionNextAt: { ...bond.actionNextAt },
    actionReceipts: bond.actionReceipts.map((receipt) => ({ ...receipt })),
    lastSeenAt: bond.lastSeenAt,
  };
}

function ensureBond(social: PlayerSocial, npcId: string): NpcBond {
  if (!social.bonds[npcId]) social.bonds[npcId] = emptyBond();
  return social.bonds[npcId];
}

function bondOf(progression: PlayerProgression | undefined, npcId: string): NpcBond {
  const social = parsePlayerSocial(progression?.social, progression?.npcRelationships);
  return social.bonds[npcId] ?? emptyBond();
}

function axesFor(npcId: string): Set<SocialAxis> {
  const listed = documentState?.npcs[npcId]?.axes ?? documentState?.defaultAxes ?? ['familiarity'];
  return new Set(listed.filter(isAxis));
}

function axisValue(bond: NpcBond, axis: SocialAxis): number {
  return bond.axes[axis] ?? 0;
}

function clampAxis(axis: SocialAxis, value: number): number {
  return axis === 'familiarity' ? clamp(value, 0, 100) : clamp(value, -100, 100);
}

function stagesFor(npcId: string): StageDef[] {
  return documentState?.npcs[npcId]?.stages ?? documentState?.stages ?? [];
}

function currentStage(npcId: string, bond: NpcBond): StageDef {
  const axes = axesFor(npcId);
  for (const stage of stagesFor(npcId)) {
    if (stageMatches(stage, bond, axes)) return stage;
  }
  return { id: 'stranger', label: 'Stranger', rank: 0, when: {} };
}

function stageById(npcId: string, id: string): StageDef | undefined {
  return stagesFor(npcId).find((stage) => stage.id === id);
}

function stageMatches(stage: StageDef, bond: NpcBond, axes: Set<SocialAxis>): boolean {
  const when = stage.when ?? {};
  if (when.grudge === '*' && bond.grudges.length === 0) return false;
  if (when.grudge && when.grudge !== '*' && !bond.grudges.includes(when.grudge)) return false;
  if (when.affinityMax != null && (!axes.has('affinity') || axisValue(bond, 'affinity') > when.affinityMax)) return false;
  if (when.affinityMin != null && (!axes.has('affinity') || axisValue(bond, 'affinity') < when.affinityMin)) return false;
  if (when.trustMin != null && (!axes.has('trust') || axisValue(bond, 'trust') < when.trustMin)) return false;
  if (when.respectMin != null && (!axes.has('respect') || axisValue(bond, 'respect') < when.respectMin)) return false;
  if (when.fearMin != null && (!axes.has('fear') || axisValue(bond, 'fear') < when.fearMin)) return false;
  if (when.familiarityMin != null && axisValue(bond, 'familiarity') < when.familiarityMin) return false;
  if (when.familiarityMax != null && axisValue(bond, 'familiarity') > when.familiarityMax) return false;
  return true;
}

function upsertMemory(bond: NpcBond, draft: SocialMemoryDraft, now: number): void {
  const next: NpcMemory = {
    id: draft.id,
    kind: draft.kind,
    importance: draft.importance,
    at: now,
    expiresAt: draft.ttlHours != null ? now + draft.ttlHours * 60 * 60 * 1000 : undefined,
    visible: draft.visible,
    text: draft.text,
  };
  bond.memories = [next, ...bond.memories.filter((memory) => memory.id !== draft.id)]
    .sort((a, b) => b.importance - a.importance || b.at - a.at)
    .slice(0, MAX_MEMORIES);
}

function expireMemories(bond: NpcBond, now: number): void {
  bond.memories = bond.memories.filter((memory) => !memoryExpired(memory, now));
}

function memoryExpired(memory: NpcMemory, now = Date.now()): boolean {
  return memory.expiresAt != null && memory.expiresAt <= now;
}

function mirroredRelationships(progression: PlayerProgression, social: PlayerSocial, npcId: string): Record<string, number> {
  const familiarity = social.bonds[npcId]?.axes.familiarity;
  if (familiarity == null) return progression.npcRelationships;
  return { ...progression.npcRelationships, [npcId]: clamp(familiarity, 0, 100) };
}

function socialHasOnce(social: PlayerSocial, key: string): boolean {
  return Object.values(social.bonds).some((bond) => bond.onceEvents.includes(key));
}

function rememberScopeOnce(social: PlayerSocial, key: string): void {
  const holder = ensureBond(social, '__reputation__');
  if (!holder.onceEvents.includes(key)) holder.onceEvents = [...holder.onceEvents, key].slice(-MAX_ONCE);
}

function notableFamiliarity(before: number, after: number): string | undefined {
  if (before < 5 && after >= 5) return 'They are starting to know your face.';
  if (before < 15 && after >= 15) return 'You have become a familiar presence.';
  if (before < 28 && after >= 28) return 'They know you well.';
  return undefined;
}

function familiarityPhrase(value: number): string {
  if (value >= 28) return 'They know you well.';
  if (value >= 15) return 'You are a familiar presence.';
  if (value >= 5) return 'They know your face.';
  return 'They barely know your face.';
}

function affinityPhrase(value: number): string {
  if (value >= 24) return 'Their manner toward you is warm.';
  if (value >= 8) return 'They are kindly disposed.';
  if (value <= -40) return 'Their manner is hostile.';
  if (value <= -15) return 'Their manner is cold.';
  return 'Their feelings toward you are still plain.';
}

function trustPhrase(value: number): string {
  if (value >= 18) return 'They rely on your word.';
  if (value >= 8) return 'They are willing to trust you a little.';
  if (value <= -8) return 'They do not trust your word.';
  return 'Your word is still untested.';
}

function respectPhrase(value: number): string {
  if (value >= 12) return 'They respect how you conduct yourself.';
  if (value <= -8) return 'They think little of your conduct.';
  return 'They have not taken the measure of your conduct.';
}

function fearPhrase(value: number): string {
  if (value >= 20) return 'They treat you with caution.';
  if (value >= 8) return 'Something about you makes them careful.';
  return 'You do not frighten them.';
}

export {
  describeGiftWindow,
  listSocialOffers,
  resolveNpcGift,
  resolveSocialAction,
  runExclusiveSocialOp,
} from './interactions.js';
export type { GiftItemFacts, GiftResolution, GiftWindow, SocialActionResolution } from './interactions.js';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function isAxis(value: unknown): value is SocialAxis {
  return value === 'affinity' || value === 'trust' || value === 'respect' || value === 'fear' || value === 'familiarity';
}
