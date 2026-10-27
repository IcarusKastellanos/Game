import { Router } from 'express';
import { prisma } from '../../services/db.js';
import { contentRegistry } from '../../content/registry.js';
import { adminAuthMiddleware, requirePerm, auditContext, type AdminRequest } from '../middleware.js';
import { writeAuditLog } from '../audit.js';
import { param } from '../util.js';
import type { ContentIngredient, ContentNpc } from '@witchcraft/shared';
import { hashIconPixels } from '@witchcraft/shared';
import { craftingSystem } from '../../systems/crafting-system.js';
import { hexagramEnchantSystem } from '../../systems/hexagram-enchant-system.js';
import { questSystem } from '../../systems/quest-system.js';
import { shopSystem } from '../../systems/shop-system.js';
import { readContentJson, writeContentJson } from '../../content/json-persist.js';
import { saveLevelDocument } from '../../content/level-sync.js';
import { rehydrateContentOverlays } from '../../content/rehydrate.js';
import { licenseEditorCatalog, loadLicensesDocumentFromDisk, saveLicensesDocument } from '../../content/license-sync.js';
import type { ContentRecipe, ContentHexagramRecipe } from '@witchcraft/shared';
import {
  GRIMOIRE_ENTRY_KINDS,
  LEVEL_STAT_FLOOR_KEYS,
  getLevelDocument,
  getLicensesDocument,
  isGrimoireEntryKind,
  type GrimoireEntryKind,
  type PermissionSlug,
} from '@witchcraft/shared';
import { getAdminPermissions } from '../rbac.js';
import { grimoireCatalog, grimoireRecordExists, setGrimoireEntry } from '../../content/grimoire-entries.js';
import { hydrateNpcSprite } from '../../content/npc-sprites.js';
import {
  dialogueRevision,
  npcRevision,
  saveDialogueDefinition,
  saveNpcDefinition,
} from '../../content/npc-content-persist.js';
import {
  knowledgeRevision,
  lessonsRevision,
  saveKnowledgeDocument,
  saveLessonDocument,
  saveSocialDocument,
  socialRevision,
} from '../../content/npc-depth-persist.js';
import { questRevision, saveQuestDefinition } from '../../content/quest-content-persist.js';
import { broadcastSharedQuestMirror } from '../../rooms/game-room-registry.js';
import { ContentSaveError } from '../../content/versioned-content.js';
import {
  getKnowledgeDocument,
  getLessonDocument,
  getSocialDocument,
} from '@witchcraft/shared';

function revisionField(body: unknown): number {
  if (!body || typeof body !== 'object') return Number.NaN;
  const revision = (body as { revision?: unknown }).revision;
  return typeof revision === 'number' ? revision : Number.NaN;
}

function respondContentSaveError(res: import('express').Response, error: unknown): void {
  if (error instanceof ContentSaveError) {
    res.status(error.status).json({ error: error.message, revision: error.revision });
    return;
  }
  const message = error instanceof Error ? error.message : 'Save failed.';
  res.status(500).json({ error: message });
}

function hydrateItemIcon(item: ContentIngredient & { data?: { iconPixels?: string[] | null } }): ContentIngredient {
  if (item.iconPixels?.length === 256) return item;
  const fromData = item.data?.iconPixels;
  if (fromData?.length === 256) return { ...item, iconPixels: fromData };
  return item;
}

function ingredientToDb(item: ContentIngredient) {
  const { iconPixels, ...core } = item;
  const iconHash = iconPixels?.length === 256 ? hashIconPixels(iconPixels) : null;
  return {
    id: core.id,
    name: core.name,
    category: core.category,
    correspondences: core.correspondences,
    description: core.description,
    rarity: core.rarity,
    basePotency: core.basePotency,
    traditions: core.traditions,
    data: { iconPixels: iconPixels ?? null, iconHash },
  };
}

export const contentRouter = Router();
contentRouter.use(adminAuthMiddleware);

// --- Spells ---
contentRouter.get('/spells', requirePerm('content.spell.view'), (_req, res) => {
  res.json([...contentRegistry.spells.values()]);
});

