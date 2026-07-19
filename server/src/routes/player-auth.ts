import { Router } from 'express';
import { loginPlayer, registerPlayer, verifyPlayerToken } from '../services/player-auth.js';
import { loadOrCreatePlayer } from '../services/player-service.js';
import { buildFriendPresenceList } from '../systems/friend-system.js';
import { findOnlineByDbPlayerId } from '../systems/player-presence.js';

export const playerAuthRouter = Router();

playerAuthRouter.post('/register', async (req, res) => {
  const { username, password, displayName } = req.body ?? {};
  if (!username || !password) {
    res.status(400).json({ error: 'username and password required' });
    return;
  }
  const result = await registerPlayer(String(username), String(password), displayName ? String(displayName) : undefined);
  if ('error' in result) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result);
});

playerAuthRouter.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    res.status(400).json({ error: 'username and password required' });
    return;
  }
  const result = await loginPlayer(String(username), String(password));
  if ('error' in result) {
    res.status(401).json({ error: result.error });
    return;
  }
  res.json(result);
});

playerAuthRouter.get('/session', async (req, res) => {
  const auth = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!auth) {
    res.status(401).json({ error: 'Authorization required.' });
    return;
  }
  const payload = verifyPlayerToken(auth);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired session.' });
    return;
  }
  const player = await loadOrCreatePlayer(payload.username);
  const friendPresence = await buildFriendPresenceList(player.friends, (playerId) => {
    const online = findOnlineByDbPlayerId(playerId);
    if (!online) return null;
    return { scene: online.scene, stats: online.stats };
  });
  res.json({
    username: player.username,
    displayName: player.displayName,
    dbPlayerId: player.dbPlayerId,
    location: player.location,
    friends: player.friends,
    friendRequests: player.friendRequests,
    friendPresence,
  });
});
