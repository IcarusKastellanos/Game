import type { ContentNpc, InventorySlot, NpcActionId, NpcCapability, PlayerStats } from '../types/index.js';
import type { ContentQuest, PlayerProgression } from '../progression/index.js';
import { TILE_SIZE } from '../constants/index.js';
import {
  distanceToInteractableFootprintPx,
  isWithinInteractRange,
  type MapInteractable,
} from '../map-builder/interact-range.js';
import { addItemToInventory } from '../inventory/index.js';
import {
  getLicense,
  getVow,
  holdsActiveLicense,
  issueLicense,
  meetsLicenseExamRequirements,
} from '../progression/licenses.js';
import { meetsDialogueRecognitionGate } from '../progression/recognition.js';
import { bondBlockReason, listSocialOffers, type BondGate } from '../social/index.js';

export interface DialogueChoice {
  /** Stable id. Existing trees omit it and use `${nodeId}:${index}`. */
  id?: string;
  label: string;
  next: string;
  relationshipDelta?: number;
  statBoost?: Record<string, number>;
  grantItem?: string;
  requiresRecognition?: string;
  requiresLicense?: string;
  requiresAnyLicense?: string[];
  chargeCoins?: number;
  acceptVow?: string;
  grantLicense?: string;
  requiresExamEligibility?: string;
  /** Server-checked bond stage, axis, memory, or grudge. Numbers are not shown to the player. */
  requiresBond?: BondGate;
  /** Social event id applied when the choice succeeds. */
  socialEvent?: string;
}

export interface DialogueNode {
  id: string;
  text: string;
  choices: DialogueChoice[];
  requiresRecognition?: string;
  requiresLicense?: string;
  requiresAnyLicense?: string[];
}

export interface DialogueTree {
  id: string;
  npcId: string;
  nodes: DialogueNode[];
}

/** What the server tells a client to draw. The client sends `id` back and nothing else. */
export interface PublishedDialogueChoice {
  id: string;
  index: number;
  label: string;
  available: boolean;
  requirement?: string;
  costCoins?: number;
}

export interface DialogueSession {
  inventory: InventorySlot[];
  progression?: PlayerProgression;
  stats?: PlayerStats;
  coins?: number;
}

export interface DialogueChoiceSuccess {
  ok: true;
  choiceId: string;
  nextNodeId: string;
  ended: boolean;
  message: string;
  inventory?: InventorySlot[];
  statBoost?: Record<string, number>;
  relationshipDelta?: number;
  socialEvent?: string;
  coinsDelta?: number;
  progression?: PlayerProgression;
  notification?: string;
}

export interface DialogueChoiceFailure {
  ok: false;
  reason: string;
}

export type DialogueChoiceOutcome = DialogueChoiceSuccess | DialogueChoiceFailure;

export interface NpcInteractionOffer {
  id: string;
  label: string;
  shopId?: string;
  nodeId?: string;
}

const ACTION_LABELS: Record<NpcActionId, string> = {
  talk: 'Talk',
  trade: 'Browse the counter',
  quests: 'Ask about quests',
  gift: 'Give a gift',
  favor: 'Ask for a favor',
  train: 'Learn or train',
  rumors: 'Ask about rumors',
  goodbye: 'Say goodbye',
};

const ACTION_ORDER: NpcActionId[] = ['talk', 'trade', 'quests', 'gift', 'favor', 'train', 'rumors'];
const OPTIONAL_NODE_ACTIONS = new Set<NpcActionId>(['gift', 'favor', 'train', 'rumors']);

export function dialogueChoiceId(nodeId: string, choice: DialogueChoice, index: number): string {
  const explicit = choice.id?.trim();
  return explicit || `${nodeId}:${index}`;
}

