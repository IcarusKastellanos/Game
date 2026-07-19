import { formatContentLabel } from '@witchcraft/shared';
import { gameState } from '../data/game-state';
import { network } from '../net/NetworkManager';
import { bindDomInputs } from './input-focus';

/** Two-player item/coin trade panel */
export class TradePanel {
  private root!: HTMLDivElement;
  private visible = false;
  private tradeId = '';
  private partnerSessionId = '';
  private partnerName = '';
  private yourOffer = { coins: 0, items: [] as { itemId: string; quantity: number }[] };
  private theirOffer = { coins: 0, items: [] as { itemId: string; quantity: number }[] };
  private youAccepted = false;
  private theyAccepted = false;

  constructor() {
    this.build();
    this.hide();
    window.addEventListener('game:trade-state', this.onState as EventListener);
    window.addEventListener('game:trade-invite', this.onInvite as EventListener);
    window.addEventListener('game:trade-complete', this.onDone as EventListener);
    window.addEventListener('game:trade-cancelled', this.onDone as EventListener);
    window.addEventListener('game:player-sync', this.onSync as EventListener);
  }

  private build(): void {
    this.root = document.createElement('div');
    this.root.id = 'trade-panel';
    this.root.style.cssText = `
      display:none;position:fixed;inset:0;z-index:9600;background:#060410ee;
      font-family:'Courier New',monospace;color:#cce;padding:16px;overflow-y:auto;
    `;
    document.body.appendChild(this.root);
  }

  openInvite(tradeId: string, fromSessionId: string, fromName: string): void {
    this.tradeId = tradeId;
    this.partnerSessionId = fromSessionId;
    this.partnerName = fromName;
    gameState.activeTradeId = tradeId;
    gameState.tradePartnerName = fromName;
    this.visible = true;
    this.root.style.display = 'block';
    this.render();
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
    gameState.activeTradeId = null;
    gameState.tradePartnerName = '';
  }

  private onInvite = (e: CustomEvent<{ tradeId: string; fromSessionId: string; fromName: string }>): void => {
    this.openInvite(e.detail.tradeId, e.detail.fromSessionId, e.detail.fromName);
  };

  private onState = (e: CustomEvent<{
    tradeId: string;
    partnerName: string;
    partnerSessionId: string;
    yourOffer: { coins: number; items: { itemId: string; quantity: number }[] };
    theirOffer: { coins: number; items: { itemId: string; quantity: number }[] };
    youAccepted: boolean;
    theyAccepted: boolean;
  }>): void => {
    const d = e.detail;
    this.tradeId = d.tradeId;
    this.partnerName = d.partnerName;
    this.partnerSessionId = d.partnerSessionId;
    this.yourOffer = d.yourOffer;
    this.theirOffer = d.theirOffer;
    this.youAccepted = d.youAccepted;
    this.theyAccepted = d.theyAccepted;
    gameState.activeTradeId = d.tradeId;
    gameState.tradePartnerName = d.partnerName;
    if (!this.visible) {
      this.visible = true;
      this.root.style.display = 'block';
    }
    this.render();
  };

  private onDone = (): void => {
    this.hide();
  };

  private onSync = (): void => {
    if (this.visible) this.render();
  };

