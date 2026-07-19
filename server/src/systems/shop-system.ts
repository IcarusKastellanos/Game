import type { InventorySlot } from '@witchcraft/shared';
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
    playerMoney: number
  ): PurchaseResult {
    const shop = contentRegistry.shops.get(shopId);
    if (!shop) {
      return { success: false, message: 'Shop not found.' };
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

    const cost = listing.price * quantity;
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
