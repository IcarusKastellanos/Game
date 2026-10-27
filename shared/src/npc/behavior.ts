/** NPC behavior states and multiplayer conversation policy. */

import type { NpcScheduleEntry, NpcScheduleOverride } from '../types/index.js';

export type NpcBehaviorState =
  | 'idle'
  | 'working'
  | 'traveling'
  | 'socializing'
  | 'busy'
  | 'resting'
  | 'investigating'
  | 'emergency'
  | 'in_conversation';

export type ConversationPolicy = 'concurrent_personal' | 'exclusive' | 'shared_public';

export interface NpcConversationLock {
  npcId: string;
  playerId: string;
  sessionId: string;
  startedAt: number;
  expiresAt: number;
  policy: ConversationPolicy;
}

const DEFAULT_LOCK_MS = 120_000;

export function behaviorFromSchedule(
  interaction: NpcScheduleEntry['interaction'] | NpcScheduleOverride['interaction'] | undefined,
  movement?: NpcScheduleEntry['movement']
): NpcBehaviorState {
  if (interaction === 'away') return 'resting';
  if (interaction === 'busy') return movement === 'pace' ? 'traveling' : 'busy';
  if (movement === 'pace') return 'traveling';
  return 'working';
}

export function canStartConversation(
  behavior: NpcBehaviorState,
  policy: ConversationPolicy,
  locks: readonly NpcConversationLock[],
  npcId: string,
  playerId: string,
  now = Date.now()
): { ok: true } | { ok: false; reason: string } {
  if (behavior === 'resting' || behavior === 'emergency') {
    return { ok: false, reason: 'They are not available to talk right now.' };
  }
  if (behavior === 'busy' || behavior === 'traveling') {
    return { ok: false, reason: 'They are occupied.' };
  }
  const active = locks.filter((lock) => lock.npcId === npcId && lock.expiresAt > now);
  if (policy === 'concurrent_personal') return { ok: true };
  if (policy === 'shared_public') return { ok: true };
  const other = active.find((lock) => lock.playerId !== playerId);
  if (other) {
    return { ok: false, reason: 'Someone else is speaking with them.' };
  }
  return { ok: true };
}

export function acquireConversationLock(input: {
  locks: NpcConversationLock[];
  npcId: string;
  playerId: string;
  sessionId: string;
  policy: ConversationPolicy;
  now?: number;
  ttlMs?: number;
}): { locks: NpcConversationLock[]; acquired: boolean; reason?: string } {
  const now = input.now ?? Date.now();
  const ttl = input.ttlMs ?? DEFAULT_LOCK_MS;
  const cleaned = input.locks.filter((lock) => lock.expiresAt > now);
  if (input.policy === 'exclusive') {
    const other = cleaned.find((lock) => lock.npcId === input.npcId && lock.playerId !== input.playerId);
    if (other) {
      return { locks: cleaned, acquired: false, reason: 'Someone else is speaking with them.' };
    }
  }
  const next: NpcConversationLock = {
    npcId: input.npcId,
    playerId: input.playerId,
    sessionId: input.sessionId,
    startedAt: now,
    expiresAt: now + ttl,
    policy: input.policy,
  };
  const withoutSelf = cleaned.filter(
    (lock) => !(lock.npcId === input.npcId && lock.playerId === input.playerId)
  );
  return { locks: [...withoutSelf, next], acquired: true };
}

export function releaseConversationLock(
  locks: readonly NpcConversationLock[],
  npcId: string,
  playerId: string,
  now = Date.now()
): NpcConversationLock[] {
  return locks.filter(
    (lock) => lock.expiresAt > now && !(lock.npcId === npcId && lock.playerId === playerId)
  );
}

export function refreshConversationLock(
  locks: readonly NpcConversationLock[],
  npcId: string,
  playerId: string,
  now = Date.now(),
  ttlMs = DEFAULT_LOCK_MS
): NpcConversationLock[] {
  return locks.map((lock) => {
    if (lock.npcId === npcId && lock.playerId === playerId && lock.expiresAt > now) {
      return { ...lock, expiresAt: now + ttlMs };
    }
    return lock;
  });
}

export function parseConversationPolicy(raw: unknown): ConversationPolicy {
  if (raw === 'exclusive' || raw === 'shared_public' || raw === 'concurrent_personal') return raw;
  return 'concurrent_personal';
}
