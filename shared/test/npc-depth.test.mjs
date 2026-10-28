import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_STATS,
  applyDialogueActions,
  beginDialogueVisit,
  bondGreeting,
  defaultProgression,
  emptyWorldKnowledgeStore,
  getSocialDocument,
  knowledgeRevealBlockReason,
  listLessonOffers,
  parseConversationPolicy,
  personalityGiftAffinityScale,
  publishDialogueChoices,
  purchaseLesson,
  resolveDialogueChoice,
  setKnowledgeContent,
  setLessonContent,
  setLicensesContent,
  setRecognitionContent,
  setSocialContent,
  tryRevealKnowledge,
  validateDialogueTree,
  validateKnowledgeDocument,
  validateLessonDocument,
  canStartConversation,
  acquireConversationLock,
  buildNpcEncounterView,
  buildPeopleDossierPatch,
  applyDiscoveryEvent,
  listDiscoveredCluesForNpc,
  formatClueLine,
} from '../dist/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
function loadJson(path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
}

setRecognitionContent(loadJson('content/progression/recognition-tiers.json'));
setLicensesContent(loadJson('content/progression/licenses.json'));
setSocialContent(loadJson('content/social.json'));
setKnowledgeContent(loadJson('content/knowledge.json'));
setLessonContent(loadJson('content/lessons.json'));

const dialogues = loadJson('content/dialogues.json');
const maraTree = dialogues.find((tree) => tree.id === 'mara_intro');
const rowanTree = dialogues.find((tree) => tree.id === 'rowan_circle');

test('different NPC personalities produce distinct gift affinity scales', () => {
  const social = getSocialDocument();
  const mara = social.npcs.npc_mara.personality;
  const tom = social.npcs.npc_tom.personality;
  assert.ok(mara);
  assert.ok(tom);
  const maraScale = personalityGiftAffinityScale(mara);
  const tomScale = personalityGiftAffinityScale(tom);
  assert.notEqual(maraScale, tomScale);
  assert.ok(tomScale > maraScale);
});

test('relationship milestones unlock knowledge and lessons', () => {
  const stranger = defaultProgression();
  const block = knowledgeRevealBlockReason(
    loadJson('content/knowledge.json').entries.find((e) => e.id === 'rumor_coven_stones'),
    'npc_mara',
    stranger
  );
  assert.ok(block);

  const familiar = defaultProgression();
  familiar.social = {
    bonds: {
      npc_mara: {
        axes: { familiarity: 20, affinity: 12, trust: 8 },
        grudges: [],
        memories: [],
        onceEvents: [],
        giftCounts: {},
        giftReceipts: [],
        knownPreferences: [],
        actionNextAt: {},
        actionReceipts: [],
      },
    },
    scopes: {},
  };
  assert.equal(
    knowledgeRevealBlockReason(
      loadJson('content/knowledge.json').entries.find((e) => e.id === 'rumor_coven_stones'),
      'npc_mara',
      familiar
    ),
    null
  );

  const lessons = listLessonOffers('npc_circle_leader', stranger, 100, []);
  assert.ok(lessons.some((lesson) => lesson.id === 'lesson_rowan_ward_basics' && !lesson.available));
});

test('secrets are discoverable only under valid conditions and stay personal by default', () => {
  const progression = defaultProgression();
  progression.social = {
    bonds: {
      npc_mara: {
        axes: { familiarity: 20, affinity: 5, trust: 5 },
        grudges: [],
        memories: [],
        onceEvents: [],
        giftCounts: {},
        giftReceipts: [],
        knownPreferences: [],
        actionNextAt: {},
        actionReceipts: [],
      },
    },
    scopes: {},
  };
  const denied = tryRevealKnowledge({
    knowledgeId: 'rumor_coven_stones',
    npcId: 'npc_tom',
    progression,
  });
  assert.equal(denied.ok, false);

  const revealed = tryRevealKnowledge({
    knowledgeId: 'rumor_coven_stones',
    npcId: 'npc_mara',
    progression,
  });
  assert.equal(revealed.ok, true);
  assert.equal(revealed.alreadyKnown, false);
  assert.ok(revealed.progression.discoveredKnowledge.includes('rumor_coven_stones'));
  assert.ok(revealed.progression.storyFlags.includes('knows_old_coven_site'));
  assert.equal(revealed.worldStore, undefined);
});

