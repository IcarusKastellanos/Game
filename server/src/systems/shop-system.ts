import type { ContentShop, InventorySlot, PlayerStats } from '@witchcraft/shared';
import {
  canTradePublicly,
  defaultProgression,
  getPublicReputation,
  getSpiritualReputation,
  meetsSpiritualGate,
  meetsMinLevel,
  levelGateMessage,
  playerLevel,
  recognitionUnlocksVendor,
  type PlayerProgression,
} from '@witchcraft/shared';
import { contentRegistry } from '../content/registry.js';
import { inventorySystem } from './inventory-ward-aura.js';

export interface PurchaseResult {
  success: boolean;
  message: string;
  inventory?: InventorySlot[];
  cost?: number;
  /** Updated per-player progression when stock changed. */
  progression?: PlayerProgression;
  /** Effective shelf counts for this shop after the purchase. */
  stock?: { itemId: string; stock: number }[];
}

export type ShopStockSnapshot = {
  shopId: string;
  inventory: { itemId: string; stock: number }[];
}[];

function localDayKey(date = new Date()): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** Shop transactions — content stock is the daily baseline; each player tracks their own shelves. */
export class ShopSystem {
  /** Baseline shelf counts from content (never mutated by purchases). */
  private baseStock = new Map<string, Map<string, number>>();

  /** Snapshot listing stock from current registry contents as the daily baseline. */
  captureBaselines(shops: Iterable<ContentShop> = contentRegistry.shops.values()): void {
    this.baseStock.clear();
    for (const shop of shops) {
      const items = new Map<string, number>();
      for (const listing of shop.inventory) {
        items.set(listing.itemId, listing.stock);
      }
      this.baseStock.set(shop.id, items);
    }
  }

  baselineStock(shopId: string, itemId: string): number {
    if (this.baseStock.size === 0) this.captureBaselines();
    const fromCache = this.baseStock.get(shopId)?.get(itemId);
    if (fromCache != null) return fromCache;
    const listing = contentRegistry.shops.get(shopId)?.inventory.find((i) => i.itemId === itemId);
    return listing?.stock ?? 0;
  }

  /** How many of this listing the player can still buy today. */
  availableStock(progression: PlayerProgression | undefined, shopId: string, itemId: string): number {
    const personal = progression?.shopStock?.[shopId]?.[itemId];
    if (typeof personal === 'number' && Number.isFinite(personal)) {
      return Math.max(0, Math.floor(personal));
    }
    return this.baselineStock(shopId, itemId);
  }

  /**
   * Clear personal depletion so every listing falls back to content baseline.
   * Records the restock day so noon only fires once per player per day.
   */
  restockPlayer(progression: PlayerProgression, dayKey = localDayKey()): PlayerProgression {
    if (progression.shopStockDay === dayKey && (!progression.shopStock || Object.keys(progression.shopStock).length === 0)) {
      return progression;
    }
    return {
      ...progression,
      shopStock: {},
      shopStockDay: dayKey,
    };
  }

  /** If local hour is past noon and this player has not restocked today, refill their shelves. */
  ensureRestocked(progression: PlayerProgression, hour: number, dayKey = localDayKey()): PlayerProgression {
    if (hour < 12) return progression;
    if (progression.shopStockDay === dayKey) return progression;
    return this.restockPlayer(progression, dayKey);
  }

  /** Effective stock for one player across all shops (for client sync). */
  playerStockSnapshot(progression: PlayerProgression | undefined): ShopStockSnapshot {
    if (this.baseStock.size === 0) this.captureBaselines();
    return [...contentRegistry.shops.values()].map((shop) => ({
      shopId: shop.id,
      inventory: shop.inventory.map((listing) => ({
        itemId: listing.itemId,
        stock: this.availableStock(progression, shop.id, listing.itemId),
      })),
    }));
  }

  shopStockForPlayer(
    progression: PlayerProgression | undefined,
    shopId: string
  ): { itemId: string; stock: number }[] | undefined {
    const shop = contentRegistry.shops.get(shopId);
    if (!shop) return undefined;
    return shop.inventory.map((listing) => ({
      itemId: listing.itemId,
      stock: this.availableStock(progression, shopId, listing.itemId),
    }));
  }

