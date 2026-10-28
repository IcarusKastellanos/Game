import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  emptyWorldKnowledgeStore,
  parseWorldKnowledgeStore,
  type WorldKnowledgeStore,
} from '@witchcraft/shared';
import { prisma } from '../services/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = resolve(__dirname, '../../../data/shared-knowledge.json');
const WORLD_KEY = 'npc_world_knowledge';

let store: WorldKnowledgeStore = emptyWorldKnowledgeStore();
let dbAvailable: boolean | null = null;

export const knowledgeStore = {
  /** Sync file load for boot; DB hydrate runs in the background and dual-writes. */
  load(): void {
    store = loadFromFile();
    void hydrateFromDb();
  },
  get(): WorldKnowledgeStore {
    return store;
  },
  set(next: WorldKnowledgeStore): void {
    store = next;
    persistFile(store);
    void persistDb(store);
  },
};

function loadFromFile(): WorldKnowledgeStore {
  try {
    if (!existsSync(STORE_PATH)) return emptyWorldKnowledgeStore();
    return parseWorldKnowledgeStore(JSON.parse(readFileSync(STORE_PATH, 'utf8')));
  } catch {
    return emptyWorldKnowledgeStore();
  }
}

async function hydrateFromDb(): Promise<void> {
  try {
    const row = await prisma.worldDocument.findUnique({ where: { key: WORLD_KEY } });
    dbAvailable = true;
    if (!row) {
      if (Object.keys(store.discoveries).length) await persistDb(store);
      return;
    }
    const fromDb = parseWorldKnowledgeStore(row.document);
    const merged = mergeStores(store, fromDb);
    store = merged;
    persistFile(store);
    if (JSON.stringify(merged) !== JSON.stringify(fromDb)) await persistDb(merged);
  } catch (err) {
    dbAvailable = false;
    console.warn('[knowledgeStore] DB hydrate unavailable, using file:', err instanceof Error ? err.message : err);
  }
}

function mergeStores(a: WorldKnowledgeStore, b: WorldKnowledgeStore): WorldKnowledgeStore {
  const discoveries = { ...a.discoveries };
  for (const [id, row] of Object.entries(b.discoveries)) {
    const prior = discoveries[id];
    if (!prior || row.discoveredAt < prior.discoveredAt) discoveries[id] = row;
  }
  return { discoveries };
}

function persistFile(next: WorldKnowledgeStore): void {
  try {
    mkdirSync(dirname(STORE_PATH), { recursive: true });
    writeFileSync(STORE_PATH, `${JSON.stringify(next, null, 2)}\n`);
  } catch (err) {
    console.warn('[knowledgeStore] File persist failed:', err);
  }
}

async function persistDb(next: WorldKnowledgeStore): Promise<void> {
  if (dbAvailable === false) return;
  try {
    await prisma.worldDocument.upsert({
      where: { key: WORLD_KEY },
      create: { key: WORLD_KEY, document: next as object },
      update: { document: next as object },
    });
    dbAvailable = true;
  } catch (err) {
    dbAvailable = false;
    console.warn('[knowledgeStore] DB persist unavailable:', err instanceof Error ? err.message : err);
  }
}
