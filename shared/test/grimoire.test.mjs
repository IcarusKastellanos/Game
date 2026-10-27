import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultGrimoire,
  defaultProgression,
  grimoireKnowsSpell,
  isMalevolentSpell,
  malevolentGrimoireWard,
  parseGrimoire,
  parseProgression,
  recordGrimoireCast,
  recordGrimoireIngredients,
  backfillGrimoireIngredients,
  recordGrimoireNpc,
  recordGrimoireSpirit,
  selectGrimoireSpirit,
  shareSpellIntoGrimoire,
  customizeGrimoire,
  setGrimoireNotes,
  withGrimoire,
} from '../dist/index.js';

const baneful = { id: 'pocket_weakening_hex', category: 'baneful', moralEffect: -2 };
const healing = { id: 'healing_charm', category: 'healing', moralEffect: 1 };

test('parseProgression keeps a grimoire and fills one when the save has none', () => {
  const fresh = parseProgression({});
  assert.equal(fresh.grimoire.custom.title, 'Personal Grimoire');
  assert.equal(fresh.grimoire.spells.length, 0);

  const kept = parseProgression({
    grimoire: {
      custom: { title: 'Night Book', dedication: 'For the house', ink: 'violet', showLockedShared: false },
      spells: [{ spellId: 'healing_charm', source: 'cast', firstRecordedAt: 10, timesCast: 2 }],
      notes: ['one'],
      notesActive: 0,
    },
  });
  assert.equal(kept.grimoire.custom.title, 'Night Book');
  assert.equal(kept.grimoire.custom.ink, 'violet');
  assert.equal(kept.grimoire.custom.showLockedShared, false);
  assert.equal(kept.grimoire.spells[0].timesCast, 2);
  assert.equal(kept.grimoire.notes[0], 'one');
  assert.equal(kept.grimoire.notes.length, 5);
});

test('casting records a page, and a later success counts', () => {
  let book = defaultGrimoire();
  book = recordGrimoireCast(book, 'healing_charm', false, 20);
  assert.equal(book.spells[0].source, 'studied');
  assert.equal(book.spells[0].timesCast, 0);
  book = recordGrimoireCast(book, 'healing_charm', false, 30);
  assert.equal(book.spells[0].timesCast, 0);
  book = recordGrimoireCast(book, 'healing_charm', true, 40);
  assert.equal(book.spells[0].source, 'cast');
  assert.equal(book.spells[0].timesCast, 1);
  assert.equal(book.spells[0].lastCastAt, 40);
});

test('a shared page indexes a spell the recipient has not cast', () => {
  const shared = shareSpellIntoGrimoire(defaultGrimoire(), 'pocket_weakening_hex', 'Mara', 5);
  assert.equal(shared.status, 'added');
  assert.equal(shared.grimoire.spells[0].source, 'shared');
  assert.equal(shared.grimoire.spells[0].sharedByName, 'Mara');
  assert.equal(shared.grimoire.spells[0].timesCast, 0);
  const again = shareSpellIntoGrimoire(shared.grimoire, 'pocket_weakening_hex', 'Ivo', 6);
  assert.equal(again.status, 'already');
  assert.equal(again.grimoire.spells[0].sharedByName, 'Mara');
});

test('malevolent ward is a single point, and only when that spell is indexed', () => {
  const empty = defaultProgression();
  assert.equal(malevolentGrimoireWard(empty.grimoire, baneful), 0);
  assert.equal(isMalevolentSpell(healing), false);
  const indexed = withGrimoire(empty, (book) => shareSpellIntoGrimoire(book, baneful.id, 'Mara').grimoire);
  assert.equal(grimoireKnowsSpell(indexed.grimoire, baneful.id), true);
  assert.equal(malevolentGrimoireWard(indexed.grimoire, baneful), 1);
  assert.equal(malevolentGrimoireWard(indexed.grimoire, healing), 0);
  const castHealing = recordGrimoireCast(defaultGrimoire(), healing.id, true);
  assert.equal(malevolentGrimoireWard(castHealing, healing), 0);
  const sour = { id: 'gentle_bind', category: 'binding', moralEffect: -1 };
  const knownSour = recordGrimoireCast(defaultGrimoire(), sour.id, true);
  assert.equal(malevolentGrimoireWard(knownSour, sour), 1);
});

test('ingredients accumulate, and backfill does not recount a page already written', () => {
  let book = recordGrimoireIngredients(defaultGrimoire(), ['bay_leaf', { itemId: 'salt', count: 3 }]);
  assert.equal(book.ingredients.find((row) => row.itemId === 'salt').timesGathered, 3);
  book = recordGrimoireIngredients(book, [{ itemId: 'salt', count: 2 }]);
  assert.equal(book.ingredients.find((row) => row.itemId === 'salt').timesGathered, 5);
  book = recordGrimoireIngredients(book, ['taglock_hair']);
  assert.equal(book.ingredients.some((row) => row.itemId === 'taglock_hair'), false);
  const filled = backfillGrimoireIngredients(book, ['salt', 'white_candle']);
  assert.equal(filled.ingredients.find((row) => row.itemId === 'salt').timesGathered, 5);
  assert.equal(filled.ingredients.find((row) => row.itemId === 'white_candle').timesGathered, 1);
});

test('spirit meetings can be selected, and a second petition does not invent another meeting', () => {
  const first = recordGrimoireSpirit(defaultGrimoire(), {
    spiritId: 'spirit_temple_attendant',
    spiritType: 'healing',
    name: 'Temple Attendant',
    description: 'A gentle presence.',
    domains: ['healing', 'mercy'],
  });
  assert.equal(first.status, 'added');
  const again = recordGrimoireSpirit(first.grimoire, {
    spiritId: 'spirit_temple_attendant',
    spiritType: 'healing',
    name: 'Temple Attendant',
    description: 'A gentle presence.',
    domains: ['healing'],
  });
  assert.equal(again.status, 'again');
  assert.equal(again.grimoire, first.grimoire);
  assert.equal(again.grimoire.spirits[0].timesMet, 1);
  const selected = selectGrimoireSpirit(first.grimoire, 'spirit_temple_attendant');
  assert.equal(selected.selectedSpiritId, 'spirit_temple_attendant');
  assert.equal(selectGrimoireSpirit(first.grimoire, 'spirit_missing'), first.grimoire);
  const parsed = parseGrimoire({ ...selected, selectedSpiritId: 'nope' });
  assert.equal(parsed.selectedSpiritId, undefined);
});

test('the book keeps a personal hand, and notes stay five pages', () => {
  let book = customizeGrimoire(defaultGrimoire(), { title: '  ', dedication: 'For Mara', ink: 'blood' });
  assert.equal(book.custom.title, 'Personal Grimoire');
  assert.equal(book.custom.dedication, 'For Mara');
  assert.equal(book.custom.ink, 'blood');
  book = customizeGrimoire(book, { ink: 'not-a-color' });
  assert.equal(book.custom.ink, 'blood');
  book = setGrimoireNotes(book, ['alpha'], 4);
  assert.equal(book.notes.length, 5);
  assert.equal(book.notes[0], 'alpha');
  assert.equal(book.notesActive, 4);
  book = recordGrimoireNpc(book, { npcId: 'npc_mara', name: 'Mara', relationship: 140 });
  assert.equal(book.npcs[0].relationship, 100);
  const same = recordGrimoireNpc(book, { npcId: 'npc_mara', name: 'Mara', relationship: 100 });
  assert.equal(same, book);
});
