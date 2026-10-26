import * as Colyseus from 'colyseus.js';

import { gameState, type NearbyPlayer } from '../data/game-state';
import { triggerScreenDistortion } from '../ui/screen-distortion';
import type { ContentMapDefinition, WardState, PlayerProgression } from '@witchcraft/shared';
import { migrateInventoryToGrid } from '@witchcraft/shared';
import { connectionMonitor } from './ConnectionMonitor';
import { apartmentInvitePanel } from '../ui/ApartmentInvitePanel';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'ws://localhost:2567';
const COLYSEUS_ROOM = 'game';
/** All clients must use the same shard so matchmaking lands in one room instance */
const WORLD_SHARD = 'hollow-creek';



export interface PlayerSyncPayload {

  statsJson: string;

  inventoryJson: string;

  auraJson: string;

  altarJson?: string;

  coins?: number;

}



/** Remote player snapshot from Colyseus room state */

export interface RemotePlayerState {

  sessionId: string;

  x: number;

  y: number;

  displayName: string;

  scene: string;

  /** Whose apartment instance this player occupies (host session id when at home). */
  apartmentHostSessionId?: string;

  direction?: string;

  inventoryJson?: string;

  statsJson?: string;

}



function safeJsonParse<T>(raw: unknown, fallback: T): T {

  if (typeof raw !== 'string' || !raw) return fallback;

  try {

    return JSON.parse(raw) as T;

  } catch {

    return fallback;

  }

}



/** Colyseus connection manager — singleton for all scenes */

class NetworkManager {

  client: Colyseus.Client;

  room: Colyseus.Room | null = null;

  onPlayersChange?: (players: Map<string, RemotePlayerState>) => void;

  onLocalPlayerUpdate?: () => void;

  private suppressDisconnect = false;

  private currentScene: 'apartment' | 'town' = 'apartment';

  private watchedPlayerIds = new Set<string>();

  private messagesBoundTo: Colyseus.Room | null = null;

  private stateBoundTo: Colyseus.Room | null = null;

  private lastNearbyKey = '';

  private presenceResyncTimer = 0;

  /** Authoritative positions from server presence broadcasts (same room instance) */
  private presence = new Map<string, RemotePlayerState>();

  /** Waiting for presence_sync / apartment_visit before showing remotes after refresh */
  private apartmentInstancePending = false;

  private isActivelyVisiting(): boolean {
    const hostSid = gameState.visitingHostSessionId;
    return !!hostSid && hostSid !== this.getLocalSessionId();
  }

  private hasPendingVisitRestore(): boolean {
    const hostDb = gameState.savedLocation?.visitingHostDbPlayerId;
    return (
      gameState.currentScene === 'apartment' &&
      !this.isActivelyVisiting() &&
      !!hostDb &&
      hostDb !== gameState.dbPlayerId
    );
  }

  private clearHomeVisitState(): void {
    gameState.visitingHostSessionId = null;
    gameState.visitingHostDbPlayerId = '';
    gameState.visitingHostName = '';
    if (gameState.savedLocation) {
      gameState.savedLocation = { ...gameState.savedLocation, visitingHostDbPlayerId: undefined };
    }
  }

  private resetToHomeApartment(wards?: WardState[]): void {
    this.clearHomeVisitState();
    gameState.localApartmentHostSessionId = this.getLocalSessionId();
    if (wards) gameState.apartmentWards = wards;
    this.applyLocalApartmentInstance(this.getLocalSessionId(), true);
    this.apartmentInstancePending = false;
  }

  private applyVisitApartment(data: {
    hostSessionId: string;
    hostDbPlayerId?: string;
    hostName: string;
    wards: WardState[];
  }): void {
    gameState.visitingHostSessionId = data.hostSessionId;
    if (data.hostDbPlayerId) {
      gameState.visitingHostDbPlayerId = data.hostDbPlayerId;
      if (gameState.savedLocation) {
        gameState.savedLocation = {
          ...gameState.savedLocation,
          visitingHostDbPlayerId: data.hostDbPlayerId,
        };
      }
    }
    gameState.visitingHostName = data.hostName;
    gameState.localApartmentHostSessionId = data.hostSessionId;
    gameState.apartmentWards = data.wards;
    this.applyLocalApartmentInstance(data.hostSessionId);
    this.apartmentInstancePending = false;
  }

