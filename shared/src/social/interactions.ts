import type { InventorySlot, PlayerStats } from '../types/index.js';
import type { PlayerProgression } from '../progression/index.js';
import { EMPTY_INVENTORY_SLOT } from '../inventory/index.js';
import { personalityGiftAffinityScale } from '../npc/personality.js';
import {
  bondBlockReason,
  getSocialDocument,
  parsePlayerSocial,
  type GiftPreference,
  type GiftTierDef,
  type NpcBond,
  type SocialActionDef,
  type SocialAxis,
  type SocialEffect,
  type SocialReceipt,
} from './index.js';

export interface GiftItemFacts {
  itemId: string;
  name: string;
  category?: string;
  tags?: string[];
  rarity?: string;
  provenance?: string;
  adminOnly?: boolean;
}

export interface GiftWindowItem {
  slotIndex: number;
  itemId: string;
  name: string;
  quantity: number;
}

export interface GiftWindow {
  canGive: boolean;
  reason?: string;
  nextGiftAt?: number;
  knownPreferences: { line: string }[];
  items: GiftWindowItem[];
}

export type GiftResolution = {
  ok: boolean;
  duplicate: boolean;
  reason?: string;
  reaction?: string;
  tier?: string;
  preferenceId?: string;
  nextGiftAt?: number;
  progression: PlayerProgression;
  stats: PlayerStats;
  inventory: InventorySlot[];
};

export type SocialActionResolution = {
  ok: boolean;
  duplicate: boolean;
  reason?: string;
  reaction?: string;
  nextAt?: number;
  progression: PlayerProgression;
  stats: PlayerStats;
};

const inflight = new Set<string>();

/** One in-flight social operation per player and NPC. A second call sees the first result only after release. */
export function runExclusiveSocialOp<T>(key: string, fn: () => T): { busy: true } | { busy: false; value: T } {
  if (inflight.has(key)) return { busy: true };
  inflight.add(key);
  try {
    return { busy: false, value: fn() };
  } finally {
    inflight.delete(key);
  }
}

export function describeGiftWindow(
  progression: PlayerProgression | undefined,
  npcId: string,
  slots: { slotIndex: number; quantity: number; facts: GiftItemFacts }[],
  now: number
): GiftWindow {
  const doc = getSocialDocument();
  const profile = doc?.npcs[npcId];
  const known = knownLines(npcId, progression, now);
  if (!profile?.acceptsGifts) {
    return { canGive: false, reason: 'They are not taking gifts.', knownPreferences: known, items: [] };
  }
  const items = slots.filter((slot) => slot.quantity > 0 && giftEligibility(slot.facts) == null);
  const bond = bondFrom(progression, npcId);
  const nextGiftAt = bond.giftNextAt;
  if (nextGiftAt != null && nextGiftAt > now) {
    return {
      canGive: false,
      reason: 'A day should pass before another gift.',
      nextGiftAt,
      knownPreferences: known,
      items: items.map(windowItem),
    };
  }
  return { canGive: true, knownPreferences: known, items: items.map(windowItem) };
}

