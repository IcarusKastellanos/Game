import { Room, Client } from '@colyseus/core';
import type { ClientMessage, ContentMapDefinition, InventorySlot, TaglockType } from '@witchcraft/shared';
import {
  MAX_ITEM_STACK,
  migrateInventoryToGrid,
  normalizeInventoryLayout,
  isInventoryReorderValid,
  inscribeWrittenTaglock,
  countTaglocksForTarget,
  MAX_TAGLOCKS_PER_TARGET,
  inventorySlotCount,
  findFirstEmptySlotIndex,
  INVENTORY_MAX_SLOTS,
  clampMagicalEnergy,
  clampPlayerStatValue,
  normalizePlayerStats,
  magicalEnergyCap,
  NULLIFICATION_POWDER_ITEM_ID,
  syncLevelDerivedStats,
  isPlayerSilenced,
  SILENCED_CHAT_MESSAGE,
  computeBindingCastPenalty,
} from '@witchcraft/shared';
import { GameRoomState, PlayerSchema, defaultAltar, defaultAura } from '../schemas/game-state.js';
import { spellEngine } from '../systems/spell-engine.js';
import { familiarSystem } from '../systems/familiar-system.js';
import { applySpellEffectsToCaster } from '../systems/apply-spell-effects.js';
import { logSpellAttempt } from '../systems/spell-log.js';
import { applyShieldBreaker } from '../systems/shield-breaker.js';
import {
  computeWardWebCrossLink,
  resolveAmbientApartmentWards,
  resolveApartmentHostSessionId,
} from '../systems/ambient-ward.js';
import { tradeSystem } from '../systems/trade-system.js';
import {
  areFriends,
  buildFriendPresenceList,
  loadFriendData,
  removeFriend,
  respondFriendRequest,
  saveFriendData,
  sendFriendRequest,
} from '../systems/friend-system.js';
import { applyMeRegen, computeMeRegenAmount, meRegenIntervalMs } from '../systems/me-regen.js';
import {
  applySurvivalTick,
  hungerRegenMultiplier,
  MAX_HUNGER,
  grantExperience,
  shopPriceMultiplier,
  applyReputationSource,
  applyMoralityGossip,
  defaultProgression,
  meetsAssignedUnlock,
  assignedUnlockLevel,
  levelGateMessage,
  playerLevel,
  holdsActiveLicense,
  licenseGateMessage,
  licenseUnlocksPlace,
  licenseUnlocksNpc,
  findVowViolations,
  applyLicensureMarkPenalty,
  recoverLicensureMarks,
  applyReputationDelta,
  revocationReputationPenalty,
  activeLicenseIds,
  getLicense,
  backfillGrimoireIngredients,
  defaultGrimoire,
  GRIMOIRE_MANUSCRIPT_ITEM_ID,
  malevolentGrimoireWard,
  manuscriptMetadataFromPage,
  readManuscriptMeta,
  receiveSharedGrimoirePage,
  recordGrimoireCast,
  recordGrimoireIngredients,
  recordGrimoireNpc,
  shareSpellIntoGrimoire,
  takeInventorySlot,
  withGrimoire,
  type SurvivalActivity,
} from '@witchcraft/shared';
import { EVERWEED_INIT_ME_COST, feedWardTarget, ritualHasEverweed } from '../systems/ward-feeding.js';
import {
  createApartmentInvite,
  getApartmentInvite,
  removeApartmentInvite,
} from '../systems/apartment-invites.js';
import {
  findOnlineByDbPlayerId,
  findOnlineBySessionId,
  registerPresenceRoom,
  unregisterPresenceRoom,
} from '../systems/player-presence.js';
import type { SceneId } from '@witchcraft/shared';
import { inventorySystem, auraSystem, wardSystem } from '../systems/inventory-ward-aura.js';
import { localDayKey, shopSystem } from '../systems/shop-system.js';
import { applyNullificationPowder } from '../systems/nullification-powder.js';
import { contentRegistry } from '../content/registry.js';
import {
  loadOrCreatePlayer,
  savePlayer,
  logSpellCast,
  saveWard,
  updateWard,
  deactivateWard,
  type PersistedPlayer,
} from '../services/player-service.js';
import { prisma } from '../services/db.js';
import { dialogueSystem, resolveTaglockFromInventory } from '../systems/dialogue-system.js';
import { applySpellToTarget, placeWardAtPoint } from '../systems/ward-placement.js';
import { computeAltarBuffs } from '../systems/altar-buffs.js';
import { getIngameAdminByGameUsername } from '../admin/rbac.js';
import { executeCommand, listCommands } from '../admin/commands/registry.js';
import { handleIngameAdminPanel } from '../admin/ingame-panel.js';
import { setOnlinePlayerCount } from '../admin/services/dashboard.js';
import { assertPlayerAuth } from '../services/player-auth.js';
import { chatService, type ChatPayload } from '../services/chat-service.js';
import { censorChatMessage } from '../systems/chat-filter.js';
import { isManuscriptArchived, registerManuscriptExport } from '../systems/manuscript-registry.js';
import type { PermissionSlug } from '@witchcraft/shared';
import { registerGameRoom, unregisterGameRoom } from './game-room-registry.js';
import { SlidingWindowRateLimiter } from '../utils/rate-limit.js';
import {
  sendWorldState,
  handleDialogueProgression,
  handleUseItemProgression,
  handleReadBookComplete,
  handleChooseSpecialty,
  handleCastPocketSpell,
  handleCraftRecipe,
  handleHexagramEnchant,
  handleExperiment,
  handleInteractCrafting,
  handleInteractCleanser,
  checkInteractAvailable,
  tickStudyCircleEvents,
  completeQuestRewards,
  syncRecognition,
  type HandlerCtx,
} from './progression-handlers.js';
import { mergeGrimoireWrite, petitionGrimoireSpirit, recallGrimoireSpirit } from './grimoire-handlers.js';
import { tickWorldClock, getWorldHour } from '../systems/world-clock.js';
import { getUnavailableNpcInteractableIds } from '../systems/npc-schedule.js';
import { questSystem } from '../systems/quest-system.js';
import {
  craftStationTypeFromInteractable,
  isCraftingInteractable,
  TILE_SIZE,
  isWithinInteractRange,
  buildNpcInteractionOffers,
  dialogueChoiceId,
  nearestNpcInteractable,
  type MagicTradition,
  type MapInteractable,
} from '@witchcraft/shared';
// eligibleSpecialtyTraditions — TEMPORARY: tradition specialty offers deactivated

/** Max spell casts per player within the rolling window. */
const SPELL_CAST_RATE_LIMIT = 12;
const SPELL_CAST_RATE_WINDOW_MS = 60_000;

/**
 * Main multiplayer room — movement, scenes, spellcasting, persistence.
 */
export class GameRoom extends Room<GameRoomState> {
  maxClients = 32;
  private familiarStore = new Map<string, NonNullable<PersistedPlayer['familiar']>>();
  private playerData = new Map<string, PersistedPlayer>();
  private activeWards = new Map<string, ReturnType<typeof wardSystem.createWard>[]>();
  /** When visiting another player's apartment, stores host session id */
  private apartmentHostBySession = new Map<string, string>();
  private adminSessions = new Map<string, { userId: string; permissions: PermissionSlug[] }>();
  /** Admins in vanish mode — still online but hidden from non-admins */
  private vanishedSessions = new Set<string>();
  private lastMeRegenAt = new Map<string, number>();
  private lastLocationSaveAt = new Map<string, number>();
  /** Server-authoritative rest state for survival ticks (sleeping / eating). */
  private survivalActivity = new Map<string, SurvivalActivity>();
  /** Clears temporary `eating` activity after food use duration. */
  private eatingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private spellCastLimiter = new SlidingWindowRateLimiter(
    SPELL_CAST_RATE_LIMIT,
    SPELL_CAST_RATE_WINDOW_MS
  );

  private studyCircleNotifiedHour = -1;

  onCreate(options: { scene?: string; shard?: string }) {
    this.autoDispose = false;
    this.setState(new GameRoomState());
    this.state.scene = options.scene ?? 'world';

    const messages = [
      'move', 'change_scene', 'interact', 'cast_spell', 'altar_update',
      'buy_item', 'use_item', 'care_familiar', 'choose_familiar', 'collect_taglock',
      'whisper',
      'place_ward', 'inspect_aura', 'dialogue_choice', 'npc_talk', 'npc_action', 'chat', 'admin_command',
      'visit_apartment', 'leave_apartment',
      'apartment_invite', 'apartment_invite_response',
      'friend_request', 'friend_respond', 'friend_remove', 'friends_refresh',
      'feed_ward',
      'trade_request', 'trade_offer', 'trade_accept', 'trade_cancel',
      'inventory_reorder', 'inscribe_taglock',
      'choose_specialty', 'cast_pocket_spell',
      'craft_recipe', 'hexagram_enchant', 'experiment_ingredients', 'read_book_complete',
      'presence_ready',
      'grimoire_write', 'grimoire_share', 'grimoire_petition', 'grimoire_recall', 'grimoire_export',
      'admin_action',
    ] as const;

    for (const type of messages) {
      this.onMessage(type, (client, msg) =>
        this.handleMessage(client, { type, ...msg } as ClientMessage & { type: string })
      );
    }

    this.clock.setInterval(() => {
      this.state.tick++;
      tickWorldClock();
      for (const [sid, fam] of this.familiarStore) {
        this.familiarStore.set(sid, familiarSystem.tick(fam));
      }
      this.tickWards();
      const hour = getWorldHour();
      if (hour !== this.studyCircleNotifiedHour) {
        this.studyCircleNotifiedHour = hour;
        void tickStudyCircleEvents([...this.clients]);
        this.broadcast('world_state', {
          hour,
          hiddenNpcIds: getUnavailableNpcInteractableIds(),
        });
      }
      this.maybeRestockShopsAtNoon(hour);
    }, 30000);

    this.clock.setInterval(() => this.tickMeRegen(), 5000);
    this.clock.setInterval(() => this.tickSurvival(), 30000);

    this.clock.setInterval(() => {
      for (const sid of this.state.players.keys()) {
        void this.flushLocationToDb(sid);
      }
    }, 45000);

    console.log(`[GameRoom] Created for scene: ${this.state.scene}`);
    registerGameRoom(this);
    registerPresenceRoom(this);
  }

  onDispose(): void {
    unregisterGameRoom(this);
    unregisterPresenceRoom(this);
  }

  async onJoin(client: Client, options: { displayName?: string; username?: string; authToken?: string }) {
    const username = options.username ?? `guest_${client.sessionId.slice(0, 6)}`;
    const auth = await assertPlayerAuth(username, options.authToken);
    if (!auth.ok) {
      client.leave(4000, auth.reason);
      return;
    }

    const persisted = await loadOrCreatePlayer(username, options.displayName);

    persisted.inventory = migrateInventoryToGrid(persisted.inventory);

    const player = new PlayerSchema();
    player.id = client.sessionId;
    player.sessionId = client.sessionId;
    player.dbPlayerId = persisted.dbPlayerId;
    player.displayName = persisted.displayName;
    player.scene = persisted.location.scene;
    player.stats = normalizePlayerStats(persisted.stats);
    if (persisted.familiar) {
      player.stats = familiarSystem.applyBonuses(player.stats, persisted.familiar);
    }
    player.inventory = persisted.inventory;
    player.altar = persisted.altar;
    player.aura = persisted.aura;
    player.coins = persisted.coins;
    player.decorationsJson = '[]';
    player.x = persisted.location.x;
    player.y = persisted.location.y;

    if (
      persisted.location.visitingHostDbPlayerId &&
      persisted.location.visitingHostDbPlayerId !== persisted.dbPlayerId &&
      persisted.location.scene === 'apartment'
    ) {
      const hostOnline = findOnlineByDbPlayerId(persisted.location.visitingHostDbPlayerId);
      if (hostOnline) {
        this.apartmentHostBySession.set(client.sessionId, hostOnline.sessionId);
      } else {
        persisted.location = { ...persisted.location, visitingHostDbPlayerId: undefined };
      }
    }

    this.remapApartmentVisitorsForHost(client.sessionId, persisted.dbPlayerId);

    if (persisted.familiar) {
      this.familiarStore.set(client.sessionId, persisted.familiar);
      player.familiarId = persisted.familiar.id;
    }

    persisted.progression = shopSystem.ensureRestocked(
      persisted.progression,
      getWorldHour(),
      localDayKey()
    );
    persisted.progression = withGrimoire(persisted.progression, (grimoire) =>
      backfillGrimoireIngredients(
        grimoire,
        persisted.inventory.filter((slot) => slot.itemId && slot.quantity > 0).map((slot) => slot.itemId)
      )
    );
    this.playerData.set(client.sessionId, persisted);
    this.activeWards.set(client.sessionId, persisted.wards);
    this.state.players.set(client.sessionId, player);

    const adminLink = await getIngameAdminByGameUsername(persisted.username);
    if (adminLink) {
      this.adminSessions.set(client.sessionId, adminLink);
    }

    const friendPresence = await buildFriendPresenceList(persisted.friends, (playerId) => {
      const online = findOnlineByDbPlayerId(playerId);
      if (!online) return null;
      if (online.room.isSessionVanished(online.sessionId)) return null;
      return { scene: online.scene, stats: online.stats };
    });

    client.send('player_loaded', {
      username: persisted.username,
      dbPlayerId: persisted.dbPlayerId,
      wards: persisted.wards,
      familiar: this.familiarStore.get(client.sessionId) ?? persisted.familiar,
      metPlayers: persisted.metPlayers,
      location: persisted.location,
      friends: persisted.friends,
      friendRequests: persisted.friendRequests,
      friendPresence,
      progression: persisted.progression,
      isAdmin: !!adminLink,
      adminCommands: adminLink ? listCommands(adminLink.permissions) : [],
    });

    sendWorldState(client);
    this.withProgression(client, player, (ctx) => syncRecognition(ctx, { notify: false }));
    // TEMPORARY: tradition specialty offers deactivated until tradition packs ship.
    // if (!persisted.stats.specialty) {
    //   const eligible = eligibleSpecialtyTraditions(persisted.stats.affinities);
    //   if (eligible.length) {
    //     client.send('specialty_offer', { traditions: eligible });
    //   }
    // }

    this.sendApartmentVisitState(client);
    this.refreshWardWeb(client.sessionId);
    this.sendPlayerSync(client, player);
    client.send('progression_update', { progression: this.playerData.get(client.sessionId)?.progression });
    this.syncPlayerShopStock(client);

    this.recordMetPlayers(client.sessionId);

    chatService.register({
      sessionId: client.sessionId,
      displayName: player.displayName,
      roomId: this.roomId,
      scene: player.scene,
      send: (_type, data) => client.send('chat', data),
    });

    setOnlinePlayerCount(chatService.getAll().length);

    // presence_sync also sent on client presence_ready (handlers may not be bound yet)
    this.broadcastPresence('join', client.sessionId);

    console.log(
      `[GameRoom] ${player.displayName} (${username}) joined room ${this.roomId} — ${this.state.players.size} players`
    );

    void this.notifyFriendsPresenceChanged(player.dbPlayerId);
  }

  async onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    const data = this.playerData.get(client.sessionId);
    const dbPlayerId = player?.dbPlayerId;
    if (player && data) {
      this.syncPlayerDataFromSession(client.sessionId);
      try {
        await savePlayer(data);
      } catch (err) {
        console.warn('[GameRoom] Failed to save player on leave:', err);
      }
    }

    this.state.players.delete(client.sessionId);
    this.broadcastPresence('leave', client.sessionId);
    this.familiarStore.delete(client.sessionId);
    this.playerData.delete(client.sessionId);
    this.activeWards.delete(client.sessionId);
    this.apartmentHostBySession.delete(client.sessionId);
    tradeSystem.cancelForSession(client.sessionId);
    this.vanishedSessions.delete(client.sessionId);
    this.adminSessions.delete(client.sessionId);
    this.spellCastLimiter.reset(client.sessionId);
    this.survivalActivity.delete(client.sessionId);
    const eatTimer = this.eatingTimers.get(client.sessionId);
    if (eatTimer) {
      clearTimeout(eatTimer);
      this.eatingTimers.delete(client.sessionId);
    }
    this.lastMeRegenAt.delete(client.sessionId);
    chatService.unregister(client.sessionId);
    setOnlinePlayerCount(chatService.getAll().length);

