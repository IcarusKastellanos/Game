import type { PlayerStats } from '../types/index.js';
import { playerLevelFromExperience } from './level-curve.js';
import { getSpiritualReputation } from './reputation.js';
import { getRecognitionTier } from './recognition.js';
import type { PlayerProgression } from './index.js';

export type LicensureStatus = 'good' | 'warned' | 'revoked';

export interface LicensureMarkState {
  marks: number;
  markCapacity: number;
  status: LicensureStatus;
}

export interface ActiveVowState {
  vowId: string;
  acceptedAt: number;
}

export interface LicenseRequirements {
  minLevel?: number;
  minSpiritualRep?: number;
  minRecognition?: string;
  minSkills?: Record<string, number>;
  moralityMin?: number;
  moralityMax?: number;
}

export interface LicensePracticeRules {
  categories?: string[];
  /** Spells with moralEffect below this are forbidden (e.g. healers: 0). */
  minMoralEffect?: number;
  /** Spells with moralEffect above this are forbidden. */
  maxMoralEffect?: number;
}

export interface LicenseUnlocks {
  spellIds?: string[];
  spiritIds?: string[];
  npcIds?: string[];
  placeIds?: string[];
  storyFlags?: string[];
}

export interface LicenseVowDef {
  id: string;
  label: string;
  text: string;
}

export interface LicenseDef {
  id: string;
  label: string;
  examNpcId: string;
  fee: number;
  vowId: string;
  requirements: LicenseRequirements;
  markCapacity: number;
  warnAtMarks: number;
  revokeAtMarks: number;
  violationMarkCost: number;
  forbids: LicensePracticeRules;
  allows: LicensePracticeRules;
  /** Hexworkers etc.: multiply healing-category potency (default 1). */
  healingPotencyMultiplier?: number;
  unlocks: LicenseUnlocks;
}

export interface LicensesDocument {
  schemaVersion: number;
  vows: LicenseVowDef[];
  licenses: LicenseDef[];
}

const DEFAULT_DOC: LicensesDocument = {
  schemaVersion: 1,
  vows: [],
  licenses: [],
};

let documentState: LicensesDocument = { ...DEFAULT_DOC, vows: [], licenses: [] };

function asStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((v): v is string => typeof v === 'string' && v.length > 0))];
}

function num(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parsePracticeRules(raw: unknown): LicensePracticeRules {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  return {
    categories: asStringList(o.categories),
    minMoralEffect: num(o.minMoralEffect),
    maxMoralEffect: num(o.maxMoralEffect),
  };
}

function parseRequirements(raw: unknown): LicenseRequirements {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  const minSkills: Record<string, number> = {};
  if (o.minSkills && typeof o.minSkills === 'object') {
    for (const [k, v] of Object.entries(o.minSkills as Record<string, unknown>)) {
      const n = num(v);
      if (n != null) minSkills[k] = n;
    }
  }
  return {
    minLevel: num(o.minLevel),
    minSpiritualRep: num(o.minSpiritualRep),
    minRecognition: typeof o.minRecognition === 'string' ? o.minRecognition : undefined,
    minSkills,
    moralityMin: num(o.moralityMin),
    moralityMax: num(o.moralityMax),
  };
}

function parseUnlocks(raw: unknown): LicenseUnlocks {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  return {
    spellIds: asStringList(o.spellIds),
    spiritIds: asStringList(o.spiritIds),
    npcIds: asStringList(o.npcIds),
    placeIds: asStringList(o.placeIds),
    storyFlags: asStringList(o.storyFlags),
  };
}

export function normalizeLicensesDocument(raw: unknown): LicensesDocument {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_DOC, vows: [], licenses: [] };
  }
  const o = raw as Record<string, unknown>;
  const vows: LicenseVowDef[] = Array.isArray(o.vows)
    ? o.vows
        .map((row) => {
          if (!row || typeof row !== 'object') return null;
          const v = row as Record<string, unknown>;
          const id = typeof v.id === 'string' ? v.id : null;
          if (!id) return null;
          return {
            id,
            label: typeof v.label === 'string' && v.label.trim() ? v.label.trim() : id,
            text: typeof v.text === 'string' ? v.text : '',
          };
        })
        .filter((v): v is LicenseVowDef => v != null)
    : [];

  const licenses: LicenseDef[] = Array.isArray(o.licenses)
    ? o.licenses
        .map((row): LicenseDef | null => {
          if (!row || typeof row !== 'object') return null;
          const l = row as Record<string, unknown>;
          const id = typeof l.id === 'string' ? l.id : null;
          if (!id) return null;
          const markCapacity = Math.max(1, Math.round(num(l.markCapacity) ?? 10));
          const revokeAt = Math.max(0, Math.round(num(l.revokeAtMarks) ?? 0));
          const warnAt = Math.max(revokeAt, Math.round(num(l.warnAtMarks) ?? Math.ceil(markCapacity * 0.4)));
          const healingMult = num(l.healingPotencyMultiplier);
          const def: LicenseDef = {
            id,
            label: typeof l.label === 'string' && l.label.trim() ? l.label.trim() : id,
            examNpcId: typeof l.examNpcId === 'string' ? l.examNpcId : 'npc_council_clerk',
            fee: Math.max(0, Math.round(num(l.fee) ?? 0)),
            vowId: typeof l.vowId === 'string' ? l.vowId : '',
            requirements: parseRequirements(l.requirements),
            markCapacity,
            warnAtMarks: warnAt,
            revokeAtMarks: revokeAt,
            violationMarkCost: Math.max(1, Math.round(num(l.violationMarkCost) ?? 2)),
            forbids: parsePracticeRules(l.forbids),
            allows: parsePracticeRules(l.allows),
            unlocks: parseUnlocks(l.unlocks),
          };
          if (healingMult != null) def.healingPotencyMultiplier = healingMult;
          return def;
        })
        .filter((l): l is LicenseDef => l != null)
    : [];

  return { schemaVersion: 1, vows, licenses };
}