contentRouter.get('/spells/:id', requirePerm('content.spell.view'), (req, res) => {
  const spell = contentRegistry.spells.get(param(req, 'id'));
  if (!spell) return res.status(404).json({ error: 'Not found' });
  res.json(spell);
});

contentRouter.put('/spells/:id', requirePerm('content.spell.edit'), async (req: AdminRequest, res) => {
  const before = contentRegistry.spells.get(param(req, 'id'));
  const spell = { ...req.body, id: param(req, 'id') };
  contentRegistry.spells.set(spell.id, spell);
  await prisma.contentSpell.upsert({
    where: { id: spell.id },
    create: spell as never,
    update: spell as never,
  });
  await writeAuditLog(auditContext(req), {
    action: 'content.spell.update',
    objectType: 'spell',
    objectId: spell.id,
    previousValue: before,
    newValue: spell,
    reason: req.body.reason,
  });
  res.json(spell);
});

contentRouter.post('/spells', requirePerm('content.spell.edit'), async (req: AdminRequest, res) => {
  const spell = req.body;
  if (!spell.id) return res.status(400).json({ error: 'id required' });
  contentRegistry.spells.set(spell.id, spell);
  await prisma.contentSpell.upsert({
    where: { id: spell.id },
    create: spell as never,
    update: spell as never,
  });
  await writeAuditLog(auditContext(req), {
    action: 'content.spell.create',
    objectType: 'spell',
    objectId: spell.id,
    newValue: spell,
  });
  res.status(201).json(spell);
});

contentRouter.delete('/spells/:id', requirePerm('content.spell.edit'), async (req: AdminRequest, res) => {
  const id = param(req, 'id');
  const before = contentRegistry.spells.get(id);
  contentRegistry.spells.delete(id);
  await prisma.contentSpell.delete({ where: { id } }).catch(() => null);
  await writeAuditLog(auditContext(req), {
    action: 'content.spell.delete',
    objectType: 'spell',
    objectId: id,
    previousValue: before,
  });
  res.json({ ok: true });
});

// --- Recipes (craft + hexagram unified list for admin) ---
contentRouter.get('/recipes', requirePerm('content.item.view'), (_req, res) => {
  const crafts = [...craftingSystem.recipes.values()].map((r) => ({
    ...r,
    recipeKind: 'craft' as const,
  }));
  const hexagram = [...hexagramEnchantSystem.recipes.values()].map((r) => ({
    id: r.id,
    name: r.name,
    stationType: r.stationType,
    effect: r.effect,
    description: r.description,
    category: r.category,
    spellId: r.spellId,
    meCost: r.meCost,
    recipeKind: 'hexagram' as const,
  }));
  res.json([...crafts, ...hexagram]);
});

contentRouter.get('/recipes/:id', requirePerm('content.item.view'), (req, res) => {
  const recipe = craftingSystem.recipes.get(param(req, 'id'));
  if (!recipe) return res.status(404).json({ error: 'Not found' });
  res.json(recipe);
});

contentRouter.put('/recipes/:id', requirePerm('content.item.edit'), async (req: AdminRequest, res) => {
  const id = param(req, 'id');
  const recipe = { ...req.body, id } as ContentRecipe;
  const list = readContentJson<ContentRecipe>('recipes.json');
  const idx = list.findIndex((r) => r.id === id);
  const before = idx >= 0 ? list[idx] : null;
  if (idx >= 0) list[idx] = recipe;
  else list.push(recipe);
  writeContentJson('recipes.json', list);
  craftingSystem.loadFromJson(list);
  await writeAuditLog(auditContext(req), {
    action: before ? 'content.recipe.update' : 'content.recipe.create',
    objectType: 'recipe',
    objectId: id,
    previousValue: before,
    newValue: recipe,
  });
  res.json(recipe);
});