export function resolveNpcGift(
  progression: PlayerProgression,
  stats: PlayerStats,
  inventory: InventorySlot[],
  input: {
    npcId: string;
    slotIndex: number;
    itemId: string;
    facts: GiftItemFacts;
    operationId: string;
    now: number;
  }
): GiftResolution {
  const same = { progression, stats, inventory, duplicate: false as boolean };
  if (!validOperationId(input.operationId)) {
    return { ...same, ok: false, reason: 'The gift could not be recorded.' };
  }
  const social = parsePlayerSocial(progression.social, progression.npcRelationships);
  const bond = social.bonds[input.npcId] ?? freshBond();
  social.bonds[input.npcId] = bond;
  const prior = bond.giftReceipts.find((receipt) => receipt.operationId === input.operationId);
  if (prior) {
    return {
      ok: prior.ok,
      duplicate: true,
      reason: prior.ok ? undefined : prior.reaction,
      reaction: prior.ok ? prior.reaction : undefined,
      tier: prior.tier,
      nextGiftAt: bond.giftNextAt,
      progression,
      stats,
      inventory,
    };
  }

  const doc = getSocialDocument();
  const profile = doc?.npcs[input.npcId];
  const policy = doc?.giftPolicy;
  if (!profile?.acceptsGifts || !policy) {
    return { ...same, ok: false, reason: 'They are not taking gifts.' };
  }
  if (input.facts.itemId !== input.itemId) {
    return { ...same, ok: false, reason: 'That item is not in your hands.' };
  }
  const slot = inventory[input.slotIndex];
  if (!slot || slot.itemId !== input.itemId || slot.quantity < 1) {
    return { ...same, ok: false, reason: 'That item is not in your hands.' };
  }
  const ineligible = giftEligibility(input.facts);
  if (ineligible) {
    if (policy.refusedConsumesCooldown) bond.giftNextAt = input.now + cooldownMs(policy.cooldownHours);
    const reaction = ineligible;
    rememberReceipt(bond, {
      operationId: input.operationId,
      at: input.now,
      ok: false,
      reaction,
      itemId: input.itemId,
    });
    if (!policy.refusedConsumesCooldown) {
      return { ...same, ok: false, reason: reaction };
    }
    return {
      ok: false,
      duplicate: false,
      reason: reaction,
      nextGiftAt: bond.giftNextAt,
      progression: commit(progression, social, input.npcId),
      stats,
      inventory,
    };
  }
  if (bond.giftNextAt != null && bond.giftNextAt > input.now) {
    return { ...same, ok: false, reason: 'A day should pass before another gift.', nextGiftAt: bond.giftNextAt };
  }

  const matched = matchPreference(profile.giftPreferences ?? [], input.facts, progression);
  const tierId = matched?.tier ?? policy.defaultTier;
  const tier = doc?.giftTiers?.[tierId];
  const priorCount = bond.giftCounts[input.itemId] ?? 0;
  const scale = repeatScale(priorCount, policy.repeatDecay, policy.maxCountedRepeats);
  applyGiftAxes(bond, input.npcId, tier, matched?.preference, scale, policy, priorCount);
  if (scale === 0 && (tier?.axes?.affinity ?? 0) >= 0 && tracks(input.npcId, 'familiarity')) {
    bond.axes.familiarity = clampAxis('familiarity', (bond.axes.familiarity ?? 0) + 1);
  }
  const reaction = reactionLine(tier, input.facts.name, priorCount);
  if (priorCount === 0 && tier?.memory && (tierId === 'favorite' || tierId === 'loved' || tierId === 'hated')) {
    upsertMemory(bond, {
      id: tierId === 'hated' ? `gift_hated:${matched?.preference.id ?? input.itemId}` : 'gift',
      kind: tier.memory.kind,
      importance: tier.memory.importance,
      text: tier.memory.text,
      visible: tier.memory.visible,
      at: input.now,
    });
  }
  if (matched?.preference && !bond.knownPreferences.includes(matched.preference.id)) {
    bond.knownPreferences = [...bond.knownPreferences, matched.preference.id].slice(-32);
  }
  bond.giftCounts[input.itemId] = priorCount + 1;
  bond.giftNextAt = input.now + cooldownMs(policy.cooldownHours);
  rememberReceipt(bond, {
    operationId: input.operationId,
    at: input.now,
    ok: true,
    reaction,
    itemId: input.itemId,
    tier: tierId,
  });
  const nextInventory = inventory.map((entry, index) => {
    if (index !== input.slotIndex) return entry;
    if (entry.quantity <= 1) return { ...EMPTY_INVENTORY_SLOT };
    return { ...entry, quantity: entry.quantity - 1 };
  });
  return {
    ok: true,
    duplicate: false,
    reaction,
    tier: tierId,
    ...(matched?.preference ? { preferenceId: matched.preference.id } : {}),
    nextGiftAt: bond.giftNextAt,
    progression: commit(progression, social, input.npcId),
    stats,
    inventory: nextInventory,
  };
}

export function listSocialOffers(
  npcId: string,
  progression: PlayerProgression | undefined,
  now = Date.now()
): { id: string; label: string; available?: boolean; requirement?: string; cooldownUntil?: number }[] {
  const doc = getSocialDocument();
  if (!doc?.actions?.length) return [];
  const allowed = new Set(doc.npcs[npcId]?.actionIds ?? doc.defaultActionIds ?? ['greet']);
  const offers: { id: string; label: string; available?: boolean; requirement?: string; cooldownUntil?: number }[] = [];
  for (const action of doc.actions) {
    if (!allowed.has(action.id)) continue;
    if (action.activityId && !(doc.supportedActivities ?? []).includes(action.activityId)) continue;
    const gate = actionAvailable(action, npcId, progression, now);
    if (!gate.ok) {
      // Keep gated gestures out of the menu until prerequisites are met.
      if (gate.hide) continue;
      offers.push({
        id: `social:${action.id}`,
        label: action.label,
        available: false,
        requirement: gate.reason ?? 'They are not open to that just now.',
      });
      continue;
    }
    const bond = bondFrom(progression, npcId);
    const nextAt = bond.actionNextAt[action.id];
    if (nextAt != null && nextAt > now) {
      offers.push({
        id: `social:${action.id}`,
        label: action.label,
        available: false,
        requirement: waitPhrase(nextAt, now),
        cooldownUntil: nextAt,
      });
      continue;
    }
    offers.push({ id: `social:${action.id}`, label: action.label, available: true });
  }
  return offers;
}

