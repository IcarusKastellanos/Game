import type { InventorySlot, PlayerStats } from '../types/index.js';
import type {
  ContentQuest,
  PlayerProgression,
  QuestObjective,
  QuestProgress,
  QuestRewardGrant,
  QuestScope,
} from '../progression/index.js';
import { meetsMinLevel } from '../progression/level-curve.js';
import { holdsActiveLicense } from '../progression/licenses.js';
import { bondBlockReason } from '../social/index.js';

export interface QuestSignal {
  type: QuestObjective['type'] | 'fail';
  npcId?: string;
  spellId?: string;
  itemId?: string;
  quantity?: number;
  locationId?: string;
  licenseId?: string;
  choiceId?: string;
  eventId?: string;
  interactableId?: string;
  hour?: number;
  questId?: string;
  idempotencyKey?: string;
  playerId: string;
  partyId?: string;
  now: number;
}

export interface SharedQuestInstance {
  countByObjective: Record<string, number>;
  contributors: string[];
  completedAt?: number;
  failedAt?: number;
  rewardsGranted: string[];
  onceKeys: string[];
}

export interface SharedQuestStore {
  worlds: Record<string, SharedQuestInstance>;
  parties: Record<string, Record<string, SharedQuestInstance>>;
}

export interface QuestGateContext {
  stats?: PlayerStats;
  coins?: number;
  inventory?: InventorySlot[];
  now?: number;
}

const OBJECTIVE_TYPES = new Set<QuestObjective['type']>([
  'talk', 'deliver', 'collect', 'defeat', 'discover', 'license', 'bond', 'interact',
  'quest', 'schedule', 'dialogue', 'help_player', 'public_event', 'cast_spell',
]);

const MAX_SIGNAL_PASSES = 24;

export function emptySharedQuestStore(): SharedQuestStore {
  return { worlds: {}, parties: {} };
}

export function offerQuestsOnTalk(
  quests: ContentQuest[],
  progression: PlayerProgression,
  npcId: string,
  ctx: QuestGateContext = {}
): { progression: PlayerProgression; started: string[] } {
  let next = progression;
  const started: string[] = [];
  for (const quest of quests) {
    if ((quest.offer ?? 'on_talk') !== 'on_talk') continue;
    if (!questInvolves(quest, npcId)) continue;
    const result = startQuestDefinition(quests, next, quest.id, ctx);
    if (result.started) started.push(quest.id);
    next = result.progression;
  }
  return { progression: next, started };
}

export function startQuestDefinition(
  quests: ContentQuest[],
  progression: PlayerProgression,
  questId: string,
  ctx: QuestGateContext = {}
): { progression: PlayerProgression; started: boolean; reason?: string } {
  const quest = quests.find((entry) => entry.id === questId);
  if (!quest) return { progression, started: false, reason: 'That quest is missing.' };
  const reason = questBlockReason(quest, progression, ctx);
  if (reason) return { progression, started: false, reason };
  const existing = progression.questProgress[questId];
  if (existing?.completedAt && (quest.repeat ?? 'once') === 'once') {
    return { progression, started: false, reason: 'That work is already finished.' };
  }
  if (existing && !existing.completedAt && !existing.failedAt && !existing.abandonedAt) {
    return { progression, started: false };
  }
  const entry: QuestProgress = {
    questId,
    stage: quest.startStage,
    startedAt: ctx.now ?? Date.now(),
    version: quest.version ?? 1,
    objectives: {},
    choices: [],
    onceKeys: [],
    history: [],
  };
  return {
    started: true,
    progression: {
      ...progression,
      questProgress: { ...progression.questProgress, [questId]: entry },
    },
  };
}

