import type { Client } from '@colyseus/core';
import type { ClientMessage, MagicTradition, PlayerProgression, PlayerStats, HexagramEnchantPayload, AuraState } from '@witchcraft/shared';
import {
  BOOK_CONTENT,
  discoverCorrespondences,
  // eligibleSpecialtyTraditions — TEMPORARY: tradition specialty offers deactivated
  clampPlayerStatValue,
  addItemToInventory,
  normalizePlayerStats,
  applyCleanserToAura,
  formatCleanserMessage,
  CLEANSER_MORALITY_COST,
  grantSkillXp,
  resolveTechnicalSkillKey,
  applyReputationDelta,
  applyReputationSource,
  reputationTrackForNpc,
  grantExperience,
  evaluateRecognition,
  grantLicenses,
  malevolentGrimoireWard,
  recordGrimoireCast,
  recordGrimoireIngredients,
  recordGrimoireStudied,
  withGrimoire,
  applySocialEvent,
  withBondJournal,
  type ReputationTrack,
} from '@witchcraft/shared';
import { contentRegistry } from '../content/registry.js';
import { craftingSystem } from '../systems/crafting-system.js';
import { hexagramEnchantSystem } from '../systems/hexagram-enchant-system.js';
import { applyPocketSpellToRecipient, resolveAndReleasePocketSpell } from '../systems/pocket-spell-system.js';
import { questSystem } from '../systems/quest-system.js';
import { currentNpcWorld, isInteractableNpcAvailable } from '../systems/npc-schedule.js';
import { getWorldHour } from '../systems/world-clock.js';
import { logSpellCast } from '../services/player-service.js';
import { auraSystem } from '../systems/inventory-ward-aura.js';
import type { PlayerSchema } from '../schemas/game-state.js';
import type { PersistedPlayer } from '../services/player-service.js';
import { prisma } from '../services/db.js';

export type HandlerCtx = {
  client: Client;
  player: PlayerSchema;
  data: PersistedPlayer;
  sendPlayerSync: (client: Client, player: PlayerSchema) => void;
  sendProgression: (client: Client, progression: PlayerProgression) => void;
  resolvePlayer?: (sessionId: string) => { player: PlayerSchema; client?: Client } | null;
  progressionFor?: (sessionId: string) => PlayerProgression | undefined;
  refreshWardWeb?: (sessionId: string) => void;
};

function notifyXp(ctx: HandlerCtx, granted: number, leveledUp: boolean, levelAfter: number, label: string): void {
  if (granted <= 0) return;
  ctx.client.send('notification', {
    type: 'notification',
    message: leveledUp
      ? `+${granted} XP (${label}) — Practitioner Level ${levelAfter}!`
      : `+${granted} XP — ${label}`,
    level: leveledUp ? 'success' : 'info',
  });
}

function notifyLevelUpEvents(ctx: HandlerCtx, events: { message: string; eventId: string }[]): void {
  for (const event of events) {
    ctx.client.send('notification', {
      type: 'notification',
      message: event.message,
      level: 'success',
    });
    ctx.client.send('level_up', {
      type: 'level_up',
      eventId: event.eventId,
      message: event.message,
    });
  }
}

/** Recompute recognition tier after level / quest / reputation / affinity changes. */
export function syncRecognition(ctx: HandlerCtx, opts: { notify?: boolean } = {}): void {
  const result = evaluateRecognition(ctx.player.stats, ctx.data.progression);
  ctx.data.progression = result.progression;
  if (result.changed && opts.notify !== false) {
    ctx.client.send('notification', {
      type: 'notification',
      message: `Recognition: you are acknowledged as ${result.tier.label}.`,
      level: 'success',
    });
    ctx.sendProgression(ctx.client, ctx.data.progression);
  }
}

