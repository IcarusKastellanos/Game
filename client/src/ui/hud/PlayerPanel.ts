import {
  getPractitionerType,
  magicalEnergyCap,
  playerLevel,
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

function rankLabel(level: number): string {
  if (level >= 80) return 'Rank IX';
  if (level >= 60) return 'Rank VII';
  if (level >= 40) return 'Rank V';
  if (level >= 20) return 'Rank III';
  return 'Rank I';
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
    const rank = rankLabel(level);
    const type = stats ? getPractitionerType(stats) : 'Practitioner';
    const morality = resolveMorality(stats);
    const hp = Math.round(stats?.health ?? HEALTH_MAX);
    const me = Math.round(stats?.magicalEnergy ?? 0);
    const meMax = magicalEnergyCap(stats?.experience ?? 0);
    const xp = stats?.experience ?? 0;
    const xpInLevel = xp % 100;
    const hpPct = Math.max(0, Math.min(100, (hp / HEALTH_MAX) * 100));
    const mePct = meMax > 0 ? Math.max(0, Math.min(100, (me / meMax) * 100)) : 0;
    const xpPct = Math.max(0, Math.min(100, xpInLevel));

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
        ${barRow('xp', xpPct, `${Math.round(xpInLevel)} / 100`)}
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
    return [
      `<strong>${gameState.displayName ?? 'Practitioner'}</strong>`,
      `Level ${level}`,
      stats ? getPractitionerType(stats) : 'Practitioner',
      '<em>Portrait and bars update from your live stats</em>',
    ].join('<br/>');
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
