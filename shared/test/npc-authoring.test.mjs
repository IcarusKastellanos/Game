import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLIENT_NPC_FORBIDDEN_KEYS,
  NPC_CONFIG_SCHEMA,
  defaultUiFeedback,
  nextSeq,
  shouldApplySeq,
  toClientNpc,
  validateKnowledgeAuthoring,
  validateNpcAuthoring,
  validateSocialNpcProfile,
  setKnowledgeContent,
} from '../dist/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
function loadJson(path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
}

const npcs = loadJson('content/npcs.json');
const mara = npcs.find((npc) => npc.id === 'npc_mara');
const maraPlaceIds = [
  mara.locationId,
  ...(mara.schedule ?? []).map((row) => row.locationId),
  mara.scheduleOverride?.locationId,
].filter(Boolean);

test('client NPC export strips private simulation fields', () => {
  const exported = toClientNpc({
    ...mara,
    secrets: ['hidden_path'],
    personality: { friendliness: 80, caution: 40 },
    scheduleOverride: { id: 'x', active: true, locationId: 'town' },
    relationshipLevel: 9,
    magicalKnowledge: 4,
  });
  for (const key of CLIENT_NPC_FORBIDDEN_KEYS) {
    assert.equal(Object.prototype.hasOwnProperty.call(exported, key), false);
  }
  assert.equal(exported.id, 'npc_mara');
  assert.equal(exported.name, mara.name);
  assert.ok(NPC_CONFIG_SCHEMA.clientExport.forbidden.includes('secrets'));
});

test('legacy NPC definitions validate with defaults', () => {
  const result = validateNpcAuthoring(mara, mara.id, {
    placeIds: maraPlaceIds,
    shopIds: new Set(mara.shopId ? [mara.shopId] : []),
    dialogueTreeIds: new Set([mara.dialogueTreeId]),
  });
  assert.equal(result.ok, true, result.diagnostics.map((row) => row.message).join('; '));
  assert.ok(result.npc);
});

test('invalid shop capability is rejected', () => {
  const result = validateNpcAuthoring(
    {
      ...mara,
      capabilities: [{ action: 'trade', shopId: 'missing_shop' }],
    },
    mara.id,
    {
      placeIds: maraPlaceIds,
      shopIds: new Set([mara.shopId].filter(Boolean)),
    }
  );
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((row) => row.path.includes('shopId')));
});

test('knowledge authoring catches contradictory visibility rules', () => {
  setKnowledgeContent(loadJson('content/knowledge.json'));
  const bad = {
    entries: [
      {
        id: 'a',
        text: 'one',
        reliability: 'complete',
        knownByNpcIds: ['npc_mara'],
        discoveryScope: 'personal',
        conflictsWith: ['b'],
        clarifies: ['b'],
      },
      {
        id: 'b',
        text: 'two',
        reliability: 'complete',
        knownByNpcIds: ['npc_mara'],
        discoveryScope: 'personal',
      },
    ],
  };
  const result = validateKnowledgeAuthoring(bad, { npcIds: new Set(['npc_mara']) });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((row) => /conflict/i.test(row.message) || /clarify/i.test(row.message)));
});

test('ui feedback defaults are safe and social profile validation warns on empty public prefs', () => {
  const defaults = defaultUiFeedback();
  assert.equal(defaults.showStage, true);
  const diagnostics = validateSocialNpcProfile('npc_mara', {
    giftPreferences: [{ id: 'x', match: {}, tier: 'liked', visibility: 'public' }],
    shopDiscount: { minStage: 'friendly', multiplier: 2 },
  });
  assert.ok(diagnostics.some((row) => row.level === 'error' && row.path.includes('multiplier')));
});

test('sync sequence ignores stale updates and accepts equal or newer', () => {
  assert.equal(shouldApplySeq(5, 4), false);
  assert.equal(shouldApplySeq(5, 5), true);
  assert.equal(shouldApplySeq(5, 6), true);
  assert.equal(shouldApplySeq(undefined, 1), true);
  assert.equal(nextSeq(3), 4);
  assert.equal(nextSeq(undefined), 1);
});
