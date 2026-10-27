import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_STATS,
  applySurvivalTick,
  defaultProgression,
  grantSkillXp,
  skillXpThreshold,
} from '../dist/index.js';

test('applySurvivalTick regenerates stamina faster while eating than idle', () => {
  const base = { ...DEFAULT_STATS, stamina: 40, hunger: 60 };
  const idle = applySurvivalTick(base, 60_000, 'idle');
  const eating = applySurvivalTick(base, 60_000, 'eating');
  assert.ok(eating.stamina > idle.stamina);
  // Eating should not decay hunger.
  assert.equal(eating.hunger, 60);
  assert.ok(idle.hunger < 60);
});

test('skill practice cost climbs with the current rank', () => {
  const low = skillXpThreshold(1);
  const mid = skillXpThreshold(5);
  const high = skillXpThreshold(12);
  assert.ok(mid > low);
  assert.ok(high > mid);
});

test('grantSkillXp levels technical skills from pool thresholds', () => {
  const need = skillXpThreshold(DEFAULT_STATS.ritualSkill ?? 0);
  const { stats, progression, gainedLevels, xp } = grantSkillXp(
    { ...DEFAULT_STATS },
    defaultProgression(),
    'ritualSkill',
    need
  );
  assert.equal(gainedLevels, 1);
  assert.equal(stats.ritualSkill, (DEFAULT_STATS.ritualSkill ?? 0) + 1);
  assert.equal(xp, 0);
  assert.equal(progression.skillXp?.ritualSkill, 0);
});