test('world discoveries persist globally while personal ones do not', () => {
  const a = defaultProgression();
  a.social = {
    bonds: {
      npc_librarian: {
        axes: { familiarity: 10 },
        grudges: [],
        memories: [],
        onceEvents: [],
        giftCounts: {},
        giftReceipts: [],
        knownPreferences: [],
        actionNextAt: {},
        actionReceipts: [],
      },
    },
    scopes: {},
  };
  const store = emptyWorldKnowledgeStore();
  const first = tryRevealKnowledge({
    knowledgeId: 'world_lantern_watch',
    npcId: 'npc_librarian',
    progression: a,
    worldStore: store,
    playerId: 'p1',
  });
  assert.equal(first.ok, true);
  assert.ok(first.worldStore.discoveries.world_lantern_watch);

  const b = defaultProgression();
  const second = tryRevealKnowledge({
    knowledgeId: 'world_lantern_watch',
    npcId: 'npc_librarian',
    progression: b,
    worldStore: first.worldStore,
  });
  // Player B still needs the NPC/bond gate; stranger librarian blocks.
  assert.equal(second.ok, false);
});

test('teachers unlock existing progression without duplicate rewards', () => {
  let progression = defaultProgression();
  progression.questProgress = { quest_first_steps: { completedAt: 1 } };
  progression.social = {
    bonds: {
      npc_circle_leader: {
        axes: { familiarity: 20, respect: 10, trust: 10 },
        grudges: [],
        memories: [],
        onceEvents: [],
        giftCounts: {},
        giftReceipts: [],
        knownPreferences: [],
        actionNextAt: {},
        actionReceipts: [],
      },
    },
    scopes: {},
  };
  const first = purchaseLesson({
    lessonId: 'lesson_rowan_ward_basics',
    npcId: 'npc_circle_leader',
    progression,
    stats: { ...DEFAULT_STATS },
    coins: 40,
    inventory: [],
  });
  assert.equal(first.ok, true);
  assert.equal(first.alreadyComplete, false);
  assert.ok(first.progression.completedLessons.includes('lesson_rowan_ward_basics'));
  assert.equal(first.coinsDelta, -15);

  const again = purchaseLesson({
    lessonId: 'lesson_rowan_ward_basics',
    npcId: 'npc_circle_leader',
    progression: first.progression,
    stats: { ...DEFAULT_STATS },
    coins: 40,
    inventory: [],
  });
  assert.equal(again.ok, true);
  assert.equal(again.alreadyComplete, true);
});

test('teacher lessons gate on tradition affinity and spiritual reputation', () => {
  const progression = defaultProgression();
  progression.questProgress = { quest_first_steps: { completedAt: 1 } };
  progression.completedLessons = ['lesson_rowan_ward_basics'];
  progression.social = {
    bonds: {
      npc_circle_leader: {
        axes: { familiarity: 40, affinity: 20, respect: 15, trust: 15 },
        grudges: [],
        memories: [],
        onceEvents: [],
        giftCounts: {},
        giftReceipts: [],
        knownPreferences: [],
        actionNextAt: {},
        actionReceipts: [],
      },
    },
    scopes: {},
  };

  const weak = purchaseLesson({
    lessonId: 'lesson_rowan_healing_charm',
    npcId: 'npc_circle_leader',
    progression,
    stats: {
      ...DEFAULT_STATS,
      affinities: { ...DEFAULT_STATS.affinities, traditional_european: 8 },
      spiritualReputation: 0,
    },
    coins: 40,
    inventory: [],
  });
  assert.equal(weak.ok, false);

  const ready = purchaseLesson({
    lessonId: 'lesson_rowan_healing_charm',
    npcId: 'npc_circle_leader',
    progression,
    stats: {
      ...DEFAULT_STATS,
      affinities: { ...DEFAULT_STATS.affinities, traditional_european: 20 },
      spiritualReputation: 10,
    },
    coins: 40,
    inventory: [],
  });
  assert.equal(ready.ok, true);
  assert.equal(ready.alreadyComplete, false);
});

