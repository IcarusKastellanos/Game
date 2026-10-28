import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { CONTENT_DIR } from './json-persist.js';

export const CONTENT_REVISION_FILE = 'content-revisions.json';

type RevisionBook = Record<string, Record<string, number>>;

export class ContentSaveError extends Error {
  status: 400 | 409 | 500;
  revision?: number;

  constructor(message: string, status: 400 | 409 | 500, revision?: number) {
    super(message);
    this.name = 'ContentSaveError';
    this.status = status;
    this.revision = revision;
  }
}

export function contentRevision(bucket: string, id: string, directory = CONTENT_DIR): number {
  return readBook(directory)[bucket]?.[id] ?? 0;
}

/**
 * Replace a JSON array and bump one revision key.
 * The content file is restored if the revision file cannot be written.
 */
export function writeVersionedCollection(options: {
  directory?: string;
  filename: string;
  bucket: string;
  id: string;
  expectedRevision: number;
  records: unknown[];
  /** Test hook. Throws after the content file is replaced and before the revision file. */
  fault?: 'revision';
}): { revision: number } {
  if (!Number.isInteger(options.expectedRevision) || options.expectedRevision < 0) {
    throw new ContentSaveError('A revision number is required.', 400);
  }
  const directory = options.directory ?? CONTENT_DIR;
  const book = readBook(directory);
  const current = book[options.bucket]?.[options.id] ?? 0;
  if (current !== options.expectedRevision) {
    throw new ContentSaveError('This record changed since you opened it. Reload and edit again.', 409, current);
  }
  const nextRevision = current + 1;
  const nextBook: RevisionBook = {
    ...book,
    [options.bucket]: { ...(book[options.bucket] ?? {}), [options.id]: nextRevision },
  };
  const contentPath = resolve(directory, options.filename);
  const revisionPath = resolve(directory, CONTENT_REVISION_FILE);
  const previousContent = existsSync(contentPath) ? readFileSync(contentPath, 'utf-8') : null;
  atomicWrite(contentPath, `${JSON.stringify(options.records, null, 2)}\n`);
  try {
    if (options.fault === 'revision') {
      throw new Error('revision write failed');
    }
    atomicWrite(revisionPath, `${JSON.stringify(nextBook, null, 2)}\n`);
  } catch (error) {
    if (previousContent == null) unlinkQuiet(contentPath);
    else atomicWrite(contentPath, previousContent);
    const message = error instanceof Error ? error.message : 'Revision file failed.';
    throw new ContentSaveError(`The save was not kept. ${message}`, 500);
  }
  return { revision: nextRevision };
}

/**
 * Replace a JSON object (or wrapped document) and bump one revision key.
 * Same optimistic concurrency and restore rules as {@link writeVersionedCollection}.
 */
export function writeVersionedDocument(options: {
  directory?: string;
  filename: string;
  bucket: string;
  id: string;
  expectedRevision: number;
  document: unknown;
  fault?: 'revision';
}): { revision: number } {
  if (!Number.isInteger(options.expectedRevision) || options.expectedRevision < 0) {
    throw new ContentSaveError('A revision number is required.', 400);
  }
  const directory = options.directory ?? CONTENT_DIR;
  const book = readBook(directory);
  const current = book[options.bucket]?.[options.id] ?? 0;
  if (current !== options.expectedRevision) {
    throw new ContentSaveError('This record changed since you opened it. Reload and edit again.', 409, current);
  }
  const nextRevision = current + 1;
  const nextBook: RevisionBook = {
    ...book,
    [options.bucket]: { ...(book[options.bucket] ?? {}), [options.id]: nextRevision },
  };
  const contentPath = resolve(directory, options.filename);
  const revisionPath = resolve(directory, CONTENT_REVISION_FILE);
  const previousContent = existsSync(contentPath) ? readFileSync(contentPath, 'utf-8') : null;
  atomicWrite(contentPath, `${JSON.stringify(options.document, null, 2)}\n`);
  try {
    if (options.fault === 'revision') {
      throw new Error('revision write failed');
    }
    atomicWrite(revisionPath, `${JSON.stringify(nextBook, null, 2)}\n`);
  } catch (error) {
    if (previousContent == null) unlinkQuiet(contentPath);
    else atomicWrite(contentPath, previousContent);
    const message = error instanceof Error ? error.message : 'Revision file failed.';
    throw new ContentSaveError(`The save was not kept. ${message}`, 500);
  }
  return { revision: nextRevision };
}

function readBook(directory: string): RevisionBook {
  const path = resolve(directory, CONTENT_REVISION_FILE);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as RevisionBook;
  } catch {
    return {};
  }
}

function atomicWrite(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  const fd = openSync(temp, 'w');
  try {
    writeSync(fd, contents);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
}

function unlinkQuiet(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // The failed save already has nothing durable to restore.
  }
}