contentRouter.post('/recipes', requirePerm('content.item.edit'), async (req: AdminRequest, res) => {
  const recipe = req.body as ContentRecipe;
  if (!recipe.id) return res.status(400).json({ error: 'id required' });
  const list = readContentJson<ContentRecipe>('recipes.json');
  if (list.some((r) => r.id === recipe.id)) return res.status(409).json({ error: 'id exists' });
  list.push(recipe);
  writeContentJson('recipes.json', list);
  craftingSystem.loadFromJson(list);
  await writeAuditLog(auditContext(req), {
    action: 'content.recipe.create',
    objectType: 'recipe',
    objectId: recipe.id,
    newValue: recipe,
  });
  res.json(recipe);
});

contentRouter.delete('/recipes/:id', requirePerm('content.item.edit'), async (req: AdminRequest, res) => {
  const id = param(req, 'id');
  const list = readContentJson<ContentRecipe>('recipes.json');
  const before = list.find((r) => r.id === id);
  if (!before) return res.status(404).json({ error: 'Not found' });
  writeContentJson('recipes.json', list.filter((r) => r.id !== id));
  craftingSystem.loadFromJson(readContentJson<ContentRecipe>('recipes.json'));
  await writeAuditLog(auditContext(req), {
    action: 'content.recipe.delete',
    objectType: 'recipe',
    objectId: id,
    previousValue: before,
  });
  res.json({ ok: true });
});

// --- Hexagram recipes ---
contentRouter.get('/hexagram-recipes', requirePerm('content.item.view'), (_req, res) => {
  res.json([...hexagramEnchantSystem.recipes.values()]);
});

contentRouter.get('/hexagram-recipes/:id', requirePerm('content.item.view'), (req, res) => {
  const recipe = hexagramEnchantSystem.recipes.get(param(req, 'id'));
  if (!recipe) return res.status(404).json({ error: 'Not found' });
  res.json(recipe);
});

contentRouter.put('/hexagram-recipes/:id', requirePerm('content.item.edit'), async (req: AdminRequest, res) => {
  const id = param(req, 'id');
  const recipe = { ...req.body, id } as ContentHexagramRecipe;
  const list = readContentJson<ContentHexagramRecipe>('hexagram-recipes.json');
  const idx = list.findIndex((r) => r.id === id);
  const before = idx >= 0 ? list[idx] : null;
  if (idx >= 0) list[idx] = recipe;
  else list.push(recipe);
  writeContentJson('hexagram-recipes.json', list);
  hexagramEnchantSystem.loadFromJson(list);
  await writeAuditLog(auditContext(req), {
    action: before ? 'content.hexagram_recipe.update' : 'content.hexagram_recipe.create',
    objectType: 'hexagram_recipe',
    objectId: id,
    previousValue: before,
    newValue: recipe,
  });
  res.json(recipe);
});

contentRouter.post('/hexagram-recipes', requirePerm('content.item.edit'), async (req: AdminRequest, res) => {
  const recipe = req.body as ContentHexagramRecipe;
  if (!recipe.id) return res.status(400).json({ error: 'id required' });
  const list = readContentJson<ContentHexagramRecipe>('hexagram-recipes.json');
  if (list.some((r) => r.id === recipe.id)) return res.status(409).json({ error: 'id exists' });
  list.push(recipe);
  writeContentJson('hexagram-recipes.json', list);
  hexagramEnchantSystem.loadFromJson(list);
  await writeAuditLog(auditContext(req), {
    action: 'content.hexagram_recipe.create',
    objectType: 'hexagram_recipe',
    objectId: recipe.id,
    newValue: recipe,
  });
  res.json(recipe);
});

contentRouter.delete('/hexagram-recipes/:id', requirePerm('content.item.edit'), async (req: AdminRequest, res) => {
  const id = param(req, 'id');
  const list = readContentJson<ContentHexagramRecipe>('hexagram-recipes.json');
  const before = list.find((r) => r.id === id);
  if (!before) return res.status(404).json({ error: 'Not found' });
  writeContentJson('hexagram-recipes.json', list.filter((r) => r.id !== id));
  hexagramEnchantSystem.loadFromJson(readContentJson<ContentHexagramRecipe>('hexagram-recipes.json'));
  await writeAuditLog(auditContext(req), {
    action: 'content.hexagram_recipe.delete',
    objectType: 'hexagram_recipe',
    objectId: id,
    previousValue: before,
  });
  res.json({ ok: true });
});

