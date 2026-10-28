#!/usr/bin/env node
/**
 * Waits until the universal Docker Postgres accepts TCP connections.
 */
import net from 'node:net';
import { UNIVERSAL_DATABASE_URL } from './ensure-env.mjs';

const url = new URL(UNIVERSAL_DATABASE_URL.replace('?schema=public', ''));
const host = url.hostname || 'localhost';
const port = Number(url.port || 5432);
const timeoutMs = 60_000;
const started = Date.now();

function tryConnect() {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

while (Date.now() - started < timeoutMs) {
  if (await tryConnect()) {
    console.log(`[wait-for-db] Postgres ready at ${host}:${port}`);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 500));
}

console.error(
  `[wait-for-db] Timed out waiting for Postgres at ${host}:${port}.\n` +
    'Make sure Docker Desktop is running, then: npm run db:up\n' +
    'If Homebrew Postgres is bound to 5432, stop it: brew services stop postgresql@16',
);
process.exit(1);
