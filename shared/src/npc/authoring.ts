/**
 * NPC authoring validation and schema notes for designers.
 *
 * Intended use:
 * - `validateNpcAuthoring` before saving an NPC definition.
 * - `validateKnowledgeAuthoring` before saving discovery/rumor content.
 * - `validateSocialNpcProfile` before saving relationship UI feedback.
 * - Client builds must use `toClientNpc` — never raw ContentNpc.
 *
 * Visibility tiers:
 * - public: role, name, biography catalog text, resting place summary
 * - discoverable: knowledge entries, likes, deeper locations, topics
 * - relationship-dependent: uiFeedback signals, gift windows, stage labels
 * - private/server-only: secrets, personality scores, affinity numbers, schedule overrides
 */

import type { ContentNpc, NpcCapability } from '../types/index.js';
import { validateNpcDefinition } from '../dialogue/index.js';
import {
  validateKnowledgeDocument,
  type KnowledgeDocument,
  type KnowledgeEntry,
} from './knowledge.js';
import type { NpcSocialProfile, NpcUiFeedback } from '../social/index.js';
import { CLIENT_NPC_FORBIDDEN_KEYS } from './client-export.js';

export interface AuthoringDiagnostic {
  level: 'error' | 'warn';
  path: string;
  message: string;
}

export interface AuthoringValidation {
  ok: boolean;
  diagnostics: AuthoringDiagnostic[];
  npc?: ContentNpc;
}

export interface KnowledgeAuthoringValidation {
  ok: boolean;
  diagnostics: AuthoringDiagnostic[];
  document?: KnowledgeDocument;
}

export const NPC_CONFIG_SCHEMA = {
  identity: {
    id: 'stable string; never rename casually',
    name: 'player-facing display name',
    role: 'public catalog role',
    biography: 'optional public catalog bio (People page once met)',
    locationId: 'home / resting place id from npc places',
    dialogueTreeId: 'dialogue document id',
    shopId: 'optional shop id for trade capability',
    spritePixels: 'optional 32×32 painted portrait (People UI); overworld uses walk/idle sheets',
    visual: 'optional procedural palette/silhouette override',
    spriteSheet:
      'optional authored 32×48 walk (4×8 / 128×384) and/or idle (2×8 / 64×384) override; preferred over procedural',
  },
  schedule: {
    rows: 'hour windows with place, activity, interaction open|busy|away',
    scheduleOverride: 'server-only temporary absence / quest appearance control',
  },
  services: {
    capabilities: 'optional explicit talk/trade/quests/gift/favor/train/rumors/goodbye',
    conversationPolicy: 'exclusive | concurrent_personal | shared_public',
  },
  relationship: {
    personality: 'server-only soft traits 0–100; never bypass gates',
    uiFeedback: 'designer toggles for stage/regard/demeanor/milestones/gift/services/schedule',
    giftPreferences: 'social document; visibility public|hinted|hidden',
  },
  discovery: {
    knowledgeEntries: 'rumors/clues with reveal gates, triggers, conflicts, npcFact fields',
    lessons:
      'teacher unlocks; optional requiresTraditionAffinity / requiresSpiritualReputation / requiresRecognition gates',
  },
  clientExport: {
    forbidden: CLIENT_NPC_FORBIDDEN_KEYS,
    note: 'Use toClientNpc() for /api/content/all and any player bootstrap.',
  },
} as const;

