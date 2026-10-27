import type { ContentNpc, DialogueTree } from '@witchcraft/shared';
import { validateDialogueTree, validateNpcDefinition } from '@witchcraft/shared';
import { contentRegistry } from './registry.js';
import { dialogueSystem } from '../systems/dialogue-system.js';
import { prisma } from '../services/db.js';
import { npcToDb } from './npc-sprites.js';
import { ContentSaveError, contentRevision, writeVersionedCollection } from './versioned-content.js';

export function npcRevision(id: string): number {
  return contentRevision('npcs', id);
}

export function dialogueRevision(id: string): number {
  return contentRevision('dialogues', id);
}

export async function saveNpcDefinition(
  value: unknown,
  id: string,
  expectedRevision: number
): Promise<{ npc: ContentNpc; revision: number }> {
  const parsed = validateNpcDefinition(value, id, [...contentRegistry.npcPlaces.keys()]);
  if (!parsed.ok) throw new ContentSaveError(parsed.error, 400);
  const npc = parsed.npc;
  const existing = await prisma.contentNpc.findUnique({ where: { id: npc.id } });
  const previous = [...contentRegistry.npcs.values()];
  const records = previous.map((entry) => (entry.id === npc.id ? npc : entry));
  if (!records.some((entry) => entry.id === npc.id)) records.push(npc);

  const { revision } = writeVersionedCollection({
    filename: 'npcs.json',
    bucket: 'npcs',
    id: npc.id,
    expectedRevision,
    records: records.map(publicNpc),
  });
  const replaced = contentRegistry.npcs.get(npc.id);
  contentRegistry.npcs.set(npc.id, npc);
  try {
    const dbRow = npcToDb(npc, existing?.data);
    await prisma.contentNpc.upsert({
      where: { id: npc.id },
      create: dbRow as never,
      update: dbRow as never,
    });
  } catch (error) {
    if (replaced) contentRegistry.npcs.set(npc.id, replaced);
    else contentRegistry.npcs.delete(npc.id);
    writeVersionedCollection({
      filename: 'npcs.json',
      bucket: 'npcs',
      id: npc.id,
      expectedRevision: revision,
      records: previous.map(publicNpc),
    });
    const message = error instanceof Error ? error.message : 'Database update failed.';
    throw new ContentSaveError(`The NPC file was restored because the database update failed. ${message}`, 500);
  }

  return { npc, revision };
}

export async function saveDialogueDefinition(
  value: unknown,
  id: string,
  expectedRevision: number
): Promise<{ dialogue: DialogueTree; revision: number }> {
  const parsed = validateDialogueTree({ ...(asRecord(value) ?? {}), id });
  if (!parsed.ok) throw new ContentSaveError(parsed.error, 400);
  const dialogue = parsed.tree;
  const previous = [...contentRegistry.dialogues.values()];
  const records = previous.map((entry) => (entry.id === dialogue.id ? dialogue : entry));
  if (!records.some((entry) => entry.id === dialogue.id)) records.push(dialogue);

  const { revision } = writeVersionedCollection({
    filename: 'dialogues.json',
    bucket: 'dialogues',
    id: dialogue.id,
    expectedRevision,
    records,
  });
  const replaced = contentRegistry.dialogues.get(dialogue.id);
  contentRegistry.dialogues.set(dialogue.id, dialogue);
  dialogueSystem.loadFromJson([...contentRegistry.dialogues.values()]);

  const owner =
    contentRegistry.npcs.get(dialogue.npcId) ??
    [...contentRegistry.npcs.values()].find((npc) => npc.dialogueTreeId === dialogue.id);
  if (owner) {
    try {
      const existing = await prisma.contentNpc.findUnique({ where: { id: owner.id } });
      if (existing) {
        const prev = asRecord(existing.data) ?? {};
        await prisma.contentNpc.update({
          where: { id: owner.id },
          data: {
            data: {
              ...prev,
              dialogue: JSON.parse(JSON.stringify(dialogue)) as unknown,
              dialogueRevision: revision,
            } as never,
          },
        });
      }
    } catch (error) {
      if (replaced) contentRegistry.dialogues.set(dialogue.id, replaced);
      else contentRegistry.dialogues.delete(dialogue.id);
      dialogueSystem.loadFromJson([...contentRegistry.dialogues.values()]);
      writeVersionedCollection({
        filename: 'dialogues.json',
        bucket: 'dialogues',
        id: dialogue.id,
        expectedRevision: revision,
        records: previous,
      });
      const message = error instanceof Error ? error.message : 'Database update failed.';
      throw new ContentSaveError(`The dialogue file was restored because the database update failed. ${message}`, 500);
    }
  }

  return { dialogue, revision };
}

function publicNpc(npc: ContentNpc): ContentNpc {
  const copy = { ...(npc as ContentNpc & { data?: unknown; revision?: unknown }) };
  delete copy.spritePixels;
  delete (copy as { data?: unknown }).data;
  delete (copy as { revision?: unknown }).revision;
  return copy;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