  private applyYourApartmentHostSessionId(hostSessionId: string): void {
    const isHome = hostSessionId === this.getLocalSessionId();
    this.applyLocalApartmentInstance(hostSessionId, isHome);
    if (isHome) {
      this.clearHomeVisitState();
      gameState.localApartmentHostSessionId = hostSessionId;
    } else {
      gameState.localApartmentHostSessionId = hostSessionId;
      if (!gameState.visitingHostSessionId) {
        gameState.visitingHostSessionId = hostSessionId;
      }
    }
    this.apartmentInstancePending = false;
  }

  private getRemoteScene(sessionId: string, fallback: string): string {
    const live = this.room?.state.players.get(sessionId)?.scene;
    if (live === 'apartment' || live === 'town') return live;
    return fallback;
  }

  private applyLocalApartmentInstance(hostSessionId?: string, forceHome = false): void {
    if (!hostSessionId) {
      gameState.localApartmentHostSessionId = '';
      return;
    }
    gameState.localApartmentHostSessionId = hostSessionId;
    const isHome = hostSessionId === this.getLocalSessionId();
    const pendingVisit = this.hasPendingVisitRestore();
    if (isHome && (forceHome || !pendingVisit)) {
      this.clearHomeVisitState();
    }
  }



  constructor() {

    this.client = new Colyseus.Client(SERVER_URL);

    connectionMonitor.configure({

      healthCheck: () => this.isRoomConnected(),

      onReconnect: () => this.attemptReconnect(),

      onKicked: () => this.handleConnectionKick(),

    });

  }



  private joinOptions() {
    return {
      shard: WORLD_SHARD,
      username: gameState.username,
      displayName: gameState.displayName,
      authToken: gameState.authToken,
    };
  }

  /** Join the single shared world room for this shard */
  private async connectToWorldRoom(): Promise<Colyseus.Room> {
    return this.client.joinOrCreate(COLYSEUS_ROOM, this.joinOptions());
  }



  async joinRoom(scene: 'apartment' | 'town'): Promise<Colyseus.Room> {

    this.suppressDisconnect = true;

    connectionMonitor.pause();

    const prevOnPlayersChange = this.onPlayersChange;

    const needJoin = !this.room || !this.isRoomConnected();



    if (needJoin) {

      if (this.room) {

        this.onPlayersChange = undefined;

        this.watchedPlayerIds.clear();

        this.messagesBoundTo = null;

        this.stateBoundTo = null;

        this.lastNearbyKey = '';

        this.presence.clear();

        await this.room.leave(true);

        this.room = null;

      }



      this.room = await this.connectToWorldRoom();



      this.bindRoomMessages();

      this.bindStateListeners();

      this.bindConnectionHandlers();

      connectionMonitor.notifyConnected();

      connectionMonitor.resume();

      connectionMonitor.start();

    }



    this.currentScene = scene;

    this.onPlayersChange = prevOnPlayersChange;

    this.syncLocalPlayer();

    this.emitPlayers();

    this.suppressDisconnect = false;

    return this.room!;

  }



  private bindConnectionHandlers(): void {

    if (!this.room) return;

    this.room.onLeave(() => {

      if (this.suppressDisconnect) return;

      connectionMonitor.notifyDisconnected();

    });

    this.room.onError(() => {

      if (this.suppressDisconnect) return;

      connectionMonitor.notifyDisconnected();

    });

  }



  isRoomConnected(): boolean {

    if (!this.room) return false;

    const conn = (this.room as unknown as { connection?: WebSocket }).connection;

    if (conn && typeof conn.readyState === 'number') {

      return conn.readyState === WebSocket.OPEN;

    }

    return true;

  }



