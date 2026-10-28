/** Shared teacher / mentor gates for lessons and dialogue. */

import type { MagicTradition, PlayerStats } from '../types/index.js';

export type TraditionAffinityGate = Partial<Record<MagicTradition, number>>;

const TRADITIONS = new Set<MagicTradition>([
  'traditional_european',
  'chaos_magic',
  'vodou',
  'nordic_seidr',
  'greek_mageia',
]);

/** Parse `{ traditional_european: 15 }` style affinity floors. */
export function parseTraditionAffinityGate(raw: unknown): TraditionAffinityGate | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: TraditionAffinityGate = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!TRADITIONS.has(key as MagicTradition)) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    out[key as MagicTradition] = Math.max(0, Math.round(value));
  }
  return Object.keys(out).length ? out : undefined;
}

/** Player-facing block when tradition affinity is too low. */
export function traditionAffinityBlockReason(
  stats: PlayerStats | undefined,
  gate: TraditionAffinityGate | null | undefined
): string | null {
  if (!gate || !Object.keys(gate).length) return null;
  if (!stats) return 'Your affinities are still unsettled.';
  for (const [tradition, need] of Object.entries(gate) as [MagicTradition, number][]) {
    if ((stats.affinities?.[tradition] ?? 0) < need) {
      return 'Your practice in that tradition is not deep enough yet.';
    }
  }
  return null;
}

/** Occult-community reputation floor for mentors. */
export function spiritualReputationBlockReason(
  stats: PlayerStats | undefined,
  need: number | null | undefined
): string | null {
  if (need == null || !(need > 0)) return null;
  if (!stats) return 'Your standing among practitioners is still unknown.';
  if ((stats.spiritualReputation ?? 0) < need) {
    return 'The occult community does not know you well enough yet.';
  }
  return null;
}
