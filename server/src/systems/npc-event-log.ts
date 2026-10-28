/**
 * Lightweight NPC simulation analytics — ring buffer + console.
 * Read-only for designers; never mutates gameplay. No affinity numbers or private prefs.
 */

export type NpcEventKind =
  | 'talk_open'
  | 'talk_blocked'
  | 'dialogue_choice'
  | 'gift'
  | 'social'
  | 'discovery'
  | 'quest_signal'
  | 'lock_release'
  | 'diagnose';

export interface NpcSimEvent {
  id: string;
  at: number;
  kind: NpcEventKind;
  npcId: string;
  playerId?: string;
  sessionId?: string;
  success: boolean;
  reason?: string;
  /** Non-sensitive tags only (action id, offer kind, etc.). */
  meta?: Record<string, string | number | boolean | undefined>;
  /** observed | synthetic — designer tests vs live play. */
  provenance: 'observed' | 'synthetic' | 'admin';
  version: 1;
}

const MAX_EVENTS = 500;
const events: NpcSimEvent[] = [];
let seq = 0;

export function recordNpcEvent(
  entry: Omit<NpcSimEvent, 'id' | 'at' | 'version'> & { at?: number }
): NpcSimEvent {
  seq += 1;
  const event: NpcSimEvent = {
    id: `npc_evt_${seq}`,
    at: entry.at ?? Date.now(),
    kind: entry.kind,
    npcId: entry.npcId,
    playerId: entry.playerId,
    sessionId: entry.sessionId,
    success: entry.success,
    reason: entry.reason,
    meta: entry.meta,
    provenance: entry.provenance,
    version: 1,
  };
  events.push(event);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);

  const status = entry.success ? 'ok' : 'blocked';
  const who = entry.playerId ? ` player=${entry.playerId}` : '';
  const why = entry.reason ? ` — ${entry.reason}` : '';
  console.log(`[NpcSim] ${entry.kind} ${status} npc=${entry.npcId}${who}${why}`);
  return event;
}

export function listNpcEvents(filter: {
  npcId?: string;
  kind?: NpcEventKind;
  limit?: number;
} = {}): NpcSimEvent[] {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), MAX_EVENTS);
  let rows = events;
  if (filter.npcId) rows = rows.filter((row) => row.npcId === filter.npcId);
  if (filter.kind) rows = rows.filter((row) => row.kind === filter.kind);
  return rows.slice(-limit).reverse();
}

export function clearNpcEventsForTests(): void {
  events.length = 0;
  seq = 0;
}
