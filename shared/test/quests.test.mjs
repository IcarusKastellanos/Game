import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_STATS,
  abandonQuest,
  applyQuestSignal,
  claimSharedReward,
  defaultProgression,
  emptySharedQuestStore,
  offerQuestsOnTalk,
  parseProgression,
  projectSharedQuests,
  questRewards,
  reconcileQuestVersions,
  setSocialContent,
  startQuestDefinition,
  validateQuestDocument,
} from '../dist/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const quests = JSON.parse(readFileSync(join(root, 'content/quests.json'), 'utf8'));
const social = JSON.parse(readFileSync(join(root, 'content/social.json'), 'utf8'));
const npcs = JSON.parse(readFileSync(join(root, 'content/npcs.json'), 'utf8')).map((npc) => npc.id);
const items = JSON.parse(readFileSync(join(root, 'content/ingredients.json'), 'utf8')).map((item) => item.id);
setSocialContent(social);

const now = 1_700_000_000_000;
const stats = { ...DEFAULT_STATS, experience: 0 };

function signal(partial) {
  return { playerId: 'ada', now, quantity: 1, ...partial };
}

function regard(progression, npcId, axes, grudges = []) {
  return {
    ...progression,
    social: {
      ...progression.social,
      bonds: {
        ...progression.social.bonds,
        [npcId]: { axes, grudges },
      },
    },
  };
}

function finishedFirstSteps(progression) {
  return {
    ...progression,
    questProgress: {
      ...progression.questProgress,
      quest_first_steps: {
        questId: 'quest_first_steps',
        stage: 'complete',
        startedAt: now,
        completedAt: now + 1,
        version: 1,
        rewardsGrantedAt: now + 1,
      },
    },
  };
}

test('the written quests are valid and Mara still starts from a conversation', () => {
  assert.deepEqual(validateQuestDocument(quests, npcs, items), []);
  const offered = offerQuestsOnTalk(quests, defaultProgression(), 'npc_mara', { stats, now });
  assert.deepEqual(offered.started, ['quest_first_steps']);
  assert.equal(offered.progression.questProgress.quest_first_steps.stage, 'intro');
  assert.equal(offered.progression.questProgress.quest_mara_keepsake, undefined);

  const wrong = applyQuestSignal(quests, offered.progression, emptySharedQuestStore(), signal({
    type: 'cast_spell',
    spellId: 'apartment_ward',
  }), { stats, now });
  assert.equal(wrong.progression.questProgress.quest_first_steps.completedAt, undefined);

  const cast = applyQuestSignal(quests, offered.progression, emptySharedQuestStore(), signal({
    type: 'cast_spell',
    spellId: 'healing_charm',
    idempotencyKey: 'altar:healing_charm:1',
  }), { stats, now });
  assert.ok(cast.completed.includes('quest_first_steps'));
  assert.equal(cast.progression.questProgress.quest_first_steps.objectives.working.count, 1);

  const again = applyQuestSignal(quests, cast.progression, cast.store, signal({
    type: 'cast_spell',
    spellId: 'healing_charm',
    idempotencyKey: 'altar:healing_charm:1',
  }), { stats, now });
  assert.deepEqual(again.completed, []);
  assert.equal(again.progression.questProgress.quest_first_steps.objectives.working.count, 1);
  assert.equal(again.progression.questProgress.quest_first_steps.completedAt, cast.progression.questProgress.quest_first_steps.completedAt);
});

test('a second player keeps a separate personal quest', () => {
  const ada = offerQuestsOnTalk(quests, defaultProgression(), 'npc_mara', { stats, now }).progression;
  const beau = offerQuestsOnTalk(quests, defaultProgression(), 'npc_mara', { stats, now }).progression;
  const beforeBeau = JSON.stringify(beau);
  const done = applyQuestSignal(quests, ada, emptySharedQuestStore(), signal({
    type: 'cast_spell',
    spellId: 'healing_charm',
  }), { stats, now });
  assert.ok(done.progression.questProgress.quest_first_steps.completedAt);
  assert.equal(JSON.stringify(beau), beforeBeau);
  assert.equal(beau.questProgress.quest_first_steps.completedAt, undefined);
});