    if (dbPlayerId) {
      void this.notifyFriendsPresenceChanged(dbPlayerId);
    }
  }

  /** Apartment instance id for presence filtering (host session id when at home). */
  private getApartmentInstanceId(sessionId: string): string | undefined {
    const player = this.state.players.get(sessionId);
    if (!player || player.scene !== 'apartment') return undefined;
    return resolveApartmentHostSessionId(sessionId, this.apartmentHostBySession.get(sessionId));
  }

  /** Same shared space as viewer (town or same apartment instance). */
  private sharesWorldSpace(viewerSessionId: string, targetSessionId: string): boolean {
    if (viewerSessionId === targetSessionId) return false;
    const viewer = this.state.players.get(viewerSessionId);
    const target = this.state.players.get(targetSessionId);
    if (!viewer || !target) return false;
    if (viewer.scene === 'town') return target.scene === 'town';
    if (viewer.scene === 'apartment') {
      if (target.scene !== 'apartment') return false;
      const viewerInstance = this.getApartmentInstanceId(viewerSessionId);
      const targetInstance = this.getApartmentInstanceId(targetSessionId);
      return !!viewerInstance && viewerInstance === targetInstance;
    }
    return false;
  }

  /** When a host reconnects, point visitors at their new session id. */
  private remapApartmentVisitorsForHost(hostSessionId: string, hostDbPlayerId: string): void {
    if (!hostDbPlayerId) return;
    for (const [visitorSessionId] of [...this.apartmentHostBySession.entries()]) {
      const visitorData = this.playerData.get(visitorSessionId);
      if (visitorData?.location.visitingHostDbPlayerId !== hostDbPlayerId) continue;
      this.apartmentHostBySession.set(visitorSessionId, hostSessionId);
      const visitorClient = this.clients.find((c) => c.sessionId === visitorSessionId);
      if (visitorClient) {
        this.sendApartmentVisitState(visitorClient);
        this.sendPresenceSync(visitorClient);
      }
    }
  }

  /** Push full player list to a newly joined client */
  private sendPresenceSync(client: Client): void {
    const players: {
      sessionId: string;
      displayName: string;
      x: number;
      y: number;
      scene: string;
      apartmentHostSessionId?: string;
    }[] = [];

    this.state.players.forEach((p, sessionId) => {
      if (sessionId === client.sessionId) return;
      if (!this.sharesWorldSpace(client.sessionId, sessionId)) return;
      if (!this.canSeePlayer(client.sessionId, sessionId)) return;
      players.push({
        sessionId,
        displayName: p.displayName,
        x: p.x,
        y: p.y,
        scene: p.scene,
        apartmentHostSessionId: this.getApartmentInstanceId(sessionId),
      });
    });

    const me = this.state.players.get(client.sessionId);
    client.send('presence_sync', {
      players,
      yourApartmentHostSessionId: me ? this.getApartmentInstanceId(client.sessionId) : undefined,
    });
  }

  /** Re-send visit/home apartment payload (join + presence_ready after client handlers bind). */
  private sendApartmentVisitState(client: Client): void {
    const hostSessionId = this.apartmentHostBySession.get(client.sessionId);
    if (!hostSessionId) return;

    const host = this.state.players.get(hostSessionId) ?? findOnlineBySessionId(hostSessionId);
    if (!host) return;

    client.send('apartment_visit', {
      type: 'apartment_visit',
      hostSessionId: host.sessionId,
      hostDbPlayerId: host.dbPlayerId,
      hostName: host.displayName,
      wards: this.activeWards.get(host.sessionId) ?? [],
    });
  }

  /** Broadcast join/move/scene/leave to clients who can see the subject */
  private broadcastPresence(
    kind: 'join' | 'leave' | 'move' | 'scene',
    sessionId: string
  ): void {
    if (kind === 'leave') {
      for (const client of this.clients) {
        client.send('presence', { kind, sessionId });
      }
      return;
    }

    const player = this.state.players.get(sessionId);
    if (!player) return;

    const payload = {
      kind,
      sessionId,
      displayName: player.displayName,
      x: player.x,
      y: player.y,
      scene: player.scene,
      apartmentHostSessionId: this.getApartmentInstanceId(sessionId),
    };

    for (const client of this.clients) {
      if (!this.canSeePlayer(client.sessionId, sessionId)) continue;
      client.send('presence', payload);
    }
  }

  private handleMessage(client: Client, msg: ClientMessage & { type: string }) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    switch (msg.type) {
      case 'presence_ready':
        this.sendPresenceSync(client);
        this.sendApartmentVisitState(client);
        this.broadcastPresence('join', client.sessionId);
        break;
      case 'move':
        this.wakeFromRest(client.sessionId);
        player.x = msg.x;
        player.y = msg.y;
        player.direction = msg.direction;
        this.persistLocation(client.sessionId);
        void this.flushLocationToDb(client.sessionId);
        this.broadcastPresence('move', client.sessionId);
        break;
      case 'change_scene': {
        this.wakeFromRest(client.sessionId);
        player.scene = msg.scene;
        const mapDef = contentRegistry.getMapForScene(msg.scene);
        const spawn =
          mapDef?.spawnPoints.find((s) => s.id === msg.spawnId) ??
          mapDef?.spawnPoints.find((s) => s.id === 'default');
        if (spawn) {
          player.x = spawn.x;
          player.y = spawn.y;
        }
        if (msg.scene !== 'apartment') {
          this.apartmentHostBySession.delete(client.sessionId);
        }
        chatService.updateRoom(client.sessionId, this.roomId, msg.scene);
        this.persistLocation(client.sessionId, msg.spawnId);
        this.refreshWardWeb(client.sessionId);
        this.broadcastPresence('scene', client.sessionId);
        void this.notifyFriendsPresenceChanged(player.dbPlayerId);
        break;
      }
      case 'interact':
        this.handleInteract(client, player, msg.targetId);
        break;
      case 'altar_update':
        player.altar = msg.altar;
        break;
      case 'cast_spell':
        if (this.survivalActivity.get(client.sessionId) === 'sleeping') {
          client.send('spell_result', {
            type: 'spell_result',
            success: false,
            spellId: msg.spellId,
            message: 'You are resting and cannot work magic yet. Rise from bed first.',
          });
          break;
        }
        this.handleCastSpell(client, player, msg);
        break;
      case 'buy_item':
        this.handleBuy(client, player, msg.shopId, msg.itemId, msg.quantity);
        break;
      case 'use_item':
        this.handleUseItem(client, player, msg.itemId, msg.quantity ?? 1, msg.slotIndex);
        break;
      case 'care_familiar':
        this.handleCareFamiliar(client, player, msg.action);
        break;
      case 'choose_familiar':
        void this.handleChooseFamiliar(client, player, msg);
        break;
      case 'collect_taglock':
        this.handleCollectTaglock(client, player, msg.targetPlayerId);
        break;
      case 'whisper':
        this.handleWhisper(client, player, msg.targetPlayerId, msg.message);
        break;
      case 'inspect_aura':
        this.handleInspectAura(client, player, msg.targetPlayerId);
        break;
      case 'place_ward':
        this.handlePlaceWard(client, player, msg.wardPointId, msg.spellId);
        break;
      case 'dialogue_choice':
        this.handleDialogueChoice(client, player, msg.dialogueTreeId, msg.nodeId, msg.choiceId, msg.choiceIndex);
        break;
      case 'npc_talk':
        this.handleNpcTalk(client, player, msg.npcId);
        break;
      case 'npc_action':
        this.handleNpcAction(client, player, msg.npcId, msg.actionId);
        break;
      case 'grimoire_write':
        this.handleGrimoireWrite(client, msg);
        break;
      case 'grimoire_share':
        this.handleGrimoireShare(client, player, msg);
        break;
      case 'grimoire_petition':
        this.handleGrimoirePetition(client, msg.spiritId);
        break;
      case 'grimoire_recall':
        this.handleGrimoireRecall(client, msg.spiritId);
        break;
      case 'grimoire_export':
        this.handleGrimoireExport(client, player, msg.pageId);
        break;
      case 'chat':
        this.handleChat(client, player, msg);
        break;
      case 'admin_command':
        void this.handleAdminCommand(client, String((msg as { command: string }).command ?? ''));
        break;
      case 'admin_action':
        void this.handleAdminPanelAction(client, msg as { action: string; targetSessionId?: string; args?: string[] });
        break;
      case 'visit_apartment':
        this.sendSystemChat(client, 'Apartment visits require a friend invite from the host.');
        break;
      case 'leave_apartment':
        this.handleLeaveApartment(client, player);
        break;
      case 'apartment_invite':
        this.handleApartmentInvite(client, player, msg.friendDbPlayerId);
        break;
      case 'apartment_invite_response':
        this.handleApartmentInviteResponse(client, player, msg.inviteId, msg.accept);
        break;
      case 'friend_request':
        void this.handleFriendRequest(client, player, msg.targetUsername);
        break;
      case 'friend_respond':
        void this.handleFriendRespond(client, player, msg.fromPlayerId, msg.accept);
        break;
      case 'friend_remove':
        void this.handleFriendRemove(client, player, msg.friendPlayerId);
        break;
      case 'friends_refresh':
        void this.notifyFriendsPresenceChanged(player.dbPlayerId);
        break;
      case 'feed_ward':
        this.handleFeedWard(client, player, msg.targetKind, msg.targetId);
        break;
      case 'trade_request':
        this.handleTradeRequest(client, player, msg.targetSessionId, msg.friendDbPlayerId);
        break;
      case 'trade_offer':
        this.handleTradeOffer(client, player, msg.tradeId, msg.coins, msg.items);
        break;
      case 'trade_accept':
        this.handleTradeAccept(client, player, msg.tradeId, msg.accepted);
        break;
      case 'trade_cancel':
        this.handleTradeCancel(client, player, msg.tradeId);
        break;
      case 'inventory_reorder':
        this.handleInventoryReorder(client, player, msg.slots);
        break;
      case 'inscribe_taglock':
        this.handleInscribeTaglock(client, player, msg.slotIndex, msg.targetName);
        break;
      case 'choose_specialty':
        this.withProgression(client, player, (ctx) =>
          handleChooseSpecialty(ctx, msg.specialty as MagicTradition)
        );
        break;
      case 'cast_pocket_spell':
        this.withProgression(client, player, (ctx) =>
          handleCastPocketSpell(ctx, msg.pocketId, msg.targetPlayerId)
        );
        break;
      case 'craft_recipe':
        this.withProgression(client, player, (ctx) => handleCraftRecipe(ctx, msg.recipeId));
        break;
      case 'hexagram_enchant':
        this.withProgression(client, player, (ctx) =>
          handleHexagramEnchant(ctx, {
            recipeId: msg.recipeId,
            sockets: msg.sockets,
            augmentations: msg.augmentations,
            declaration: msg.declaration,
          })
        );
        break;
      case 'experiment_ingredients':
        this.withProgression(client, player, (ctx) => handleExperiment(ctx, msg.itemIds));
        break;
      case 'read_book_complete':
        this.withProgression(client, player, (ctx) => handleReadBookComplete(ctx, msg.bookId));
        break;
    }
  }

  private withProgression(client: Client, player: PlayerSchema, fn: (ctx: HandlerCtx) => void): void {
    const data = this.playerData.get(client.sessionId);
    if (!data) return;
    fn({
      client,
      player,
      data,
      sendPlayerSync: (c, p) => this.sendPlayerSync(c, p),
      sendProgression: (c, prog) => c.send('progression_update', { progression: prog }),
      refreshWardWeb: (sessionId) => this.refreshWardWeb(sessionId),
      progressionFor: (sessionId) => this.playerData.get(sessionId)?.progression,
      resolvePlayer: (sessionId) => {
        const resolved = this.state.players.get(sessionId);
        if (!resolved) return null;
        return { player: resolved, client: this.clients.find((c) => c.sessionId === sessionId) };
      },
    });
  }

  private withProgressionReturn(
    client: Client,
    player: PlayerSchema,
    fn: (ctx: HandlerCtx) => boolean
  ): boolean {
    const data = this.playerData.get(client.sessionId);
    if (!data) return false;
    return fn({
      client,
      player,
      data,
      sendPlayerSync: (c, p) => this.sendPlayerSync(c, p),
      sendProgression: (c, prog) => c.send('progression_update', { progression: prog }),
      refreshWardWeb: (sessionId) => this.refreshWardWeb(sessionId),
      progressionFor: (sessionId) => this.playerData.get(sessionId)?.progression,
      resolvePlayer: (sessionId) => {
        const resolved = this.state.players.get(sessionId);
        if (!resolved) return null;
        return { player: resolved, client: this.clients.find((c) => c.sessionId === sessionId) };
      },
    });
  }

  private async handleAdminCommand(client: Client, raw: string) {
    const admin = this.adminSessions.get(client.sessionId);
    if (!admin) {
      client.send('admin_result', { success: false, message: 'Not authorized.' });
      return;
    }
    const trimmed = raw.trim().replace(/^\//, '');
    const [name, ...args] = trimmed.split(/\s+/);
    if (!name) {
      client.send('admin_result', { success: false, message: 'Empty command.' });
      return;
    }

    const player = this.state.players.get(client.sessionId)!;
    const result = await executeCommand(name, args, {
      adminUserId: admin.userId,
      permissions: admin.permissions,
      audit: { adminUserId: admin.userId },
      targetSessionId: client.sessionId,
      room: this.getAdminCommandRoom(),
    });

    if (result.success) {
      this.applyAdminCommandEffects(name, args, client.sessionId, client.sessionId, result);
    }

    client.send('admin_result', result);
  }

  private async handleAdminPanelAction(
    client: Client,
    msg: { action: string; targetSessionId?: string; args?: string[] }
  ): Promise<void> {
    const admin = this.adminSessions.get(client.sessionId);
    if (!admin) {
      client.send('admin_result', { success: false, message: 'Not authorized.' });
      return;
    }
    void handleIngameAdminPanel(this, client, admin, msg).then((result) => {
      client.send('admin_result', result);
    });
  }

  getAdminCommandRoom() {
    return {
      sendToSession: (sid: string, type: string, data: unknown) =>
        this.clients.find((c) => c.sessionId === sid)?.send(type, data),
      getPlayer: (sid: string) => {
        const p = this.state.players.get(sid);
        if (!p) return undefined;
        return {
          sessionId: p.sessionId,
          displayName: p.displayName,
          x: p.x,
          y: p.y,
          statsJson: p.statsJson,
          inventoryJson: p.inventoryJson,
        };
      },
    };
  }

  applyAdminCommandEffects(
    name: string,
    args: string[],
    adminSessionId: string,
    targetSessionId: string,
    result: { success: boolean; data?: unknown }
  ): void {
    const targetPlayer = this.state.players.get(targetSessionId);
    if (!targetPlayer) return;

    if (name === 'heal') {
      targetPlayer.stats = {
        ...targetPlayer.stats,
        health: 100,
        hunger: 100,
        magicalEnergy: magicalEnergyCap(targetPlayer.stats.experience),
      };
    }
    if (name === 'tp' && args.length >= 2) {
      targetPlayer.x = Number(args[0]);
      targetPlayer.y = Number(args[1]);
    }
    if (name === 'give') {
      const data = result.data as { inventory?: typeof targetPlayer.inventory } | undefined;
      if (data?.inventory) targetPlayer.inventory = data.inventory;
    }
    if (name === 'setstat' && args.length >= 2) {
      const stats = { ...targetPlayer.stats };
      const k = args[0] as keyof typeof stats;
      if (typeof stats[k] === 'number') {
        (stats[k] as number) = clampPlayerStatValue(k, Number(args[1]), stats.experience);
      }
      targetPlayer.stats = stats;
    }

    if (targetSessionId !== adminSessionId) {
      const targetClient = this.clients.find((c) => c.sessionId === targetSessionId);
      if (targetClient) this.sendPlayerSync(targetClient, targetPlayer);
    }
  }

  isSessionVanished(sessionId: string): boolean {
    return this.vanishedSessions.has(sessionId);
  }

  canSeePlayer(viewerSessionId: string, subjectSessionId: string): boolean {
    if (viewerSessionId === subjectSessionId) return true;
    if (!this.vanishedSessions.has(subjectSessionId)) return true;
    return this.adminSessions.has(viewerSessionId);
  }

  toggleVanish(sessionId: string): boolean {
    if (this.vanishedSessions.has(sessionId)) {
      this.vanishedSessions.delete(sessionId);
      this.broadcastPresence('join', sessionId);
      this.clients.forEach((c) => this.sendPresenceSync(c));
      return false;
    }
    this.vanishedSessions.add(sessionId);
    for (const client of this.clients) {
      if (client.sessionId === sessionId) continue;
      if (!this.adminSessions.has(client.sessionId)) {
        client.send('presence', { kind: 'leave', sessionId });
      }
    }
    return true;
  }

  getAdminPlayerList(viewerSessionId: string): {
    sessionId: string;
    displayName: string;
    username: string;
    scene: string;
    dbPlayerId: string;
    x: number;
    y: number;
    vanished: boolean;
  }[] {
    const rows: ReturnType<GameRoom['getAdminPlayerList']> = [];
    for (const [sessionId, player] of this.state.players.entries()) {
      if (!this.canSeePlayer(viewerSessionId, sessionId) && sessionId !== viewerSessionId) continue;
      const data = this.playerData.get(sessionId);
      rows.push({
        sessionId,
        displayName: player.displayName,
        username: data?.username ?? '',
        scene: player.scene,
        dbPlayerId: player.dbPlayerId,
        x: player.x,
        y: player.y,
        vanished: this.vanishedSessions.has(sessionId),
      });
    }
    return rows;
  }

  adminKickPlayer(targetSessionId: string, reason: string): void {
    const client = this.clients.find((c) => c.sessionId === targetSessionId);
    if (!client) return;
    client.send('notification', { type: 'notification', message: reason, level: 'error' });
    void client.leave(4000);
  }

  adminGotoPlayer(adminSessionId: string, targetSessionId: string): boolean {
    const adminClient = this.clients.find((c) => c.sessionId === adminSessionId);
    const target = this.state.players.get(targetSessionId);
    if (!adminClient || !target) return false;

    const adminPlayer = this.state.players.get(adminSessionId);
    if (!adminPlayer) return false;

    const targetVisiting = this.apartmentHostBySession.get(targetSessionId);
    if (target.scene === 'apartment' && !targetVisiting) {
      this.startApartmentGathering(targetSessionId, adminSessionId, target.displayName);
      return true;
    }

    if (target.scene !== adminPlayer.scene) {
      adminPlayer.scene = target.scene as typeof adminPlayer.scene;
      chatService.updateRoom(adminSessionId, this.roomId, target.scene);
      this.apartmentHostBySession.delete(adminSessionId);
      if (targetVisiting) {
        this.apartmentHostBySession.set(adminSessionId, targetVisiting);
      }
    }
    adminPlayer.x = target.x;
    adminPlayer.y = target.y;
    this.persistLocation(adminSessionId);
    this.refreshWardWeb(adminSessionId);
    adminClient.send('admin_tp', { x: target.x, y: target.y });
    adminClient.send('scene_change', {
      type: 'scene_change',
      scene: target.scene,
      spawnId: 'default',
    });
    this.broadcastPresence('scene', adminSessionId);
    this.sendPresenceSync(adminClient);
    return true;
  }

  adminSummonPlayer(adminSessionId: string, targetSessionId: string): boolean {
    const targetClient = this.clients.find((c) => c.sessionId === targetSessionId);
    const admin = this.state.players.get(adminSessionId);
    const target = this.state.players.get(targetSessionId);
    if (!targetClient || !admin || !target) return false;

    if (target.scene !== admin.scene) {
      target.scene = admin.scene;
      this.apartmentHostBySession.delete(targetSessionId);
      chatService.updateRoom(targetSessionId, this.roomId, admin.scene);
      targetClient.send('scene_change', {
        type: 'scene_change',
        scene: admin.scene,
        spawnId: 'default',
      });
    }
    target.x = admin.x;
    target.y = admin.y;
    this.persistLocation(targetSessionId);
    targetClient.send('admin_tp', { x: admin.x, y: admin.y });
    this.broadcastPresence('scene', targetSessionId);
    this.sendPresenceSync(targetClient);
    return true;
  }

  private handleInteract(client: Client, player: PlayerSchema, targetId: string) {
    const mapDef = contentRegistry.getMapForScene(player.scene);
    const target = mapDef?.interactables.find((i) => i.id === targetId);
    if (!target) return;

    if (target.type !== 'bed') {
      this.wakeFromRest(client.sessionId);
    }

    if ((target.type === 'shop' || target.type === 'npc') && !this.playerWithinInteractable(player, target)) {
      this.warnPlayer(client, 'Step closer before you speak.');
      return;
    }

    const availability = checkInteractAvailable(target.type, target.data as Record<string, unknown>, targetId);
    if (!availability.available) {
      client.send('notification', {
        type: 'notification',
        message: availability.message ?? 'Not available.',
        level: 'warn',
      });
      return;
    }

    const progression = this.playerData.get(client.sessionId)?.progression;
    const requiredLicense = target.data?.requiresLicense as string | undefined;
    const placeId = typeof target.data?.placeId === 'string' ? target.data.placeId : undefined;
    if (progression && requiredLicense && !holdsActiveLicense(progression, requiredLicense)) {
      client.send('notification', {
        type: 'notification',
        message: licenseGateMessage(requiredLicense),
        level: 'warn',
      });
      return;
    }
    if (progression && placeId && !licenseUnlocksPlace(placeId, progression)) {
      client.send('notification', {
        type: 'notification',
        message: 'This place admits only Magical Council credential holders.',
        level: 'warn',
      });
      return;
    }

    switch (target.type) {
      case 'door':
        if (target.targetScene) {
          const targetScene = target.targetScene as SceneId;
          const spawnId = target.targetSpawn ?? 'default';
          const targetMap = contentRegistry.getMapForScene(targetScene);
          const targetSpawn =
            targetMap?.spawnPoints.find((s) => s.id === spawnId) ??
            targetMap?.spawnPoints.find((s) => s.id === 'default');
          player.scene = targetScene;
          if (targetSpawn) {
            player.x = targetSpawn.x;
            player.y = targetSpawn.y;
          }
          chatService.updateRoom(client.sessionId, this.roomId, targetScene);
          this.persistLocation(client.sessionId, spawnId);
          client.send('scene_change', {
            scene: targetScene,
            spawnId,
          });
          this.broadcastPresence('scene', client.sessionId);
        }
        break;
      case 'altar':
        client.send('open_ui', { ui: 'altar' });
        break;
      case 'shop': {
        const shopId = typeof target.data?.shopId === 'string' ? target.data.shopId : '';
        const keeperId = shopId ? contentRegistry.shops.get(shopId)?.npcId : undefined;
        if (keeperId && contentRegistry.npcs.has(keeperId)) {
          this.openNpcActions(client, player, keeperId, shopId);
          break;
        }
        this.syncPlayerShopStock(client);
        client.send('open_ui', { ui: 'shop', shopId });
        break;
      }
      case 'npc': {
        const npcId = target.data?.npcId as string;
        if (npcId) this.openNpcActions(client, player, npcId);
        break;
      }
      case 'ward_point':
        client.send('open_ui', { ui: 'ward', wardPointId: targetId });
        break;
      case 'cleanser':
        this.withProgression(client, player, (ctx) => handleInteractCleanser(ctx));
        break;
      case 'bed':
        this.handleBedInteract(client, player);
        break;
      default:
        if (isCraftingInteractable(target.type)) {
          const stationType = craftStationTypeFromInteractable(target);
          this.withProgression(client, player, (ctx) => handleInteractCrafting(ctx, stationType, targetId));
        }
        break;
    }
  }

  private handleCastSpell(
    client: Client,
    player: PlayerSchema,
    msg: Extract<ClientMessage, { type: 'cast_spell' }>
  ) {
    if (!this.spellCastLimiter.tryConsume(client.sessionId)) {
      client.send('spell_result', {
        type: 'spell_result',
        success: false,
        spellId: msg.spellId,
        message: 'You are casting too quickly — wait a moment before trying again.',
      });
      return;
    }

    const spellDef = contentRegistry.spells.get(msg.spellId);
    const casterData = this.playerData.get(client.sessionId);

    if (msg.taglocks?.some((t) => t.type === 'social_bond')) {
      for (const t of msg.taglocks.filter((tl) => tl.type === 'social_bond')) {
        if (!t.playerId || !casterData?.metPlayers.some((m) => m.playerId === t.playerId)) {
          client.send('spell_result', {
            type: 'spell_result',
            success: false,
            spellId: msg.spellId,
            message: 'Social bond taglock requires someone you have met in person.',
          });
          return;
        }
      }
    }

    const familiar = this.familiarStore.get(client.sessionId);
    const assist = msg.altarState?.familiarAssist === true;
    const familiarBonus = familiar && assist ? familiarSystem.getCastingBonus(familiar, true) : 0;
    const effortReduction =
      familiar && assist
        ? familiarSystem.getEffortReduction(familiar, spellDef?.category ?? '', true)
        : 0;
    const altarBuffs = computeAltarBuffs(player.altar);
    const taglockType = resolveTaglockFromInventory(
      player.inventory,
      msg.taglockType as TaglockType | undefined
    );

    const targetId = msg.targetSelf ? client.sessionId : msg.targetPlayerId;

    let targetProtection: number | undefined;
    let targetPlayer: PlayerSchema | undefined;
    if (targetId) {
      targetPlayer = this.state.players.get(targetId);
      if (!msg.targetSelf && !targetPlayer) {
        client.send('spell_result', {
          type: 'spell_result',
          success: false,
          spellId: msg.spellId,
          message: 'That practitioner is not here.',
        });
        return;
      }
      if (!msg.targetSelf && targetPlayer && targetPlayer.scene !== player.scene) {
        client.send('spell_result', {
          type: 'spell_result',
          success: false,
          spellId: msg.spellId,
          message: 'Target is not in the same place as you.',
        });
        return;
      }
      if (!msg.targetSelf && targetPlayer) {
        const dx = Math.abs(targetPlayer.x - player.x);
        const dy = Math.abs(targetPlayer.y - player.y);
        if (dx > 24 || dy > 24) {
          client.send('spell_result', {
            type: 'spell_result',
            success: false,
            spellId: msg.spellId,
            message: 'Target is too far away — move closer.',
          });
          return;
        }
      }
      targetProtection = targetPlayer?.stats.protection;
    }

    const targetGrimoireWard =
      targetId && targetPlayer && !msg.targetSelf && spellDef
        ? malevolentGrimoireWard(this.playerData.get(targetId)?.progression.grimoire, spellDef)
        : 0;

    const meCost = msg.magicOnly
      ? (spellDef?.maintenanceCost ?? 5) * 2.5
      : (spellDef?.maintenanceCost ?? 5) +
        (ritualHasEverweed(msg.pentacleSlots, msg.augmentSlots) &&
        (spellDef?.category === 'protection' || spellDef?.category === 'warding')
          ? EVERWEED_INIT_ME_COST
          : 0);

    const bindingPenalty = computeBindingCastPenalty(player.aura);

    const result = spellEngine.cast(msg.spellId, {
      casterStats: player.stats,
      inventory: player.inventory,
      altar: msg.altarState,
      taglockType,
      taglocks: msg.taglocks,
      targetProtection,
      targetSelf: msg.targetSelf,
      familiarBonus,
      effortReduction,
      creatorId: player.dbPlayerId,
      altarBuffs,
      pentacleSlots: msg.pentacleSlots,
      augmentSlots: msg.augmentSlots,
      hexIntents: msg.hexIntents,
      magicOnly: msg.magicOnly,
      timing: msg.timing,
      bindingPenalty,
      progression: this.playerData.get(client.sessionId)?.progression,
      targetGrimoireWard,
    });

    const isShieldBreakerSpell =
      msg.spellId === 'shield_breaker' ||
      (result.effects.shieldBreak as boolean | undefined);

    const logExtra: Record<string, unknown> = {};

    const shouldConsumeIngredients =
      result.success || result.diagnostics?.code === 'focus_check';

    if (shouldConsumeIngredients && result.consumedItems.length) {
      let inv = player.inventory;
      for (const c of result.consumedItems) {
        const r = inventorySystem.removeItem(inv, c.itemId, c.quantity);
        if (r.ok) inv = r.inventory;
      }
      player.inventory = inv;
    }

    if (result.success || msg.magicOnly || result.diagnostics?.code === 'focus_check') {
      const fam = this.familiarStore.get(client.sessionId);
      let stats = fam ? familiarSystem.stripBonuses({ ...player.stats }, fam) : { ...player.stats };
      if (result.success || msg.magicOnly) {
        stats.magicalEnergy = Math.max(0, stats.magicalEnergy - meCost);
      }
      if (result.success) {
        const data = this.playerData.get(client.sessionId);
        let progression = data?.progression ?? defaultProgression();
        if (spellDef) {
          const violations = findVowViolations(progression, spellDef);
          for (const violation of violations) {
            const penalty = applyLicensureMarkPenalty(
              progression,
              violation.licenseId,
              violation.markCost
            );
            if (!penalty) continue;
            progression = penalty.progression;
            client.send('notification', {
              type: 'notification',
              message: `${violation.reason}. ${penalty.message}`,
              level: penalty.revoked ? 'error' : 'warn',
            });
            if (penalty.revoked) {
              const hit = revocationReputationPenalty();
              stats = applyReputationDelta(stats, 'public', hit.public);
              stats = applyReputationDelta(stats, 'spiritual', hit.spiritual);
            }
          }
          if (!violations.length) {
            for (const licenseId of activeLicenseIds(progression)) {
              const def = getLicense(licenseId);
              if (def?.allows.categories?.includes(spellDef.category)) {
                progression = recoverLicensureMarks(progression, licenseId, 1);
              }
            }
          }
        }
        progression = withGrimoire(progression, (grimoire) => recordGrimoireCast(grimoire, msg.spellId, true));
        const xp = grantExperience(stats, progression, 'spell_cast_success');
        stats = xp.stats;
        if (data) {
          data.progression = xp.progression;
          client.send('progression_update', { progression: data.progression });
        }
        if (xp.granted > 0) {
          client.send('notification', {
            type: 'notification',
            message: xp.leveledUp
              ? `+${xp.granted} XP — Practitioner Level ${xp.levelAfter}!`
              : `+${xp.granted} XP — ${xp.source?.label ?? 'Working'}`,
            level: xp.leveledUp ? 'success' : 'info',
          });
          for (const event of xp.levelUpEvents) {
            client.send('notification', {
              type: 'notification',
              message: event.message,
              level: 'success',
            });
            client.send('level_up', {
              type: 'level_up',
              eventId: event.eventId,
              message: event.message,
              level: xp.levelAfter,
            });
          }
        }
        // Blatant magic in town hurts public standing; witnessed workings raise spiritual.
        if (player.scene === 'town') {
          const pub = applyReputationSource(stats, 'public', 'visible_magic_town');
          stats = pub.stats;
          if (pub.applied !== 0) {
            client.send('notification', {
              type: 'notification',
              message: `Townsfolk noticed the working (${pub.applied > 0 ? '+' : ''}${Math.round(pub.applied)} public reputation).`,
              level: 'warn',
            });
          }
        }
        const spi = applyReputationSource(stats, 'spiritual', 'public_working_success');
        stats = spi.stats;
      } else if (result.diagnostics?.code === 'focus_check') {
        const data = this.playerData.get(client.sessionId);
        const progression = withGrimoire(data?.progression ?? defaultProgression(), (grimoire) =>
          recordGrimoireCast(grimoire, msg.spellId, false)
        );
        const xp = grantExperience(stats, progression, 'spell_cast_focus_fail');
        stats = xp.stats;
        if (data) {
          data.progression = xp.progression;
          client.send('progression_update', { progression: data.progression });
        }
        if (player.scene === 'town') {
          const botch = applyReputationSource(stats, 'spiritual', 'botched_public_working');
          stats = botch.stats;
        }
      }
      stats = syncLevelDerivedStats(stats);
      if (fam) stats = familiarSystem.applyBonuses(stats, fam);
      player.stats = stats;
      player.aura = auraSystem.applyMoralityDelta(player.aura, result.moralDelta);
      if (result.moralDelta) {
        const gossip = applyMoralityGossip(player.stats, result.moralDelta);
        if (gossip.applied !== 0) {
          player.stats = gossip.stats;
        }
      }

      const isShieldBreaker =
        isShieldBreakerSpell && result.success;

      if (result.success && isShieldBreaker && targetPlayer) {
        const resolvedTargetId = targetPlayer.sessionId ?? targetPlayer.id;
        const hostSessionId = this.apartmentHostBySession.get(resolvedTargetId);
        const apartmentWards = resolveAmbientApartmentWards(
          resolvedTargetId,
          targetPlayer.scene,
          hostSessionId,
          this.activeWards
        );
        const breakOutcome = applyShieldBreaker(
          targetPlayer.aura,
          apartmentWards,
          player.stats.cursecraft,
          result.potency
        );

        targetPlayer.aura = breakOutcome.aura;
        const wardHostSessionId = resolveApartmentHostSessionId(resolvedTargetId, hostSessionId);
        this.activeWards.set(wardHostSessionId, breakOutcome.apartmentWards);

        const data = this.playerData.get(resolvedTargetId);
        const hostData = this.playerData.get(wardHostSessionId);
        if (data) {
          data.aura = breakOutcome.aura;
          if (wardHostSessionId === resolvedTargetId) {
            data.wards = breakOutcome.apartmentWards;
          }
        }
        if (hostData && wardHostSessionId !== resolvedTargetId) {
          hostData.wards = breakOutcome.apartmentWards;
        }

        logExtra.shieldBreak = {
          totalDamage: breakOutcome.totalDamage,
          broken: breakOutcome.broken,
          layersRemaining:
            breakOutcome.aura.wards.length +
            breakOutcome.aura.protections.length +
            breakOutcome.apartmentWards.length,
        };

        const targetClient = this.clients.find((c) => c.sessionId === targetId);
        if (targetClient) {
          this.refreshWardWeb(resolvedTargetId);
          this.sendPlayerSync(targetClient, targetPlayer);
          targetClient.send('apartment_wards', {
            type: 'apartment_wards',
            wards: breakOutcome.apartmentWards,
          });
          targetClient.send('shield_break', {
            type: 'shield_break',
            casterName: player.displayName,
            broken: breakOutcome.broken,
            totalDamage: breakOutcome.totalDamage,
            notify: targetPlayer.stats.intuition >= player.stats.intuition,
            wardShatterIds: breakOutcome.broken.filter((b) => b.wasWard).map((b) => b.id),
          });
        }

        if (targetPlayer.stats.intuition >= player.stats.intuition) {
          targetClient?.send('chat', {
            from: 'System',
            message: `Your wards shudder — ${player.displayName}'s Shield Breaker strikes your outer defenses!`,
            channel: 'system',
            timestamp: Date.now(),
          });
        }

        this.broadcastHostWardsToVisitors(wardHostSessionId, breakOutcome.apartmentWards);

        result.message = breakOutcome.message;
      } else if (result.success && !isShieldBreaker) {
        const everweedBound = !!(result.effects.everweedBound);
        const applied = applySpellEffectsToCaster(
          player.stats,
          player.aura,
          result,
          msg.spellId,
          spellDef?.name ?? msg.spellId,
          msg.magicOnly,
          player.dbPlayerId,
          everweedBound
        );
        player.stats = applied.stats;
        player.aura = applied.aura;

        if (msg.spellId === 'household_ward') {
          this.registerApartmentWard(client, player, result, everweedBound);
        }
      }

      if (familiar && result.success) {
        const updated = familiarSystem.grantExperience(familiar, 10, msg.spellId);
        this.familiarStore.set(client.sessionId, updated);
        client.send('familiar_update', { type: 'familiar_update', familiar: updated });
      }

      if (
        targetId &&
        targetId !== client.sessionId &&
        targetPlayer &&
        result.success &&
        !isShieldBreaker
      ) {
        const hex = applySpellToTarget(msg.spellId, result.potency, taglockType);
        if (hex) {
          const spellEffects = spellDef?.gameplayEffect as Record<string, unknown> | undefined;
          const targetAura = { ...targetPlayer.aura };
          targetAura.hexes = [
            ...targetAura.hexes,
            {
              id: `hex_${Date.now()}`,
              type: 'hex' as const,
              name: hex.hexName,
              strength: hex.strength * result.potency,
              spellId: msg.spellId,
              bindAction: spellEffects?.bindAction ? String(spellEffects.bindAction) : undefined,
              source: player.displayName,
              expiresAt: Date.now() + ((spellDef?.duration ?? 7200) * 1000),
            },
          ];
          targetPlayer.aura = targetAura;

          const targetStats = { ...targetPlayer.stats };
          if (msg.hexIntents?.includes('harm_health')) {
            targetStats.health = Math.max(0, targetStats.health - result.potency * 2);
          }
          if (msg.hexIntents?.includes('weaken_power')) {
            targetStats.magicalEnergy = Math.max(0, targetStats.magicalEnergy - result.potency);
          }
          if (msg.hexIntents?.includes('harm_wards')) {
            targetStats.protection = Math.max(0, targetStats.protection - result.potency);
          }
          targetPlayer.stats = targetStats;

          const targetClient = this.clients.find((c) => c.sessionId === targetId);
          if (targetClient) this.sendPlayerSync(targetClient, targetPlayer);

          if (targetPlayer.stats.intuition >= 30) {
            targetClient?.send('notification', {
              type: 'notification',
              message: 'You sense incoming magical work directed at you...',
              level: 'warn',
            });
          }
        }
      }
    }

    logSpellAttempt({
      spellId: msg.spellId,
      success: result.success,
      casterId: player.dbPlayerId,
      casterName: player.displayName,
      targetId: targetPlayer?.dbPlayerId,
      targetName: targetPlayer?.displayName,
      casterStats: {
        cursecraft: player.stats.cursecraft,
        intuition: player.stats.intuition,
        ritualSkill: player.stats.ritualSkill,
        warding: player.stats.warding,
        magicalEnergy: player.stats.magicalEnergy,
        protection: player.stats.protection,
      },
      targetStats: targetPlayer
        ? {
            intuition: targetPlayer.stats.intuition,
            protection: targetPlayer.stats.protection,
            health: targetPlayer.stats.health,
          }
        : undefined,
      result,
      meCost,
      channel: 'altar',
      extra: logExtra,
    });

    void logSpellCast(player.dbPlayerId, msg.spellId, result.success, result.potency, targetId);

    if (result.success) {
      const data = this.playerData.get(client.sessionId);
      if (data) {
        const before = data.progression.questProgress.quest_first_steps?.completedAt;
        data.progression = questSystem.onSpellCast(data.progression, msg.spellId);
        const after = data.progression.questProgress.quest_first_steps?.completedAt;
        if (!before && after) {
          this.withProgression(client, player, (ctx) => completeQuestRewards(ctx, 'quest_first_steps'));
        }
        client.send('progression_update', { progression: data.progression });
      }
      this.refreshWardWeb(client.sessionId);
    } else {
      this.sendPlayerSync(client, player);
    }
    client.send('spell_result', {
      type: 'spell_result',
      success: result.success,
      spellId: msg.spellId,
      message: result.message,
      effects: result.effects,
    });
  }

  private registerApartmentWard(
    client: Client,
    player: PlayerSchema,
    result: { potency: number; effects: Record<string, unknown> },
    everweedBound = false
  ): void {
    const durationSec = (result.effects.duration as number) ?? 86400;
    const ward = wardSystem.createWard({
      targetType: 'apartment',
      targetId: 'perimeter',
      strength: (result.effects.apartmentProtection as number) ?? result.potency,
      duration: durationSec,
      maintenanceCost: 3,
      feedingRequirement: 'magical_energy',
      ingredientRequirement: ['salt'],
      vulnerabilities: ['reversal'],
      creatorId: player.dbPlayerId,
      detectionDifficulty: (result.effects.detectionDifficulty as number) ?? 40,
      permanent: everweedBound || undefined,
      expiresAt: everweedBound ? undefined : Date.now() + durationSec * 1000,
    });

    const wards = this.activeWards.get(client.sessionId) ?? [];
    void this.storeNewWard(client.sessionId, ward).then((stored) => {
      wards.push(stored);
      this.activeWards.set(client.sessionId, wards);
      const playerData = this.playerData.get(client.sessionId);
      if (playerData) playerData.wards = wards;

      client.send('apartment_wards', { type: 'apartment_wards', wards });
      client.send('ward_placed', { type: 'ward_placed', wardId: stored.id });
      this.refreshWardWeb(client.sessionId);
      this.broadcastHostWardsToVisitors(client.sessionId, wards);
    });
  }

  private handlePlaceWard(client: Client, player: PlayerSchema, wardPointId: string, spellId: string) {
    if (this.apartmentHostBySession.has(client.sessionId)) {
      client.send('notification', {
        type: 'notification',
        message: "You cannot place wards in another player's apartment.",
        level: 'error',
      });
      return;
    }
    const mapDef = contentRegistry.getMapForScene(player.scene);
    const altarBuffs = computeAltarBuffs(player.altar);
    const spellDef = contentRegistry.spells.get(spellId);
    const meCost = (spellDef?.maintenanceCost ?? 5) + 2;
    const result = placeWardAtPoint(spellId, wardPointId, mapDef, {
      casterStats: player.stats,
      inventory: player.inventory,
      altar: player.altar,
      altarBuffs,
      creatorId: player.dbPlayerId,
    });

    logSpellAttempt({
      spellId,
      success: result.success,
      casterId: player.dbPlayerId,
      casterName: player.displayName,
      casterStats: {
        ritualSkill: player.stats.ritualSkill,
        intuition: player.stats.intuition,
        warding: player.stats.warding,
        protection: player.stats.protection,
        magicalEnergy: player.stats.magicalEnergy,
      },
      result: result.castResult,
      meCost,
      channel: 'ward_point',
      extra: { wardPointId },
    });

    if (result.success && result.ward) {
      const castResult = result.castResult;
      const shouldConsume =
        castResult.success || castResult.diagnostics?.code === 'focus_check';
      if (shouldConsume && castResult.consumedItems.length) {
        let inv = player.inventory;
        for (const c of castResult.consumedItems) {
          const r = inventorySystem.removeItem(inv, c.itemId, c.quantity);
          if (r.ok) inv = r.inventory;
        }
        player.inventory = inv;
      }
      player.stats = {
        ...player.stats,
        magicalEnergy: Math.max(0, player.stats.magicalEnergy - meCost),
      };

      const dataForXp = this.playerData.get(client.sessionId);
      if (dataForXp) {
        const xp = grantExperience(player.stats, dataForXp.progression, 'ward_place');
        player.stats = xp.stats;
        dataForXp.progression = xp.progression;
        client.send('progression_update', { progression: dataForXp.progression });
        if (xp.granted > 0) {
          client.send('notification', {
            type: 'notification',
            message: `+${xp.granted} XP — ${xp.source?.label ?? 'Ward'}`,
            level: 'info',
          });
        }
      }

      const wards = this.activeWards.get(client.sessionId) ?? [];
      void this.storeNewWard(client.sessionId, result.ward).then((stored) => {
        wards.push(stored);
        this.activeWards.set(client.sessionId, wards);

        const data = this.playerData.get(client.sessionId);
        if (data) data.wards = wards;

        const aura = { ...player.aura };
        aura.wards.push({
          id: stored.id,
          type: 'ward',
          name: 'Household Ward',
          strength: stored.strength,
          creatorId: data?.dbPlayerId,
          source: data?.dbPlayerId,
          spellId: 'household_ward',
          expiresAt: stored.expiresAt,
          permanent: stored.permanent,
        });
        player.aura = aura;

        client.send('apartment_wards', { type: 'apartment_wards', wards });
        client.send('ward_placed', { type: 'ward_placed', wardId: stored.id });
        this.refreshWardWeb(client.sessionId);
        this.broadcastHostWardsToVisitors(client.sessionId, wards);
        this.sendPlayerSync(client, player);
      });
    } else if (result.castResult.diagnostics?.code === 'focus_check') {
      const castResult = result.castResult;
      if (castResult.consumedItems.length) {
        let inv = player.inventory;
        for (const c of castResult.consumedItems) {
          const r = inventorySystem.removeItem(inv, c.itemId, c.quantity);
          if (r.ok) inv = r.inventory;
        }
        player.inventory = inv;
      }
      player.aura = auraSystem.applyMoralityDelta(player.aura, castResult.moralDelta);
      this.sendPlayerSync(client, player);
    }

    client.send('notification', {
      type: 'notification',
      message: result.message,
      level: result.success ? 'success' : 'error',
    });
  }

  private handleDialogueChoice(
    client: Client,
    player: PlayerSchema,
    dialogueTreeId: string,
    nodeId: string,
    choiceId: string,
    choiceIndex?: number
  ) {
    const tree = dialogueSystem.getTree(dialogueTreeId) ?? contentRegistry.dialogues.get(dialogueTreeId);
    const npcId = tree?.npcId;
    if (!tree || !npcId) {
      this.warnPlayer(client, 'That conversation is no longer available.');
      return;
    }
    const present = this.requireNpcPresent(client, player, npcId);
    if (!present) return;

    const node = tree.nodes.find((entry) => entry.id === nodeId);
    const resolvedId =
      choiceId?.trim() ||
      (node && choiceIndex != null && node.choices[choiceIndex]
        ? dialogueChoiceId(node.id, node.choices[choiceIndex], choiceIndex)
        : '');
    const progression = this.playerData.get(client.sessionId)?.progression;
    const result = dialogueSystem.resolve(dialogueTreeId, nodeId, resolvedId, {
      inventory: player.inventory,
      progression,
      stats: player.stats,
      coins: player.coins,
    });
    if (!result.ok) {
      this.warnPlayer(client, result.reason);
      const spoken = progression ?? defaultProgression();
      client.send('dialogue_update', {
        ended: false,
        nodeId,
        message: node?.text ?? '',
        dialogueTreeId,
        choices: dialogueSystem.publish(dialogueTreeId, nodeId, spoken, player.stats, player.coins),
        notice: result.reason,
      });
      return;
    }

    if (result.inventory) player.inventory = result.inventory;
    if (result.coinsDelta) {
      player.coins = Math.max(0, player.coins + result.coinsDelta);
    }
    if (result.statBoost) {
      const stats = { ...player.stats };
      for (const [k, v] of Object.entries(result.statBoost)) {
        const key = k as keyof typeof stats;
        if (typeof stats[key] === 'number') {
          (stats[key] as number) = clampPlayerStatValue(
            key,
            (stats[key] as number) + v,
            stats.experience
          );
        }
      }
      player.stats = stats;
    }

    this.withProgression(client, player, (ctx) => {
      if (result.progression) {
        ctx.data.progression = result.progression;
        ctx.sendProgression(ctx.client, ctx.data.progression);
      }
      handleDialogueProgression(ctx, dialogueTreeId, result.relationshipDelta, npcId);
      syncRecognition(ctx);
    });

    if (result.notification) {
      client.send('notification', {
        type: 'notification',
        message: result.notification,
        level: 'success',
      });
    }

    if (result.coinsDelta) {
      this.sendPlayerSync(client, player);
    }

    const spoken = this.playerData.get(client.sessionId)?.progression ?? defaultProgression();
    client.send('dialogue_update', {
      ended: result.ended,
      nodeId: result.nextNodeId,
      message: result.message,
      dialogueTreeId,
      choices: result.ended
        ? []
        : dialogueSystem.publish(dialogueTreeId, result.nextNodeId, spoken, player.stats, player.coins),
    });
  }

  /** Speak with an NPC who is standing at a nearby counter or map post. */
  private handleNpcTalk(client: Client, player: PlayerSchema, npcId: string): void {
    this.handleNpcAction(client, player, npcId, 'talk');
  }

  private handleNpcAction(client: Client, player: PlayerSchema, npcId: string, actionId: string): void {
    if (!npcId || !contentRegistry.npcs.has(npcId)) return;
    this.wakeFromRest(client.sessionId);
    const present = this.requireNpcPresent(client, player, npcId);
    if (!present) return;
    if (!this.npcMaySpeak(client, player, npcId)) return;

    const progression = this.playerData.get(client.sessionId)?.progression ?? defaultProgression();
    const contextShopId = present.type === 'shop' && typeof present.data?.shopId === 'string' ? present.data.shopId : undefined;
    const npc = contentRegistry.npcs.get(npcId)!;
    const dialogue = npc.dialogueTreeId ? dialogueSystem.getTree(npc.dialogueTreeId) : undefined;
    const offers = buildNpcInteractionOffers({
      npc,
      dialogue,
      contextShopId: contextShopId ?? npc.shopId,
      quests: [...questSystem.quests.values()],
      questProgress: progression.questProgress,
    });
    const offer = offers.find((entry) => entry.id === actionId);
    if (!offer) {
      this.warnPlayer(client, 'That is not something they will do right now.');
      return;
    }

    if (offer.id === 'goodbye') {
      client.send('open_ui', { ui: 'none' });
      return;
    }
    if (offer.id === 'trade') {
      if (!offer.shopId) {
        this.warnPlayer(client, 'There is no counter here.');
        return;
      }
      this.syncPlayerShopStock(client);
      client.send('open_ui', { ui: 'shop', shopId: offer.shopId });
      return;
    }
    this.openNpcDialogue(client, player, npcId, offer.nodeId ?? 'start');
  }

  private openNpcActions(client: Client, player: PlayerSchema, npcId: string, contextShopId?: string): void {
    if (!this.npcMaySpeak(client, player, npcId)) return;
    const npc = contentRegistry.npcs.get(npcId);
    if (!npc) return;
    const progression = this.playerData.get(client.sessionId)?.progression ?? defaultProgression();
    const dialogue = npc.dialogueTreeId ? dialogueSystem.getTree(npc.dialogueTreeId) : undefined;
    const offers = buildNpcInteractionOffers({
      npc,
      dialogue,
      contextShopId,
      quests: [...questSystem.quests.values()],
      questProgress: progression.questProgress,
    });
    client.send('open_ui', {
      ui: 'npc_actions',
      npcId,
      name: npc.name,
      role: npc.role,
      shopId: contextShopId ?? npc.shopId,
      options: offers,
    });
  }

  private openNpcDialogue(client: Client, player: PlayerSchema, npcId: string, nodeId = 'start'): void {
    const npc = contentRegistry.npcs.get(npcId);
    if (!npc?.dialogueTreeId) return;
    if (!this.npcMaySpeak(client, player, npcId)) return;

    const progression = this.playerData.get(client.sessionId)?.progression ?? defaultProgression();
    const tree = dialogueSystem.getTree(npc.dialogueTreeId);
    const node = tree?.nodes.find((entry) => entry.id === nodeId);
    client.send('open_ui', {
      ui: 'dialogue',
      npcId,
      dialogueTreeId: npc.dialogueTreeId,
      nodeId,
      text: node?.text ?? '',
      choices: dialogueSystem.publish(npc.dialogueTreeId, nodeId, progression, player.stats, player.coins),
    });

    const met = this.playerData.get(client.sessionId);
    if (!met) return;
    const relationship = met.progression.npcRelationships[npcId] ?? 0;
    const next = withGrimoire(met.progression, (grimoire) =>
      recordGrimoireNpc(grimoire, { npcId, name: npc.name, relationship })
    );
    if (next !== met.progression) {
      met.progression = next;
      client.send('progression_update', { progression: met.progression });
    }
  }

  private requireNpcPresent(client: Client, player: PlayerSchema, npcId: string) {
    const stand = this.npcStand(player, npcId);
    if (!stand) {
      this.warnPlayer(client, 'Step up to their counter before you speak.');
      return null;
    }
    const availability = checkInteractAvailable(stand.type, stand.data as Record<string, unknown>, stand.id);
    if (!availability.available) {
      this.warnPlayer(client, availability.message ?? 'Not available.');
      return null;
    }
    const progression = this.playerData.get(client.sessionId)?.progression;
    const requiredLicense = stand.data?.requiresLicense as string | undefined;
    const placeId = typeof stand.data?.placeId === 'string' ? stand.data.placeId : undefined;
    if (progression && requiredLicense && !holdsActiveLicense(progression, requiredLicense)) {
      this.warnPlayer(client, licenseGateMessage(requiredLicense));
      return null;
    }
    if (progression && placeId && !licenseUnlocksPlace(placeId, progression)) {
      this.warnPlayer(client, 'This place admits only Magical Council credential holders.');
      return null;
    }
    return stand;
  }

  private npcMaySpeak(client: Client, player: PlayerSchema, npcId: string): boolean {
    const npc = contentRegistry.npcs.get(npcId);
    if (!npc) return false;
    const npcLevel = assignedUnlockLevel('npcIds', npcId);
    if (npcLevel != null && !meetsAssignedUnlock('npcIds', npcId, player.stats.experience ?? 0)) {
      this.warnPlayer(client, levelGateMessage(npc.name, npcLevel, playerLevel(player.stats.experience ?? 0)));
      return false;
    }
    const progression = this.playerData.get(client.sessionId)?.progression ?? defaultProgression();
    if (!licenseUnlocksNpc(npcId, progression)) {
      this.warnPlayer(client, 'This practitioner only speaks with Magical Council credential holders.');
      return false;
    }
    return true;
  }

  private npcStand(player: PlayerSchema, npcId: string) {
    const mapDef = contentRegistry.getMapForScene(player.scene);
    if (!mapDef) return null;
    return nearestNpcInteractable(player.x, player.y, npcId, mapDef.interactables, (shopId) =>
      contentRegistry.shops.get(shopId)?.npcId
    );
  }

  private playerWithinInteractable(player: PlayerSchema, inter: MapInteractable): boolean {
    const px = player.x * TILE_SIZE + TILE_SIZE / 2;
    const py = player.y * TILE_SIZE + TILE_SIZE / 2;
    return isWithinInteractRange(px, py, inter);
  }

  private warnPlayer(client: Client, message: string): void {
    client.send('notification', { type: 'notification', message, level: 'warn' });
  }

  noteGatheredItems(sessionId: string, entries: { itemId: string; count: number }[]): void {
    if (!entries.length) return;
    const data = this.playerData.get(sessionId);
    if (!data) return;
    const next = withGrimoire(data.progression, (grimoire) => recordGrimoireIngredients(grimoire, entries));
    if (next === data.progression) return;
    data.progression = next;
    this.clients.find((c) => c.sessionId === sessionId)?.send('progression_update', { progression: data.progression });
  }

  indexSharedSpell(
    sessionId: string,
    spellId: string,
    sharedByName: string
  ): 'added' | 'already' | 'full' | 'missing' {
    const data = this.playerData.get(sessionId);
    if (!data) return 'missing';
    const result = shareSpellIntoGrimoire(data.progression.grimoire ?? defaultGrimoire(), spellId, sharedByName);
    if (result.status !== 'added') return result.status;
    data.progression = { ...data.progression, grimoire: result.grimoire };
    const target = this.clients.find((c) => c.sessionId === sessionId);
    const spellName = contentRegistry.spells.get(spellId)?.name ?? 'a working';
    target?.send('progression_update', { progression: data.progression });
    target?.send('notification', {
      type: 'notification',
      message: `${sharedByName} indexes ${spellName} in your grimoire. The page stays sealed until the working is yours to cast.`,
      level: 'info',
    });
    return 'added';
  }

  private handleGrimoireWrite(client: Client, msg: Extract<ClientMessage, { type: 'grimoire_write' }>): void {
    const data = this.playerData.get(client.sessionId);
    if (!data) return;
    const result = mergeGrimoireWrite(data.progression, msg);
    if (result.progression) {
      data.progression = result.progression;
      client.send('progression_update', { progression: data.progression });
    }
    if (result.message && result.level) {
      client.send('notification', { type: 'notification', message: result.message, level: result.level });
    }
  }

  private handleGrimoireExport(client: Client, player: PlayerSchema, pageId: string): void {
    const data = this.playerData.get(client.sessionId);
    if (!data) return;
    const book = data.progression.grimoire ?? defaultGrimoire();
    const page = book.authored.find((row) => row.id === pageId);
    if (!page) {
      client.send('notification', {
        type: 'notification',
        message: 'That Author page is not in your book.',
        level: 'warn',
      });
      return;
    }
    if (!page.body.trim()) {
      client.send('notification', {
        type: 'notification',
        message: 'Write something on the page before exporting it.',
        level: 'warn',
      });
      return;
    }
    if (isManuscriptArchived(page.id)) {
      client.send('notification', {
        type: 'notification',
        message: 'Staff archived that page. It cannot be exported again.',
        level: 'warn',
      });
      return;
    }
    if (findFirstEmptySlotIndex(normalizeInventoryLayout(player.inventory)) < 0) {
      client.send('notification', {
        type: 'notification',
        message: 'Your bag is full. Make room for the manuscript.',
        level: 'warn',
      });
      return;
    }
    const meta = manuscriptMetadataFromPage(page, player.displayName, player.dbPlayerId || undefined);
    const recorded = readManuscriptMeta({ itemId: GRIMOIRE_MANUSCRIPT_ITEM_ID, quantity: 1, metadata: meta });
    if (recorded) registerManuscriptExport(recorded, player.dbPlayerId || undefined);
    player.inventory = inventorySystem.addItem(player.inventory, GRIMOIRE_MANUSCRIPT_ITEM_ID, 1, meta);
    this.sendPlayerSync(client, player);
    client.send('notification', {
      type: 'notification',
      message: `"${page.title}" is bound as a manuscript. Trade it, or right-click it to take a page into Shared.`,
      level: 'success',
    });
  }

  private handleUseManuscript(client: Client, player: PlayerSchema, slotIndex?: number): void {
    const data = this.playerData.get(client.sessionId);
    if (!data) return;
    const grid = normalizeInventoryLayout(player.inventory);
    let index =
      typeof slotIndex === 'number' && Number.isFinite(slotIndex)
        ? Math.floor(slotIndex)
        : grid.findIndex((slot) => slot.itemId === GRIMOIRE_MANUSCRIPT_ITEM_ID);
    if (index < 0 || index >= grid.length || grid[index]?.itemId !== GRIMOIRE_MANUSCRIPT_ITEM_ID) {
      client.send('notification', {
        type: 'notification',
        message: 'That manuscript is not in your bag.',
        level: 'warn',
      });
      return;
    }
    const manuscript = readManuscriptMeta(grid[index]);
    if (!manuscript) {
      client.send('notification', {
        type: 'notification',
        message: 'This manuscript has no writing left on it.',
        level: 'warn',
      });
      return;
    }
    if (isManuscriptArchived(manuscript.manuscriptPageId)) {
      const takenBanned = takeInventorySlot(grid, index);
      player.inventory = takenBanned.inventory;
      this.sendPlayerSync(client, player);
      client.send('notification', {
        type: 'notification',
        message: 'Staff archived that manuscript. The copy dissolves.',
        level: 'warn',
      });
      return;
    }
    const taken = takeInventorySlot(grid, index);
    if (!taken.slot) {
      client.send('notification', {
        type: 'notification',
        message: 'That manuscript is not in your bag.',
        level: 'warn',
      });
      return;
    }
    const received = receiveSharedGrimoirePage(data.progression.grimoire ?? defaultGrimoire(), manuscript);
    if (received.status === 'full') {
      client.send('notification', {
        type: 'notification',
        message: 'Your Shared section is full. Clear a page before taking another.',
        level: 'warn',
      });
      return;
    }
    if ((received.status !== 'added' && received.status !== 'again') || !received.page) {
      client.send('notification', {
        type: 'notification',
        message: 'This manuscript has no writing left on it.',
        level: 'warn',
      });
      return;
    }
    player.inventory = taken.inventory;
    data.progression = { ...data.progression, grimoire: received.grimoire };
    this.sendPlayerSync(client, player);
    client.send('progression_update', { progression: data.progression });
    client.send('notification', {
      type: 'notification',
      message:
        received.status === 'again'
          ? `"${received.page.title}" was already in Shared; the page is refreshed.`
          : `"${received.page.title}" by ${received.page.authorName} is written into Shared.`,
      level: 'success',
    });
  }

  private handleGrimoirePetition(client: Client, spiritId: string): void {
    const data = this.playerData.get(client.sessionId);
    if (!data) return;
    const result = petitionGrimoireSpirit(data.progression, spiritId);
    if (result.progression !== data.progression) {
      data.progression = result.progression;
      client.send('progression_update', { progression: data.progression });
    }
    client.send('notification', { type: 'notification', message: result.message, level: result.level });
  }

  private handleGrimoireRecall(client: Client, spiritId: string): void {
    const data = this.playerData.get(client.sessionId);
    if (!data) return;
    const result = recallGrimoireSpirit(data.progression, spiritId);
    if (result.progression !== data.progression) {
      data.progression = result.progression;
      client.send('progression_update', { progression: data.progression });
    }
    client.send('notification', { type: 'notification', message: result.message, level: result.level });
  }

  private handleGrimoireShare(
    client: Client,
    player: PlayerSchema,
    msg: Extract<ClientMessage, { type: 'grimoire_share' }>
  ): void {
    const data = this.playerData.get(client.sessionId);
    if (!data) return;
    const spell = contentRegistry.spells.get(msg.spellId);
    const known = data.progression.grimoire?.spells.some((entry) => entry.spellId === msg.spellId);
    if (!spell || !known) {
      client.send('notification', {
        type: 'notification',
        message: 'That working is not in your grimoire.',
        level: 'warn',
      });
      return;
    }

    let targetSession = msg.targetSessionId ?? '';
    if (!targetSession && msg.friendPlayerId) {
      targetSession = findOnlineByDbPlayerId(msg.friendPlayerId)?.sessionId ?? '';
    }
    if (!targetSession || targetSession === client.sessionId) {
      client.send('notification', {
        type: 'notification',
        message: 'They are not here to receive the page.',
        level: 'warn',
      });
      return;
    }

    const online = findOnlineBySessionId(targetSession);
    if (!online) {
      client.send('notification', {
        type: 'notification',
        message: 'They are not here to receive the page.',
        level: 'warn',
      });
      return;
    }

    const isFriend = data.friends.some((friend) => friend.playerId === online.dbPlayerId);
    if (!isFriend) {
      const targetPlayer = online.room.state.players.get(targetSession);
      const dx = targetPlayer ? Math.abs(targetPlayer.x - player.x) : 999;
      const dy = targetPlayer ? Math.abs(targetPlayer.y - player.y) : 999;
      const near =
        online.room === this &&
        !!targetPlayer &&
        targetPlayer.scene === player.scene &&
        dx <= 24 &&
        dy <= 24;
      if (!near) {
        client.send('notification', {
          type: 'notification',
          message: 'Share a page with someone beside you, or with a friend who is online.',
          level: 'warn',
        });
        return;
      }
    }

    const status = online.room.indexSharedSpell(targetSession, spell.id, player.displayName);
    const message =
      status === 'added'
        ? `${spell.name} is indexed in their grimoire.`
        : status === 'already'
          ? 'That page is already in their book.'
          : status === 'full'
            ? 'Their book has no room for another working.'
            : 'They are not here to receive the page.';
    client.send('notification', {
      type: 'notification',
      message,
      level: status === 'added' ? 'success' : 'info',
    });
  }

  private handleBuy(client: Client, player: PlayerSchema, shopId: string, itemId: string, quantity: number) {
    const data = this.playerData.get(client.sessionId);
    const result = shopSystem.buy(
      shopId,
      itemId,
      quantity,
      player.inventory,
      player.coins,
      shopPriceMultiplier(player.stats),
      player.stats,
      data?.progression
    );
    if (result.success && result.inventory && result.cost !== undefined) {
      player.inventory = result.inventory;
      player.coins -= result.cost;
      if (data && result.progression) {
        data.progression = withGrimoire(result.progression, (grimoire) =>
          recordGrimoireIngredients(grimoire, [{ itemId, count: quantity }])
        );
        client.send('progression_update', { progression: data.progression });
      }
    }
    client.send('shop_result', {
      type: 'shop_result',
      success: result.success,
      message: result.message,
      shopId,
      stock: result.stock ?? shopSystem.shopStockForPlayer(data?.progression, shopId),
    });
    if (result.success) this.sendPlayerSync(client, player);
  }

  /** Each player's NPC shelves refill once per local day at noon (hour ≥ 12). */
  private maybeRestockShopsAtNoon(hour: number): void {
    if (hour < 12) return;
    const dayKey = localDayKey();
    for (const client of this.clients) {
      const data = this.playerData.get(client.sessionId);
      if (!data) continue;
      if (data.progression.shopStockDay === dayKey) continue;
      data.progression = shopSystem.restockPlayer(data.progression, dayKey);
      client.send('progression_update', { progression: data.progression });
      client.send('shop_stock', {
        reason: 'noon_restock',
        shops: shopSystem.playerStockSnapshot(data.progression),
      });
      client.send('notification', {
        type: 'notification',
        message: 'Shopkeepers restock their shelves for the day.',
        level: 'info',
      });
    }
  }

  private syncPlayerShopStock(client: Client, reason: 'noon_restock' | 'sync' = 'sync'): void {
    const data = this.playerData.get(client.sessionId);
    if (!data) return;
    data.progression = shopSystem.ensureRestocked(data.progression, getWorldHour(), localDayKey());
    client.send('shop_stock', {
      reason,
      shops: shopSystem.playerStockSnapshot(data.progression),
    });
  }

  private handleUseItem(
    client: Client,
    player: PlayerSchema,
    itemId: string,
    quantity: number,
    slotIndex?: number
  ) {
    const itemDef = contentRegistry.ingredients.get(itemId);
    if (!itemDef) {
      client.send('notification', {
        type: 'notification',
        message: 'Unknown item.',
        level: 'error',
      });
      return;
    }

    if (itemDef.adminOnly && !this.adminSessions.has(client.sessionId)) {
      client.send('notification', {
        type: 'notification',
        message: 'You cannot use that item.',
        level: 'error',
      });
      return;
    }

    if (itemId === GRIMOIRE_MANUSCRIPT_ITEM_ID) {
      this.handleUseManuscript(client, player, slotIndex);
      return;
    }

    const qty = Math.max(1, Math.min(quantity, MAX_ITEM_STACK));
    if (!inventorySystem.hasItem(player.inventory, itemId, qty)) {
      client.send('notification', {
        type: 'notification',
        message: `You do not have enough ${itemDef.name}.`,
        level: 'error',
      });
      return;
    }

    if (itemId === NULLIFICATION_POWDER_ITEM_ID) {
      const removed = inventorySystem.removeItem(player.inventory, itemId, 1);
      if (!removed.ok) {
        client.send('notification', {
          type: 'notification',
          message: 'Could not consume Nullification Powder.',
          level: 'error',
        });
        return;
      }

      player.inventory = removed.inventory;
      player.aura = applyNullificationPowder(player.aura);
      this.refreshWardWeb(client.sessionId);

      client.send('notification', {
        type: 'notification',
        message:
          'Nullification Powder scatters — hexes, blessings, and personal ward layers dissolve. Household perimeter wards hold.',
        level: 'success',
      });
      this.sendPlayerSync(client, player);
      return;
    }

    if (
      this.withProgressionReturn(client, player, (ctx) => handleUseItemProgression(ctx, itemId))
    ) {
      return;
    }

    if (itemDef.category === 'food') {
      const removed = inventorySystem.removeItem(player.inventory, itemId, 1);
      if (!removed.ok) {
        client.send('notification', {
          type: 'notification',
          message: `Could not eat ${itemDef.name}.`,
          level: 'error',
        });
        return;
      }
      player.inventory = removed.inventory;
      const restore =
        typeof itemDef.hungerRestore === 'number' && Number.isFinite(itemDef.hungerRestore)
          ? Math.max(1, Math.round(itemDef.hungerRestore))
          : Math.min(40, 10 + Math.round((itemDef.basePotency ?? 1) * 5));
      const hunger = Math.min(MAX_HUNGER, (player.stats.hunger ?? MAX_HUNGER) + restore);
      player.stats = normalizePlayerStats({ ...player.stats, hunger });
      const sid = client.sessionId;
      this.survivalActivity.set(sid, 'eating');
      const prior = this.eatingTimers.get(sid);
      if (prior) clearTimeout(prior);
      const durationMs =
        typeof itemDef.eatingDurationMs === 'number' && itemDef.eatingDurationMs > 0
          ? Math.min(5 * 60_000, Math.round(itemDef.eatingDurationMs))
          : 90_000;
      this.eatingTimers.set(
        sid,
        setTimeout(() => {
          this.eatingTimers.delete(sid);
          if (this.survivalActivity.get(sid) === 'eating') {
            this.survivalActivity.delete(sid);
          }
        }, durationMs)
      );
      client.send('notification', {
        type: 'notification',
        message: `You eat the ${itemDef.name}. Hunger +${restore}. Stamina recovers faster while you digest.`,
        level: 'success',
      });
      this.sendPlayerSync(client, player);
      return;
    }

    client.send('notification', {
      type: 'notification',
      message: `${itemDef.name} has no use effect yet.`,
      level: 'error',
    });
  }

  private async handleCareFamiliar(client: Client, player: PlayerSchema, action: 'feed' | 'bond' | 'heal' | 'protect') {
    const fam = this.familiarStore.get(client.sessionId);
    if (!fam?.chosen) return;

    const result = familiarSystem.care(fam, action, {
      stats: player.stats,
      inventory: player.inventory,
    });

    if (!result.ok || !result.familiar) {
      client.send('notification', {
        type: 'notification',
        message: result.error ?? 'Care action failed.',
        level: 'error',
      });
      return;
    }

    player.stats = result.stats ?? player.stats;
    player.inventory = result.inventory ?? player.inventory;
    this.familiarStore.set(client.sessionId, result.familiar);

    const data = this.playerData.get(client.sessionId);
    if (data) data.familiar = result.familiar;

    if (action === 'bond' && data) {
      const xp = grantExperience(player.stats, data.progression, 'familiar_bond');
      player.stats = xp.stats;
      data.progression = xp.progression;
      client.send('progression_update', { progression: data.progression });
      if (xp.granted > 0) {
        client.send('notification', {
          type: 'notification',
          message: `+${xp.granted} XP — ${xp.source?.label ?? 'Familiar bond'}`,
          level: 'info',
        });
      }
    }

    try {
      await prisma.familiar.update({
        where: { playerId: player.dbPlayerId },
        data: {
          hunger: result.familiar.hunger,
          affection: result.familiar.affection,
          energy: result.familiar.energy,
          spiritualStability: result.familiar.spiritualStability,
          loyalty: result.familiar.loyalty,
          experience: result.familiar.experience,
          level: result.familiar.level,
          lastBondAt: result.familiar.lastBondAt ? new Date(result.familiar.lastBondAt) : undefined,
          protections: (result.familiar.protections ?? []) as never,
        },
      });
    } catch {
      /* legacy row */
    }

    client.send('familiar_update', { type: 'familiar_update', familiar: result.familiar });
    this.refreshWardWeb(client.sessionId);
    this.sendPlayerSync(client, player);
    client.send('notification', {
      type: 'notification',
      message: `${action.charAt(0).toUpperCase() + action.slice(1)} complete.`,
      level: 'success',
    });
  }

  private async handleChooseFamiliar(
    client: Client,
    player: PlayerSchema,
    msg: Extract<ClientMessage, { type: 'choose_familiar' }>
  ) {
    if (this.familiarStore.get(client.sessionId)?.chosen) {
      client.send('notification', { type: 'notification', message: 'You already have a familiar.', level: 'warn' });
      return;
    }
    const trueParts = msg.trueName.trim().split(/\s+/);
    if (trueParts.length < 2) {
      client.send('notification', { type: 'notification', message: 'True Name must be a first and last name.', level: 'error' });
      return;
    }
    if (!/^[A-Za-z]+$/.test(msg.publicName.trim())) {
      client.send('notification', { type: 'notification', message: 'Faux Name must be one word, letters only.', level: 'error' });
      return;
    }

    const fam = familiarSystem.createFromTemplate(msg.templateId, player.dbPlayerId, msg.trueName.trim(), msg.publicName.trim());
    if (!fam) {
      client.send('notification', { type: 'notification', message: 'Invalid familiar type.', level: 'error' });
      return;
    }

    this.familiarStore.set(client.sessionId, fam);
    player.familiarId = fam.id;
    const data = this.playerData.get(client.sessionId);
    if (data) data.familiar = fam;

    const stats = familiarSystem.applyBonuses(player.stats, fam);
    player.stats = stats;

    try {
      await prisma.familiar.create({
        data: {
          playerId: player.dbPlayerId,
          species: fam.species,
          templateId: fam.templateId,
          publicName: fam.publicName,
          trueName: fam.trueName,
          mainFunction: fam.mainFunction,
          chosen: true,
        },
      });
    } catch {
      /* may exist from legacy */
    }

    client.send('familiar_update', { type: 'familiar_update', familiar: fam });
    this.refreshWardWeb(client.sessionId);
    client.send('notification', { type: 'notification', message: `${fam.publicName} binds to your spirit.`, level: 'success' });
  }

  private handleCollectTaglock(client: Client, player: PlayerSchema, targetPlayerId: string) {
    const target = this.state.players.get(targetPlayerId);
    if (!target) return;

    const targetName = target.displayName;
    if (countTaglocksForTarget(player.inventory, targetName) >= MAX_TAGLOCKS_PER_TARGET) {
      client.send('notification', {
        type: 'notification',
        message: `You already have ${MAX_TAGLOCKS_PER_TARGET} taglocks for ${targetName}.`,
        level: 'error',
      });
      return;
    }

    if (inventorySlotCount(normalizeInventoryLayout(player.inventory)) >= INVENTORY_MAX_SLOTS) {
      client.send('notification', { type: 'notification', message: 'Inventory full.', level: 'error' });
      return;
    }

    const casterStats = { ...player.stats, health: Math.max(0, player.stats.health - 0.5) };
    player.stats = casterStats;

    const inv = inventorySystem.addItem(player.inventory, 'taglock_hair', 1, {
      sourcePlayerId: target.dbPlayerId,
      sourceName: targetName,
      targetName,
      collectedAt: Date.now(),
    });
    player.inventory = inv;
    const data = this.playerData.get(client.sessionId);
    if (data) data.inventory = inv;

    this.clients.find((c) => c.sessionId === targetPlayerId)?.send('notification', {
      type: 'notification',
      message: 'You feel a sharp tug — someone collected a taglock from you!',
      level: 'warn',
    });

    if (target.stats.intuition >= player.stats.intuition + 10) {
      this.clients.find((c) => c.sessionId === targetPlayerId)?.send('chat', {
        from: 'System',
        message: `${player.displayName} collected a taglock from you.`,
        channel: 'system',
      });
    }

    client.send('notification', {
      type: 'notification',
      message: `Collected hair taglock from ${targetName}.`,
      level: 'success',
    });
    this.sendPlayerSync(client, player);
  }

  private handleInventoryReorder(client: Client, player: PlayerSchema, slots: InventorySlot[]): void {
    const current = normalizeInventoryLayout(player.inventory);
    const proposed = normalizeInventoryLayout(slots);
    if (!isInventoryReorderValid(current, proposed)) {
      client.send('notification', {
        type: 'notification',
        message: 'Invalid inventory layout.',
        level: 'error',
      });
      return;
    }
    player.inventory = proposed;
    const data = this.playerData.get(client.sessionId);
    if (data) data.inventory = proposed;
    this.sendPlayerSync(client, player);
  }

  private handleInscribeTaglock(
    client: Client,
    player: PlayerSchema,
    slotIndex: number,
    targetName: string
  ): void {
    const result = inscribeWrittenTaglock(player.inventory, slotIndex, targetName);
    if (!result.ok) {
      client.send('notification', {
        type: 'notification',
        message: result.error ?? 'Could not inscribe taglock.',
        level: 'error',
      });
      return;
    }
    player.inventory = result.inventory;
    const data = this.playerData.get(client.sessionId);
    if (data) data.inventory = result.inventory;
    this.sendPlayerSync(client, player);
    client.send('notification', {
      type: 'notification',
      message: `Written name taglock inscribed for ${targetName.trim()}.`,
      level: 'success',
    });
  }

  private handleChat(
    client: Client,
    player: PlayerSchema,
    msg: Extract<ClientMessage, { type: 'chat' }>
  ): void {
    const raw = msg.message?.trim();
    if (!raw) return;

    if (isPlayerSilenced(player.aura)) {
      this.sendSystemChat(client, SILENCED_CHAT_MESSAGE);
      return;
    }

    const ts = Date.now();

    // /msg "Display Name" message  OR  /msg Name message
    if (raw.toLowerCase().startsWith('/msg ')) {
      const parsed = chatService.parseMsgTarget(raw.slice(5));
      if (!parsed?.message) {
        this.sendSystemChat(client, 'Usage: /msg "Display Name" your message');
        return;
      }
      this.deliverWhisper(client, player, parsed.target.sessionId, censorChatMessage(parsed.message), ts);
      return;
    }

    // /g or /global prefix
    if (raw.startsWith('/g ') || raw.startsWith('/global ')) {
      const text = censorChatMessage(raw.replace(/^\/(g|global)\s+/i, '').trim());
      if (!text) return;
      const payload: ChatPayload = {
        from: player.displayName,
        fromSessionId: client.sessionId,
        message: text,
        channel: 'global',
        scene: this.state.scene,
        timestamp: ts,
      };
      chatService.broadcastGlobal(payload);
      return;
    }

    const channel = msg.channel ?? 'local';
    const spoken = censorChatMessage(raw);

    if (channel === 'global') {
      const payload: ChatPayload = {
        from: player.displayName,
        fromSessionId: client.sessionId,
        message: spoken,
        channel: 'global',
        scene: this.state.scene,
        timestamp: ts,
      };
      chatService.broadcastGlobal(payload);
      return;
    }

    // Local — same world scene within this Colyseus room
    const payload: ChatPayload = {
      from: player.displayName,
      fromSessionId: client.sessionId,
      message: spoken,
      channel: 'local',
      scene: player.scene,
      timestamp: ts,
    };
    for (const other of this.clients) {
      const otherPlayer = this.state.players.get(other.sessionId);
      if (otherPlayer?.scene === player.scene) {
        other.send('chat', payload);
      }
    }
    return;
  }

  private sendSystemChat(client: Client, message: string): void {
    client.send('chat', {
      from: 'System',
      message,
      channel: 'system',
      timestamp: Date.now(),
    });
  }

  private deliverWhisper(
    sender: Client,
    player: PlayerSchema,
    targetSessionId: string,
    message: string,
    timestamp: number
  ): void {
    const targetRef = chatService.getAll().find((p) => p.sessionId === targetSessionId);
    if (!targetRef) {
      this.sendSystemChat(sender, 'That player is no longer online.');
      return;
    }

    chatService.sendTo(targetSessionId, {
      from: player.displayName,
      fromSessionId: sender.sessionId,
      message,
      channel: 'whisper',
      targetDisplayName: targetRef.displayName,
      timestamp,
    });

    chatService.sendTo(sender.sessionId, {
      from: `To ${targetRef.displayName}`,
      message,
      channel: 'whisper',
      targetDisplayName: targetRef.displayName,
      timestamp,
    });
  }

  private handleWhisper(client: Client, player: PlayerSchema, targetPlayerId: string, message: string) {
    if (!message.trim()) return;
    let targetSid = targetPlayerId;
    if (!this.state.players.get(targetSid)) {
      const data = this.playerData.get(client.sessionId);
      const friend = data?.friends.find((f) => f.playerId === targetPlayerId);
      if (friend) {
        const online = findOnlineByDbPlayerId(friend.playerId);
        if (online) targetSid = online.sessionId;
      }
    }
    this.deliverWhisper(client, player, targetSid, message.trim(), Date.now());
  }

  private recordMetPlayers(sessionId: string): void {
    const data = this.playerData.get(sessionId);
    const player = this.state.players.get(sessionId);
    if (!data || !player) return;

    for (const [otherId, other] of this.state.players) {
      if (otherId === sessionId) continue;
      const otherData = this.playerData.get(otherId);
      if (!otherData) continue;

      const exists = data.metPlayers.some((m) => m.playerId === otherData.dbPlayerId);
      if (!exists) {
        data.metPlayers.push({
          playerId: otherData.dbPlayerId,
          username: otherData.username,
          displayName: other.displayName,
          metAt: Date.now(),
        });
      }

      const otherExists = otherData.metPlayers.some((m) => m.playerId === data.dbPlayerId);
      if (!otherExists) {
        otherData.metPlayers.push({
          playerId: data.dbPlayerId,
          username: data.username,
          displayName: player.displayName,
          metAt: Date.now(),
        });
      }
    }
  }

  private handleInspectAura(client: Client, player: PlayerSchema, targetId: string) {
    const target = this.state.players.get(targetId);
    if (!target) return;
    const inspection = auraSystem.inspect(target.aura, player.stats.intuition, player.stats.spiritualAwareness);
    client.send('aura_inspection', {
      type: 'aura_inspection',
      targetId,
      targetName: target.displayName,
      aura: inspection,
      depth: inspection.depth ?? 'surface',
    });
  }

  private tickWards(): void {
    for (const [sid, player] of this.state.players.entries()) {
      const wards = this.activeWards.get(sid) ?? [];
      const previous = wards.map((w) => ({ ...w }));
      const stats = player.stats;
      const hasUpkeepWards = wards.some((w) => !w.permanent);
      const updated = wards
        .map((w) => wardSystem.tickMaintenance(w, stats.magicalEnergy))
        .filter((w): w is NonNullable<typeof w> => w !== null);
      this.activeWards.set(sid, updated);
      if (hasUpkeepWards && updated.length < wards.length) {
        player.stats = { ...stats, magicalEnergy: Math.max(0, stats.magicalEnergy - 1) };
      }
      if (this.wardsSnapshotChanged(previous, updated)) {
        this.persistWardChanges(sid, previous, updated);
        this.pushApartmentWardsToSession(sid, updated);
      } else {
        this.refreshWardWeb(sid);
      }
    }
  }

  private wardsSnapshotChanged(
    before: ReturnType<typeof wardSystem.createWard>[],
    after: ReturnType<typeof wardSystem.createWard>[]
  ): boolean {
    if (before.length !== after.length) return true;
    for (const a of before) {
      const b = after.find((w) => w.id === a.id);
      if (!b) return true;
      if (Math.abs(a.strength - b.strength) > 0.01) return true;
      if (a.expiresAt !== b.expiresAt) return true;
    }
    return false;
  }

  private pushApartmentWardsToSession(
    sessionId: string,
    wards: ReturnType<typeof wardSystem.createWard>[]
  ): void {
    const data = this.playerData.get(sessionId);
    if (data) data.wards = wards;
    const client = this.clients.find((c) => c.sessionId === sessionId);
    client?.send('apartment_wards', { type: 'apartment_wards', wards });
    this.refreshWardWeb(sessionId);
    this.broadcastHostWardsToVisitors(sessionId, wards);
  }

  private persistWardChanges(
    sessionId: string,
    previous: ReturnType<typeof wardSystem.createWard>[],
    current: ReturnType<typeof wardSystem.createWard>[]
  ): void {
    const data = this.playerData.get(sessionId);
    if (!data?.dbPlayerId) return;
    data.wards = current;
    const nextIds = new Set(current.map((w) => w.id));
    for (const w of previous) {
      if (!nextIds.has(w.id)) void deactivateWard(w.id);
    }
    for (const w of current) {
      void updateWard(w);
    }
  }

  private async storeNewWard(
    sessionId: string,
    ward: ReturnType<typeof wardSystem.createWard>
  ): Promise<ReturnType<typeof wardSystem.createWard>> {
    const data = this.playerData.get(sessionId);
    if (!data?.dbPlayerId) return ward;
    const saved = await saveWard(data.dbPlayerId, ward);
    return saved ?? ward;
  }

  /** Apply household ambient + familiar/practitioner ward web cross-link. */
  private refreshWardWeb(sessionId: string): void {
    const player = this.state.players.get(sessionId);
    if (!player) return;

    const hostSessionId = this.apartmentHostBySession.get(sessionId);
    const ambientWards = resolveAmbientApartmentWards(
      sessionId,
      player.scene,
      hostSessionId,
      this.activeWards
    );
    const wardHostSessionId = resolveApartmentHostSessionId(sessionId, hostSessionId);
    const hostData = this.playerData.get(wardHostSessionId);
    const hostDbId = hostData?.dbPlayerId ?? player.dbPlayerId;

    const fam = this.familiarStore.get(sessionId);
    const linked = computeWardWebCrossLink({
      playerAura: player.aura,
      familiar: fam,
      ambientWards,
      hostDbPlayerId: hostDbId,
      inApartment: player.scene === 'apartment',
    });

    player.aura = linked.playerAura;
    const playerData = this.playerData.get(sessionId);
    if (playerData) playerData.aura = player.aura;

    if (linked.familiar) {
      this.familiarStore.set(sessionId, linked.familiar);
      if (playerData) playerData.familiar = linked.familiar;
      const client = this.clients.find((c) => c.sessionId === sessionId);
      client?.send('familiar_update', { type: 'familiar_update', familiar: linked.familiar });
    }

    const syncClient = this.clients.find((c) => c.sessionId === sessionId);
    if (syncClient) this.sendPlayerSync(syncClient, player);
  }

  private broadcastHostWardsToVisitors(hostSessionId: string, wards: ReturnType<typeof wardSystem.createWard>[]): void {
    const host = this.state.players.get(hostSessionId);
    const hostData = this.playerData.get(hostSessionId);
    if (!host || !hostData) return;

    for (const [visitorId, hostId] of this.apartmentHostBySession) {
      if (hostId !== hostSessionId) continue;
      const visitorClient = this.clients.find((c) => c.sessionId === visitorId);
      visitorClient?.send('apartment_visit', {
        type: 'apartment_visit',
        hostSessionId,
        hostDbPlayerId: host.dbPlayerId,
        hostName: host.displayName,
        wards,
      });
      this.refreshWardWeb(visitorId);
    }

    const hostClient = this.clients.find((c) => c.sessionId === hostSessionId);
    hostClient?.send('apartment_wards', { type: 'apartment_wards', wards });
  }

  private handleVisitApartment(_client: Client, _player: PlayerSchema, _targetSessionId: string): void {
    /* replaced by friend invite flow */
  }

  private handleApartmentInvite(client: Client, player: PlayerSchema, friendDbPlayerId: string): void {
    const data = this.playerData.get(client.sessionId);
    if (!data) return;

    if (!areFriends(data.friends, friendDbPlayerId)) {
      this.sendSystemChat(client, 'You can only invite friends to your apartment.');
      return;
    }

    const guestOnline = findOnlineByDbPlayerId(friendDbPlayerId);
    if (!guestOnline) {
      this.sendSystemChat(client, 'Your friend is not online.');
      return;
    }

    const invite = createApartmentInvite(
      { dbPlayerId: player.dbPlayerId, sessionId: client.sessionId, displayName: player.displayName },
      { dbPlayerId: friendDbPlayerId, sessionId: guestOnline.sessionId }
    );

    this.clients.find((c) => c.sessionId === guestOnline.sessionId)?.send('apartment_invite_received', {
      type: 'apartment_invite_received',
      inviteId: invite.id,
      hostName: player.displayName,
      hostDbPlayerId: player.dbPlayerId,
    });

    client.send('notification', {
      type: 'notification',
      message: `Apartment invite sent to ${guestOnline.displayName}.`,
      level: 'info',
    });
  }

  private handleApartmentInviteResponse(client: Client, player: PlayerSchema, inviteId: string, accept: boolean): void {
    const invite = getApartmentInvite(inviteId);
    if (!invite || invite.guestDbPlayerId !== player.dbPlayerId) {
      client.send('apartment_invite_result', { type: 'apartment_invite_result', success: false, message: 'Invite expired or invalid.' });
      return;
    }

    removeApartmentInvite(inviteId);

    if (!accept) {
      const hostOnline = findOnlineBySessionId(invite.hostSessionId);
      hostOnline?.room.clients.find((c) => c.sessionId === invite.hostSessionId)?.send('notification', {
        type: 'notification',
        message: `${player.displayName} declined your apartment invite.`,
        level: 'info',
      });
      client.send('apartment_invite_result', { type: 'apartment_invite_result', success: true, message: 'Invite declined.' });
      return;
    }

    const hostOnline = findOnlineBySessionId(invite.hostSessionId);
    if (!hostOnline) {
      client.send('apartment_invite_result', { type: 'apartment_invite_result', success: false, message: 'Host is no longer online.' });
      return;
    }

    if (hostOnline.room !== this) {
      client.send('apartment_invite_result', {
        type: 'apartment_invite_result',
        success: false,
        message: 'Could not sync worlds — both players must be in Hollow Creek. Try re-entering town.',
      });
      return;
    }

    hostOnline.room.startApartmentGathering(
      invite.hostSessionId,
      client.sessionId,
      hostOnline.displayName
    );

    client.send('apartment_invite_result', { type: 'apartment_invite_result', success: true, message: `You enter ${hostOnline.displayName}'s apartment.` });
    hostOnline.room.clients.find((c) => c.sessionId === hostOnline.sessionId)?.send('notification', {
      type: 'notification',
      message: `${player.displayName} arrives at your threshold.`,
      level: 'success',
    });
  }

  /** Host + guest gather in the host apartment — guest visit state sent before any broadcasts. */
  startApartmentGathering(hostSessionId: string, guestSessionId: string, hostName: string): void {
    const hostClient = this.clients.find((c) => c.sessionId === hostSessionId);
    const guestClient = this.clients.find((c) => c.sessionId === guestSessionId);
    const hostPlayer = this.state.players.get(hostSessionId);
    const guestPlayer = this.state.players.get(guestSessionId);
    if (!hostClient || !guestClient || !hostPlayer || !guestPlayer) return;

    this.apartmentHostBySession.set(guestSessionId, hostSessionId);

    const guestData = this.playerData.get(guestSessionId);
    if (guestData) {
      guestData.location.visitingHostDbPlayerId = hostPlayer.dbPlayerId;
    }

    guestClient.send('apartment_visit', {
      type: 'apartment_visit',
      hostSessionId,
      hostDbPlayerId: hostPlayer.dbPlayerId,
      hostName,
      wards: this.activeWards.get(hostSessionId) ?? [],
    });

    this.apartmentHostBySession.delete(hostSessionId);
    hostClient.send('apartment_home', {
      type: 'apartment_home',
      wards: this.activeWards.get(hostSessionId) ?? [],
    });
    this.teleportPlayerToApartment(hostSessionId, hostClient, hostPlayer, false);
    this.persistLocation(hostSessionId);
    this.refreshWardWeb(hostSessionId);

    this.teleportPlayerToApartment(guestSessionId, guestClient, guestPlayer, true);
    this.persistLocation(guestSessionId);
    void this.flushLocationToDb(guestSessionId, true);
    this.refreshWardWeb(guestSessionId);

    this.recordMetPlayers(hostSessionId);
    this.recordMetPlayers(guestSessionId);

    this.broadcastPresence('scene', hostSessionId);
    this.broadcastPresence('scene', guestSessionId);
    this.sendPresenceSync(hostClient);
    this.sendPresenceSync(guestClient);
  }

  /** Host side of a friend visit — both players teleported to host home. */
  beginApartmentGathering(hostSessionId: string, guestSessionId: string): void {
    const hostClient = this.clients.find((c) => c.sessionId === hostSessionId);
    const hostPlayer = this.state.players.get(hostSessionId);
    if (!hostClient || !hostPlayer) return;

    this.apartmentHostBySession.delete(hostSessionId);
    hostClient.send('apartment_home', {
      type: 'apartment_home',
      wards: this.activeWards.get(hostSessionId) ?? [],
    });
    this.teleportPlayerToApartment(hostSessionId, hostClient, hostPlayer, false);
    this.persistLocation(hostSessionId);
    this.refreshWardWeb(hostSessionId);
    this.recordMetPlayers(hostSessionId);
    this.broadcastPresence('scene', hostSessionId);
  }

  beginApartmentGatheringAsGuest(
    guestSessionId: string,
    hostSessionId: string,
    hostName: string,
    hostRoom: GameRoom
  ): void {
    const guestClient = this.clients.find((c) => c.sessionId === guestSessionId);
    const guestPlayer = this.state.players.get(guestSessionId);
    if (!guestClient || !guestPlayer) return;

    this.apartmentHostBySession.set(guestSessionId, hostSessionId);

    guestClient.send('apartment_visit', {
      type: 'apartment_visit',
      hostSessionId,
      hostDbPlayerId: hostRoom.findPlayerBySessionId(hostSessionId)?.dbPlayerId ?? '',
      hostName,
      wards: hostRoom.getSessionWards(hostSessionId),
    });

    this.teleportPlayerToApartment(guestSessionId, guestClient, guestPlayer, true);

    const data = this.playerData.get(guestSessionId);
    if (data) {
      data.location.visitingHostDbPlayerId = hostRoom.findPlayerBySessionId(hostSessionId)?.dbPlayerId;
    }
    this.persistLocation(guestSessionId);
    void this.flushLocationToDb(guestSessionId, true);
    this.refreshWardWeb(guestSessionId);
    this.recordMetPlayers(guestSessionId);
    this.broadcastPresence('scene', guestSessionId);
  }

  private teleportPlayerToApartment(sessionId: string, client: Client, player: PlayerSchema, asGuest: boolean): void {
    player.scene = 'apartment';
    const mapDef = contentRegistry.getMapForScene('apartment');
    const spawn = mapDef?.spawnPoints.find((s) => s.id === 'default') ?? { x: 8, y: 10 };
    player.x = spawn.x;
    player.y = spawn.y;
    chatService.updateRoom(client.sessionId, this.roomId, 'apartment');
    this.persistLocation(sessionId, 'default');

    client.send('scene_change', { scene: 'apartment', spawnId: 'default' });

    this.broadcastPresence('scene', sessionId);

    if (!asGuest) {
      client.send('apartment_wards', { type: 'apartment_wards', wards: this.activeWards.get(sessionId) ?? [] });
    }
  }

  private handleLeaveApartment(client: Client, player: PlayerSchema): void {
    if (!this.apartmentHostBySession.has(client.sessionId)) {
      this.sendSystemChat(client, 'You are in your own apartment.');
      return;
    }

    const formerHostSessionId = this.apartmentHostBySession.get(client.sessionId);
    this.apartmentHostBySession.delete(client.sessionId);
    const ownWards = this.activeWards.get(client.sessionId) ?? [];
    const data = this.playerData.get(client.sessionId);
    if (data) data.location.visitingHostDbPlayerId = undefined;

    client.send('apartment_left', {
      type: 'apartment_left',
      wards: ownWards,
    });

    this.refreshWardWeb(client.sessionId);
    this.persistLocation(client.sessionId);
    void this.flushLocationToDb(client.sessionId, true);
    this.broadcastPresence('scene', client.sessionId);
    this.sendPresenceSync(client);
    if (formerHostSessionId) {
      const hostClient = this.clients.find((c) => c.sessionId === formerHostSessionId);
      if (hostClient) this.sendPresenceSync(hostClient);
    }

    client.send('notification', {
      type: 'notification',
      message: 'You return to your own threshold.',
      level: 'info',
    });
  }

  private async handleFriendRequest(client: Client, player: PlayerSchema, targetUsername: string): Promise<void> {
    const data = this.playerData.get(client.sessionId);
    if (!data) return;
    const result = await sendFriendRequest(
      { dbPlayerId: player.dbPlayerId, username: data.username, displayName: player.displayName },
      targetUsername
    );
    if (!result.ok) {
      client.send('notification', { type: 'notification', message: result.error, level: 'error' });
      return;
    }
    client.send('notification', { type: 'notification', message: 'Friend request sent.', level: 'success' });
    const target = await prisma.player.findUnique({ where: { username: targetUsername.toLowerCase() }, select: { id: true } });
    if (target) {
      const targetOnline = findOnlineByDbPlayerId(target.id);
      targetOnline?.room.pushFriendsUpdate(target.id);
    }
  }

  private async handleFriendRespond(client: Client, player: PlayerSchema, fromPlayerId: string, accept: boolean): Promise<void> {
    const result = await respondFriendRequest(player.dbPlayerId, fromPlayerId, accept);
    if (!result.ok) {
      client.send('notification', { type: 'notification', message: result.error, level: 'error' });
      return;
    }
    const data = this.playerData.get(client.sessionId);
    if (data) {
      const refreshed = await loadFriendData(player.dbPlayerId);
      data.friends = refreshed.friends;
      data.friendRequests = refreshed.friendRequests;
    }
    await this.pushFriendsUpdate(player.dbPlayerId);
    findOnlineByDbPlayerId(fromPlayerId)?.room.pushFriendsUpdate(fromPlayerId);
    client.send('notification', {
      type: 'notification',
      message: accept ? 'Friend added.' : 'Request declined.',
      level: accept ? 'success' : 'info',
    });
  }

  private async handleFriendRemove(client: Client, player: PlayerSchema, friendPlayerId: string): Promise<void> {
    await removeFriend(player.dbPlayerId, friendPlayerId);
    const data = this.playerData.get(client.sessionId);
    if (data) {
      data.friends = data.friends.filter((f) => f.playerId !== friendPlayerId);
    }
    await this.pushFriendsUpdate(player.dbPlayerId);
    findOnlineByDbPlayerId(friendPlayerId)?.room.pushFriendsUpdate(friendPlayerId);
    client.send('notification', { type: 'notification', message: 'Friend removed.', level: 'info' });
  }

  private handleFeedWard(
    client: Client,
    player: PlayerSchema,
    targetKind: 'apartment' | 'aura_ward' | 'protection',
    targetId: string
  ): void {
    const hostSessionId = this.apartmentHostBySession.get(client.sessionId);
    const wardOwnerSessionId =
      targetKind === 'apartment' && hostSessionId ? hostSessionId : client.sessionId;

    if (targetKind === 'apartment' && hostSessionId && hostSessionId !== client.sessionId) {
      client.send('notification', {
        type: 'notification',
        message: 'Only the host can feed perimeter wards.',
        level: 'error',
      });
      return;
    }

    const result = feedWardTarget(
      {
        stats: player.stats,
        inventory: player.inventory,
        apartmentWards: this.activeWards.get(wardOwnerSessionId) ?? [],
        aura: player.aura,
      },
      targetKind,
      targetId
    );

    if (!result.ok) {
      client.send('notification', { type: 'notification', message: result.message, level: 'error' });
      return;
    }

    player.stats = { ...player.stats, ...result.stats };
    player.inventory = result.inventory ?? player.inventory;
    player.aura = result.aura ?? player.aura;
    if (result.apartmentWards) {
      const prev = this.activeWards.get(wardOwnerSessionId) ?? [];
      this.activeWards.set(wardOwnerSessionId, result.apartmentWards);
      this.persistWardChanges(wardOwnerSessionId, prev, result.apartmentWards);
      this.pushApartmentWardsToSession(wardOwnerSessionId, result.apartmentWards);
    }

    this.sendPlayerSync(client, player);
    client.send('notification', { type: 'notification', message: result.message, level: 'success' });
  }

  private getSurvivalActivity(sessionId: string): SurvivalActivity {
    return this.survivalActivity.get(sessionId) ?? 'idle';
  }

  private wakeFromRest(sessionId: string, client?: Client, message?: string): void {
    if (!this.survivalActivity.has(sessionId)) return;
    this.survivalActivity.delete(sessionId);
    const eatTimer = this.eatingTimers.get(sessionId);
    if (eatTimer) {
      clearTimeout(eatTimer);
      this.eatingTimers.delete(sessionId);
    }
    if (client && message) {
      client.send('notification', { type: 'notification', message, level: 'info' });
    }
  }

  private handleBedInteract(client: Client, player: PlayerSchema): void {
    const sid = client.sessionId;
    if (this.getSurvivalActivity(sid) === 'sleeping') {
      this.wakeFromRest(sid, client, 'You rise from rest, feeling somewhat restored.');
      return;
    }
    if (player.scene !== 'apartment') {
      client.send('notification', {
        type: 'notification',
        message: 'You can only rest in your apartment.',
        level: 'warn',
      });
      return;
    }
    this.survivalActivity.set(sid, 'sleeping');
    client.send('notification', {
      type: 'notification',
      message: 'You settle in to rest. Stamina and health recover faster while you sleep. Move or interact to wake.',
      level: 'info',
    });
  }

  private tickMeRegen(): void {
    const now = Date.now();
    for (const [sid, player] of this.state.players.entries()) {
      const fam = this.familiarStore.get(sid);
      const interval = meRegenIntervalMs(fam);
      const last = this.lastMeRegenAt.get(sid) ?? now;
      if (now - last < interval) continue;
      this.lastMeRegenAt.set(sid, now);
      const meAmount =
        computeMeRegenAmount(player.stats) *
        hungerRegenMultiplier(player.stats.hunger ?? 100, 'magicalEnergy') *
        (this.getSurvivalActivity(sid) === 'sleeping' ? 1.25 : 1);
      player.stats = applyMeRegen(player.stats, meAmount);
      const data = this.playerData.get(sid);
      if (data) data.stats = player.stats;
      const client = this.clients.find((c) => c.sessionId === sid);
      if (client) this.sendPlayerSync(client, player);
    }
  }

  /** Fixed-tick hunger decay + stamina regeneration (server authoritative). */
  private tickSurvival(): void {
    for (const [sid, player] of this.state.players.entries()) {
      const before = player.stats;
      const activity = this.getSurvivalActivity(sid);
      const after = applySurvivalTick(before, 30000, activity);
      if (
        after.hunger === before.hunger &&
        after.stamina === before.stamina &&
        after.health === before.health
      ) {
        continue;
      }
      player.stats = after;
      const data = this.playerData.get(sid);
      if (data) data.stats = after;
      const client = this.clients.find((c) => c.sessionId === sid);
      if (client) this.sendPlayerSync(client, player);
    }
  }

  private syncPlayerDataFromSession(sessionId: string, spawnId?: string): void {
    const player = this.state.players.get(sessionId);
    const data = this.playerData.get(sessionId);
    if (!player || !data) return;

    this.persistLocation(sessionId, spawnId);
    data.wards = this.activeWards.get(sessionId) ?? data.wards;
    const fam = this.familiarStore.get(sessionId);
    data.stats = normalizePlayerStats(
      fam ? familiarSystem.stripBonuses(player.stats, fam) : player.stats
    );
    data.inventory = player.inventory;
    data.altar = player.altar;
    data.aura = player.aura;
    data.coins = player.coins;
    if (fam) data.familiar = fam;
  }

  private persistLocation(sessionId: string, spawnId?: string): void {
    const player = this.state.players.get(sessionId);
    const data = this.playerData.get(sessionId);
    if (!player || !data) return;

    const hostSession = this.apartmentHostBySession.get(sessionId);
    const hostData = hostSession ? this.playerData.get(hostSession) : undefined;

    data.location = {
      scene: player.scene as SceneId,
      x: player.x,
      y: player.y,
      spawnId: spawnId ?? data.location?.spawnId ?? 'default',
      visitingHostDbPlayerId: hostSession ? hostData?.dbPlayerId : undefined,
    };
  }

  private async flushLocationToDb(sessionId: string, force = false): Promise<void> {
    const data = this.playerData.get(sessionId);
    if (!data?.dbPlayerId) return;
    this.syncPlayerDataFromSession(sessionId);
    const last = this.lastLocationSaveAt.get(sessionId) ?? 0;
    if (!force && Date.now() - last < 30000) return;
    this.lastLocationSaveAt.set(sessionId, Date.now());
    try {
      await savePlayer(data);
    } catch {
      /* non-fatal */
    }
  }

  /** Refresh friend lists for this player and everyone who lists them as a friend */
  async notifyFriendsPresenceChanged(dbPlayerId: string): Promise<void> {
    if (!dbPlayerId) return;
    await this.pushFriendsUpdate(dbPlayerId);
    const { friends } = await loadFriendData(dbPlayerId);
    for (const f of friends) {
      await this.pushFriendsUpdate(f.playerId);
    }
  }

  async pushFriendsUpdate(dbPlayerId: string): Promise<void> {
    for (const [sessionId, player] of this.state.players.entries()) {
      if (player.dbPlayerId !== dbPlayerId) continue;
      const data = this.playerData.get(sessionId);
      if (!data) return;
      const refreshed = await loadFriendData(dbPlayerId);
      data.friends = refreshed.friends;
      data.friendRequests = refreshed.friendRequests;
      const friendPresence = await buildFriendPresenceList(data.friends, (pid) => {
        const online = findOnlineByDbPlayerId(pid);
        if (!online) return null;
        if (online.room.isSessionVanished(online.sessionId)) return null;
        return { scene: online.scene, stats: online.stats };
      });
      this.clients.find((c) => c.sessionId === sessionId)?.send('friends_update', {
        type: 'friends_update',
        friends: data.friends,
        friendRequests: data.friendRequests,
        friendPresence,
      });
      return;
    }
  }

  findPlayerByDbId(dbPlayerId: string): {
    sessionId: string;
    dbPlayerId: string;
    displayName: string;
    username: string;
    scene: string;
    stats: PlayerSchema['stats'];
  } | undefined {
    for (const [sessionId, player] of this.state.players.entries()) {
      if (player.dbPlayerId !== dbPlayerId) continue;
      const data = this.playerData.get(sessionId);
      return {
        sessionId,
        dbPlayerId: player.dbPlayerId,
        displayName: player.displayName,
        username: data?.username ?? '',
        scene: player.scene,
        stats: player.stats,
      };
    }
    return undefined;
  }

  findPlayerBySessionId(sessionId: string): ReturnType<GameRoom['findPlayerByDbId']> {
    const player = this.state.players.get(sessionId);
    if (!player) return undefined;
    const data = this.playerData.get(sessionId);
    return {
      sessionId,
      dbPlayerId: player.dbPlayerId,
      displayName: player.displayName,
      username: data?.username ?? '',
      scene: player.scene,
      stats: player.stats,
    };
  }

  listOnlinePlayers(): NonNullable<ReturnType<GameRoom['findPlayerByDbId']>>[] {
    return [...this.state.players.keys()]
      .map((sid) => this.findPlayerBySessionId(sid))
      .filter((p): p is NonNullable<ReturnType<GameRoom['findPlayerByDbId']>> => !!p);
  }

  getSessionWards(sessionId: string): ReturnType<typeof wardSystem.createWard>[] {
    return this.activeWards.get(sessionId) ?? [];
  }

  /** Push updated map templates to every connected client in this room. */
  pushLiveMapsUpdate(payload: {
    maps: ContentMapDefinition[];
    revision: number;
    resnapSpawns: boolean;
  }): number {
    for (const client of this.clients) {
      client.send('content_maps_update', {
        maps: payload.maps,
        revision: payload.revision,
      });
    }

    if (payload.resnapSpawns) {
      for (const client of this.clients) {
        const player = this.state.players.get(client.sessionId);
        const data = this.playerData.get(client.sessionId);
        if (!player || !data) continue;

        const mapDef = contentRegistry.getMapForScene(player.scene);
        if (!mapDef) continue;

        const spawnId = data.location?.spawnId ?? 'default';
        const spawn =
          mapDef.spawnPoints.find((s) => s.id === spawnId) ??
          mapDef.spawnPoints.find((s) => s.id === 'default');
        if (!spawn) continue;

        player.x = spawn.x;
        player.y = spawn.y;
        this.persistLocation(client.sessionId, spawnId);
        client.send('scene_change', { scene: player.scene, spawnId });
        this.broadcastPresence('move', client.sessionId);
      }
    }

    return this.clients.length;
  }

  private handleTradeRequest(
    client: Client,
    player: PlayerSchema,
    targetSessionId?: string,
    friendDbPlayerId?: string
  ): void {
    let targetSid = targetSessionId;
    if (friendDbPlayerId) {
      const data = this.playerData.get(client.sessionId);
      if (!data || !areFriends(data.friends, friendDbPlayerId)) {
        this.sendSystemChat(client, 'You can only distant-trade with friends.');
        return;
      }
      const online = findOnlineByDbPlayerId(friendDbPlayerId);
      if (!online) {
        this.sendSystemChat(client, 'Friend is offline.');
        return;
      }
      targetSid = online.sessionId;
    }

    if (!targetSid || targetSid === client.sessionId) return;
    const target = this.state.players.get(targetSid) ?? findOnlineBySessionId(targetSid);
    if (!target) {
      this.sendSystemChat(client, 'That player is not available.');
      return;
    }

    const resolvedSid = 'sessionId' in target ? target.sessionId : targetSid;
    const session = tradeSystem.createRequest(client.sessionId, resolvedSid);
    const targetClient =
      this.clients.find((c) => c.sessionId === resolvedSid) ??
      findOnlineBySessionId(resolvedSid)?.room.clients.find((c) => c.sessionId === resolvedSid);

    targetClient?.send('trade_invite', {
      type: 'trade_invite',
      tradeId: session.id,
      fromName: player.displayName,
      fromSessionId: client.sessionId,
    });

    client.send('trade_state', this.buildTradeState(session, client.sessionId));
    client.send('notification', {
      type: 'notification',
      message: `Trade request sent to ${('displayName' in target ? target.displayName : 'friend')}.`,
      level: 'info',
    });
  }

  private handleTradeOffer(
    client: Client,
    player: PlayerSchema,
    tradeId: string,
    coins: number,
    items: { itemId: string; quantity: number }[]
  ): void {
    const session = tradeSystem.updateOffer(tradeId, client.sessionId, { coins, items });
    if (!session) {
      client.send('notification', { type: 'notification', message: 'Trade session not found.', level: 'error' });
      return;
    }
    this.pushTradeState(session);
  }

  private handleTradeAccept(client: Client, player: PlayerSchema, tradeId: string, accepted: boolean): void {
    const session = tradeSystem.setAccepted(tradeId, client.sessionId, accepted);
    if (!session) {
      client.send('notification', { type: 'notification', message: 'Trade session not found.', level: 'error' });
      return;
    }

    if (session.aAccepted && session.bAccepted) {
      const refA = findOnlineBySessionId(session.aSessionId);
      const refB = findOnlineBySessionId(session.bSessionId);
      const playerA = this.state.players.get(session.aSessionId) ?? refA?.room.state.players.get(session.aSessionId);
      const playerB = this.state.players.get(session.bSessionId) ?? refB?.room.state.players.get(session.bSessionId);
      if (!playerA || !playerB) {
        tradeSystem.cancel(tradeId, client.sessionId);
        return;
      }

      const result = tradeSystem.tryExecute(tradeId, {
        sessionId: playerA.sessionId,
        displayName: playerA.displayName,
        inventory: playerA.inventory,
        coins: playerA.coins,
      }, {
        sessionId: playerB.sessionId,
        displayName: playerB.displayName,
        inventory: playerB.inventory,
        coins: playerB.coins,
      });

      if (!result.ok) {
        session.aAccepted = false;
        session.bAccepted = false;
        this.pushTradeState(session);
        client.send('notification', { type: 'notification', message: result.error ?? 'Trade failed.', level: 'error' });
        return;
      }

      playerA.inventory = result.aInventory!;
      playerA.coins = result.aCoins!;
      playerB.inventory = result.bInventory!;
      playerB.coins = result.bCoins!;

      const gainedByA = session.bOffer.items.map((item) => ({ itemId: item.itemId, count: item.quantity }));
      const gainedByB = session.aOffer.items.map((item) => ({ itemId: item.itemId, count: item.quantity }));
      findOnlineBySessionId(session.aSessionId)?.room.noteGatheredItems(session.aSessionId, gainedByA);
      findOnlineBySessionId(session.bSessionId)?.room.noteGatheredItems(session.bSessionId, gainedByB);

      const rooms = new Set([refA?.room, refB?.room, this].filter(Boolean));
      for (const room of rooms) {
        const r = room as GameRoom;
        const cA = r.clients.find((c) => c.sessionId === session.aSessionId);
        const cB = r.clients.find((c) => c.sessionId === session.bSessionId);
        const pA = r.state.players.get(session.aSessionId);
        const pB = r.state.players.get(session.bSessionId);
        if (pA) {
          pA.inventory = result.aInventory!;
          pA.coins = result.aCoins!;
          if (cA) r.sendPlayerSync(cA, pA);
        }
        if (pB) {
          pB.inventory = result.bInventory!;
          pB.coins = result.bCoins!;
          if (cB) r.sendPlayerSync(cB, pB);
        }
      }

      refA?.room.clients.find((c) => c.sessionId === session.aSessionId)?.send('trade_complete', {
        type: 'trade_complete',
        message: `Trade with ${playerB.displayName} complete.`,
      });
      refB?.room.clients.find((c) => c.sessionId === session.bSessionId)?.send('trade_complete', {
        type: 'trade_complete',
        message: `Trade with ${playerA.displayName} complete.`,
      });
      return;
    }

    this.pushTradeState(session);
  }

  private handleTradeCancel(client: Client, player: PlayerSchema, tradeId: string): void {
    const session = tradeSystem.getById(tradeId);
    if (!session) return;
    tradeSystem.cancel(tradeId, client.sessionId);

    const otherId = session.aSessionId === client.sessionId ? session.bSessionId : session.aSessionId;
    const otherClient = this.clients.find((c) => c.sessionId === otherId);
    otherClient?.send('trade_cancelled', { type: 'trade_cancelled', message: `${player.displayName} cancelled the trade.` });
    client.send('trade_cancelled', { type: 'trade_cancelled', message: 'Trade cancelled.' });
  }

  private buildTradeState(session: ReturnType<typeof tradeSystem.getById>, sessionId: string) {
    if (!session) throw new Error('missing trade session');
    const isA = session.aSessionId === sessionId;
    const partnerId = isA ? session.bSessionId : session.aSessionId;
    const partner =
      this.state.players.get(partnerId) ?? findOnlineBySessionId(partnerId);
    return {
      type: 'trade_state' as const,
      tradeId: session.id,
      partnerName: partner?.displayName ?? 'Partner',
      partnerSessionId: partnerId,
      yourOffer: isA ? session.aOffer : session.bOffer,
      theirOffer: isA ? session.bOffer : session.aOffer,
      youAccepted: isA ? session.aAccepted : session.bAccepted,
      theyAccepted: isA ? session.bAccepted : session.aAccepted,
    };
  }

  private pushTradeState(session: NonNullable<ReturnType<typeof tradeSystem.getById>>): void {
    const clientA =
      this.clients.find((c) => c.sessionId === session.aSessionId) ??
      findOnlineBySessionId(session.aSessionId)?.room.clients.find((c) => c.sessionId === session.aSessionId);
    const clientB =
      this.clients.find((c) => c.sessionId === session.bSessionId) ??
      findOnlineBySessionId(session.bSessionId)?.room.clients.find((c) => c.sessionId === session.bSessionId);
    clientA?.send('trade_state', this.buildTradeState(session, session.aSessionId));
    clientB?.send('trade_state', this.buildTradeState(session, session.bSessionId));
  }

  /** Push authoritative inventory/stats/aura to client (avoids Colyseus patch timing races) */
  sendPlayerSync(client: Client, player: PlayerSchema): void {
    client.send('player_sync', {
      type: 'player_sync',
      statsJson: player.statsJson,
      inventoryJson: player.inventoryJson,
      auraJson: player.auraJson,
      altarJson: player.altarJson,
      coins: player.coins,
    });
  }

  /** Admin: instantly destroy a ward with the same client feedback as Shield Breaker. */
  adminShatterWard(wardId: string, adminName: string): boolean {
    for (const [ownerSessionId, wards] of this.activeWards.entries()) {
      const ward = wards.find((w) => w.id === wardId);
      if (!ward) continue;

      const previous = wards.map((w) => ({ ...w }));
      const updated = wards.filter((w) => w.id !== wardId);
      this.activeWards.set(ownerSessionId, updated);

      const ownerPlayer = this.state.players.get(ownerSessionId);
      if (ownerPlayer) {
        ownerPlayer.aura = {
          ...ownerPlayer.aura,
          wards: ownerPlayer.aura.wards.filter((w) => w.id !== wardId),
        };
      }

      for (const [sid, player] of this.state.players.entries()) {
        if (!player.aura.wards.some((w) => w.id === wardId)) continue;
        player.aura = {
          ...player.aura,
          wards: player.aura.wards.filter((w) => w.id !== wardId),
        };
        const client = this.clients.find((c) => c.sessionId === sid);
        if (client) this.sendPlayerSync(client, player);
      }

      this.persistWardChanges(ownerSessionId, previous, updated);
      this.pushApartmentWardsToSession(ownerSessionId, updated);

      const broken = [{
        kind: 'apartment_ward' as const,
        id: ward.id,
        name: ward.targetType === 'apartment' ? 'Apartment Ward' : 'Ward',
        damageApplied: ward.strength,
        wasWard: true,
      }];

      const notifySessions = new Set<string>([ownerSessionId]);
      for (const [sid] of this.state.players.entries()) {
        if (this.sharesWorldSpace(ownerSessionId, sid)) notifySessions.add(sid);
      }

      for (const sid of notifySessions) {
        const client = this.clients.find((c) => c.sessionId === sid);
        client?.send('shield_break', {
          type: 'shield_break',
          casterName: adminName,
          broken,
          totalDamage: ward.strength,
          notify: true,
          wardShatterIds: [wardId],
        });
        client?.send('chat', {
          from: 'System',
          message: `A ward shatters — ${adminName} breaks the working!`,
          channel: 'system',
          timestamp: Date.now(),
        });
      }

      return true;
    }

    for (const [sid, player] of this.state.players.entries()) {
      if (!player.aura.wards.some((w) => w.id === wardId)) continue;
      player.aura = {
        ...player.aura,
        wards: player.aura.wards.filter((w) => w.id !== wardId),
      };
      const client = this.clients.find((c) => c.sessionId === sid);
      if (client) {
        this.sendPlayerSync(client, player);
        client.send('shield_break', {
          type: 'shield_break',
          casterName: adminName,
          broken: [{
            kind: 'aura_ward',
            id: wardId,
            name: 'Personal Ward',
            damageApplied: 0,
            wasWard: true,
          }],
          totalDamage: 0,
          notify: true,
          wardShatterIds: [wardId],
        });
      }
      void deactivateWard(wardId);
      return true;
    }

    return false;
  }

  /** Reload player row from DB and push to connected client (admin grants, etc.) */
  async syncPlayerFromDb(dbPlayerId: string): Promise<boolean> {
    for (const [sessionId, player] of this.state.players.entries()) {
      if (player.dbPlayerId !== dbPlayerId) continue;
      const row = await prisma.player.findUnique({ where: { id: dbPlayerId }, select: { username: true } });
      if (!row) return false;

      const persisted = await loadOrCreatePlayer(row.username);
      player.stats = normalizePlayerStats(persisted.stats);
      player.inventory = persisted.inventory;
      player.aura = persisted.aura;
      player.coins = persisted.coins;
      player.altar = persisted.altar;

      const data = this.playerData.get(sessionId);
      if (data) {
        data.stats = normalizePlayerStats(persisted.stats);
        data.inventory = persisted.inventory;
        data.aura = persisted.aura;
        data.coins = persisted.coins;
      }

      const client = this.clients.find((c) => c.sessionId === sessionId);
      if (client) this.sendPlayerSync(client, player);
      return true;
    }
    return false;
  }
}
