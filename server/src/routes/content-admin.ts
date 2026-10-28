import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import {
  getLicensesDocument,
  getRecognitionDocument,
  toClientDialogues,
  toClientNpcs,
} from '@witchcraft/shared';
import { contentRegistry } from '../content/registry.js';
import { getPublicIngredients, getIconManifest, mergeIngredientIconsFromDb, verifyIconHashes } from '../content/ingredient-icons.js';
import { mergeNpcSpritesFromDb, verifyNpcSpriteHashes } from '../content/npc-sprites.js';
import { prisma } from '../services/db.js';
import { getGrimoireEntries, grimoireEntryNames } from '../content/grimoire-entries.js';

export const contentRouter = Router();

/** Public content API for client bootstrap — NPCs are stripped of server-only fields. */
contentRouter.get('/all', (_req: Request, res: Response) => {
  res.json({
    ingredients: getPublicIngredients(),
    spells: [...contentRegistry.spells.values()],
    familiars: [...contentRegistry.familiars.values()],
    shops: [...contentRegistry.shops.values()],
    npcs: toClientNpcs(contentRegistry.npcs.values()),
    tiles: [...contentRegistry.tiles.values()],
    decorations: [...contentRegistry.decorations.values()],
    maps: [...contentRegistry.maps.values()],
    /** Client dialogue trees strip spoilers; live choices come from the server. */
    dialogues: toClientDialogues(contentRegistry.dialogues.values()),
    recognitionTiers: getRecognitionDocument(),
    licenses: getLicensesDocument(),
    spirits: [...contentRegistry.spirits.values()],
    grimoireEntries: getGrimoireEntries(),
    grimoireEntryNames: grimoireEntryNames(),
  });
});

/** Icon hash manifest for client cache verification */
contentRouter.get('/icons/manifest', (_req: Request, res: Response) => {
  res.json(getIconManifest());
});

/** One-shot per login: client sends local hashes, server returns only changed icon pixel art */
contentRouter.post('/icons/verify', (req: Request, res: Response) => {
  const clientHashes = (req.body?.items ?? {}) as Record<string, string>;
  res.json(verifyIconHashes(clientHashes));
});

/** One-shot per login: NPC sprite hash verify (mirrors ingredient icons). */
contentRouter.post('/npc-sprites/verify', (req: Request, res: Response) => {
  const clientHashes = (req.body?.items ?? {}) as Record<string, string>;
  res.json(verifyNpcSpriteHashes(clientHashes));
});

contentRouter.get('/maps/:sceneId', (req: Request, res: Response) => {
  const sceneId = String(req.params.sceneId);
  const map = contentRegistry.getMapForScene(sceneId);
  if (!map) return res.status(404).json({ error: 'Map not found' });
  res.json(map);
});

contentRouter.get('/spells', (req: Request, res: Response) => {
  const tradition = req.query.tradition as string | undefined;
  const spells = tradition
    ? contentRegistry.getSpellsByTradition(tradition as never)
    : [...contentRegistry.spells.values()];
  res.json(spells);
});

/** Admin routes — CRUD for content registries */
export const adminRouter = Router();

const spellSchema = z.object({
  id: z.string(),
  name: z.string(),
  tradition: z.string(),
  category: z.string(),
  targetType: z.string(),
  ingredients: z.array(z.object({ itemId: z.string(), quantity: z.number() })),
  requiredTools: z.array(z.string()),
  castingTime: z.number(),
  duration: z.number(),
  difficulty: z.number(),
  basePotency: z.number(),
  maintenanceCost: z.number(),
  counterspellTags: z.array(z.string()),
  moralEffect: z.number(),
  gameplayEffect: z.record(z.unknown()),
  description: z.string(),
});

adminRouter.post('/reload', async (_req: Request, res: Response) => {
  contentRegistry.load();
  await mergeIngredientIconsFromDb();
  await mergeNpcSpritesFromDb();
  await contentRegistry.mergePublishedMaps();
  const { ensureCanonicalMapProjects } = await import('../content/canonical-maps.js');
  await ensureCanonicalMapProjects();
  const { broadcastNpcWorldState } = await import('../rooms/game-room-registry.js');
  broadcastNpcWorldState();
  res.json({ ok: true, message: 'Content registry reloaded from JSON; icons merged from DB.' });
});

adminRouter.post('/spells', async (req: Request, res: Response) => {
  const parsed = spellSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);

  const spell = parsed.data;
  contentRegistry.spells.set(spell.id, spell as never);

  try {
    await prisma.contentSpell.upsert({
      where: { id: spell.id },
      create: {
        id: spell.id,
        name: spell.name,
        tradition: spell.tradition,
        category: spell.category,
        targetType: spell.targetType,
        ingredients: spell.ingredients,
        requiredTools: spell.requiredTools,
        castingTime: spell.castingTime,
        duration: spell.duration,
        difficulty: spell.difficulty,
        basePotency: spell.basePotency,
        maintenanceCost: spell.maintenanceCost,
        counterspellTags: spell.counterspellTags,
        moralEffect: spell.moralEffect,
        gameplayEffect: spell.gameplayEffect as Prisma.InputJsonValue,
        description: spell.description,
      },
      update: {
        name: spell.name,
        tradition: spell.tradition,
        category: spell.category,
        ingredients: spell.ingredients as Prisma.InputJsonValue,
        gameplayEffect: spell.gameplayEffect as Prisma.InputJsonValue,
        description: spell.description,
      },
    });
    res.json({ ok: true, spell });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

adminRouter.get('/spells', (_req: Request, res: Response) => {
  res.json([...contentRegistry.spells.values()]);
});

adminRouter.delete('/spells/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  contentRegistry.spells.delete(id);
  try {
    await prisma.contentSpell.delete({ where: { id } }).catch(() => null);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// TODO: admin CRUD for ingredients, npcs, shops, tiles, decorations, maps
