import type { InventorySlot } from '@witchcraft/shared';
import { MAX_ITEM_STACK } from '@witchcraft/shared';
import { inventorySystem } from './inventory-ward-aura.js';

export interface TradeSide {
  coins: number;
  items: { itemId: string; quantity: number }[];
}

export interface TradeSession {
  id: string;
  aSessionId: string;
  bSessionId: string;
  aOffer: TradeSide;
  bOffer: TradeSide;
  aAccepted: boolean;
  bAccepted: boolean;
}

export interface TradePlayerSnapshot {
  sessionId: string;
  displayName: string;
  inventory: InventorySlot[];
  coins: number;
}

export interface TradeExecuteResult {
  ok: boolean;
  error?: string;
  aInventory?: InventorySlot[];
  bInventory?: InventorySlot[];
  aCoins?: number;
  bCoins?: number;
}

function emptySide(): TradeSide {
  return { coins: 0, items: [] };
}

function sideValue(side: TradeSide): number {
  return side.coins + side.items.reduce((n, i) => n + i.quantity, 0);
}

function mergeItems(items: { itemId: string; quantity: number }[]): { itemId: string; quantity: number }[] {
  const map = new Map<string, number>();
  for (const item of items) {
    map.set(item.itemId, (map.get(item.itemId) ?? 0) + item.quantity);
  }
  return [...map.entries()].map(([itemId, quantity]) => ({ itemId, quantity }));
}

function canAfford(snapshot: TradePlayerSnapshot, offer: TradeSide): boolean {
  if (offer.coins > snapshot.coins) return false;
  for (const item of offer.items) {
    if (!inventorySystem.hasItem(snapshot.inventory, item.itemId, item.quantity)) return false;
  }
  return true;
}

function applyOffer(
  inventory: InventorySlot[],
  coins: number,
  give: TradeSide,
  receive: TradeSide
): { inventory: InventorySlot[]; coins: number } | null {
  let inv = inventory;
  for (const item of give.items) {
    const removed = inventorySystem.removeItem(inv, item.itemId, item.quantity);
    if (!removed.ok) return null;
    inv = removed.inventory;
  }
  for (const item of receive.items) {
    inv = inventorySystem.addItem(inv, item.itemId, item.quantity);
    const stacks = inv.filter((s) => s.itemId === item.itemId);
    const total = stacks.reduce((n, s) => n + s.quantity, 0);
    if (total > MAX_ITEM_STACK * stacks.length) return null;
  }
  const nextCoins = coins - give.coins + receive.coins;
  if (nextCoins < 0) return null;
  return { inventory: inv, coins: nextCoins };
}

export class TradeSystem {
  private sessions = new Map<string, TradeSession>();

  createRequest(initiatorSessionId: string, targetSessionId: string): TradeSession {
    for (const [id, session] of this.sessions) {
      if (
        session.aSessionId === initiatorSessionId ||
        session.bSessionId === initiatorSessionId ||
        session.aSessionId === targetSessionId ||
        session.bSessionId === targetSessionId
      ) {
        this.sessions.delete(id);
      }
    }

    const session: TradeSession = {
      id: `trade_${Date.now()}_${initiatorSessionId.slice(0, 4)}`,
      aSessionId: initiatorSessionId,
      bSessionId: targetSessionId,
      aOffer: emptySide(),
      bOffer: emptySide(),
      aAccepted: false,
      bAccepted: false,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  getForSession(sessionId: string): TradeSession | undefined {
    return [...this.sessions.values()].find(
      (s) => s.aSessionId === sessionId || s.bSessionId === sessionId
    );
  }

  getById(tradeId: string): TradeSession | undefined {
    return this.sessions.get(tradeId);
  }

  updateOffer(
    tradeId: string,
    sessionId: string,
    offer: TradeSide
  ): TradeSession | null {
    const session = this.sessions.get(tradeId);
    if (!session) return null;

    const normalized: TradeSide = {
      coins: Math.max(0, Math.floor(offer.coins ?? 0)),
      items: mergeItems(offer.items ?? []).filter((i) => i.quantity > 0),
    };

    if (session.aSessionId === sessionId) {
      session.aOffer = normalized;
      session.aAccepted = false;
      session.bAccepted = false;
    } else if (session.bSessionId === sessionId) {
      session.bOffer = normalized;
      session.aAccepted = false;
      session.bAccepted = false;
    } else {
      return null;
    }

    return session;
  }

  setAccepted(tradeId: string, sessionId: string, accepted: boolean): TradeSession | null {
    const session = this.sessions.get(tradeId);
    if (!session) return null;
    if (session.aSessionId === sessionId) session.aAccepted = accepted;
    else if (session.bSessionId === sessionId) session.bAccepted = accepted;
    else return null;
    return session;
  }

  cancel(tradeId: string, sessionId: string): boolean {
    const session = this.sessions.get(tradeId);
    if (!session) return false;
    if (session.aSessionId !== sessionId && session.bSessionId !== sessionId) return false;
    this.sessions.delete(tradeId);
    return true;
  }

  cancelForSession(sessionId: string): void {
    for (const [id, session] of this.sessions) {
      if (session.aSessionId === sessionId || session.bSessionId === sessionId) {
        this.sessions.delete(id);
      }
    }
  }

  tryExecute(
    tradeId: string,
    a: TradePlayerSnapshot,
    b: TradePlayerSnapshot
  ): TradeExecuteResult {
    const session = this.sessions.get(tradeId);
    if (!session) return { ok: false, error: 'Trade session ended.' };
    if (session.aSessionId !== a.sessionId || session.bSessionId !== b.sessionId) {
      return { ok: false, error: 'Trade participants mismatch.' };
    }
    if (!session.aAccepted || !session.bAccepted) {
      return { ok: false, error: 'Both traders must accept.' };
    }
    if (sideValue(session.aOffer) === 0 && sideValue(session.bOffer) === 0) {
      return { ok: false, error: 'Add items or coins to trade.' };
    }
    if (!canAfford(a, session.aOffer) || !canAfford(b, session.bOffer)) {
      return { ok: false, error: 'Someone cannot afford their side of the trade.' };
    }

    const aResult = applyOffer(a.inventory, a.coins, session.aOffer, session.bOffer);
    const bResult = applyOffer(b.inventory, b.coins, session.bOffer, session.aOffer);
    if (!aResult || !bResult) {
      return { ok: false, error: 'Trade could not be completed.' };
    }

    this.sessions.delete(tradeId);
    return {
      ok: true,
      aInventory: aResult.inventory,
      bInventory: bResult.inventory,
      aCoins: aResult.coins,
      bCoins: bResult.coins,
    };
  }
}

export const tradeSystem = new TradeSystem();