// --- Items / Ingredients ---
contentRouter.get('/items', requirePerm('content.item.view'), (_req, res) => {
  res.json([...contentRegistry.ingredients.values()].map((item) => hydrateItemIcon(item)));
});

function persistIngredientFile(item: ContentIngredient): void {
  const list = readContentJson<ContentIngredient>('ingredients.json');
  const index = list.findIndex((row) => row.id === item.id);
  if (index === -1) list.push(item);
  else list[index] = { ...list[index], ...item };
  writeContentJson('ingredients.json', list);
}

contentRouter.put('/items/:id', requirePerm('content.item.edit'), async (req: AdminRequest, res) => {
  const item = { ...req.body, id: param(req, 'id') } as ContentIngredient;
  contentRegistry.ingredients.set(item.id, item);
  persistIngredientFile(item);
  const dbRow = ingredientToDb(item);
  await prisma.contentIngredient.upsert({
    where: { id: item.id },
    create: dbRow as never,
    update: dbRow as never,
  });
  await writeAuditLog(auditContext(req), {
    action: 'content.item.update',
    objectType: 'item',
    objectId: item.id,
    newValue: item,
  });
  res.json(hydrateItemIcon(item));
});

contentRouter.get('/items/:id', requirePerm('content.item.view'), (req, res) => {
  const item = contentRegistry.ingredients.get(param(req, 'id'));
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(hydrateItemIcon(item));
});

contentRouter.post('/items', requirePerm('content.item.edit'), async (req: AdminRequest, res) => {
  const item = req.body as ContentIngredient;
  if (!item.id) return res.status(400).json({ error: 'id required' });
  contentRegistry.ingredients.set(item.id, item);
  persistIngredientFile(item);
  const dbRow = ingredientToDb(item);
  await prisma.contentIngredient.upsert({
    where: { id: item.id },
    create: dbRow as never,
    update: dbRow as never,
  });
  await writeAuditLog(auditContext(req), {
    action: 'content.item.create',
    objectType: 'item',
    objectId: item.id,
    newValue: item,
  });
  res.status(201).json(item);
});

contentRouter.delete('/items/:id', requirePerm('content.item.edit'), async (req: AdminRequest, res) => {
  const id = param(req, 'id');
  const before = contentRegistry.ingredients.get(id);
  contentRegistry.ingredients.delete(id);
  await prisma.contentIngredient.delete({ where: { id } }).catch(() => null);
  await writeAuditLog(auditContext(req), {
    action: 'content.item.delete',
    objectType: 'item',
    objectId: id,
    previousValue: before,
  });
  res.json({ ok: true });
});

// --- NPCs ---
contentRouter.get('/npcs', requirePerm('content.npc.view'), (_req, res) => {
  res.json(
    [...contentRegistry.npcs.values()].map((n) => ({
      ...hydrateNpcSprite(n as ContentNpc & { data?: { spritePixels?: string[] | null } }),
      revision: npcRevision(n.id),
    }))
  );
});

contentRouter.put('/npcs/:id', requirePerm('content.npc.edit'), async (req: AdminRequest, res) => {
  const id = param(req, 'id');
  try {
    const { npc, revision, diagnostics } = await saveNpcDefinition(req.body, id, revisionField(req.body));
    await writeAuditLog(auditContext(req), {
      action: 'content.npc.update',
      objectType: 'npc',
      objectId: id,
      newValue: npc,
    });
    res.json({ ...hydrateNpcSprite(npc), revision, ...(diagnostics ? { diagnostics } : {}) });
  } catch (error) {
    respondContentSaveError(res, error);
  }
});

contentRouter.get('/dialogues', requirePerm('content.npc.view'), (_req, res) => {
  res.json([...contentRegistry.dialogues.values()].map((dialogue) => ({ ...dialogue, revision: dialogueRevision(dialogue.id) })));
});

contentRouter.get('/dialogues/:id', requirePerm('content.npc.view'), (req, res) => {
  const dlg = contentRegistry.dialogues.get(param(req, 'id'));
  if (!dlg) return res.status(404).json({ error: 'Not found' });
  res.json({ ...dlg, revision: dialogueRevision(dlg.id) });
});