  async attemptReconnect(): Promise<boolean> {

    this.suppressDisconnect = true;

    try {

      if (this.room) {

        try {

          await this.room.leave(true);

        } catch {

          /* already closed */

        }

        this.room = null;

      }

      this.presence.clear();
      this.room = await this.connectToWorldRoom();



      this.bindRoomMessages();

      this.bindStateListeners();

      this.bindConnectionHandlers();

      this.syncLocalPlayer();

      this.emitPlayers();

      window.dispatchEvent(new CustomEvent('game:connection-restored'));

      return true;

    } catch {

      return false;

    } finally {

      this.suppressDisconnect = false;

    }

  }



  private handleConnectionKick(): void {

    this.suppressDisconnect = true;

    connectionMonitor.stop();

    if (this.room) {

      void this.room.leave(true);

      this.room = null;

    }

    this.messagesBoundTo = null;

    this.stateBoundTo = null;

    this.onPlayersChange = undefined;

    connectionMonitor.showKickScreen();

  }



  private bindStateListeners(): void {

    if (!this.room || this.stateBoundTo === this.room) return;

    this.stateBoundTo = this.room;

    this.watchedPlayerIds.clear();



    this.room.onStateChange(() => {

      this.syncLocalPlayer();

      this.emitPlayers();

    });



    this.room.state.players.forEach((player: PlayerSchemaLike, sessionId: string) => {

      this.watchPlayer(player, sessionId);

    });



    this.room.state.players.onAdd((player: PlayerSchemaLike, sessionId: string) => {

      this.watchPlayer(player, sessionId);

      this.emitPlayers();

    });



    this.room.state.players.onRemove((_player: unknown, sessionId: string) => {

      this.watchedPlayerIds.delete(sessionId);

      this.emitPlayers();

    });

  }



  private watchPlayer(player: PlayerSchemaLike, sessionId: string): void {

    if (this.watchedPlayerIds.has(sessionId)) return;

    this.watchedPlayerIds.add(sessionId);

    const emit = (): void => {

      if (sessionId === this.room?.sessionId) {

        this.syncLocalPlayer();

      }

      this.emitPlayers();

    };

    if (player.onChange) player.onChange(emit);

    if (player.listen) {

      player.listen('x', emit);

      player.listen('y', emit);

      player.listen('scene', emit);

    }

  }



