import { hudSprites } from './hud-assets.js';
import { hudRoot } from './hud-root.js';

import type { HUDWindowId, NavCardDef } from './types.js';

import { tooltipManager } from './TooltipManager.js';



export const NAV_CARDS: NavCardDef[] = [

  { id: 'bag', label: 'Bag', hotkey: 'B', sprite: hudSprites.nav.bag },

  { id: 'grimoire', label: 'Grimoire', hotkey: 'G', sprite: hudSprites.nav.grimoire },

  { id: 'spells', label: 'Spells', hotkey: 'K', sprite: hudSprites.nav.spells },

  { id: 'social', label: 'Social', hotkey: 'N', sprite: hudSprites.nav.social },

  { id: 'coven', label: 'Coven', hotkey: 'C', sprite: hudSprites.nav.coven },

  { id: 'teleport', label: 'Teleport', hotkey: 'T', sprite: hudSprites.nav.teleport },

  { id: 'map', label: 'Map', hotkey: 'M', sprite: hudSprites.nav.map },

  { id: 'settings', label: 'Settings', hotkey: 'Esc', sprite: hudSprites.nav.settings },

];



/** Center navigation — sprite buttons from concept art */

export class NavigationBar {

  readonly root: HTMLDivElement;

  private onSelect?: (id: HUDWindowId) => void;



  constructor() {

    this.root = document.createElement('div');

    this.root.className = 'hud-nav';

    this.root.id = 'hud-nav';

    hudRoot.appendChild(this.root);

    this.render();

  }



  setHandler(handler: (id: HUDWindowId) => void): void {

    this.onSelect = handler;

  }



  setCollapsed(collapsed: boolean): void {

    this.root.classList.toggle('hud-nav--collapsed', collapsed);

  }



  render(): void {

    this.root.innerHTML = `

      <div class="hud-nav__cards">

        ${NAV_CARDS.map(

          (c) => `

          <button type="button" class="hud-nav-card" data-window="${c.id}" aria-label="${c.label}">

            <img class="hud-nav-card__sprite" src="${c.sprite}" alt="${c.label}" draggable="false" />

          </button>`,

        ).join('')}

      </div>`;



    this.root.querySelectorAll('.hud-nav-card').forEach((btn) => {

      const el = btn as HTMLButtonElement;

      const id = el.dataset.window as HUDWindowId;

      const card = NAV_CARDS.find((c) => c.id === id);

      tooltipManager.bind(el, `<strong>${card?.label}</strong><br/>Press <kbd>${card?.hotkey}</kbd>`);

      el.addEventListener('click', () => this.onSelect?.(id));

    });

  }

}



export const navigationBar = new NavigationBar();