export function applyQuestSignal(
  quests: ContentQuest[],
  progression: PlayerProgression,
  store: SharedQuestStore,
  signal: QuestSignal,
  gate: QuestGateContext = {}
): { progression: PlayerProgression; store: SharedQuestStore; completed: string[]; started: string[] } {
  const now = signal.now;
  let next = expireQuests(quests, progression, now);
  let nextStore = cloneStore(store);
  const completed: string[] = [];
  const started: string[] = [];
  const queue: QuestSignal[] = [signal];
  const seenQuestDone = new Set<string>();
  let passes = 0;

  while (queue.length > 0 && passes < MAX_SIGNAL_PASSES) {
    passes += 1;
    const current = queue.shift()!;
    if (current.type === 'quest' && current.questId) {
      const marker = `quest-done:${current.questId}`;
      if (seenQuestDone.has(marker)) continue;
      seenQuestDone.add(marker);
    }

    const opened = openEventQuests(quests, next, current, gate);
    next = opened.progression;
    for (const id of opened.started) {
      if (!started.includes(id)) started.push(id);
    }

    const passCompleted: string[] = [];
    for (const quest of quests) {
      const before = next.questProgress[quest.id];
      if (!before || before.completedAt || before.failedAt || before.abandonedAt) continue;
      const scope = quest.scope ?? 'personal';
      if (current.type === 'fail' && quest.failure?.eventId && quest.failure.eventId === current.eventId) {
        if (scope === 'party' && !current.partyId) continue;
        const failed = failQuest(quest, before, next, nextStore, current, now);
        next = failed.progression;
        nextStore = failed.store;
        continue;
      }
      if (scope === 'personal') {
        const updated = advancePersonal(quest, before, next, current, now);
        if (updated.progress === before && updated.progression === next) continue;
        next = writeProgress(updated.progression, quest.id, updated.progress);
        if (updated.progress.completedAt && !before.completedAt) passCompleted.push(quest.id);
      } else {
        const shared = sharedInstance(nextStore, quest, current.partyId);
        const advanced = advanceShared(quest, before, shared, current, now, next);
        if (!advanced) continue;
        nextStore = putShared(nextStore, quest, current.partyId, advanced.shared);
        next = writeProgress(next, quest.id, advanced.progress);
        if (advanced.progress.completedAt && !before.completedAt) passCompleted.push(quest.id);
      }
    }

    for (const questId of passCompleted) {
      if (!completed.includes(questId)) completed.push(questId);
      const quest = quests.find((entry) => entry.id === questId);
      const progress = next.questProgress[questId];
      const followIds = unique([
        ...(quest?.followUpQuestIds ?? []),
        ...decisionFollowUps(quest, progress),
      ]);
      for (const followId of followIds) {
        const follow = startQuestDefinition(quests, next, followId, { ...gate, now });
        if (follow.started && !started.includes(followId)) started.push(followId);
        next = follow.progression;
      }
      queue.push({
        type: 'quest',
        questId,
        playerId: current.playerId,
        partyId: current.partyId,
        now,
        quantity: 1,
        idempotencyKey: `quest-done:${questId}`,
      });
    }
  }

  return { progression: next, store: nextStore, completed, started };
}

export function abandonQuest(
  quests: ContentQuest[],
  progression: PlayerProgression,
  questId: string,
  now = Date.now()
): PlayerProgression {
  const current = progression.questProgress[questId];
  const quest = quests.find((entry) => entry.id === questId);
  if (!current || current.completedAt || current.failedAt || !quest) return progression;
  if ((quest.scope ?? 'personal') !== 'personal') return progression;
  return writeProgress(progression, questId, { ...current, abandonedAt: now, stage: 'abandoned' });
}

/**
 * In-progress instances take the new version and drop objective ids that no longer exist.
 * Completion and rewards already recorded stay recorded. A quest whose remaining steps are
 * already done is marked complete so the server can pay it once.
 */
export function reconcileQuestVersions(
  quests: ContentQuest[],
  progression: PlayerProgression,
  now = Date.now()
): PlayerProgression {
  let next = progression;
  for (const quest of quests) {
    const current = next.questProgress[quest.id];
    if (!current || current.completedAt || current.failedAt || current.abandonedAt) continue;
    const version = quest.version ?? 1;
    if ((current.version ?? 1) >= version) continue;
    const live = new Set(allObjectives(quest).map((row) => row.id));
    const objectives: QuestProgress['objectives'] = {};
    for (const [id, row] of Object.entries(current.objectives ?? {})) {
      if (live.has(id)) objectives[id] = row;
    }
    const required = requiredObjectives(quest, { ...current, objectives });
    const allDone = required.length > 0 && required.every((row) => objectives[row.id]?.doneAt);
    next = writeProgress(next, quest.id, {
      ...current,
      version,
      objectives,
      ...(allDone ? { stage: 'complete', completedAt: now } : {}),
    });
  }
  return next;
}

export function refreshQuestInstances(
  quests: ContentQuest[],
  progression: PlayerProgression,
  store: SharedQuestStore,
  playerId: string,
  now = Date.now(),
  partyId?: string
): PlayerProgression {
  const expired = expireQuests(quests, progression, now);
  const reconciled = reconcileQuestVersions(quests, expired, now);
  return projectSharedQuests(quests, reconciled, store, playerId, partyId);
}

