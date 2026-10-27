import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_STATS,
  applySocialEvent,
  bondAllowsQuest,
  bondGreeting,
  bondShopMultiplier,
  buildNpcInteractionOffers,
  defaultProgression,
  getNpcRelationshipLevel,
  parseProgression,
  publishDialogueChoices,
  resolveDialogueChoice,
  setSocialContent,
  takeAppreciatedGift,
  withBondJournal,
} from '../dist/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const social = JSON.parse(readFileSync(join(root, 'content/social.json'), 'utf8'));
const dialogues = JSON.parse(readFileSync(join(root, 'content/dialogues.json'), 'utf8'));
const npcs = JSON.parse(readFileSync(join(root, 'content/npcs.json'), 'utf8'));
setSocialContent(social);

const maraTree = dialogues.find((entry) => entry.id === 'mara_intro');
const mara = npcs.find((entry) => entry.id === 'npc_mara');

function bond(progression, npcId) {
  return progression.social.bonds[npcId];
}

test('two players keep separate bonds with the same NPC', () => {
  const liked = defaultProgression();
  const disliked = defaultProgression();
  const likedStats = { ...DEFAULT_STATS };
  const dislikedStats = { ...DEFAULT_STATS };
  const beforeLiked = JSON.stringify(liked);
  const beforeDisliked = JSON.stringify(disliked);
  const beforeStats = JSON.stringify(likedStats);

  const warm = applySocialEvent(liked, likedStats, { eventId: 'dialogue_regard', npcId: 'npc_mara', scale: 3 });
  const cold = applySocialEvent(disliked, dislikedStats, { eventId: 'dialogue_slight', npcId: 'npc_mara', scale: 4 });

  assert.equal(JSON.stringify(liked), beforeLiked);
  assert.equal(JSON.stringify(disliked), beforeDisliked);
  assert.equal(JSON.stringify(likedStats), beforeStats);
  assert.equal(bond(warm.progression, 'npc_mara').axes.familiarity, 3);
  assert.equal(bond(warm.progression, 'npc_mara').axes.affinity, undefined);
  assert.equal(bond(cold.progression, 'npc_mara').axes.affinity, -4);
  assert.equal(bond(cold.progression, 'npc_mara').axes.trust, -4);
  assert.equal(bond(cold.progression, 'npc_mara').axes.familiarity, undefined);
  assert.equal(bond(warm.progression, 'npc_mara').axes.trust, undefined);
});

test('an NPC without an axis skips that effect', () => {
  const foreman = applySocialEvent(defaultProgression(), DEFAULT_STATS, {
    eventId: 'dialogue_slight',
    npcId: 'npc_seal_yard_foreman',
  });
  assert.equal(foreman.applied, false);
  const reader = applySocialEvent(defaultProgression(), DEFAULT_STATS, {
    eventId: 'dialogue_slight',
    npcId: 'npc_psychic_tent_reader',
  });
  assert.equal(reader.applied, false);
  assert.equal(reader.progression.social.bonds.npc_psychic_tent_reader, undefined);
});

test('relationship changes survive a progression round trip', () => {
  const completed = applySocialEvent(defaultProgression(), DEFAULT_STATS, {
    eventId: 'quest_complete',
    npcId: 'npc_mara',
    idempotencyKey: 'quest_first_steps',
  });
  const saved = parseProgression(JSON.parse(JSON.stringify(completed.progression)));
  assert.equal(bond(saved, 'npc_mara').axes.trust, bond(completed.progression, 'npc_mara').axes.trust);
  assert.equal(bond(saved, 'npc_mara').axes.familiarity, 2);
  assert.equal(saved.social.scopes.town, 2);
  assert.ok(bond(saved, 'npc_mara').memories.some((memory) => memory.id === 'quest_complete'));
  assert.ok(bond(saved, 'npc_mara').onceEvents.includes('quest_complete:quest_first_steps'));
});

