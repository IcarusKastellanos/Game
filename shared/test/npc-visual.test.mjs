import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NPC_IDLE_PIXEL_COUNT,
  NPC_VISUAL_PROFILES,
  NPC_WALK_PIXEL_COUNT,
  directionFromDelta,
  hashNpcAuthoredSpriteSheet,
  normalizeNpcAuthoredSpriteSheet,
  npcIdleAnimKey,
  npcVisualContentHash,
  npcWalkAnimKey,
  npcWalkSheetKey,
  resolveNpcPresence,
  resolveNpcVisualProfile,
} from '../dist/index.js';

test('all ten shipped NPCs have unique visual profiles', () => {
  const ids = Object.keys(NPC_VISUAL_PROFILES);
  assert.equal(ids.length, 10);
  const shirts = new Set(ids.map((id) => NPC_VISUAL_PROFILES[id].colors.shirt));
  assert.ok(shirts.size >= 8);
});

test('directionFromDelta maps octants for walk facing', () => {
  assert.equal(directionFromDelta(1, 0, 'down'), 'right');
  assert.equal(directionFromDelta(0, 1, 'down'), 'down');
  assert.equal(directionFromDelta(-1, -1, 'down'), 'up-left');
  assert.equal(directionFromDelta(0, 0, 'left'), 'left');
});

test('anim and sheet keys follow the hybrid contract', () => {
  assert.equal(npcWalkSheetKey('npc_mara'), 'npc_mara_walk');
  assert.equal(npcWalkAnimKey('npc_mara', 'down-right'), 'npc_mara_walk_down-right');
  assert.equal(npcIdleAnimKey('npc_mara', 'up'), 'npc_mara_idle_up');
});

test('presence includes facing while walking between tiles', () => {
  const npc = {
    id: 'npc_mara',
    name: 'Mara',
    schedule: [{ hour: 9, endHour: 18, locationId: 'shop', interaction: 'open', movement: 'still' }],
  };
  const places = [{ id: 'shop', sceneId: 'town', x: 5, y: 5, indoors: false }];
  const maps = [{ sceneId: 'town', width: 20, height: 20 }];
  const previous = resolveNpcPresence({
    npc,
    places,
    maps,
    hour: 10,
    weekday: 1,
    nowMs: 1000,
    previous: {
      npcId: 'npc_mara',
      scene: 'town',
      tile: { x: 2, y: 5 },
      location: 'shop',
      interaction: 'open',
      visible: true,
      indoors: false,
      held: false,
      moving: false,
      facing: 'left',
    },
  });
  assert.equal(previous.moving, true);
  assert.equal(previous.facing, 'right');
});

test('resolveNpcVisualProfile falls back for unknown NPCs', () => {
  const profile = resolveNpcVisualProfile('npc_unknown');
  assert.equal(profile.build, 'average');
  assert.ok(profile.colors.shirt);
});

test('normalizeNpcAuthoredSpriteSheet accepts walk-only and idle-only planes', () => {
  const walk = Array.from({ length: NPC_WALK_PIXEL_COUNT }, () => '#ff00aa');
  const idle = Array.from({ length: NPC_IDLE_PIXEL_COUNT }, () => '#00ffaa');
  const walkOnly = normalizeNpcAuthoredSpriteSheet({
    frameW: 32,
    frameH: 48,
    walkFrames: 4,
    idleFrames: 2,
    walkPixels: walk,
  });
  assert.ok(walkOnly?.walkPixels);
  assert.equal(walkOnly?.idlePixels, undefined);

  const idleOnly = normalizeNpcAuthoredSpriteSheet({
    frameW: 32,
    frameH: 48,
    walkFrames: 4,
    idleFrames: 2,
    idlePixels: idle,
  });
  assert.ok(idleOnly?.idlePixels);
  assert.equal(idleOnly?.walkPixels, undefined);

  assert.equal(normalizeNpcAuthoredSpriteSheet({ walkPixels: ['#fff'] }), undefined);
});

test('authored sheet hash changes when pixels change', () => {
  const walkA = Array.from({ length: NPC_WALK_PIXEL_COUNT }, () => '#111111');
  const walkB = Array.from({ length: NPC_WALK_PIXEL_COUNT }, () => '#222222');
  const a = hashNpcAuthoredSpriteSheet({
    frameW: 32,
    frameH: 48,
    walkFrames: 4,
    idleFrames: 2,
    walkPixels: walkA,
  });
  const b = hashNpcAuthoredSpriteSheet({
    frameW: 32,
    frameH: 48,
    walkFrames: 4,
    idleFrames: 2,
    walkPixels: walkB,
  });
  assert.ok(a);
  assert.ok(b);
  assert.notEqual(a, b);
  assert.match(
    npcVisualContentHash({ id: 'npc_mara', spriteSheet: { frameW: 32, frameH: 48, walkFrames: 4, idleFrames: 2, walkPixels: walkA } }),
    /\|/
  );
});
