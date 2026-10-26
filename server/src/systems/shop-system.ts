import type { InventorySlot, PlayerStats } from '@witchcraft/shared';
import {
  canTradePublicly,
  getPublicReputation,
  getSpiritualReputation,
  meetsSpiritualGate,
} from '@witchcraft/shared';
import { contentRegistry } from '../content/registry.js';
import { inventorySystem } from './inventory-ward-aura.js';

export interface PurchaseResult {
  success: boolean;
  message: string;
  inventory?: InventorySlot[];
  cost?: number;
}

/** Shop transactions — inventory driven from content registry */
export class ShopSystem {
  buy(
    shopId: string,
    itemId: string,
    quantity: number,
    playerInventory: InventorySlot[],
    playerMoney: number,
    priceMultiplier = 1,
    stats?: PlayerStats
  ): PurchaseResult {
    const shop = contentRegistry.shops.get(shopId);
    if (!shop) {
      return { success: false, message: 'Shop not found.' };
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

    const listing = shop.inventory.find((i) => i.itemId === itemId);
    if (!listing) {
      return { success: false, message: 'Item not sold here.' };
    }

    const itemDef = contentRegistry.ingredients.get(itemId);
    if (itemDef?.adminOnly) {
      return { success: false, message: 'That item is not available for purchase.' };
    }
    if (listing.stock < quantity) {
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
    }

    const mult = Number.isFinite(priceMultiplier) && priceMultiplier > 0 ? priceMultiplier : 1;
    const cost = Math.max(1, Math.round(listing.price * quantity * mult));
    if (playerMoney < cost) {
      return { success: false, message: 'Not enough coins.' };
    }

    listing.stock -= quantity;
    const inventory = inventorySystem.addItem(playerInventory, itemId, quantity);
    const item = contentRegistry.ingredients.get(itemId);

    return {
      success: true,
      message: `Purchased ${quantity}x ${item?.name ?? itemId}.`,
      inventory,
      cost,
    };
  }
}

export const shopSystem = new ShopSystem();