contentRouter.get('/quests', requirePerm('content.quest.edit'), (_req, res) => {
  res.json(questSystem.list().map((quest) => ({ ...quest, revision: questRevision(quest.id) })));
});

contentRouter.get('/quests/:id', requirePerm('content.quest.edit'), (req, res) => {
  const quest = questSystem.quests.get(param(req, 'id'));
  if (!quest) return res.status(404).json({ error: 'Not found' });
  res.json({ ...quest, revision: questRevision(quest.id) });
});

contentRouter.put('/quests/:id', requirePerm('content.quest.edit'), async (req: AdminRequest, res) => {
  const id = param(req, 'id');
  try {
    const { quest, revision } = saveQuestDefinition(req.body, id, revisionField(req.body));
    broadcastSharedQuestMirror();
    await writeAuditLog(auditContext(req), {
      action: 'content.quest.update',
      objectType: 'quest',
      objectId: id,
      newValue: quest,
    });
    res.json({ ...quest, revision });
  } catch (error) {
    respondContentSaveError(res, error);
  }
});

contentRouter.put('/dialogues/:id', requirePerm('content.npc.edit'), async (req: AdminRequest, res) => {
  const id = param(req, 'id');
  try {
    const { dialogue, revision } = await saveDialogueDefinition(req.body, id, revisionField(req.body));
    await writeAuditLog(auditContext(req), {
      action: 'content.dialogue.update',
      objectType: 'dialogue',
      objectId: id,
      newValue: dialogue,
    });
    res.json({ ...dialogue, revision });
  } catch (error) {
    respondContentSaveError(res, error);
  }
});

contentRouter.get('/social', requirePerm('content.npc.view'), (_req, res) => {
  res.json({ ...(getSocialDocument() ?? {}), revision: socialRevision() });
});

contentRouter.put('/social', requirePerm('content.npc.edit'), async (req: AdminRequest, res) => {
  try {
    const { document, revision } = await saveSocialDocument(req.body, revisionField(req.body));
    await writeAuditLog(auditContext(req), {
      action: 'content.social.update',
      objectType: 'social',
      objectId: 'document',
      newValue: document,
    });
    res.json({ ...document, revision });
  } catch (error) {
    respondContentSaveError(res, error);
  }
});

contentRouter.get('/knowledge', requirePerm('content.npc.view'), (_req, res) => {
  res.json({ ...(getKnowledgeDocument() ?? { entries: [] }), revision: knowledgeRevision() });
});

contentRouter.put('/knowledge', requirePerm('content.npc.edit'), async (req: AdminRequest, res) => {
  try {
    const { document, revision } = await saveKnowledgeDocument(req.body, revisionField(req.body));
    await writeAuditLog(auditContext(req), {
      action: 'content.knowledge.update',
      objectType: 'knowledge',
      objectId: 'document',
      newValue: document,
    });
    res.json({ ...document, revision });
  } catch (error) {
    respondContentSaveError(res, error);
  }
});

contentRouter.get('/lessons', requirePerm('content.npc.view'), (_req, res) => {
  res.json({ ...(getLessonDocument() ?? { lessons: [] }), revision: lessonsRevision() });
});

contentRouter.put('/lessons', requirePerm('content.npc.edit'), async (req: AdminRequest, res) => {
  try {
    const { document, revision } = await saveLessonDocument(req.body, revisionField(req.body));
    await writeAuditLog(auditContext(req), {
      action: 'content.lessons.update',
      objectType: 'lessons',
      objectId: 'document',
      newValue: document,
    });
    res.json({ ...document, revision });
  } catch (error) {
    respondContentSaveError(res, error);
  }
});

// --- Maps ---
contentRouter.get('/maps', requirePerm('content.map.view'), (_req, res) => {
  res.json([...contentRegistry.maps.values()]);
});