/** Copy world and party progress onto this player's mirror. Personal quests stay untouched. */
export function projectSharedQuests(
  quests: ContentQuest[],
  progression: PlayerProgression,
  store: SharedQuestStore,
  playerId: string,
  partyId?: string
): PlayerProgression {
  let next = progression;
  for (const quest of quests) {
    const scope = quest.scope ?? 'personal';
    if (scope === 'personal') continue;
    const current = next.questProgress[quest.id];
    if (!current || current.abandonedAt) continue;
    const shared = findSharedForPlayer(store, quest, playerId, partyId);
    if (!shared) continue;
    const objectives: QuestProgress['objectives'] = { ...(current.objectives ?? {}) };
    for (const [id, count] of Object.entries(shared.countByObjective)) {
      const objective = allObjectives(quest).find((row) => row.id === id);
      const need = objective?.count ?? objective?.quantity ?? 1;
      objectives[id] = {
        count,
        ...(count >= need ? { doneAt: shared.completedAt ?? current.objectives?.[id]?.doneAt } : {}),
      };
    }
    const projected: QuestProgress = {
      ...current,
      objectives,
      ...(shared.completedAt ? { stage: 'complete', completedAt: shared.completedAt } : {}),
      ...(shared.failedAt && !shared.completedAt ? { stage: 'failed', failedAt: shared.failedAt } : {}),
    };
    if (JSON.stringify(projected) === JSON.stringify(current)) continue;
    next = writeProgress(next, quest.id, projected);
  }
  return next;
}

export function questRewards(quest: ContentQuest, progress: QuestProgress | undefined): QuestRewardGrant | undefined {
  const decision = (quest.decisions ?? []).find(
    (row) => row.rewards && progress?.choices?.includes(row.choiceId)
  );
  return decision?.rewards ?? quest.rewards;
}

export function validateQuestDocument(
  quests: ContentQuest[],
  knownNpcIds: string[] = [],
  knownItemIds: string[] = []
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const quest of quests) {
    if (!quest.id) errors.push('A quest is missing an id.');
    if (ids.has(quest.id)) errors.push(`Quest ${quest.id} is listed twice.`);
    ids.add(quest.id);
    if (!quest.name) errors.push(`Quest ${quest.id} needs a name.`);
    if (!quest.startStage) errors.push(`Quest ${quest.id} needs a start stage.`);
    if (!quest.nodes?.length) errors.push(`Quest ${quest.id} needs at least one node.`);
    const scope = quest.scope ?? 'personal';
    if (scope !== 'personal' && scope !== 'party' && scope !== 'world') {
      errors.push(`Quest ${quest.id} has an unknown scope.`);
    }
    if (scope === 'party' && quest.party?.contribution !== 'any' && quest.party?.contribution !== 'all') {
      errors.push(`Quest ${quest.id} needs a party contribution rule.`);
    }
    if (scope === 'party' && quest.party?.reward !== 'each' && quest.party?.reward !== 'leader') {
      errors.push(`Quest ${quest.id} needs a party reward rule.`);
    }
    const nodeIds = new Set((quest.nodes ?? []).map((node) => node.id));
    if (quest.startStage && !nodeIds.has(quest.startStage)) {
      errors.push(`Quest ${quest.id} starts at a missing node.`);
    }
    for (const node of quest.nodes ?? []) {
      if (node.next && !nodeIds.has(node.next)) {
        errors.push(`Quest ${quest.id} node ${node.id} leads to a missing node.`);
      }
    }
    const reachable = reachableNodes(quest);
    for (const node of quest.nodes ?? []) {
      if (!reachable.has(node.id)) errors.push(`Quest ${quest.id} node ${node.id} cannot be reached.`);
    }
    const objectiveIds = new Set<string>();
    for (const objective of allObjectives(quest)) {
      if (objectiveIds.has(objective.id)) errors.push(`Quest ${quest.id} repeats objective ${objective.id}.`);
      objectiveIds.add(objective.id);
      errors.push(...objectiveErrors(quest, objective, knownNpcIds, knownItemIds, ids));
    }
    if ((quest.objectives ?? []).filter((row) => !row.optional).length === 0 && !(quest.nodes ?? []).some((node) => node.objective)) {
      errors.push(`Quest ${quest.id} has no required objective.`);
    }
    for (const decision of quest.decisions ?? []) {
      if (!decision.choiceId) errors.push(`Quest ${quest.id} has a decision without a dialogue choice.`);
      for (const waived of decision.waiveObjectives ?? []) {
        if (!objectiveIds.has(waived)) errors.push(`Quest ${quest.id} waives a missing objective ${waived}.`);
      }
    }
    if (quest.npcId && knownNpcIds.length && !knownNpcIds.includes(quest.npcId)) {
      errors.push(`Quest ${quest.id} is offered by an unknown NPC.`);
    }
  }
  for (const quest of quests) {
    for (const follow of quest.followUpQuestIds ?? []) {
      if (!ids.has(follow)) errors.push(`Quest ${quest.id} follows into missing quest ${follow}.`);
      const child = quests.find((entry) => entry.id === follow);
      if (child && !(child.prerequisites?.questsCompleted ?? []).includes(quest.id)) {
        errors.push(`Quest ${follow} is missing its prerequisite ${quest.id}.`);
      }
    }
    for (const decision of quest.decisions ?? []) {
      for (const follow of decision.followUpQuestIds ?? []) {
        if (!ids.has(follow)) errors.push(`Quest ${quest.id} follows into missing quest ${follow}.`);
      }
    }
    for (const prior of quest.prerequisites?.questsCompleted ?? []) {
      if (!ids.has(prior)) errors.push(`Quest ${quest.id} requires missing quest ${prior}.`);
    }
  }
  const visiting = new Set<string>();
  const visit = (id: string, stack: string[]): void => {
    if (stack.includes(id)) {
      errors.push(`Quest rewards loop through ${[...stack, id].join(' → ')}.`);
      return;
    }
    if (visiting.has(id)) return;
    visiting.add(id);
    const quest = quests.find((entry) => entry.id === id);
    const follows = [
      ...(quest?.followUpQuestIds ?? []),
      ...(quest?.decisions ?? []).flatMap((decision) => decision.followUpQuestIds ?? []),
    ];
    for (const follow of follows) visit(follow, [...stack, id]);
  };
  for (const quest of quests) visit(quest.id, []);
  return errors;
}

