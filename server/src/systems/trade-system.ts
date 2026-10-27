import type { InventorySlot } from '@witchcraft/shared';
import { isEmptyInventorySlot, MAX_ITEM_STACK, takeInventorySlot } from '@witchcraft/shared';
import { inventorySystem } from './inventory-ward-aura.js';

export interface TradeItemOffer {
  itemId: string;
  quantity: number;
  /** When set, moves that exact inventory slot (keeps manuscript metadata). */
  slotIndex?: number;
}

export interface TradeSide {
  coins: number;
  items: TradeItemOffer[];
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

function normalizeItems(items: TradeItemOffer[]): TradeItemOffer[] {
  const bulk = new Map<string, number>();
  const unique: TradeItemOffer[] = [];
  for (const item of items ?? []) {
    const itemId = String(item.itemId ?? '').trim();
    const quantity = Math.max(0, Math.floor(Number(item.quantity) || 0));
    if (!itemId || quantity <= 0) continue;
    if (typeof item.slotIndex === 'number' && Number.isFinite(item.slotIndex)) {
      unique.push({ itemId, quantity: 1, slotIndex: Math.floor(item.slotIndex) });
      continue;
    }
    bulk.set(itemId, (bulk.get(itemId) ?? 0) + quantity);
  }
  return [...unique, ...[...bulk.entries()].map(([itemId, quantity]) => ({ itemId, quantity }))];
}

function hasUniqueMeta(slot: InventorySlot): boolean {
  if (!slot.metadata) return false;
  return Object.keys(slot.metadata).some((key) => key !== 'slotIndex');
}

function canAfford(snapshot: TradePlayerSnapshot, offer: TradeSide): boolean {
  if (offer.coins > snapshot.coins) return false;
  const reserved = new Set<number>();
  const needed = new Map<string, number>();
  for (const item of offer.items) {
    if (typeof item.slotIndex === 'number') {
      if (reserved.has(item.slotIndex)) return false;
      const slot = snapshot.inventory[item.slotIndex];
      if (!slot || isEmptyInventorySlot(slot) || slot.itemId !== item.itemId) return false;
      reserved.add(item.slotIndex);
      continue;
    }
    needed.set(item.itemId, (needed.get(item.itemId) ?? 0) + item.quantity);
  }
  for (const [itemId, quantity] of needed) {
    let available = 0;
    for (let index = 0; index < snapshot.inventory.length; index++) {
      if (reserved.has(index)) continue;
      const slot = snapshot.inventory[index];
      if (isEmptyInventorySlot(slot) || slot.itemId !== itemId) continue;
      if (hasUniqueMeta(slot)) continue;
      available += slot.quantity;
    }
    if (available < quantity) return false;
  }
  return true;
}

function transferOffers(
  fromInventory: InventorySlot[],
  toInventory: InventorySlot[],
  offer: TradeSide
): { from: InventorySlot[]; to: InventorySlot[] } | null {
  let from = fromInventory;
  let to = toInventory;
  for (const item of offer.items) {
    if (typeof item.slotIndex === 'number') {
      const taken = takeInventorySlot(from, item.slotIndex);
      if (!taken.slot || taken.slot.itemId !== item.itemId) return null;
      from = taken.inventory;
      to = inventorySystem.addItem(to, taken.slot.itemId, 1, taken.slot.metadata);
      continue;
    }
    const removed = inventorySystem.removeItem(from, item.itemId, item.quantity);
    if (!removed.ok) return null;
    from = removed.inventory;
    to = inventorySystem.addItem(to, item.itemId, item.quantity);
    const stacks = to.filter((s) => s.itemId === item.itemId);
    const total = stacks.reduce((n, s) => n + s.quantity, 0);
    if (total > MAX_ITEM_STACK * Math.max(1, stacks.length)) return null;
  }
  return { from, to };
}

function cloneInventory(inventory: InventorySlot[]): InventorySlot[] {
  return inventory.map((slot) => ({
    ...slot,
    metadata: slot.metadata ? { ...slot.metadata } : undefined,
  }));
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

  updateOffer(tradeId: string, sessionId: string, offer: TradeSide): TradeSession | null {
    const session = this.sessions.get(tradeId);
    if (!session) return null;

    const normalized: TradeSide = {
      coins: Math.max(0, Math.floor(offer.coins ?? 0)),
      items: normalizeItems(offer.items ?? []),
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

  tryExecute(tradeId: string, a: TradePlayerSnapshot, b: TradePlayerSnapshot): TradeExecuteResult {
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

    let aInv = cloneInventory(a.inventory);
    let bInv = cloneInventory(b.inventory);

    const aGives = transferOffers(aInv, bInv, session.aOffer);
    if (!aGives) return { ok: false, error: 'Trade could not be completed.' };
    aInv = aGives.from;
    bInv = aGives.to;

    const bGives = transferOffers(bInv, aInv, session.bOffer);
    if (!bGives) return { ok: false, error: 'Trade could not be completed.' };
    bInv = bGives.from;
    aInv = bGives.to;

    const aCoins = a.coins - session.aOffer.coins + session.bOffer.coins;
    const bCoins = b.coins - session.bOffer.coins + session.aOffer.coins;
    if (aCoins < 0 || bCoins < 0) return { ok: false, error: 'Trade could not be completed.' };

    this.sessions.delete(tradeId);
    return {
      ok: true,
      aInventory: aInv,
      bInventory: bInv,
      aCoins,
      bCoins,
    };
  }
}

export const tradeSystem = new TradeSystem();