contentRouter.put('/maps/:id', requirePerm('content.map.edit'), async (req: AdminRequest, res) => {
  const map = { ...req.body, id: param(req, 'id') };
  contentRegistry.maps.set(map.id, map);
  await prisma.contentMap.upsert({
    where: { id: map.id },
    create: map as never,
    update: map as never,
  });
  await writeAuditLog(auditContext(req), {
    action: 'content.map.update',
    objectType: 'map',
    objectId: map.id,
    newValue: map,
  });
  res.json(map);
});

// --- Shops ---
contentRouter.get('/shops', requirePerm('content.shop.edit'), (_req, res) => {
  res.json([...contentRegistry.shops.values()]);
});

contentRouter.put('/shops/:id', requirePerm('content.shop.edit'), async (req: AdminRequest, res) => {
  const shop = { ...req.body, id: param(req, 'id') };
  contentRegistry.shops.set(shop.id, shop);
  shopSystem.captureBaselines();
  await prisma.contentShop.upsert({
    where: { id: shop.id },
    create: shop as never,
    update: shop as never,
  });
  res.json(shop);
});

// --- Familiars ---
contentRouter.get('/familiars', requirePerm('content.familiar.edit'), (_req, res) => {
  res.json([...contentRegistry.familiars.values()]);
});

// --- Spirits ---
contentRouter.get('/spirits', requirePerm('content.spirit.edit'), async (_req, res) => {
  const spirits = await prisma.contentSpirit.findMany();
  res.json(spirits);
});

contentRouter.put('/spirits/:id', requirePerm('content.spirit.edit'), async (req: AdminRequest, res) => {
  const spirit = await prisma.contentSpirit.upsert({
    where: { id: param(req, 'id') },
    create: { ...req.body, id: param(req, 'id') },
    update: req.body,
  });
  await writeAuditLog(auditContext(req), {
    action: 'content.spirit.update',
    objectType: 'spirit',
    objectId: spirit.id,
    newValue: spirit,
  });
  res.json(spirit);
});

// --- Events ---
contentRouter.get('/events', requirePerm('content.event.edit'), async (_req, res) => {
  res.json(await prisma.contentEvent.findMany());
});

contentRouter.post('/events', requirePerm('content.event.edit'), async (req: AdminRequest, res) => {
  const event = await prisma.contentEvent.create({ data: req.body });
  await writeAuditLog(auditContext(req), {
    action: 'content.event.create',
    objectType: 'event',
    objectId: event.id,
    newValue: event,
  });
  res.status(201).json(event);
});

contentRouter.get('/events/:id', requirePerm('content.event.edit'), async (req, res) => {
  const event = await prisma.contentEvent.findUnique({ where: { id: param(req, 'id') } });
  if (!event) return res.status(404).json({ error: 'Not found' });
  res.json(event);
});

contentRouter.put('/events/:id', requirePerm('content.event.edit'), async (req: AdminRequest, res) => {
  const id = param(req, 'id');
  const before = await prisma.contentEvent.findUnique({ where: { id } });
  const event = await prisma.contentEvent.update({
    where: { id },
    data: { ...req.body, id },
  });
  await writeAuditLog(auditContext(req), {
    action: 'content.event.update',
    objectType: 'event',
    objectId: event.id,
    previousValue: before,
    newValue: event,
  });
  res.json(event);
});

contentRouter.patch('/events/:id', requirePerm('content.event.edit'), async (req: AdminRequest, res) => {
  const id = param(req, 'id');
  const before = await prisma.contentEvent.findUnique({ where: { id } });
  const event = await prisma.contentEvent.update({
    where: { id },
    data: req.body,
  });
  await writeAuditLog(auditContext(req), {
    action: 'content.event.update',
    objectType: 'event',
    objectId: event.id,
    previousValue: before,
    newValue: event,
    reason: req.body.reason,
  });
  res.json(event);
});

contentRouter.delete('/events/:id', requirePerm('content.event.edit'), async (req: AdminRequest, res) => {
  const id = param(req, 'id');
  const before = await prisma.contentEvent.findUnique({ where: { id } });
  await prisma.contentEvent.delete({ where: { id } }).catch(() => null);
  await writeAuditLog(auditContext(req), {
    action: 'content.event.delete',
    objectType: 'event',
    objectId: id,
    previousValue: before,
  });
  res.json({ ok: true });
});