export function validateNpcAuthoring(
  value: unknown,
  id: string,
  ctx: {
    placeIds?: readonly string[];
    shopIds?: ReadonlySet<string>;
    dialogueNodeIds?: ReadonlySet<string>;
    dialogueTreeIds?: ReadonlySet<string>;
  } = {}
): AuthoringValidation {
  const diagnostics: AuthoringDiagnostic[] = [];
  const parsed = validateNpcDefinition(value, id, ctx.placeIds);
  if (!parsed.ok) {
    return { ok: false, diagnostics: [{ level: 'error', path: 'npc', message: parsed.error }] };
  }
  const npc = parsed.npc;

  if (ctx.dialogueTreeIds && !ctx.dialogueTreeIds.has(npc.dialogueTreeId)) {
    diagnostics.push({
      level: 'warn',
      path: 'dialogueTreeId',
      message: `Dialogue tree "${npc.dialogueTreeId}" is not in the loaded dialogues yet.`,
    });
  }
  if (npc.shopId && ctx.shopIds && !ctx.shopIds.has(npc.shopId)) {
    diagnostics.push({
      level: 'error',
      path: 'shopId',
      message: `Shop "${npc.shopId}" does not exist.`,
    });
  }
  for (const [index, capability] of (npc.capabilities ?? []).entries()) {
    diagnostics.push(...capabilityDiagnostics(capability, index, npc, ctx));
  }
  if (npc.scheduleOverride?.active && !npc.scheduleOverride.locationId) {
    diagnostics.push({
      level: 'error',
      path: 'scheduleOverride.locationId',
      message: 'An active schedule override needs a place.',
    });
  }
  if (npc.secrets?.length) {
    diagnostics.push({
      level: 'warn',
      path: 'secrets',
      message: 'Secrets stay server-only and are stripped from client exports.',
    });
  }

  return {
    ok: !diagnostics.some((row) => row.level === 'error'),
    diagnostics,
    npc,
  };
}

export function validateKnowledgeAuthoring(
  value: unknown,
  ctx: {
    npcIds?: ReadonlySet<string>;
    questIds?: ReadonlySet<string>;
    lessonIds?: ReadonlySet<string>;
  } = {}
): KnowledgeAuthoringValidation {
  const diagnostics: AuthoringDiagnostic[] = [];
  const parsed = validateKnowledgeDocument(value);
  if (!parsed.ok) {
    return { ok: false, diagnostics: [{ level: 'error', path: 'knowledge', message: parsed.error }] };
  }
  const ids = new Set(parsed.document.entries.map((entry) => entry.id));
  for (const entry of parsed.document.entries) {
    diagnostics.push(...knowledgeEntryDiagnostics(entry, ids, ctx));
  }
  return {
    ok: !diagnostics.some((row) => row.level === 'error'),
    diagnostics,
    document: parsed.document,
  };
}

export function validateSocialNpcProfile(
  npcId: string,
  profile: NpcSocialProfile | undefined
): AuthoringDiagnostic[] {
  const diagnostics: AuthoringDiagnostic[] = [];
  if (!profile) return diagnostics;
  const ui = profile.uiFeedback;
  if (ui) diagnostics.push(...uiFeedbackDiagnostics(npcId, ui));
  for (const pref of profile.giftPreferences ?? []) {
    if (pref.visibility === 'hidden' && !pref.discoveredLine && !pref.hint) {
      diagnostics.push({
        level: 'warn',
        path: `npcs.${npcId}.giftPreferences.${pref.id}`,
        message: 'Hidden preference has no discoveredLine or hint for players who learn it.',
      });
    }
    if (pref.visibility === 'public' && !pref.publicLine && !pref.hint) {
      diagnostics.push({
        level: 'warn',
        path: `npcs.${npcId}.giftPreferences.${pref.id}`,
        message: 'Public preference should include a publicLine or hint.',
      });
    }
  }
  if (profile.shopDiscount) {
    if (!(profile.shopDiscount.multiplier > 0 && profile.shopDiscount.multiplier <= 1)) {
      diagnostics.push({
        level: 'error',
        path: `npcs.${npcId}.shopDiscount.multiplier`,
        message: 'Shop discount multiplier must be between 0 and 1.',
      });
    }
  }
  return diagnostics;
}

export function defaultUiFeedback(): Required<NpcUiFeedback> {
  return {
    showStage: true,
    showRegard: true,
    showDemeanor: true,
    showMilestones: true,
    showGiftSummary: true,
    showServices: true,
    showSchedule: true,
  };
}

