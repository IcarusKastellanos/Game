import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hiddenNpcPostIds,
  resolveNpcPresence,
  validateNpcDefinition,
} from '../dist/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const npcs = JSON.parse(readFileSync(join(root, 'content/npcs.json'), 'utf8'));
const places = JSON.parse(readFileSync(join(root, 'content/npc-places.json'), 'utf8'));
const maps = JSON.parse(readFileSync(join(root, 'content/maps.json'), 'utf8'));
const townMap = maps.find((map) => map.id === 'town_main');
const placeIds = places.map((place) => place.id);
const town = { sceneId: 'town', width: townMap.width, height: townMap.height };
const posts = townMap.interactables.map((inter) => ({
  id: inter.id,
  type: inter.type,
  x: inter.x,
  y: inter.y,
  npcId: inter.data?.npcId,
}));

const BANNED = [
  'relationship',
  'relationshipLevel',
  'bond',
  'bonds',
  'gift',
  'gifts',
  'reputation',
  'affinity',
  'trust',
  'familiarity',
  'secrets',
  'scheduleOverride',
];

function npcById(id) {
  return npcs.find((entry) => entry.id === id);
}

function resolve(npc, hour, previous = null, nowMs = 1_000, extra = {}) {
  return resolveNpcPresence({
    npc,
    places,
    maps: [town],
    hour,
    weekday: extra.weekday ?? 3,
    nowMs,
    previous,
    season: extra.season ?? null,
    blocked: extra.blocked,
  });
}

function assertPublic(presence) {
  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      assert.equal(BANNED.includes(key), false, key);
      walk(value[key]);
    }
  };
  walk(presence);
}

test('the ten routines stay valid and do not share one curve', () => {
  const curves = [];
  for (const npc of npcs) {
    const parsed = validateNpcDefinition(npc, npc.id, placeIds);
    assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.error);
    curves.push(Array.from({ length: 24 }, (_, hour) => resolve(npc, hour).location).join(','));
  }
  assert.equal(new Set(curves).size, npcs.length);
});

test('two NPCs are in different places at the same hour', () => {
  const mara = resolve(npcById('npc_mara'), 10);
  const rowan = resolve(npcById('npc_circle_leader'), 10);
  assert.equal(mara.location, 'metaphysical_shop');
  assert.equal(rowan.location, 'park');
  assert.notEqual(mara.location, rowan.location);
  assertPublic(mara);
  assertPublic(rowan);
});

test('a shopkeeper is at the counter during open hours and indoors afterward', () => {
  const open = resolve(npcById('npc_mara'), 10);
  const before = resolve(npcById('npc_mara'), 8);
  const after = resolve(npcById('npc_mara'), 22);
  assert.equal(open.location, 'metaphysical_shop');
  assert.equal(open.visible, true);
  assert.equal(open.indoors, false);
  assert.equal(open.interactableId, 'shop_metaphysical');
  assert.equal(before.indoors, true);
  assert.equal(before.visible, false);
  assert.equal(before.location, 'apartment_building');
  assert.equal(after.indoors, true);
  assert.equal(after.visible, false);

  const daytime = npcs.map((npc) => resolve(npc, 11));
  const night = npcs.map((npc) => resolve(npc, 23));
  const hiddenDay = hiddenNpcPostIds(daytime, posts);
  const hiddenNight = hiddenNpcPostIds(night, posts);
  assert.equal(hiddenDay.includes('shop_metaphysical'), false);
  assert.equal(hiddenNight.includes('shop_metaphysical'), false);
  assert.equal(hiddenDay.includes('npc_library'), false);
  assert.equal(hiddenNight.includes('npc_library'), true);
});

test('resolving a later hour with no previous presence snaps and does not replay the morning', () => {
  const traveler = {
    id: 'npc_traveler',
    name: 'Traveler',
    schedule: [
      { hour: 8, endHour: 11, locationId: 'market', activity: 'morning stall' },
      { hour: 11, endHour: 18, locationId: 'grocery', activity: 'counter' },
    ],
  };
  const snapped = resolve(traveler, 15);
  const market = places.find((place) => place.id === 'market');
  const grocery = places.find((place) => place.id === 'grocery');
  assert.equal(snapped.moving, false);
  assert.equal(snapped.location, 'grocery');
  assert.equal(snapped.tile.x, grocery.x);
  assert.equal(snapped.tile.y, grocery.y);
  assert.notEqual(snapped.tile.x, market.x);
  assert.equal(snapped.from, undefined);
  assert.equal(snapped.to, undefined);
});