function levelCatalog() {
  return {
    spells: [...contentRegistry.spells.values()].map((s) => ({ id: s.id, name: s.name, minLevel: s.minLevel ?? 1 })),
    recipes: [...craftingSystem.recipes.values()].map((r) => ({ id: r.id, name: r.name, minLevel: r.minLevel ?? 1 })),
    hexagrams: [...hexagramEnchantSystem.recipes.values()].map((r) => ({
      id: r.id,
      name: r.name,
      minLevel: r.minLevel ?? 1,
    })),
    items: [...contentRegistry.ingredients.values()].map((i) => ({ id: i.id, name: i.name })),
    npcs: [...contentRegistry.npcs.values()].map((n) => ({ id: n.id, name: n.name, role: n.role })),
    quests: [...questSystem.quests.values()].map((q) => ({ id: q.id, name: q.name, minLevel: q.minLevel ?? 1 })),
    statKeys: LEVEL_STAT_FLOOR_KEYS,
    traditions: ['traditional_european', 'chaos_magic', 'vodou', 'nordic_seidr', 'greek_mageia'],
  };
}

contentRouter.get('/levels', requirePerm('content.spell.view'), (_req, res) => {
  res.json({ document: getLevelDocument(), catalog: levelCatalog() });
});

contentRouter.put('/levels', requirePerm('content.spell.edit'), async (req: AdminRequest, res) => {
  const before = getLevelDocument();
  const document = saveLevelDocument(req.body?.document ?? req.body);
  try {
    await rehydrateContentOverlays();
  } catch (err) {
    console.warn('[levels] overlay rehydrate failed:', err);
  }
  await writeAuditLog(auditContext(req), {
    action: 'content.levels.update',
    objectType: 'level_document',
    objectId: 'practitioner_levels',
    previousValue: before,
    newValue: document,
  });
  res.json({ document, catalog: levelCatalog() });
});

contentRouter.get('/licenses', requirePerm('content.spell.view'), (_req, res) => {
  const document = getLicensesDocument().licenses.length
    ? getLicensesDocument()
    : loadLicensesDocumentFromDisk();
  res.json({ document, catalog: licenseEditorCatalog() });
});

contentRouter.put('/licenses', requirePerm('content.spell.edit'), async (req: AdminRequest, res) => {
  const before = getLicensesDocument();
  const document = saveLicensesDocument(req.body?.document ?? req.body);
  await writeAuditLog(auditContext(req), {
    action: 'content.licenses.update',
    objectType: 'licenses_document',
    objectId: 'magical_council_licenses',
    previousValue: before,
    newValue: document,
  });
  res.json({ document, catalog: licenseEditorCatalog() });
});

const GRIMOIRE_KIND_ACCESS: Record<
  GrimoireEntryKind,
  { label: string; view: PermissionSlug; edit: PermissionSlug; playerNote: string }
> = {
  spells: {
    label: 'Spells',
    view: 'content.spell.view',
    edit: 'content.spell.edit',
    playerNote: 'Players read this on the spell’s page once that working is in their grimoire.',
  },
  items: {
    label: 'Items',
    view: 'content.item.view',
    edit: 'content.item.edit',
    playerNote: 'Players read this on the ingredient’s page once they have gathered it.',
  },
  spirits: {
    label: 'Spirit types',
    view: 'content.spirit.edit',
    edit: 'content.spirit.edit',
    playerNote: 'Players read this once that kind of spirit is written in their book.',
  },
  npcs: {
    label: 'NPCs',
    view: 'content.npc.view',
    edit: 'content.npc.edit',
    playerNote: 'Players read this on the People page once they have met this person.',
  },
  familiars: {
    label: 'Familiars',
    view: 'content.familiar.edit',
    edit: 'content.familiar.edit',
    playerNote: 'Players read this on The Book when this familiar is theirs and the page has text.',
  },
  recipes: {
    label: 'Recipes',
    view: 'content.item.view',
    edit: 'content.item.edit',
    playerNote: 'Players read this on The Book when they know the recipe and the page has text.',
  },
  books: {
    label: 'Books',
    view: 'content.spell.view',
    edit: 'content.spell.edit',
    playerNote: 'Players read this on The Book after they have read the volume and the page has text.',
  },
  quests: {
    label: 'Quests',
    view: 'content.quest.edit',
    edit: 'content.quest.edit',
    playerNote: 'Players read this on The Book once the quest is on their record and the page has text.',
  },
};

