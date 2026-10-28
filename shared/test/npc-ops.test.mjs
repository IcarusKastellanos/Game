import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADMIN_ROLES,
  CLIENT_DIALOGUE_CHOICE_FORBIDDEN_KEYS,
  NPC_STATE_OWNERSHIP,
  diagnoseNpcRuntime,
  explainNpcAvailability,
  releaseConversationLocksForSession,
  shouldApplySeq,
  toClientDialogue,
  toClientNpc,
  validateNpcAuthoring,
} from '../dist/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const npcs = JSON.parse(readFileSync(join(root, 'content/npcs.json'), 'utf8'));
const dialogues = JSON.parse(readFileSync(join(root, 'content/dialogues.json'), 'utf8'));
const mara = npcs.find((npc) => npc.id === 'npc_mara');
const maraTree = dialogues.find((tree) => tree.id === mara.dialogueTreeId);
const maraPlaces = [
  mara.locationId,
  ...(mara.schedule ?? []).map((row) => row.locationId),
].filter(Boolean);

test('ownership matrix covers world, player, and transient scopes', () => {
  const scopes = new Set(NPC_STATE_OWNERSHIP.map((row) => row.scope));
  assert.ok(scopes.has('world_shared'));
  assert.ok(scopes.has('player_private'));
  assert.ok(scopes.has('transient_session'));
  assert.ok(scopes.has('derived'));
});

test('content designer can reload; auditor can view NPCs but not edit', () => {
  assert.ok(ADMIN_ROLES.content_designer.permissions.includes('system.reload'));
  assert.ok(ADMIN_ROLES.content_designer.permissions.includes('content.npc.edit'));
  assert.ok(ADMIN_ROLES.auditor.permissions.includes('content.npc.view'));
  assert.equal(ADMIN_ROLES.auditor.permissions.includes('content.npc.edit'), false);
});

test('diagnose explains away / busy presence without mutating definitions', () => {
  const away = explainNpcAvailability({
    presence: {
      npcId: 'npc_mara',
      scene: 'town',
      tile: null,
      location: 'apartment_building',
      interaction: 'away',
      visible: false,
      indoors: true,
      held: false,
      moving: false,
    },
  });
  assert.equal(away.available, false);
  assert.ok(away.reasons.some((row) => /away|visible|indoors/i.test(row)));

  const diagnosis = diagnoseNpcRuntime({
    npc: mara,
    placeIds: maraPlaces,
    shopIds: new Set(mara.shopId ? [mara.shopId] : []),
    dialogueTreeIds: new Set([mara.dialogueTreeId]),
    hour: 12,
    presence: {
      npcId: 'npc_mara',
      scene: 'town',
      tile: { x: 1, y: 1 },
      location: 'metaphysical_shop',
      interaction: 'open',
      visible: true,
      indoors: false,
      held: false,
      moving: false,
    },
    distanceOk: true,
  });
  assert.equal(diagnosis.privileged, true);
  assert.equal(diagnosis.npcId, 'npc_mara');
  assert.ok(diagnosis.schedulePreview.length >= 1);
  assert.equal(diagnosis.availability.available, true);
});

test('client dialogue export strips spoiler choice fields', () => {
  assert.ok(maraTree);
  const exported = toClientDialogue({
    ...maraTree,
    nodes: [
      {
        id: 'start',
        text: 'Hello',
        choices: [
          {
            id: 'c1',
            label: 'Take it',
            next: 'end',
            grantItem: 'secret_key',
            requiresBond: { minStage: 'friend' },
            actions: [{ type: 'grant_item', itemId: 'x' }],
          },
        ],
      },
    ],
  });
  const choice = exported.nodes[0].choices[0];
  for (const key of CLIENT_DIALOGUE_CHOICE_FORBIDDEN_KEYS) {
    assert.equal(Object.prototype.hasOwnProperty.call(choice, key), false);
  }
  assert.equal(choice.label, 'Take it');
  assert.ok(!Object.prototype.hasOwnProperty.call(toClientNpc(mara), 'secrets'));
});

test('session lock release frees exclusive NPC without affecting others', () => {
  const now = 1_000_000;
  const locks = [
    {
      npcId: 'a',
      playerId: 'p1',
      sessionId: 's1',
      startedAt: now,
      expiresAt: now + 60_000,
      policy: 'exclusive',
    },
    {
      npcId: 'b',
      playerId: 'p2',
      sessionId: 's2',
      startedAt: now,
      expiresAt: now + 60_000,
      policy: 'exclusive',
    },
  ];
  const next = releaseConversationLocksForSession(locks, 's1', now);
  assert.equal(next.length, 1);
  assert.equal(next[0].sessionId, 's2');
});

test('stale encounter seq is rejected like progression updates', () => {
  assert.equal(shouldApplySeq(10, 9), false);
  assert.equal(shouldApplySeq(10, 10), true);
});

test('authored Mara still validates under corpus place ids', () => {
  const result = validateNpcAuthoring(mara, mara.id, {
    placeIds: maraPlaces,
    shopIds: new Set(mara.shopId ? [mara.shopId] : []),
    dialogueTreeIds: new Set([mara.dialogueTreeId]),
  });
  assert.equal(result.ok, true, result.diagnostics.map((d) => d.message).join('; '));
});
