import type { GameRoom } from './GameRoom.js';
import type { ContentMapDefinition } from '@witchcraft/shared';

const rooms = new Set<GameRoom>();

export function registerGameRoom(room: GameRoom): void {
  rooms.add(room);
}

export function unregisterGameRoom(room: GameRoom): void {
  rooms.delete(room);
}

/** Push DB/admin changes to an online player in any active room */
export async function syncOnlinePlayerByDbId(dbPlayerId: string): Promise<boolean> {
  for (const room of rooms) {
    const synced = await room.syncPlayerFromDb(dbPlayerId);
    if (synced) return true;
  }
  return false;
}

/** Shatter a ward in live game rooms — returns true if handled online */
export function shatterWardInLiveRooms(wardId: string, adminName: string): boolean {
  for (const room of rooms) {
    if (room.adminShatterWard(wardId, adminName)) return true;
  }
  return false;
}

/** Push the authoritative NPC world after a content reload. */
export function broadcastNpcWorldState(): number {
  let clients = 0;
  for (const room of rooms) {
    room.publishNpcWorld(true);
    clients += room.clients.length;
  }
  return clients;
}

export function broadcastLiveMapsToAllClients(payload: {
  maps: ContentMapDefinition[];
  revision: number;
  resnapSpawns: boolean;
}): number {
  let count = 0;
  for (const room of rooms) {
    count += room.pushLiveMapsUpdate(payload);
  }
  return count;
}
