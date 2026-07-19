import type { ContentQuest, PlayerProgression, QuestProgress } from '@witchcraft/shared';
import { contentRegistry } from '../content/registry.js';

export class QuestSystem {
  quests = new Map<string, ContentQuest>();

  loadFromJson(quests: ContentQuest[]): void {
    this.quests.clear();
    for (const q of quests) this.quests.set(q.id, q);
  }

  startQuest(progression: PlayerProgression, questId: string): PlayerProgression {
    const quest = this.quests.get(questId);
    if (!quest || progression.questProgress[questId]) return progression;
    const entry: QuestProgress = {
      questId,
      stage: quest.startStage,
      startedAt: Date.now(),
    };
    return {
      ...progression,
      questProgress: { ...progression.questProgress, [questId]: entry },
    };
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

  onSpellCast(progression: PlayerProgression, spellId: string): PlayerProgression {
    let updated = progression;
    for (const [questId, progress] of Object.entries(progression.questProgress)) {
      if (progress.completedAt) continue;
      const quest = this.quests.get(questId);
      if (!quest) continue;
      const node = quest.nodes.find((n) => n.id === progress.stage);
      if (!node?.objective) continue;
      if (node.objective.includes(spellId)) {
        updated = this.advanceQuest(updated, questId, 'complete', true);
      }
    }
    return updated;
  }

  getActiveQuests(progression: PlayerProgression): QuestProgress[] {
    return Object.values(progression.questProgress).filter((q) => !q.completedAt);
  }
}

export const questSystem = new QuestSystem();