export function questBlockReason(
  quest: ContentQuest,
  progression: PlayerProgression,
  ctx: QuestGateContext
): string | null {
  if (ctx.stats && !meetsMinLevel(ctx.stats.experience ?? 0, quest.minLevel)) {
    return 'You are not far enough along for that work.';
  }
  const needs = quest.prerequisites;
  for (const questId of needs?.questsCompleted ?? []) {
    if (!progression.questProgress[questId]?.completedAt) return 'An earlier task is still unfinished.';
  }
  for (const licenseId of needs?.licenses ?? []) {
    if (!holdsActiveLicense(progression, licenseId)) return 'A license is still required.';
  }
  for (const vowId of needs?.vows ?? []) {
    if (!progression.activeVows?.[vowId]) return 'A vow is still required.';
  }
  if (needs?.coins != null && (ctx.coins ?? 0) < needs.coins) return 'Your coin is short of the price.';
  for (const item of needs?.items ?? []) {
    const held = (ctx.inventory ?? []).reduce((sum, slot) => sum + (slot.itemId === item.itemId ? slot.quantity : 0), 0);
    if (held < item.quantity) return 'You are missing something the task requires.';
  }
  for (const flag of needs?.storyFlags ?? []) {
    if (!progression.storyFlags?.includes(flag)) return 'That story has not reached you yet.';
  }
  for (const flag of needs?.noStoryFlags ?? []) {
    if (progression.storyFlags?.includes(flag)) return 'That path is already closed.';
  }
  if (needs?.publicReputation != null && (ctx.stats?.publicReputation ?? 0) < needs.publicReputation) {
    return 'Your public standing is still too quiet.';
  }
  if (needs?.spiritualReputation != null && (ctx.stats?.spiritualReputation ?? 0) < needs.spiritualReputation) {
    return 'Your spiritual standing is still too quiet.';
  }
  const npcId = quest.npcId;
  if (quest.minStage && npcId && bondBlockReason(progression, npcId, { stage: quest.minStage })) {
    return 'You are not close enough for that.';
  }
  if (needs?.bond && npcId && bondBlockReason(progression, npcId, needs.bond)) {
    return 'The regard between you does not allow that yet.';
  }
  return null;
}

