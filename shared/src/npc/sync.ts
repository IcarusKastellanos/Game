/**
 * NPC / progression sync helpers.
 *
 * Ownership:
 * - World presence (`world_state`): server world clock + schedule resolver. Shared by all players
 *   in the room. Never includes bonds, gifts, or discoveries.
 * - Player progression (`progression_update`): per-player. Includes social bonds, discoveries,
 *   dialogue state, quest progress, grimoire People. Private to that session.
 * - Encounter open_ui: ephemeral, per-player, rebuilt from authoritative progression each open.
 *
 * Lifecycle:
 * - Persistent: bonds, discoveries, dialogue unlocks, gift/action cooldowns, quest associations,
 *   grimoire People fields, completed lessons.
 * - Transient: open UI panels, in-flight social operation locks, conversation locks.
 * - Derived: encounter options, People dossier patches, demeanor signals.
 *
 * Recovery: on reconnect / presence_ready the server re-sends world_state + progression_update
 * with monotonically increasing sequence numbers. Clients ignore older sequences.
 */

export interface SequencedPayload {
  seq: number;
  at: number;
}

export interface ProgressionSyncPayload extends SequencedPayload {
  progression: unknown;
}

export interface WorldStateSyncPayload extends SequencedPayload {
  hour: number;
  weekday?: number;
  hourLabel?: string;
  hiddenNpcIds?: string[];
  npcPresences?: unknown[];
}

/** Returns true when incoming should replace current (missing local, or newer seq). */
export function shouldApplySeq(current: number | undefined, incoming: number | undefined): boolean {
  if (incoming == null || !Number.isFinite(incoming)) return true;
  if (current == null || !Number.isFinite(current)) return true;
  return incoming >= current;
}

export function nextSeq(current: number | undefined): number {
  const base = current != null && Number.isFinite(current) ? current : 0;
  return base + 1;
}