test('a second resolve with a previous outdoor presence produces one walk', () => {
  const traveler = {
    id: 'npc_traveler',
    name: 'Traveler',
    schedule: [
      { hour: 8, endHour: 12, locationId: 'market' },
      { hour: 12, endHour: 18, locationId: 'grocery' },
    ],
  };
  const morning = resolve(traveler, 9, null, 1_000);
  assert.equal(morning.moving, false);
  const leaving = resolve(traveler, 12, morning, 2_000);
  const grocery = places.find((place) => place.id === 'grocery');
  assert.equal(leaving.moving, true);
  assert.deepEqual(leaving.from, { x: morning.tile.x, y: morning.tile.y });
  assert.deepEqual(leaving.to, { x: grocery.x, y: grocery.y });
  assert.equal(leaving.moveStart, 2_000);
  assert.ok(leaving.moveEnd > leaving.moveStart);
  const mid = resolve(traveler, 12, leaving, 2_100);
  assert.equal(mid.moving, true);
  assert.equal(mid.moveStart, leaving.moveStart);
  assert.equal(mid.moveEnd, leaving.moveEnd);
  assert.deepEqual(mid.from, leaving.from);
  assert.deepEqual(mid.to, leaving.to);
  const arrived = resolve(traveler, 12, leaving, leaving.moveEnd + 50);
  assert.equal(arrived.moving, false);
  assert.equal(arrived.location, 'grocery');
  assert.equal(arrived.tile.x, grocery.x);
  assert.equal(arrived.tile.y, grocery.y);
});

test('an active override beats the daily entry', () => {
  const npc = {
    ...npcById('npc_mara'),
    scheduleOverride: {
      id: 'fair',
      active: true,
      locationId: 'park',
      activity: 'hosting the fair',
      interaction: 'busy',
      priority: 5,
    },
  };
  const overridden = resolve(npc, 10);
  assert.equal(overridden.location, 'park');
  assert.equal(overridden.interaction, 'busy');
  assert.match(overridden.notice, /fair/);
  const inactive = resolve({ ...npc, scheduleOverride: { ...npc.scheduleOverride, active: false } }, 10);
  assert.equal(inactive.location, 'metaphysical_shop');
});

test('a missing or blocked destination is held and still returns a presence', () => {
  const lost = {
    id: 'npc_lost',
    name: 'Lost',
    schedule: [{ hour: 0, endHour: 24, locationId: 'void_place' }],
  };
  const placesWithVoid = places;
  const missing = resolveNpcPresence({
    npc: lost,
    places: placesWithVoid,
    maps: [town],
    hour: 12,
    weekday: 3,
    nowMs: 5_000,
    previous: null,
    season: null,
  });
  assert.equal(missing.held, true);
  assert.equal(missing.visible, false);
  assert.equal(missing.interaction, 'away');
  assert.ok(missing.npcId);

  const blockedNpc = {
    id: 'npc_blocked',
    name: 'Blocked',
    schedule: [{ hour: 0, endHour: 24, locationId: 'market' }],
  };
  const previous = resolve(
    { id: 'npc_blocked', name: 'Blocked', schedule: [{ hour: 0, endHour: 24, locationId: 'grocery' }] },
    12
  );
  const market = places.find((place) => place.id === 'market');
  const held = resolve(blockedNpc, 12, previous, 9_000, {
    blocked: new Set([`town:${market.x},${market.y}`]),
  });
  assert.equal(held.held, true);
  assert.equal(held.interaction, 'away');
  assert.equal(held.visible, true);
  assert.equal(held.moving, false);
  assert.deepEqual(held.tile, previous.tile);
  assertPublic(held);
  assertPublic(missing);
});

test('a seasonal entry does not match when the world season is absent', () => {
  const npc = {
    id: 'npc_season',
    name: 'Seasonal',
    schedule: [
      { hour: 0, endHour: 24, locationId: 'park', season: 'spring', activity: 'blossom' },
      { hour: 9, endHour: 17, locationId: 'grocery', activity: 'counter', interaction: 'open' },
    ],
  };
  const midday = resolve(npc, 12);
  const night = resolve(npc, 20);
  assert.equal(midday.location, 'grocery');
  assert.notEqual(midday.location, 'park');
  assert.notEqual(night.location, 'park');
  assert.equal(night.visible, false);
});