function grantXp(
  ctx: HandlerCtx,
  sourceId: string,
  context?: Parameters<typeof grantExperience>[3]
): ReturnType<typeof grantExperience> {
  const result = grantExperience(ctx.player.stats, ctx.data.progression, sourceId, context);
  ctx.player.stats = result.stats;
  ctx.data.progression = result.progression;
  ctx.data.stats = result.stats;
  if (result.granted > 0) {
    ctx.sendProgression(ctx.client, ctx.data.progression);
    notifyXp(ctx, result.granted, result.leveledUp, result.levelAfter, result.source?.label ?? sourceId);
    notifyLevelUpEvents(ctx, result.levelUpEvents);
    if (result.leveledUp) syncRecognition(ctx);
  }
  return result;
}

function applyReputation(
  stats: PlayerStats,
  delta: number,
  track: ReputationTrack = 'public'
): PlayerStats {
  return applyReputationDelta(stats, track, delta);
}

function checkSpecialtyOffer(_client: Client, _stats: PlayerStats): void {
  // TEMPORARY: tradition specialty offers deactivated until tradition packs ship.
  return;
  /*
  if (_stats.specialty) return;
  const eligible = eligibleSpecialtyTraditions(_stats.affinities);
  if (eligible.length) {
    _client.send('specialty_offer', { traditions: eligible });
  }
  */
}

export function sendWorldState(client: Client): void {
  client.send('world_state', currentNpcWorld());
}

/** Apply one content social event. Familiarity is mirrored; public reputation moves only when the event says so. */
export function applyPlayerSocialEvent(
  ctx: HandlerCtx,
  input: { eventId: string; npcId?: string; scale?: number; idempotencyKey?: string }
): boolean {
  const result = applySocialEvent(ctx.data.progression, ctx.player.stats, input);
  if (!result.applied) return false;
  ctx.data.progression = result.progression;
  ctx.player.stats = result.stats;
  ctx.data.stats = result.stats;
  if (input.npcId) {
    const name = contentRegistry.npcs.get(input.npcId)?.name ?? input.npcId;
    ctx.data.progression = withBondJournal(ctx.data.progression, input.npcId, name);
  }
  ctx.sendProgression(ctx.client, ctx.data.progression);
  const lines = [...new Set([result.feedback, result.notable].filter((line): line is string => !!line))];
  if (lines.length) {
    ctx.client.send('notification', {
      type: 'notification',
      message: lines.join(' '),
      level: 'info',
    });
  }
  return true;
}

export function handleDialogueProgression(
  ctx: HandlerCtx,
  dialogueTreeId: string,
  relationshipDelta?: number,
  npcId?: string,
  socialEvent?: string
): void {
  const { data, player } = ctx;
  const tree = dialogueSystemGetNpcId(dialogueTreeId);
  const resolvedNpcId = npcId ?? tree;

  if (relationshipDelta && resolvedNpcId) {
    const track = reputationTrackForNpc(resolvedNpcId);
    // Positive relationship deltas use help_npc / study weights; negative use harm.
    const sourceId = relationshipDelta >= 0 ? 'help_npc' : 'harm_npc';
    const applied = applyReputationSource(player.stats, track, sourceId, {
      npcId: resolvedNpcId,
      scale: Math.abs(relationshipDelta) / 2,
    });
    // Fall back to raw delta on the inferred track when content source is missing.
    player.stats =
      applied.source != null
        ? applied.stats
        : applyReputation(player.stats, relationshipDelta, track);
    data.stats = player.stats;
  }

  if (resolvedNpcId) {
    if (socialEvent) {
      applyPlayerSocialEvent(ctx, { eventId: socialEvent, npcId: resolvedNpcId });
    }
    if (relationshipDelta) {
      applyPlayerSocialEvent(ctx, {
        eventId: relationshipDelta > 0 ? 'dialogue_regard' : 'dialogue_slight',
        npcId: resolvedNpcId,
        scale: Math.abs(relationshipDelta),
      });
    }
    const npc = contentRegistry.npcs.get(resolvedNpcId);
    data.progression = withBondJournal(data.progression, resolvedNpcId, npc?.name ?? resolvedNpcId);
  }

  if (resolvedNpcId === 'npc_mara' && !data.progression.questProgress.quest_first_steps) {
    const before = data.progression.questProgress.quest_first_steps;
    data.progression = questSystem.startQuest(data.progression, 'quest_first_steps', player.stats);
    if (!before && data.progression.questProgress.quest_first_steps) {
      grantXp(ctx, 'quest_stage');
    }
  }

  syncRecognition(ctx);
  ctx.sendProgression(ctx.client, data.progression);
  checkSpecialtyOffer(ctx.client, player.stats);
}