test('NPC memories influence subsequent conversations', () => {
  const progression = beginDialogueVisit(defaultProgression(), 'mara_intro', 'npc_mara');
  progression.social.bonds.npc_mara.memories = [
    {
      id: 'broke_promise',
      kind: 'grudge',
      importance: 8,
      at: Date.now(),
      visible: true,
      text: 'You broke a promise.',
    },
  ];
  progression.social.bonds.npc_mara.grudges = ['broke_promise'];
  const line = bondGreeting('npc_mara', progression);
  assert.match(line ?? '', /word you broke/i);

  const parsed = validateDialogueTree(maraTree);
  assert.equal(parsed.ok, true);
  const start = parsed.tree.nodes.find((node) => node.id === 'start');
  assert.ok(start.textVariants?.length);
});

test('dialogue actions cannot invent unlocks the NPC does not know', () => {
  const progression = defaultProgression();
  const result = applyDialogueActions(
    [{ type: 'unlock_knowledge', knowledgeId: 'rumor_coven_stones' }],
    {
      npcId: 'npc_tom',
      progression,
      stats: { ...DEFAULT_STATS },
      inventory: [],
      coins: 0,
    }
  );
  assert.equal(result.ok, false);
});

test('exclusive conversation policy blocks a second player', () => {
  assert.equal(parseConversationPolicy('exclusive'), 'exclusive');
  const first = acquireConversationLock({
    locks: [],
    npcId: 'npc_circle_leader',
    playerId: 'a',
    sessionId: 's1',
    policy: 'exclusive',
  });
  assert.equal(first.acquired, true);
  const second = canStartConversation('working', 'exclusive', first.locks, 'npc_circle_leader', 'b');
  assert.equal(second.ok, false);
});

test('multi-visit dialogue choices stay authoritative', () => {
  let progression = defaultProgression();
  progression = beginDialogueVisit(progression, 'mara_intro', 'npc_mara');
  const published = publishDialogueChoices(maraTree, 'start', progression, DEFAULT_STATS, 10);
  assert.ok(published.some((choice) => choice.label.includes('rumors') || choice.id.includes('rumors') || choice.label.includes('Heard')));

  const choice = published.find((entry) => entry.label.includes('Heard')) ?? published[0];
  const outcome = resolveDialogueChoice(maraTree, 'start', choice.id, {
    inventory: [],
    progression,
    stats: DEFAULT_STATS,
    coins: 10,
  });
  assert.equal(outcome.ok, true);
});

test('knowledge and lesson documents validate', () => {
  assert.equal(validateKnowledgeDocument(loadJson('content/knowledge.json')).ok, true);
  assert.equal(validateLessonDocument(loadJson('content/lessons.json')).ok, true);
  assert.equal(validateDialogueTree(rowanTree).ok, true);
});

test('encounter view stays player-safe and marks gift cooldowns', () => {
  const npcs = loadJson('content/npcs.json');
  const mara = npcs.find((npc) => npc.id === 'npc_mara');
  assert.ok(mara);
  const progression = defaultProgression();
  progression.social = {
    bonds: {
      npc_mara: {
        axes: { familiarity: 25, affinity: 10, trust: 8 },
        grudges: [],
        memories: [
          {
            id: 'met',
            kind: 'moment',
            importance: 2,
            at: 1,
            visible: true,
            text: 'You bought your first herb from her.',
          },
        ],
        onceEvents: [],
        giftCounts: {},
        giftReceipts: [],
        knownPreferences: [],
        giftNextAt: Date.now() + 60_000,
        actionNextAt: {},
        actionReceipts: [],
      },
    },
    scopes: {},
  };
  const view = buildNpcEncounterView({
    npc: mara,
    dialogue: maraTree,
    progression,
    stats: DEFAULT_STATS,
    inventory: [],
    coins: 20,
    contextShopId: mara.shopId,
    now: Date.now(),
  });
  assert.equal(view.npcId, 'npc_mara');
  assert.ok(view.relationship.signals.length >= 1);
  assert.ok(!JSON.stringify(view).includes('"affinity":'));
  const gift = view.options.find((offer) => offer.id === 'gift');
  assert.ok(gift);
  assert.equal(gift.available, false);
  assert.ok(gift.requirement);

  const dossier = buildPeopleDossierPatch({ npc: mara, progression });
  assert.equal(dossier.role, mara.role);
  assert.ok(dossier.stageLabel);
  assert.ok(!('affinity' in dossier));
});

