import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContentSaveError, contentRevision, writeVersionedCollection } from '../src/content/versioned-content.ts';

test('a versioned save survives a reread and a stale editor cannot overwrite it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'npc-content-'));
  const first = writeVersionedCollection({
    directory,
    filename: 'dialogues.json',
    bucket: 'dialogues',
    id: 'mara_intro',
    expectedRevision: 0,
    records: [{ id: 'mara_intro', text: 'first' }],
  });
  assert.equal(first.revision, 1);
  assert.equal(contentRevision('dialogues', 'mara_intro', directory), 1);
  const disk = JSON.parse(readFileSync(join(directory, 'dialogues.json'), 'utf8'));
  assert.equal(disk[0].text, 'first');

  assert.throws(
    () =>
      writeVersionedCollection({
        directory,
        filename: 'dialogues.json',
        bucket: 'dialogues',
        id: 'mara_intro',
        expectedRevision: 0,
        records: [{ id: 'mara_intro', text: 'stale' }],
      }),
    (error) => error instanceof ContentSaveError && error.status === 409 && error.revision === 1
  );
  const kept = JSON.parse(readFileSync(join(directory, 'dialogues.json'), 'utf8'));
  assert.equal(kept[0].text, 'first');
});

test('a failed revision write restores the previous content and does not report a revision', () => {
  const directory = mkdtempSync(join(tmpdir(), 'npc-content-fail-'));
  writeVersionedCollection({
    directory,
    filename: 'npcs.json',
    bucket: 'npcs',
    id: 'npc_mara',
    expectedRevision: 0,
    records: [{ id: 'npc_mara', name: 'Mara' }],
  });
  assert.throws(
    () =>
      writeVersionedCollection({
        directory,
        filename: 'npcs.json',
        bucket: 'npcs',
        id: 'npc_mara',
        expectedRevision: 1,
        records: [{ id: 'npc_mara', name: 'Lost' }],
        fault: 'revision',
      }),
    (error) => error instanceof ContentSaveError && error.status === 500
  );
  const kept = JSON.parse(readFileSync(join(directory, 'npcs.json'), 'utf8'));
  assert.equal(kept[0].name, 'Mara');
  assert.equal(contentRevision('npcs', 'npc_mara', directory), 1);
  assert.equal(existsSync(join(directory, 'npcs.json')), true);
});

test('a missing revision is rejected before any file is written', () => {
  const directory = mkdtempSync(join(tmpdir(), 'npc-content-missing-'));
  assert.throws(
    () =>
      writeVersionedCollection({
        directory,
        filename: 'npcs.json',
        bucket: 'npcs',
        id: 'npc_mara',
        expectedRevision: 1.5,
        records: [],
      }),
    (error) => error instanceof ContentSaveError && error.status === 400
  );
  assert.equal(existsSync(join(directory, 'npcs.json')), false);
});