export function publishDialogueChoices(
  tree: DialogueTree | undefined,
  nodeId: string,
  progression: PlayerProgression,
  stats?: PlayerStats,
  coins?: number
): PublishedDialogueChoice[] {
  const node = tree?.nodes.find((entry) => entry.id === nodeId);
  if (!node) return [];
  if (!meetsDialogueRecognitionGate(node, progression)) return [];
  const published: PublishedDialogueChoice[] = [];
  node.choices.forEach((choice, index) => {
    if (!meetsDialogueRecognitionGate(choice, progression)) return;
    const id = dialogueChoiceId(node.id, choice, index);
    const block = choiceBlock(choice, progression, stats, coins, tree?.npcId);
    if (block === 'hide') return;
    published.push({
      id,
      index,
      label: choice.label,
      available: block == null,
      ...(block ? { requirement: block } : {}),
      ...(choice.chargeCoins != null && choice.chargeCoins > 0 ? { costCoins: choice.chargeCoins } : {}),
    });
  });
  return published;
}

export function resolveDialogueChoice(
  tree: DialogueTree | undefined,
  nodeId: string,
  choiceId: string,
  session: DialogueSession
): DialogueChoiceOutcome {
  if (!tree) return { ok: false, reason: 'That conversation is no longer available.' };
  const node = tree.nodes.find((entry) => entry.id === nodeId);
  if (!node) return { ok: false, reason: 'That moment in the conversation has passed.' };

  const progression = session.progression;
  if (progression && !meetsDialogueRecognitionGate(node, progression)) {
    return { ok: false, reason: 'They have nothing further for you at your recognition.' };
  }

  const located = locateChoice(node, choiceId);
  if (!located) return { ok: false, reason: 'That answer is no longer open.' };
  const { choice } = located;

  if (progression && !meetsDialogueRecognitionGate(choice, progression)) {
    return { ok: false, reason: 'That path is closed to you.' };
  }
  if (!progression && (choice.requiresLicense || choice.requiresAnyLicense?.length || choice.requiresRecognition)) {
    return { ok: false, reason: 'That path is closed to you.' };
  }

  const block = choiceBlock(choice, progression, session.stats, session.coins, tree.npcId);
  if (block === 'hide') return { ok: false, reason: 'That path is closed to you.' };
  if (block) return { ok: false, reason: block };

  let nextProgression = progression;
  let coinsDelta = 0;
  let notification: string | undefined;

  if (choice.chargeCoins != null && choice.chargeCoins > 0) {
    coinsDelta = -choice.chargeCoins;
  }

  if (choice.grantLicense) {
    if (!progression) return { ok: false, reason: 'Your record is not ready for a credential.' };
    if (choice.acceptVow && !getVow(choice.acceptVow)) {
      return { ok: false, reason: 'That vow is not on the Council register.' };
    }
    const issued = issueLicense(progression, choice.grantLicense);
    if (!issued) return { ok: false, reason: 'That credential cannot be granted.' };
    nextProgression = issued.progression;
    const vow = choice.acceptVow ? getVow(choice.acceptVow) : undefined;
    notification = issued.alreadyHeld
      ? `${issued.license.label} marks restored after re-examination.`
      : `Credential granted: ${issued.license.label}.` + (vow ? ` Vow sealed: “${vow.text}”` : '');
  }

  let updatedInv = session.inventory;
  if (choice.grantItem) {
    updatedInv = addItemToInventory(session.inventory, choice.grantItem, 1);
  }

  const nextNode = tree.nodes.find((entry) => entry.id === choice.next);
  return {
    ok: true,
    choiceId: dialogueChoiceId(node.id, choice, located.index),
    nextNodeId: choice.next,
    ended: choice.next === 'end' || !nextNode,
    message: nextNode?.text ?? 'Farewell.',
    inventory: choice.grantItem ? updatedInv : undefined,
    statBoost: choice.statBoost,
      relationshipDelta: choice.relationshipDelta,
      socialEvent: choice.socialEvent,
      coinsDelta: coinsDelta || undefined,
    progression: nextProgression !== progression ? nextProgression : undefined,
    notification,
  };
}