export function setLicensesContent(raw: unknown): void {
  documentState = normalizeLicensesDocument(raw);
}

export function getLicensesDocument(): LicensesDocument {
  return documentState;
}

export function getLicense(licenseId: string | null | undefined): LicenseDef | undefined {
  if (!licenseId) return undefined;
  return documentState.licenses.find((l) => l.id === licenseId);
}

export function getVow(vowId: string | null | undefined): LicenseVowDef | undefined {
  if (!vowId) return undefined;
  return documentState.vows.find((v) => v.id === vowId);
}

export function listLicenses(): LicenseDef[] {
  return documentState.licenses;
}

export function parseLicensureMarks(raw: unknown): Record<string, LicensureMarkState> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, LicensureMarkState> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const row = value as Record<string, unknown>;
    const capacity = Math.max(1, Math.round(num(row.markCapacity) ?? 10));
    const marks = Math.max(0, Math.min(capacity, Math.round(num(row.marks) ?? capacity)));
    const statusRaw = typeof row.status === 'string' ? row.status : 'good';
    const status: LicensureStatus =
      statusRaw === 'warned' || statusRaw === 'revoked' || statusRaw === 'good' ? statusRaw : 'good';
    out[id] = { marks, markCapacity: capacity, status };
  }
  return out;
}

export function parseActiveVows(raw: unknown): Record<string, ActiveVowState> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, ActiveVowState> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const row = value as Record<string, unknown>;
    const vowId = typeof row.vowId === 'string' ? row.vowId : null;
    const acceptedAt = num(row.acceptedAt);
    if (!vowId || acceptedAt == null) continue;
    out[id] = { vowId, acceptedAt };
  }
  return out;
}

