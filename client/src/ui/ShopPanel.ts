import { formatContentLabel, meetsMinLevel, playerLevel } from '@witchcraft/shared';
import { gameState } from '../data/game-state';
import { network } from '../net/NetworkManager';
import { ambientAudio } from '../audio/AmbientAudio';
import { escapeHtml, ledgerOverlayShell } from './ledger-chrome';

/** Shop counter — the same reading page as the practitioner ledger. */
export class ShopPanel {
  private root: HTMLDivElement;
  private scroller: HTMLElement;
  private titleEl: HTMLElement;
  private subtitleEl: HTMLElement;
  private visible = false;
  private shopId = '';

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'shop-panel';
    this.root.className = 'ledger-overlay';
    this.root.innerHTML = ledgerOverlayShell({
      kicker: 'Counter',
      title: 'Shop',
      subtitle: '',
      foot: 'Coin leaves your purse when you purchase. Close the page to step back.',
    });
    document.body.appendChild(this.root);
    this.scroller = this.root.querySelector('.ledger-scroll') as HTMLElement;
    this.titleEl = this.root.querySelector('h1') as HTMLElement;
    this.subtitleEl = this.root.querySelector('.ledger-type') as HTMLElement;
    this.root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-ledger-close]')) this.hide();
    });
    window.addEventListener('game:shop-stock', () => {
      if (this.visible) this.renderShop();
    });
  }

  show(shopId: string): void {
    this.shopId = shopId;
    this.visible = true;
    this.root.classList.add('is-open');
    ambientAudio.setScene('shop');
    this.renderShop();
  }

  hide(): void {
    const wasOpen = this.visible;
    this.visible = false;
    this.root.classList.remove('is-open');
    this.scroller.innerHTML = '';
    if (gameState.activeUI === 'shop') gameState.activeUI = 'none';
    if (!wasOpen) return;
    const scene = gameState.currentScene;
    ambientAudio.setScene(scene === 'town' ? 'town' : scene === 'apartment' ? 'apartment' : 'none');
  }

  private getPlayerExperience(): number {
    try {
      const stats = JSON.parse(gameState.localPlayer?.statsJson ?? '{}');
      return Number(stats.experience) || 0;
    } catch {
      return 0;
    }
  }

  private renderShop(): void {
    const shop = gameState.content?.shops.find((s) => s.id === this.shopId);
    const scrollTop = this.scroller.scrollTop;
    if (!shop) {
      this.titleEl.textContent = 'Closed counter';
      this.subtitleEl.textContent = '';
      this.scroller.innerHTML = '<p class="ledger-lead">This counter has nothing laid out.</p>';
      return;
    }

    const keeper = gameState.content?.npcs.find((n) => n.id === shop.npcId);
    this.titleEl.textContent = shop.name;
    this.subtitleEl.textContent = keeper?.name ?? 'Open counter';
    this.root.querySelector('.ledger-frame')?.setAttribute('aria-label', shop.name);

    const xp = this.getPlayerExperience();
    const level = playerLevel(xp);
    const wares = shop.inventory.map((item) => {
      const ing = gameState.content?.ingredients.find((i) => i.id === item.itemId);
      const name = ing?.name ?? formatContentLabel(item.itemId);
      const unlocked = meetsMinLevel(xp, item.minLevel);
      const need = item.minLevel ?? 1;
      if (unlocked) {
        return `
          <article class="ledger-ware">
            <header>
              <h3>${escapeHtml(name)}</h3>
              <strong>${item.price} coin</strong>
            </header>
            <p>${item.stock} still on the shelf.</p>
            <button type="button" class="ledger-buy" data-item="${escapeHtml(item.itemId)}"><span class="k">Purchase</span>Take one</button>
          </article>`;
      }
      return `
        <article class="ledger-ware is-sealed">
          <header><h3>${escapeHtml(name)}</h3></header>
          <p>Level gated (need ${need}, you are ${level})</p>
        </article>`;
    }).join('');

    const intro = keeper
      ? `${escapeHtml(keeper.name)} keeps ${escapeHtml(shop.name)}. Choose what you can carry.`
      : `${escapeHtml(shop.name)} has the following laid out.`;
    const speak = keeper?.dialogueTreeId
      ? `<button type="button" class="ledger-choice" data-talk="1"><span class="k">Speak</span>${escapeHtml(keeper.name)}</button>`
      : '';

    this.scroller.innerHTML = `<p class="ledger-lead">${intro}</p>${speak}<div class="ledger-wares">${wares}</div>`;
    this.scroller.querySelector<HTMLButtonElement>('[data-talk]')?.addEventListener('click', () => {
      if (!keeper || !this.visible) return;
      network.send('npc_talk', { npcId: keeper.id });
    });
    this.scroller.querySelectorAll<HTMLButtonElement>('.ledger-buy').forEach((btn) => {
      btn.addEventListener('click', () => {
        const itemId = btn.dataset.item;
        if (!itemId || !this.visible) return;
        this.buy(itemId);
      });
    });
    const restore = (): void => {
      if (!this.visible) return;
      const max = Math.max(0, this.scroller.scrollHeight - this.scroller.clientHeight);
      this.scroller.scrollTop = Math.min(scrollTop, max);
    };
    restore();
    requestAnimationFrame(restore);
  }

  private buy(itemId: string): void {
    network.send('buy_item', { shopId: this.shopId, itemId, quantity: 1 });
    window.setTimeout(() => {
      if (this.visible) this.renderShop();
    }, 300);
  }
}
