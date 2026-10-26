import type { MagicTradition, PlayerStats } from '../types/index.js';
import { playerLevelFromExperience } from './level-curve.js';
import { getSpiritualReputation } from './reputation.js';
import type { PlayerProgression } from './index.js';

export interface RecognitionRequirements {
  minLevel?: number;
  minSpiritualRep?: number;
  questsCompleted?: string[];
  licenses?: string[];
  npcRelationships?: Record<string, number>;
  traditionAffinity?: Partial<Record<MagicTradition, number>>;
}

export interface RecognitionUnlocks {
  vendors?: string[];
  teachers?: string[];
  rituals?: string[];
  organizations?: string[];
  storyFlags?: string[];
}

export interface RecognitionTierDef {
  id: string;
  label: string;
  /** Higher rank wins when multiple tiers are met. Ties prefer listed order. */
  rank: number;
  requirements: RecognitionRequirements;
  unlocks: RecognitionUnlocks;
}

export interface RecognitionLicenseDef {
  id: string;
  label: string;
}

export interface RecognitionDocument {
  schemaVersion: number;
  defaultTierId: string;
  tiers: RecognitionTierDef[];
  licenses: RecognitionLicenseDef[];
}

const DEFAULT_DOC: RecognitionDocument = {
  schemaVersion: 1,
  defaultTierId: 'initiate',
  tiers: [
    {
      id: 'initiate',
      label: 'Initiate',
      rank: 0,
      requirements: {},
      unlocks: { storyFlags: ['recognition_initiate'] },
    },
  ],
  licenses: [],
};

let documentState: RecognitionDocument = {
  ...DEFAULT_DOC,
  tiers: [...DEFAULT_DOC.tiers],
  licenses: [],
};

function asStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((v): v is string => typeof v === 'string' && v.length > 0))];
}

function num(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseRequirements(raw: unknown): RecognitionRequirements {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  const npcRelationships: Record<string, number> = {};
  if (o.npcRelationships && typeof o.npcRelationships === 'object') {
    for (const [id, value] of Object.entries(o.npcRelationships as Record<string, unknown>)) {
      const n = num(value);
      if (n != null) npcRelationships[id] = n;
    }
  }
  const traditionAffinity: Partial<Record<MagicTradition, number>> = {};
  if (o.traditionAffinity && typeof o.traditionAffinity === 'object') {
    for (const [id, value] of Object.entries(o.traditionAffinity as Record<string, unknown>)) {
      const n = num(value);
      if (n != null) traditionAffinity[id as MagicTradition] = n;
    }
  }
  return {
    minLevel: num(o.minLevel),
    minSpiritualRep: num(o.minSpiritualRep),
    questsCompleted: asStringList(o.questsCompleted),
    licenses: asStringList(o.licenses),
    npcRelationships,
    traditionAffinity,
  };
}

function parseUnlocks(raw: unknown): RecognitionUnlocks {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  return {
    vendors: asStringList(o.vendors),
    teachers: asStringList(o.teachers),
    rituals: asStringList(o.rituals),
    organizations: asStringList(o.organizations),
    storyFlags: asStringList(o.storyFlags),
  };
}

export function normalizeRecognitionDocument(raw: unknown): RecognitionDocument {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_DOC, tiers: [...DEFAULT_DOC.tiers], licenses: [] };
  }
  const o = raw as Record<string, unknown>;
  const tiersRaw = Array.isArray(o.tiers) ? o.tiers : [];
  const tiers: RecognitionTierDef[] = tiersRaw
    .map((row, index) => {
      if (!row || typeof row !== 'object') return null;
      const t = row as Record<string, unknown>;
      const id = typeof t.id === 'string' && t.id ? t.id : `tier_${index}`;
      return {
        id,
        label: typeof t.label === 'string' && t.label.trim() ? t.label.trim() : id,
        rank: Math.max(0, Math.round(num(t.rank) ?? index)),
        requirements: parseRequirements(t.requirements),
        unlocks: parseUnlocks(t.unlocks),
      };
    })
    .filter((t): t is RecognitionTierDef => t != null);

  const licenses: RecognitionLicenseDef[] = Array.isArray(o.licenses)
    ? o.licenses
        .map((row) => {
          if (!row || typeof row !== 'object') return null;
          const l = row as Record<string, unknown>;
          const id = typeof l.id === 'string' ? l.id : null;
          if (!id) return null;
          return {
            id,
            label: typeof l.label === 'string' && l.label.trim() ? l.label.trim() : id,
          };
        })
        .filter((l): l is RecognitionLicenseDef => l != null)
    : [];

  const defaultTierId =
    typeof o.defaultTierId === 'string' && tiers.some((t) => t.id === o.defaultTierId)
      ? o.defaultTierId
      : tiers[0]?.id ?? DEFAULT_DOC.defaultTierId;

  return {
    schemaVersion: 1,
    defaultTierId,
    tiers: tiers.length ? tiers : [...DEFAULT_DOC.tiers],
    licenses,
  };
}

