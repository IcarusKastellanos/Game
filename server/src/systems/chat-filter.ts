import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { censorWords } from '@witchcraft/shared';

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../content/moderation/chat-filter.json');

let words: string[] = [];

function normalizeWords(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const next: string[] = [];
  for (const entry of raw) {
    const word = String(entry ?? '').trim().toLowerCase();
    if (!word || word.length > 64 || seen.has(word)) continue;
    seen.add(word);
    next.push(word);
  }
  return next.slice(0, 400);
}

export function loadChatFilter(): string[] {
  try {
    if (!existsSync(FILE)) {
      words = [];
      return words;
    }
    const parsed = JSON.parse(readFileSync(FILE, 'utf8')) as { words?: unknown };
    words = normalizeWords(parsed.words);
  } catch (err) {
    console.warn('[chat-filter] could not read filter file:', err);
    words = [];
  }
  return [...words];
}

export function getChatFilterWords(): string[] {
  return [...words];
}

export function saveChatFilterWords(raw: unknown): string[] {
  words = normalizeWords(raw);
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, `${JSON.stringify({ words }, null, 2)}\n`, 'utf8');
  return [...words];
}

/** Mask filtered words before a player message is posted. */
export function censorChatMessage(message: string): string {
  return censorWords(message, words);
}
