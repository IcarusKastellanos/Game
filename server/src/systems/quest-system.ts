import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ContentQuest, PlayerProgression, PlayerStats, QuestProgress } from '@witchcraft/shared';
import {
  applyQuestSignal,
  emptySharedQuestStore,
  offerQuestsOnTalk,
  reconcileQuestVersions,
  startQuestDefinition,
  type QuestGateContext,
  type QuestSignal,
  type SharedQuestStore,
} from '@witchcraft/shared';
import { CONTENT_DIR } from '../content/json-persist.js';

const STORE_PATH = resolve(CONTENT_DIR, '../data/shared-quests.json');

export class QuestSystem {
  quests = new Map<string, ContentQuest>();
  private store: SharedQuestStore = emptySharedQuestStore();

  loadFromJson(quests: ContentQuest[]): void {
    this.quests.clear();
    for (const quest of quests) this.quests.set(quest.id, quest);
  }

  list(): ContentQuest[] {
    return [...this.quests.values()];
  }

  snapshot(): SharedQuestStore {
    return this.store;
  }

  replaceStore(store: SharedQuestStore): void {
    this.store = store;
    this.persistStore();
  }

  loadStore(): void {
    try {
      if (!existsSync(STORE_PATH)) return;
      const parsed = JSON.parse(readFileSync(STORE_PATH, 'utf8')) as Partial<SharedQuestStore>;
      this.store = {
        worlds: parsed.worlds && typeof parsed.worlds === 'object' ? parsed.worlds : {},
        parties: parsed.parties && typeof parsed.parties === 'object' ? parsed.parties : {},
      };
    } catch (error) {
      console.warn('[QuestSystem] Shared quest file could not be read.', error);
    }
  }

  persistStore(): void {
    try {
      mkdirSync(dirname(STORE_PATH), { recursive: true });
      writeFileSync(STORE_PATH, `${JSON.stringify(this.store)}\n`, 'utf8');
    } catch (error) {
      console.warn('[QuestSystem] Shared quest file could not be saved.', error);
    }
  }

  offerOnTalk(
    progression: PlayerProgression,
    npcId: string,
    gate: QuestGateContext = {}
  ): { progression: PlayerProgression; started: string[] } {
    return offerQuestsOnTalk(this.list(), progression, npcId, gate);
  }

  startQuest(progression: PlayerProgression, questId: string, stats?: PlayerStats): PlayerProgression {
    return startQuestDefinition(this.list(), progression, questId, { stats }).progression;
  }

  advanceQuest(
    progression: PlayerProgression,
    questId: string,
    nextStage: string,
    complete = false
  ): PlayerProgression {
    const current = progression.questProgress[questId];
    if (!current) return progression;
    const updated: QuestProgress = {
      ...current,
      stage: nextStage,
      completedAt: complete ? Date.now() : current.completedAt,
    };
    return {
      ...progression,
      questProgress: { ...progression.questProgress, [questId]: updated },
    };
  }

  apply(
    progression: PlayerProgression,
    signal: QuestSignal,
    gate: QuestGateContext = {}
  ): { progression: PlayerProgression; completed: string[]; started: string[] } {
    const before = JSON.stringify(this.store);
    const reconciled = reconcileQuestVersions(this.list(), progression, signal.now);
    const result = applyQuestSignal(this.list(), reconciled, this.store, signal, gate);
    this.store = result.store;
    if (JSON.stringify(this.store) !== before) this.persistStore();
    return { progression: result.progression, completed: result.completed, started: result.started };
  }

  /** Spell completion used by older call sites. Rewards are granted by the room, not here. */
  onSpellCast(progression: PlayerProgression, spellId: string, playerId = 'spell'): PlayerProgression {
    return this.apply(
      progression,
      { type: 'cast_spell', spellId, playerId, now: Date.now() },
      {}
    ).progression;
  }

  getActiveQuests(progression: PlayerProgression): QuestProgress[] {
    return Object.values(progression.questProgress).filter((quest) => !quest.completedAt && !quest.failedAt && !quest.abandonedAt);
  }
}

export const questSystem = new QuestSystem();
