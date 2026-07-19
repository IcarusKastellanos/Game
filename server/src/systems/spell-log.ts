import { contentRegistry } from '../content/registry.js';
import type { CastDiagnostics } from './spell-engine.js';
import type { CastResult } from './spell-engine.js';
import type { PlayerStats } from '@witchcraft/shared';

export interface SpellAttemptLog {
  spellId: string;
  success: boolean;
  casterId: string;
  casterName: string;
  targetId?: string;
  targetName?: string;
  casterStats: Partial<PlayerStats>;
  targetStats?: Partial<PlayerStats>;
  result: CastResult;
  meCost: number;
  channel?: 'altar' | 'ward_point' | 'other';
  extra?: Record<string, unknown>;
}

function spellLabel(spellId: string): string {
  return contentRegistry.spells.get(spellId)?.name ?? spellId;
}

function formatBreakdown(breakdown: Record<string, number>): string {
  const parts = [
    `Ritual ${breakdown.ritualSkill ?? 0}`,
    `Intuition ${breakdown.intuition ?? 0}`,
    `Category ${breakdown.categoryFocus ?? 0}`,
    breakdown.effortReduction ? `Familiar −${breakdown.effortReduction}` : '',
    `Affinity ${(breakdown.affinity ?? 0).toFixed(1)}`,
    `Pentacle ${(breakdown.pentacle ?? 0).toFixed(1)}`,
  ];
  return parts.filter(Boolean).join(' + ');
}

function formatDiagnostics(d: CastDiagnostics | undefined): string[] {
  if (!d) return [];
  const lines = [`  Reason: ${d.summary}`];
  if (d.code === 'focus_check' && d.breakdown && d.difficultyRequired !== undefined) {
    const total =
      (d.breakdown.ritualSkill ?? 0) +
      (d.breakdown.intuition ?? 0) +
      (d.breakdown.categoryFocus ?? 0) +
      (d.breakdown.affinity ?? 0) +
      (d.breakdown.pentacle ?? 0);
    lines.push(
      `  Focus: ${total.toFixed(1)} / ${d.difficultyRequired} required (${formatBreakdown(d.breakdown)})`
    );
  }
  if (d.missingIngredient) lines.push(`  Missing item: ${d.missingIngredient}`);
  if (d.meRequired !== undefined) {
    lines.push(`  ME: have ${d.meAvailable ?? '?'}, need ${d.meRequired}`);
  }
  return lines;
}

/** Human-readable console log for every spell attempt (success or failure). */
export function logSpellAttempt(entry: SpellAttemptLog): void {
  const name = spellLabel(entry.spellId);
  const status = entry.success ? 'SUCCESS' : 'FAILED';
  const channel = entry.channel ? ` via ${entry.channel}` : '';
  const lines = [
    `[Spell] ${status} — ${name} (${entry.spellId})${channel}`,
    `  Caster: ${entry.casterName} [${entry.casterId}]`,
  ];

  if (entry.targetName) {
    lines.push(`  Target: ${entry.targetName}${entry.targetId ? ` [${entry.targetId}]` : ''}`);
  }

  lines.push(
    `  Potency: ${Math.round(entry.result.potency * 10) / 10} · ME cost: ${entry.meCost} · Accuracy: ${Math.round(entry.result.accuracy * 100)}%`
  );

  if (entry.casterStats.ritualSkill !== undefined) {
    lines.push(
      `  Caster stats: Ritual ${entry.casterStats.ritualSkill}, Intuition ${entry.casterStats.intuition}, Warding ${entry.casterStats.warding ?? '?'}, ME ${entry.casterStats.magicalEnergy}`
    );
  }

  if (!entry.success) {
    lines.push(...formatDiagnostics(entry.result.diagnostics));
    if (entry.result.diagnostics?.code === 'focus_check' && entry.result.consumedItems.length) {
      const items = entry.result.consumedItems.map((c) => `${c.itemId}×${c.quantity}`).join(', ');
      lines.push(`  Fizzle cost (half ingredients): ${items}`);
    }
    if (entry.result.message && entry.result.message !== entry.result.diagnostics?.summary) {
      lines.push(`  Player message: ${entry.result.message}`);
    }
  } else if (Object.keys(entry.result.effects).length) {
    lines.push(`  Effects applied: ${Object.keys(entry.result.effects).join(', ')}`);
  }

  if (entry.result.consumedItems.length) {
    const items = entry.result.consumedItems.map((c) => `${c.itemId}×${c.quantity}`).join(', ');
    lines.push(`  Consumed: ${items}`);
  }

  if (entry.extra && Object.keys(entry.extra).length) {
    for (const [key, val] of Object.entries(entry.extra)) {
      lines.push(`  ${key}: ${typeof val === 'object' ? JSON.stringify(val) : val}`);
    }
  }

  const text = lines.join('\n');
  if (entry.success) console.log(text);
  else console.warn(text);
}
