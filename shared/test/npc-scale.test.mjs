import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyNpcPresenceDiff,
  compareNpcConfigurations,
  diffNpcPresences,
  acquireConversationLock,
  canStartConversation,
  releaseConversationLocksForSession,
  runExclusiveSocialOp,
  shouldApplySeq,
} from '../dist/index.js';

function presence(npcId, location = 'town', extra = {}) {
  return {
    npcId,
    scene: 'town',
    tile: { x: 1, y: 1 },
    location,
    interaction: 'open',
    visible: true,
    indoors: false,
    held: false,
    moving: false,
    ...extra,
  };
}

test('presence diff sends only changed rows and merges on the client', () => {
  const a = Array.from({ length: 8 }, (_, i) => presence(`npc_${i}`));
  const b = a.map((row) =>
    row.npcId === 'npc_0' ? presence('npc_0', 'market') : row
  );
  const diff = diffNpcPresences(a, b);
  assert.equal(diff.mode, 'diff');
  assert.deepEqual(diff.changedNpcIds, ['npc_0']);
  assert.equal(diff.npcPresences.length, 1);
  const merged = applyNpcPresenceDiff(a, diff);
  assert.equal(merged.find((row) => row.npcId === 'npc_0')?.location, 'market');
  assert.equal(merged.find((row) => row.npcId === 'npc_1')?.location, 'town');
});

test('presence diff falls back to full when most NPCs change', () => {
  const prev = Array.from({ length: 10 }, (_, i) => presence(`npc_${i}`));
  const next = prev.map((row, i) => presence(row.npcId, `place_${i}`));
  const diff = diffNpcPresences(prev, next);
  assert.equal(diff.mode, 'full');
  assert.equal(diff.npcPresences.length, 10);
});

test('offline config compare flags service and schedule deltas without mutating', () => {
  const current = {
    id: 'npc_x',
    name: 'X',
    role: 'guide',
    locationId: 'town',
    dialogueTreeId: 'dlg_x',
    schedule: [{ hour: 9, endHour: 12, locationId: 'town', interaction: 'open' }],
  };
  const candidate = {
    ...current,
    shopId: 'shop_a',
    capabilities: [{ action: 'trade', shopId: 'shop_a' }],
    schedule: [
      { hour: 9, endHour: 12, locationId: 'town', interaction: 'open' },
      { hour: 12, endHour: 18, locationId: 'market', interaction: 'busy' },
    ],
  };
  const result = compareNpcConfigurations({
    current,
    candidate,
    placeIds: ['town', 'market'],
    shopIds: new Set(['shop_a']),
    dialogueTreeIds: new Set(['dlg_x']),
  });
  assert.equal(result.synthetic, true);
  assert.ok(result.deltas.some((row) => /shop|service|schedule/i.test(row)));
  assert.equal(current.shopId, undefined);
});

test('multiplayer exclusive lock: only one of many concurrent acquirers wins', () => {
  let locks = [];
  const winners = [];
  for (let i = 0; i < 40; i++) {
    const gate = canStartConversation('working', 'exclusive', locks, 'npc_boss', `p${i}`);
    if (!gate.ok) continue;
    const got = acquireConversationLock({
      locks,
      npcId: 'npc_boss',
      playerId: `p${i}`,
      sessionId: `s${i}`,
      policy: 'exclusive',
    });
    locks = got.locks;
    if (got.acquired) winners.push(`p${i}`);
  }
  assert.equal(winners.length, 1);
  locks = releaseConversationLocksForSession(locks, 's0');
  const again = acquireConversationLock({
    locks,
    npcId: 'npc_boss',
    playerId: 'p99',
    sessionId: 's99',
    policy: 'exclusive',
  });
  assert.equal(again.acquired, true);
});

test('concurrent gift ops: nested exclusive op reports busy for contenders', () => {
  let busyHits = 0;
  let okHits = 0;
  const key = 'player:npc:gift';
  const outer = runExclusiveSocialOp(key, () => {
    okHits += 1;
    const nested = runExclusiveSocialOp(key, () => {
      okHits += 1;
      return 'inner';
    });
    if (nested.busy) busyHits += 1;
    return 'outer';
  });
  assert.equal(outer.busy, false);
  assert.equal(okHits, 1);
  assert.equal(busyHits, 1);
  for (let i = 0; i < 25; i++) {
    const raced = runExclusiveSocialOp(key, () => {
      okHits += 1;
      return i;
    });
    if (raced.busy) busyHits += 1;
  }
  assert.equal(okHits, 26);
  assert.equal(busyHits, 1);
});

test('progression seq rejects stale multiplayer fan-out', () => {
  let cursor = 0;
  const applied = [];
  for (const seq of [1, 2, 2, 1, 4, 3, 5]) {
    if (!shouldApplySeq(cursor, seq)) continue;
    cursor = seq;
    applied.push(seq);
  }
  // Equal seq is accepted (reconnect resend); older seq is dropped.
  assert.deepEqual(applied, [1, 2, 2, 4, 5]);
});
