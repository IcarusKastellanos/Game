import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  emptyWorldKnowledgeStore,
  parseWorldKnowledgeStore,
  type WorldKnowledgeStore,
} from '@witchcraft/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = resolve(__dirname, '../../../data/shared-knowledge.json');

let store: WorldKnowledgeStore = emptyWorldKnowledgeStore();

export const knowledgeStore = {
  load(): void {
    try {
      if (!existsSync(STORE_PATH)) {
        store = emptyWorldKnowledgeStore();
        return;
      }
      store = parseWorldKnowledgeStore(JSON.parse(readFileSync(STORE_PATH, 'utf8')));
    } catch {
      store = emptyWorldKnowledgeStore();
    }
  },
  get(): WorldKnowledgeStore {
    return store;
  },
  set(next: WorldKnowledgeStore): void {
    store = next;
    persist();
  },
};

function persist(): void {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  writeFileSync(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`);
}
