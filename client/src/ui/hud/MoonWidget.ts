import { gameState } from '../../data/game-state.js';
import { hudRoot } from './hud-root.js';

const MOON_PHASES = [
  'New Moon',
  'Waxing Crescent',
  'First Quarter',
  'Waxing Gibbous',
  'Full Moon',
  'Waning Gibbous',
  'Third Quarter Moon',
  'Waning Crescent',
];

function moonPhaseIndex(date: Date): number {
  const synodic = 29.53058867;
  const ref = new Date('2000-01-06T18:14:00Z').getTime();
  const age = ((date.getTime() - ref) / 86400000) % synodic;
  return Math.floor((age / synodic) * 8) % 8;
}

function formatTime(hour: number): string {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour % 1) * 60) || 0;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function regionLabel(): string {
  if (gameState.visitingHostSessionId) return `${gameState.visitingHostName}'s Hearth`;
  if (gameState.currentScene === 'apartment') return 'Apartment Sanctum';
  return 'Hollow Creek';
}

function planetaryHour(hour: number): string {
  const planets = ['Saturn', 'Jupiter', 'Mars', 'Sun', 'Venus', 'Mercury', 'Moon'];
  return planets[hour % 7];
}

/** Top-right parchment moon & time panel */
export class MoonWidget {
  readonly root: HTMLDivElement;
  private moonEl!: HTMLDivElement;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'hud-moon-panel';
    this.root.id = 'hud-moon-panel';
    this.root.innerHTML = `
      <div class="hud-moon-panel__parchment">
        <div class="hud-moon-panel__moon" id="hud-moon-icon"></div>
        <div class="hud-moon-panel__text">
          <div class="hud-moon-phase" id="hud-moon-phase">Third Quarter Moon</div>
          <div class="hud-moon-time" id="hud-moon-time">00:00</div>
          <div class="hud-moon-region" id="hud-moon-region">—</div>
          <div class="hud-moon-meta" id="hud-moon-meta"></div>
        </div>
        <div class="hud-moon-panel__ribbon" aria-hidden="true"></div>
      </div>`;
    hudRoot.appendChild(this.root);
    this.moonEl = this.root.querySelector('#hud-moon-icon') as HTMLDivElement;

    window.addEventListener('game:scene-change', () => this.render());
    window.addEventListener('game:player-loaded', () => this.render());
    setInterval(() => this.render(), 15000);
    this.render();
  }

  render(): void {
    const now = new Date();
    const phaseIdx = moonPhaseIndex(now);
    const phase = MOON_PHASES[phaseIdx];
    const hour = gameState.worldHour + now.getMinutes() / 60;

    const phaseEl = this.root.querySelector('#hud-moon-phase');
    const timeEl = this.root.querySelector('#hud-moon-time');
    const regionEl = this.root.querySelector('#hud-moon-region');
    const metaEl = this.root.querySelector('#hud-moon-meta');

    if (phaseEl) phaseEl.textContent = phase;
    if (timeEl) timeEl.textContent = formatTime(hour);
    if (regionEl) regionEl.textContent = regionLabel();
    if (metaEl) {
      metaEl.textContent = `Day ${now.toLocaleDateString(undefined, { weekday: 'short' })} · Hour of ${planetaryHour(Math.floor(hour))}`;
    }

    this.moonEl.className = `hud-moon-panel__moon hud-moon-phase--${phaseIdx}`;
    this.root.classList.toggle('hud-moon-panel--full', phaseIdx === 4);
  }
}

export const moonWidget = new MoonWidget();
