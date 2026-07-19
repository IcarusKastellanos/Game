import {
  createDefaultHudLayout,
  validateHudLayout,
  HUD_SCHEMA_VERSION,
  type HudLayoutDocument,
  type HudLayoutMetadata,
  type HudLayoutRecord,
  type HudValidationResult,
} from '@witchcraft/shared';
import { prisma } from '../../../services/db.js';
import type { AuditContext } from '../../audit.js';
import { writeAuditLog } from '../../audit.js';

type HudLayoutRow = {
  id: string;
  name: string;
  status: string;
  version: number;
  isActive: boolean;
  document: unknown;
  createdBy: string | null;
  updatedBy: string | null;
  publishedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  currentVersionId?: string | null;
};

function rowToMeta(row: HudLayoutRow): HudLayoutMetadata {
  return {
    id: row.id,
    name: row.name,
    status: row.status as HudLayoutMetadata['status'],
    version: row.version,
    isActive: row.isActive,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function rowToRecord(row: HudLayoutRow): HudLayoutRecord {
  const doc = (row.document as HudLayoutDocument) ?? createDefaultHudLayout();
  return { metadata: rowToMeta(row), document: doc };
}

/** Ensure a default layout exists so the editor and engine always have a base. */
export async function ensureDefaultHudLayout(): Promise<void> {
  const count = await prisma.hudLayout.count();
  if (count > 0) return;
  const doc = createDefaultHudLayout();
  const row = await prisma.hudLayout.create({
    data: {
      id: doc.layoutId,
      name: doc.name,
      status: 'published',
      version: 1,
      isActive: true,
      document: doc as never,
      publishedAt: new Date(),
      createdBy: 'system',
      updatedBy: 'system',
    },
  });
  await prisma.hudLayoutVersion.create({
    data: { hudLayoutId: row.id, version: 1, document: doc as never, changelog: 'Initial default layout', createdBy: 'system' },
  });
}

export async function listHudLayouts(includeArchived = false): Promise<HudLayoutMetadata[]> {
  await ensureDefaultHudLayout().catch((err) => console.warn('[HudBuilder] ensureDefault:', err));
  const rows = (await prisma.hudLayout.findMany({
    where: includeArchived ? undefined : { status: { not: 'archived' } },
    orderBy: { updatedAt: 'desc' },
  })) as HudLayoutRow[];
  return rows.map(rowToMeta);
}

export async function getHudLayout(id: string): Promise<HudLayoutRecord | null> {
  const row = (await prisma.hudLayout.findUnique({ where: { id } })) as HudLayoutRow | null;
  if (!row) return null;
  return rowToRecord(row);
}

/** Public: the single active layout for the live game engine. */
export async function getActiveHudLayout(): Promise<HudLayoutDocument | null> {
  await ensureDefaultHudLayout().catch(() => undefined);

  // Prefer the layout flagged live (isActive), including draft saves on that layout.
  let row = (await prisma.hudLayout.findFirst({
    where: { isActive: true, status: { not: 'archived' } },
    orderBy: { updatedAt: 'desc' },
  })) as HudLayoutRow | null;

  if (!row) {
    row = (await prisma.hudLayout.findFirst({
      where: { status: 'published' },
      orderBy: { updatedAt: 'desc' },
    })) as HudLayoutRow | null;
  }

  if (!row) return null;
  return (row.document as HudLayoutDocument) ?? null;
}

function slugId(name: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'layout';
  return `${base}-${Date.now().toString(36)}`;
}

export async function createHudLayout(
  input: { name?: string; document?: HudLayoutDocument },
  adminUsername: string,
  audit: AuditContext
): Promise<HudLayoutRecord> {
  const name = input.name?.trim() || 'New HUD Layout';
  const doc = input.document ?? createDefaultHudLayout();
  const id = slugId(name);
  doc.layoutId = id;
  doc.name = name;
  doc.schemaVersion = HUD_SCHEMA_VERSION;
  const row = (await prisma.hudLayout.create({
    data: {
      id,
      name,
      status: 'draft',
      version: 1,
      isActive: false,
      document: doc as never,
      createdBy: adminUsername,
      updatedBy: adminUsername,
    },
  })) as HudLayoutRow;
  const version = await prisma.hudLayoutVersion.create({
    data: { hudLayoutId: id, version: 1, document: doc as never, changelog: 'Initial draft', createdBy: adminUsername },
  });
  await prisma.hudLayout.update({ where: { id }, data: { currentVersionId: version.id } });
  await writeAuditLog(audit, { action: 'hud.create', objectType: 'hud_layout', objectId: id, newValue: { name } });
  return rowToRecord(row);
}

export async function saveHudDraft(
  id: string,
  document: HudLayoutDocument,
  adminUsername: string,
  audit: AuditContext,
  changelog?: string
): Promise<HudLayoutRecord | null> {
  const existing = (await prisma.hudLayout.findUnique({ where: { id } })) as HudLayoutRow | null;
  if (!existing) return null;
  if (existing.status === 'archived') throw new Error('Cannot edit an archived layout.');

  const nextVersion = existing.version + 1;
  document.layoutId = id;
  document.schemaVersion = HUD_SCHEMA_VERSION;

  const version = await prisma.hudLayoutVersion.create({
    data: {
      hudLayoutId: id,
      version: nextVersion,
      document: document as never,
      changelog: changelog ?? `Draft save v${nextVersion}`,
      createdBy: adminUsername,
    },
  });
  const row = (await prisma.hudLayout.update({
    where: { id },
    data: {
      name: document.name ?? existing.name,
      version: nextVersion,
      // publishing a fresh draft demotes a published layout back to draft
      status: existing.status === 'published' ? 'published' : 'draft',
      document: document as never,
      updatedBy: adminUsername,
      currentVersionId: version.id,
    },
  })) as HudLayoutRow;
  await writeAuditLog(audit, { action: 'hud.draft.save', objectType: 'hud_layout', objectId: id, newValue: { version: nextVersion } });
  return rowToRecord(row);
}

export function validateHudLayoutDoc(document: HudLayoutDocument, strict = false): HudValidationResult {
  return validateHudLayout(document, { strict });
}

export async function publishHudLayout(
  id: string,
  adminUsername: string,
  audit: AuditContext,
  changelog?: string
): Promise<{ ok: true; metadata: HudLayoutMetadata; validation: HudValidationResult } | { ok: false; error: string; validation?: HudValidationResult }> {
  const record = await getHudLayout(id);
  if (!record) return { ok: false, error: 'Layout not found' };

  const validation = validateHudLayout(record.document, { strict: true });
  if (!validation.valid) return { ok: false, error: 'Validation failed', validation };

  // Only one active published layout at a time.
  await prisma.hudLayout.updateMany({ where: { isActive: true }, data: { isActive: false } });

  const row = (await prisma.hudLayout.update({
    where: { id },
    data: { status: 'published', isActive: true, publishedAt: new Date(), updatedBy: adminUsername },
  })) as HudLayoutRow;

  await writeAuditLog(audit, {
    action: 'hud.publish',
    objectType: 'hud_layout',
    objectId: id,
    newValue: { version: row.version },
    reason: changelog,
  });
  return { ok: true, metadata: rowToMeta(row), validation };
}

export async function renameHudLayout(id: string, name: string, adminUsername: string, audit: AuditContext): Promise<HudLayoutMetadata | null> {
  const existing = (await prisma.hudLayout.findUnique({ where: { id } })) as HudLayoutRow | null;
  if (!existing) return null;
  const doc = (existing.document as HudLayoutDocument) ?? createDefaultHudLayout();
  doc.name = name;
  const row = (await prisma.hudLayout.update({
    where: { id },
    data: { name, document: doc as never, updatedBy: adminUsername },
  })) as HudLayoutRow;
  await writeAuditLog(audit, { action: 'hud.rename', objectType: 'hud_layout', objectId: id, newValue: { name } });
  return rowToMeta(row);
}

export async function duplicateHudLayout(id: string, adminUsername: string, audit: AuditContext): Promise<HudLayoutRecord | null> {
  const record = await getHudLayout(id);
  if (!record) return null;
  const copy = await createHudLayout(
    { name: `${record.metadata.name} (Copy)`, document: JSON.parse(JSON.stringify(record.document)) as HudLayoutDocument },
    adminUsername,
    audit
  );
  return copy;
}

export async function archiveHudLayout(id: string, adminUsername: string, audit: AuditContext): Promise<HudLayoutMetadata | null> {
  const existing = (await prisma.hudLayout.findUnique({ where: { id } })) as HudLayoutRow | null;
  if (!existing) return null;
  const row = (await prisma.hudLayout.update({
    where: { id },
    data: { status: 'archived', isActive: false, archivedAt: new Date(), updatedBy: adminUsername },
  })) as HudLayoutRow;
  await writeAuditLog(audit, { action: 'hud.archive', objectType: 'hud_layout', objectId: id });
  return rowToMeta(row);
}

export async function restoreHudLayout(id: string, adminUsername: string, audit: AuditContext): Promise<HudLayoutMetadata | null> {
  const row = (await prisma.hudLayout.update({
    where: { id },
    data: { status: 'draft', archivedAt: null, updatedBy: adminUsername },
  })) as HudLayoutRow;
  await writeAuditLog(audit, { action: 'hud.restore', objectType: 'hud_layout', objectId: id });
  return rowToMeta(row);
}

export async function deleteHudLayout(id: string, audit: AuditContext): Promise<boolean> {
  const row = (await prisma.hudLayout.findUnique({ where: { id } })) as HudLayoutRow | null;
  if (!row) return false;
  if (row.isActive) throw new Error('Cannot delete the active published layout.');
  await prisma.hudLayout.update({ where: { id }, data: { currentVersionId: null } });
  await prisma.hudLayout.delete({ where: { id } });
  await writeAuditLog(audit, { action: 'hud.delete', objectType: 'hud_layout', objectId: id });
  return true;
}

export async function listHudVersions(id: string) {
  return prisma.hudLayoutVersion.findMany({
    where: { hudLayoutId: id },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, changelog: true, createdBy: true, createdAt: true },
  });
}

export async function restoreHudVersion(
  id: string,
  versionId: string,
  adminUsername: string,
  audit: AuditContext
): Promise<HudLayoutRecord | null> {
  const version = await prisma.hudLayoutVersion.findFirst({ where: { id: versionId, hudLayoutId: id } });
  if (!version) return null;
  const doc = version.document as unknown as HudLayoutDocument;
  const saved = await saveHudDraft(id, doc, adminUsername, audit, `Restore to v${version.version}`);
  await writeAuditLog(audit, { action: 'hud.restore-version', objectType: 'hud_layout', objectId: id, newValue: { version: version.version } });
  return saved;
}

export async function importHudLayout(
  document: HudLayoutDocument,
  adminUsername: string,
  audit: AuditContext,
  options: { replaceId?: string } = {}
): Promise<{ ok: true; record: HudLayoutRecord } | { ok: false; error: string; validation: HudValidationResult }> {
  const validation = validateHudLayout(document, { strict: false });
  if (!validation.valid) return { ok: false, error: 'Import validation failed', validation };

  if (options.replaceId) {
    const saved = await saveHudDraft(options.replaceId, document, adminUsername, audit, 'Imported JSON');
    if (!saved) return { ok: false, error: 'Layout not found', validation };
    await writeAuditLog(audit, { action: 'hud.import', objectType: 'hud_layout', objectId: options.replaceId });
    return { ok: true, record: saved };
  }
  const record = await createHudLayout({ name: document.name, document }, adminUsername, audit);
  await writeAuditLog(audit, { action: 'hud.import', objectType: 'hud_layout', objectId: record.metadata.id });
  return { ok: true, record };
}

/** Curated list of built-in HUD sprite assets available in the game client. */
export function listHudAssets(): { path: string; name: string; category: string }[] {
  const base = '/assets/hud/sprites';
  const entry = (file: string, name: string, category: string) => ({ path: `${base}/${file}`, name, category });
  return [
    entry('portrait_frame.png', 'Portrait Frame', 'player'),
    entry('bar_track_health.png', 'Health Track', 'status-bars'),
    entry('bar_track_magical_energy.png', 'Magical Energy Track', 'status-bars'),
    entry('bar_track_experience.png', 'Experience Track', 'status-bars'),
    entry('symbol_health.png', 'Health Symbol', 'status-bars'),
    entry('symbol_magnetic_energy.png', 'Energy Symbol', 'status-bars'),
    entry('symbol_experience.png', 'Experience Symbol', 'status-bars'),
    entry('intuition_eye.png', 'Intuition Meter — Eye', 'awareness'),
    entry('intuition_meter.png', 'Intuition Meter (legacy bar)', 'awareness'),
    entry('intuition_glow_dormant.png', 'Glow — Dormant', 'awareness'),
    entry('intuition_glow_faint.png', 'Glow — Faint', 'awareness'),
    entry('intuition_glow_aware.png', 'Glow — Aware', 'awareness'),
    entry('intuition_glow_strong.png', 'Glow — Strong', 'awareness'),
    entry('intuition_glow_overwhelming.png', 'Glow — Overwhelming', 'awareness'),
    entry('nav_bag.png', 'Nav — Bag', 'navigation'),
    entry('nav_grimoire.png', 'Nav — Grimoire', 'navigation'),
    entry('nav_spells.png', 'Nav — Spells', 'navigation'),
    entry('nav_social.png', 'Nav — Social', 'navigation'),
    entry('nav_coven.png', 'Nav — Coven', 'navigation'),
    entry('nav_teleport.png', 'Nav — Teleport', 'navigation'),
    entry('nav_map.png', 'Nav — Map', 'navigation'),
    entry('nav_settings.png', 'Nav — Settings', 'navigation'),
    entry('hotbar_frame.png', 'Hotbar Frame', 'inventory'),
    entry('resource_coin.png', 'Coin Counter', 'resources'),
    entry('resource_essence.png', 'Essence Counter', 'resources'),
    entry('resource_favor.png', 'Favor Counter', 'resources'),
    entry('reputation_counter.png', 'Reputation Counter', 'resources'),
  ];
}