function dialogueSystemGetNpcId(dialogueTreeId: string): string | undefined {
  const tree = contentRegistry.dialogues.get(dialogueTreeId);
  return tree?.npcId;
}

export function handleUseItemProgression(ctx: HandlerCtx, itemId: string): boolean {
  const itemDef = contentRegistry.ingredients.get(itemId);
  if (!itemDef) return false;

  if (itemDef.category === 'books') {
    const book = BOOK_CONTENT[itemId];
    if (!book) {
      ctx.client.send('notification', {
        type: 'notification',
        message: 'The pages resist your reading.',
        level: 'error',
      });
      return true;
    }
    ctx.client.send('book_open', { bookId: itemId, pages: book.pages, title: itemDef.name });
    return true;
  }
  return false;
}

export function handleReadBookComplete(ctx: HandlerCtx, bookId: string): void {
  const book = BOOK_CONTENT[bookId];
  if (!book) return;
  const { data, player } = ctx;
  if (data.progression.readBooks.includes(bookId)) {
    ctx.client.send('notification', {
      type: 'notification',
      message: 'You have already studied this text.',
      level: 'info',
    });
    return;
  }

  data.progression = {
    ...data.progression,
    readBooks: [...data.progression.readBooks, bookId],
  };
  if (book.discoverItems?.length) {
    data.progression = discoverCorrespondences(data.progression, book.discoverItems);
  }

  let stats = player.stats;
  if (book.statBoost) {
    for (const [k, v] of Object.entries(book.statBoost)) {
      const techKey = resolveTechnicalSkillKey(k);
      if (techKey) {
        const granted = grantSkillXp(stats, data.progression, techKey, Math.max(1, Math.round(v * 12)));
        stats = granted.stats;
        data.progression = granted.progression;
        continue;
      }
      const key = k as keyof PlayerStats;
      if (typeof stats[key] === 'number') {
        stats = {
          ...stats,
          [key]: clampPlayerStatValue(key, (stats[key] as number) + v, stats.experience),
        };
      }
    }
  }
  if (book.affinity) {
    stats = {
      ...stats,
      affinities: {
        ...stats.affinities,
        [book.affinity]: (stats.affinities[book.affinity] ?? 0) + 3,
      },
    };
  }
  player.stats = normalizePlayerStats(stats);
  data.progression = data.progression;
  const xp = grantExperience(player.stats, data.progression, 'read_book', {
    tradition: book.affinity,
  });
  player.stats = xp.stats;
  data.progression = xp.progression;

  syncRecognition(ctx);
  ctx.sendProgression(ctx.client, data.progression);
  ctx.sendPlayerSync(ctx.client, player);
  checkSpecialtyOffer(ctx.client, player.stats);
  notifyXp(ctx, xp.granted, xp.leveledUp, xp.levelAfter, xp.source?.label ?? 'Study');
  ctx.client.send('notification', {
    type: 'notification',
    message: `Finished reading — correspondences and insights recorded in your journal.`,
    level: 'success',
  });
}

