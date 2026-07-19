import type { FriendEntry, FriendPresence, FriendRequest, PlayerStats } from '@witchcraft/shared';
import { getPractitionerType, playerLevel } from '@witchcraft/shared';
import { prisma } from '../services/db.js';

export function parseFriends(raw: unknown): FriendEntry[] {
  return Array.isArray(raw) ? (raw as FriendEntry[]) : [];
}

export function parseFriendRequests(raw: unknown): FriendRequest[] {
  return Array.isArray(raw) ? (raw as FriendRequest[]) : [];
}

export function areFriends(a: FriendEntry[], bPlayerId: string): boolean {
  return a.some((f) => f.playerId === bPlayerId);
}

export async function loadFriendData(dbPlayerId: string): Promise<{
  friends: FriendEntry[];
  friendRequests: FriendRequest[];
}> {
  const row = await prisma.player.findUnique({
    where: { id: dbPlayerId },
    select: { friends: true, friendRequests: true },
  });
  return {
    friends: parseFriends(row?.friends),
    friendRequests: parseFriendRequests(row?.friendRequests),
  };
}

export async function saveFriendData(
  dbPlayerId: string,
  friends: FriendEntry[],
  friendRequests: FriendRequest[]
): Promise<void> {
  await prisma.player.update({
    where: { id: dbPlayerId },
    data: {
      friends: friends as never,
      friendRequests: friendRequests as never,
    },
  });
}

export async function sendFriendRequest(
  from: { dbPlayerId: string; username: string; displayName: string },
  targetUsername: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const target = await prisma.player.findUnique({
    where: { username: targetUsername.toLowerCase() },
    select: { id: true, username: true, displayName: true, friends: true, friendRequests: true },
  });
  if (!target) return { ok: false, error: 'No practitioner found with that username.' };
  if (target.id === from.dbPlayerId) return { ok: false, error: 'You cannot friend yourself.' };

  const myData = await loadFriendData(from.dbPlayerId);
  if (areFriends(myData.friends, target.id)) return { ok: false, error: 'Already friends.' };

  const theirRequests = parseFriendRequests(target.friendRequests);
  if (theirRequests.some((r) => r.fromPlayerId === from.dbPlayerId)) {
    return { ok: false, error: 'Friend request already pending.' };
  }

  theirRequests.push({
    fromPlayerId: from.dbPlayerId,
    fromUsername: from.username,
    fromDisplayName: from.displayName,
    sentAt: Date.now(),
  });
  await saveFriendData(target.id, parseFriends(target.friends), theirRequests);
  return { ok: true };
}

export async function respondFriendRequest(
  dbPlayerId: string,
  fromPlayerId: string,
  accept: boolean
): Promise<{ ok: true; friend?: FriendEntry } | { ok: false; error: string }> {
  const me = await prisma.player.findUnique({
    where: { id: dbPlayerId },
    select: { id: true, username: true, displayName: true, friends: true, friendRequests: true },
  });
  if (!me) return { ok: false, error: 'Player not found.' };

  const requests = parseFriendRequests(me.friendRequests);
  const idx = requests.findIndex((r) => r.fromPlayerId === fromPlayerId);
  if (idx < 0) return { ok: false, error: 'No pending request from that player.' };

  const [req] = requests.splice(idx, 1);
  const myFriends = parseFriends(me.friends);

  if (!accept) {
    await saveFriendData(dbPlayerId, myFriends, requests);
    return { ok: true };
  }

  const other = await prisma.player.findUnique({
    where: { id: fromPlayerId },
    select: { id: true, username: true, displayName: true, friends: true, friendRequests: true },
  });
  if (!other) return { ok: false, error: 'Requester no longer exists.' };

  const since = Date.now();
  myFriends.push({
    playerId: other.id,
    username: other.username,
    displayName: other.displayName,
    since,
  });

  const theirFriends = parseFriends(other.friends);
  if (!areFriends(theirFriends, dbPlayerId)) {
    theirFriends.push({
      playerId: me.id,
      username: me.username,
      displayName: me.displayName,
      since,
    });
    await saveFriendData(other.id, theirFriends, parseFriendRequests(other.friendRequests));
  }

  await saveFriendData(dbPlayerId, myFriends, requests);
  return {
    ok: true,
    friend: myFriends.find((f) => f.playerId === fromPlayerId),
  };
}

export async function removeFriend(dbPlayerId: string, friendPlayerId: string): Promise<void> {
  const me = await loadFriendData(dbPlayerId);
  const next = me.friends.filter((f) => f.playerId !== friendPlayerId);
  await saveFriendData(dbPlayerId, next, me.friendRequests);

  const other = await loadFriendData(friendPlayerId);
  await saveFriendData(
    friendPlayerId,
    other.friends.filter((f) => f.playerId !== dbPlayerId),
    other.friendRequests
  );
}

export async function buildFriendPresenceList(
  friends: FriendEntry[],
  onlineLookup: (playerId: string) => { scene: string; stats: PlayerStats } | null
): Promise<FriendPresence[]> {
  const offlineStats = new Map<string, PlayerStats>();
  const missing = friends.filter((f) => !onlineLookup(f.playerId));
  if (missing.length) {
    const rows = await prisma.playerStats.findMany({
      where: { playerId: { in: missing.map((m) => m.playerId) } },
    });
    for (const row of rows) {
      offlineStats.set(row.playerId, {
        health: row.health,
        hunger: row.hunger,
        magicalEnergy: row.magicalEnergy,
        protection: row.protection,
        intuition: row.intuition,
        spiritualAwareness: row.spiritualAwareness,
        divinationSkill: row.divinationSkill,
        herbalism: row.herbalism,
        cursecraft: row.cursecraft,
        warding: row.warding,
        healing: row.healing,
        ritualSkill: row.ritualSkill,
        experience: row.experience,
        reputation: row.reputation,
        morality: row.morality,
        affinities: row.affinities as PlayerStats['affinities'],
        specialty: row.specialty as PlayerStats['specialty'],
      });
    }
  }

  return friends.map((f) => {
    const online = onlineLookup(f.playerId);
    const stats = online?.stats ?? offlineStats.get(f.playerId);
    return {
      ...f,
      online: !!online,
      level: stats ? playerLevel(stats.experience) : 1,
      practitionerType: stats ? getPractitionerType(stats) : 'Practitioner',
      scene: online?.scene as FriendPresence['scene'],
    };
  });
}