test('a purchase raises familiarity and leaves affection and public reputation alone', () => {
  const first = applySocialEvent(defaultProgression(), DEFAULT_STATS, {
    eventId: 'shop_purchase',
    npcId: 'npc_mara',
  });
  const second = applySocialEvent(first.progression, first.stats, {
    eventId: 'shop_purchase',
    npcId: 'npc_mara',
  });
  assert.equal(bond(second.progression, 'npc_mara').axes.familiarity, 2);
  assert.equal(bond(second.progression, 'npc_mara').axes.affinity, undefined);
  assert.equal(second.stats.publicReputation, DEFAULT_STATS.publicReputation);
  assert.equal(second.progression.social.scopes.town, undefined);
  assert.equal(first.progression.npcRelationships.npc_mara, 1);
});

test('community standing and a personal bond move on their own events', () => {
  const aid = applySocialEvent(defaultProgression(), DEFAULT_STATS, {
    eventId: 'community_aid',
    npcId: 'npc_mara',
  });
  assert.equal(aid.progression.social.scopes.town, 3);
  assert.equal(bond(aid.progression, 'npc_mara').axes.affinity, 2);
  assert.equal(aid.stats.publicReputation, 1);
  const repeat = applySocialEvent(aid.progression, aid.stats, { eventId: 'community_aid', npcId: 'npc_mara' });
  assert.equal(repeat.duplicate, true);
  assert.equal(repeat.progression.social.scopes.town, 3);

  const other = applySocialEvent(defaultProgression(), DEFAULT_STATS, {
    eventId: 'community_aid',
    npcId: 'npc_mara',
  });
  assert.equal(other.applied, true);
  assert.equal(other.stats.publicReputation, 1);

  const faction = applySocialEvent(defaultProgression(), DEFAULT_STATS, {
    eventId: 'faction_occult_merchants',
    npcId: 'npc_mara',
  });
  assert.equal(faction.progression.social.scopes.occult_merchants, 1);
  assert.equal(bond(faction.progression, 'npc_mara').axes.affinity, undefined);
  assert.equal(faction.stats.publicReputation, 0);
});

