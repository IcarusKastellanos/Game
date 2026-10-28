#!/usr/bin/env node
/**
 * Ensures .env exists and uses the universal Docker Postgres DATABASE_URL.
 * Same credentials on every machine — do not customize per OS user.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
const examplePath = join(root, '.env.example');

/** Must match docker-compose.yml (POSTGRES_USER / PASSWORD / DB). */
export const UNIVERSAL_DATABASE_URL =
  'postgresql://postgres:postgres@localhost:5432/witchcraft_sim?schema=public';

export function ensureEnv() {
  if (!existsSync(examplePath)) {
    console.error('[ensure-env] Missing .env.example');
    process.exit(1);
  }

  if (!existsSync(envPath)) {
    copyFileSync(examplePath, envPath);
    console.log('[ensure-env] Created .env from .env.example');
  }

  let contents = readFileSync(envPath, 'utf8');
  const line = `DATABASE_URL="${UNIVERSAL_DATABASE_URL}"`;

  if (/^DATABASE_URL=/m.test(contents)) {
    contents = contents.replace(/^DATABASE_URL=.*$/m, line);
  } else {
    contents = `${line}\n${contents}`;
  }

  writeFileSync(envPath, contents);
  console.log(`[ensure-env] DATABASE_URL → ${UNIVERSAL_DATABASE_URL}`);
  console.log('[ensure-env] Start Postgres with: npm run db:up');
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  ensureEnv();
}
