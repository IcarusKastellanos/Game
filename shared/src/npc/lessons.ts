/** Teacher lessons that unlock existing progression systems. */

import type { InventorySlot, PlayerStats } from '../types/index.js';
import type { PlayerProgression } from '../progression/index.js';
import { removeItemFromInventory } from '../inventory/index.js';
import { bondBlockReason, type BondGate } from '../social/index.js';
import { holdsActiveLicense, issueLicense } from '../progression/licenses.js';
import { meetsDialogueRecognitionGate } from '../progression/recognition.js';
import { grantSkillXp, type TechnicalSkillKey } from '../progression/skill-xp.js';
import { tryRevealKnowledge } from './knowledge.js';
import {
  parseTraditionAffinityGate,
  spiritualReputationBlockReason,
  traditionAffinityBlockReason,
  type TraditionAffinityGate,
} from './teacher-gates.js';

export type LessonTeachKind =
  | 'spell'
  | 'skill'
  | 'recipe'
  | 'license'
  | 'lore'
  | 'technique'
  | 'knowledge';

export interface LessonDef {
  id: string;
  npcId: string;
  label: string;
  description?: string;
  teaches: {
    kind: LessonTeachKind;
    /** Spell id, skill key, recipe id, license id, knowledge id, or lore flag. */
    targetId: string;
    /** Skill XP granted when kind is skill. */
    skillXp?: number;
  };
  costCoins?: number;
  durationMinutes?: number;
  requiredItems?: { itemId: string; quantity: number }[];
  requires?: BondGate;
  requiresQuestIds?: string[];
  requiresLessonIds?: string[];
  requiresLicenseIds?: string[];
  requiresStoryFlags?: string[];
  /** Recognition tier id gate. */
  requiresRecognition?: string;
  /** Tradition affinity floors (player stats.affinities). */
  requiresTraditionAffinity?: TraditionAffinityGate;
  /** Occult-community reputation floor. */
  requiresSpiritualReputation?: number;
  nodeId?: string;
}

export interface LessonDocument {
  lessons: LessonDef[];
}

export interface LessonPurchaseSuccess {
  ok: true;
  lesson: LessonDef;
  alreadyComplete: boolean;
  progression: PlayerProgression;
  stats?: PlayerStats;
  inventory?: InventorySlot[];
  coinsDelta?: number;
  notification: string;
}

export interface LessonPurchaseFailure {
  ok: false;
  reason: string;
}

let documentState: LessonDocument | null = null;

export function setLessonContent(raw: unknown): void {
  documentState = parseLessonDocument(raw);
}

export function getLessonDocument(): LessonDocument | null {
  return documentState;
}

export function lessonsForNpc(npcId: string): LessonDef[] {
  return (documentState?.lessons ?? []).filter((lesson) => lesson.npcId === npcId);
}

export function lessonById(id: string): LessonDef | undefined {
  return documentState?.lessons.find((lesson) => lesson.id === id);
}

export function hasCompletedLesson(progression: PlayerProgression, lessonId: string): boolean {
  return (progression.completedLessons ?? []).includes(lessonId);
}

export function lessonBlockReason(
  lesson: LessonDef,
  progression: PlayerProgression,
  coins?: number,
  inventory?: InventorySlot[],
  stats?: PlayerStats
): string | null {
  if (hasCompletedLesson(progression, lesson.id)) return null;
  if (lesson.requires) {
    const bond = bondBlockReason(progression, lesson.npcId, lesson.requires);
    if (bond) return bond;
  }
  if (lesson.requiresRecognition && !meetsDialogueRecognitionGate(lesson, progression)) {
    return 'You need deeper recognition before that lesson.';
  }
  const affinityBlock = traditionAffinityBlockReason(stats, lesson.requiresTraditionAffinity);
  if (affinityBlock) return affinityBlock;
  const spiritBlock = spiritualReputationBlockReason(stats, lesson.requiresSpiritualReputation);
  if (spiritBlock) return spiritBlock;
  for (const questId of lesson.requiresQuestIds ?? []) {
    if (!progression.questProgress?.[questId]?.completedAt) {
      return 'You are not ready for that lesson yet.';
    }
  }
  for (const prior of lesson.requiresLessonIds ?? []) {
    if (!hasCompletedLesson(progression, prior)) {
      return 'You need an earlier lesson first.';
    }
  }
  for (const licenseId of lesson.requiresLicenseIds ?? []) {
    if (!holdsActiveLicense(progression, licenseId)) {
      return 'That lesson needs a credential you do not hold.';
    }
  }
  for (const flag of lesson.requiresStoryFlags ?? []) {
    if (!progression.storyFlags?.includes(flag)) {
      return 'That lesson is still sealed.';
    }
  }
  if (lesson.costCoins != null && lesson.costCoins > 0 && (coins ?? 0) < lesson.costCoins) {
    return `That lesson costs ${lesson.costCoins} coins.`;
  }
  for (const need of lesson.requiredItems ?? []) {
    const have = inventory?.find((slot) => slot.itemId === need.itemId)?.quantity ?? 0;
    if (have < need.quantity) {
      return 'You are missing something needed for the lesson.';
    }
  }
  return null;
}

