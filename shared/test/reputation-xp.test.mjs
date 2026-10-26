import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_STATS,
  normalizePlayerStats,
  applyReputationDelta,
  applyReputationSource,
  getPublicReputation,
  getSpiritualReputation,
  shopPriceMultiplier,
  setReputationContent,
  setXpSourcesContent,
  grantExperience,
  practitionerXpProgress,
  defaultProgression,
  canTradePublicly,
  publicDialogueTone,
  meetsSpiritualGate,
  applyMoralityGossip,
  listXpSources,
} from '../dist/index.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('normalizePlayerStats migrates legacy reputation to publicReputation', () => {
  const result = normalizePlayerStats({
    ...DEFAULT_STATS,
    reputation: 42,
    publicReputation: undefined,
    spiritualReputation: undefined,
  });
  assert.equal(result.publicReputation, 42);
  assert.equal(result.reputation, 42);
  assert.equal(result.spiritualReputation, 0);
});

test('applyReputationDelta keeps public and legacy reputation in sync', () => {
  const next = applyReputationDelta(DEFAULT_STATS, 'public', 10);
  assert.equal(getPublicReputation(next), 10);
  assert.equal(next.reputation, 10);
  const spiritual = applyReputationDelta(next, 'spiritual', 7);
  assert.equal(getSpiritualReputation(spiritual), 7);
  assert.equal(getPublicReputation(spiritual), 10);
});

test('shopPriceMultiplier improves with public reputation', () => {
  setReputationContent({
    publicJson: JSON.parse(readFileSync(join(root, 'content/progression/reputation-public.json'), 'utf8')),
  });
  const high = shopPriceMultiplier({ ...DEFAULT_STATS, publicReputation: 50, reputation: 50 });
  const low = shopPriceMultiplier({ ...DEFAULT_STATS, publicReputation: -50, reputation: -50 });
  assert.ok(high < 1);
  assert.ok(low > 1);
  assert.ok(high < low);
});

test('applyReputationSource uses content deltas', () => {
  setReputationContent({
    spiritualJson: JSON.parse(
      readFileSync(join(root, 'content/progression/reputation-spiritual.json'), 'utf8')
    ),
  });
  const { stats, applied, source } = applyReputationSource(
    DEFAULT_STATS,
    'spiritual',
    'study_circle_attend'
  );
  assert.ok(source);
  assert.equal(applied, 3);
  assert.equal(getSpiritualReputation(stats), 3);
});

test('grantExperience awards XP from registry and records recentXp', () => {
  setXpSourcesContent(
    JSON.parse(readFileSync(join(root, 'content/progression/xp-sources.json'), 'utf8'))
  );
  const result = grantExperience(DEFAULT_STATS, defaultProgression(), 'spell_cast_success');
  assert.equal(result.granted, 5);
  assert.equal(result.stats.experience, 5);
  assert.equal(result.progression.recentXp?.length, 1);
  assert.equal(result.progression.recentXp?.[0].actionId, 'spell_cast_success');
});

test('grantExperience respects cooldown', () => {
  setXpSourcesContent(
    JSON.parse(readFileSync(join(root, 'content/progression/xp-sources.json'), 'utf8'))
  );
  const first = grantExperience(DEFAULT_STATS, defaultProgression(), 'spell_cast_focus_fail', {
    now: 1_000,
  });
  assert.equal(first.granted, 1);
  const second = grantExperience(first.stats, first.progression, 'spell_cast_focus_fail', {
    now: 1_500,
  });
  assert.equal(second.granted, 0);
  assert.equal(second.skippedReason, 'cooldown');
});

test('grantExperience levels up at 100 XP boundaries', () => {
  setXpSourcesContent(
    JSON.parse(readFileSync(join(root, 'content/progression/xp-sources.json'), 'utf8'))
  );
  const result = grantExperience(
    { ...DEFAULT_STATS, experience: 98 },
    defaultProgression(),
    'quest_complete'
  );
  assert.ok(result.leveledUp);
  assert.equal(result.levelBefore, 1);
  assert.equal(result.levelAfter, 2);
});

test('practitionerXpProgress reports bar fill', () => {
  const progress = practitionerXpProgress(250);
  assert.equal(progress.level, 3);
  assert.equal(progress.xpIntoLevel, 50);
  assert.equal(progress.xpToNext, 100);
});

test('normalizePlayerStats preserves negative dual reputation', () => {
  const result = normalizePlayerStats({
    ...DEFAULT_STATS,
    reputation: -40,
    publicReputation: -40,
    spiritualReputation: -25,
  });
  assert.equal(result.publicReputation, -40);
  assert.equal(result.reputation, -40);
  assert.equal(result.spiritualReputation, -25);
});

test('canTradePublicly refuses extreme scandal', () => {
  setReputationContent({
    publicJson: JSON.parse(readFileSync(join(root, 'content/progression/reputation-public.json'), 'utf8')),
    spiritualJson: JSON.parse(
      readFileSync(join(root, 'content/progression/reputation-spiritual.json'), 'utf8')
    ),
  });
  const scandal = { ...DEFAULT_STATS, publicReputation: -75, reputation: -75, spiritualReputation: 0 };
  assert.equal(canTradePublicly(scandal), false);
  assert.equal(publicDialogueTone(scandal), 'refuse_trade');
  assert.equal(meetsSpiritualGate({ ...DEFAULT_STATS, spiritualReputation: 30 }, 'rareVendorAbove'), true);
  assert.equal(meetsSpiritualGate({ ...DEFAULT_STATS, spiritualReputation: 10 }, 'rareVendorAbove'), false);
  const gossip = applyMoralityGossip(DEFAULT_STATS, -12);
  assert.ok(gossip.applied < 0);
});

test('grantExperience applies skillTags to technical pools', () => {
  setXpSourcesContent(
    JSON.parse(readFileSync(join(root, 'content/progression/xp-sources.json'), 'utf8'))
  );
  const result = grantExperience(DEFAULT_STATS, defaultProgression(), 'ward_place');
  assert.equal(result.granted, 5);
  assert.ok((result.progression.skillXp?.protection ?? 0) > 0);
});

test('listXpSources loads full content registry', () => {
  setXpSourcesContent(
    JSON.parse(readFileSync(join(root, 'content/progression/xp-sources.json'), 'utf8'))
  );
  const ids = listXpSources().map((s) => s.actionId);
  for (const required of [
    'spell_cast_success',
    'read_book',
    'craft_success',
    'experiment_success',
    'quest_complete',
    'teach_npc',
    'coven_rite',
    'dream_journal',
  ]) {
    assert.ok(ids.includes(required), `missing ${required}`);
  }
});