export function buildNpcInteractionOffers(input: {
  npc: ContentNpc;
  dialogue?: DialogueTree | null;
  contextShopId?: string;
  quests?: Pick<ContentQuest, 'id' | 'name' | 'npcId'>[];
  questProgress?: Record<string, { completedAt?: number | null } | undefined>;
  acceptsGifts?: boolean;
  progression?: PlayerProgression;
  now?: number;
}): NpcInteractionOffer[] {
  const { npc, dialogue, quests, questProgress } = input;
  const nodeIds = new Set((dialogue?.nodes ?? []).map((node) => node.id));
  const explicit = npc.capabilities;
  const openQuests = (quests ?? []).filter(
    (quest) => quest.npcId === npc.id && !questProgress?.[quest.id]?.completedAt
  );
  const offers: NpcInteractionOffer[] = [];

  for (const action of ACTION_ORDER) {
    const spec = specForAction(action, npc, explicit, input.contextShopId, openQuests.length > 0, nodeIds);
    if (!spec) continue;
    if (action === 'talk') {
      if (!npc.dialogueTreeId) continue;
      offers.push({
        id: 'talk',
        label: spec.label?.trim() || ACTION_LABELS.talk,
        nodeId: spec.nodeId || 'start',
      });
      continue;
    }
    if (action === 'trade') {
      const shopId = input.contextShopId || spec.shopId || npc.shopId;
      if (!shopId) continue;
      offers.push({ id: 'trade', label: spec.label?.trim() || ACTION_LABELS.trade, shopId });
      continue;
    }
    const nodeId = spec.nodeId || (nodeIds.has(action) ? action : 'start');
    if (OPTIONAL_NODE_ACTIONS.has(action) && !nodeIds.has(nodeId)) continue;
    offers.push({
      id: action,
      label: spec.label?.trim() || ACTION_LABELS[action],
      nodeId,
    });
  }

  if (input.acceptsGifts && !offers.some((offer) => offer.id === 'gift')) {
    offers.push({ id: 'gift', label: ACTION_LABELS.gift });
  }
  if (input.progression) {
    for (const social of listSocialOffers(npc.id, input.progression, input.now)) {
      offers.push(social);
    }
  }
  const goodbye = explicit?.find((entry) => entry.action === 'goodbye');
  offers.push({ id: 'goodbye', label: goodbye?.label?.trim() || ACTION_LABELS.goodbye });
  return offers;
}

/** Closest in-range map post or shop counter that belongs to this NPC. */
export function nearestNpcInteractable(
  playerTileX: number,
  playerTileY: number,
  npcId: string,
  interactables: readonly MapInteractable[],
  resolveShopNpcId: (shopId: string) => string | undefined
): MapInteractable | null {
  const px = playerTileX * TILE_SIZE + TILE_SIZE / 2;
  const py = playerTileY * TILE_SIZE + TILE_SIZE / 2;
  let best: MapInteractable | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const inter of interactables) {
    if (!interactableServesNpc(inter, npcId, resolveShopNpcId)) continue;
    if (!isWithinInteractRange(px, py, inter)) continue;
    const dist = distanceToInteractableFootprintPx(px, py, inter);
    if (dist < bestDist) {
      best = inter;
      bestDist = dist;
    }
  }
  return best;
}

export function validateDialogueTree(
  value: unknown
): { ok: true; tree: DialogueTree } | { ok: false; error: string } {
  if (!value || typeof value !== 'object') return { ok: false, error: 'Dialogue must be an object.' };
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !raw.id.trim()) return { ok: false, error: 'Dialogue id is required.' };
  if (typeof raw.npcId !== 'string' || !raw.npcId.trim()) return { ok: false, error: 'Dialogue npcId is required.' };
  if (!Array.isArray(raw.nodes) || raw.nodes.length === 0) {
    return { ok: false, error: 'Dialogue needs at least one node.' };
  }
  const nodes: DialogueNode[] = [];
  for (const nodeValue of raw.nodes) {
    if (!nodeValue || typeof nodeValue !== 'object') return { ok: false, error: 'Each node must be an object.' };
    const node = nodeValue as Record<string, unknown>;
    if (typeof node.id !== 'string' || !node.id.trim()) return { ok: false, error: 'Each node needs an id.' };
    if (typeof node.text !== 'string') return { ok: false, error: `Node ${node.id} needs text.` };
    if (!Array.isArray(node.choices)) return { ok: false, error: `Node ${node.id} needs choices.` };
    const choices: DialogueChoice[] = [];
    for (const choiceValue of node.choices) {
      const parsed = parseChoice(choiceValue, node.id);
      if (!parsed.ok) return parsed;
      choices.push(parsed.choice);
    }
    nodes.push({
      id: node.id.trim(),
      text: node.text,
      choices,
      ...gateFields(node),
    });
  }
  return { ok: true, tree: { id: raw.id.trim(), npcId: raw.npcId.trim(), nodes } };
}