  private bindRoomMessages(): void {

    if (!this.room || this.messagesBoundTo === this.room) return;

    this.messagesBoundTo = this.room;



    this.room.onMessage('open_ui', (data: Record<string, unknown>) => {

      window.dispatchEvent(new CustomEvent('game:open-ui', { detail: data }));

    });

    this.room.onMessage('hexagram_result', (data: Record<string, unknown>) => {
      window.dispatchEvent(new CustomEvent('game:hexagram-result', { detail: data }));
    });

    this.room.onMessage('pocket_spell_result', (data: Record<string, unknown>) => {
      window.dispatchEvent(new CustomEvent('game:pocket-spell-result', { detail: data }));
    });



    this.room.onMessage('scene_change', (data: { scene: string; spawnId: string }) => {

      gameState.pendingSpawnId = data.spawnId ?? 'default';

      if (data.scene === 'town') {
        gameState.visitingHostSessionId = null;
        gameState.visitingHostDbPlayerId = '';
        gameState.visitingHostName = '';
        gameState.localApartmentHostSessionId = '';
      }

      if (data.scene === gameState.currentScene) {
        window.dispatchEvent(
          new CustomEvent('game:same-scene-teleport', {
            detail: { scene: data.scene, spawnId: data.spawnId },
          })
        );
        this.refreshApartmentPresence();
        return;
      }

      window.dispatchEvent(

        new CustomEvent('game:scene-change', {

          detail: { scene: data.scene, spawnId: data.spawnId },

        })

      );

      this.requestPresenceSync();

    });



    this.room.onMessage('presence_sync', (data: {

      players: {
        sessionId: string;
        displayName: string;
        x: number;
        y: number;
        scene: string;
        apartmentHostSessionId?: string;
      }[];

      yourApartmentHostSessionId?: string;

    }) => {

      this.presence.clear();

      for (const p of data.players) {
        this.presence.set(p.sessionId, {
          sessionId: p.sessionId,
          displayName: p.displayName,
          x: p.x,
          y: p.y,
          scene: p.scene,
          apartmentHostSessionId: p.apartmentHostSessionId,
        });
      }

      if (data.yourApartmentHostSessionId) {
        this.applyYourApartmentHostSessionId(data.yourApartmentHostSessionId);
      } else if (gameState.currentScene === 'town') {
        this.applyLocalApartmentInstance('');
        this.apartmentInstancePending = false;
      }

      this.emitPlayers();

    });



    this.room.onMessage('presence', (data: {

      kind: 'join' | 'leave' | 'move' | 'scene';

      sessionId: string;

      displayName?: string;

      x?: number;

      y?: number;

      scene?: string;

      apartmentHostSessionId?: string;

    }) => {

      if (data.kind === 'leave') {

        this.presence.delete(data.sessionId);

      } else {

        const prev = this.presence.get(data.sessionId);

        const snapshot: RemotePlayerState = {
          sessionId: data.sessionId,
          displayName: String(data.displayName ?? prev?.displayName ?? 'Witch'),
          x: Number(data.x ?? prev?.x ?? 0),
          y: Number(data.y ?? prev?.y ?? 0),
          scene: String(data.scene ?? prev?.scene ?? ''),
          apartmentHostSessionId: data.apartmentHostSessionId ?? prev?.apartmentHostSessionId,
        };

        if (
          gameState.currentScene === 'apartment' &&
          this.isActivelyVisiting() &&
          data.apartmentHostSessionId &&
          data.sessionId === data.apartmentHostSessionId &&
          data.apartmentHostSessionId !== gameState.localApartmentHostSessionId
        ) {
          this.applyYourApartmentHostSessionId(data.apartmentHostSessionId);
        }

        if (!this.isSameWorldSpace(snapshot)) {
          if (this.presence.delete(data.sessionId)) this.emitPlayers();
          return;
        }

        this.presence.set(data.sessionId, snapshot);

      }

      this.emitPlayers();

    });



    this.room.onMessage('player_loaded', (data: {

      isAdmin?: boolean;

      adminCommands?: string[];

      familiar?: unknown;

      metPlayers?: unknown[];

      dbPlayerId?: string;

      wards?: WardState[];

      location?: import('@witchcraft/shared').PlayerLocation;

      friends?: import('@witchcraft/shared').FriendEntry[];

      friendRequests?: import('@witchcraft/shared').FriendRequest[];

      friendPresence?: import('@witchcraft/shared').FriendPresence[];

    }) => {

      gameState.isAdmin = !!data.isAdmin;

      if (data.dbPlayerId) gameState.dbPlayerId = data.dbPlayerId;

      if (data.wards) gameState.apartmentWards = data.wards;

      if (data.location) {
        gameState.savedLocation = data.location;
        const hostDb = data.location.visitingHostDbPlayerId;
        gameState.visitingHostDbPlayerId =
          hostDb && hostDb !== gameState.dbPlayerId ? hostDb : '';
        if (!hostDb || hostDb === gameState.dbPlayerId) {
          this.clearHomeVisitState();
        }
      }

      if (data.friends) gameState.friends = data.friends;

      if (data.friendRequests) gameState.friendRequests = data.friendRequests;

      if (data.friendPresence) gameState.friendPresence = data.friendPresence;

      if (data.familiar) gameState.familiar = data.familiar as typeof gameState.familiar;

      if (data.metPlayers) gameState.metPlayers = data.metPlayers as typeof gameState.metPlayers;

      if ((data as { progression?: PlayerProgression }).progression) {
        gameState.progression = (data as { progression: PlayerProgression }).progression;
      }

      window.dispatchEvent(new CustomEvent('game:player-loaded', { detail: data }));

    });

    this.room.onMessage('progression_update', (data: { progression: PlayerProgression }) => {
      gameState.progression = data.progression;
      window.dispatchEvent(new CustomEvent('game:progression-update', { detail: data }));
    });

    this.room.onMessage('world_state', (data: { hour: number; hiddenNpcIds?: string[] }) => {
      gameState.worldHour = data.hour;
      gameState.hiddenNpcIds = data.hiddenNpcIds ?? [];
      window.dispatchEvent(new CustomEvent('game:world-state', { detail: data }));
    });

    // TEMPORARY: tradition specialty offers deactivated until tradition packs ship.
    // this.room.onMessage('specialty_offer', (data: { traditions: string[] }) => {
    //   window.dispatchEvent(new CustomEvent('game:specialty-offer', { detail: data }));
    // });

    this.room.onMessage('book_open', (data: { bookId: string; pages: string[]; title?: string }) => {
      window.dispatchEvent(new CustomEvent('game:book-open', { detail: data }));
    });



    this.room.onMessage('player_sync', (data: PlayerSyncPayload) => {

      this.applyPlayerSync(data);

    });



    this.room.onMessage('spell_result', (data: { message: string; success: boolean }) => {

      gameState.lastSpellResult = data.message;

      window.dispatchEvent(new CustomEvent('game:spell-result', { detail: data }));

    });



    this.room.onMessage('shop_result', () => {

      /* player_sync follows from server */

    });



    this.room.onMessage('familiar_update', (data: { familiar: unknown }) => {

      gameState.familiar = data.familiar as typeof gameState.familiar;

      window.dispatchEvent(new CustomEvent('game:familiar-update', { detail: data }));

    });



    this.room.onMessage('aura_inspection', (data: unknown) => {

      window.dispatchEvent(new CustomEvent('game:aura-inspection', { detail: data }));

    });



    this.room.onMessage('dialogue_update', (data: unknown) => {

      window.dispatchEvent(new CustomEvent('game:dialogue-update', { detail: data }));

    });



    this.room.onMessage('friends_update', (data: {

      friends: import('@witchcraft/shared').FriendEntry[];

      friendRequests: import('@witchcraft/shared').FriendRequest[];

      friendPresence: import('@witchcraft/shared').FriendPresence[];

    }) => {

      gameState.friends = data.friends;

      gameState.friendRequests = data.friendRequests;

      gameState.friendPresence = data.friendPresence;

      window.dispatchEvent(new CustomEvent('game:friends-update', { detail: data }));

    });



    this.room.onMessage('apartment_invite_received', (data: { inviteId: string; hostName: string }) => {

      gameState.pendingApartmentInvite = { inviteId: data.inviteId, hostName: data.hostName };

      window.dispatchEvent(new CustomEvent('game:apartment-invite', { detail: data }));

    });



    this.room.onMessage('apartment_invite_result', (data: { success: boolean; message: string }) => {

      gameState.pendingApartmentInvite = null;

      apartmentInvitePanel.hide();

      window.dispatchEvent(new CustomEvent('game:notification', { detail: { message: data.message } }));

    });



    this.room.onMessage('apartment_wards', (data: { wards: WardState[] }) => {

      gameState.apartmentWards = data.wards;

      window.dispatchEvent(new CustomEvent('game:apartment-wards', { detail: data }));

    });



    this.room.onMessage('apartment_visit', (data: {
      hostSessionId: string;
      hostDbPlayerId?: string;
      hostName: string;
      wards: WardState[];
    }) => {

      this.applyVisitApartment(data);

      window.dispatchEvent(new CustomEvent('game:apartment-visit', { detail: data }));

      window.dispatchEvent(new CustomEvent('game:apartment-wards', { detail: { wards: data.wards } }));

      this.refreshApartmentPresence();

    });



    this.room.onMessage('apartment_home', (data: {
      wards: WardState[];
    }) => {

      this.resetToHomeApartment(data.wards);

      window.dispatchEvent(new CustomEvent('game:apartment-left', { detail: data }));

      window.dispatchEvent(new CustomEvent('game:apartment-wards', { detail: { wards: data.wards } }));

      this.refreshApartmentPresence();

    });



    this.room.onMessage('apartment_left', (data: {
      wards: WardState[];
    }) => {

      this.resetToHomeApartment(data.wards);

      window.dispatchEvent(new CustomEvent('game:apartment-left', { detail: data }));

      window.dispatchEvent(new CustomEvent('game:apartment-wards', { detail: { wards: data.wards } }));

      this.refreshApartmentPresence();

    });



    this.room.onMessage('trade_invite', (data: { tradeId: string; fromName: string; fromSessionId: string }) => {

      window.dispatchEvent(new CustomEvent('game:trade-invite', { detail: data }));

    });



    this.room.onMessage('trade_state', (data: unknown) => {

      window.dispatchEvent(new CustomEvent('game:trade-state', { detail: data }));

    });



    this.room.onMessage('trade_complete', (data: { message: string }) => {

      window.dispatchEvent(new CustomEvent('game:trade-complete', { detail: data }));

      window.dispatchEvent(new CustomEvent('game:notification', { detail: { message: data.message } }));

    });



    this.room.onMessage('trade_cancelled', (data: { message: string }) => {

      window.dispatchEvent(new CustomEvent('game:trade-cancelled', { detail: data }));

      window.dispatchEvent(new CustomEvent('game:notification', { detail: { message: data.message } }));

    });



    this.room.onMessage('ward_placed', () => {

      window.dispatchEvent(new CustomEvent('game:ward-placed'));

    });



    this.room.onMessage('shield_break', (data: {

      notify?: boolean;

      wardShatterIds?: string[];

      broken?: { wasWard: boolean; name: string }[];

    }) => {

      if (data.notify) triggerScreenDistortion();

      if (data.wardShatterIds?.length) {

        window.dispatchEvent(

          new CustomEvent('game:ward-shatter', { detail: { wardIds: data.wardShatterIds } })

        );

      }

      window.dispatchEvent(new CustomEvent('game:shield-break', { detail: data }));

    });



    this.room.onMessage('chat', (data: { from: string; message: string; channel?: string }) => {

      window.dispatchEvent(new CustomEvent('game:chat', { detail: data }));

    });



    this.room.onMessage('notification', (data: { message: string }) => {

      gameState.lastSpellResult = data.message;

      window.dispatchEvent(new CustomEvent('game:notification', { detail: data }));

    });

    this.room.onMessage('content_maps_update', (data: { maps: ContentMapDefinition[]; revision: number }) => {
      gameState.applyLiveMaps(data.maps);
      window.dispatchEvent(
        new CustomEvent('game:maps-updated', { detail: { revision: data.revision } })
      );
      window.dispatchEvent(
        new CustomEvent('game:notification', {
          detail: { message: 'World map updated — layout refreshed.' },
        })
      );
    });



    this.room.onMessage('admin_inventory', (data: { inventory?: unknown[] }) => {

      if (data.inventory) {

        this.applyPlayerSync({

          statsJson: gameState.localPlayer?.statsJson ?? '{}',

          inventoryJson: JSON.stringify(data.inventory),

          auraJson: gameState.localPlayer?.auraJson ?? '{}',

          coins: gameState.localPlayer?.coins,

        });

      }

    });

  }



