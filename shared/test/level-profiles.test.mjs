import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setLevelProfiles,
  getLevelTitle,
  getLevelRankLabel,
  assignedUnlockLevel,
  cumulativeStatFloors,
  applyLevelStatFloors,
  spiritRangeForLevel,
  normalizeLevelDocument,
  findUnknownLevelUnlocks,
  DEFAULT_STATS,
} from '../dist/index.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('levels.json seeds titles, spirit bands, and spell unlocks', () => {
  const raw = JSON.parse(readFileSync(join(root, 'content/progression/levels.json'), 'utf8'));
  setLevelProfiles(raw);
  assert.equal(getLevelTitle(1), 'Novice');
  assert.equal(getLevelRankLabel(10), 'Rank V');
  assert.equal(getLevelTitle(10), 'Apex Practitioner');
  assert.equal(assignedUnlockLevel('spellIds', 'healing_charm'), 1);
  assert.equal(assignedUnlockLevel('spellIds', 'poppet_hex'), 8);
  assert.equal(assignedUnlockLevel('spellIds', 'curse_breaking'), 9);
  assert.equal(assignedUnlockLevel('npcIds', 'npc_circle_leader'), 3);
  assert.ok(!('familiarIds' in (raw.levels?.[0] ?? {})));
  for (const level of raw.levels ?? []) {
    assert.equal(level.familiarIds, undefined);
  }
  assert.equal(spiritRangeForLevel(1).label, 'Household wisps');
  assert.ok(spiritRangeForLevel(10).maxPower >= 100);
});

test('stat floors raise skills at the reached level and do not lower them', () => {
  setLevelProfiles({
    maxLevel: 10,
    xpPerLevel: 100,
    levels: [
      { level: 1, title: 'Novice', statFloors: { ritualSkill: 2 } },
      { level: 3, title: 'Charter', statFloors: { ritualSkill: 8, intuition: 7 } },
    ],
  });
  const raised = applyLevelStatFloors({ ...DEFAULT_STATS, experience: 200, ritualSkill: 2, intuition: 4 });
  assert.equal(raised.ritualSkill, 8);
  assert.equal(raised.intuition, 7);
  const kept = applyLevelStatFloors({ ...DEFAULT_STATS, experience: 200, ritualSkill: 20, intuition: 4 });
  assert.equal(kept.ritualSkill, 20);
  assert.equal(cumulativeStatFloors(1).ritualSkill, 2);
});

test('a content id stays on the earliest level that lists it', () => {
  const doc = normalizeLevelDocument({
    maxLevel: 3,
    xpPerLevel: 100,
    levels: [
      { level: 1, spellIds: ['healing_charm'] },
      { level: 2, spellIds: ['healing_charm', 'poppet_hex'] },
    ],
  });
  setLevelProfiles(doc);
  assert.deepEqual(doc.levels[0].spellIds, ['healing_charm']);
  assert.deepEqual(doc.levels[1].spellIds, ['poppet_hex']);
  assert.equal(assignedUnlockLevel('spellIds', 'healing_charm'), 1);
  setLevelProfiles(JSON.parse(readFileSync(join(root, 'content/progression/levels.json'), 'utf8')));
});

test('legacy familiarIds unlock lists are ignored — familiars are not level-gated', () => {
  const doc = normalizeLevelDocument({
    maxLevel: 2,
    xpPerLevel: 100,
    levels: [
      { level: 1, familiarIds: ['cat_familiar'], spellIds: ['healing_charm'] },
      { level: 2, familiarIds: ['snake_familiar'] },
    ],
  });
  for (const level of doc.levels) {
    assert.equal('familiarIds' in level, false);
  }
  setLevelProfiles(doc);
  assert.equal(assignedUnlockLevel('spellIds', 'healing_charm'), 1);
});

test('findUnknownLevelUnlocks reports ids missing from the catalog', () => {
  setLevelProfiles({
    maxLevel: 2,
    xpPerLevel: 100,
    levels: [
      { level: 1, spellIds: ['healing_charm', 'no_such_spell'] },
      { level: 2, questIds: ['missing_quest'] },
    ],
  });
  const unknown = findUnknownLevelUnlocks({
    spellIds: ['healing_charm'],
    questIds: ['quest_first_steps'],
  });
  assert.deepEqual(
    unknown.map((row) => `${row.bucket}:${row.id}@${row.level}`).sort(),
    ['questIds:missing_quest@2', 'spellIds:no_such_spell@1']
  );
  setLevelProfiles(JSON.parse(readFileSync(join(root, 'content/progression/levels.json'), 'utf8')));
});
