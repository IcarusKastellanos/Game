import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setLevelCurveContent,
  playerLevel,
  getMaxPlayerLevel,
  experienceCap,
  meetsMinLevel,
  levelUpEventsBetween,
  grantExperience,
  defaultProgression,
  DEFAULT_STATS,
  setXpSourcesContent,
} from '../dist/index.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('level-curve.json caps practitioner level at 10', () => {
  setLevelCurveContent(
    JSON.parse(readFileSync(join(root, 'content/progression/level-curve.json'), 'utf8'))
  );
  assert.equal(getMaxPlayerLevel(), 10);
  assert.equal(playerLevel(0), 1);
  assert.equal(playerLevel(99), 1);
  assert.equal(playerLevel(100), 2);
  assert.equal(playerLevel(900), 10);
  assert.equal(playerLevel(99999), 10);
  assert.equal(experienceCap(), 900);
});

test('meetsMinLevel gates advanced content', () => {
  setLevelCurveContent(
    JSON.parse(readFileSync(join(root, 'content/progression/level-curve.json'), 'utf8'))
  );
  assert.equal(meetsMinLevel(0, 1), true);
  assert.equal(meetsMinLevel(0, 4), false);
  assert.equal(meetsMinLevel(300, 4), true); // level 4
  assert.equal(meetsMinLevel(700, 9), false); // level 8
  assert.equal(meetsMinLevel(800, 9), true); // level 9
});

test('grantExperience fires onLevelUp events and caps at max', () => {
  setLevelCurveContent(
    JSON.parse(readFileSync(join(root, 'content/progression/level-curve.json'), 'utf8'))
  );
  setXpSourcesContent(
    JSON.parse(readFileSync(join(root, 'content/progression/xp-sources.json'), 'utf8'))
  );
  const nearCap = grantExperience(
    { ...DEFAULT_STATS, experience: 890 },
    defaultProgression(),
    'quest_complete',
    { amountOverride: 50 }
  );
  assert.equal(nearCap.levelAfter, 10);
  assert.equal(nearCap.stats.experience, 900);
  assert.ok(nearCap.leveledUp);
  assert.ok(nearCap.levelUpEvents.some((e) => e.atLevel === 10));

  const over = grantExperience(nearCap.stats, nearCap.progression, 'quest_complete', {
    amountOverride: 100,
  });
  assert.equal(over.granted, 0);
  assert.equal(over.stats.experience, 900);
});

test('levelUpEventsBetween returns crossed thresholds only', () => {
  setLevelCurveContent(
    JSON.parse(readFileSync(join(root, 'content/progression/level-curve.json'), 'utf8'))
  );
  const events = levelUpEventsBetween(3, 5);
  assert.deepEqual(
    events.map((e) => e.atLevel),
    [4, 5]
  );
});
