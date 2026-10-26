import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('altar locked tooltip explains the spell, hides ingredients, and flags the level gate', () => {
  const src = readFileSync(join(root, 'src/ui/AltarPanel.ts'), 'utf8');
  assert.match(src, /if \(!unlocked\)/);
  assert.match(src, /altar-tip-gate/);
  assert.match(src, /Level gated/);
  assert.match(src, /spell\.description/);
  assert.match(src, /Ingredients and preparation details stay sealed/);
  assert.doesNotMatch(
    src.slice(src.indexOf('if (!unlocked)'), src.indexOf('const intuition')),
    /spell\.ingredients|Requires<\/span>|optionalBoosters/
  );
  assert.match(src, /if \(!this\.isSpellUnlocked\(spell\)\)/);
  assert.match(src, /data-locked=/);
});

test('craft and shop panels hide ingredients / block purchase when level gated', () => {
  const craft = readFileSync(join(root, 'src/ui/ProgressionPanels.ts'), 'utf8');
  assert.match(craft, /Ingredients stay sealed until Level/);
  assert.match(craft, /Level gated — requires Practitioner Level/);
  assert.match(craft, /disabled/);

  const shop = readFileSync(join(root, 'src/ui/ShopPanel.ts'), 'utf8');
  assert.match(shop, /Level gated/);
  assert.match(shop, /meetsMinLevel/);
  assert.match(shop, /if \(unlocked\)/);
});
