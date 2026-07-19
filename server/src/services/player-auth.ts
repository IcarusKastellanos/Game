import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { formatDisplayName, normalizeUsername, validateDisplayName, validateUsername } from '@witchcraft/shared';
import { prisma } from './db.js';

const JWT_SECRET = process.env.PLAYER_JWT_SECRET ?? process.env.ADMIN_JWT_SECRET ?? 'dev-player-secret-change-me';
const JWT_EXPIRY = '7d';

export interface PlayerTokenPayload {
  playerId: string;
  username: string;
}

export async function registerPlayer(
  username: string,
  password: string,
  displayName?: string
): Promise<{ token: string; username: string; displayName: string } | { error: string }> {
  const user = normalizeUsername(username);
  const userErr = validateUsername(user);
  if (userErr) return { error: userErr };
  if (password.length < 6) return { error: 'Password must be at least 6 characters.' };

  const formattedName = formatDisplayName(displayName ?? user);
  const nameErr = validateDisplayName(formattedName);
  if (nameErr) return { error: nameErr };

  const existing = await prisma.player.findUnique({ where: { username: user } });
  if (existing?.passwordHash) return { error: 'Username already taken.' };

  const hash = await bcrypt.hash(password, 12);
  const player = existing
    ? await prisma.player.update({
        where: { id: existing.id },
        data: { passwordHash: hash, displayName: formattedName },
      })
    : await prisma.player.create({
        data: {
          username: user,
          displayName: formattedName,
          passwordHash: hash,
          stats: { create: { affinities: { traditional_european: 10, chaos_magic: 0, vodou: 0, nordic_seidr: 0, greek_mageia: 0 } } },
          apartment: { create: {} },
          aura: { create: { effects: [] } },
          inventory: {
            create: [
              { itemId: 'white_candle', quantity: 2 },
              { itemId: 'rosemary', quantity: 3 },
              { itemId: 'salt', quantity: 2 },
              { itemId: 'familiar_food', quantity: 3 },
              { itemId: 'familiar_knot', quantity: 1 },
            ],
          },
        },
      });

  const token = jwt.sign({ playerId: player.id, username: player.username } satisfies PlayerTokenPayload, JWT_SECRET, {
    expiresIn: JWT_EXPIRY,
  });
  return { token, username: player.username, displayName: player.displayName };
}

export async function loginPlayer(
  username: string,
  password: string
): Promise<{ token: string; username: string; displayName: string } | { error: string }> {
  const user = normalizeUsername(username);
  const player = await prisma.player.findUnique({ where: { username: user } });
  if (!player?.passwordHash) return { error: 'Invalid username or password.' };

  const valid = await bcrypt.compare(password, player.passwordHash);
  if (!valid) return { error: 'Invalid username or password.' };

  const banned = await prisma.playerModeration.findFirst({
    where: { playerId: player.id, type: 'ban', active: true },
  });
  if (banned) return { error: 'This account is banned.' };

  await prisma.player.update({ where: { id: player.id }, data: { lastLoginAt: new Date() } });

  const token = jwt.sign({ playerId: player.id, username: player.username } satisfies PlayerTokenPayload, JWT_SECRET, {
    expiresIn: JWT_EXPIRY,
  });
  return { token, username: player.username, displayName: player.displayName };
}

export function verifyPlayerToken(token: string): PlayerTokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as PlayerTokenPayload;
  } catch {
    return null;
  }
}

export async function assertPlayerAuth(
  username: string,
  authToken?: string
): Promise<{ ok: true; playerId: string } | { ok: false; reason: string }> {
  if (authToken) {
    const payload = verifyPlayerToken(authToken);
    if (!payload) return { ok: false, reason: 'Invalid or expired session.' };
    if (payload.username !== username.toLowerCase()) return { ok: false, reason: 'Session mismatch.' };
    return { ok: true, playerId: payload.playerId };
  }

  const player = await prisma.player.findUnique({ where: { username: username.toLowerCase() } });
  if (player?.passwordHash) return { ok: false, reason: 'Password required. Please log in.' };
  return { ok: true, playerId: player?.id ?? '' };
}
