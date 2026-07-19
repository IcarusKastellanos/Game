import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STATS, applySurvivalTick, calculateSpellFocus, setProgressionContent } from '../dist/index.js';

test('applySurvivalTick: hunger decreases while idle', () => {
  const before = { ...DEFAULT_STATS, hunger: 50, stamina: 50 };
  const after = applySurvivalTick(before, 60000, 'idle');
  assert.ok(after.hunger < before.hunger);
  assert.ok(after.hunger >= 0);
});

test('applySurvivalTick: stamina regenerates faster while sleeping', () => {
  const before = { ...DEFAULT_STATS, hunger: 80, stamina: 40, health: 90 };
  const idle = applySurvivalTick(before, 60000, 'idle');
  const sleeping = applySurvivalTick(before, 60000, 'sleeping');
  assert.ok(sleeping.stamina > idle.stamina);
  assert.ok(sleeping.health > before.health);
});

test('applySurvivalTick: low hunger reduces stamina regen', () => {
  const fed = applySurvivalTick({ ...DEFAULT_STATS, hunger: 80, stamina: 40 }, 60000, 'idle');
  const hungry = applySurvivalTick({ ...DEFAULT_STATS, hunger: 8, stamina: 40 }, 60000, 'idle');
  assert.ok(fed.stamina > hungry.stamina);
});

test('applySurvivalTick: preserves valid zero hunger', () => {
  const after = applySurvivalTick({ ...DEFAULT_STATS, hunger: 0, stamina: 50 }, 60000, 'sleeping');
  assert.equal(after.hunger, 0);
});

test('calculateSpellFocus uses content weights for protection spells', () => {
  const stats = {
    ...DEFAULT_STATS,
    warding: 20,
    ritualSkill: 10,
    willpower: 8,
    spiritualAwareness: 6,
  };
  const focus = calculateSpellFocus(stats, 'protection');
  assert.ok(focus > 0);
  assert.ok(focus > calculateSpellFocus({ ...DEFAULT_STATS, warding: 0, ritualSkill: 0, willpower: 0, spiritualAwareness: 0 }, 'protection'));
});

test('setProgressionContent hydrates survival rates from JSON shape', () => {
  setProgressionContent({
    statsJson: {
      stamina: { sleepingRegenPerMinute: 20 },
    },
  });
  const after = applySurvivalTick({ ...DEFAULT_STATS, stamina: 10 }, 60000, 'sleeping');
  assert.ok(after.stamina >= 20);
});
