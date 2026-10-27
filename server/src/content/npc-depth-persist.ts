import {
  validateKnowledgeAuthoring,
  validateLessonDocument,
  validateSocialNpcProfile,
  setKnowledgeContent,
  setLessonContent,
  setSocialContent,
  getSocialDocument,
  getKnowledgeDocument,
  getLessonDocument,
} from '@witchcraft/shared';
import { contentRegistry } from './registry.js';
import { questSystem } from '../systems/quest-system.js';
import { ContentSaveError, contentRevision, writeVersionedDocument } from './versioned-content.js';

export function socialRevision(): number {
  return contentRevision('social', 'document');
}

export function knowledgeRevision(): number {
  return contentRevision('knowledge', 'document');
}

export function lessonsRevision(): number {
  return contentRevision('lessons', 'document');
}

export async function saveSocialDocument(
  value: unknown,
  expectedRevision: number
): Promise<{ document: NonNullable<ReturnType<typeof getSocialDocument>>; revision: number }> {
  if (!value || typeof value !== 'object') throw new ContentSaveError('Social document must be an object.', 400);
  setSocialContent(value);
  const document = getSocialDocument();
  if (!document) throw new ContentSaveError('Social document failed validation.', 400);
  const diagnostics = Object.entries(document.npcs).flatMap(([npcId, profile]) =>
    validateSocialNpcProfile(npcId, profile)
  );
  const fatal = diagnostics.filter((row) => row.level === 'error');
  if (fatal.length) throw new ContentSaveError(fatal.map((row) => row.message).join(' '), 400);
  const { revision } = writeVersionedDocument({
    filename: 'social.json',
    bucket: 'social',
    id: 'document',
    expectedRevision,
    document,
  });
  return { document, revision };
}

export async function saveKnowledgeDocument(
  value: unknown,
  expectedRevision: number
): Promise<{ document: NonNullable<ReturnType<typeof getKnowledgeDocument>>; revision: number }> {
  const parsed = validateKnowledgeAuthoring(value, {
    npcIds: new Set(contentRegistry.npcs.keys()),
    questIds: new Set(questSystem.list().map((quest) => quest.id)),
    lessonIds: new Set((getLessonDocument()?.lessons ?? []).map((lesson) => lesson.id)),
  });
  if (!parsed.ok || !parsed.document) {
    const message = parsed.diagnostics.map((row) => row.message).join(' ') || 'Knowledge failed validation.';
    throw new ContentSaveError(message, 400);
  }
  setKnowledgeContent(parsed.document);
  const { revision } = writeVersionedDocument({
    filename: 'knowledge.json',
    bucket: 'knowledge',
    id: 'document',
    expectedRevision,
    document: parsed.document,
  });
  return { document: parsed.document, revision };
}

export async function saveLessonDocument(
  value: unknown,
  expectedRevision: number
): Promise<{ document: NonNullable<ReturnType<typeof getLessonDocument>>; revision: number }> {
  const parsed = validateLessonDocument(value);
  if (!parsed.ok) throw new ContentSaveError(parsed.error, 400);
  setLessonContent(parsed.document);
  const { revision } = writeVersionedDocument({
    filename: 'lessons.json',
    bucket: 'lessons',
    id: 'document',
    expectedRevision,
    document: parsed.document,
  });
  return { document: parsed.document, revision };
}
