import type { ContentNpc } from '@witchcraft/shared';
import { contentRegistry } from '../content/registry.js';
import { getWorldHour } from './world-clock.js';

/** Map location ids used by NPC schedules → scene interactable context */
const LOCATION_SCENE: Record<string, { scene: string; interactableIds?: string[]; shopIds?: string[] }> = {
  metaphysical_shop: { scene: 'town', shopIds: ['metaphysical_shop'] },
  grocery: { scene: 'town', shopIds: ['grocery_store'] },
  pharmacy: { scene: 'town', shopIds: ['pharmacy'] },
  library: { scene: 'town', interactableIds: ['npc_library'] },
  cafe: { scene: 'town', interactableIds: ['npc_cafe'] },
  study_circle: { scene: 'town', interactableIds: ['npc_circle'] },
  apartment_building: { scene: 'town', interactableIds: [] },
};

export function resolveNpcLocationAtHour(npc: ContentNpc, hour: number): string {
  const schedule = npc.schedule ?? [];
  if (!schedule.length) return npc.locationId;
  const sorted = [...schedule].sort((a, b) => a.hour - b.hour);
  let location = npc.locationId;
  for (const entry of sorted) {
    if (hour >= entry.hour) location = entry.locationId;
  }
  return location;
}

export function isNpcPresentAtLocation(npcId: string, contextLocationId: string, hour = getWorldHour()): boolean {
  const npc = contentRegistry.npcs.get(npcId);
  if (!npc) return true;
  const current = resolveNpcLocationAtHour(npc, hour);
  return current === contextLocationId;
}

export function getNpcContextLocation(interactableId: string, shopId?: string): string | null {
  if (shopId) {
    for (const shop of contentRegistry.shops.values()) {
      if (shop.id === shopId) return shop.locationId;
    }
  }
  const mapDefs = [...contentRegistry.maps.values()];
  for (const map of mapDefs) {
    const hit = map.interactables.find((i) => i.id === interactableId);
    if (!hit) continue;
    if (hit.type === 'npc' && hit.data?.npcId) {
      const npc = contentRegistry.npcs.get(hit.data.npcId as string);
      return npc?.locationId ?? null;
    }
  }
  return null;
}

export function isInteractableNpcAvailable(
  interactableType: string,
  data: Record<string, unknown> | undefined,
  interactableId: string
): { available: boolean; message?: string } {
  const hour = getWorldHour();
  if (interactableType === 'npc') {
    const npcId = data?.npcId as string | undefined;
    if (!npcId) return { available: true };
    const npc = contentRegistry.npcs.get(npcId);
    if (!npc) return { available: true };
    const loc = getNpcContextLocation(interactableId) ?? npc.locationId;
    if (!isNpcPresentAtLocation(npcId, loc, hour)) {
      return { available: false, message: `${npc.name} is not here right now.` };
    }
    return { available: true };
  }
  if (interactableType === 'shop') {
    const shopId = data?.shopId as string | undefined;
    const shop = shopId ? contentRegistry.shops.get(shopId) : undefined;
    if (shop?.npcId) {
      if (!isNpcPresentAtLocation(shop.npcId, shop.locationId, hour)) {
        const npc = contentRegistry.npcs.get(shop.npcId);
        return { available: false, message: `${npc?.name ?? 'The shopkeeper'} is away — try again later.` };
      }
    }
    if (shop?.openHours) {
      const open = shop.openHours as { start?: number; end?: number };
      if (typeof open.start === 'number' && hour < open.start) {
        return { available: false, message: 'This shop opens later today.' };
      }
      if (typeof open.end === 'number' && hour >= open.end) {
        return { available: false, message: 'This shop is closed for the evening.' };
      }
    }
  }
  return { available: true };
}

export function getUnavailableNpcInteractableIds(hour = getWorldHour()): string[] {
  const hidden: string[] = [];
  for (const map of contentRegistry.maps.values()) {
    for (const inter of map.interactables) {
      if (inter.type !== 'npc' || !inter.data?.npcId) continue;
      const npcId = inter.data.npcId as string;
      const npc = contentRegistry.npcs.get(npcId);
      if (!npc) continue;
      const loc = npc.locationId;
      if (!isNpcPresentAtLocation(npcId, loc, hour)) {
        hidden.push(inter.id);
      }
    }
  }
  return hidden;
}

export { LOCATION_SCENE };
