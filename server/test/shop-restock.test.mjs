import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('shop system exposes noon restock helpers', () => {
  const src = readFileSync(join(root, 'src/systems/shop-system.ts'), 'utf8');
  assert.match(src, /captureBaselines/);
  assert.match(src, /resetDailyStock/);
  assert.match(src, /stockSnapshot/);
});

test('GameRoom restocks shops at noon once per local day', () => {
  const src = readFileSync(join(root, 'src/rooms/GameRoom.ts'), 'utf8');
  assert.match(src, /maybeRestockShopsAtNoon/);
  assert.match(src, /noon_restock/);
  assert.match(src, /lastShopRestockDate/);
  assert.match(src, /hour < 12/);
});