export function setRecognitionContent(raw: unknown): void {
  documentState = normalizeRecognitionDocument(raw);
}

export function getRecognitionDocument(): RecognitionDocument {
  return documentState;
}

export function getRecognitionTier(tierId: string | null | undefined): RecognitionTierDef | undefined {
  if (!tierId) return undefined;
  return documentState.tiers.find((t) => t.id === tierId);
}

export function getRecognitionTierLabel(tierId: string | null | undefined): string {
  return getRecognitionTier(tierId)?.label ?? 'Initiate';
}

export function listRecognitionLicenses(): RecognitionLicenseDef[] {
  return documentState.licenses;
}

export function hasLicense(progression: PlayerProgression, licenseId: string): boolean {
  if (!(progression.earnedLicenses ?? []).includes(licenseId)) return false;
  const marks = progression.licensureMarks?.[licenseId];
  if (marks?.status === 'revoked') return false;
  return true;
}

export function grantLicenses(
  progression: PlayerProgression,
  licenseIds: string[]
): PlayerProgression {
  if (!licenseIds.length) return progression;
  const set = new Set(progression.earnedLicenses ?? []);
  for (const id of licenseIds) {
    if (id) set.add(id);
  }
  return { ...progression, earnedLicenses: [...set] };
}

export function meetsRecognitionRequirements(
  requirements: RecognitionRequirements,
  stats: PlayerStats,
  progression: PlayerProgression
): boolean {
  const level = playerLevelFromExperience(stats.experience ?? 0);
  if (requirements.minLevel != null && level < requirements.minLevel) return false;
  if (
    requirements.minSpiritualRep != null &&
    getSpiritualReputation(stats) < requirements.minSpiritualRep
  ) {
    return false;
  }
  for (const questId of requirements.questsCompleted ?? []) {
    if (!progression.questProgress[questId]?.completedAt) return false;
  }
  for (const licenseId of requirements.licenses ?? []) {
    if (!hasLicense(progression, licenseId)) return false;
  }
  for (const [npcId, need] of Object.entries(requirements.npcRelationships ?? {})) {
    if ((progression.npcRelationships[npcId] ?? 0) < need) return false;
  }
  for (const [tradition, need] of Object.entries(requirements.traditionAffinity ?? {})) {
    if ((stats.affinities?.[tradition as MagicTradition] ?? 0) < need) return false;
  }
  return true;
}

/** Merge unlocks from every tier at or below the current tier's rank. */
export function getRecognitionUnlocks(progression: PlayerProgression): RecognitionUnlocks {
  const current = getRecognitionTier(progression.recognitionTierId) ?? documentState.tiers[0];
  const rank = current?.rank ?? 0;
  const merged: RecognitionUnlocks = {
    vendors: [],
    teachers: [],
    rituals: [],
    organizations: [],
    storyFlags: [],
  };
  for (const tier of documentState.tiers) {
    if (tier.rank > rank) continue;
    // Same-rank sibling branches (e.g. warder vs healer): only merge the earned tier.
    if (tier.rank === rank && current && tier.id !== current.id) continue;
    for (const key of ['vendors', 'teachers', 'rituals', 'organizations', 'storyFlags'] as const) {
      const list = tier.unlocks[key] ?? [];
      merged[key] = [...new Set([...(merged[key] ?? []), ...list])];
    }
  }
  return merged;
}

