import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_STATS,
  defaultProgression,
  setRecognitionContent,
  evaluateRecognition,
  meetsRecognitionRequirements,
  meetsDialogueRecognitionGate,
  grantLicenses,
  getRecognitionTierLabel,
  getPractitionerType,
} from '../dist/index.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function loadTiers() {
  setRecognitionContent(
    JSON.parse(readFileSync(join(root, 'content/progression/recognition-tiers.json'), 'utf8'))
  );
}

test('new practitioners evaluate to Initiate', () => {
  loadTiers();
  const result = evaluateRecognition(DEFAULT_STATS, defaultProgression());
  assert.equal(result.tier.id, 'initiate');
  assert.equal(result.progression.recognitionTierId, 'initiate');
  assert.equal(result.progression.recognitionTierLabel, 'Initiate');
  assert.equal(getRecognitionTierLabel('initiate'), 'Initiate');
});

test('registered_practitioner requires level 2 and first-steps quest', () => {
  loadTiers();
  const prog = {
    ...defaultProgression(),
    questProgress: {
      quest_first_steps: { questId: 'quest_first_steps', stage: 'complete', startedAt: 1, completedAt: 2 },
    },
  };
  const low = evaluateRecognition({ ...DEFAULT_STATS, experience: 0 }, prog);
  assert.equal(low.tier.id, 'initiate');

  const ready = evaluateRecognition({ ...DEFAULT_STATS, experience: 100 }, prog);
  assert.equal(ready.tier.id, 'registered_practitioner');
  assert.equal(ready.changed, true);
  assert.ok(ready.progression.storyFlags?.includes('recognition_registered'));
});

test('licensed_warder requires warder_license and spiritual rep', () => {
  loadTiers();
  const prog = grantLicenses(
    {
      ...defaultProgression(),
      questProgress: {
        quest_first_steps: { questId: 'quest_first_steps', stage: 'complete', startedAt: 1, completedAt: 2 },
      },
      npcRelationships: { npc_circle_leader: 20 },
    },
    ['warder_license']
  );
  const stats = {
    ...DEFAULT_STATS,
    experience: 200,
    spiritualReputation: 12,
    publicReputation: 0,
    reputation: 0,
  };
  assert.equal(
    meetsRecognitionRequirements(
      {
        minLevel: 3,
        minSpiritualRep: 10,
        licenses: ['warder_license'],
        npcRelationships: { npc_circle_leader: 15 },
      },
      stats,
      prog
    ),
    true
  );
  const result = evaluateRecognition(stats, prog);
  assert.equal(result.tier.id, 'licensed_warder');
});

test('dialogue gates honor recognition rank and licenses', () => {
  loadTiers();
  const initiate = defaultProgression();
  assert.equal(
    meetsDialogueRecognitionGate({ requiresRecognition: 'registered_practitioner' }, initiate),
    false
  );
  const registered = {
    ...initiate,
    recognitionTierId: 'registered_practitioner',
    recognitionTierLabel: 'Registered Practitioner',
  };
  assert.equal(
    meetsDialogueRecognitionGate({ requiresRecognition: 'registered_practitioner' }, registered),
    true
  );
  assert.equal(meetsDialogueRecognitionGate({ requiresLicense: 'warder_license' }, registered), false);
  const licensed = grantLicenses(registered, ['warder_license']);
  assert.equal(meetsDialogueRecognitionGate({ requiresLicense: 'warder_license' }, licensed), true);
});

test('getPractitionerType prefers recognition tier with specialty subtitle', () => {
  const label = getPractitionerType(
    { ...DEFAULT_STATS, specialty: 'traditional_european' },
    'Registered Practitioner'
  );
  assert.equal(label, 'Registered Practitioner · Folk Witch');
  const initiate = getPractitionerType(DEFAULT_STATS, 'Initiate');
  assert.match(initiate, /^Initiate/);
});