export function handleChooseSpecialty(ctx: HandlerCtx, specialty: MagicTradition): void {
  // TEMPORARY: tradition specialty choice deactivated until tradition packs ship.
  void specialty;
  ctx.client.send('notification', {
    type: 'notification',
    message: 'Magical paths are not open yet.',
    level: 'info',
  });
  return;
  /*
  const { player, data } = ctx;
  if (player.stats.specialty) {
    ctx.client.send('notification', { type: 'notification', message: 'Specialty already chosen.', level: 'error' });
    return;
  }
  const eligible = eligibleSpecialtyTraditions(player.stats.affinities);
  if (!eligible.includes(specialty)) {
    ctx.client.send('notification', { type: 'notification', message: 'Affinity too low for that tradition.', level: 'error' });
    return;
  }
  player.stats = { ...player.stats, specialty };
  data.stats = player.stats;
  syncRecognition(ctx);
  ctx.sendPlayerSync(ctx.client, player);
  ctx.sendProgression(ctx.client, data.progression);
  ctx.client.send('notification', {
    type: 'notification',
    message: `You have claimed the ${specialty.replace(/_/g, ' ')} path.`,
    level: 'success',
  });
  */
}

export function handleCraftRecipe(ctx: HandlerCtx, recipeId: string): void {
  const { player, data, client } = ctx;
  const result = craftingSystem.craft(recipeId, player.inventory, data.progression, player.stats);
  if (!result.ok) {
    client.send('notification', { type: 'notification', message: result.error ?? 'Craft failed.', level: 'error' });
    return;
  }
  player.inventory = result.inventory!;
  data.progression = result.progression!;
  const recipe = craftingSystem.recipes.get(recipeId);
  data.progression = withGrimoire(data.progression, (grimoire) => {
    const studied = recipe?.spellId ? recordGrimoireStudied(grimoire, recipe.spellId) : grimoire;
    const made = result.outputItemId ? [{ itemId: result.outputItemId, count: recipe?.output?.quantity ?? 1 }] : [];
    return recordGrimoireIngredients(studied, made);
  });
  if (result.stats) player.stats = result.stats;
  grantXp(ctx, 'craft_success');
  ctx.sendProgression(client, data.progression);
  ctx.sendPlayerSync(client, player);
  client.send('notification', {
    type: 'notification',
    message: result.message ?? 'Craft complete.',
    level: 'success',
  });
}

