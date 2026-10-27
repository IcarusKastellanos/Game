import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_STATS,
  applySocialEvent,
  defaultProgression,
  describeGiftWindow,
  getSocialDocument,
  listSocialOffers,
  parseProgression,
  resolveNpcGift,
  resolveSocialAction,
  runExclusiveSocialOp,
  setSocialContent,
} from '../dist/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const social = JSON.parse(readFileSync(join(root, 'content/social.json'), 'utf8'));
setSocialContent(social);

const DAY = 24 * 60 * 60 * 1000;
const OP = 'gift-op-0001';

function facts(partial) {
  return {
    name: partial.itemId,
    tags: [],
    ...partial,
  };
}

function stack(itemId, quantity = 1, metadata) {
  return [{ itemId, quantity, ...(metadata ? { metadata } : {}) }];
}

function qty(inventory, itemId) {
  return inventory.filter((slot) => slot.itemId === itemId).reduce((sum, slot) => sum + slot.quantity, 0);
}

function give(progression, inventory, extra) {
  const itemId = extra.itemId;
  return resolveNpcGift(progression, extra.stats ?? DEFAULT_STATS, inventory, {
    npcId: extra.npcId ?? 'npc_mara',
    slotIndex: extra.slotIndex ?? 0,
    itemId,
    facts: extra.facts ?? facts({ itemId }),
    operationId: extra.operationId ?? OP,
    now: extra.now ?? 0,
  });
}

test('gift days use elapsed real time and a refused gift does not start the cooldown', () => {
  assert.equal(getSocialDocument().giftPolicy.clock, 'real');
  assert.equal(getSocialDocument().giftPolicy.cooldownHours, 24);
  assert.equal(getSocialDocument().giftPolicy.refusedConsumesCooldown, false);

  const book = stack('book_folk_magic');
  const refused = give(defaultProgression(), book, {
    itemId: 'book_folk_magic',
    facts: facts({ itemId: 'book_folk_magic', category: 'books', name: 'Primer' }),
  });
  assert.equal(refused.ok, false);
  assert.equal(qty(refused.inventory, 'book_folk_magic'), 1);
  assert.equal(refused.progression.social.bonds.npc_mara, undefined);

  const salt = give(defaultProgression(), stack('salt', 2), {
    itemId: 'salt',
    facts: facts({ itemId: 'salt', category: 'minerals', rarity: 'common', name: 'Salt' }),
    operationId: 'salt-op-01',
  });
  assert.equal(salt.ok, true);
  assert.equal(salt.tier, 'neutral');
  assert.match(salt.reaction, /set it aside/);
  assert.equal(salt.progression.social.bonds.npc_mara.axes.affinity, undefined);
  assert.equal(salt.progression.social.bonds.npc_mara.axes.familiarity, 1);
  assert.equal(qty(salt.inventory, 'salt'), 1);
  assert.equal(salt.progression.earnedLicenses?.length ?? 0, 0);
});

test('preferences, rarity, and a finished quest change the reaction', () => {
  const before = describeGiftWindow(defaultProgression(), 'npc_mara', [], 0);
  assert.ok(before.knownPreferences.some((line) => line.line.includes('Rosemary')));
  assert.ok(before.knownPreferences.some((line) => line.line.includes('Resin smoke')));
  assert.equal(before.knownPreferences.some((line) => /frankincense|loved|hated|baneful/i.test(line.line)), false);

  const herb = facts({ itemId: 'rosemary', category: 'herbs', rarity: 'exotic', name: 'Rosemary' });
  const liked = give(defaultProgression(), stack('rosemary'), { itemId: 'rosemary', facts: herb, operationId: 'rose-op-1' });
  assert.equal(liked.tier, 'liked');
  assert.equal(liked.progression.social.bonds.npc_mara.axes.affinity, 3);

  const practiced = defaultProgression();
  practiced.questProgress = { quest_first_steps: { completedAt: 1 } };
  const favorite = give(practiced, stack('rosemary'), { itemId: 'rosemary', facts: herb, operationId: 'rose-op-2' });
  assert.equal(favorite.tier, 'favorite');
  assert.equal(favorite.progression.social.bonds.npc_mara.axes.affinity, 8);
  assert.match(favorite.reaction, /favorite/);

  const showy = give(defaultProgression(), stack('showy_relic'), {
    itemId: 'showy_relic',
    facts: facts({ itemId: 'showy_relic', category: 'minerals', rarity: 'exotic', name: 'Showy relic' }),
    operationId: 'showy-op-1',
  });
  assert.equal(showy.tier, 'disliked');
  assert.equal(showy.progression.social.bonds.npc_mara.axes.affinity, -2);

  const baneful = give(defaultProgression(), stack('hex_ash'), {
    itemId: 'hex_ash',
    facts: facts({ itemId: 'hex_ash', category: 'minerals', rarity: 'exotic', tags: ['baneful'], name: 'Hex ash' }),
    operationId: 'ash-op-01',
  });
  assert.equal(baneful.tier, 'hated');
  assert.equal(baneful.progression.social.bonds.npc_mara.axes.affinity, -4);
  const revealed = describeGiftWindow(baneful.progression, 'npc_mara', [], 0);
  assert.ok(revealed.knownPreferences.some((line) => line.line.includes('Baneful')));
  assert.equal(JSON.stringify(revealed.knownPreferences).includes('mara_baneful'), false);
});