test('overlapping windows fail validation', () => {
  const overlap = validateNpcDefinition(
    {
      name: 'Overlap',
      role: 'Tester',
      locationId: 'grocery',
      dialogueTreeId: 'test',
      schedule: [
        { hour: 9, endHour: 15, locationId: 'grocery' },
        { hour: 12, endHour: 18, locationId: 'park' },
      ],
    },
    'npc_overlap',
    placeIds
  );
  assert.equal(overlap.ok, false);
  assert.match(overlap.error, /overlap/i);

  const badHour = validateNpcDefinition(
    {
      name: 'Hour',
      role: 'Tester',
      locationId: 'grocery',
      dialogueTreeId: 'test',
      schedule: [{ hour: 25, locationId: 'grocery' }],
    },
    'npc_hour',
    placeIds
  );
  assert.equal(badHour.ok, false);

  const badDay = validateNpcDefinition(
    {
      name: 'Day',
      role: 'Tester',
      locationId: 'grocery',
      dialogueTreeId: 'test',
      schedule: [{ hour: 9, endHour: 12, locationId: 'grocery', days: [7] }],
    },
    'npc_day',
    placeIds
  );
  assert.equal(badDay.ok, false);

  const unknown = validateNpcDefinition(
    {
      name: 'Place',
      role: 'Tester',
      locationId: 'grocery',
      dialogueTreeId: 'test',
      schedule: [{ hour: 9, endHour: 12, locationId: 'not_a_place' }],
    },
    'npc_place',
    placeIds
  );
  assert.equal(unknown.ok, false);

  const kept = validateNpcDefinition(
    {
      name: 'Kept',
      role: 'Tester',
      locationId: 'grocery',
      dialogueTreeId: 'test',
      schedule: [
        {
          hour: 9,
          endHour: 12,
          locationId: 'grocery',
          activity: 'tending',
          interaction: 'busy',
          movement: 'pace',
          dialogueNodeId: 'study',
          label: 'At the counter',
          days: [1, 3],
        },
        { hour: 0, endHour: 24, locationId: 'park', season: 'spring', activity: 'blossom' },
      ],
      scheduleOverride: {
        id: 'fair',
        active: false,
        locationId: 'market',
        activity: 'hosting',
        interaction: 'open',
        priority: 2,
      },
    },
    'npc_kept',
    placeIds
  );
  assert.equal(kept.ok, true);
  assert.equal(kept.npc.schedule[0].dialogueNodeId, 'study');
  assert.equal(kept.npc.schedule[0].movement, 'pace');
  assert.equal(kept.npc.schedule[0].label, 'At the counter');
  assert.deepEqual(kept.npc.schedule[0].days, [1, 3]);
  assert.equal(kept.npc.schedule[1].season, 'spring');
  assert.equal(kept.npc.scheduleOverride.locationId, 'market');
  assert.equal(kept.npc.scheduleOverride.priority, 2);
});

test('legacy hour-only rows wrap past midnight', () => {
  const legacy = {
    id: 'npc_mara',
    name: 'Mara Whitethorn',
    schedule: [
      { hour: 9, locationId: 'metaphysical_shop' },
      { hour: 20, locationId: 'apartment_building' },
    ],
  };
  assert.equal(resolve(legacy, 8).location, 'apartment_building');
  assert.equal(resolve(legacy, 8).indoors, true);
  assert.equal(resolve(legacy, 10).location, 'metaphysical_shop');
  assert.equal(resolve(legacy, 21).location, 'apartment_building');
  assert.equal(resolve(legacy, 21).indoors, true);
});

test('the five posted NPCs leave their counters for part of the day', () => {
  const postsFor = {
    npc_circle_leader: 'study_circle',
    npc_council_clerk: 'council',
    npc_temple_healer: 'healer_office',
    npc_seal_yard_foreman: 'seal_yard',
    npc_psychic_tent_reader: 'psychic_tent',
  };
  for (const [npcId, post] of Object.entries(postsFor)) {
    const locations = new Set(Array.from({ length: 24 }, (_, hour) => resolve(npcById(npcId), hour).location));
    assert.equal(locations.has(post), true, npcId);
    assert.ok(locations.size > 1, npcId);
  }
});

test('the presence object has no relationship fields', () => {
  const presence = resolve(npcById('npc_librarian'), 16);
  assert.equal(presence.dialogueNodeId, 'study');
  assert.equal(presence.interaction, 'busy');
  assertPublic(presence);
  const serialized = JSON.stringify(presence);
  for (const word of ['bond', 'gift', 'reputation', 'relationship']) {
    assert.equal(serialized.includes(word), false, word);
  }
});