export function validateNpcDefinition(
  value: unknown,
  id: string
): { ok: true; npc: ContentNpc } | { ok: false; error: string } {
  if (!value || typeof value !== 'object') return { ok: false, error: 'NPC must be an object.' };
  const raw = value as Record<string, unknown>;
  const name = requiredString(raw.name, 'name');
  if (typeof name !== 'string') return { ok: false, error: name };
  const role = requiredString(raw.role, 'role');
  if (typeof role !== 'string') return { ok: false, error: role };
  const locationId = requiredString(raw.locationId, 'locationId');
  if (typeof locationId !== 'string') return { ok: false, error: locationId };
  const dialogueTreeId = requiredString(raw.dialogueTreeId, 'dialogueTreeId');
  if (typeof dialogueTreeId !== 'string') return { ok: false, error: dialogueTreeId };
  if (!Array.isArray(raw.schedule)) return { ok: false, error: 'Schedule must be a list.' };
  const schedule: ContentNpc['schedule'] = [];
  for (const entry of raw.schedule) {
    if (!entry || typeof entry !== 'object') return { ok: false, error: 'Each schedule entry must be an object.' };
    const row = entry as Record<string, unknown>;
    if (typeof row.hour !== 'number' || !Number.isFinite(row.hour)) {
      return { ok: false, error: 'Each schedule entry needs an hour.' };
    }
    if (typeof row.locationId !== 'string' || !row.locationId.trim()) {
      return { ok: false, error: 'Each schedule entry needs a locationId.' };
    }
    schedule.push({ hour: row.hour, locationId: row.locationId.trim() as ContentNpc['locationId'] });
  }
  let capabilities: NpcCapability[] | undefined;
  if (raw.capabilities != null) {
    if (!Array.isArray(raw.capabilities)) return { ok: false, error: 'Capabilities must be a list.' };
    capabilities = [];
    for (const entry of raw.capabilities) {
      if (!entry || typeof entry !== 'object') return { ok: false, error: 'Each capability must be an object.' };
      const row = entry as Record<string, unknown>;
      if (!isActionId(row.action)) return { ok: false, error: 'Unknown NPC capability.' };
      capabilities.push({
        action: row.action,
        ...(typeof row.label === 'string' && row.label.trim() ? { label: row.label.trim() } : {}),
        ...(typeof row.nodeId === 'string' && row.nodeId.trim() ? { nodeId: row.nodeId.trim() } : {}),
        ...(typeof row.shopId === 'string' && row.shopId.trim() ? { shopId: row.shopId.trim() } : {}),
      });
    }
  }
  const secrets = optionalStringList(raw.secrets);
  if (typeof secrets === 'string') return { ok: false, error: secrets };
  const spritePixels = optionalStringList(raw.spritePixels);
  if (typeof spritePixels === 'string') return { ok: false, error: spritePixels };
  if (spritePixels && spritePixels.length !== 256) {
    return { ok: false, error: 'NPC spritePixels must be 256 colors.' };
  }
  return {
    ok: true,
    npc: {
      id,
      name,
      role,
      locationId: locationId as ContentNpc['locationId'],
      schedule,
      relationshipLevel: finiteNumber(raw.relationshipLevel, 0),
      magicalKnowledge: finiteNumber(raw.magicalKnowledge, 0),
      dialogueTreeId,
      ...(optionalString(raw.shopId) ? { shopId: optionalString(raw.shopId) } : {}),
      ...(optionalString(raw.faction) ? { faction: optionalString(raw.faction) } : {}),
      ...(secrets ? { secrets } : {}),
      ...(capabilities ? { capabilities } : {}),
      ...(spritePixels ? { spritePixels } : {}),
    },
  };
}