export function claimSharedReward(
  store: SharedQuestStore,
  quest: ContentQuest,
  playerId: string,
  partyId?: string
): { store: SharedQuestStore; grant: boolean } {
  const scope = quest.scope ?? 'personal';
  if (scope === 'personal') return { store, grant: true };
  const shared = sharedInstance(store, quest, partyId);
  if (!shared.completedAt || shared.rewardsGranted.includes(playerId)) return { store, grant: false };
  if (scope === 'party' && quest.party?.reward === 'leader' && shared.contributors[0] !== playerId) {
    return { store, grant: false };
  }
  if (!shared.contributors.includes(playerId)) return { store, grant: false };
  const next = { ...cloneInstance(shared), rewardsGranted: [...shared.rewardsGranted, playerId] };
  return { store: putShared(store, quest, partyId, next), grant: true };
}

function openEventQuests(
  quests: ContentQuest[],
  progression: PlayerProgression,
  signal: QuestSignal,
  gate: QuestGateContext
): { progression: PlayerProgression; started: string[] } {
  if (signal.type === 'fail' || signal.type === 'quest') return { progression, started: [] };
  let next = progression;
  const started: string[] = [];
  for (const quest of quests) {
    if (quest.offer !== 'event') continue;
    const existing = next.questProgress[quest.id];
    if (existing && !existing.completedAt && !existing.failedAt && !existing.abandonedAt) continue;
    if (!allObjectives(quest).some((objective) => signalMatches(objective, signal, existing ?? blankProgress(quest), next))) {
      continue;
    }
    const result = startQuestDefinition(quests, next, quest.id, { ...gate, now: signal.now });
    if (result.started) started.push(quest.id);
    next = result.progression;
  }
  return { progression: next, started };
}

function advancePersonal(
  quest: ContentQuest,
  progress: QuestProgress,
  progression: PlayerProgression,
  signal: QuestSignal,
  now: number
): { progress: QuestProgress; progression: PlayerProgression } {
  if (signal.idempotencyKey && progress.onceKeys?.includes(signal.idempotencyKey)) {
    return { progress, progression };
  }
  const decided = applyDecision(quest, progress, progression, signal, now);
  let nextProgress = decided.progress;
  let nextProgression = decided.progression;
  const typed = quest.objectives?.length ? quest.objectives : [];
  const optionals = quest.optionalObjectives ?? [];
  let changed = decided.changed;
  const nextObjectives = { ...(nextProgress.objectives ?? {}) };
  for (const objective of [...typed, ...optionals]) {
    if (nextObjectives[objective.id]?.doneAt) continue;
    if (!signalMatches(objective, signal, nextProgress, nextProgression)) continue;
    const need = objective.count ?? objective.quantity ?? 1;
    const count = (nextObjectives[objective.id]?.count ?? 0) + (signal.quantity ?? 1);
    nextObjectives[objective.id] = { count, ...(count >= need ? { doneAt: now } : {}) };
    changed = true;
  }
  if (!changed && typed.length === 0 && signal.type === 'cast_spell' && signal.spellId) {
    const node = quest.nodes.find((entry) => entry.id === progress.stage);
    if (node?.objective?.includes(signal.spellId)) {
      return {
        progression: nextProgression,
        progress: finishProgress(nextProgress, now, signal),
      };
    }
  }
  if (!changed) return { progress, progression };
  const done = requiredObjectives(quest, { ...nextProgress, objectives: nextObjectives }).every(
    (row) => nextObjectives[row.id]?.doneAt
  );
  const withHistory = appendHistory(
    {
      ...nextProgress,
      objectives: nextObjectives,
      choices: nextProgress.choices,
      onceKeys: rememberKey(nextProgress.onceKeys, signal.idempotencyKey),
      ...(done ? { stage: 'complete', completedAt: now } : {}),
    },
    signal,
    now
  );
  return { progression: nextProgression, progress: withHistory };
}

