import type { GameRoom } from '../rooms/GameRoom.js';
import type { PlayerStats } from '@witchcraft/shared';

export interface OnlinePlayerRef {
  sessionId: string;
  dbPlayerId: string;
  displayName: string;
  username: string;
  scene: string;
  stats: PlayerStats;
  room: GameRoom;
}

const rooms = new Set<GameRoom>();

export function registerPresenceRoom(room: GameRoom): void {
  rooms.add(room);
}

export function unregisterPresenceRoom(room: GameRoom): void {
  rooms.delete(room);
}

export function findOnlineByDbPlayerId(dbPlayerId: string): OnlinePlayerRef | undefined {
  for (const room of rooms) {
    const hit = room.findPlayerByDbId(dbPlayerId);
    if (hit) return { ...hit, room };
  }
  return undefined;
}

export function findOnlineBySessionId(sessionId: string): OnlinePlayerRef | undefined {
  for (const room of rooms) {
    const hit = room.findPlayerBySessionId(sessionId);
    if (hit) return { ...hit, room };
  }
  return undefined;
}

export function listAllOnline(): OnlinePlayerRef[] {
  const list: OnlinePlayerRef[] = [];
  for (const room of rooms) {
    list.push(...room.listOnlinePlayers().map((p) => ({ ...p, room })));
  }
  return list;
}