function specForAction(
  action: NpcActionId,
  npc: ContentNpc,
  explicit: NpcCapability[] | undefined,
  contextShopId: string | undefined,
  hasOpenQuest: boolean,
  nodeIds: Set<string>
): NpcCapability | undefined {
  if (explicit) return explicit.find((entry) => entry.action === action);
  if (action === 'talk' && npc.dialogueTreeId) return { action };
  if (action === 'trade' && (contextShopId || npc.shopId)) return { action, shopId: contextShopId || npc.shopId };
  if (action === 'quests' && hasOpenQuest) return { action };
  if (OPTIONAL_NODE_ACTIONS.has(action) && nodeIds.has(action)) return { action, nodeId: action };
  return undefined;
}

function interactableServesNpc(
  inter: MapInteractable,
  npcId: string,
  resolveShopNpcId: (shopId: string) => string | undefined
): boolean {
  if (inter.type === 'npc') return inter.data?.npcId === npcId;
  if (inter.type !== 'shop') return false;
  const shopId = typeof inter.data?.shopId === 'string' ? inter.data.shopId : undefined;
  return shopId ? resolveShopNpcId(shopId) === npcId : false;
}

function locateChoice(
  node: DialogueNode,
  choiceId: string
): { choice: DialogueChoice; index: number } | null {
  const wanted = choiceId.trim();
  if (!wanted) return null;
  for (let index = 0; index < node.choices.length; index += 1) {
    const choice = node.choices[index];
    if (dialogueChoiceId(node.id, choice, index) === wanted) return { choice, index };
  }
  return null;
}

/** `hide` omits the choice. A string is a visible, unavailable explanation. */
function choiceBlock(
  choice: DialogueChoice,
  progression: PlayerProgression | undefined,
  stats: PlayerStats | undefined,
  coins: number | undefined,
  npcId?: string
): string | 'hide' | null {
  if (choice.requiresExamEligibility) {
    const license = getLicense(choice.requiresExamEligibility);
    if (!license || !progression) return 'hide';
    if (holdsActiveLicense(progression, license.id)) return 'hide';
    if (!stats) return 'Your practitioner record is still incomplete.';
    const exam = meetsLicenseExamRequirements(license, stats, progression);
    if (!exam.ok) return exam.reasons.join(' ') || 'You are not eligible for that examination.';
  }
  if (choice.chargeCoins != null && choice.chargeCoins > 0 && (coins ?? 0) < choice.chargeCoins) {
    return `You need ${choice.chargeCoins} coins.`;
  }
  const bond = bondBlockReason(progression, npcId, choice.requiresBond);
  if (bond) return bond;
  return null;
}

function parseChoice(
  value: unknown,
  nodeId: string
): { ok: true; choice: DialogueChoice } | { ok: false; error: string } {
  if (!value || typeof value !== 'object') return { ok: false, error: `A choice on ${nodeId} is invalid.` };
  const raw = value as Record<string, unknown>;
  if (typeof raw.label !== 'string' || !raw.label.trim()) {
    return { ok: false, error: `A choice on ${nodeId} needs a label.` };
  }
  if (typeof raw.next !== 'string' || !raw.next.trim()) {
    return { ok: false, error: `A choice on ${nodeId} needs a next node.` };
  }
  const choice: DialogueChoice = { label: raw.label.trim(), next: raw.next.trim() };
  if (typeof raw.id === 'string' && raw.id.trim()) choice.id = raw.id.trim();
  if (typeof raw.relationshipDelta === 'number' && Number.isFinite(raw.relationshipDelta)) {
    choice.relationshipDelta = raw.relationshipDelta;
  }
  if (raw.statBoost && typeof raw.statBoost === 'object' && !Array.isArray(raw.statBoost)) {
    const boost: Record<string, number> = {};
    for (const [key, amount] of Object.entries(raw.statBoost as Record<string, unknown>)) {
      if (typeof amount === 'number' && Number.isFinite(amount)) boost[key] = amount;
    }
    if (Object.keys(boost).length) choice.statBoost = boost;
  }
  if (typeof raw.grantItem === 'string' && raw.grantItem.trim()) choice.grantItem = raw.grantItem.trim();
  if (typeof raw.requiresRecognition === 'string' && raw.requiresRecognition.trim()) {
    choice.requiresRecognition = raw.requiresRecognition.trim();
  }
  if (typeof raw.requiresLicense === 'string' && raw.requiresLicense.trim()) {
    choice.requiresLicense = raw.requiresLicense.trim();
  }
  const anyLicense = optionalStringList(raw.requiresAnyLicense);
  if (typeof anyLicense === 'string') return { ok: false, error: anyLicense };
  if (anyLicense) choice.requiresAnyLicense = anyLicense;
  if (typeof raw.chargeCoins === 'number' && Number.isFinite(raw.chargeCoins)) choice.chargeCoins = raw.chargeCoins;
  if (typeof raw.acceptVow === 'string' && raw.acceptVow.trim()) choice.acceptVow = raw.acceptVow.trim();
  if (typeof raw.grantLicense === 'string' && raw.grantLicense.trim()) choice.grantLicense = raw.grantLicense.trim();
  if (typeof raw.requiresExamEligibility === 'string' && raw.requiresExamEligibility.trim()) {
    choice.requiresExamEligibility = raw.requiresExamEligibility.trim();
  }
  if (typeof raw.socialEvent === 'string' && raw.socialEvent.trim()) choice.socialEvent = raw.socialEvent.trim();
  if (raw.requiresBond && typeof raw.requiresBond === 'object') {
    const gate = parseBondGate(raw.requiresBond);
    if (!gate.ok) return gate;
    if (gate.gate) choice.requiresBond = gate.gate;
  }
  return { ok: true, choice };
}