test('discovery pipeline reveals once, blocks prereqs, and hides undiscovered clues', () => {
  const stranger = defaultProgression();
  const blocked = applyDiscoveryEvent({
    source: 'meet',
    npcId: 'npc_mara',
    progression: stranger,
  });
  assert.ok(blocked.revealed.some((row) => row.id === 'meet_mara_shop' && !row.alreadyKnown));
  assert.ok(blocked.progression.discoveredKnowledge.includes('meet_mara_shop'));

  const again = applyDiscoveryEvent({
    source: 'meet',
    npcId: 'npc_mara',
    progression: blocked.progression,
  });
  assert.ok(again.revealed.some((row) => row.id === 'meet_mara_shop' && row.alreadyKnown));
  assert.equal(again.notifications.length, 0);

  const withoutRumor = applyDiscoveryEvent({
    source: 'quest',
    questId: 'quest_mara_favor',
    npcId: 'npc_tom',
    progression: blocked.progression,
  });
  assert.ok(!withoutRumor.revealed.some((row) => row.id === 'clue_market_ward_truth'));

  const withRumor = defaultProgression();
  withRumor.discoveredKnowledge = ['rumor_market_ward'];
  withRumor.social = {
    bonds: {
      npc_tom: {
        axes: { familiarity: 25, affinity: 8, trust: 5 },
        grudges: [],
        memories: [],
        onceEvents: [],
        giftCounts: {},
        giftReceipts: [],
        knownPreferences: [],
        actionNextAt: {},
        actionReceipts: [],
      },
    },
    scopes: {},
  };
  const clarified = applyDiscoveryEvent({
    source: 'quest',
    questId: 'quest_mara_favor',
    npcId: 'npc_tom',
    progression: withRumor,
  });
  assert.ok(clarified.revealed.some((row) => row.id === 'clue_market_ward_truth' && !row.alreadyKnown));
  const clues = listDiscoveredCluesForNpc('npc_tom', clarified.progression);
  assert.ok(clues.some((clue) => clue.id === 'rumor_market_ward' && clue.status === 'clarified'));
  assert.ok(formatClueLine(clues.find((clue) => clue.id === 'rumor_market_ward')).includes('clarified'));

  const hidden = listDiscoveredCluesForNpc('npc_mara', stranger);
  assert.ok(!hidden.some((clue) => clue.id === 'rumor_coven_stones'));
});

test('world discoveries persist while personal ones stay private', () => {
  const store = emptyWorldKnowledgeStore();
  const a = defaultProgression();
  a.social = {
    bonds: {
      npc_librarian: {
        axes: { familiarity: 12 },
        grudges: [],
        memories: [],
        onceEvents: [],
        giftCounts: {},
        giftReceipts: [],
        knownPreferences: [],
        actionNextAt: {},
        actionReceipts: [],
      },
    },
    scopes: {},
  };
  const first = applyDiscoveryEvent({
    source: 'observe',
    locationId: 'town',
    npcId: 'npc_librarian',
    progression: a,
    worldStore: store,
    playerId: 'p1',
  });
  assert.ok(first.revealed.some((row) => row.id === 'world_lantern_watch'));
  assert.ok(first.worldStore?.discoveries.world_lantern_watch);

  const b = defaultProgression();
  b.social = {
    bonds: {
      npc_librarian: {
        axes: { familiarity: 12 },
        grudges: [],
        memories: [],
        onceEvents: [],
        giftCounts: {},
        giftReceipts: [],
        knownPreferences: [],
        actionNextAt: {},
        actionReceipts: [],
      },
    },
    scopes: {},
  };
  const second = applyDiscoveryEvent({
    source: 'observe',
    locationId: 'town',
    npcId: 'npc_librarian',
    progression: b,
    worldStore: first.worldStore,
    playerId: 'p2',
  });
  assert.ok(second.revealed.some((row) => row.id === 'world_lantern_watch'));
  assert.ok(second.progression.discoveredKnowledge.includes('world_lantern_watch'));
});