/** List lessons the player may see at this NPC (including locked ones with reasons). */
export function listLessonOffers(
  npcId: string,
  progression: PlayerProgression,
  coins?: number,
  inventory?: InventorySlot[],
  stats?: PlayerStats
): { id: string; label: string; available: boolean; requirement?: string; costCoins?: number; completed: boolean }[] {
  return lessonsForNpc(npcId).map((lesson) => {
    const completed = hasCompletedLesson(progression, lesson.id);
    if (completed) {
      return { id: lesson.id, label: lesson.label, available: false, completed: true, requirement: 'Already learned.' };
    }
    const block = lessonBlockReason(lesson, progression, coins, inventory, stats);
    return {
      id: lesson.id,
      label: lesson.label,
      available: block == null,
      completed: false,
      ...(block ? { requirement: block } : {}),
      ...(lesson.costCoins != null && lesson.costCoins > 0 ? { costCoins: lesson.costCoins } : {}),
    };
  });
}

/**
 * Purchase / complete a lesson. Duplicate completions are no-ops that report alreadyComplete.
 * Unlocks go through existing progression fields (recipes, licenses, skill XP, story flags, knowledge).
 */
export function purchaseLesson(input: {
  lessonId: string;
  npcId: string;
  progression: PlayerProgression;
  stats: PlayerStats;
  coins: number;
  inventory: InventorySlot[];
  now?: number;
}): LessonPurchaseSuccess | LessonPurchaseFailure {
  const lesson = lessonById(input.lessonId);
  if (!lesson || lesson.npcId !== input.npcId) {
    return { ok: false, reason: 'That lesson is not offered here.' };
  }
  if (hasCompletedLesson(input.progression, lesson.id)) {
    return {
      ok: true,
      lesson,
      alreadyComplete: true,
      progression: input.progression,
      notification: 'You already know that lesson.',
    };
  }
  const block = lessonBlockReason(
    lesson,
    input.progression,
    input.coins,
    input.inventory,
    input.stats
  );
  if (block) return { ok: false, reason: block };

  let progression = input.progression;
  let inventory = input.inventory;
  let coinsDelta = 0;

  if (lesson.costCoins != null && lesson.costCoins > 0) {
    coinsDelta = -lesson.costCoins;
  }
  for (const need of lesson.requiredItems ?? []) {
    const removed = removeItemFromInventory(inventory, need.itemId, need.quantity);
    if (!removed.ok) return { ok: false, reason: 'You are missing something needed for the lesson.' };
    inventory = removed.inventory;
  }

  const completed = new Set(progression.completedLessons ?? []);
  completed.add(lesson.id);
  progression = { ...progression, completedLessons: [...completed] };

  const teach = lesson.teaches;
  let notification = `Lesson complete: ${lesson.label}.`;

  if (teach.kind === 'recipe') {
    const recipes = new Set(progression.discoveredRecipes ?? []);
    recipes.add(teach.targetId);
    progression = { ...progression, discoveredRecipes: [...recipes] };
    notification = `You learned a recipe: ${teach.targetId}.`;
  } else if (teach.kind === 'spell' || teach.kind === 'technique' || teach.kind === 'lore') {
    const flags = new Set(progression.storyFlags ?? []);
    flags.add(teach.kind === 'spell' ? `taught_spell:${teach.targetId}` : teach.targetId);
    progression = { ...progression, storyFlags: [...flags] };
  } else if (teach.kind === 'license') {
    const issued = issueLicense(progression, teach.targetId);
    if (!issued) return { ok: false, reason: 'That credential cannot be granted.' };
    progression = issued.progression;
    notification = issued.alreadyHeld
      ? `${issued.license.label} remains in force.`
      : `Credential granted: ${issued.license.label}.`;
  } else if (teach.kind === 'skill') {
    const amount = teach.skillXp ?? 25;
    const skillKey = teach.targetId as TechnicalSkillKey;
    const granted = grantSkillXp(input.stats, progression, skillKey, amount);
    progression = granted.progression;
    notification = `You practiced ${teach.targetId}.`;
    return {
      ok: true,
      lesson,
      alreadyComplete: false,
      progression,
      stats: granted.stats,
      inventory: inventory !== input.inventory ? inventory : undefined,
      coinsDelta: coinsDelta || undefined,
      notification,
    };
  } else if (teach.kind === 'knowledge') {
    const revealed = tryRevealKnowledge({
      knowledgeId: teach.targetId,
      npcId: input.npcId,
      progression,
      stats: input.stats,
      now: input.now,
      source: 'lesson',
    });
    if (!revealed.ok) return { ok: false, reason: revealed.reason };
    progression = revealed.progression;
    if (!revealed.alreadyKnown) notification = revealed.text;
  }

  return {
    ok: true,
    lesson,
    alreadyComplete: false,
    progression,
    inventory: inventory !== input.inventory ? inventory : undefined,
    coinsDelta: coinsDelta || undefined,
    notification,
  };
}