  applyPlayerSync(data: PlayerSyncPayload): void {

    if (!this.room) return;

    const me = this.room.state.players.get(this.room.sessionId);

    gameState.localPlayer = {

      sessionId: this.room.sessionId,

      displayName: me?.displayName ?? gameState.displayName,

      inventory: migrateInventoryToGrid(safeJsonParse(data.inventoryJson, [])),

      coins: data.coins ?? gameState.localPlayer?.coins ?? 0,

      statsJson: data.statsJson,

      altarJson: data.altarJson ?? gameState.localPlayer?.altarJson ?? '{}',

      auraJson: data.auraJson,

      familiarId: gameState.localPlayer?.familiarId ?? me?.familiarId ?? '',

    };

    gameState.nearbyPlayers = this.getOtherPlayers();

    this.onLocalPlayerUpdate?.();

    window.dispatchEvent(new CustomEvent('game:player-sync', { detail: data }));

  }



  /** Re-sync sprites after visit/home/teleport without requiring a refresh */
  refreshApartmentPresence(): void {
    this.apartmentInstancePending = false;
    this.emitPlayers();
    this.requestPresenceSync();
  }

  send(type: string, data: Record<string, unknown> = {}): void {

    this.room?.send(type, data);

  }



  /** Ask server to re-send full presence (after handlers + world are ready) */
  requestPresenceSync(): void {
    if (!this.room) return;
    this.send('presence_ready', {});
  }

