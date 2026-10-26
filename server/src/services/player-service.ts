import type {
  AltarState,
  AuraEffect,
  AuraState,
  FamiliarState,
  FriendEntry,
  FriendRequest,
  InventorySlot,
  PlayerLocation,
  PlayerStats,
  SceneId,
  WardState,
} from '@witchcraft/shared';
import {
  DEFAULT_STATS,
  applyReputationDecay,
  extendedStatsNeedsMigration,
  extendedStatsRecord,
  gameDaysBetween,
  normalizePlayerStats,
} from '@witchcraft/shared';
import { migrateInventoryToGrid, loadInventoryFromDbRows, applySlotIndicesForSave, addItemToInventory } from '@witchcraft/shared';
import { parseProgression, defaultProgression, type PlayerProgression } from '@witchcraft/shared';
import { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { familiarSystem } from '../systems/familiar-system.js';
import { parseFriendRequests, parseFriends } from '../systems/friend-system.js';
import { defaultAltar, defaultAura } from '../schemas/game-state.js';

export interface PersistedPlayer {
  dbPlayerId: string;
  username: string;
  displayName: string;
  stats: PlayerStats;
  inventory: InventorySlot[];
  altar: AltarState;
  aura: AuraState;
  coins: number;
  familiar: FamiliarState | null;
  wards: WardState[];
  metPlayers: { playerId: string; username: string; displayName: string; metAt: number }[];
  friends: FriendEntry[];
  friendRequests: FriendRequest[];
  location: PlayerLocation;
  progression: PlayerProgression;
}

const STARTER_INVENTORY: InventorySlot[] = [
  { itemId: 'white_candle', quantity: 2 },
  { itemId: 'rosemary', quantity: 3 },
  { itemId: 'salt', quantity: 2 },
  { itemId: 'bay_leaf', quantity: 2 },
  { itemId: 'written_petition', quantity: 1 },
  { itemId: 'familiar_food', quantity: 3 },
  { itemId: 'familiar_knot', quantity: 1 },
];

/** Load or create a player record — falls back to defaults if DB is unavailable */
export async function loadOrCreatePlayer(
  username: string,
  displayName?: string
): Promise<PersistedPlayer> {
  try {
    let player = await prisma.player.findUnique({
      where: { username: username.toLowerCase() },
      include: {
        stats: true,
        inventory: true,
        apartment: true,
        aura: true,
        familiar: true,
        wards: { where: { active: true } },
      },
    });

    if (!player) {
      const fresh = normalizePlayerStats({ ...DEFAULT_STATS });
      await prisma.player.create({
        data: {
          username: username.toLowerCase(),
          displayName: displayName ?? username,
          stats: {
            create: {
              health: fresh.health,
              hunger: fresh.hunger,
              magicalEnergy: fresh.magicalEnergy,
              protection: fresh.protection,
              intuition: fresh.intuition,
              spiritualAwareness: fresh.spiritualAwareness,
              divinationSkill: fresh.divinationSkill,
              herbalism: fresh.herbalism,
              cursecraft: fresh.cursecraft,
              warding: fresh.warding,
              healing: fresh.healing,
              ritualSkill: fresh.ritualSkill,
              experience: fresh.experience,
              reputation: fresh.reputation,
              morality: fresh.morality,
              affinities: fresh.affinities as Prisma.InputJsonValue,
              extendedStats: extendedStatsRecord(fresh) as Prisma.InputJsonValue,
            },
          },
          apartment: { create: { altarState: defaultAltar() as unknown as Prisma.InputJsonValue } },
          aura: { create: { effects: [] } },
          inventory: { create: STARTER_INVENTORY.map((i) => ({ itemId: i.itemId, quantity: i.quantity })) },
        },
      });
      player = await prisma.player.findUnique({
        where: { username: username.toLowerCase() },
        include: {
          stats: true,
          inventory: true,
          apartment: true,
          aura: true,
          familiar: true,
          wards: { where: { active: true } },
        },
      });
    }

    if (!player) {
      throw new Error('Failed to load or create player');
    }

    const stats = player.stats!;
    const affinities =
      typeof stats.affinities === 'object' && stats.affinities !== null
        ? (stats.affinities as PlayerStats['affinities'])
        : DEFAULT_STATS.affinities;

    const auraMorality = player.aura?.moralityScore;
    const resolvedMorality = Number.isFinite(auraMorality)
      ? Math.max(-100, Math.min(100, auraMorality as number))
      : stats.morality;

    // Extended attributes (stamina + new mental/technical) are stored in a single
    // JSON column so no destructive column churn is needed. Older rows lack it →
    // normalizePlayerStats fills safe defaults.
    const rawExtended = (stats as { extendedStats?: unknown }).extendedStats;
    const extended =
      rawExtended && typeof rawExtended === 'object' ? (rawExtended as Record<string, unknown>) : {};

    let playerStats = normalizePlayerStats({
      health: stats.health,
      hunger: stats.hunger,
      magicalEnergy: stats.magicalEnergy,
      protection: stats.protection,
      intuition: stats.intuition,
      spiritualAwareness: stats.spiritualAwareness,
      divinationSkill: stats.divinationSkill,
      herbalism: stats.herbalism,
      cursecraft: stats.cursecraft,
      warding: stats.warding,
      healing: stats.healing,
      ritualSkill: stats.ritualSkill,
      experience: stats.experience,
      reputation: stats.reputation,
      morality: resolvedMorality,
      affinities,
      specialty: stats.specialty as PlayerStats['specialty'],
      ...extended,
    });

    const daysAway = gameDaysBetween(player.lastLoginAt);
    const decayed = applyReputationDecay(playerStats, daysAway);
    const reputationChanged =
      decayed.publicReputation !== playerStats.publicReputation ||
      decayed.spiritualReputation !== playerStats.spiritualReputation ||
      decayed.reputation !== playerStats.reputation;
    playerStats = decayed;

    // Older rows have extendedStats {} — write the backfilled stamina/mental stats once.
    // Also persist reputation drift after idle days away from the game.
    if (extendedStatsNeedsMigration(rawExtended) || reputationChanged) {
      try {
        await prisma.playerStats.update({
          where: { playerId: player.id },
          data: {
            reputation: playerStats.reputation,
            extendedStats: extendedStatsRecord(playerStats) as Prisma.InputJsonValue,
          },
        });
      } catch (migrateErr) {
        console.warn('[PlayerService] extended stats migration skipped:', migrateErr);
      }
    }

    try {
      await prisma.player.update({
        where: { id: player.id },
        data: { lastLoginAt: new Date() },
      });
    } catch (loginStampErr) {
      console.warn('[PlayerService] lastLoginAt stamp skipped:', loginStampErr);
    }

    const familiar: FamiliarState | null = player.familiar
      ? {
          id: player.familiar.id,
          species: player.familiar.species as FamiliarState['species'],
          templateId: player.familiar.templateId,
          publicName: player.familiar.publicName,
          trueName: player.familiar.trueName,
          hunger: player.familiar.hunger,
          affection: player.familiar.affection,
          energy: player.familiar.energy,
          spiritualStability: player.familiar.spiritualStability,
          loyalty: player.familiar.loyalty,
          experience: player.familiar.experience ?? 0,
          level: player.familiar.level ?? 1,
          mainFunction: player.familiar.mainFunction ?? 'general',
          chosen: player.familiar.chosen ?? false,
          ownerId: player.id,
          lastBondAt: player.familiar.lastBondAt?.getTime(),
          protections: (player.familiar.protections as unknown as FamiliarState['protections']) ?? [],
        }
      : null;

    const metPlayers = Array.isArray(player.metPlayers)
      ? (player.metPlayers as PersistedPlayer['metPlayers'])
      : [];

    const rawEffects = (player.aura?.effects as unknown as AuraEffect[]) ?? [];
    const aura: AuraState = {
      alignment: (player.aura?.alignment as AuraState['alignment']) ?? 'neutral',
      moralityScore: player.aura?.moralityScore ?? 0,
      blessings: rawEffects.filter((e) => e.type === 'blessing'),
      hexes: rawEffects.filter((e) => e.type === 'hex'),
      attachments: rawEffects.filter((e) => e.type === 'attachment'),
      parasites: rawEffects.filter((e) => e.type === 'parasite'),
      protections: rawEffects.filter((e) => e.type === 'protection'),
      wards: rawEffects.filter((e) => e.type === 'ward'),
      curseResidue: rawEffects.filter((e) => e.type === 'curse_residue'),
      energeticDamage: rawEffects
        .filter((e) => e.type === 'energetic_damage')
        .reduce((sum, e) => sum + e.strength, 0),
      familiarLink: familiar ? { familiarId: familiar.id, strength: familiar.loyalty / 100 } : undefined,
    };

    const altar = (player.apartment?.altarState as unknown as AltarState) ?? defaultAltar();

    return {
      dbPlayerId: player.id,
      username: player.username,
      displayName: player.displayName,
      stats: playerStats,
      inventory: migrateInventoryToGrid(
        loadInventoryFromDbRows(
          player.inventory.map((i: { itemId: string; quantity: number; metadata: unknown }) => ({
            itemId: i.itemId,
            quantity: i.quantity,
            metadata: (i.metadata as Record<string, unknown>) ?? undefined,
          }))
        )
      ),
      altar,
      aura,
      coins: 100,
      familiar,
      wards: player.wards.map((w: {
        id: string; targetType: string; targetId: string; strength: number;
        duration: number; maintenanceCost: number; feedingRequirement: string | null;
        ingredientIds: unknown; vulnerabilities: unknown; creatorId: string;
        detectionDifficulty: number; expiresAt: Date | null; permanent?: boolean;
      }) => ({
        id: w.id,
        targetType: w.targetType as WardState['targetType'],
        targetId: w.targetId,
        strength: w.strength,
        duration: w.duration,
        maintenanceCost: w.maintenanceCost,
        feedingRequirement: w.feedingRequirement ?? undefined,
        ingredientRequirement: (w.ingredientIds as string[]) ?? [],
        vulnerabilities: (w.vulnerabilities as string[]) ?? [],
        creatorId: w.creatorId,
        detectionDifficulty: w.detectionDifficulty,
        expiresAt: w.expiresAt?.getTime(),
        permanent: w.permanent ?? false,
      })),
      metPlayers,
      friends: parseFriends(player.friends),
      friendRequests: parseFriendRequests(player.friendRequests),
      location: {
        scene: ((stats as { scene?: string }).scene as SceneId) ?? 'apartment',
        x: (stats as { posX?: number }).posX ?? 8,
        y: (stats as { posY?: number }).posY ?? 10,
        spawnId: (stats as { spawnId?: string }).spawnId ?? 'default',
        visitingHostDbPlayerId: (stats as { visitingHostId?: string }).visitingHostId ?? undefined,
      },
      progression: parseProgression(player.progression),
    };
  } catch (err) {
    console.warn('[PlayerService] DB unavailable, using session defaults:', err);
    return {
      dbPlayerId: '',
      username: username.toLowerCase(),
      displayName: displayName ?? username,
      stats: { ...DEFAULT_STATS },
      inventory: migrateInventoryToGrid([...STARTER_INVENTORY]),
      altar: defaultAltar(),
      aura: defaultAura(),
      coins: 100,
      familiar: null,
      wards: [],
      metPlayers: [],
      friends: [],
      friendRequests: [],
      location: { scene: 'apartment', x: 8, y: 10, spawnId: 'default' },
      progression: defaultProgression(),
    };
  }
}

/** Persist player state on disconnect */
export async function savePlayer(data: PersistedPlayer): Promise<void> {
  if (!data.dbPlayerId) return;

  try {
    const stats = normalizePlayerStats(data.stats);
    await prisma.playerStats.update({
      where: { playerId: data.dbPlayerId },
      data: {
        health: stats.health,
        hunger: stats.hunger,
        magicalEnergy: stats.magicalEnergy,
        protection: stats.protection,
        intuition: stats.intuition,
        spiritualAwareness: stats.spiritualAwareness,
        divinationSkill: stats.divinationSkill,
        herbalism: stats.herbalism,
        cursecraft: stats.cursecraft,
        warding: stats.warding,
        healing: stats.healing,
        ritualSkill: stats.ritualSkill,
        experience: stats.experience,
        reputation: stats.reputation,
        morality: stats.morality,
        affinities: stats.affinities,
        extendedStats: extendedStatsRecord(stats) as Prisma.InputJsonValue,
        specialty: stats.specialty ?? null,
        scene: data.location.scene,
        posX: data.location.x,
        posY: data.location.y,
        spawnId: data.location.spawnId,
        visitingHostId: data.location.visitingHostDbPlayerId ?? null,
      },
    });

    await prisma.inventoryItem.deleteMany({ where: { playerId: data.dbPlayerId } });
    const slotsToSave = applySlotIndicesForSave(data.inventory).filter((s) => s.itemId && s.quantity > 0);
    if (slotsToSave.length) {
      await prisma.inventoryItem.createMany({
        data: slotsToSave.map((i) => ({
          playerId: data.dbPlayerId,
          itemId: i.itemId,
          quantity: i.quantity,
          metadata: (i.metadata as Prisma.InputJsonValue) ?? undefined,
        })),
      });
    }

    await prisma.apartment.update({
      where: { playerId: data.dbPlayerId },
      data: { altarState: data.altar as unknown as Prisma.InputJsonValue },
    });

    const allEffects = [
      ...data.aura.blessings,
      ...data.aura.hexes,
      ...data.aura.attachments,
      ...data.aura.parasites,
      ...data.aura.protections,
      ...data.aura.wards,
      ...data.aura.curseResidue,
    ];

    await prisma.aura.update({
      where: { playerId: data.dbPlayerId },
      data: {
        alignment: data.aura.alignment,
        moralityScore: data.aura.moralityScore,
        effects: allEffects as unknown as Prisma.InputJsonValue,
      },
    });

    if (data.familiar) {
      await prisma.familiar.upsert({
        where: { playerId: data.dbPlayerId },
        create: {
          playerId: data.dbPlayerId,
          species: data.familiar.species,
          templateId: data.familiar.templateId,
          publicName: data.familiar.publicName,
          trueName: data.familiar.trueName,
          hunger: data.familiar.hunger,
          affection: data.familiar.affection,
          energy: data.familiar.energy,
          spiritualStability: data.familiar.spiritualStability,
          loyalty: data.familiar.loyalty,
          experience: data.familiar.experience,
          level: data.familiar.level,
          mainFunction: data.familiar.mainFunction,
          chosen: data.familiar.chosen,
          lastBondAt: data.familiar.lastBondAt ? new Date(data.familiar.lastBondAt) : null,
          protections: (data.familiar.protections ?? []) as unknown as Prisma.InputJsonValue,
        },
        update: {
          hunger: data.familiar.hunger,
          affection: data.familiar.affection,
          energy: data.familiar.energy,
          spiritualStability: data.familiar.spiritualStability,
          loyalty: data.familiar.loyalty,
          experience: data.familiar.experience,
          level: data.familiar.level,
          mainFunction: data.familiar.mainFunction,
          chosen: data.familiar.chosen,
          publicName: data.familiar.publicName,
          trueName: data.familiar.trueName,
          lastBondAt: data.familiar.lastBondAt ? new Date(data.familiar.lastBondAt) : null,
          protections: (data.familiar.protections ?? []) as unknown as Prisma.InputJsonValue,
        },
      });
    }

    await prisma.player.update({
      where: { id: data.dbPlayerId },
      data: {
        metPlayers: data.metPlayers as unknown as Prisma.InputJsonValue,
        friends: data.friends as unknown as Prisma.InputJsonValue,
        friendRequests: data.friendRequests as unknown as Prisma.InputJsonValue,
        progression: data.progression as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    console.error('[PlayerService] Save failed:', err);
  }
}

/** Log a spell cast to history */
export async function logSpellCast(
  playerId: string,
  spellId: string,
  success: boolean,
  potency: number,
  targetId?: string
): Promise<void> {
  if (!playerId) return;
  try {
    await prisma.spellCast.create({
      data: { playerId, spellId, targetId, success, potency },
    });
  } catch {
    /* non-fatal */
  }
}

/** Create a ward in DB — returns ward with database id */
export async function saveWard(
  playerId: string,
  ward: WardState
): Promise<WardState | null> {
  if (!playerId) return null;
  try {
    const rec = await prisma.ward.create({
      data: {
        creatorId: playerId,
        targetType: ward.targetType,
        targetId: ward.targetId,
        strength: ward.strength,
        duration: ward.duration,
        maintenanceCost: ward.maintenanceCost,
        feedingRequirement: ward.feedingRequirement,
        ingredientIds: ward.ingredientRequirement ?? [],
        vulnerabilities: ward.vulnerabilities,
        detectionDifficulty: ward.detectionDifficulty,
        expiresAt: ward.expiresAt ? new Date(ward.expiresAt) : undefined,
        permanent: ward.permanent ?? false,
      },
    });
    return { ...ward, id: rec.id };
  } catch {
    return null;
  }
}

/** Persist ward strength/expiry after feeding, decay, or combat */
export async function updateWard(ward: WardState): Promise<void> {
  try {
    await prisma.ward.update({
      where: { id: ward.id },
      data: {
        strength: ward.strength,
        expiresAt: ward.expiresAt ? new Date(ward.expiresAt) : null,
        permanent: ward.permanent ?? false,
        active: ward.strength > 0,
      },
    });
  } catch {
    /* ward may predate DB row */
  }
}

/** Mark a ward inactive when it expires or is broken */
export async function deactivateWard(wardId: string): Promise<void> {
  try {
    await prisma.ward.update({
      where: { id: wardId },
      data: { active: false, strength: 0 },
    });
  } catch {
    /* non-fatal */
  }
}