function advanceShared(
  quest: ContentQuest,
  progress: QuestProgress,
  shared: SharedQuestInstance,
  signal: QuestSignal,
  now: number,
  progression: PlayerProgression
): { progress: QuestProgress; shared: SharedQuestInstance } | null {
  if (shared.failedAt) return null;
  if (signal.idempotencyKey && shared.onceKeys.includes(signal.idempotencyKey)) return null;
  const scope = quest.scope ?? 'personal';
  if (scope === 'party' && !signal.partyId) return null;
  let matched = false;
  const counts = { ...shared.countByObjective };
  for (const objective of allObjectives(quest)) {
    if (!signalMatches(objective, signal, progress, progression)) continue;
    matched = true;
    const need = objective.count ?? objective.quantity ?? 1;
    const current = counts[objective.id] ?? 0;
    if (current < need) counts[objective.id] = Math.min(need, current + (signal.quantity ?? 1));
  }
  if (!matched) return null;
  const contributors = shared.contributors.includes(signal.playerId)
    ? shared.contributors
    : [...shared.contributors, signal.playerId];
  const required = requiredObjectives(quest, progress);
  const objectivesDone = required.every((row) => (counts[row.id] ?? 0) >= (row.count ?? row.quantity ?? 1));
  const needPeople = scope === 'party' && quest.party?.contribution === 'all'
    ? Math.max(1, quest.party.requiredContributors ?? 2)
    : 1;
  const complete = objectivesDone && contributors.length >= needPeople;
  const nextShared: SharedQuestInstance = {
    ...shared,
    countByObjective: counts,
    contributors,
    onceKeys: rememberKey(shared.onceKeys, signal.idempotencyKey),
    ...(complete && !shared.completedAt ? { completedAt: now } : {}),
  };
  const nextProgress: QuestProgress = appendHistory(
    {
      ...progress,
      objectives: Object.fromEntries(Object.entries(counts).map(([id, count]) => {
        const objective = allObjectives(quest).find((row) => row.id === id);
        const need = objective?.count ?? objective?.quantity ?? 1;
        return [id, { count, ...(count >= need ? { doneAt: now } : {}) }];
      })),
      onceKeys: rememberKey(progress.onceKeys, signal.idempotencyKey),
      ...(nextShared.completedAt ? { stage: 'complete', completedAt: nextShared.completedAt } : {}),
    },
    signal,
    now
  );
  return { progress: nextProgress, shared: nextShared };
}

function applyDecision(
  quest: ContentQuest,
  progress: QuestProgress,
  progression: PlayerProgression,
  signal: QuestSignal,
  now: number
): { progress: QuestProgress; progression: PlayerProgression; changed: boolean } {
  if ((quest.scope ?? 'personal') !== 'personal') return { progress, progression, changed: false };
  if (signal.type !== 'dialogue' || !signal.choiceId) return { progress, progression, changed: false };
  const decision = (quest.decisions ?? []).find((row) => row.choiceId === signal.choiceId);
  if (!decision) return { progress, progression, changed: false };
  if (progress.choices?.includes(decision.choiceId)) return { progress, progression, changed: false };
  let flags = progression.storyFlags ?? [];
  let flagsChanged = false;
  for (const flag of decision.setFlags ?? []) {
    if (!flags.includes(flag)) {
      flags = [...flags, flag];
      flagsChanged = true;
    }
  }
  const objectives = { ...(progress.objectives ?? {}) };
  for (const id of decision.waiveObjectives ?? []) {
    if (!objectives[id]?.doneAt) objectives[id] = { count: Math.max(1, objectives[id]?.count ?? 1), doneAt: now };
  }
  return {
    changed: true,
    progression: flagsChanged ? { ...progression, storyFlags: flags } : progression,
    progress: {
      ...progress,
      choices: [...(progress.choices ?? []), decision.choiceId],
      objectives,
    },
  };
}

function signalMatches(
  objective: QuestObjective,
  signal: QuestSignal,
  progress: QuestProgress,
  progression?: PlayerProgression
): boolean {
  if (objective.afterChoiceId && !(progress.choices ?? []).includes(objective.afterChoiceId)) return false;
  if (objective.type === 'bond') {
    if (signal.type !== 'bond') return false;
    const npcId = objective.npcId ?? signal.npcId;
    if (objective.npcId && signal.npcId && objective.npcId !== signal.npcId) return false;
    if (!objective.stage || !npcId || !progression) return false;
    return bondBlockReason(progression, npcId, { stage: objective.stage }) == null;
  }
  if (signal.type !== objective.type) return false;
  if (objective.npcId && signal.npcId && objective.npcId !== signal.npcId) return false;
  if (objective.npcId && !signal.npcId && objective.type !== 'cast_spell') return false;
  if (objective.spellId && objective.spellId !== signal.spellId) return false;
  if (objective.itemId && objective.itemId !== signal.itemId) return false;
  if (objective.locationId && objective.locationId !== signal.locationId) return false;
  if (objective.licenseId && objective.licenseId !== signal.licenseId) return false;
  if (objective.choiceId && objective.choiceId !== signal.choiceId) return false;
  if (objective.eventId && objective.eventId !== signal.eventId) return false;
  if (objective.interactableId && objective.interactableId !== signal.interactableId) return false;
  if (objective.questId && objective.questId !== signal.questId) return false;
  if (objective.hour != null && objective.hour !== signal.hour) return false;
  return true;
}

