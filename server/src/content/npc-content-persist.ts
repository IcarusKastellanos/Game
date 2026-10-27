import type { ContentNpc } from '@witchcraft/shared';
import { contentRegistry } from './registry.js';
import { writeContentJson } from './json-persist.js';
import { dialogueSystem } from '../systems/dialogue-system.js';

/** Identity and schedule live in JSON. Painted sprites stay on the NPC row in the database. */
export function persistNpcDefinitions(): void {
  const list = [...contentRegistry.npcs.values()].map((npc) => {
    const copy = { ...(npc as ContentNpc & { data?: unknown }) };
    delete copy.spritePixels;
    delete copy.data;
    return copy;
  });
  writeContentJson('npcs.json', list);
}

/** Dialogue trees are content. The live resolver must match the file after an admin save. */
export function persistDialogueDefinitions(): void {
  const list = [...contentRegistry.dialogues.values()];
  writeContentJson('dialogues.json', list);
  dialogueSystem.loadFromJson(list);
}
