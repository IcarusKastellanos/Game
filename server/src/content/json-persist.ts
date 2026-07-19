import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CONTENT_DIR = resolve(__dirname, '../../../content');

export function readContentJson<T>(filename: string): T[] {
  const path = resolve(CONTENT_DIR, filename);
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, 'utf-8')) as T[];
}

export function writeContentJson<T>(filename: string, data: T[]): void {
  const path = resolve(CONTENT_DIR, filename);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}