  /** Pull latest friends list and online status from server */
  refreshFriends(): void {
    if (!this.room) return;
    this.send('friends_refresh', {});
  }

  /** Periodic full resync + keep nearby lists fresh without manual refresh */
  tickWorldSync(delta: number): void {
    if (!this.room) return;
    this.presenceResyncTimer += delta;
    if (this.presenceResyncTimer >= 1000) {
      this.presenceResyncTimer = 0;
      this.requestPresenceSync();
    }
    this.reconcilePresenceFromState();
  }

  /** Whose apartment instance the local player is in */
  getLocalApartmentInstanceId(): string {
    if (gameState.currentScene !== 'apartment') return '';
    return (
      gameState.localApartmentHostSessionId ||
      gameState.visitingHostSessionId ||
      this.getLocalSessionId()
    );
  }

  /** Same shared space as local player (town or same apartment instance) */
  isSameWorldSpace(player: RemotePlayerState): boolean {
    if (gameState.currentScene === 'town') {
      return this.getRemoteScene(player.sessionId, player.scene) === 'town';
    }
    if (gameState.currentScene !== 'apartment') return false;

    const remoteScene = this.getRemoteScene(player.sessionId, player.scene);
    if (remoteScene !== 'apartment') return false;

    const myInstance = this.getLocalApartmentInstanceId();
    const theirInstance = player.apartmentHostSessionId ?? player.sessionId;
    return !!myInstance && myInstance === theirInstance;
  }