  buy(
    shopId: string,
    itemId: string,
    quantity: number,
    playerInventory: InventorySlot[],
    playerMoney: number,
    priceMultiplier = 1,
    stats?: PlayerStats,
    progression?: PlayerProgression
  ): PurchaseResult {
    const shop = contentRegistry.shops.get(shopId);
    if (!shop) {
      return { success: false, message: 'Shop not found.' };
    }

    if (progression && !recognitionUnlocksVendor(shopId, progression)) {
      return {
        success: false,
        message: 'This vendor only deals with practitioners of higher recognition.',
      };
    }

    if (stats && !canTradePublicly(stats)) {
      return {
        success: false,
        message: 'The shopkeeper refuses to deal with someone of your reputation.',
      };
    }

    if (stats && shop.minPublicReputation != null && getPublicReputation(stats) < shop.minPublicReputation) {
      return { success: false, message: 'You are not welcome in this shop yet.' };
    }
    if (
      stats &&
      shop.minSpiritualReputation != null &&
      getSpiritualReputation(stats) < shop.minSpiritualReputation
    ) {
      return {
        success: false,
        message: 'They only sell to practitioners of standing in the circles.',
      };
    }
    if (stats && shop.minLevel != null && !meetsMinLevel(stats.experience ?? 0, shop.minLevel)) {
      return {
        success: false,
        message: levelGateMessage(shop.name, shop.minLevel, playerLevel(stats.experience ?? 0)),
      };
    }

    const listing = shop.inventory.find((i) => i.itemId === itemId);
    if (!listing) {
      return { success: false, message: 'Item not sold here.' };
    }

    const itemDef = contentRegistry.ingredients.get(itemId);
    if (itemDef?.adminOnly) {
      return { success: false, message: 'That item is not available for purchase.' };
    }

    const available = this.availableStock(progression, shopId, itemId);
    if (available < quantity) {
      return { success: false, message: 'Not enough stock.' };
    }

    if (stats) {
      if (listing.minPublicReputation != null && getPublicReputation(stats) < listing.minPublicReputation) {
        return { success: false, message: 'They will not sell that to you yet.' };
      }
      if (
        listing.minSpiritualReputation != null &&
        getSpiritualReputation(stats) < listing.minSpiritualReputation
      ) {
        return {
          success: false,
          message: 'Your occult standing is too low for that listing.',
        };
      }
      // Default rare-vendor gate for Everweed when the listing has no explicit threshold.
      if (
        itemId === 'everweed' &&
        listing.minSpiritualReputation == null &&
        !meetsSpiritualGate(stats, 'rareVendorAbove')
      ) {
        return {
          success: false,
          message: 'Everweed is reserved for practitioners trusted in the circles.',
        };
      }
      if (listing.minLevel != null && !meetsMinLevel(stats.experience ?? 0, listing.minLevel)) {
        return {
          success: false,
          message: levelGateMessage(
            itemDef?.name ?? itemId,
            listing.minLevel,
            playerLevel(stats.experience ?? 0)
          ),
        };
      }
    }

    const mult = Number.isFinite(priceMultiplier) && priceMultiplier > 0 ? priceMultiplier : 1;
    const cost = Math.max(1, Math.round(listing.price * quantity * mult));
    if (playerMoney < cost) {
      return { success: false, message: 'Not enough coins.' };
    }

    const remaining = available - quantity;
    const baseProg = progression ?? defaultProgression();
    const prevShop = baseProg.shopStock?.[shopId] ?? {};
    const nextProgression: PlayerProgression = {
      ...baseProg,
      shopStock: {
        ...(baseProg.shopStock ?? {}),
        [shopId]: {
          ...prevShop,
          [itemId]: remaining,
        },
      },
    };

    const inventory = inventorySystem.addItem(playerInventory, itemId, quantity);
    const item = contentRegistry.ingredients.get(itemId);

    return {
      success: true,
      message: `Purchased ${quantity}x ${item?.name ?? itemId}.`,
      inventory,
      cost,
      progression: nextProgression,
      stock: this.shopStockForPlayer(nextProgression, shopId),
    };
  }
}

export const shopSystem = new ShopSystem();

export { localDayKey };
