import type { ContentQuest } from '@witchcraft/shared';
import { validateQuestDocument } from '@witchcraft/shared';
import { contentRegistry } from './registry.js';
import { questSystem } from '../systems/quest-system.js';
import { ContentSaveError, contentRevision, writeVersionedCollection } from './versioned-content.js';

export function questRevision(id: string): number {
  return contentRevision('quests', id);
}

export function saveQuestDefinition(
  value: unknown,
  id: string,
  expectedRevision: number
): { quest: ContentQuest; revision: number } {
  const record = asRecord(value);
  if (!record) throw new ContentSaveError('Quest body is missing.', 400);
  const rest = { ...record };
  delete rest.revision;
  const quest = { ...rest, id } as ContentQuest;
  if (!/^[a-z][a-z0-9_]{1,64}$/.test(quest.id)) {
    throw new ContentSaveError('Quest id must be a lowercase slug.', 400);
  }
  const previous = questSystem.list();
  const existing = previous.find((entry) => entry.id === quest.id);
  const version = existing ? Math.max((existing.version ?? 1) + 1, Number(quest.version) || 1) : (quest.version ?? 1);
  const nextQuest: ContentQuest = { ...quest, id: quest.id, version };
  const records = previous.map((entry) => (entry.id === nextQuest.id ? nextQuest : entry));
  if (!records.some((entry) => entry.id === nextQuest.id)) records.push(nextQuest);
  const errors = validateQuestDocument(
    records,
    [...contentRegistry.npcs.keys()],
    [...contentRegistry.ingredients.keys()]
  );
  if (errors.length) throw new ContentSaveError(errors[0] ?? 'Quest is not valid.', 400);
  const { revision } = writeVersionedCollection({
    filename: 'quests.json',
    bucket: 'quests',
    id: nextQuest.id,
    expectedRevision,
    records,
  });
  questSystem.loadFromJson(records);
  return { quest: nextQuest, revision };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return { ...(value as Record<string, unknown>) };
}