  private reconcilePresenceFromState(): void {
    if (!this.room?.state?.players) return;
    const myId = this.room.sessionId;
    let changed = false;

    this.room.state.players.forEach((player: PlayerSchemaLike, sessionId: string) => {
      if (sessionId === myId) return;
      const existing = this.presence.get(sessionId);
      if (!existing) return;

      const x = Number(player.x ?? 0);
      const y = Number(player.y ?? 0);
      const scene = String(player.scene ?? '');

      if (existing.x === x && existing.y === y && existing.scene === scene) {
        return;
      }

      const updated = { ...existing, x, y, scene };
      if (!this.isSameWorldSpace(updated)) {
        this.presence.delete(sessionId);
      } else {
        this.presence.set(sessionId, updated);
      }
      changed = true;
    });

    if (changed) this.emitPlayers();
  }

  /** Tell the server which world scene we are in after joining the Colyseus room */
  syncWorldScene(scene: 'apartment' | 'town', spawnId: string, x: number, y: number): void {

    this.currentScene = scene;

    gameState.currentScene = scene;

    const pendingVisit = scene === 'apartment' && this.hasPendingVisitRestore();
    const activelyVisiting = scene === 'apartment' && this.isActivelyVisiting();

    gameState.savedLocation = {
      scene,
      x,
      y,
      spawnId,
      visitingHostDbPlayerId:
        pendingVisit || activelyVisiting
          ? gameState.visitingHostDbPlayerId || gameState.savedLocation?.visitingHostDbPlayerId
          : undefined,
    };

    if (scene === 'town') {
      this.clearHomeVisitState();
      gameState.localApartmentHostSessionId = '';
      this.apartmentInstancePending = false;
    } else if (scene === 'apartment') {
      if (activelyVisiting) {
        this.applyLocalApartmentInstance(gameState.visitingHostSessionId!);
        this.apartmentInstancePending = false;
      } else if (pendingVisit) {
        this.apartmentInstancePending = true;
      } else {
        this.resetToHomeApartment();
      }
    }

    const me = this.room?.state.players.get(this.room.sessionId);

    if (!me || me.scene !== scene) {

      this.send('change_scene', { scene, spawnId });

    }

    this.send('move', { x, y, direction: 'down' });

    if (!this.apartmentInstancePending) {
      this.emitPlayers();
    }

    this.requestPresenceSync();

  }



