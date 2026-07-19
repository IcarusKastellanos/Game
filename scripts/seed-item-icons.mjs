import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateItemIconPixels } from '../shared/dist/icons/item-icon-pixels.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = resolve(__dirname, '../content/ingredients.json');
const items = JSON.parse(readFileSync(path, 'utf-8'));

for (const item of items) {
  item.iconPixels = generateItemIconPixels(item.id, item.category, item.name);
}

writeFileSync(path, `${JSON.stringify(items, null, 2)}\n`);
console.log(`Seeded iconPixels for ${items.length} items.`);
