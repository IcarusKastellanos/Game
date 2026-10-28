import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cleanAuthoredGrimoireBody,
  cleanAuthoredGrimoireTitle,
  type GrimoireManuscriptMeta,
} from '@witchcraft/shared';

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../content/moderation/manuscripts.json');

export type ManuscriptStatus = 'active' | 'archived';

export interface ManuscriptRecord {
  pageId: string;
  title: string;
  body: string;
  authorName: string;
  authorPlayerId?: string;
  exportedAt: number;
  updatedAt: number;
  status: ManuscriptStatus;
  archivedAt?: number;
}

let records = new Map<string, ManuscriptRecord>();

function persist(): void {
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(
    FILE,
    `${JSON.stringify({ entries: [...records.values()] }, null, 2)}\n`,
    'utf8'
  );
}

export function loadManuscriptRegistry(): ManuscriptRecord[] {
  try {
    if (!existsSync(FILE)) {
      records = new Map();
      return [];
    }
    const parsed = JSON.parse(readFileSync(FILE, 'utf8')) as { entries?: unknown };
    const next = new Map<string, ManuscriptRecord>();
    if (Array.isArray(parsed.entries)) {
      for (const row of parsed.entries) {
        if (!row || typeof row !== 'object') continue;
        const o = row as Record<string, unknown>;
        const pageId = String(o.pageId ?? '').trim();
        if (!pageId) continue;
        const body = cleanAuthoredGrimoireBody(o.body);
        if (!body && o.status !== 'archived') continue;
        next.set(pageId, {
          pageId,
          title: cleanAuthoredGrimoireTitle(o.title),
          body,
          authorName: String(o.authorName ?? 'Someone').trim() || 'Someone',
          authorPlayerId: typeof o.authorPlayerId === 'string' ? o.authorPlayerId : undefined,
          exportedAt: typeof o.exportedAt === 'number' ? o.exportedAt : Date.now(),
          updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : Date.now(),
          status: o.status === 'archived' ? 'archived' : 'active',
          archivedAt: typeof o.archivedAt === 'number' ? o.archivedAt : undefined,
        });
      }
    }
    records = next;
  } catch (err) {
    console.warn('[manuscripts] could not read registry:', err);
    records = new Map();
  }
  return [...records.values()];
}

export function listManuscriptRecords(includeArchived = false): ManuscriptRecord[] {
  if (!records.size && existsSync(FILE)) loadManuscriptRegistry();
  return [...records.values()]
    .filter((row) => includeArchived || row.status === 'active')
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getManuscriptRecord(pageId: string): ManuscriptRecord | undefined {
  if (!records.size && existsSync(FILE)) loadManuscriptRegistry();
  return records.get(pageId);
}

export function isManuscriptArchived(pageId: string): boolean {
  return getManuscriptRecord(pageId)?.status === 'archived';
}

export function registerManuscriptExport(
  meta: GrimoireManuscriptMeta,
  authorPlayerId?: string
): ManuscriptRecord {
  if (!records.size && existsSync(FILE)) loadManuscriptRegistry();
  const pageId = meta.manuscriptPageId;
  const existing = records.get(pageId);
  const now = Date.now();
  const next: ManuscriptRecord = {
    pageId,
    title: meta.manuscriptTitle,
    body: meta.manuscriptBody,
    authorName: meta.manuscriptAuthor,
    authorPlayerId: authorPlayerId || meta.manuscriptAuthorId || existing?.authorPlayerId,
    exportedAt: existing?.exportedAt ?? meta.manuscriptAuthoredAt ?? now,
    updatedAt: now,
    status: 'active',
  };
  records.set(pageId, next);
  persist();
  return next;
}

export function upsertManuscriptRecord(draft: {
  pageId: string;
  title: string;
  body: string;
  authorName?: string;
  authorPlayerId?: string;
  exportedAt?: number;
  status?: ManuscriptStatus;
}): ManuscriptRecord {
  if (!records.size && existsSync(FILE)) loadManuscriptRegistry();
  const existing = records.get(draft.pageId);
  const now = Date.now();
  const next: ManuscriptRecord = {
    pageId: draft.pageId,
    title: cleanAuthoredGrimoireTitle(draft.title),
    body: cleanAuthoredGrimoireBody(draft.body),
    authorName: (draft.authorName ?? existing?.authorName ?? 'Someone').trim() || 'Someone',
    authorPlayerId: draft.authorPlayerId ?? existing?.authorPlayerId,
    exportedAt: draft.exportedAt ?? existing?.exportedAt ?? now,
    updatedAt: now,
    status: draft.status ?? existing?.status ?? 'active',
    archivedAt: draft.status === 'archived' ? now : existing?.archivedAt,
  };
  records.set(draft.pageId, next);
  persist();
  return next;
}

export function updateManuscriptRecord(
  pageId: string,
  title: string,
  body: string
): ManuscriptRecord | null {
  if (!records.size && existsSync(FILE)) loadManuscriptRegistry();
  const existing = records.get(pageId);
  if (!existing || existing.status === 'archived') return null;
  const next: ManuscriptRecord = {
    ...existing,
    title: cleanAuthoredGrimoireTitle(title),
    body: cleanAuthoredGrimoireBody(body),
    updatedAt: Date.now(),
  };
  records.set(pageId, next);
  persist();
  return next;
}

export function archiveManuscriptRecord(pageId: string): ManuscriptRecord | null {
  if (!records.size && existsSync(FILE)) loadManuscriptRegistry();
  const existing = records.get(pageId);
  if (!existing) return null;
  const next: ManuscriptRecord = {
    ...existing,
    status: 'archived',
    archivedAt: Date.now(),
    updatedAt: Date.now(),
  };
  records.set(pageId, next);
  persist();
  return next;
}
