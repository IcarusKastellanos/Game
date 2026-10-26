import type { PlayerStats } from '../types/index.js';
import { toFiniteNumber } from '../constants/index.js';

/** Dual reputation tracks (−100…100). `reputation` remains a legacy alias of public. */
export type ReputationTrack = 'public' | 'spiritual';

export interface ReputationSourceDef {
  id: string;
  label: string;
  delta: number;
  tags?: string[];
}

export interface ReputationTrackConfig {
  track: ReputationTrack;
  range: { min: number; max: number };
  decay?: { perGameDay?: number; toward?: number };
  shopPrice?: { base: number; perPoint: number; min: number; max: number };
  dialogue?: Record<string, number>;
  gates?: Record<string, number>;
  npcFactionWeights?: Record<string, number>;
  sources: ReputationSourceDef[];
}

const DEFAULT_RANGE = { min: -100, max: 100 } as const;

const DEFAULT_PUBLIC: ReputationTrackConfig = {
  track: 'public',
  range: { ...DEFAULT_RANGE },
  shopPrice: { base: 1, perPoint: -0.003, min: 0.82, max: 1.25 },
  dialogue: { hostileBelow: -40, warmAbove: 35, refuseTradeBelow: -70 },
  npcFactionWeights: {},
  sources: [],
};

const DEFAULT_SPIRITUAL: ReputationTrackConfig = {
  track: 'spiritual',
  range: { ...DEFAULT_RANGE },
  dialogue: { coldShoulderBelow: -25, innerCircleAbove: 40 },
  gates: {
    mentorAccessAbove: 15,
    rareVendorAbove: 25,
    advancedRitualAbove: 40,
    templeEntryAbove: 50,
  },
  npcFactionWeights: {},
  sources: [],
};

let publicConfig: ReputationTrackConfig = { ...DEFAULT_PUBLIC, sources: [] };
let spiritualConfig: ReputationTrackConfig = { ...DEFAULT_SPIRITUAL, sources: [] };

function clampRep(value: number, range: { min: number; max: number } = DEFAULT_RANGE): number {
  return Math.max(range.min, Math.min(range.max, value));
}

function parseSource(raw: unknown): ReputationSourceDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id : null;
  const delta = toFiniteNumber(row.delta);
  if (!id || delta == null) return null;
  return {
    id,
    label: typeof row.label === 'string' ? row.label : id,
    delta,
    tags: Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === 'string') : [],
  };
}

function parseTrackConfig(raw: unknown, fallback: ReputationTrackConfig): ReputationTrackConfig {
  if (!raw || typeof raw !== 'object') return { ...fallback, sources: [...fallback.sources] };
  const o = raw as Record<string, unknown>;
  const rangeRaw = o.range as { min?: unknown; max?: unknown } | undefined;
  const min = toFiniteNumber(rangeRaw?.min) ?? fallback.range.min;
  const max = toFiniteNumber(rangeRaw?.max) ?? fallback.range.max;
  const sources: ReputationSourceDef[] = Array.isArray(o.sources)
    ? o.sources.map(parseSource).filter((s): s is ReputationSourceDef => s != null)
    : [...fallback.sources];

  return {
    track: fallback.track,
    range: { min, max },
    decay: (o.decay as ReputationTrackConfig['decay']) ?? fallback.decay,
    shopPrice: (o.shopPrice as ReputationTrackConfig['shopPrice']) ?? fallback.shopPrice,
    dialogue: (o.dialogue as Record<string, number>) ?? fallback.dialogue,
    gates: (o.gates as Record<string, number>) ?? fallback.gates,
    npcFactionWeights:
      (o.npcFactionWeights as Record<string, number>) ?? fallback.npcFactionWeights ?? {},
    sources,
  };
}

export function setReputationContent(partial: {
  publicJson?: unknown;
  spiritualJson?: unknown;
}): void {
  if (partial.publicJson !== undefined) {
    publicConfig = parseTrackConfig(partial.publicJson, DEFAULT_PUBLIC);
  }
  if (partial.spiritualJson !== undefined) {
    spiritualConfig = parseTrackConfig(partial.spiritualJson, DEFAULT_SPIRITUAL);
  }
}

export function getPublicReputationConfig(): ReputationTrackConfig {
  return publicConfig;
}

export function getSpiritualReputationConfig(): ReputationTrackConfig {
  return spiritualConfig;
}

export function getReputationConfig(track: ReputationTrack): ReputationTrackConfig {
  return track === 'public' ? publicConfig : spiritualConfig;
}

/** Canonical public reputation — falls back to legacy `reputation`. */
export function getPublicReputation(stats: PlayerStats): number {
  const explicit = toFiniteNumber(stats.publicReputation);
  if (explicit != null) return clampRep(explicit, publicConfig.range);
  return clampRep(stats.reputation ?? 0, publicConfig.range);
}

export function getSpiritualReputation(stats: PlayerStats): number {
  const explicit = toFiniteNumber(stats.spiritualReputation);
  if (explicit != null) return clampRep(explicit, spiritualConfig.range);
  return clampRep(0, spiritualConfig.range);
}

export function getReputation(stats: PlayerStats, track: ReputationTrack): number {
  return track === 'public' ? getPublicReputation(stats) : getSpiritualReputation(stats);
}

/**
 * Apply a reputation delta. Always keeps legacy `reputation` synced to public
 * so DB column writes and old UI keep working.
 */