  private render(): void {
    const inv = gameState.localPlayer?.inventory ?? [];
    const coins = gameState.localPlayer?.coins ?? 0;

    this.root.innerHTML = `
      <div style="max-width:640px;margin:0 auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <h2 style="color:#8cf;margin:0;font-size:14px;">◆ Trade with ${this.partnerName} ◆</h2>
          <button id="trade-close" style="background:#311;border:1px solid #f66;color:#faa;cursor:pointer;padding:4px 10px;">✕</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;">
          <div style="border:1px solid #448;padding:8px;background:#0a1020;">
            <div style="color:#8cf;font-size:10px;margin-bottom:6px;">YOUR OFFER</div>
            <label style="font-size:9px;color:#aaa;">Coins (you have ${coins})</label>
            <input id="trade-coins" type="number" min="0" max="${coins}" value="${this.yourOffer.coins}" style="width:100%;padding:4px;background:#111;color:#fff;border:1px solid #448;margin:4px 0 8px;" />
            <div style="font-size:9px;color:#aaa;margin-bottom:4px;">Add from inventory</div>
            ${inv.map((s) => {
              const ing = gameState.content?.ingredients.find((i) => i.id === s.itemId);
              const inOffer = this.yourOffer.items.find((i) => i.itemId === s.itemId)?.quantity ?? 0;
              const available = s.quantity - inOffer;
              return `<button class="add-item" data-id="${s.itemId}" style="display:block;width:100%;text-align:left;padding:4px;margin:2px 0;background:#111;border:1px solid #335;color:#ccc;cursor:pointer;font-size:9px;" ${available <= 0 ? 'disabled' : ''}>
                + ${ing?.name ?? formatContentLabel(s.itemId)} (${available} free)
              </button>`;
            }).join('') || '<div style="color:#666;font-size:9px;">Empty inventory</div>'}
            <div style="margin-top:8px;font-size:9px;color:#adf;">
              ${this.yourOffer.items.map((i) => {
                const ing = gameState.content?.ingredients.find((x) => x.id === i.itemId);
                return `<div>${ing?.name ?? formatContentLabel(i.itemId)} ×${i.quantity} <button class="rm-item" data-id="${i.itemId}" style="background:none;border:none;color:#f66;cursor:pointer;">×</button></div>`;
              }).join('') || 'Nothing offered yet'}
            </div>
          </div>
          <div style="border:1px solid #484;padding:8px;background:#081008;">
            <div style="color:#8f8;font-size:10px;margin-bottom:6px;">THEIR OFFER</div>
            <div style="font-size:9px;color:#ccc;">Coins: ${this.theirOffer.coins}</div>
            <div style="margin-top:8px;font-size:9px;color:#afa;">
              ${this.theirOffer.items.map((i) => {
                const ing = gameState.content?.ingredients.find((x) => x.id === i.itemId);
                return `<div>${ing?.name ?? formatContentLabel(i.itemId)} ×${i.quantity}</div>`;
              }).join('') || 'Nothing offered yet'}
            </div>
            <div style="margin-top:12px;font-size:9px;color:${this.theyAccepted ? '#8f8' : '#888'};">
              Partner: ${this.theyAccepted ? 'Accepted ✓' : 'Reviewing…'}
            </div>
          </div>
        </div>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
          <button id="trade-update" style="padding:8px 14px;background:#112244;border:1px solid #48f;color:#adf;cursor:pointer;">Update Offer</button>
          <button id="trade-accept" style="padding:8px 14px;background:${this.youAccepted ? '#224422' : '#113311'};border:1px solid #6f6;color:#afa;cursor:pointer;">
            ${this.youAccepted ? 'Accepted ✓' : 'Accept Trade'}
          </button>
          <button id="trade-cancel" style="padding:8px 14px;background:#331111;border:1px solid #844;color:#faa;cursor:pointer;">Cancel</button>
        </div>
        <div style="font-size:8px;color:#666;margin-top:8px;">Both players must accept. Items swap when both confirm.</div>
      </div>`;

    document.getElementById('trade-close')!.onclick = () => this.cancel();
    document.getElementById('trade-cancel')!.onclick = () => this.cancel();
    document.getElementById('trade-update')!.onclick = () => this.pushOffer();
    document.getElementById('trade-accept')!.onclick = () => {
      network.send('trade_accept', { tradeId: this.tradeId, accepted: true });
    };

    this.root.querySelectorAll('.add-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const itemId = (btn as HTMLElement).dataset.id!;
        const slot = this.yourOffer.items.find((i) => i.itemId === itemId);
        if (slot) slot.quantity += 1;
        else this.yourOffer.items.push({ itemId, quantity: 1 });
        this.pushOffer();
      });
    });

    this.root.querySelectorAll('.rm-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const itemId = (btn as HTMLElement).dataset.id!;
        const slot = this.yourOffer.items.find((i) => i.itemId === itemId);
        if (!slot) return;
        slot.quantity -= 1;
        if (slot.quantity <= 0) {
          this.yourOffer.items = this.yourOffer.items.filter((i) => i.itemId !== itemId);
        }
        this.pushOffer();
      });
    });

    bindDomInputs(this.root);
  }

  private pushOffer(): void {
    const coinsEl = document.getElementById('trade-coins') as HTMLInputElement | null;
    const coins = Math.max(0, Number(coinsEl?.value ?? this.yourOffer.coins));
    this.yourOffer.coins = coins;
    network.send('trade_offer', {
      tradeId: this.tradeId,
      coins: this.yourOffer.coins,
      items: this.yourOffer.items,
    });
  }

  private cancel(): void {
    if (this.tradeId) network.send('trade_cancel', { tradeId: this.tradeId });
    this.hide();
  }

  requestTrade(targetSessionId: string): void {
    network.send('trade_request', { targetSessionId });
  }
}

export const tradePanel = new TradePanel();
