import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STATS, normalizePlayerStats } from '../dist/index.js';

test('normalizePlayerStats fills missing extended stats from defaults', () => {
  const legacy = {
    health: 90,
    hunger: 50,
    magicalEnergy: 40,
    protection: 5,
    intuition: 3,
    spiritualAwareness: 7,
    divinationSkill: 4,
    herbalism: 2,
    cursecraft: 6,
    warding: 3,
    healing: 2,
    ritualSkill: 2,
    experience: 0,
    reputation: 0,
    morality: 0,
    affinities: { ...DEFAULT_STATS.affinities },
  };
  const result = normalizePlayerStats(legacy);
  assert.equal(result.stamina, DEFAULT_STATS.stamina);
  assert.equal(result.willpower, DEFAULT_STATS.willpower);
  assert.equal(result.spiritualAwareness, 7);
  assert.equal(result.cursecraft, 6);
});

test('normalizePlayerStats preserves valid zero values', () => {
  const result = normalizePlayerStats({
    ...DEFAULT_STATS,
    hunger: 0,
    stamina: 0,
    magicalEnergy: 0,
  });
  assert.equal(result.hunger, 0);
  assert.equal(result.stamina, 0);
  assert.equal(result.magicalEnergy, 0);
});

test('normalizePlayerStats clamps above-cap values', () => {
  const result = normalizePlayerStats({
    ...DEFAULT_STATS,
    intuition: 999,
    health: 200,
  });
  assert.equal(result.intuition, 100);
  assert.equal(result.health, 100);
});

test('normalizePlayerStats handles null-ish numeric fields', () => {
  const input = { ...DEFAULT_STATS, stamina: undefined, memory: null };
  const result = normalizePlayerStats(input);
  assert.equal(result.stamina, DEFAULT_STATS.stamina);
  assert.equal(result.memory, DEFAULT_STATS.memory);
});

test('normalizePlayerStats does not reset experience-derived ME cap', () => {
  const result = normalizePlayerStats({
    ...DEFAULT_STATS,
    experience: 200,
    magicalEnergy: 500,
  });
  assert.ok(result.magicalEnergy <= 100 + 2 * 3);
});
