import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('shop stock is tracked per player, not on shared content listings', () => {
  const src = readFileSync(join(root, 'src/systems/shop-system.ts'), 'utf8');
  assert.match(src, /availableStock/);
  assert.match(src, /playerStockSnapshot/);
  assert.match(src, /restockPlayer/);
  assert.match(src, /shopStock/);
  assert.doesNotMatch(src, /listing\.stock\s*-=/);
  assert.doesNotMatch(src, /listing\.stock\s*=\s*next/);
});

test('GameRoom restocks each connected player at noon', () => {
  const src = readFileSync(join(root, 'src/rooms/GameRoom.ts'), 'utf8');
  assert.match(src, /maybeRestockShopsAtNoon/);
  assert.match(src, /restockPlayer/);
  assert.match(src, /syncPlayerShopStock/);
  assert.match(src, /shopStockDay/);
  assert.doesNotMatch(src, /resetDailyStock/);
  assert.doesNotMatch(src, /lastShopRestockDate/);
});

test('PlayerProgression persists per-player shop shelves', () => {
  const src = readFileSync(join(root, '../shared/src/progression/index.ts'), 'utf8');
  assert.match(src, /shopStock\?:/);
  assert.match(src, /shopStockDay\?:/);
  assert.match(src, /parseShopStock/);
});