export function validateLessonDocument(
  raw: unknown
): { ok: true; document: LessonDocument } | { ok: false; error: string } {
  const parsed = parseLessonDocument(raw);
  if (!parsed) return { ok: false, error: 'Lesson document must list lessons.' };
  const ids = new Set<string>();
  for (const lesson of parsed.lessons) {
    if (ids.has(lesson.id)) return { ok: false, error: `Duplicate lesson id: ${lesson.id}` };
    ids.add(lesson.id);
    if (!lesson.npcId) return { ok: false, error: `Lesson ${lesson.id} needs an npcId.` };
    if (!lesson.teaches?.targetId) return { ok: false, error: `Lesson ${lesson.id} needs teaches.targetId.` };
  }
  for (const lesson of parsed.lessons) {
    for (const prior of lesson.requiresLessonIds ?? []) {
      if (!ids.has(prior)) return { ok: false, error: `Lesson ${lesson.id} requires unknown lesson ${prior}.` };
    }
  }
  return { ok: true, document: parsed };
}

function parseLessonDocument(raw: unknown): LessonDocument | null {
  if (!raw || typeof raw !== 'object') return null;
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { lessons?: unknown }).lessons)
      ? ((raw as { lessons: unknown[] }).lessons)
      : null;
  if (!list) return null;
  const lessons: LessonDef[] = [];
  for (const value of list) {
    const lesson = parseLesson(value);
    if (lesson) lessons.push(lesson);
  }
  return { lessons };
}

function parseLesson(raw: unknown): LessonDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id.trim()) return null;
  if (typeof o.npcId !== 'string' || !o.npcId.trim()) return null;
  if (typeof o.label !== 'string' || !o.label.trim()) return null;
  const teachesRaw = o.teaches;
  if (!teachesRaw || typeof teachesRaw !== 'object') return null;
  const teaches = teachesRaw as Record<string, unknown>;
  if (typeof teaches.targetId !== 'string' || !teaches.targetId.trim()) return null;
  const kind = isTeachKind(teaches.kind) ? teaches.kind : 'lore';
  return {
    id: o.id.trim(),
    npcId: o.npcId.trim(),
    label: o.label.trim(),
    ...(typeof o.description === 'string' ? { description: o.description } : {}),
    teaches: {
      kind,
      targetId: teaches.targetId.trim(),
      ...(typeof teaches.skillXp === 'number' && Number.isFinite(teaches.skillXp)
        ? { skillXp: Math.max(0, Math.floor(teaches.skillXp)) }
        : {}),
    },
    ...(typeof o.costCoins === 'number' && Number.isFinite(o.costCoins) ? { costCoins: Math.max(0, Math.floor(o.costCoins)) } : {}),
    ...(typeof o.durationMinutes === 'number' && Number.isFinite(o.durationMinutes)
      ? { durationMinutes: Math.max(0, Math.floor(o.durationMinutes)) }
      : {}),
    ...(Array.isArray(o.requiredItems)
      ? {
          requiredItems: o.requiredItems
            .filter((row): row is { itemId: string; quantity: number } => {
              if (!row || typeof row !== 'object') return false;
              const r = row as Record<string, unknown>;
              return typeof r.itemId === 'string' && typeof r.quantity === 'number';
            })
            .map((row) => ({ itemId: row.itemId, quantity: Math.max(1, Math.floor(row.quantity)) })),
        }
      : {}),
    ...(o.requires && typeof o.requires === 'object' ? { requires: o.requires as BondGate } : {}),
    ...(stringList(o.requiresQuestIds) ? { requiresQuestIds: stringList(o.requiresQuestIds)! } : {}),
    ...(stringList(o.requiresLessonIds) ? { requiresLessonIds: stringList(o.requiresLessonIds)! } : {}),
    ...(stringList(o.requiresLicenseIds) ? { requiresLicenseIds: stringList(o.requiresLicenseIds)! } : {}),
    ...(stringList(o.requiresStoryFlags) ? { requiresStoryFlags: stringList(o.requiresStoryFlags)! } : {}),
    ...(typeof o.requiresRecognition === 'string' ? { requiresRecognition: o.requiresRecognition } : {}),
    ...(parseTraditionAffinityGate(o.requiresTraditionAffinity)
      ? { requiresTraditionAffinity: parseTraditionAffinityGate(o.requiresTraditionAffinity) }
      : {}),
    ...(typeof o.requiresSpiritualReputation === 'number' && Number.isFinite(o.requiresSpiritualReputation)
      ? { requiresSpiritualReputation: Math.max(0, Math.round(o.requiresSpiritualReputation)) }
      : {}),
    ...(typeof o.nodeId === 'string' ? { nodeId: o.nodeId } : {}),
  };
}

function stringList(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const list = raw.filter((id): id is string => typeof id === 'string' && !!id.trim());
  return list.length ? list : null;
}

function isTeachKind(value: unknown): value is LessonTeachKind {
  return (
    value === 'spell' ||
    value === 'skill' ||
    value === 'recipe' ||
    value === 'license' ||
    value === 'lore' ||
    value === 'technique' ||
    value === 'knowledge'
  );
}