function parseBondGate(value: unknown): { ok: true; gate?: BondGate } | { ok: false; error: string } {
  if (!value || typeof value !== 'object') return { ok: false, error: 'requiresBond must be an object.' };
  const raw = value as Record<string, unknown>;
  const gate: BondGate = {};
  if (typeof raw.stage === 'string' && raw.stage.trim()) gate.stage = raw.stage.trim();
  if (typeof raw.memory === 'string' && raw.memory.trim()) gate.memory = raw.memory.trim();
  if (typeof raw.grudge === 'string' && raw.grudge.trim()) gate.grudge = raw.grudge.trim();
  if (typeof raw.noGrudge === 'string' && raw.noGrudge.trim()) gate.noGrudge = raw.noGrudge.trim();
  for (const key of ['trustMin', 'affinityMin', 'respectMin', 'familiarityMin', 'fearMin'] as const) {
    const amount = raw[key];
    if (amount == null) continue;
    if (typeof amount !== 'number' || !Number.isFinite(amount)) return { ok: false, error: `requiresBond.${key} must be a number.` };
    gate[key] = amount;
  }
  return { ok: true, gate: Object.keys(gate).length ? gate : undefined };
}

function gateFields(raw: Record<string, unknown>): Pick<
  DialogueNode,
  'requiresRecognition' | 'requiresLicense' | 'requiresAnyLicense'
> {
  return {
    ...(typeof raw.requiresRecognition === 'string' && raw.requiresRecognition.trim()
      ? { requiresRecognition: raw.requiresRecognition.trim() }
      : {}),
    ...(typeof raw.requiresLicense === 'string' && raw.requiresLicense.trim()
      ? { requiresLicense: raw.requiresLicense.trim() }
      : {}),
    ...(Array.isArray(raw.requiresAnyLicense)
      ? {
          requiresAnyLicense: raw.requiresAnyLicense.filter((entry): entry is string => typeof entry === 'string' && !!entry.trim()),
        }
      : {}),
  };
}

function requiredString(value: unknown, field: string): string | `NPC ${string} is required.` {
  if (typeof value !== 'string' || !value.trim()) return `NPC ${field} is required.`;
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function optionalStringList(value: unknown): string[] | undefined | string {
  if (value == null) return undefined;
  if (!Array.isArray(value)) return 'Expected a list of strings.';
  const list: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') return 'Expected a list of strings.';
    if (entry.trim()) list.push(entry);
  }
  return list;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isActionId(value: unknown): value is NpcActionId {
  return (
    value === 'talk' ||
    value === 'trade' ||
    value === 'quests' ||
    value === 'gift' ||
    value === 'favor' ||
    value === 'train' ||
    value === 'rumors' ||
    value === 'goodbye'
  );
}