test('a new quest is only data: gates, delivery, and a dialogue choice', () => {
  const stranger = offerQuestsOnTalk(quests, finishedFirstSteps(defaultProgression()), 'npc_mara', { stats, now });
  assert.equal(stranger.started.includes('quest_mara_keepsake'), false);

  const trusted = regard(finishedFirstSteps(defaultProgression()), 'npc_mara', { familiarity: 16, affinity: 1 });
  const offered = offerQuestsOnTalk(quests, trusted, 'npc_mara', { stats, now });
  assert.ok(offered.started.includes('quest_mara_keepsake'));

  const wounded = regard(finishedFirstSteps(defaultProgression()), 'npc_mara', { familiarity: 16 }, ['broke_promise']);
  const refused = offerQuestsOnTalk(quests, wounded, 'npc_mara', { stats, now });
  assert.equal(refused.started.includes('quest_mara_keepsake'), false);
  assert.ok(refused.started.includes('quest_mara_amends'));

  const disliked = regard(finishedFirstSteps(defaultProgression()), 'npc_mara', { familiarity: 30, affinity: -20 });
  assert.equal(offerQuestsOnTalk(quests, disliked, 'npc_mara', { stats, now }).started.includes('quest_mara_favor'), false);
  const fond = regard(finishedFirstSteps(defaultProgression()), 'npc_mara', { familiarity: 30, affinity: 12 });
  assert.ok(offerQuestsOnTalk(quests, fond, 'npc_mara', { stats, now }).started.includes('quest_mara_favor'));

  const told = applyQuestSignal(quests, offered.progression, emptySharedQuestStore(), signal({
    type: 'dialogue',
    npcId: 'npc_mara',
    choiceId: 'mara_tell_circle',
    idempotencyKey: 'dialogue:tell',
  }), { stats, now });
  assert.ok(told.completed.includes('quest_mara_keepsake'));
  assert.ok(told.progression.storyFlags.includes('mara_secret_told'));
  assert.equal(questRewards(quests.find((quest) => quest.id === 'quest_mara_keepsake'), told.progression.questProgress.quest_mara_keepsake).reputation, 1);
  assert.equal(told.started.includes('quest_mara_confidence'), false);

  const keptBase = offerQuestsOnTalk(quests, trusted, 'npc_mara', { stats, now }).progression;
  const kept = applyQuestSignal(quests, keptBase, emptySharedQuestStore(), signal({
    type: 'dialogue',
    npcId: 'npc_mara',
    choiceId: 'mara_keep_secret',
    idempotencyKey: 'dialogue:keep',
  }), { stats, now });
  assert.equal(kept.progression.questProgress.quest_mara_keepsake.completedAt, undefined);
  assert.ok(kept.progression.storyFlags.includes('mara_secret_kept'));
  const delivered = applyQuestSignal(quests, kept.progression, kept.store, signal({
    type: 'deliver',
    npcId: 'npc_mara',
    itemId: 'rosemary',
    idempotencyKey: 'gift:rosemary:1',
  }), { stats, now });
  assert.ok(delivered.completed.includes('quest_mara_keepsake'));
  assert.ok(delivered.started.includes('quest_mara_confidence'));
  const deliveredAgain = applyQuestSignal(quests, delivered.progression, delivered.store, signal({
    type: 'deliver',
    npcId: 'npc_mara',
    itemId: 'rosemary',
    idempotencyKey: 'gift:rosemary:1',
  }), { stats, now });
  assert.deepEqual(deliveredAgain.completed, []);
  assert.equal(deliveredAgain.started.includes('quest_mara_confidence'), false);
});

