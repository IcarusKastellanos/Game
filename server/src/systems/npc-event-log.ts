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
  sinceMs?: number;
  provenance?: NpcSimEvent['provenance'];
} = {}): NpcSimEvent[] {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), MAX_EVENTS);
  let rows = events;
  if (filter.npcId) rows = rows.filter((row) => row.npcId === filter.npcId);
  if (filter.kind) rows = rows.filter((row) => row.kind === filter.kind);
  if (filter.sinceMs != null) rows = rows.filter((row) => row.at >= filter.sinceMs!);
  if (filter.provenance) rows = rows.filter((row) => row.provenance === filter.provenance);
  return rows.slice(-limit).reverse();
}

export interface NpcEventAggregate {
  sampleSize: number;
  sinceMs: number | null;
  byKind: Record<string, { ok: number; blocked: number }>;
  byNpc: Record<string, { ok: number; blocked: number; kinds: Record<string, number> }>;
  byProvenance: Record<string, number>;
  topBlockedReasons: { reason: string; count: number }[];
  /** Events per minute over the sampled window (0 if unknown). */
  ratePerMinute: number;
}

export function aggregateNpcEvents(filter: {
  npcId?: string;
  sinceMs?: number;
  provenance?: NpcSimEvent['provenance'];
} = {}): NpcEventAggregate {
  const rows = listNpcEvents({
    npcId: filter.npcId,
    sinceMs: filter.sinceMs,
    provenance: filter.provenance,
    limit: MAX_EVENTS,
  });
  const byKind: NpcEventAggregate['byKind'] = {};
  const byNpc: NpcEventAggregate['byNpc'] = {};
  const byProvenance: Record<string, number> = {};
  const reasonCounts = new Map<string, number>();
  let oldest = Number.POSITIVE_INFINITY;
  let newest = 0;
  for (const row of rows) {
    oldest = Math.min(oldest, row.at);
    newest = Math.max(newest, row.at);
    const kind = byKind[row.kind] ?? (byKind[row.kind] = { ok: 0, blocked: 0 });
    if (row.success) kind.ok += 1;
    else kind.blocked += 1;
    const npc = byNpc[row.npcId] ?? (byNpc[row.npcId] = { ok: 0, blocked: 0, kinds: {} });
    if (row.success) npc.ok += 1;
    else npc.blocked += 1;
    npc.kinds[row.kind] = (npc.kinds[row.kind] ?? 0) + 1;
    byProvenance[row.provenance] = (byProvenance[row.provenance] ?? 0) + 1;
    if (!row.success && row.reason) {
      reasonCounts.set(row.reason, (reasonCounts.get(row.reason) ?? 0) + 1);
    }
  }
  const spanMs = Number.isFinite(oldest) && newest > oldest ? newest - oldest : 0;
  const ratePerMinute = spanMs > 0 ? (rows.length / spanMs) * 60_000 : 0;
  const topBlockedReasons = [...reasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
  return {
    sampleSize: rows.length,
    sinceMs: filter.sinceMs ?? (Number.isFinite(oldest) ? oldest : null),
    byKind,
    byNpc,
    byProvenance,
    topBlockedReasons,
    ratePerMinute: Math.round(ratePerMinute * 100) / 100,
  };
}

export function clearNpcEventsForTests(): void {
  events.length = 0;
  seq = 0;
}