function skillValue(stats: PlayerStats, key: string): number {
  const v = (stats as unknown as Record<string, unknown>)[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Holistic exam scan — level, recognition, spiritual rep, skills, morality. */
export function meetsLicenseExamRequirements(
  license: LicenseDef,
  stats: PlayerStats,
  progression: PlayerProgression
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const req = license.requirements;
  const level = playerLevelFromExperience(stats.experience ?? 0);
  if (req.minLevel != null && level < req.minLevel) {
    reasons.push(`Need Practitioner Level ${req.minLevel} (you are ${level}).`);
  }
  if (req.minSpiritualRep != null && getSpiritualReputation(stats) < req.minSpiritualRep) {
    reasons.push(`Need Spiritual Reputation ${req.minSpiritualRep}+.`);
  }
  if (req.minRecognition) {
    const need = getRecognitionTier(req.minRecognition);
    const have = getRecognitionTier(progression.recognitionTierId);
    if (!need || !have || have.rank < need.rank) {
      reasons.push(`Need recognition as ${need?.label ?? req.minRecognition} or higher.`);
    }
  }
  for (const [skill, need] of Object.entries(req.minSkills ?? {})) {
    if (skillValue(stats, skill) < need) {
      reasons.push(`Need ${skill} ${need}+.`);
    }
  }
  const morality = stats.morality ?? 0;
  if (req.moralityMin != null && morality < req.moralityMin) {
    reasons.push(`Morality too low for this credential (need ${req.moralityMin}+).`);
  }
  if (req.moralityMax != null && morality > req.moralityMax) {
    reasons.push(`Morality too high for this credential (max ${req.moralityMax}).`);
  }
  return { ok: reasons.length === 0, reasons };
}

/** Active (non-revoked) credential. */
export function holdsActiveLicense(progression: PlayerProgression, licenseId: string): boolean {
  if (!(progression.earnedLicenses ?? []).includes(licenseId)) return false;
  const marks = progression.licensureMarks?.[licenseId];
  if (marks?.status === 'revoked') return false;
  return true;
}

export function activeLicenseIds(progression: PlayerProgression): string[] {
  return (progression.earnedLicenses ?? []).filter((id) => holdsActiveLicense(progression, id));
}

export function licenseGateMessage(licenseId: string): string {
  const def = getLicense(licenseId);
  return def
    ? `Requires Magical Council credential: ${def.label}.`
    : `Requires Magical Council credential (${licenseId}).`;
}

/** Spell/content gate: requiresLicense and/or requiresAnyLicense. */
export function meetsSpellLicenseGate(
  gate: { requiresLicense?: string; requiresAnyLicense?: string[] } | null | undefined,
  progression: PlayerProgression
): boolean {
  if (!gate) return true;
  if (gate.requiresLicense && !holdsActiveLicense(progression, gate.requiresLicense)) return false;
  if (gate.requiresAnyLicense?.length) {
    if (!gate.requiresAnyLicense.some((id) => holdsActiveLicense(progression, id))) return false;
  }
  return true;
}

export function licenseUnlocksSpell(spellId: string, progression: PlayerProgression): boolean {
  const gated = new Set(
    documentState.licenses.flatMap((l) => l.unlocks.spellIds ?? [])
  );
  if (!gated.has(spellId)) return true;
  return activeLicenseIds(progression).some((id) => {
    const def = getLicense(id);
    return def?.unlocks.spellIds?.includes(spellId);
  });
}

export function licenseUnlocksNpc(npcId: string, progression: PlayerProgression): boolean {
  const gated = new Set(documentState.licenses.flatMap((l) => l.unlocks.npcIds ?? []));
  if (!gated.has(npcId)) return true;
  return activeLicenseIds(progression).some((id) => getLicense(id)?.unlocks.npcIds?.includes(npcId));
}

export function licenseUnlocksPlace(placeId: string, progression: PlayerProgression): boolean {
  const gated = new Set(documentState.licenses.flatMap((l) => l.unlocks.placeIds ?? []));
  if (!gated.has(placeId)) return true;
  return activeLicenseIds(progression).some((id) => getLicense(id)?.unlocks.placeIds?.includes(placeId));
}

export function licenseUnlocksSpirit(spiritId: string, progression: PlayerProgression): boolean {
  const gated = new Set(documentState.licenses.flatMap((l) => l.unlocks.spiritIds ?? []));
  if (!gated.has(spiritId)) return true;
  return activeLicenseIds(progression).some((id) => getLicense(id)?.unlocks.spiritIds?.includes(spiritId));
}

function categoryForbidden(rules: LicensePracticeRules, category: string): boolean {
  return (rules.categories ?? []).includes(category);
}

export interface VowViolation {
  licenseId: string;
  label: string;
  reason: string;
  markCost: number;
}

/**
 * Does casting this spell violate any active license vows?
 * Healers: baneful / forbidden categories. Hexworkers: full heal cast is a soft violation only if we treat it as blocked separately.
 */
export function findVowViolations(
  progression: PlayerProgression,
  spell: { category: string; moralEffect?: number; name?: string }
): VowViolation[] {
  const violations: VowViolation[] = [];
  for (const licenseId of activeLicenseIds(progression)) {
    const def = getLicense(licenseId);
    if (!def) continue;
    const reasons: string[] = [];
    if (categoryForbidden(def.forbids, spell.category)) {
      reasons.push(`${def.label} forbids ${spell.category} work`);
    }
    const moral = spell.moralEffect ?? 0;
    if (def.forbids.minMoralEffect != null && moral < def.forbids.minMoralEffect) {
      reasons.push(`${def.label} forbids baneful / harmful workings`);
    }
    if (def.forbids.maxMoralEffect != null && moral > def.forbids.maxMoralEffect) {
      reasons.push(`${def.label} forbids this moral polarity of work`);
    }
    if (reasons.length) {
      violations.push({
        licenseId,
        label: def.label,
        reason: reasons.join('; '),
        markCost: def.violationMarkCost,
      });
    }
  }
  return violations;
}

/** Potency multiplier from active hex-style licenses on healing spells. */
export function licenseHealingPotencyMultiplier(
  progression: PlayerProgression,
  spellCategory: string
): number {
  if (spellCategory !== 'healing') return 1;
  let mult = 1;
  for (const licenseId of activeLicenseIds(progression)) {
    const def = getLicense(licenseId);
    if (def?.healingPotencyMultiplier != null) {
      mult = Math.min(mult, def.healingPotencyMultiplier);
    }
  }
  return mult;
}

export interface IssueLicenseResult {
  progression: PlayerProgression;
  license: LicenseDef;
  alreadyHeld: boolean;
}

/** Grant credential, init marks pool, record vow, merge story flags. */
export function issueLicense(
  progression: PlayerProgression,
  licenseId: string,
  now = Date.now()
): IssueLicenseResult | null {
  const license = getLicense(licenseId);
  if (!license) return null;
  const alreadyHeld = holdsActiveLicense(progression, licenseId);
  const earned = new Set(progression.earnedLicenses ?? []);
  earned.add(licenseId);
  const licensureMarks = { ...(progression.licensureMarks ?? {}) };
  licensureMarks[licenseId] = {
    marks: license.markCapacity,
    markCapacity: license.markCapacity,
    status: 'good',
  };
  const activeVows = { ...(progression.activeVows ?? {}) };
  if (license.vowId) {
    activeVows[licenseId] = { vowId: license.vowId, acceptedAt: now };
  }
  const storyFlags = [
    ...new Set([...(progression.storyFlags ?? []), ...(license.unlocks.storyFlags ?? [])]),
  ];
  return {
    alreadyHeld,
    license,
    progression: {
      ...progression,
      earnedLicenses: [...earned],
      licensureMarks,
      activeVows,
      storyFlags,
    },
  };
}

export interface ApplyMarksResult {
  progression: PlayerProgression;
  licenseId: string;
  marksRemaining: number;
  status: LicensureStatus;
  warned: boolean;
  revoked: boolean;
  message: string;
}

/** Spend Licensure Marks for a vow violation; may warn or revoke. */
export function applyLicensureMarkPenalty(
  progression: PlayerProgression,
  licenseId: string,
  cost: number
): ApplyMarksResult | null {
  const def = getLicense(licenseId);
  if (!def) return null;
  const current = progression.licensureMarks?.[licenseId] ?? {
    marks: def.markCapacity,
    markCapacity: def.markCapacity,
    status: 'good' as LicensureStatus,
  };
  if (current.status === 'revoked') {
    return {
      progression,
      licenseId,
      marksRemaining: 0,
      status: 'revoked',
      warned: false,
      revoked: false,
      message: `${def.label} is already revoked.`,
    };
  }

  const marks = Math.max(0, current.marks - Math.max(1, cost));
  let status: LicensureStatus = current.status;
  let warned = false;
  let revoked = false;
  let message = `${def.label}: −${cost} Licensure Marks (${marks} remaining).`;

  if (marks <= def.revokeAtMarks) {
    status = 'revoked';
    revoked = true;
    message = `Magical Council: ${def.label} revoked. Re-examination required.`;
  } else if (marks <= def.warnAtMarks) {
    status = 'warned';
    warned = status !== current.status || marks <= def.warnAtMarks;
    message = `Magical Council warning: ${def.label} standing is strained (${marks} marks left).`;
  } else {
    status = 'good';
  }

  const licensureMarks = {
    ...(progression.licensureMarks ?? {}),
    [licenseId]: { marks, markCapacity: current.markCapacity, status },
  };

  let earnedLicenses = [...(progression.earnedLicenses ?? [])];
  let activeVows = { ...(progression.activeVows ?? {}) };
  if (revoked) {
    earnedLicenses = earnedLicenses.filter((id) => id !== licenseId);
    const { [licenseId]: _removed, ...restVows } = activeVows;
    activeVows = restVows;
  }

  return {
    progression: {
      ...progression,
      earnedLicenses,
      licensureMarks,
      activeVows,
    },
    licenseId,
    marksRemaining: marks,
    status,
    warned,
    revoked,
    message,
  };
}

/** Slow recovery for clean practice (optional §1.3b). */
export function recoverLicensureMarks(
  progression: PlayerProgression,
  licenseId: string,
  amount = 1
): PlayerProgression {
  const current = progression.licensureMarks?.[licenseId];
  if (!current || current.status === 'revoked') return progression;
  const marks = Math.min(current.markCapacity, current.marks + Math.max(1, amount));
  let status: LicensureStatus = current.status;
  const def = getLicense(licenseId);
  if (def && marks > def.warnAtMarks) status = 'good';
  return {
    ...progression,
    licensureMarks: {
      ...(progression.licensureMarks ?? {}),
      [licenseId]: { ...current, marks, status },
    },
  };
}

/** Reputation hit when a license is revoked. */
export function revocationReputationPenalty(): { public: number; spiritual: number } {
  return { public: -5, spiritual: -12 };
}