test('Rowan withholds the lesson until the player is familiar and has practiced', () => {
  const practiced = finishedFirstSteps(defaultProgression());
  assert.equal(offerQuestsOnTalk(quests, practiced, 'npc_circle_leader', { stats, now }).started.includes('quest_rowan_lesson'), false);
  const known = regard(practiced, 'npc_circle_leader', { familiarity: 16 });
  assert.ok(offerQuestsOnTalk(quests, known, 'npc_circle_leader', { stats, now }).started.includes('quest_rowan_lesson'));
});

test('personal, party, and world scopes do not share the wrong progress', () => {
  const store = emptySharedQuestStore();
  const ada = applyQuestSignal(quests, defaultProgression(), store, signal({
    playerId: 'ada',
    type: 'public_event',
    eventId: 'lantern_vigil',
    idempotencyKey: 'vigil:ada',
  }), { stats, now });
  assert.equal(ada.progression.questProgress.quest_hearth_vigil.completedAt, undefined);
  assert.equal(ada.store.worlds.quest_hearth_vigil.countByObjective.lamps, 1);
  const duplicate = applyQuestSignal(quests, ada.progression, ada.store, signal({
    playerId: 'ada',
    type: 'public_event',
    eventId: 'lantern_vigil',
    idempotencyKey: 'vigil:ada',
  }), { stats, now });
  assert.equal(duplicate.store.worlds.quest_hearth_vigil.countByObjective.lamps, 1);
  assert.equal(ada.store.worlds.quest_hearth_vigil.countByObjective.lamps, 1);

  const beau = applyQuestSignal(quests, defaultProgression(), ada.store, signal({
    playerId: 'beau',
    type: 'public_event',
    eventId: 'lantern_vigil',
    idempotencyKey: 'vigil:beau',
  }), { stats, now });
  assert.ok(beau.completed.includes('quest_hearth_vigil'));
  const adaMirror = projectSharedQuests(quests, ada.progression, beau.store, 'ada');
  assert.equal(adaMirror.questProgress.quest_hearth_vigil.completedAt, beau.progression.questProgress.quest_hearth_vigil.completedAt);
  const firstPay = claimSharedReward(beau.store, quests.find((quest) => quest.id === 'quest_hearth_vigil'), 'ada');
  const secondPay = claimSharedReward(firstPay.store, quests.find((quest) => quest.id === 'quest_hearth_vigil'), 'ada');
  const outsider = claimSharedReward(firstPay.store, quests.find((quest) => quest.id === 'quest_hearth_vigil'), 'cy');
  assert.equal(firstPay.grant, true);
  assert.equal(secondPay.grant, false);
  assert.equal(outsider.grant, false);

  const partyStore = emptySharedQuestStore();
  const one = applyQuestSignal(quests, defaultProgression(), partyStore, signal({
    playerId: 'ada',
    partyId: 'pair-1',
    type: 'interact',
    interactableId: 'paired_watch',
    idempotencyKey: 'watch:ada',
  }), { stats, now });
  assert.equal(one.progression.questProgress.quest_paired_watch.completedAt, undefined);
  const alone = applyQuestSignal(quests, one.progression, one.store, signal({
    playerId: 'ada',
    type: 'interact',
    interactableId: 'paired_watch',
    idempotencyKey: 'watch:ada:again',
  }), { stats, now });
  assert.equal(alone.progression.questProgress.quest_paired_watch.completedAt, undefined);
  const otherParty = applyQuestSignal(quests, defaultProgression(), one.store, signal({
    playerId: 'beau',
    partyId: 'pair-2',
    type: 'interact',
    interactableId: 'paired_watch',
    idempotencyKey: 'watch:beau:other',
  }), { stats, now });
  assert.equal(otherParty.progression.questProgress.quest_paired_watch.completedAt, undefined);
  assert.equal(otherParty.store.parties['pair-2'].quest_paired_watch.completedAt, undefined);
  const pair = applyQuestSignal(quests, defaultProgression(), one.store, signal({
    playerId: 'beau',
    partyId: 'pair-1',
    type: 'interact',
    interactableId: 'paired_watch',
    idempotencyKey: 'watch:beau',
  }), { stats, now });
  assert.ok(pair.completed.includes('quest_paired_watch'));
  assert.equal(pair.store.parties['pair-2'], undefined);
  const leaderOnly = claimSharedReward(pair.store, { ...quests.find((quest) => quest.id === 'quest_paired_watch'), party: { contribution: 'all', requiredContributors: 2, reward: 'leader' } }, 'beau', 'pair-1');
  assert.equal(leaderOnly.grant, false);
  const leader = claimSharedReward(pair.store, { ...quests.find((quest) => quest.id === 'quest_paired_watch'), party: { contribution: 'all', requiredContributors: 2, reward: 'leader' } }, 'ada', 'pair-1');
  assert.equal(leader.grant, true);
});

