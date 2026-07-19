import type { ContentMapDefinition } from '@witchcraft/shared';
import { mergePublishedMapsIntoRegistry } from '../admin/services/map-builder/index.js';
import { broadcastLiveMapsToAllClients } from '../rooms/game-room-registry.js';
import { prisma } from '../services/db.js';
import { CANONICAL_WORLD_MAP_IDS } from './canonical-maps.js';
import { contentRegistry } from './registry.js';

let liveMapsRevision = 1;

export function getLiveMapsRevision(): number {
  return liveMapsRevision;
}

export async function refreshLiveMapsFromDatabase(): Promise<{ merged: number; warnings: string[] }> {
  const merged = await mergePublishedMapsIntoRegistry();
  const warnings: string[] = [];

  for (const id of CANONICAL_WORLD_MAP_IDS) {
    const row = await prisma.mapProject.findUnique({ where: { id } });
    if (row && row.status !== 'published') {
      warnings.push(`${row.displayName} is still a draft — publish it before pushing to players.`);
    }
  }

  return { merged, warnings };
}

export function collectLiveMapsForClients(): ContentMapDefinition[] {
  return [...contentRegistry.maps.values()].map((m) => structuredClone(m));
}

export async function pushLiveMapsToAllClients(opts?: { resnapSpawns?: boolean }): Promise<{
  ok: true;
  revision: number;
  merged: number;
  clientsNotified: number;
  warnings: string[];
}> {
  const { merged, warnings } = await refreshLiveMapsFromDatabase();
  liveMapsRevision += 1;
  const maps = collectLiveMapsForClients();
  const resnapSpawns = opts?.resnapSpawns ?? true;
  const clientsNotified = broadcastLiveMapsToAllClients({ maps, revision: liveMapsRevision, resnapSpawns });

  return { ok: true, revision: liveMapsRevision, merged, clientsNotified, warnings };
}