function failQuest(
  quest: ContentQuest,
  progress: QuestProgress,
  progression: PlayerProgression,
  store: SharedQuestStore,
  signal: QuestSignal,
  now: number
): { progression: PlayerProgression; store: SharedQuestStore } {
  const next = writeProgress(progression, quest.id, { ...progress, failedAt: now, stage: 'failed' });
  if ((quest.scope ?? 'personal') === 'personal') return { progression: next, store };
  const shared = sharedInstance(store, quest, signal.partyId);
  return {
    progression: next,
    store: putShared(store, quest, signal.partyId, { ...shared, failedAt: now }),
  };
}

function finishProgress(progress: QuestProgress, now: number, signal: QuestSignal): QuestProgress {
  return appendHistory(
    {
      ...progress,
      stage: 'complete',
      completedAt: now,
      onceKeys: rememberKey(progress.onceKeys, signal.idempotencyKey),
    },
    signal,
    now
  );
}

function appendHistory(progress: QuestProgress, signal: QuestSignal, now: number): QuestProgress {
  const detail = signal.choiceId ?? signal.spellId ?? signal.itemId ?? signal.eventId ?? signal.questId ?? signal.locationId;
  const history = [...(progress.history ?? []), { at: now, type: signal.type, ...(detail ? { detail } : {}) }].slice(-24);
  return { ...progress, history };
}

function requiredObjectives(quest: ContentQuest, progress: QuestProgress): QuestObjective[] {
  return (quest.objectives ?? []).filter((row) => !row.optional && objectiveActive(row, progress));
}

function objectiveActive(objective: QuestObjective, progress: QuestProgress): boolean {
  if (!objective.afterChoiceId) return true;
  return (progress.choices ?? []).includes(objective.afterChoiceId);
}

function allObjectives(quest: ContentQuest): QuestObjective[] {
  return [...(quest.objectives ?? []), ...(quest.optionalObjectives ?? [])];
}

function decisionFollowUps(quest: ContentQuest | undefined, progress: QuestProgress | undefined): string[] {
  if (!quest || !progress) return [];
  return (quest.decisions ?? [])
    .filter((decision) => progress.choices?.includes(decision.choiceId))
    .flatMap((decision) => decision.followUpQuestIds ?? []);
}

function objectiveErrors(
  quest: ContentQuest,
  objective: QuestObjective,
  knownNpcIds: string[],
  knownItemIds: string[],
  questIds: Set<string>
): string[] {
  const errors: string[] = [];
  if (!OBJECTIVE_TYPES.has(objective.type)) {
    errors.push(`Quest ${quest.id} has an unknown objective ${objective.id}.`);
    return errors;
  }
  const need = objective.count ?? objective.quantity;
  if (need != null && (!Number.isInteger(need) || need < 1)) {
    errors.push(`Quest ${quest.id} objective ${objective.id} needs a count of at least 1.`);
  }
  const missing = (label: string) => errors.push(`Quest ${quest.id} objective ${objective.id} is missing ${label}.`);
  if ((objective.type === 'talk' || objective.type === 'deliver') && !objective.npcId) missing('an NPC');
  if ((objective.type === 'deliver' || objective.type === 'collect') && !objective.itemId) missing('an item');
  if (objective.type === 'cast_spell' && !objective.spellId) missing('a spell');
  if (objective.type === 'discover' && !objective.locationId) missing('a location');
  if (objective.type === 'license' && !objective.licenseId) missing('a license');
  if (objective.type === 'bond' && !objective.stage) missing('a relationship stage');
  if (objective.type === 'quest' && !objective.questId) missing('a quest');
  if (objective.type === 'quest' && objective.questId && !questIds.has(objective.questId)) {
    errors.push(`Quest ${quest.id} objective ${objective.id} names a missing quest.`);
  }
  if (objective.type === 'schedule' && objective.hour == null) missing('an hour');
  if (objective.type === 'dialogue' && !objective.choiceId) missing('a dialogue choice');
  if ((objective.type === 'defeat' || objective.type === 'help_player' || objective.type === 'public_event') && !objective.eventId && !objective.npcId) {
    missing('an event');
  }
  if (objective.type === 'interact' && !objective.interactableId) missing('an interaction');
  if (objective.npcId && knownNpcIds.length && !knownNpcIds.includes(objective.npcId)) {
    errors.push(`Quest ${quest.id} names an unknown NPC ${objective.npcId}.`);
  }
  if (objective.itemId && knownItemIds.length && !knownItemIds.includes(objective.itemId)) {
    errors.push(`Quest ${quest.id} names an unknown item ${objective.itemId}.`);
  }
  return errors;
}