test('quest instances survive a progression round trip and a version change', () => {
  const offered = offerQuestsOnTalk(quests, defaultProgression(), 'npc_mara', { stats, now }).progression;
  const saved = parseProgression(JSON.parse(JSON.stringify(offered)));
  assert.equal(saved.questProgress.quest_first_steps.version, 1);
  assert.equal(saved.questProgress.quest_first_steps.stage, 'intro');
  assert.deepEqual(saved.questProgress.quest_first_steps.objectives, {});

  const legacy = parseProgression({
    questProgress: {
      quest_first_steps: { questId: 'quest_first_steps', stage: 'complete', startedAt: 1, completedAt: 2 },
    },
  });
  assert.equal(legacy.questProgress.quest_first_steps.rewardsGrantedAt, 2);

  const unpaid = parseProgression({
    questProgress: {
      quest_first_steps: { questId: 'quest_first_steps', stage: 'complete', startedAt: 1, completedAt: 2, version: 1 },
    },
  });
  assert.equal(unpaid.questProgress.quest_first_steps.rewardsGrantedAt, undefined);

  const revised = quests.map((quest) => quest.id === 'quest_first_steps'
    ? { ...quest, version: 2, objectives: [{ id: 'working', type: 'cast_spell', spellId: 'healing_charm', text: 'Cast it.' }] }
    : quest);
  const mid = {
    ...defaultProgression(),
    questProgress: {
      quest_first_steps: {
        questId: 'quest_first_steps',
        stage: 'intro',
        startedAt: now,
        version: 1,
        rewardsGrantedAt: undefined,
        objectives: { working: { count: 1, doneAt: now }, retired: { count: 1, doneAt: now } },
      },
    },
  };
  const reconciled = reconcileQuestVersions(revised, mid, now + 5);
  assert.equal(reconciled.questProgress.quest_first_steps.version, 2);
  assert.equal(reconciled.questProgress.quest_first_steps.objectives.retired, undefined);
  assert.equal(reconciled.questProgress.quest_first_steps.completedAt, now + 5);
  assert.equal(reconciled.questProgress.quest_first_steps.rewardsGrantedAt, undefined);
});

