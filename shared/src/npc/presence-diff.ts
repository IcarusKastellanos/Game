/** Diff helpers for NPC world presence replication. */

import type { NpcPublicPresence } from './schedule.js';

export type WorldStateMode = 'full' | 'diff';

export interface NpcPresenceDiff {
  mode: WorldStateMode;
  changedNpcIds: string[];
  removedNpcIds: string[];
  /** When mode=diff, only changed (and still-present) rows. When full, complete set. */
  npcPresences: NpcPublicPresence[];
}

export function presenceKey(presence: NpcPublicPresence): string {
  return [
    presence.npcId,
    presence.scene,
    presence.location,
    presence.activity ?? '',
    presence.interaction,
    presence.visible,
    presence.indoors,
    presence.held,
    presence.moving,
    presence.moveStart ?? '',
    presence.moveEnd ?? '',
    presence.from ? `${presence.from.x},${presence.from.y}` : '',
    presence.to ? `${presence.to.x},${presence.to.y}` : '',
    presence.interactableId ?? '',
    presence.dialogueNodeId ?? '',
    presence.notice ?? '',
    presence.tile ? `${presence.tile.x},${presence.tile.y}` : '',
    presence.facing ?? '',
  ].join('|');
}

export function diffNpcPresences(
  previous: readonly NpcPublicPresence[] | undefined,
  next: readonly NpcPublicPresence[],
  opts?: { forceFull?: boolean; maxDiffFraction?: number }
): NpcPresenceDiff {
  if (opts?.forceFull || !previous?.length) {
    return {
      mode: 'full',
      changedNpcIds: next.map((row) => row.npcId),
      removedNpcIds: [],
      npcPresences: [...next],
    };
  }
  const prevMap = new Map(previous.map((row) => [row.npcId, row]));
  const nextMap = new Map(next.map((row) => [row.npcId, row]));
  const changed: NpcPublicPresence[] = [];
  const changedNpcIds: string[] = [];
  for (const row of next) {
    const prior = prevMap.get(row.npcId);
    if (!prior || presenceKey(prior) !== presenceKey(row)) {
      changed.push(row);
      changedNpcIds.push(row.npcId);
    }
  }
  const removedNpcIds: string[] = [];
  for (const id of prevMap.keys()) {
    if (!nextMap.has(id)) removedNpcIds.push(id);
  }
  const touched = changedNpcIds.length + removedNpcIds.length;
  const maxFraction = opts?.maxDiffFraction ?? 0.45;
  if (touched === 0) {
    return { mode: 'diff', changedNpcIds: [], removedNpcIds: [], npcPresences: [] };
  }
  if (touched / Math.max(next.length, 1) > maxFraction) {
    return {
      mode: 'full',
      changedNpcIds: next.map((row) => row.npcId),
      removedNpcIds: [],
      npcPresences: [...next],
    };
  }
  return { mode: 'diff', changedNpcIds, removedNpcIds, npcPresences: changed };
}

/** Apply a presence diff onto the client's last snapshot. */
export function applyNpcPresenceDiff(
  current: readonly NpcPublicPresence[],
  diff: NpcPresenceDiff
): NpcPublicPresence[] {
  if (diff.mode === 'full') return [...diff.npcPresences];
  const byId = new Map(current.map((row) => [row.npcId, row]));
  for (const id of diff.removedNpcIds) byId.delete(id);
  for (const row of diff.npcPresences) byId.set(row.npcId, row);
  return [...byId.values()].sort((a, b) => a.npcId.localeCompare(b.npcId));
}
