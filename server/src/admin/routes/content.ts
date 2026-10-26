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
import { readContentJson, writeContentJson } from '../../content/json-persist.js';
import { saveLevelDocument } from '../../content/level-sync.js';
import { licenseEditorCatalog, loadLicensesDocumentFromDisk, saveLicensesDocument } from '../../content/license-sync.js';
import type { ContentRecipe, ContentHexagramRecipe } from '@witchcraft/shared';
import { LEVEL_STAT_FLOOR_KEYS, getLevelDocument, getLicensesDocument } from '@witchcraft/shared';
import { hydrateNpcSprite, npcToDb } from '../../content/npc-sprites.js';

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

contentRouter.put('/items/:id', requirePerm('content.item.edit'), async (req: AdminRequest, res) => {
  const item = { ...req.body, id: param(req, 'id') } as ContentIngredient;
  contentRegistry.ingredients.set(item.id, item);
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
  res.json([...contentRegistry.npcs.values()].map((n) => hydrateNpcSprite(n as ContentNpc & { data?: { spritePixels?: string[] | null } })));
});

contentRouter.put('/npcs/:id', requirePerm('content.npc.edit'), async (req: AdminRequest, res) => {
  const npc = { ...req.body, id: param(req, 'id') } as ContentNpc;
  contentRegistry.npcs.set(npc.id, npc);
  const dbRow = npcToDb(npc);
  await prisma.contentNpc.upsert({
    where: { id: npc.id },
    create: dbRow as never,
    update: dbRow as never,
  });
  await writeAuditLog(auditContext(req), {
    action: 'content.npc.update',
    objectType: 'npc',
    objectId: npc.id,
    newValue: npc,
  });
  res.json(npc);
});

contentRouter.get('/dialogues', requirePerm('content.npc.view'), (_req, res) => {
  res.json([...contentRegistry.dialogues.values()]);
});

contentRouter.get('/dialogues/:id', requirePerm('content.npc.view'), (req, res) => {
  const dlg = contentRegistry.dialogues.get(param(req, 'id'));
  if (!dlg) return res.status(404).json({ error: 'Not found' });
  res.json(dlg);
});

contentRouter.put('/dialogues/:id', requirePerm('content.npc.edit'), async (req: AdminRequest, res) => {
  const dlg = { ...req.body, id: param(req, 'id') };
  contentRegistry.dialogues.set(dlg.id, dlg);
  await writeAuditLog(auditContext(req), {
    action: 'content.dialogue.update',
    objectType: 'dialogue',
    objectId: dlg.id,
    newValue: dlg,
  });
  res.json(dlg);
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

// --- Reload ---
contentRouter.post('/reload', requirePerm('system.reload'), async (req: AdminRequest, res) => {
  contentRegistry.load();
  const merged = await contentRegistry.mergePublishedMaps();
  const { ensureCanonicalMapProjects } = await import('../../content/canonical-maps.js');
  await ensureCanonicalMapProjects();
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