test('a kept promise applies once, and a broken promise changes later dialogue', () => {
  const broken = applySocialEvent(defaultProgression(), DEFAULT_STATS, {
    eventId: 'promise_broken',
    npcId: 'npc_mara',
  });
  assert.ok(bond(broken.progression, 'npc_mara').grudges.includes('broke_promise'));
  const kept = applySocialEvent(broken.progression, broken.stats, {
    eventId: 'promise_kept',
    npcId: 'npc_mara',
  });
  const trust = bond(kept.progression, 'npc_mara').axes.trust;
  const again = applySocialEvent(kept.progression, kept.stats, { eventId: 'promise_kept', npcId: 'npc_mara' });
  assert.equal(again.duplicate, true);
  assert.equal(again.applied, false);
  assert.equal(bond(kept.progression, 'npc_mara').axes.trust, trust);
  assert.equal(bond(kept.progression, 'npc_mara').grudges.includes('broke_promise'), false);

  const stranger = publishDialogueChoices(maraTree, 'start', defaultProgression(), DEFAULT_STATS, 0);
  const locked = stranger.find((choice) => choice.id === 'start:3');
  assert.equal(locked.available, false);
  assert.match(locked.requirement, /close enough/);
  assert.equal(/\d/.test(locked.requirement), false);

  const known = applySocialEvent(defaultProgression(), DEFAULT_STATS, {
    eventId: 'dialogue_regard',
    npcId: 'npc_mara',
    scale: 15,
  });
  const open = publishDialogueChoices(maraTree, 'start', known.progression, DEFAULT_STATS, 0).find(
    (choice) => choice.id === 'start:3'
  );
  assert.equal(open.available, true);

  const wounded = applySocialEvent(known.progression, known.stats, {
    eventId: 'promise_broken',
    npcId: 'npc_mara',
  });
  const hurt = publishDialogueChoices(maraTree, 'start', wounded.progression, DEFAULT_STATS, 0).find(
    (choice) => choice.id === 'start:3'
  );
  assert.equal(hurt.available, false);
  assert.match(hurt.requirement, /wound/);
  assert.equal(/\d/.test(hurt.requirement), false);

  const mended = applySocialEvent(wounded.progression, wounded.stats, {
    eventId: 'promise_kept',
    npcId: 'npc_mara',
  });
  const restored = publishDialogueChoices(maraTree, 'start', mended.progression, DEFAULT_STATS, 0).find(
    (choice) => choice.id === 'start:3'
  );
  assert.equal(restored.available, true);

  const forged = resolveDialogueChoice(maraTree, 'start', 'start:3', {
    inventory: [],
    progression: defaultProgression(),
    stats: DEFAULT_STATS,
    coins: 0,
  });
  assert.equal(forged.ok, false);
  assert.equal(/\d/.test(forged.reason), false);

  const allowed = resolveDialogueChoice(maraTree, 'start', 'start:3', {
    inventory: [],
    progression: known.progression,
    stats: DEFAULT_STATS,
    coins: 0,
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.nextNodeId, 'private_lore');
});

test('a finished quest is remembered once and changes the greeting', () => {
  const first = applySocialEvent(defaultProgression(), DEFAULT_STATS, {
    eventId: 'quest_complete',
    npcId: 'npc_mara',
    idempotencyKey: 'quest_first_steps',
  });
  const second = applySocialEvent(first.progression, first.stats, {
    eventId: 'quest_complete',
    npcId: 'npc_mara',
    idempotencyKey: 'quest_first_steps',
  });
  assert.equal(second.duplicate, true);
  assert.equal(bond(first.progression, 'npc_mara').axes.trust, 6);
  const other = applySocialEvent(first.progression, first.stats, {
    eventId: 'quest_complete',
    npcId: 'npc_mara',
    idempotencyKey: 'quest_other',
  });
  assert.equal(other.applied, true);
  assert.equal(bond(other.progression, 'npc_mara').axes.trust, 12);
  assert.equal(
    bondGreeting('npc_mara', first.progression),
    'You came back. That working you finished for me was real.'
  );

  const journal = withBondJournal(first.progression, 'npc_mara', 'Mara Whitethorn');
  const entry = journal.grimoire.npcs.find((row) => row.npcId === 'npc_mara');
  assert.equal(entry.stageLabel.length > 0, true);
  assert.ok(entry.memories.some((line) => line.includes('finished a task')));
  assert.equal(JSON.stringify(entry).includes('rosemary'), false);
  assert.equal(JSON.stringify(entry).includes('frankincense'), false);
  assert.equal(/\d/.test((entry.regard ?? []).join(' ')), false);
});

test('older single-score regard becomes familiarity and still moves recognition', () => {
  const legacy = parseProgression({ npcRelationships: { npc_mara: 15, npc_circle_leader: 15 } });
  assert.equal(bond(legacy, 'npc_mara').axes.familiarity, 15);
  assert.equal(getNpcRelationshipLevel(legacy, 'npc_mara'), 15);
  assert.equal(getNpcRelationshipLevel(legacy, 'npc_circle_leader'), 15);
  const talked = applySocialEvent(legacy, DEFAULT_STATS, { eventId: 'dialogue_regard', npcId: 'npc_mara' });
  assert.equal(getNpcRelationshipLevel(talked.progression, 'npc_mara'), 16);
  assert.equal(getNpcRelationshipLevel(legacy, 'npc_mara'), 15);
  assert.equal(bond(talked.progression, 'npc_mara').axes.trust, undefined);
});

test('returning stolen goods repairs only part of the hurt', () => {
  const stolen = applySocialEvent(defaultProgression(), DEFAULT_STATS, {
    eventId: 'steal_from_npc',
    npcId: 'npc_tom',
  });
  assert.equal(bond(stolen.progression, 'npc_tom').axes.affinity, -8);
  assert.ok(bond(stolen.progression, 'npc_tom').grudges.includes('theft'));
  const returned = applySocialEvent(stolen.progression, stolen.stats, {
    eventId: 'return_stolen',
    npcId: 'npc_tom',
  });
  assert.equal(bond(returned.progression, 'npc_tom').axes.affinity, -4);
  assert.equal(bond(returned.progression, 'npc_tom').grudges.includes('theft'), false);
  const twice = applySocialEvent(returned.progression, returned.stats, {
    eventId: 'return_stolen',
    npcId: 'npc_tom',
  });
  assert.equal(twice.duplicate, true);
  assert.equal(bond(returned.progression, 'npc_tom').axes.affinity, -4);
});

test('gifts follow the NPC profile and a shop discount waits for that NPC stage', () => {
  const carrying = [
    { itemId: 'bread', quantity: 1 },
    { itemId: 'rosemary', quantity: 2 },
  ];
  const refused = takeAppreciatedGift(carrying, 'npc_elena');
  assert.equal(refused.ok, false);
  assert.equal(refused.reason.includes('rosemary'), false);
  assert.equal(refused.reason.includes('frankincense'), false);
  const given = takeAppreciatedGift(carrying, 'npc_mara');
  assert.equal(given.ok, true);
  assert.equal(given.itemId, 'rosemary');
  assert.equal(given.inventory.find((slot) => slot.itemId === 'rosemary').quantity, 1);

  let progression = defaultProgression();
  let stats = DEFAULT_STATS;
  assert.equal(bondShopMultiplier(progression, 'npc_mara'), 1);
  const known = applySocialEvent(progression, stats, { eventId: 'dialogue_regard', npcId: 'npc_mara', scale: 22 });
  progression = known.progression;
  stats = known.stats;
  const firstGift = applySocialEvent(progression, stats, { eventId: 'gift_appreciated', npcId: 'npc_mara' });
  assert.equal(bondShopMultiplier(firstGift.progression, 'npc_mara'), 1);
  const secondGift = applySocialEvent(firstGift.progression, firstGift.stats, {
    eventId: 'gift_appreciated',
    npcId: 'npc_mara',
  });
  assert.equal(bond(secondGift.progression, 'npc_mara').axes.affinity, 12);
  assert.ok(bond(secondGift.progression, 'npc_mara').axes.familiarity >= 24);
  assert.equal(bondShopMultiplier(secondGift.progression, 'npc_mara'), 0.9);
  assert.equal(bondShopMultiplier(secondGift.progression, 'npc_tom'), 1);
});

test('quest offers and the older Mara lines still resolve', () => {
  assert.equal(bondAllowsQuest(defaultProgression(), { id: 'quest_first_steps', npcId: 'npc_mara' }), true);
  assert.equal(
    bondAllowsQuest(defaultProgression(), { npcId: 'npc_mara', minStage: 'familiar' }),
    false
  );
  const offers = buildNpcInteractionOffers({
    npc: mara,
    dialogue: maraTree,
    contextShopId: 'metaphysical_shop',
    quests: [{ id: 'quest_first_steps', npcId: 'npc_mara' }],
    questProgress: {},
    acceptsGifts: true,
  });
  assert.ok(offers.some((offer) => offer.id === 'gift'));
  assert.ok(offers.some((offer) => offer.id === 'quests'));
  for (const choiceId of ['start:0', 'start:1', 'start:2']) {
    const resolved = resolveDialogueChoice(maraTree, 'start', choiceId, {
      inventory: [],
      progression: defaultProgression(),
      stats: DEFAULT_STATS,
      coins: 0,
    });
    assert.equal(resolved.ok, true, choiceId);
  }
});
