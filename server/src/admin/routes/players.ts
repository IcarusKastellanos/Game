import { Router } from 'express';
import { z } from 'zod';
import {
  adminAuthMiddleware,
  requirePerm,
  auditContext,
  type AdminRequest,
} from '../middleware.js';
import {
  searchPlayers,
  getPlayerDetail,
  updatePlayerStats,
  giveItem,
  removeInventorySlot,
  getAdminInventorySlots,
  moderatePlayer,
  healPlayer,
  modifyAura,
  updatePlayerProfile,
  deletePlayer,
  setPlayerRecipeDiscovered,
} from '../services/player-admin.js';
import { parseProgression } from '@witchcraft/shared';
import { param } from '../util.js';

export const playersRouter = Router();
playersRouter.use(adminAuthMiddleware);

playersRouter.get('/', requirePerm('player.view'), async (req, res) => {
  const q = String(req.query.q ?? '');
  const players = await searchPlayers({ username: q, displayName: q });
  res.json(players);
});

playersRouter.get('/:id', requirePerm('player.view'), async (req, res) => {
  const player = await getPlayerDetail(param(req, 'id'));
  if (!player) return res.status(404).json({ error: 'Player not found' });
  res.json({
    ...player,
    progression: parseProgression(player.progression),
    inventorySlots: getAdminInventorySlots(
      player.inventory.map((row) => ({
        itemId: row.itemId,
        quantity: row.quantity,
        metadata: (row.metadata as Record<string, unknown>) ?? null,
      }))
    ),
  });
});

playersRouter.patch('/:id/stats', requirePerm('player.edit'), async (req: AdminRequest, res) => {
  const schema = z.record(z.number());
  const parsed = schema.safeParse(req.body.stats);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });
  const updated = await updatePlayerStats(
    auditContext(req),
    param(req, 'id'),
    parsed.data,
    req.body.reason
  );
  res.json(updated);
});

playersRouter.post('/:id/give', requirePerm('player.edit'), async (req: AdminRequest, res) => {
  const { itemId, quantity = 1, reason } = req.body;
  if (!itemId) return res.status(400).json({ error: 'itemId required' });
  try {
    const result = await giveItem(auditContext(req), param(req, 'id'), itemId, quantity, reason);
    res.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = message === 'Player not found' ? 404 : 400;
    res.status(status).json({ error: message });
  }
});

playersRouter.post('/:id/inventory/remove', requirePerm('player.edit'), async (req: AdminRequest, res) => {
  const slotIndex = Number(req.body?.slotIndex);
  const itemId = typeof req.body?.itemId === 'string' ? req.body.itemId : undefined;
  if (!Number.isFinite(slotIndex)) return res.status(400).json({ error: 'slotIndex required' });
  try {
    const result = await removeInventorySlot(
      auditContext(req),
      param(req, 'id'),
      slotIndex,
      itemId,
      req.body?.reason ?? 'Admin remove'
    );
    res.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(404).json({ error: message });
  }
});

playersRouter.post('/:id/recipes/discover', requirePerm('player.edit'), async (req: AdminRequest, res) => {
  const recipeId = req.body?.recipeId;
  if (typeof recipeId !== 'string' || !recipeId.trim()) {
    return res.status(400).json({ error: 'recipeId required' });
  }
  try {
    const progression = await setPlayerRecipeDiscovered(
      auditContext(req),
      param(req, 'id'),
      recipeId.trim(),
      true,
      req.body?.reason ?? 'Admin grant recipe'
    );
    res.json({ ok: true, progression });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(message === 'Player not found' ? 404 : 400).json({ error: message });
  }
});

playersRouter.post('/:id/recipes/forget', requirePerm('player.edit'), async (req: AdminRequest, res) => {
  const recipeId = req.body?.recipeId;
  if (typeof recipeId !== 'string' || !recipeId.trim()) {
    return res.status(400).json({ error: 'recipeId required' });
  }
  try {
    const progression = await setPlayerRecipeDiscovered(
      auditContext(req),
      param(req, 'id'),
      recipeId.trim(),
      false,
      req.body?.reason ?? 'Admin revoke recipe'
    );
    res.json({ ok: true, progression });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(message === 'Player not found' ? 404 : 400).json({ error: message });
  }
});

playersRouter.post('/:id/heal', requirePerm('player.heal'), async (req: AdminRequest, res) => {
  const result = await healPlayer(auditContext(req), param(req, 'id'), req.body.reason);
  res.json(result);
});

playersRouter.post('/:id/moderate', requirePerm('player.moderate'), async (req: AdminRequest, res) => {
  const { type, reason, expiresAt } = req.body;
  if (!type || !reason) return res.status(400).json({ error: 'type and reason required' });
  const result = await moderatePlayer(
    auditContext(req),
    param(req, 'id'),
    type,
    reason,
    expiresAt ? new Date(expiresAt) : undefined
  );
  res.json(result);
});

playersRouter.patch('/:id/aura', requirePerm('aura.edit'), async (req: AdminRequest, res) => {
  const result = await modifyAura(auditContext(req), param(req, 'id'), req.body.effects, req.body.reason);
  res.json(result);
});

playersRouter.patch('/:id/profile', requirePerm('player.edit'), async (req: AdminRequest, res) => {
  try {
    const result = await updatePlayerProfile(
      auditContext(req),
      param(req, 'id'),
      { username: req.body.username, displayName: req.body.displayName },
      req.body.reason
    );
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

playersRouter.delete('/:id', requirePerm('player.edit'), async (req: AdminRequest, res) => {
  try {
    const result = await deletePlayer(auditContext(req), param(req, 'id'), req.body?.reason ?? 'Admin delete');
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});
