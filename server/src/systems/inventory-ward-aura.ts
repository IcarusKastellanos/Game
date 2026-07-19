import type { InventorySlot } from '@witchcraft/shared';

import {

  addItemToInventory,

  hasItemInInventory,

  removeItemFromInventory,

} from '@witchcraft/shared';



export class InventorySystem {

  addItem(

    inventory: InventorySlot[],

    itemId: string,

    quantity: number,

    metadata?: InventorySlot['metadata']

  ): InventorySlot[] {

    return addItemToInventory(inventory, itemId, quantity, metadata);

  }



  removeItem(

    inventory: InventorySlot[],

    itemId: string,

    quantity: number

  ): { inventory: InventorySlot[]; ok: boolean } {

    return removeItemFromInventory(inventory, itemId, quantity);

  }



  hasItem(inventory: InventorySlot[], itemId: string, quantity: number): boolean {

    return hasItemInInventory(inventory, itemId, quantity);

  }

}



export class WardSystem {

  createWard(params: Omit<import('@witchcraft/shared').WardState, 'id'>): import('@witchcraft/shared').WardState {

    return { id: `ward_${Date.now()}`, ...params };

  }



  /** Layered ward visualization data for client */

  getWardLayers(wards: import('@witchcraft/shared').WardState[]): { strength: number; color: string }[] {

    return wards

      .filter((w) => w.strength > 0)

      .map((w) => ({

        strength: w.strength,

        color: w.strength > 50 ? '#ffd700' : '#88ccff',

      }));

  }



  tickMaintenance(ward: import('@witchcraft/shared').WardState, energyAvailable: number): import('@witchcraft/shared').WardState | null {

    if (ward.permanent) return ward;

    if (ward.expiresAt && Date.now() > ward.expiresAt) {

      return null;

    }

    if (energyAvailable < ward.maintenanceCost) {

      return { ...ward, strength: ward.strength * 0.9 };

    }

    return ward;

  }

}



export class AuraSystem {

  /** Filter aura details based on observer's spiritual awareness */

  inspect(

    aura: import('@witchcraft/shared').AuraState,

    observerIntuition: number,

    observerAwareness: number

  ): Partial<import('@witchcraft/shared').AuraState> & { depth: 'surface' | 'deep' } {

    const deepThreshold = 40;

    const isDeep =

      observerIntuition >= deepThreshold || observerAwareness >= deepThreshold;



    if (!isDeep) {

      return {

        depth: 'surface',

        alignment: aura.alignment,

        moralityScore: aura.moralityScore,

        blessings: aura.blessings.slice(0, 2),

        hexes: aura.hexes.length > 0 ? [{ ...aura.hexes[0], name: 'Unknown hex' }] : [],

        protections: aura.protections,

        energeticDamage: aura.energeticDamage > 0 ? 1 : 0,

      };

    }



    return { ...aura, depth: 'deep' };

  }



  applyMoralityDelta(aura: import('@witchcraft/shared').AuraState, delta: number): import('@witchcraft/shared').AuraState {

    const score = Math.max(-100, Math.min(100, aura.moralityScore + delta));

    let alignment: import('@witchcraft/shared').AuraState['alignment'] = 'neutral';

    if (score > 20) alignment = 'benevolent';

    if (score < -20) alignment = 'malevolent';

    return { ...aura, moralityScore: score, alignment };

  }

}



export const inventorySystem = new InventorySystem();

export const wardSystem = new WardSystem();

export const auraSystem = new AuraSystem();