contentRouter.get('/grimoire-entries', async (req: AdminRequest, res) => {
  if (!req.admin) return res.status(401).json({ error: 'Authentication required' });
  const perms = await getAdminPermissions(req.admin.userId);
  req.admin.permissions = perms;
  const kinds = GRIMOIRE_ENTRY_KINDS.filter((kind) => perms.includes(GRIMOIRE_KIND_ACCESS[kind].view)).map(
    (kind) => {
      const access = GRIMOIRE_KIND_ACCESS[kind];
      return {
        kind,
        label: access.label,
        playerNote: access.playerNote,
        canEdit: perms.includes(access.edit),
        records: grimoireCatalog(kind),
      };
    }
  );
  if (!kinds.length) return res.status(403).json({ error: 'Missing permission to view grimoire pages' });
  res.json({ kinds });
});

contentRouter.put('/grimoire-entries/:kind/:id', async (req: AdminRequest, res) => {
  if (!req.admin) return res.status(401).json({ error: 'Authentication required' });
  const kind = param(req, 'kind');
  const id = param(req, 'id');
  if (!isGrimoireEntryKind(kind)) return res.status(400).json({ error: 'Unknown grimoire section' });
  const access = GRIMOIRE_KIND_ACCESS[kind];
  const perms = await getAdminPermissions(req.admin.userId);
  if (!perms.includes(access.edit)) return res.status(403).json({ error: `Missing permission: ${access.edit}` });
  if (!grimoireRecordExists(kind, id)) return res.status(404).json({ error: 'That record is not in this section' });
  const grimoireEntry = setGrimoireEntry(kind, id, req.body?.grimoireEntry ?? '');
  if (grimoireEntry === null) return res.status(400).json({ error: 'Could not save that page' });
  await writeAuditLog(auditContext(req), {
    action: 'content.grimoire.update',
    objectType: 'grimoire',
    objectId: `${kind}:${id}`,
    newValue: { grimoireEntry },
  });
  res.json({ kind, id, grimoireEntry });
});

// --- Reload ---
contentRouter.get('/npc-places', requirePerm('content.npc.view'), (_req, res) => {
  res.json([...contentRegistry.npcPlaces.values()]);
});

contentRouter.post('/reload', requirePerm('system.reload'), async (req: AdminRequest, res) => {
  contentRegistry.load();
  const merged = await rehydrateContentOverlays();
  const { ensureCanonicalMapProjects } = await import('../../content/canonical-maps.js');
  await ensureCanonicalMapProjects();
  const { broadcastNpcWorldState } = await import('../../rooms/game-room-registry.js');
  broadcastNpcWorldState();
  await writeAuditLog(auditContext(req), {
    action: 'system.content.reload',
    objectType: 'system',
    objectId: 'content_registry',
    newValue: { mergedPublishedMaps: merged },
  });
  res.json({ ok: true, mergedPublishedMaps: merged });
});

// --- Spell preview ---
contentRouter.post('/spells/preview', requirePerm('content.spell.view'), async (req, res) => {
  const { spellEngine } = await import('../../systems/spell-engine.js');
  const { DEFAULT_STATS } = await import('@witchcraft/shared');
  const result = spellEngine.cast(req.body.id ?? 'preview', {
    casterStats: { ...DEFAULT_STATS, ...(req.body.stats ?? {}) },
    inventory: req.body.inventory ?? [],
    altar: req.body.altar ?? { candles: [], herbs: [], incense: [], petitions: [], poppets: [], taglocks: [], decorationIds: [] },
    altarBuffs: req.body.altarBuffs ?? {},
  });
  res.json(result);
});