test('licenses, vows, coins, abandonment, failure, expiry, and old spell text still gate the work', () => {
  const gated = {
    id: 'quest_gate',
    name: 'Gate',
    description: '',
    scope: 'personal',
    offer: 'on_talk',
    npcId: 'npc_mara',
    startStage: 'intro',
    nodes: [{ id: 'intro', text: 'Wait.', objective: 'Cast healing_charm once.' }],
    prerequisites: { licenses: ['healer'], vows: ['healer'], coins: 10 },
    minLevel: 1,
    rewards: { reputation: 1 },
  };
  const poor = startQuestDefinition([gated], defaultProgression(), 'quest_gate', { stats, coins: 3, now });
  assert.equal(poor.started, false);
  const licensed = {
    ...defaultProgression(),
    earnedLicenses: ['healer'],
    activeVows: { healer: { vowId: 'healers_vow', acceptedAt: now } },
  };
  const ready = startQuestDefinition([gated], licensed, 'quest_gate', { stats, coins: 10, now });
  assert.equal(ready.started, true);
  const otherSpell = applyQuestSignal([gated], ready.progression, emptySharedQuestStore(), signal({
    type: 'cast_spell',
    spellId: 'apartment_ward',
  }), { stats, now });
  assert.equal(otherSpell.progression.questProgress.quest_gate.completedAt, undefined);
  const charm = applyQuestSignal([gated], ready.progression, emptySharedQuestStore(), signal({
    type: 'cast_spell',
    spellId: 'healing_charm',
  }), { stats, now });
  assert.ok(charm.progression.questProgress.quest_gate.completedAt);

  const active = ready.progression;
  const left = abandonQuest([gated], active, 'quest_gate', now + 10);
  assert.equal(left.questProgress.quest_gate.abandonedAt, now + 10);
  const returned = startQuestDefinition([gated], left, 'quest_gate', { stats, coins: 10, now: now + 11 });
  assert.equal(returned.started, true);
  const done = charm.progression;
  assert.equal(startQuestDefinition([gated], done, 'quest_gate', { stats, coins: 10, now }).started, false);

  const fragile = {
    ...gated,
    id: 'quest_fragile',
    prerequisites: undefined,
    expiresHours: 2,
    failure: { eventId: 'watch_abandoned' },
    objectives: [{ id: 'wait', type: 'schedule', hour: 18, text: 'Wait until evening.' }],
    nodes: [{ id: 'intro', text: 'Wait.', next: 'complete' }, { id: 'complete', text: 'Done.', complete: true }],
  };
  const begun = startQuestDefinition([fragile], defaultProgression(), 'quest_fragile', { stats, now });
  const expired = applyQuestSignal([fragile], begun.progression, emptySharedQuestStore(), signal({
    type: 'schedule',
    hour: 18,
    now: now + 3 * 60 * 60 * 1000,
  }), { stats });
  assert.equal(expired.progression.questProgress.quest_fragile.failedAt != null, true);
  assert.equal(expired.progression.questProgress.quest_fragile.completedAt, undefined);

  const fresh = startQuestDefinition([fragile], defaultProgression(), 'quest_fragile', { stats, now });
  const failed = applyQuestSignal([fragile], fresh.progression, emptySharedQuestStore(), signal({
    type: 'fail',
    eventId: 'watch_abandoned',
  }), { stats, now });
  assert.equal(failed.progression.questProgress.quest_fragile.stage, 'failed');
  assert.equal(failed.progression.questProgress.quest_fragile.completedAt, undefined);
});

test('the editor rejects loops, unreachable lines, and impossible steps', () => {
  const node = (id) => ({ id, text: id });
  const base = {
    name: 'Sample',
    description: '',
    scope: 'personal',
    startStage: 'intro',
    nodes: [node('intro')],
    objectives: [{ id: 'step', type: 'talk', npcId: 'npc_mara', text: 'Speak.' }],
  };
  const loop = validateQuestDocument([
    { ...base, id: 'quest_a', followUpQuestIds: ['quest_b'] },
    { ...base, id: 'quest_b', followUpQuestIds: ['quest_a'], prerequisites: { questsCompleted: ['quest_a'] } },
  ]);
  assert.ok(loop.some((error) => error.includes('loop')));
  const unreachable = validateQuestDocument([
    { ...base, id: 'quest_lost', nodes: [node('intro'), node('aside')] },
  ]);
  assert.ok(unreachable.some((error) => error.includes('cannot be reached')));
  const impossible = validateQuestDocument([
    { ...base, id: 'quest_spell', objectives: [{ id: 'cast', type: 'cast_spell', text: 'Cast.' }] },
  ]);
  assert.ok(impossible.some((error) => error.includes('missing a spell')));
  const missing = validateQuestDocument([
    { ...base, id: 'quest_parent', followUpQuestIds: ['quest_child'] },
    { ...base, id: 'quest_child' },
  ]);
  assert.ok(missing.some((error) => error.includes('missing its prerequisite')));
});