export function applyReputationDelta(
  stats: PlayerStats,
  track: ReputationTrack,
  delta: number
): PlayerStats {
  const cfg = getReputationConfig(track);
  if (track === 'public') {
    const next = clampRep(getPublicReputation(stats) + delta, cfg.range);
    return {
      ...stats,
      publicReputation: next,
      reputation: next,
    };
  }
  const next = clampRep(getSpiritualReputation(stats) + delta, cfg.range);
  return {
    ...stats,
    spiritualReputation: next,
  };
}

/** Look up a content source and apply its delta (optionally scaled by NPC faction weight). */
export function applyReputationSource(
  stats: PlayerStats,
  track: ReputationTrack,
  sourceId: string,
  opts: { npcId?: string; scale?: number } = {}
): { stats: PlayerStats; applied: number; source: ReputationSourceDef | null } {
  const cfg = getReputationConfig(track);
  const source = cfg.sources.find((s) => s.id === sourceId) ?? null;
  if (!source) return { stats, applied: 0, source: null };
  let scale = opts.scale ?? 1;
  if (opts.npcId && cfg.npcFactionWeights?.[opts.npcId] != null) {
    scale *= cfg.npcFactionWeights[opts.npcId]!;
  }
  const applied = source.delta * scale;
  return {
    stats: applyReputationDelta(stats, track, applied),
    applied,
    source,
  };
}

/** Shop list price multiplier from public reputation. */
export function shopPriceMultiplier(stats: PlayerStats): number {
  const cfg = publicConfig.shopPrice ?? DEFAULT_PUBLIC.shopPrice!;
  const rep = getPublicReputation(stats);
  const raw = cfg.base + rep * cfg.perPoint;
  return Math.max(cfg.min, Math.min(cfg.max, raw));
}

export function meetsSpiritualGate(stats: PlayerStats, gateKey: string): boolean {
  const threshold = spiritualConfig.gates?.[gateKey];
  if (threshold == null) return true;
  return getSpiritualReputation(stats) >= threshold;
}

/** Infer which track an NPC relationship delta should affect. */
export function reputationTrackForNpc(npcId: string | undefined | null): ReputationTrack {
  if (!npcId) return 'public';
  const spiritualWeight = spiritualConfig.npcFactionWeights?.[npcId] ?? 0;
  const publicWeight = publicConfig.npcFactionWeights?.[npcId] ?? 0;
  if (spiritualWeight > publicWeight) return 'spiritual';
  return 'public';
}

export type PublicDialogueTone = 'hostile' | 'neutral' | 'warm' | 'refuse_trade';

/** Townspeople tone from public reputation thresholds in content. */
export function publicDialogueTone(stats: PlayerStats): PublicDialogueTone {
  const dlg = publicConfig.dialogue ?? {};
  const rep = getPublicReputation(stats);
  if (dlg.refuseTradeBelow != null && rep <= dlg.refuseTradeBelow) return 'refuse_trade';
  if (dlg.hostileBelow != null && rep < dlg.hostileBelow) return 'hostile';
  if (dlg.warmAbove != null && rep > dlg.warmAbove) return 'warm';
  return 'neutral';
}

/** Whether mundane shops will sell to this practitioner. */
export function canTradePublicly(stats: PlayerStats): boolean {
  return publicDialogueTone(stats) !== 'refuse_trade';
}

/**
 * Apply content-driven morality gossip: extreme malevolent / benevolent swings
 * nudge public reputation when the absolute delta is large enough.
 */
export function applyMoralityGossip(
  stats: PlayerStats,
  moralDelta: number
): { stats: PlayerStats; applied: number; sourceId: string | null } {
  if (!Number.isFinite(moralDelta) || Math.abs(moralDelta) < 8) {
    return { stats, applied: 0, sourceId: null };
  }
  const sourceId =
    moralDelta < 0 ? 'morality_extreme_malevolent' : 'morality_extreme_benevolent';
  const result = applyReputationSource(stats, 'public', sourceId);
  return { stats: result.stats, applied: result.applied, sourceId: result.source ? sourceId : null };
}

/** Fractional game-days between two instants (24h wall-clock = 1 game day). */
export function gameDaysBetween(from: Date | number | null | undefined, to: Date | number = Date.now()): number {
  if (from == null) return 0;
  const start = typeof from === 'number' ? from : from.getTime();
  const end = typeof to === 'number' ? to : to.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return (end - start) / (24 * 60 * 60 * 1000);
}

/**
 * Drift each reputation track toward its content `decay.toward` by
 * `decay.perGameDay * gameDays`. Never overshoots the toward value.
 */
export function applyReputationDecay(stats: PlayerStats, gameDays: number): PlayerStats {
  if (!Number.isFinite(gameDays) || gameDays <= 0) return stats;
  let next = stats;
  for (const track of ['public', 'spiritual'] as const) {
    const cfg = getReputationConfig(track);
    const perDay = cfg.decay?.perGameDay;
    if (perDay == null || !Number.isFinite(perDay) || perDay === 0) continue;
    const toward = cfg.decay?.toward ?? 0;
    const current = getReputation(next, track);
    const maxStep = Math.abs(perDay) * gameDays;
    if (maxStep <= 0) continue;
    const delta =
      current > toward
        ? -Math.min(maxStep, current - toward)
        : current < toward
          ? Math.min(maxStep, toward - current)
          : 0;
    if (delta !== 0) next = applyReputationDelta(next, track, delta);
  }
  return next;
}
