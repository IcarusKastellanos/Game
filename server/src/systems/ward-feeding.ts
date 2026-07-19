import type { AuraEffect, AuraState, InventorySlot, WardState } from '@witchcraft/shared';

import { resolveDisplayLabel } from '@witchcraft/shared';



export const EVERWEED_ITEM_ID = 'everweed';

export const EVERWEED_INIT_ME_COST = 20;

export const FEED_TIME_EXTENSION_MS = 15 * 60 * 1000;

export const FEED_STRENGTH_DELTA = 0.5;



export function ritualHasEverweed(

  pentacleSlots?: { itemId: string; quantity: number }[],

  augmentSlots?: { itemId: string; quantity: number }[]

): boolean {

  const slots = [...(pentacleSlots ?? []), ...(augmentSlots ?? [])];

  return slots.some((s) => s.itemId === EVERWEED_ITEM_ID && s.quantity > 0);

}



/** ME cost for one feed — scales 5–15 with base ward strength */

export function feedMeCost(strength: number, maintenanceCost?: number): number {

  const scaled =

    maintenanceCost !== undefined

      ? Math.round(maintenanceCost * 1.6 + 3)

      : Math.round(5 + strength / 12);

  return Math.max(5, Math.min(15, scaled));

}



export type FeedTargetKind = 'apartment' | 'aura_ward' | 'protection';



export interface FeedWardContext {

  stats: { magicalEnergy: number };

  inventory: InventorySlot[];

  apartmentWards: WardState[];

  aura: AuraState;

}



export interface FeedWardResult {

  ok: boolean;

  message: string;

  meCost: number;

  stats?: { magicalEnergy: number };

  inventory?: InventorySlot[];

  apartmentWards?: WardState[];

  aura?: AuraState;

}



function applyFeedValues(

  strength: number,

  expiresAt: number | undefined,

  maintenanceCost: number | undefined,

  permanent?: boolean

):

  | { ok: false; message: string }

  | {

      ok: true;

      meCost: number;

      strength: number;

      expiresAt: number | undefined;

      strengthOnly: boolean;

    } {

  const meCost = feedMeCost(strength, maintenanceCost);

  if (permanent) {

    return {

      ok: true,

      meCost,

      strength: strength + FEED_STRENGTH_DELTA,

      expiresAt: undefined,

      strengthOnly: true,

    };

  }

  return {

    ok: true,

    meCost,

    strength: strength + FEED_STRENGTH_DELTA,

    expiresAt: (expiresAt ?? Date.now()) + FEED_TIME_EXTENSION_MS,

    strengthOnly: false,

  };

}



function feedMessage(label: string, feed: { meCost: number; strengthOnly: boolean }): string {

  if (feed.strengthOnly) {

    return `${label} fed (+0.5 strength, ${feed.meCost} ME — Everweed-bound, no timer).`;

  }

  return `${label} fed (+0.5 strength, +15 min, ${feed.meCost} ME).`;

}



export function feedWardTarget(ctx: FeedWardContext, kind: FeedTargetKind, targetId: string): FeedWardResult {

  let stats = { ...ctx.stats };

  const inventory = ctx.inventory;

  let apartmentWards = [...ctx.apartmentWards];

  let aura: AuraState = {

    ...ctx.aura,

    wards: [...ctx.aura.wards],

    protections: [...ctx.aura.protections],

  };



  if (kind === 'apartment') {

    const idx = apartmentWards.findIndex((w) => w.id === targetId);

    if (idx < 0) return { ok: false, message: 'Apartment ward not found.', meCost: 0 };

    const ward = apartmentWards[idx];

    const feed = applyFeedValues(ward.strength, ward.expiresAt, ward.maintenanceCost, ward.permanent);

    if (!feed.ok) return { ok: false, message: feed.message, meCost: 0 };

    if (stats.magicalEnergy < feed.meCost) {

      return { ok: false, message: `Feeding costs ${feed.meCost} ME.`, meCost: 0 };

    }

    stats.magicalEnergy -= feed.meCost;

    apartmentWards[idx] = {

      ...ward,

      strength: feed.strength,

      expiresAt: feed.strengthOnly ? ward.expiresAt : feed.expiresAt,

    };

    return {

      ok: true,

      message: feedMessage('Apartment ward', feed),

      meCost: feed.meCost,

      stats,

      inventory,

      apartmentWards,

      aura,

    };

  }



  if (kind === 'aura_ward') {

    const idx = aura.wards.findIndex((w) => w.id === targetId);

    if (idx < 0) return { ok: false, message: 'Aura ward not found.', meCost: 0 };

    const effect = aura.wards[idx];

    const feed = applyFeedValues(effect.strength, effect.expiresAt, undefined, effect.permanent);

    if (!feed.ok) return { ok: false, message: feed.message, meCost: 0 };

    if (stats.magicalEnergy < feed.meCost) {

      return { ok: false, message: `Feeding costs ${feed.meCost} ME.`, meCost: 0 };

    }

    stats.magicalEnergy -= feed.meCost;

    aura.wards[idx] = {

      ...effect,

      strength: feed.strength,

      expiresAt: feed.strengthOnly ? effect.expiresAt : feed.expiresAt,

    };

    return {

      ok: true,

      message: feedMessage(resolveDisplayLabel(effect.name, effect.spellId), feed),

      meCost: feed.meCost,

      stats,

      inventory,

      apartmentWards,

      aura,

    };

  }



  const idx = aura.protections.findIndex((p) => p.id === targetId);

  if (idx < 0) return { ok: false, message: 'Protection not found.', meCost: 0 };

  const effect = aura.protections[idx];

  const feed = applyFeedValues(effect.strength, effect.expiresAt, undefined, effect.permanent);

  if (!feed.ok) return { ok: false, message: feed.message, meCost: 0 };

  if (stats.magicalEnergy < feed.meCost) {

    return { ok: false, message: `Feeding costs ${feed.meCost} ME.`, meCost: 0 };

  }

  stats.magicalEnergy -= feed.meCost;

  aura.protections[idx] = {

    ...effect,

    strength: feed.strength,

    expiresAt: feed.strengthOnly ? effect.expiresAt : feed.expiresAt,

  };

  return {

    ok: true,

    message: feedMessage(resolveDisplayLabel(effect.name, effect.spellId), feed),

    meCost: feed.meCost,

    stats,

    inventory,

    apartmentWards,

    aura,

  };

}

