#!/usr/bin/env node
/**
 * CI / pre-deploy NPC content validation.
 * Exit 1 on fatal authoring diagnostics. Warnings print but do not fail.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateNpcAuthoring,
  validateKnowledgeAuthoring,
  validateSocialNpcProfile,
  setKnowledgeContent,
  setSocialContent,
  getSocialDocument,
  CLIENT_NPC_FORBIDDEN_KEYS,
  toClientNpc,
  toClientDialogue,
} from '../shared/dist/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadJson(rel) {
  const path = join(root, rel);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

const npcs = loadJson('content/npcs.json') ?? [];
const places = loadJson('content/npc-places.json') ?? [];
const dialogues = loadJson('content/dialogues.json') ?? [];
const shops = loadJson('content/shops.json') ?? [];
const knowledge = loadJson('content/knowledge.json');
const social = loadJson('content/social.json');
const lessons = loadJson('content/lessons.json');
const quests = loadJson('content/quests.json') ?? [];

const placeIds = places.map((p) => p.id);
const shopIds = new Set(shops.map((s) => s.id));
const dialogueTreeIds = new Set(dialogues.map((d) => d.id));
const npcIds = new Set(npcs.map((n) => n.id));
const questIds = new Set(quests.map((q) => q.id));
const lessonIds = new Set((lessons?.lessons ?? []).map((l) => l.id));

let errors = 0;
let warns = 0;

function report(level, path, message) {
  if (level === 'error') {
    errors += 1;
    console.error(`[error] ${path}: ${message}`);
  } else {
    warns += 1;
    console.warn(`[warn] ${path}: ${message}`);
  }
}

for (const npc of npcs) {
  const dialogue = dialogues.find((d) => d.id === npc.dialogueTreeId);
  const nodeIds = new Set((dialogue?.nodes ?? []).map((n) => n.id));
  const result = validateNpcAuthoring(npc, npc.id, {
    placeIds,
    shopIds,
    dialogueTreeIds,
    dialogueNodeIds: nodeIds,
  });
  for (const row of result.diagnostics) report(row.level, `npcs.${npc.id}.${row.path}`, row.message);
  const client = toClientNpc(npc);
  for (const key of CLIENT_NPC_FORBIDDEN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(client, key)) {
      report('error', `npcs.${npc.id}`, `Client export leaked ${key}`);
    }
  }
}

for (const tree of dialogues) {
  const client = toClientDialogue(tree);
  for (const node of client.nodes) {
    for (const choice of node.choices ?? []) {
      if (choice.grantItem || choice.requiresBond || choice.actions) {
        report('error', `dialogues.${tree.id}.${node.id}`, 'Client dialogue export kept spoiler fields');
      }
    }
  }
}

if (knowledge) {
  setKnowledgeContent(knowledge);
  const result = validateKnowledgeAuthoring(knowledge, { npcIds, questIds, lessonIds });
  for (const row of result.diagnostics) report(row.level, `knowledge.${row.path}`, row.message);
}

if (social) {
  setSocialContent(social);
  const doc = getSocialDocument();
  if (doc) {
    for (const [npcId, profile] of Object.entries(doc.npcs ?? {})) {
      for (const row of validateSocialNpcProfile(npcId, profile)) {
        report(row.level, `social.${row.path}`, row.message);
      }
    }
  }
}

console.log(`NPC content validation: ${errors} error(s), ${warns} warning(s), ${npcs.length} NPC(s).`);
if (errors > 0) process.exit(1);