function reachableNodes(quest: ContentQuest): Set<string> {
  const seen = new Set<string>();
  const stack = [quest.startStage];
  while (stack.length) {
    const id = stack.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const node = quest.nodes?.find((entry) => entry.id === id);
    if (node?.next) stack.push(node.next);
  }
  return seen;
}

function blankProgress(quest: ContentQuest): QuestProgress {
  return { questId: quest.id, stage: quest.startStage, startedAt: 0, choices: [] };
}

function expireQuests(quests: ContentQuest[], progression: PlayerProgression, now: number): PlayerProgression {
  let next = progression;
  for (const quest of quests) {
    if (!quest.expiresHours) continue;
    const current = next.questProgress[quest.id];
    if (!current || current.completedAt || current.failedAt || current.abandonedAt) continue;
    if (now < current.startedAt + quest.expiresHours * 60 * 60 * 1000) continue;
    next = writeProgress(next, quest.id, { ...current, failedAt: now, stage: 'failed' });
  }
  return next;
}

function questInvolves(quest: ContentQuest, npcId: string): boolean {
  return quest.npcId === npcId || (quest.npcIds ?? []).includes(npcId);
}

function writeProgress(progression: PlayerProgression, questId: string, entry: QuestProgress): PlayerProgression {
  return { ...progression, questProgress: { ...progression.questProgress, [questId]: entry } };
}

function rememberKey(keys: string[] | undefined, key?: string): string[] {
  if (!key) return keys ?? [];
  if ((keys ?? []).includes(key)) return keys ?? [];
  return [...(keys ?? []), key].slice(-80);
}

function sharedInstance(store: SharedQuestStore, quest: ContentQuest, partyId?: string): SharedQuestInstance {
  const scope: QuestScope = quest.scope ?? 'personal';
  const found = scope === 'world'
    ? store.worlds[quest.id]
    : partyId
      ? store.parties[partyId]?.[quest.id]
      : undefined;
  return found ? cloneInstance(found) : { countByObjective: {}, contributors: [], rewardsGranted: [], onceKeys: [] };
}

function findSharedForPlayer(
  store: SharedQuestStore,
  quest: ContentQuest,
  playerId: string,
  partyId?: string
): SharedQuestInstance | undefined {
  if ((quest.scope ?? 'personal') === 'world') return store.worlds[quest.id];
  if (partyId && store.parties[partyId]?.[quest.id]) return store.parties[partyId][quest.id];
  for (const bucket of Object.values(store.parties)) {
    const instance = bucket[quest.id];
    if (instance?.contributors.includes(playerId)) return instance;
  }
  return undefined;
}

function putShared(
  store: SharedQuestStore,
  quest: ContentQuest,
  partyId: string | undefined,
  instance: SharedQuestInstance
): SharedQuestStore {
  const copy = cloneInstance(instance);
  if ((quest.scope ?? 'personal') === 'world') return { ...store, worlds: { ...store.worlds, [quest.id]: copy } };
  if (!partyId) return store;
  return {
    ...store,
    parties: { ...store.parties, [partyId]: { ...(store.parties[partyId] ?? {}), [quest.id]: copy } },
  };
}

function cloneInstance(instance: SharedQuestInstance): SharedQuestInstance {
  return {
    countByObjective: { ...instance.countByObjective },
    contributors: [...instance.contributors],
    rewardsGranted: [...instance.rewardsGranted],
    onceKeys: [...instance.onceKeys],
    completedAt: instance.completedAt,
    failedAt: instance.failedAt,
  };
}

function cloneStore(store: SharedQuestStore): SharedQuestStore {
  return {
    worlds: Object.fromEntries(Object.entries(store.worlds).map(([id, row]) => [id, cloneInstance(row)])),
    parties: Object.fromEntries(
      Object.entries(store.parties).map(([id, row]) => [
        id,
        Object.fromEntries(Object.entries(row).map(([questId, instance]) => [questId, cloneInstance(instance)])),
      ])
    ),
  };
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}
