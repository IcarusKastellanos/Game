import { test } from 'node:test';
import assert from 'node:assert/strict';
import { censorWords } from '../dist/chat/filter.js';

test('censorWords masks whole words and keeps surrounding text', () => {
  assert.equal(censorWords('What a damn shame', ['damn']), 'What a **** shame');
  assert.equal(censorWords('DAMN and damn.', ['damn']), '**** and ****.');
  assert.equal(censorWords('class assignment', ['ass']), 'class assignment');
  assert.equal(censorWords('hello', []), 'hello');
});
