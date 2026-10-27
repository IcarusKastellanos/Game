import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_STATS,
  buildNpcInteractionOffers,
  defaultProgression,
  nearestNpcInteractable,
  publishDialogueChoices,
  resolveDialogueChoice,
  setLicensesContent,
  setRecognitionContent,
  setSocialContent,
  validateDialogueTree,
} from '../dist/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function loadJson(path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
}

const npcs = loadJson('content/npcs.json');
const dialogues = loadJson('content/dialogues.json');
const quests = loadJson('content/quests.json');
const maps = loadJson('content/maps.json');
const shops = loadJson('content/shops.json');

setRecognitionContent(loadJson('content/progression/recognition-tiers.json'));
setLicensesContent(loadJson('content/progression/licenses.json'));
setSocialContent(loadJson('content/social.json'));

const shopNpc = new Map(shops.map((shop) => [shop.id, shop.npcId]));
const town = maps.find((map) => map.sceneId === 'town');

function npc(id) {
  return npcs.find((entry) => entry.id === id);
}

function tree(id) {
  return dialogues.find((entry) => entry.id === id);
}

test('existing NPC content loads and shopkeepers offer talk and trade', () => {
  for (const id of ['npc_mara', 'npc_tom', 'npc_elena']) {
    const person = npc(id);
    const dialogue = tree(person.dialogueTreeId);
    const parsed = validateDialogueTree(dialogue);
    assert.equal(parsed.ok, true, parsed.error);
    const offers = buildNpcInteractionOffers({
      npc: person,
      dialogue,
      contextShopId: person.shopId,
      quests,
      questProgress: {},
    });
    assert.ok(offers.some((offer) => offer.id === 'talk'));
    assert.ok(offers.some((offer) => offer.id === 'trade' && offer.shopId === person.shopId));
    assert.ok(offers.some((offer) => offer.id === 'goodbye'));
    assert.equal(offers.some((offer) => offer.id === 'gift'), false);
  }
  const maraOffers = buildNpcInteractionOffers({
    npc: npc('npc_mara'),
    dialogue: tree('mara_intro'),
    contextShopId: 'metaphysical_shop',
    quests,
    questProgress: {},
  });
  assert.ok(maraOffers.some((offer) => offer.id === 'quests'));
  const after = buildNpcInteractionOffers({
    npc: npc('npc_mara'),
    dialogue: tree('mara_intro'),
    contextShopId: 'metaphysical_shop',
    quests,
    questProgress: { quest_first_steps: { completedAt: 1 } },
  });
  assert.equal(after.some((offer) => offer.id === 'quests'), false);

  const clerk = buildNpcInteractionOffers({
    npc: npc('npc_council_clerk'),
    dialogue: tree('council_exam'),
    quests,
    questProgress: {},
  });
  assert.deepEqual(clerk.map((offer) => offer.id), ['talk', 'goodbye']);
});

test('a player at a shop counter is in range of that shopkeeper', () => {
  for (const [npcId, shopId] of [
    ['npc_mara', 'metaphysical_shop'],
    ['npc_tom', 'grocery_store'],
    ['npc_elena', 'pharmacy'],
  ]) {
    const post = town.interactables.find((inter) => inter.data?.shopId === shopId);
    const found = nearestNpcInteractable(post.x, post.y, npcId, town.interactables, (id) => shopNpc.get(id));
    assert.equal(found?.id, post.id);
    const far = nearestNpcInteractable(post.x + 30, post.y, npcId, town.interactables, (id) => shopNpc.get(id));
    assert.equal(far, null);
  }
  const council = town.interactables.find((inter) => inter.id === 'npc_council');
  const found = nearestNpcInteractable(
    council.x,
    council.y,
    'npc_council_clerk',
    town.interactables,
    (id) => shopNpc.get(id)
  );
  assert.equal(found?.id, 'npc_council');
});

test('published choices use stable ids and the server rechecks them', () => {
  const mara = tree('mara_intro');
  const progression = defaultProgression();
  const start = publishDialogueChoices(mara, 'start', progression, DEFAULT_STATS, 0);
  assert.deepEqual(start.map((choice) => choice.id), ['start:0', 'start:1', 'start:2', 'start:3']);
  assert.ok(start.slice(0, 3).every((choice) => choice.available));
  assert.equal(start[3].available, false);
  assert.match(start[3].requirement, /close enough/);
  assert.equal(/\d/.test(start[3].requirement), false);

  const snapshot = JSON.stringify(mara);
  const inventoryA = [];
  const inventoryB = [];
  const granted = resolveDialogueChoice(mara, 'folk_lore', 'folk_lore:0', {
    inventory: inventoryA,
    progression,
    stats: DEFAULT_STATS,
    coins: 0,
  });
  const other = resolveDialogueChoice(mara, 'folk_lore', 'folk_lore:1', {
    inventory: inventoryB,
    progression,
    stats: DEFAULT_STATS,
    coins: 0,
  });
  assert.equal(granted.ok, true);
  assert.equal(granted.inventory.some((slot) => slot.itemId === 'book_folk_magic'), true);
  assert.equal(other.ok, true);
  assert.equal(other.inventory, undefined);
  assert.deepEqual(inventoryA, []);
  assert.deepEqual(inventoryB, []);
  assert.equal(JSON.stringify(mara), snapshot);

  const forged = resolveDialogueChoice(mara, 'start', 'folk_lore:0', {
    inventory: [],
    progression,
    stats: DEFAULT_STATS,
    coins: 999,
  });
  assert.equal(forged.ok, false);
  assert.equal(forged.inventory, undefined);

  const labeled = resolveDialogueChoice(mara, 'folk_lore', "I'll take the book.", {
    inventory: [],
    progression,
    stats: DEFAULT_STATS,
    coins: 0,
  });
  assert.equal(labeled.ok, false);
});

test('an ineligible or unpaid exam cannot grant a license', () => {
  const council = tree('council_exam');
  const healer = council.nodes.find((node) => node.id === 'scan_healer');
  const pay = healer.choices[0];
  assert.equal(pay.grantLicense, 'healer_license');
  const progression = defaultProgression();
  const shown = publishDialogueChoices(council, 'scan_healer', progression, DEFAULT_STATS, 0);
  const exam = shown.find((choice) => choice.id === 'scan_healer:0');
  assert.equal(exam.available, false);
  assert.match(exam.requirement, /Practitioner Level/);

  const broke = resolveDialogueChoice(council, 'scan_healer', 'scan_healer:0', {
    inventory: [],
    progression,
    stats: DEFAULT_STATS,
    coins: 10_000,
  });
  assert.equal(broke.ok, false);
  assert.equal(broke.reason.includes('coins'), false);
  assert.equal(progression.earnedLicenses?.length ?? 0, 0);

  const richBeginner = resolveDialogueChoice(council, 'scan_healer', 'scan_healer:0', {
    inventory: [],
    progression,
    stats: DEFAULT_STATS,
    coins: 0,
  });
  assert.equal(richBeginner.ok, false);
  assert.equal(progression.earnedLicenses?.length ?? 0, 0);
});

test('a stale choice id is rejected after the node changes', () => {
  const mara = tree('mara_intro');
  const moved = resolveDialogueChoice(mara, 'protection', 'start:0', {
    inventory: [],
    progression: defaultProgression(),
    stats: DEFAULT_STATS,
    coins: 0,
  });
  assert.equal(moved.ok, false);
  assert.match(moved.reason, /no longer open/);
});