test('the same gift cannot be spent twice, and another player is unaffected', () => {
  const inventory = stack('bread', 1);
  const first = give(defaultProgression(), inventory, {
    npcId: 'npc_tom',
    itemId: 'bread',
    facts: facts({ itemId: 'bread', category: 'food', name: 'Bread' }),
    operationId: 'bread-op-1',
  });
  assert.equal(first.ok, true);
  assert.equal(qty(first.inventory, 'bread'), 0);
  const replay = give(first.progression, stack('bread', 1), {
    npcId: 'npc_tom',
    itemId: 'bread',
    facts: facts({ itemId: 'bread', category: 'food', name: 'Bread' }),
    operationId: 'bread-op-1',
  });
  assert.equal(replay.duplicate, true);
  assert.equal(qty(replay.inventory, 'bread'), 1);
  assert.equal(replay.progression, first.progression);

  const other = give(defaultProgression(), stack('bread', 1), {
    npcId: 'npc_tom',
    itemId: 'bread',
    facts: facts({ itemId: 'bread', category: 'food', name: 'Bread' }),
    operationId: 'bread-op-2',
  });
  assert.equal(other.ok, true);
  assert.equal(other.progression.social.bonds.npc_tom.axes.affinity, first.progression.social.bonds.npc_tom.axes.affinity);

  const blocked = give(first.progression, stack('bread', 1), {
    npcId: 'npc_tom',
    itemId: 'bread',
    facts: facts({ itemId: 'bread', name: 'Bread' }),
    operationId: 'bread-op-3',
    now: DAY - 1,
  });
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /day should pass/);
  assert.equal(qty(blocked.inventory, 'bread'), 1);

  const later = give(first.progression, stack('bread', 1), {
    npcId: 'npc_tom',
    itemId: 'bread',
    facts: facts({ itemId: 'bread', category: 'food', name: 'Bread' }),
    operationId: 'bread-op-4',
    now: DAY,
  });
  assert.equal(later.ok, true);
  assert.equal(later.progression.social.bonds.npc_tom.axes.affinity, 12);
});

test('repeating a favorite trails off, and the record survives a reload', () => {
  let progression = defaultProgression();
  progression.questProgress = { quest_first_steps: { completedAt: 1 } };
  const herb = facts({ itemId: 'rosemary', category: 'herbs', name: 'Rosemary' });
  const gains = [];
  for (let i = 0; i < 4; i += 1) {
    const result = give(progression, stack('rosemary'), {
      itemId: 'rosemary',
      facts: herb,
      operationId: `rose-repeat-${i}`,
      now: i * DAY,
    });
    assert.equal(result.ok, true, result.reason);
    gains.push(result.progression.social.bonds.npc_mara.axes.affinity);
    progression = result.progression;
  }
  assert.deepEqual(gains, [8, 12, 14, 14]);

  const saved = parseProgression(JSON.parse(JSON.stringify(progression)));
  assert.equal(saved.social.bonds.npc_mara.giftNextAt, 3 * DAY + DAY);
  assert.equal(saved.social.bonds.npc_mara.giftCounts.rosemary, 4);
  const again = give(saved, stack('rosemary'), {
    itemId: 'rosemary',
    facts: herb,
    operationId: 'rose-repeat-0',
    now: 3 * DAY + DAY,
  });
  assert.equal(again.duplicate, true);
  assert.equal(qty(again.inventory, 'rosemary'), 1);
  assert.equal(again.progression.social.bonds.npc_mara.axes.affinity, 14);
});

test('an heirloom is not the same gift as an expensive rarity, and Elena ignores affection', () => {
  const plain = give(defaultProgression(), stack('old_page'), {
    npcId: 'npc_librarian',
    itemId: 'old_page',
    facts: facts({ itemId: 'old_page', category: 'written_petitions', rarity: 'exotic', name: 'Old page' }),
    operationId: 'page-op-1',
  });
  assert.equal(plain.tier, 'neutral');
  const heirloom = give(defaultProgression(), stack('old_page'), {
    npcId: 'npc_librarian',
    itemId: 'old_page',
    facts: facts({
      itemId: 'old_page',
      category: 'written_petitions',
      rarity: 'common',
      provenance: 'heirloom',
      name: 'Old page',
    }),
    operationId: 'page-op-2',
  });
  assert.equal(heirloom.tier, 'loved');
  assert.match(heirloom.reaction, /pleases/);
  assert.equal(heirloom.progression.social.bonds.npc_librarian.axes.affinity, undefined);

  const tea = give(defaultProgression(), stack('herbal_tea'), {
    npcId: 'npc_elena',
    itemId: 'herbal_tea',
    facts: facts({ itemId: 'herbal_tea', category: 'medicine', name: 'Herbal tea' }),
    operationId: 'tea-op-01',
  });
  assert.equal(tea.tier, 'favorite');
  assert.equal(tea.progression.social.bonds.npc_elena.axes.affinity, undefined);
  assert.equal(tea.progression.social.bonds.npc_elena.axes.trust, 1);
  assert.equal(tea.progression.social.bonds.npc_elena.axes.familiarity, 2);
});

