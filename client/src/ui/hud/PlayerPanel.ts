import {
  getPractitionerType,
  magicalEnergyCap,
  playerLevel,
  practitionerXpProgress,
  getMaxPlayerLevel,
  getLevelTitle,
  getLevelRankLabel,
  spiritRangeForLevel,
  type PlayerStats,
} from '@witchcraft/shared';
import { gameState } from '../../data/game-state.js';
import { hudSprites } from './hud-assets.js';
import { hudRoot } from './hud-root.js';
import { tooltipManager } from './TooltipManager.js';
import { compassWidget } from './CompassWidget.js';
import { MoralityGauge } from './MoralityGauge.js';

const HEALTH_MAX = 100;

function parseStats(): PlayerStats | null {
  if (!gameState.localPlayer?.statsJson) return null;
  try {
    return JSON.parse(gameState.localPlayer.statsJson) as PlayerStats;
  } catch {
    return null;
  }
}

/** Aura moralityScore is authoritative; stats.morality is kept in sync for admin edits. */
function resolveMorality(stats: PlayerStats | null): number {
  try {
    const raw = gameState.localPlayer?.auraJson;
    if (raw) {
      const aura = JSON.parse(raw) as { moralityScore?: number };
      if (Number.isFinite(aura.moralityScore)) {
        return Math.round(aura.moralityScore as number);
      }
    }
  } catch {
    /* fall through */
  }
  return Math.round(stats?.morality ?? 0);
}

/** Top-left portrait + status — always visible when HUD is ready */
export class PlayerPanel {
  readonly root: HTMLDivElement;
  private morality = new MoralityGauge();
  private readonly intuitionSlot = document.createElement('div');

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'hud-player-panel';
    this.root.id = 'hud-player-panel';
    this.intuitionSlot.className = 'hud-player-panel__intuition-slot';
    this.intuitionSlot.id = 'hud-player-panel-intuition';
    hudRoot.appendChild(this.root);
    this.render();
    this.root.appendChild(this.intuitionSlot);
    compassWidget.attachTo(this.intuitionSlot);

    window.addEventListener('game:player-sync', () => this.render());
    window.addEventListener('game:player-loaded', () => this.render());
    window.addEventListener('game:stats-sync', () => this.render());

    tooltipManager.bind(this.root, () => this.tooltipHtml());
  }

  render(): void {
    const stats = parseStats();
    const name = gameState.displayName ?? 'Practitioner';
    const level = playerLevel(stats?.experience ?? 0);
    const rank = `${getLevelRankLabel(level)} · ${getLevelTitle(level)}`;
    const tierLabel = gameState.progression?.recognitionTierLabel ?? 'Initiate';
    const type = stats ? getPractitionerType(stats, tierLabel) : tierLabel;
    const morality = resolveMorality(stats);
    const hp = Math.round(stats?.health ?? HEALTH_MAX);
    const me = Math.round(stats?.magicalEnergy ?? 0);
    const meMax = magicalEnergyCap(stats?.experience ?? 0);
    const xp = stats?.experience ?? 0;
    const progress = practitionerXpProgress(xp);
    const hpPct = Math.max(0, Math.min(100, (hp / HEALTH_MAX) * 100));
    const mePct = meMax > 0 ? Math.max(0, Math.min(100, (me / meMax) * 100)) : 0;
    const xpPct = Math.max(0, Math.min(100, progress.ratio * 100));
    const xpLabel = progress.isMaxLevel
      ? `Lv ${progress.level}/${getMaxPlayerLevel()} MAX`
      : `${Math.round(progress.xpIntoLevel)} / ${progress.xpToNext}`;

    this.root.innerHTML = `
      <img class="hud-player-panel__chrome" src="${hudSprites.player.frame}" alt="" draggable="false" />
      <div class="hud-player-panel__header">
        <div class="hud-player-panel__name" id="hud-player-name">${name}</div>
        <div class="hud-player-panel__rank" id="hud-player-rank">${rank} · ${type}</div>
        <div class="hud-player-panel__morality-slot" id="hud-morality-slot"></div>
      </div>
      <div class="hud-player-panel__bars">
        ${barRow('hp', hpPct, `${hp} / ${HEALTH_MAX}`)}
        ${barRow('me', mePct, `${me} / ${meMax}`)}
        ${barRow('xp', xpPct, xpLabel)}
      </div>`;

    // Re-mount the persistent morality gauge (innerHTML wiped its slot) and
    // bind it to live morality (-100..+100).
    this.root.querySelector('#hud-morality-slot')?.appendChild(this.morality.root);
    this.morality.setMorality(morality);

    if (!this.intuitionSlot.parentElement) {
      this.root.appendChild(this.intuitionSlot);
    }
    compassWidget.attachTo(this.intuitionSlot);
  }

  private tooltipHtml(): string {
    const stats = parseStats();
    const level = playerLevel(stats?.experience ?? 0);
    const progress = practitionerXpProgress(stats?.experience ?? 0);
    const publicRep = Math.round(stats?.publicReputation ?? stats?.reputation ?? 0);
    const spiritualRep = Math.round(stats?.spiritualReputation ?? 0);
    const recent = (gameState.progression?.recentXp ?? []).slice(-3).reverse();
    const recentLine =
      recent.length > 0
        ? `Recent XP: ${recent.map((r) => `+${r.amount} ${r.label}`).join(' · ')}`
        : 'Recent XP: —';
    const xpLine = progress.isMaxLevel
      ? `Practitioner Level ${level}/${getMaxPlayerLevel()} (max)`
      : `Practitioner Level ${level}/${getMaxPlayerLevel()} · ${progress.xpIntoLevel}/${progress.xpToNext} XP`;
    const spirits = spiritRangeForLevel(level);
    return [
      `<strong>${gameState.displayName ?? 'Practitioner'}</strong>`,
      xpLine,
      `${getLevelRankLabel(level)} · ${getLevelTitle(level)}`,
      spirits.label ? `Spirits: ${spirits.label} (${spirits.minPower}–${spirits.maxPower})` : '',
      stats
        ? getPractitionerType(stats, gameState.progression?.recognitionTierLabel ?? 'Initiate')
        : 'Practitioner',
      `Public rep ${publicRep} · Spiritual rep ${spiritualRep}`,
      (() => {
        const licenses = gameState.progression?.earnedLicenses ?? [];
        const marks = gameState.progression?.licensureMarks ?? {};
        if (!licenses.length) return 'Credentials: none';
        return `Credentials: ${licenses
          .map((id) => {
            const m = marks[id];
            const status = m?.status === 'warned' ? '⚠' : m?.status === 'revoked' ? '✕' : '●';
            const left = m ? `${m.marks}/${m.markCapacity}` : '?';
            return `${status}${id.replace(/_license$/, '')} ${left}`;
          })
          .join(' · ')}`;
      })(),
      recentLine,
      '<em>Press X for Aura &amp; Wards (full stats)</em>',
    ].filter(Boolean).join('<br/>');
  }
}

function barRow(kind: string, pct: number, text: string): string {
  return `
    <div class="hud-player-panel__bar hud-player-panel__bar--${kind}">
      <div class="hud-player-panel__fill" style="width:${pct}%"></div>
      ${text ? `<span class="hud-player-panel__bar-text">${text}</span>` : ''}
    </div>`;
}

export const playerPanel = new PlayerPanel();
