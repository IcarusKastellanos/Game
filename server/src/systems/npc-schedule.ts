import type { ContentMapDefinition, NpcPublicPresence } from '@witchcraft/shared';
import {
  hiddenNpcPostIds,
  resolveNpcPresence,
  runtimeLayersHaveTiles,
  type NpcPostRef,
} from '@witchcraft/shared';
import { contentRegistry } from '../content/registry.js';
import { formatWorldHour as formatHour, getWorldHour, getWorldWeekday } from './world-clock.js';

const NPC_BLOCKING = new Set([
  'full',
  'partial',
  'polygon',
  'rectangle',
  'circle',
  'line_of_sight',
  'magic_block',
  'npc_only',
]);

export interface NpcWorldPayload {
  hour: number;
  weekday: number;
  hourLabel: string;
  hiddenNpcIds: string[];
  npcPresences: NpcPublicPresence[];
}

/** Last public observation. A restart clears it, so the next resolve snaps. */
const observed = new Map<string, NpcPublicPresence>();

/** Short-lived world cache so interact checks do not re-resolve every NPC. */
const WORLD_CACHE_MS = 200;
let worldCache: { hour: number; atMs: number; payload: NpcWorldPayload } | null = null;

export function currentNpcWorld(nowMs = Date.now(), opts?: { fresh?: boolean }): NpcWorldPayload {
  const hour = getWorldHour();
  if (
    !opts?.fresh &&
    worldCache &&
    worldCache.hour === hour &&
    nowMs - worldCache.atMs <= WORLD_CACHE_MS
  ) {
    return worldCache.payload;
  }
  const weekday = getWorldWeekday();
  const places = [...contentRegistry.npcPlaces.values()];
  const maps = [...contentRegistry.maps.values()];
  const bounds = maps.map((map) => ({ sceneId: map.sceneId, width: map.width, height: map.height }));
  const blocked = blockedTiles(maps);
  const presences: NpcPublicPresence[] = [];
  const seen = new Set<string>();
  for (const npc of contentRegistry.npcs.values()) {
    seen.add(npc.id);
    const presence = resolveNpcPresence({
      npc,
      places,
      maps: bounds,
      hour,
      weekday,
      nowMs,
      previous: observed.get(npc.id) ?? null,
      season: null,
      blocked,
    });
    observed.set(npc.id, presence);
    presences.push(presence);
  }
  for (const npcId of observed.keys()) {
    if (!seen.has(npcId)) observed.delete(npcId);
  }
  presences.sort((a, b) => a.npcId.localeCompare(b.npcId));
  const payload: NpcWorldPayload = {
    hour,
    weekday,
    hourLabel: formatHour(hour),
    hiddenNpcIds: hiddenNpcPostIds(presences, npcPosts(maps)),
    npcPresences: presences,
  };
  worldCache = { hour, atMs: nowMs, payload };
  return payload;
}

export function npcPresence(npcId: string, nowMs = Date.now()): NpcPublicPresence | undefined {
  return currentNpcWorld(nowMs).npcPresences.find((presence) => presence.npcId === npcId);
}

export function getUnavailableNpcInteractableIds(): string[] {
  return currentNpcWorld().hiddenNpcIds;
}

/** Invalidate cache after content reload or schedule overrides. */
export function invalidateNpcWorldCache(): void {
  worldCache = null;
}

export function npcWorldSignature(payload: NpcWorldPayload): string {
  const body = payload.npcPresences
    .map((presence) =>
      [
        presence.npcId,
        presence.scene,
        presence.location,
        presence.activity ?? '',
        presence.interaction,
        presence.visible,
        presence.indoors,
        presence.held,
        presence.moving,
        presence.moveStart ?? '',
        presence.moveEnd ?? '',
        presence.from ? `${presence.from.x},${presence.from.y}` : '',
        presence.to ? `${presence.to.x},${presence.to.y}` : '',
        presence.interactableId ?? '',
        presence.dialogueNodeId ?? '',
        presence.notice ?? '',
        presence.facing ?? '',
        presence.moving || !presence.tile ? '' : `${presence.tile.x},${presence.tile.y}`,
      ].join('|')
    )
    .join('\n');
  return `${payload.hour}|${payload.weekday}|${payload.hiddenNpcIds.join(',')}|${body}`;
}

export function isInteractableNpcAvailable(
  interactableType: string,
  data: Record<string, unknown> | undefined,
  interactableId: string
): { available: boolean; message?: string } {
  const hour = getWorldHour();
  if (interactableType === 'npc') {
    const npcId = typeof data?.npcId === 'string' ? data.npcId : '';
    if (!npcId) return { available: true };
    const npc = contentRegistry.npcs.get(npcId);
    const presence = npcPresence(npcId);
    if (!npc || !presence) return { available: true };
    if (!standingForTalk(presence, interactableId)) {
      return { available: false, message: awayMessage(npc.name, presence) };
    }
    return { available: true };
  }
  if (interactableType === 'shop') {
    const shopId = typeof data?.shopId === 'string' ? data.shopId : '';
    const shop = shopId ? contentRegistry.shops.get(shopId) : undefined;
    if (shop?.npcId) {
      const npc = contentRegistry.npcs.get(shop.npcId);
      const presence = npcPresence(shop.npcId);
      const atCounter =
        presence &&
        presence.location === shop.locationId &&
        standingForTalk(presence, interactableId);
      if (!atCounter) {
        return {
          available: false,
          message: awayMessage(npc?.name ?? 'The shopkeeper', presence),
        };
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

export function activityNoticeFor(npcId: string): string | undefined {
  const presence = currentNpcWorld().npcPresences.find((entry) => entry.npcId === npcId);
  if (!presence || presence.interaction !== 'busy') return undefined;
  return presence.notice;
}

function standingForTalk(presence: NpcPublicPresence, interactableId: string): boolean {
  return (
    presence.visible &&
    !presence.indoors &&
    !presence.held &&
    !presence.moving &&
    presence.interaction !== 'away' &&
    presence.interactableId === interactableId
  );
}

function awayMessage(name: string, presence: NpcPublicPresence | undefined): string {
  if (presence?.held) return `${name} is stopped and cannot be spoken with.`;
  return `${name} is not here right now.`;
}

function npcPosts(maps: ContentMapDefinition[]): NpcPostRef[] {
  const posts: NpcPostRef[] = [];
  for (const map of maps) {
    for (const inter of map.interactables) {
      const npcId = typeof inter.data?.npcId === 'string' ? inter.data.npcId : undefined;
      posts.push({ id: inter.id, type: inter.type, x: inter.x, y: inter.y, ...(npcId ? { npcId } : {}) });
    }
  }
  return posts;
}

function blockedTiles(maps: ContentMapDefinition[]): Set<string> {
  const blocked = new Set<string>();
  for (const map of maps) {
    const mark = (x: number, y: number) => blocked.add(`${map.sceneId}:${x},${y}`);
    if (runtimeLayersHaveTiles(map)) {
      for (let y = 0; y < map.height; y += 1) {
        for (let x = 0; x < map.width; x += 1) {
          if ((map.layers.walls[y]?.[x] ?? 0) > 0) mark(x, y);
        }
      }
    } else {
      for (let y = 0; y < map.height; y += 1) {
        for (let x = 0; x < map.width; x += 1) {
          if (x === 0 || y === 0 || x === map.width - 1 || y === map.height - 1) mark(x, y);
        }
      }
    }
    for (const cell of map.collision ?? []) {
      if (NPC_BLOCKING.has(cell.mode)) mark(cell.x, cell.y);
    }
  }
  return blocked;
}