  /** Scene value from Colyseus state (server authority) */
  getLocalServerScene(): 'apartment' | 'town' {

    if (!this.room) return gameState.currentScene;

    const me = this.room.state.players.get(this.room.sessionId);

    const s = me?.scene;

    if (s === 'apartment' || s === 'town') return s;

    return gameState.currentScene;

  }



  getOtherPlayers(): NearbyPlayer[] {

    if (!this.room) return [];

    const myId = this.room.sessionId;

    const list: NearbyPlayer[] = [];

    this.forEachSyncedPlayer((sessionId, p) => {

      if (sessionId === myId) return;

      if (!this.isSameWorldSpace(p)) return;

      list.push({ sessionId, displayName: p.displayName });

    });

    return list;

  }



  /** Refresh altar/target lists from live Colyseus state */
  refreshNearbyPlayers(): void {

    if (!this.room) return;

    this.setNearbyPlayers(this.getOtherPlayers());

  }



  private setNearbyPlayers(list: NearbyPlayer[]): void {

    const key = list.map((p) => p.sessionId).sort().join('|');

    gameState.nearbyPlayers = list;

    if (key === this.lastNearbyKey) return;

    this.lastNearbyKey = key;

    window.dispatchEvent(new CustomEvent('game:nearby-players'));

  }



  /** Iterate remote players — presence map is server-filtered on full sync */
  forEachSyncedPlayer(fn: (sessionId: string, player: RemotePlayerState) => void): void {

    if (!this.room) return;

    for (const [sessionId, p] of this.presence) {
      fn(sessionId, p);
    }

  }



  getPresenceCount(): number {

    return this.presence.size;

  }



  refreshRemotePlayers(): void {

    this.refreshNearbyPlayers();

    this.emitPlayers();

  }



  private syncLocalPlayer(): void {

    if (!this.room) return;

    const me = this.room.state.players.get(this.room.sessionId);

    if (!me) return;



    const inventoryJson = typeof me.inventoryJson === 'string' ? me.inventoryJson : '[]';

    const statsJson = typeof me.statsJson === 'string' ? me.statsJson : '{}';

    const auraJson = typeof me.auraJson === 'string' ? me.auraJson : '{}';

    const altarJson = typeof me.altarJson === 'string' ? me.altarJson : '{}';



    gameState.localPlayer = {

      sessionId: me.sessionId,

      displayName: me.displayName,

      inventory: migrateInventoryToGrid(safeJsonParse(inventoryJson, [])),

      coins: me.coins ?? 0,

      statsJson,

      altarJson,

      auraJson,

      familiarId: me.familiarId ?? '',

    };

    gameState.nearbyPlayers = this.getOtherPlayers();

    this.onLocalPlayerUpdate?.();

  }



  private emitPlayers(): void {

    if (!this.room) return;

    this.setNearbyPlayers(this.getOtherPlayers());

    if (this.onPlayersChange) {

      this.onPlayersChange(null as unknown as Map<string, RemotePlayerState>);

    }

  }



  getLocalSessionId(): string {

    return this.room?.sessionId ?? '';

  }

}



export const network = new NetworkManager();

interface PlayerSchemaLike {
  x?: number;
  y?: number;
  scene?: string;
  displayName?: string;
  onChange?: (cb: () => void) => void;
  listen?: (prop: string, cb: () => void) => void;
}