export function resolveSocialAction(
  progression: PlayerProgression,
  stats: PlayerStats,
  input: { npcId: string; actionId: string; operationId: string; now: number }
): SocialActionResolution {
  const same = { progression, stats, duplicate: false as boolean };
  const actionKey = input.actionId.startsWith('social:') ? input.actionId.slice('social:'.length) : input.actionId;
  if (!validOperationId(input.operationId)) {
    return { ...same, ok: false, reason: 'The gesture could not be recorded.' };
  }
  const doc = getSocialDocument();
  const action = doc?.actions?.find((entry) => entry.id === actionKey);
  const social = parsePlayerSocial(progression.social, progression.npcRelationships);
  const bond = social.bonds[input.npcId] ?? freshBond();
  social.bonds[input.npcId] = bond;
  const prior = bond.actionReceipts.find((receipt) => receipt.operationId === input.operationId);
  if (prior) {
    return {
      ok: prior.ok,
      duplicate: true,
      reason: prior.ok ? undefined : prior.reaction,
      reaction: prior.ok ? prior.reaction : undefined,
      nextAt: bond.actionNextAt[actionKey],
      progression,
      stats,
    };
  }
  const gate = action ? actionAvailable(action, input.npcId, progression, input.now) : { ok: false as const };
  if (!action || !gate.ok) {
    return { ...same, ok: false, reason: ('reason' in gate && gate.reason) || 'They are not open to that just now.' };
  }
  const nextAt = bond.actionNextAt[actionKey];
  if (nextAt != null && nextAt > input.now) {
    return { ...same, ok: false, reason: waitPhrase(nextAt, input.now), nextAt };
  }
  const suppressed = action.suppressEffectsWhenGrudge && bond.grudges.includes(action.suppressEffectsWhenGrudge);
  if (!suppressed) applyActionEffects(bond, input.npcId, action.effects ?? [], input.now);
  const reaction = suppressed && action.grudgeFeedback ? action.grudgeFeedback : action.feedback;
  bond.actionNextAt[actionKey] = input.now + cooldownMs(action.cooldownHours);
  rememberAction(bond, {
    operationId: input.operationId,
    at: input.now,
    ok: true,
    reaction,
    actionId: actionKey,
  });
  return {
    ok: true,
    duplicate: false,
    reaction,
    nextAt: bond.actionNextAt[actionKey],
    progression: commit(progression, social, input.npcId),
    stats,
  };
}

function windowItem(slot: { slotIndex: number; quantity: number; facts: GiftItemFacts }): GiftWindowItem {
  return { slotIndex: slot.slotIndex, itemId: slot.facts.itemId, name: slot.facts.name, quantity: slot.quantity };
}

function knownLines(
  npcId: string,
  progression: PlayerProgression | undefined,
  now: number
): { line: string }[] {
  const profile = getSocialDocument()?.npcs[npcId];
  const bond = bondFrom(progression, npcId);
  const lines: { line: string }[] = [];
  for (const pref of profile?.giftPreferences ?? []) {
    if (pref.visibility === 'public' && pref.publicLine) lines.push({ line: pref.publicLine });
    else if (pref.visibility === 'hinted' && pref.hint) lines.push({ line: pref.hint });
    else if (pref.visibility === 'hidden' && bond.knownPreferences.includes(pref.id) && pref.discoveredLine) {
      lines.push({ line: pref.discoveredLine });
    }
  }
  void now;
  return lines;
}

function giftEligibility(facts: GiftItemFacts): string | null {
  const policy = getSocialDocument()?.giftPolicy;
  if (!policy) return 'They are not taking gifts.';
  if (facts.adminOnly) return 'They will not take that.';
  if (facts.category && policy.deniedCategories.includes(facts.category)) return 'They will not take that.';
  if (policy.deniedItemIds.includes(facts.itemId)) return 'They will not take that.';
  return null;
}

