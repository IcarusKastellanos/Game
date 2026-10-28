import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NPC_VISUAL_PROFILES,
  directionFromDelta,
  npcIdleAnimKey,
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