export function handleCastPocketSpell(ctx: HandlerCtx, pocketId: string, targetPlayerId?: string): void {
  const { player, data, client } = ctx;
  const pocket = data.progression.pocketSpells.find((p) => p.id === pocketId);
  if (!pocket) {
    client.send('notification', { type: 'notification', message: 'Pocket spell not found.', level: 'error' });
    return;
  }

  const spell = contentRegistry.spells.get(pocket.spellId);
  const recipientSessionId = targetPlayerId ?? client.sessionId;
  const resolved = ctx.resolvePlayer?.(recipientSessionId);
  if (!resolved) {
    client.send('notification', { type: 'notification', message: 'Target not in reach.', level: 'error' });
    return;
  }

  const targetIsSelf = recipientSessionId === client.sessionId;
  if (!targetIsSelf) {
    if (resolved.player.scene !== player.scene) {
      client.send('notification', { type: 'notification', message: 'Target is not in the same place as you.', level: 'error' });
      return;
    }
    const dx = Math.abs(resolved.player.x - player.x);
    const dy = Math.abs(resolved.player.y - player.y);
    if (dx > 24 || dy > 24) {
      client.send('notification', { type: 'notification', message: 'Target is too far — move closer to touch range.', level: 'error' });
      return;
    }
  }

  const beforeQuest = data.progression.questProgress.quest_first_steps?.completedAt;
  const targetBook = targetIsSelf ? undefined : ctx.progressionFor?.(recipientSessionId)?.grimoire;
  const grimoireWard = !targetIsSelf && spell ? malevolentGrimoireWard(targetBook, spell) : 0;
  const outcome = resolveAndReleasePocketSpell(
    pocket,
    data.progression,
    player.stats,
    resolved.player.stats,
    resolved.player.aura as AuraState,
    targetIsSelf,
    player.aura as AuraState,
    grimoireWard
  );

  if (!('cast' in outcome)) {
    client.send('notification', { type: 'notification', message: outcome.error ?? 'Release failed.', level: 'error' });
    return;
  }

  const { cast, resolution, appliedToTarget } = outcome;
  data.progression = cast.progression!;
  if (cast.spellId) {
    data.progression = withGrimoire(data.progression, (grimoire) => recordGrimoireCast(grimoire, cast.spellId!, true));
  }
  player.stats = cast.stats!;

  if (appliedToTarget) {
    const applied = applyPocketSpellToRecipient(
      cast.spellId!,
      resolution.effectivePotency,
      resolved.player.stats,
      resolved.player.aura as AuraState,
      player.dbPlayerId,
      player.displayName
    );
    resolved.player.stats = applied.stats;
    resolved.player.aura = applied.aura;
  }

  void logSpellCast(
    player.dbPlayerId,
    cast.spellId!,
    appliedToTarget,
    Math.round(resolution.effectivePotency),
    recipientSessionId
  );
  if (appliedToTarget) {
    data.progression = questSystem.onSpellCast(data.progression, cast.spellId!);
  }
  const afterQuest = data.progression.questProgress.quest_first_steps?.completedAt;
  if (!beforeQuest && afterQuest) completeQuestRewards(ctx, 'quest_first_steps');

  ctx.sendProgression(client, data.progression);
  ctx.sendPlayerSync(client, player);

  if (resolved.client && !targetIsSelf) {
    if (appliedToTarget) ctx.sendPlayerSync(resolved.client, resolved.player);
    resolved.client.send('pocket_spell_result', {
      type: 'pocket_spell_result',
      success: appliedToTarget,
      blocked: resolution.blocked,
      partial: resolution.partial,
      detected: resolution.detected,
      fromName: player.displayName,
      spellId: cast.spellId,
      message: appliedToTarget
        ? `${player.displayName} releases ${spell?.name ?? cast.spellId} upon you.`
        : resolution.blocked
          ? `A pocket working glances off your wards.`
          : `${player.displayName}'s pocket working falters before it takes hold.`,
    });
    if (resolution.detected) {
      resolved.client.send('notification', {
        type: 'notification',
        message: 'You sense a pocket working directed at you…',
        level: 'warn',
      });
    }
  }

  client.send('pocket_spell_result', {
    type: 'pocket_spell_result',
    success: appliedToTarget,
    blocked: resolution.blocked,
    partial: resolution.partial,
    backlash: resolution.backlashTriggered,
    detected: resolution.detected,
    potency: Math.round(resolution.effectivePotency),
    spellId: cast.spellId,
    message: resolution.message,
    detail: resolution.detailMessage,
  });

  if (appliedToTarget) {
    const skill = grantSkillXp(player.stats, data.progression, 'ritualSkill', 4);
    player.stats = skill.stats;
    data.progression = skill.progression;
    ctx.sendProgression(client, data.progression);
    ctx.sendPlayerSync(client, player);
  }
  // HUD shows “Working Complete” from pocket_spell_result — avoid a duplicate Notice toast.
}

export function handleExperiment(ctx: HandlerCtx, itemIds: string[]): void {
  const { player, data, client } = ctx;
  const result = craftingSystem.experiment(itemIds, player.inventory, data.progression);
  if (!result.ok) {
    client.send('notification', { type: 'notification', message: result.error ?? 'Experiment failed.', level: 'error' });
    return;
  }
  data.progression = result.progression!;
  grantXp(ctx, 'experiment_success');
  grantXp(ctx, 'discover_correspondence');
  ctx.sendProgression(client, data.progression);
  ctx.sendPlayerSync(client, player);
  client.send('notification', {
    type: 'notification',
    message: result.message ?? 'You note new correspondences in your journal.',
    level: 'success',
  });
}

export function handleInteractCrafting(
  ctx: HandlerCtx,
  stationType: string,
  interactableId: string
): void {
  if (stationType === 'enchanting_table') {
    handleInteractHexagram(ctx, interactableId);
    return;
  }
  const { client } = ctx;
  const recipes = craftingSystem.listKnownRecipes(ctx.data.progression, stationType);
  client.send('open_ui', {
    ui: 'crafting',
    stationType,
    interactableId,
    recipes: recipes.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      inputs: r.inputs,
      output: r.output,
      effect: r.effect ?? 'item',
      meCost: r.meCost,
      minLevel: r.minLevel ?? 1,
    })),
  });
}

