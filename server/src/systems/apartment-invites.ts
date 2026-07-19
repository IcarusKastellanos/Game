export interface ApartmentInvite {
  id: string;
  hostDbPlayerId: string;
  hostSessionId: string;
  hostName: string;
  guestDbPlayerId: string;
  guestSessionId?: string;
  createdAt: number;
}

const invites = new Map<string, ApartmentInvite>();
const INVITE_TTL_MS = 5 * 60 * 1000;

export function createApartmentInvite(
  host: { dbPlayerId: string; sessionId: string; displayName: string },
  guest: { dbPlayerId: string; sessionId?: string }
): ApartmentInvite {
  purgeExpired();
  for (const [id, inv] of invites) {
    if (inv.hostDbPlayerId === host.dbPlayerId && inv.guestDbPlayerId === guest.dbPlayerId) {
      invites.delete(id);
    }
  }
  const invite: ApartmentInvite = {
    id: `apt_${Date.now()}_${host.sessionId.slice(0, 4)}`,
    hostDbPlayerId: host.dbPlayerId,
    hostSessionId: host.sessionId,
    hostName: host.displayName,
    guestDbPlayerId: guest.dbPlayerId,
    guestSessionId: guest.sessionId,
    createdAt: Date.now(),
  };
  invites.set(invite.id, invite);
  return invite;
}

export function getApartmentInvite(id: string): ApartmentInvite | undefined {
  purgeExpired();
  return invites.get(id);
}

export function removeApartmentInvite(id: string): void {
  invites.delete(id);
}

function purgeExpired(): void {
  const now = Date.now();
  for (const [id, inv] of invites) {
    if (now - inv.createdAt > INVITE_TTL_MS) invites.delete(id);
  }
}