test('a second gift attempt is turned away while the first is still being settled', () => {
  const nested = runExclusiveSocialOp('player-a:npc_mara:gift', () =>
    runExclusiveSocialOp('player-a:npc_mara:gift', () => 'inner')
  );
  assert.equal(nested.busy, false);
  assert.equal(nested.value.busy, true);
  const after = runExclusiveSocialOp('player-a:npc_mara:gift', () => 'next');
  assert.equal(after.busy, false);
  assert.equal(after.value, 'next');
  const someoneElse = runExclusiveSocialOp('player-b:npc_mara:gift', () => 'other');
  assert.equal(someoneElse.value, 'other');
});

test('greetings and promise follow-ups do not buy affection', () => {
  const stranger = listSocialOffers('npc_mara', defaultProgression(), 0).map((offer) => offer.id);
  assert.ok(stranger.includes('social:greet'));
  assert.equal(stranger.includes('social:ask_wellbeing'), false);
  assert.equal(stranger.includes('social:invite'), false);

  const greeted = resolveSocialAction(defaultProgression(), DEFAULT_STATS, {
    npcId: 'npc_mara',
    actionId: 'social:greet',
    operationId: 'greet-op-1',
    now: 0,
  });
  assert.equal(greeted.ok, true);
  assert.equal(greeted.progression.social.bonds.npc_mara.axes.familiarity, 1);
  assert.equal(greeted.progression.social.bonds.npc_mara.axes.affinity, undefined);
  const repeated = resolveSocialAction(greeted.progression, DEFAULT_STATS, {
    npcId: 'npc_mara',
    actionId: 'greet',
    operationId: 'greet-op-2',
    now: 1000,
  });
  assert.equal(repeated.ok, false);
  assert.equal(repeated.progression.social.bonds.npc_mara.axes.familiarity, 1);
  const sameGesture = resolveSocialAction(greeted.progression, DEFAULT_STATS, {
    npcId: 'npc_mara',
    actionId: 'social:greet',
    operationId: 'greet-op-1',
    now: 1000,
  });
  assert.equal(sameGesture.duplicate, true);

  const known = applySocialEvent(defaultProgression(), DEFAULT_STATS, {
    eventId: 'dialogue_regard',
    npcId: 'npc_mara',
    scale: 5,
  });
  assert.ok(listSocialOffers('npc_mara', known.progression, 0).some((offer) => offer.id === 'social:ask_wellbeing'));
  const asked = resolveSocialAction(known.progression, known.stats, {
    npcId: 'npc_mara',
    actionId: 'ask_wellbeing',
    operationId: 'ask-op-0001',
    now: 0,
  });
  assert.equal(asked.ok, true);
  assert.equal(asked.progression.social.bonds.npc_mara.axes.affinity, undefined);

  const broken = applySocialEvent(defaultProgression(), DEFAULT_STATS, {
    eventId: 'promise_broken',
    npcId: 'npc_mara',
  });
  assert.ok(listSocialOffers('npc_mara', broken.progression, 0).some((offer) => offer.id === 'social:follow_up_promise'));
  const followed = resolveSocialAction(broken.progression, broken.stats, {
    npcId: 'npc_mara',
    actionId: 'follow_up_promise',
    operationId: 'follow-op-1',
    now: 0,
  });
  assert.equal(followed.ok, true);
  assert.match(followed.reaction, /broken word/);
  assert.ok(followed.progression.social.bonds.npc_mara.grudges.includes('broke_promise'));
  assert.equal(followed.progression.social.bonds.npc_mara.axes.familiarity, undefined);

  const close = parseProgression({
    social: {
      scopes: {},
      bonds: {
        npc_mara: { axes: { affinity: 24, trust: 18, familiarity: 10 } },
      },
    },
  });
  assert.ok(listSocialOffers('npc_mara', close, 0).some((offer) => offer.id === 'social:invite'));
  const invited = resolveSocialAction(close, DEFAULT_STATS, {
    npcId: 'npc_mara',
    actionId: 'invite',
    operationId: 'invite-op-1',
    now: 0,
  });
  assert.equal(invited.ok, true);
  assert.ok(invited.progression.social.bonds.npc_mara.memories.some((memory) => memory.id === 'invited'));
  assert.equal(invited.progression.earnedLicenses?.length ?? 0, 0);
});