export function handleInteractHexagram(ctx: HandlerCtx, interactableId: string): void {
  const { client } = ctx;
  const recipes = hexagramEnchantSystem.listKnown(ctx.data.progression);
  client.send('open_ui', {
    ui: 'hexagram',
    interactableId,
    recipes: recipes.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      description: r.description,
      declarationTemplates: r.declarationTemplates,
      difficulty: r.difficulty,
      meCost: r.meCost,
      powerTier: r.powerTier,
      preparedUses: r.preparedUses,
      activationMethod: r.activationMethod,
      durationLabel: r.durationLabel,
      requiredSkill: r.requiredSkill,
      sockets: r.sockets,
      augmentations: r.augmentations ?? [],
      effect: r.effect,
      spellId: r.spellId,
      visualTheme: r.visualTheme,
      minLevel: r.minLevel ?? 1,
    })),
  });
}

export function handleHexagramEnchant(
  ctx: HandlerCtx,
  payload: {
    recipeId: string;
    sockets: Partial<Record<string, string>>;
    augmentations: string[];
    declaration: string;
  }
): void {
  const { client, player, data } = ctx;
  const result = hexagramEnchantSystem.enchant(
    {
      recipeId: payload.recipeId,
      sockets: payload.sockets as HexagramEnchantPayload['sockets'],
      augmentations: payload.augmentations,
      declaration: payload.declaration,
    },
    player.inventory,
    data.progression,
    player.stats,
    player.aura as AuraState
  );
  if (!result.ok) {
    if (result.inventory) player.inventory = result.inventory;
    if (result.progression) data.progression = result.progression;
    if (result.stats) player.stats = result.stats;
    ctx.sendProgression(client, data.progression);
    ctx.sendPlayerSync(client, player);
    const failMessage = result.message ?? result.error ?? 'The working fails.';
    client.send('hexagram_result', {
      success: false,
      unstable: result.unstable ?? false,
      message: failMessage,
    });
    client.send('chat', {
      from: 'System',
      message: failMessage,
      channel: 'system',
      timestamp: Date.now(),
    });
    return;
  }
  player.inventory = result.inventory!;
  data.progression = result.progression!;
  const prepared = hexagramEnchantSystem.recipes.get(payload.recipeId);
  if (prepared?.spellId) {
    data.progression = withGrimoire(data.progression, (grimoire) => recordGrimoireStudied(grimoire, prepared.spellId!));
  }
  if (result.stats) player.stats = result.stats;
  const recipe = hexagramEnchantSystem.recipes.get(payload.recipeId);
  grantXp(ctx, recipe?.effect === 'pocket_spell' ? 'pocket_spell_prepare' : 'hexagram_enchant');
  ctx.sendProgression(client, data.progression);
  ctx.sendPlayerSync(client, player);
  const successMessage = result.message ?? 'Enchantment complete.';
  client.send('hexagram_result', {
    success: true,
    unstable: result.unstable ?? false,
    message: successMessage,
    preview: result.preview,
  });
  client.send('chat', {
    from: 'System',
    message: successMessage,
    channel: 'system',
    timestamp: Date.now(),
  });
}

export function handleInteractCleanser(ctx: HandlerCtx): void {
  const { client, player, data } = ctx;
  const { aura: stripped, removed, totalRemoved } = applyCleanserToAura(player.aura);

  player.aura = auraSystem.applyMoralityDelta(stripped, -CLEANSER_MORALITY_COST);
  player.stats = {
    ...player.stats,
    morality: Math.max(-100, Math.min(100, player.stats.morality - CLEANSER_MORALITY_COST)),
  };
  data.aura = player.aura;

  ctx.refreshWardWeb?.(client.sessionId);
  ctx.sendPlayerSync(client, player);

  client.send('chat', {
    from: 'System',
    message: formatCleanserMessage(removed, totalRemoved),
    channel: 'system',
    timestamp: Date.now(),
  });
}