export function recognitionUnlocksVendor(shopId: string, progression: PlayerProgression): boolean {
  const vendors = getRecognitionUnlocks(progression).vendors ?? [];
  if (!vendors.length) return true; // no vendor gates configured → open
  // If any tier unlocks vendors at all, only listed shops are gated; unlisted stay open.
  // Shops explicitly listed on a higher tier than earned are blocked.
  const gated = new Set(
    documentState.tiers.flatMap((t) => t.unlocks.vendors ?? [])
  );
  if (!gated.has(shopId)) return true;
  return vendors.includes(shopId);
}

export function recognitionUnlocksTeacher(npcId: string, progression: PlayerProgression): boolean {
  const teachers = getRecognitionUnlocks(progression).teachers ?? [];
  const gated = new Set(documentState.tiers.flatMap((t) => t.unlocks.teachers ?? []));
  if (!gated.has(npcId)) return true;
  return teachers.includes(npcId);
}

export interface DialogueRecognitionGate {
  requiresRecognition?: string;
  requiresLicense?: string;
  requiresAnyLicense?: string[];
}

/** Whether a dialogue choice/node gate is satisfied. */
export function meetsDialogueRecognitionGate(
  gate: DialogueRecognitionGate | null | undefined,
  progression: PlayerProgression
): boolean {
  if (!gate) return true;
  if (gate.requiresLicense && !hasLicense(progression, gate.requiresLicense)) return false;
  if (gate.requiresAnyLicense?.length) {
    if (!gate.requiresAnyLicense.some((id) => hasLicense(progression, id))) return false;
  }
  if (gate.requiresRecognition) {
    const need = getRecognitionTier(gate.requiresRecognition);
    const have = getRecognitionTier(progression.recognitionTierId);
    if (!need) return false;
    if (!have) return false;
    if (have.rank < need.rank) return false;
    // Same rank different branch (warder vs healer): require exact id or higher rank
    if (have.rank === need.rank && have.id !== need.id) return false;
  }
  return true;
}

export interface EvaluateRecognitionResult {
  progression: PlayerProgression;
  tier: RecognitionTierDef;
  previousTierId: string | null;
  changed: boolean;
}

/**
 * Pick the highest-rank tier whose requirements the practitioner meets.
 * Same-rank ties keep the first listed tier that qualifies (stable content order).
 */
export function evaluateRecognition(
  stats: PlayerStats,
  progression: PlayerProgression
): EvaluateRecognitionResult {
  const previousTierId = progression.recognitionTierId ?? null;
  const qualified = documentState.tiers.filter((tier) =>
    meetsRecognitionRequirements(tier.requirements, stats, progression)
  );
  let best: RecognitionTierDef | undefined;
  for (const tier of qualified) {
    if (!best || tier.rank > best.rank) best = tier;
  }
  if (!best) {
    best =
      getRecognitionTier(documentState.defaultTierId) ??
      documentState.tiers[0] ??
      DEFAULT_DOC.tiers[0];
  }

  const unlocks = getRecognitionUnlocks({ ...progression, recognitionTierId: best.id });
  const storyFlags = [...new Set([...(progression.storyFlags ?? []), ...(unlocks.storyFlags ?? [])])];

  const next: PlayerProgression = {
    ...progression,
    recognitionTierId: best.id,
    recognitionTierLabel: best.label,
    earnedLicenses: [...(progression.earnedLicenses ?? [])],
    storyFlags,
  };

  return {
    progression: next,
    tier: best,
    previousTierId,
    changed: previousTierId !== best.id,
  };
}
