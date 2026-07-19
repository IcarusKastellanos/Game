import { gameState } from '../../data/game-state.js';

import { hudSprites } from './hud-assets.js';
import { hudRoot } from './hud-root.js';

import { tooltipManager } from './TooltipManager.js';



function parseStats(): { reputation?: number; experience?: number } | null {

  if (!gameState.localPlayer?.statsJson) return null;

  try {

    return JSON.parse(gameState.localPlayer.statsJson);

  } catch {

    return null;

  }

}



/** Bottom-right resource counters — sprite frames with dynamic values */

export class ResourcePanel {

  readonly root: HTMLDivElement;



  constructor() {

    this.root = document.createElement('div');

    this.root.className = 'hud-resources';

    this.root.id = 'hud-resources';

    hudRoot.appendChild(this.root);



    window.addEventListener('game:player-sync', () => this.render());

    window.addEventListener('game:player-loaded', () => this.render());

    window.addEventListener('game:stats-sync', () => this.render());

    this.render();

  }



  render(): void {

    const stats = parseStats();

    const coins = gameState.localPlayer?.coins ?? 0;

    const rep = Math.round(stats?.reputation ?? 0);

    const essence = Math.round((stats?.experience ?? 0) * 0.4 + rep * 2);

    const favor = Math.max(0, Math.round(rep * 0.5 + 12));



    this.root.innerHTML = `

      <div class="hud-resources__stack">

        ${counterRow('coin', hudSprites.resources.coin, 'Coin', coins, 'Town trade & shop purchases')}

        ${counterRow('essence', hudSprites.resources.essence, 'Essence', essence, 'Distilled from workings — crafting fuel')}

        ${counterRow('favor', hudSprites.resources.favor, 'Spirit Favor', favor, 'Spirit court standing')}

      </div>`;



    this.root.querySelectorAll('.hud-resources__row').forEach((el) => {

      const rowEl = el as HTMLElement;

      const tip = rowEl.dataset.tip ?? '';

      tooltipManager.bind(rowEl, `<strong>${rowEl.dataset.label}</strong><br/>${tip}`);

    });

  }

}



function counterRow(cls: string, sprite: string, label: string, value: number, tip: string): string {

  return `

    <div class="hud-resources__row hud-resources__row--${cls}" data-label="${label}" data-tip="${tip.replace(/"/g, '&quot;')}">

      <img class="hud-resources__sprite" src="${sprite}" alt="" draggable="false" />

      <span class="hud-resources__val">${value}</span>

    </div>`;

}



export const resourcePanel = new ResourcePanel();