function matchPreference(
  preferences: GiftPreference[],
  facts: GiftItemFacts,
  progression: PlayerProgression
): { preference: GiftPreference; tier: string } | null {
  let best: { preference: GiftPreference; tier: string; score: number } | null = null;
  for (const preference of preferences) {
    if (!matches(preference.match, facts)) continue;
    let tier = preference.tier;
    if (preference.requiresQuest && !questComplete(progression, preference.requiresQuest)) {
      if (!preference.elseTier) continue;
      tier = preference.elseTier;
    }
    const score = specificity(preference.match);
    if (!best || score > best.score) best = { preference, tier, score };
  }
  return best ? { preference: best.preference, tier: best.tier } : null;
}

function matches(match: GiftPreference['match'], facts: GiftItemFacts): boolean {
  if (!match) return false;
  const checks: boolean[] = [];
  if (match.itemIds?.length) checks.push(match.itemIds.includes(facts.itemId));
  if (match.categories?.length) checks.push(!!facts.category && match.categories.includes(facts.category));
  if (match.rarities?.length) checks.push(!!facts.rarity && match.rarities.includes(facts.rarity));
  if (match.provenance?.length) checks.push(!!facts.provenance && match.provenance.includes(facts.provenance));
  if (match.tags?.length) checks.push((facts.tags ?? []).some((tag) => match.tags?.includes(tag)));
  return checks.length > 0 && checks.every(Boolean);
}

function specificity(match: GiftPreference['match']): number {
  let score = 0;
  if (match.itemIds?.length) score += 8;
  if (match.provenance?.length) score += 4;
  if (match.tags?.length) score += 2;
  if (match.categories?.length) score += 1;
  if (match.rarities?.length) score += 1;
  return score;
}

function applyGiftAxes(
  bond: NpcBond,
  npcId: string,
  tier: GiftTierDef | undefined,
  preference: GiftPreference | undefined,
  scale: number,
  policy: NonNullable<ReturnType<typeof getSocialDocument>>['giftPolicy'],
  priorCount: number
): void {
  if (!policy) return;
  const combined: Partial<Record<SocialAxis, number>> = { ...(tier?.axes ?? {}) };
  for (const [axis, amount] of Object.entries(preference?.extraAxes ?? {})) {
    if (!isAxis(axis) || typeof amount !== 'number') continue;
    combined[axis] = (combined[axis] ?? 0) + amount;
  }
  const profile = getSocialDocument()?.npcs[npcId];
  const personality =
    profile?.giftPersonality?.affinityScale ??
    (profile?.personality ? personalityGiftAffinityScale(profile.personality) : 1);
  for (const axis of ['affinity', 'trust', 'respect', 'fear', 'familiarity'] as SocialAxis[]) {
    const base = combined[axis];
    if (base == null || !tracks(npcId, axis)) continue;
    let amount = base;
    if (axis === 'affinity' && amount < 0) amount = Math.max(amount, policy.negativeAffinityCap);
    amount = Math.round(amount * scale);
    if (axis === 'affinity' && amount > 0) {
      amount = Math.round(amount * personality);
      if ((bond.axes.affinity ?? 0) <= policy.coldAffinity) amount = Math.round(amount * policy.coldScale);
    }
    if (!amount) continue;
    bond.axes[axis] = clampAxis(axis, (bond.axes[axis] ?? 0) + amount);
  }
  void priorCount;
}

function repeatScale(prior: number, decay: number, maxRepeats: number): number {
  if (prior <= 0) return 1;
  if (prior >= maxRepeats) return 0;
  return Math.pow(decay, prior);
}

function reactionLine(tier: GiftTierDef | undefined, itemName: string, priorCount: number): string {
  const base = (tier?.reaction ?? 'They accept {item}.').replaceAll('{item}', itemName);
  if (priorCount <= 0) return base;
  return `${base} They have received this from you before.`;
}

function actionAvailable(
  action: SocialActionDef,
  npcId: string,
  progression: PlayerProgression | undefined,
  now: number
): { ok: true } | { ok: false; reason?: string; hide?: boolean } {
  if (action.requires) {
    const reason = bondBlockReason(progression, npcId, action.requires);
    if (reason) return { ok: false, reason, hide: true };
  }
  if (action.requiresQuest && !questComplete(progression, action.requiresQuest)) {
    return { ok: false, reason: 'That is not open to you yet.', hide: true };
  }
  const bond = bondFrom(progression, npcId);
  const memories = bond.memories.filter((memory) => memory.expiresAt == null || memory.expiresAt > now);
  if (action.requiresAnyMemory?.length || action.requiresMemoryPrefix) {
    const hit =
      memories.some((memory) => action.requiresAnyMemory?.includes(memory.id)) ||
      memories.some((memory) => action.requiresMemoryPrefix && memory.id.startsWith(action.requiresMemoryPrefix));
    if (!hit) return { ok: false, reason: 'They have no reason for that yet.', hide: true };
  }
  return { ok: true };
}