function capabilityDiagnostics(
  capability: NpcCapability,
  index: number,
  npc: ContentNpc,
  ctx: { shopIds?: ReadonlySet<string>; dialogueNodeIds?: ReadonlySet<string> }
): AuthoringDiagnostic[] {
  const path = `capabilities[${index}]`;
  const out: AuthoringDiagnostic[] = [];
  if (capability.action === 'trade') {
    const shopId = capability.shopId || npc.shopId;
    if (!shopId) {
      out.push({ level: 'error', path, message: 'Trade capability needs a shopId on the capability or NPC.' });
    } else if (ctx.shopIds && !ctx.shopIds.has(shopId)) {
      out.push({ level: 'error', path: `${path}.shopId`, message: `Shop "${shopId}" does not exist.` });
    }
  }
  if (capability.nodeId && ctx.dialogueNodeIds && !ctx.dialogueNodeIds.has(capability.nodeId)) {
    out.push({
      level: 'warn',
      path: `${path}.nodeId`,
      message: `Dialogue node "${capability.nodeId}" is missing from the tree.`,
    });
  }
  return out;
}

function knowledgeEntryDiagnostics(
  entry: KnowledgeEntry,
  ids: Set<string>,
  ctx: { npcIds?: ReadonlySet<string>; questIds?: ReadonlySet<string>; lessonIds?: ReadonlySet<string> }
): AuthoringDiagnostic[] {
  const path = `entries.${entry.id}`;
  const out: AuthoringDiagnostic[] = [];
  for (const npcId of entry.knownByNpcIds) {
    if (ctx.npcIds && !ctx.npcIds.has(npcId)) {
      out.push({ level: 'error', path: `${path}.knownByNpcIds`, message: `Unknown NPC "${npcId}".` });
    }
  }
  for (const questId of entry.reveal?.questIds ?? []) {
    if (ctx.questIds && !ctx.questIds.has(questId)) {
      out.push({ level: 'warn', path: `${path}.reveal.questIds`, message: `Quest "${questId}" is not loaded.` });
    }
  }
  for (const other of entry.conflictsWith ?? []) {
    if (!ids.has(other)) {
      out.push({ level: 'error', path: `${path}.conflictsWith`, message: `Unknown conflict target "${other}".` });
    }
    if (other === entry.id) {
      out.push({ level: 'error', path: `${path}.conflictsWith`, message: 'An entry cannot conflict with itself.' });
    }
  }
  for (const other of entry.clarifies ?? []) {
    if (!ids.has(other)) {
      out.push({ level: 'error', path: `${path}.clarifies`, message: `Unknown clarify target "${other}".` });
    }
  }
  for (const need of entry.trigger?.requiresKnowledge ?? []) {
    if (!ids.has(need)) {
      out.push({
        level: 'error',
        path: `${path}.trigger.requiresKnowledge`,
        message: `Unknown required knowledge "${need}".`,
      });
    }
  }
  for (const lessonId of entry.trigger?.onLessonId ?? []) {
    if (ctx.lessonIds && !ctx.lessonIds.has(lessonId)) {
      out.push({ level: 'warn', path: `${path}.trigger.onLessonId`, message: `Lesson "${lessonId}" is not loaded.` });
    }
  }
  if (entry.conflictsWith?.length && entry.clarifies?.some((id) => entry.conflictsWith?.includes(id))) {
    out.push({
      level: 'error',
      path,
      message: 'An entry cannot both conflict with and clarify the same rumor.',
    });
  }
  return out;
}

function uiFeedbackDiagnostics(npcId: string, ui: NpcUiFeedback): AuthoringDiagnostic[] {
  const out: AuthoringDiagnostic[] = [];
  const keys = Object.keys(ui) as (keyof NpcUiFeedback)[];
  for (const key of keys) {
    if (typeof ui[key] !== 'boolean' && ui[key] !== undefined) {
      out.push({
        level: 'error',
        path: `npcs.${npcId}.uiFeedback.${key}`,
        message: 'uiFeedback flags must be boolean.',
      });
    }
  }
  return out;
}
