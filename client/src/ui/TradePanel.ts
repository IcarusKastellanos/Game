import { formatContentLabel, getTaglockTargetName, GRIMOIRE_MANUSCRIPT_ITEM_ID, isEmptyInventorySlot, readManuscriptMeta } from '@witchcraft/shared';
import { gameState } from '../data/game-state';
import { network } from '../net/NetworkManager';
import { bindDomInputs } from './input-focus';

type OfferItem = { itemId: string; quantity: number; slotIndex?: number };

function itemLabel(itemId: string, slotIndex?: number): string {
  const ing = gameState.content?.ingredients.find((i) => i.id === itemId);
  const base = ing?.name ?? formatContentLabel(itemId);
  if (typeof slotIndex !== 'number') return base;
  const slot = gameState.localPlayer?.inventory?.[slotIndex];
  if (!slot) return base;
  const manuscript = readManuscriptMeta(slot);
  if (manuscript) return `${manuscript.manuscriptTitle} (manuscript)`;
  const target = getTaglockTargetName(slot);
  if (target) return `${base} — ${target}`;
  return base;
}

function needsSlotOffer(slot: { itemId: string; metadata?: Record<string, unknown> }): boolean {
  if (slot.itemId === GRIMOIRE_MANUSCRIPT_ITEM_ID) return true;
  if (!slot.metadata) return false;
  return Object.keys(slot.metadata).some((key) => key !== 'slotIndex');
}

/** Two-player item/coin trade panel */
export class TradePanel {
  private root!: HTMLDivElement;
  private visible = false;
  private tradeId = '';
  private partnerSessionId = '';
  private partnerName = '';
  private yourOffer = { coins: 0, items: [] as OfferItem[] };
  private theirOffer = { coins: 0, items: [] as OfferItem[] };
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
    yourOffer: { coins: number; items: OfferItem[] };
    theirOffer: { coins: number; items: OfferItem[] };
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
    const reserved = new Set(
      this.yourOffer.items
        .filter((item) => typeof item.slotIndex === 'number')
        .map((item) => item.slotIndex as number)
    );

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
            ${inv.map((s, index) => {
              if (isEmptyInventorySlot(s)) return '';
              const unique = needsSlotOffer(s);
              if (unique) {
                const offered = reserved.has(index);
                return `<button class="add-item" data-id="${s.itemId}" data-slot="${index}" style="display:block;width:100%;text-align:left;padding:4px;margin:2px 0;background:#111;border:1px solid #335;color:#ccc;cursor:pointer;font-size:9px;" ${offered ? 'disabled' : ''}>
                  + ${itemLabel(s.itemId, index)}${offered ? ' (offered)' : ''}
                </button>`;
              }
              const inOffer = this.yourOffer.items
                .filter((i) => i.itemId === s.itemId && typeof i.slotIndex !== 'number')
                .reduce((n, i) => n + i.quantity, 0);
              const available = s.quantity - inOffer;
              return `<button class="add-item" data-id="${s.itemId}" style="display:block;width:100%;text-align:left;padding:4px;margin:2px 0;background:#111;border:1px solid #335;color:#ccc;cursor:pointer;font-size:9px;" ${available <= 0 ? 'disabled' : ''}>
                + ${itemLabel(s.itemId)} (${available} free)
              </button>`;
            }).join('') || '<div style="color:#666;font-size:9px;">Empty inventory</div>'}
            <div style="margin-top:8px;font-size:9px;color:#adf;">
              ${this.yourOffer.items.map((i, offerIndex) => {
                return `<div>${itemLabel(i.itemId, i.slotIndex)}${typeof i.slotIndex === 'number' ? '' : ` ×${i.quantity}`} <button class="rm-item" data-offer="${offerIndex}" style="background:none;border:none;color:#f66;cursor:pointer;">×</button></div>`;
              }).join('') || 'Nothing offered yet'}
            </div>
          </div>
          <div style="border:1px solid #484;padding:8px;background:#081008;">
            <div style="color:#8f8;font-size:10px;margin-bottom:6px;">THEIR OFFER</div>
            <div style="font-size:9px;color:#ccc;">Coins: ${this.theirOffer.coins}</div>
            <div style="margin-top:8px;font-size:9px;color:#afa;">
              ${this.theirOffer.items.map((i) => {
                const ing = gameState.content?.ingredients.find((x) => x.id === i.itemId);
                const name = ing?.name ?? formatContentLabel(i.itemId);
                return `<div>${name}${typeof i.slotIndex === 'number' ? ' (unique)' : ` ×${i.quantity}`}</div>`;
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
        <div style="font-size:8px;color:#666;margin-top:8px;">Both players must accept. Manuscripts keep their writing when traded.</div>
      </div>`;

    document.getElementById('trade-close')!.onclick = () => this.cancel();
    document.getElementById('trade-cancel')!.onclick = () => this.cancel();
    document.getElementById('trade-update')!.onclick = () => this.pushOffer();
    document.getElementById('trade-accept')!.onclick = () => {
      network.send('trade_accept', { tradeId: this.tradeId, accepted: true });
    };

    this.root.querySelectorAll('.add-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const el = btn as HTMLElement;
        const itemId = el.dataset.id!;
        const slotRaw = el.dataset.slot;
        if (slotRaw != null) {
          const slotIndex = Number(slotRaw);
          if (this.yourOffer.items.some((item) => item.slotIndex === slotIndex)) return;
          this.yourOffer.items.push({ itemId, quantity: 1, slotIndex });
          this.pushOffer();
          return;
        }
        const slot = this.yourOffer.items.find((i) => i.itemId === itemId && typeof i.slotIndex !== 'number');
        if (slot) slot.quantity += 1;
        else this.yourOffer.items.push({ itemId, quantity: 1 });
        this.pushOffer();
      });
    });

    this.root.querySelectorAll('.rm-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const offerIndex = Number((btn as HTMLElement).dataset.offer);
        if (!Number.isFinite(offerIndex)) return;
        const item = this.yourOffer.items[offerIndex];
        if (!item) return;
        if (typeof item.slotIndex === 'number') {
          this.yourOffer.items = this.yourOffer.items.filter((_, index) => index !== offerIndex);
        } else {
          item.quantity -= 1;
          if (item.quantity <= 0) {
            this.yourOffer.items = this.yourOffer.items.filter((_, index) => index !== offerIndex);
          }
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
