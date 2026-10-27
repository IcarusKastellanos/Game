import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('chat filter ships common profanity and slurs, not identity or setting words', () => {
  const file = JSON.parse(readFileSync(join(root, 'content/moderation/chat-filter.json'), 'utf8'));
  const words = new Set(file.words);
  assert.ok(words.size >= 80);
  assert.ok(words.size <= 400);
  for (const word of ['fuck', 'shit', 'bitch', 'nigger', 'faggot', 'tranny', 'retard']) {
    assert.ok(words.has(word), `missing ${word}`);
  }
  for (const word of ['hell', 'gay', 'queer', 'lesbian', 'trans', 'witch', 'spook']) {
    assert.equal(words.has(word), false, `should not filter ${word}`);
  }
});