export function checkInteractAvailable(
  interactableType: string,
  data: Record<string, unknown> | undefined,
  interactableId: string
): { available: boolean; message?: string } {
  return isInteractableNpcAvailable(interactableType, data, interactableId);
}

export async function tickStudyCircleEvents(clients: Client[]): Promise<void> {
  const hour = getWorldHour();
  if (hour !== 18) return;
  let active = false;
  try {
    const event = await prisma.contentEvent.findFirst({
      where: { active: true, slug: { contains: 'study' } },
    });
    active = !!event;
  } catch {
    active = hour === 18;
  }
  if (!active) return;
  for (const client of clients) {
    client.send('notification', {
      type: 'notification',
      message: 'The study circle gathers at the park — Rowan awaits practitioners.',
      level: 'info',
    });
  }
}

export function completeQuestRewards(ctx: HandlerCtx, questId: string): void {
  const quest = questSystem.quests.get(questId);
  if (!quest) return;
  const { player, data } = ctx;
  if (quest.rewards?.items) {
    let inv = player.inventory;
    for (const item of quest.rewards.items) {
      inv = addItemToInventory(inv, item.itemId, item.quantity);
    }
    player.inventory = inv;
    data.progression = withGrimoire(data.progression, (grimoire) =>
      recordGrimoireIngredients(
        grimoire,
        quest.rewards?.items?.map((item) => ({ itemId: item.itemId, count: item.quantity })) ?? []
      )
    );
  }
  if (quest.rewards?.stats) {
    let stats = player.stats;
    for (const [k, v] of Object.entries(quest.rewards.stats)) {
      const key = k as keyof PlayerStats;
      if (typeof stats[key] === 'number') {
        stats = { ...stats, [key]: clampPlayerStatValue(key, (stats[key] as number) + v, stats.experience) };
      }
    }
    player.stats = stats;
  }
  const publicRepReward = quest.rewards?.publicReputation ?? quest.rewards?.reputation;
  if (publicRepReward) {
    const source =
      publicRepReward >= 0
        ? applyReputationSource(player.stats, 'public', 'quest_mundane_success', {
            scale: Math.abs(publicRepReward) / 5,
          })
        : applyReputationSource(player.stats, 'public', 'rumor_scandal', {
            scale: Math.abs(publicRepReward) / 6,
          });
    player.stats =
      source.source != null ? source.stats : applyReputation(player.stats, publicRepReward, 'public');
  }

  let spiritualRepReward = quest.rewards?.spiritualReputation;
  if (
    spiritualRepReward == null &&
    quest.rewards?.reputation &&
    (questId.includes('circle') || questId.includes('rowan') || questId.includes('study'))
  ) {
    spiritualRepReward = Math.ceil(quest.rewards.reputation * 0.6);
  }
  if (spiritualRepReward) {
    const source = applyReputationSource(player.stats, 'spiritual', 'quest_spiritual_success', {
      scale: Math.abs(spiritualRepReward) / 6,
    });
    player.stats =
      source.source != null
        ? source.stats
        : applyReputation(player.stats, spiritualRepReward, 'spiritual');
  }
  if (quest.rewards?.licenses?.length) {
    data.progression = grantLicenses(data.progression, quest.rewards.licenses);
  }
  if (quest.npcId) {
    applyPlayerSocialEvent(ctx, {
      eventId: 'quest_complete',
      npcId: quest.npcId,
      idempotencyKey: questId,
    });
    const faction = contentRegistry.npcs.get(quest.npcId)?.faction;
    if (faction) {
      applyPlayerSocialEvent(ctx, {
        eventId: `faction_${faction}`,
        npcId: quest.npcId,
        idempotencyKey: questId,
      });
    }
  }
  data.stats = player.stats;
  if (quest.rewards) grantXp(ctx, 'quest_complete');
  syncRecognition(ctx);
  ctx.sendProgression(ctx.client, data.progression);
  ctx.sendPlayerSync(ctx.client, player);
}