function applyActionEffects(bond: NpcBond, npcId: string, effects: SocialEffect[], now: number): void {
  for (const effect of effects) {
    if (effect.target === 'axis' && effect.axis && tracks(npcId, effect.axis)) {
      const amount = Math.round(effect.amount ?? 0);
      if (!amount) continue;
      bond.axes[effect.axis] = clampAxis(effect.axis, (bond.axes[effect.axis] ?? 0) + amount);
    } else if (effect.target === 'memory' && effect.memory) {
      upsertMemory(bond, { ...effect.memory, at: now });
    } else if (effect.target === 'grudge' && effect.grudge && !bond.grudges.includes(effect.grudge)) {
      bond.grudges.push(effect.grudge);
    } else if (effect.target === 'clearGrudge' && effect.grudge) {
      bond.grudges = bond.grudges.filter((id) => id !== effect.grudge);
    }
  }
}

function upsertMemory(
  bond: NpcBond,
  draft: { id: string; kind: string; importance: number; text: string; visible: boolean; at: number; ttlHours?: number }
): void {
  const next = {
    id: draft.id,
    kind: draft.kind,
    importance: draft.importance,
    at: draft.at,
    expiresAt: draft.ttlHours != null ? draft.at + draft.ttlHours * 60 * 60 * 1000 : undefined,
    visible: draft.visible,
    text: draft.text,
  };
  bond.memories = [next, ...bond.memories.filter((memory) => memory.id !== draft.id)]
    .sort((a, b) => b.importance - a.importance || b.at - a.at)
    .slice(0, 24);
}

function rememberReceipt(bond: NpcBond, receipt: SocialReceipt): void {
  bond.giftReceipts = [...bond.giftReceipts, receipt].slice(-12);
}

function rememberAction(bond: NpcBond, receipt: SocialReceipt): void {
  bond.actionReceipts = [...bond.actionReceipts, receipt].slice(-12);
}

function commit(progression: PlayerProgression, social: PlayerProgression['social'], npcId: string): PlayerProgression {
  const familiarity = social?.bonds[npcId]?.axes.familiarity;
  const npcRelationships =
    familiarity == null ? progression.npcRelationships : { ...progression.npcRelationships, [npcId]: clamp(familiarity, 0, 100) };
  return { ...progression, social, npcRelationships };
}

function bondFrom(progression: PlayerProgression | undefined, npcId: string): NpcBond {
  return parsePlayerSocial(progression?.social, progression?.npcRelationships).bonds[npcId] ?? freshBond();
}

function freshBond(): NpcBond {
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

function tracks(npcId: string, axis: SocialAxis): boolean {
  const doc = getSocialDocument();
  const listed = doc?.npcs[npcId]?.axes ?? doc?.defaultAxes ?? ['familiarity'];
  return listed.includes(axis);
}

function questComplete(progression: PlayerProgression | undefined, questId: string): boolean {
  return !!progression?.questProgress?.[questId]?.completedAt;
}

function cooldownMs(hours: number): number {
  return Math.round(hours * 60 * 60 * 1000);
}

function waitPhrase(nextAt: number, now: number): string {
  const hours = Math.max(1, Math.ceil((nextAt - now) / 3600000));
  if (hours <= 1) return 'They can hear that again within the hour.';
  if (hours < 24) return `They can hear that again in about ${hours} hours.`;
  const days = Math.ceil(hours / 24);
  if (days === 1) return 'They can hear that again tomorrow.';
  return `They can hear that again in about ${days} days.`;
}

function validOperationId(id: string): boolean {
  return typeof id === 'string' && /^[\w:.-]{8,80}$/.test(id);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampAxis(axis: SocialAxis, value: number): number {
  return axis === 'familiarity' ? clamp(value, 0, 100) : clamp(value, -100, 100);
}

function isAxis(value: string): value is SocialAxis {
  return value === 'affinity' || value === 'trust' || value === 'respect' || value === 'fear' || value === 'familiarity';
}
