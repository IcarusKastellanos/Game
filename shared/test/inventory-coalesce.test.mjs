import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ITEM_STACK,
  addItemToInventory,
  coalesceInventoryStacks,
  normalizeInventoryLayout,
} from '../dist/index.js';

test('coalesceInventoryStacks merges duplicate bare item stacks', () => {
  const input = normalizeInventoryLayout([
    { itemId: 'bread', quantity: 4 },
    { itemId: 'everweed', quantity: 2 },
    { itemId: 'bread', quantity: 6 },
    { itemId: 'everweed', quantity: 3 },
  ]);
  const result = coalesceInventoryStacks(input);
  const bread = result.filter((s) => s.itemId === 'bread');
  const weed = result.filter((s) => s.itemId === 'everweed');
  assert.equal(bread.length, 1);
  assert.equal(bread[0].quantity, 10);
  assert.equal(weed.length, 1);
  assert.equal(weed[0].quantity, 5);
});

test('coalesceInventoryStacks keeps taglocks with different targets separate', () => {
  const input = normalizeInventoryLayout([
    { itemId: 'taglock_hair', quantity: 1, metadata: { targetName: 'Ada' } },
    { itemId: 'taglock_hair', quantity: 1, metadata: { targetName: 'Bea' } },
    { itemId: 'taglock_hair', quantity: 1, metadata: { targetName: 'Ada' } },
  ]);
  const result = coalesceInventoryStacks(input);
  const ada = result.filter(
    (s) => s.itemId === 'taglock_hair' && s.metadata?.targetName === 'Ada'
  );
  const bea = result.filter(
    (s) => s.itemId === 'taglock_hair' && s.metadata?.targetName === 'Bea'
  );
  // Taglocks do not merge (blocking metadata) — three distinct slots.
  assert.equal(ada.length + bea.length, 3);
  assert.equal(bea.length, 1);
});

test('coalesceInventoryStacks splits at MAX_ITEM_STACK', () => {
  const input = normalizeInventoryLayout([
    { itemId: 'bread', quantity: MAX_ITEM_STACK },
    { itemId: 'bread', quantity: 5 },
  ]);
  const result = coalesceInventoryStacks(input);
  const bread = result.filter((s) => s.itemId === 'bread');
  assert.equal(bread.length, 2);
  assert.equal(bread[0].quantity, MAX_ITEM_STACK);
  assert.equal(bread[1].quantity, 5);
});

test('addItemToInventory then coalesce does not leave duplicate mergeable stacks', () => {
  let inv = normalizeInventoryLayout([{ itemId: 'salt', quantity: 3 }]);
  inv = addItemToInventory(inv, 'salt', 2);
  inv = addItemToInventory(inv, 'salt', 4);
  inv = coalesceInventoryStacks(inv);
  const salt = inv.filter((s) => s.itemId === 'salt');
  assert.equal(salt.length, 1);
  assert.equal(salt[0].quantity, 9);
});
