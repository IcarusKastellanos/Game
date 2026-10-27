import Phaser from 'phaser';
import { TILE_SIZE, distanceToInteractableFootprintPx, interactRangeFromEdgePx } from '@witchcraft/shared';
import type { ContentMapDefinition } from '@witchcraft/shared';
import { gameState } from '../data/game-state';
import { network } from '../net/NetworkManager';
import { buildMapFromDefinition } from '../systems/MapBuilder';
import { PlayerController } from '../systems/PlayerController';
import { applyWorldDepthSort } from '../systems/WorldDepthSort';
import { configureFeetHitbox, configurePlayerPhysics } from '../systems/WorldMovement';
import { worldTilesToPixels } from '../utils/world-coords';
import { ambientAudio } from '../audio/AmbientAudio';
import { TeleportEffect } from '../graphics/TeleportEffect';
import '../ui/speech-bubble.css';

type WorldSpeechBubble = {
  root: HTMLDivElement;
  plate: HTMLDivElement;
  tail: HTMLDivElement;
  tailStroke: HTMLDivElement;
  tailFill: HTMLDivElement;
  until: number;
  metricsKey: string;
  outerHalf: number;
  innerHalf: number;
};

/** Base scene for apartment and town — shared movement/multiplayer logic */
export abstract class BaseWorldScene extends Phaser.Scene {
  protected player!: Phaser.Physics.Arcade.Sprite;
  protected controller!: PlayerController;
  protected remotePlayers = new Map<string, Phaser.GameObjects.Sprite>();
  protected remoteNameLabels = new Map<string, Phaser.GameObjects.Text>();
  private speechLayer?: HTMLDivElement;
  private speechBubbles = new Map<string, WorldSpeechBubble>();
  protected interactables!: Phaser.GameObjects.Group;
  protected furnitureLayer!: Phaser.GameObjects.Group;
  protected floorLayer!: Phaser.GameObjects.Group;
  protected wallLayer!: Phaser.Physics.Arcade.StaticGroup;
  protected collisionLayer!: Phaser.Physics.Arcade.StaticGroup;
  protected blockers: Phaser.Physics.Arcade.StaticGroup[] = [];
  private colliders: Phaser.Physics.Arcade.Collider[] = [];
  protected sceneId: 'apartment' | 'town' = 'apartment';
  private setupGeneration = 0;
  private activeTeleport?: TeleportEffect;

  /** (Re)register physics colliders between the player and current blocker groups. */
  private registerBlockerColliders(): void {
    this.colliders.forEach((c) => c.destroy());
    this.colliders = [];
    if (!this.player) return;
    for (const group of this.blockers) {
      this.colliders.push(this.physics.add.collider(this.player, group));
    }
  }

  /** True when this scene instance was superseded by another world load */
  private isSetupStale(setupId: number): boolean {
    return setupId !== this.setupGeneration || !this.sys.isActive() || gameState.currentScene !== this.sceneId;
  }

  protected async setupWorld(): Promise<void> {
    const setupId = ++this.setupGeneration;
    gameState.isTransitioning = true;
    gameState.currentScene = this.sceneId;

    try {
      await network.joinRoom(this.sceneId);
      if (this.isSetupStale(setupId)) return;

      const mapDef = gameState.getMap(this.sceneId);
      if (!mapDef) {
        console.error('No map definition for', this.sceneId);
        return;
      }

      const spawnId = gameState.pendingSpawnId || 'default';
      const spawn =
        mapDef.spawnPoints.find((s) => s.id === spawnId) ??
        mapDef.spawnPoints.find((s) => s.id === 'default') ??
        { x: 8, y: 10 };

      const loc = gameState.savedLocation;
      const me = network.room?.state.players.get(network.getLocalSessionId());
      let startX = spawn.x;
      let startY = spawn.y;
      if (me?.scene === this.sceneId && Number.isFinite(me.x) && Number.isFinite(me.y)) {
        startX = me.x;
        startY = me.y;
      } else if (loc?.scene === this.sceneId) {
        startX = loc.x;
        startY = loc.y;
      }
      const syncSpawnId = loc?.scene === this.sceneId ? (loc.spawnId ?? spawnId) : spawnId;
      const { x: startPx, y: startPy } = worldTilesToPixels(startX, startY);

      const { floorLayer, wallLayer, collisionLayer, furnitureLayer, interactables } =
        buildMapFromDefinition(this, mapDef);
      this.floorLayer = floorLayer;
      this.wallLayer = wallLayer;
      this.collisionLayer = collisionLayer;
      this.furnitureLayer = furnitureLayer;
      this.interactables = interactables;
      this.blockers = [this.wallLayer, this.collisionLayer];

      this.player = this.physics.add.sprite(startPx, startPy, 'player_walk', 0);
      this.player.setCollideWorldBounds(true);
      this.player.setOrigin(0.5, 0.85);
      configureFeetHitbox(this.player);
      configurePlayerPhysics(this.player);
      this.registerBlockerColliders();
      applyWorldDepthSort(this.player, this.furnitureLayer, this.remotePlayers, this.remoteNameLabels);

      // Arriving via teleport: keep the body hidden until the reform spell plays.
      if (gameState.teleportArrivalPending) this.player.setAlpha(0);

      this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
      this.cameras.main.setBounds(0, 0, mapDef.width * TILE_SIZE, mapDef.height * TILE_SIZE);
      this.physics.world.setBounds(0, 0, mapDef.width * TILE_SIZE, mapDef.height * TILE_SIZE);

      this.controller = new PlayerController(this);
      this.controller.resetPosition(this.player.x, this.player.y);

      this.events.on('shutdown', () => {
        window.removeEventListener('game:admin-tp', this.onAdminTp as EventListener);
        window.removeEventListener('game:admin-heal', this.onAdminHeal as EventListener);
        window.removeEventListener('game:connection-restored', this.onConnectionRestored as EventListener);
        window.removeEventListener('game:apartment-visit', this.onApartmentPresence as EventListener);
        window.removeEventListener('game:apartment-left', this.onApartmentPresence as EventListener);
        window.removeEventListener('game:nearby-players', this.onApartmentPresence as EventListener);
        window.removeEventListener('game:same-scene-teleport', this.onSameSceneTeleport as EventListener);
        window.removeEventListener('game:maps-updated', this.onMapsUpdated as EventListener);
        window.removeEventListener('game:chat', this.onLocalSpeech as EventListener);
        this.events.off('render', this.onSpeechRender);
        this.clearSpeechBubbles();
      });
      this.events.on('render', this.onSpeechRender);
      window.addEventListener('game:admin-tp', this.onAdminTp as EventListener);
      window.addEventListener('game:admin-heal', this.onAdminHeal as EventListener);
      window.addEventListener('game:connection-restored', this.onConnectionRestored as EventListener);
      window.addEventListener('game:apartment-visit', this.onApartmentPresence as EventListener);
      window.addEventListener('game:apartment-left', this.onApartmentPresence as EventListener);
      window.addEventListener('game:nearby-players', this.onApartmentPresence as EventListener);
      window.addEventListener('game:same-scene-teleport', this.onSameSceneTeleport as EventListener);
      window.addEventListener('game:maps-updated', this.onMapsUpdated as EventListener);
      window.addEventListener('game:chat', this.onLocalSpeech as EventListener);

      // Register sync handler only after player sprite exists
      network.onPlayersChange = () => this.syncRemotePlayers();
      this.syncRemotePlayers();

      if (this.isSetupStale(setupId)) return;

      network.syncWorldScene(this.sceneId, syncSpawnId, startX, startY);
      network.requestPresenceSync();

      window.dispatchEvent(new CustomEvent('game:world-ready', { detail: { sceneId: this.sceneId } }));
      if (gameState.activeUI !== 'shop') {
        ambientAudio.setScene(this.sceneId);
      }

      // Play the arrival half of the teleport spell (reform → reveal) before
      // control is handed back to the player.
      if (gameState.teleportArrivalPending && !this.isSetupStale(setupId) && this.player?.active) {
        gameState.teleportArrivalPending = false;
        this.activeTeleport = new TeleportEffect(this, this.player);
        try {
          await this.activeTeleport.playArrival();
        } finally {
          this.activeTeleport?.destroy(true);
          this.activeTeleport = undefined;
        }
      } else {
        // Not a teleport (boot / reconnect / same-scene): ensure the body is visible.
        gameState.teleportArrivalPending = false;
        this.player?.setAlpha(1);
      }
    } finally {
      if (gameState.currentScene === this.sceneId) {
        gameState.isTransitioning = false;
        gameState.isTeleporting = false;
        gameState.pendingSpawnId = 'default';
      }
    }
  }

  /**
   * Play the departure half of the teleport spell (envelop → dissolve →
   * disappear) on the current scene, then leave the player invisible so the
   * destination scene can play the arrival half. Called before a cross-scene
   * transition; safe to call when no player exists yet.
   */
  async playTeleportDeparture(): Promise<void> {
    if (!this.player?.active) return;
    gameState.isTransitioning = true;
    gameState.isTeleporting = true;
    this.activeTeleport = new TeleportEffect(this, this.player);
    try {
      await this.activeTeleport.playDeparture();
      gameState.teleportArrivalPending = true;
    } catch {
      // On failure, never strand the player invisible/locked.
      this.activeTeleport?.restorePlayer();
      gameState.teleportArrivalPending = false;
    } finally {
      // Keep the body hidden (restore=false) — the destination reforms it.
      this.activeTeleport?.destroy(gameState.teleportArrivalPending ? false : true);
      this.activeTeleport = undefined;
    }
  }

  update(_time: number, delta: number): void {
    if (!this.player?.active || !this.controller || gameState.isTransitioning) return;
    this.controller.update(this.player, this.blockers, () => this.tryInteract());
    applyWorldDepthSort(this.player, this.furnitureLayer, this.remotePlayers, this.remoteNameLabels);
    network.tickWorldSync(delta);
    this.syncRemotePlayers();
    this.tickSpeechBubbles();
  }

  shutdown(): void {
    this.setupGeneration += 1;
    this.activeTeleport?.destroy(false);
    this.activeTeleport = undefined;
    gameState.isTransitioning = false;
    window.removeEventListener('game:admin-tp', this.onAdminTp as EventListener);
    window.removeEventListener('game:admin-heal', this.onAdminHeal as EventListener);
    window.removeEventListener('game:connection-restored', this.onConnectionRestored as EventListener);
    window.removeEventListener('game:apartment-visit', this.onApartmentPresence as EventListener);
    window.removeEventListener('game:apartment-left', this.onApartmentPresence as EventListener);
    window.removeEventListener('game:nearby-players', this.onApartmentPresence as EventListener);
    window.removeEventListener('game:same-scene-teleport', this.onSameSceneTeleport as EventListener);
    window.removeEventListener('game:maps-updated', this.onMapsUpdated as EventListener);
    window.removeEventListener('game:chat', this.onLocalSpeech as EventListener);
    this.events.off('render', this.onSpeechRender);
    this.clearSpeechBubbles();
    network.onPlayersChange = undefined;
    this.remotePlayers.forEach((s) => s.destroy());
    this.remotePlayers.clear();
    this.remoteNameLabels.forEach((t) => t.destroy());
    this.remoteNameLabels.clear();
  }

  private tryInteract(): void {
    if (gameState.isTransitioning) return;

    type Inter = ContentMapDefinition['interactables'][number];
    let closest: Phaser.GameObjects.Sprite | null = null;
    const maxReach = interactRangeFromEdgePx();
    let closestDist = maxReach + 1;

    this.interactables.getChildren().forEach((obj) => {
      const sprite = obj as Phaser.GameObjects.Sprite;
      const inter = sprite.getData('interactable') as Inter | undefined;
      if (!inter?.id) return;

      const dist = distanceToInteractableFootprintPx(this.player.x, this.player.y, inter);
      if (dist > maxReach) return;

      if (dist < closestDist) {
        closestDist = dist;
        closest = sprite;
      }
    });

    if (!closest) return;

    const sprite = closest as Phaser.GameObjects.Sprite;
    const inter = sprite.getData('interactable');
    if (!inter?.id) return;

    network.send('interact', { targetId: inter.id });
  }

  protected applyTilePosition(tileX: number, tileY: number): void {
    if (!this.player?.active) return;
    const { x, y } = worldTilesToPixels(tileX, tileY);
    this.player.setPosition(x, y);
    this.controller?.resetPosition(x, y);
  }

  private onAdminTp = (e: Event): void => {
    const { x, y } = (e as CustomEvent<{ x: number; y: number }>).detail;
    if (!this.player?.active) return;
    void this.runSameSceneTeleport(x, y);
  };

  /**
   * Departure → reposition → arrival teleport spell that stays within the
   * current scene (visit repositioning, admin TP, same-scene waypoints).
   */
  private async runSameSceneTeleport(tileX: number, tileY: number, afterPlace?: () => void): Promise<void> {
    if (!this.player?.active || gameState.currentScene !== this.sceneId) return;

    // Already mid-cast: snap without stacking a second overlapping effect.
    if (gameState.isTeleporting) {
      this.applyTilePosition(tileX, tileY);
      network.send('move', { x: tileX, y: tileY, direction: 'down' });
      afterPlace?.();
      return;
    }

    gameState.isTransitioning = true;
    gameState.isTeleporting = true;
    const fx = new TeleportEffect(this, this.player);
    this.activeTeleport = fx;
    try {
      await fx.playDeparture();
      this.applyTilePosition(tileX, tileY);
      network.send('move', { x: tileX, y: tileY, direction: 'down' });
      afterPlace?.();
      await fx.playArrival();
    } catch {
      this.applyTilePosition(tileX, tileY);
      network.send('move', { x: tileX, y: tileY, direction: 'down' });
      afterPlace?.();
    } finally {
      fx.destroy(true);
      this.activeTeleport = undefined;
      gameState.isTransitioning = false;
      gameState.isTeleporting = false;
    }
  }

  private onAdminHeal = (): void => {
    window.dispatchEvent(new CustomEvent('game:stats-sync'));
  };

  private onConnectionRestored = (): void => {
    if (!network.room || !this.player?.active) return;
    network.onPlayersChange = () => this.syncRemotePlayers();
    this.syncRemotePlayers();
    const loc = gameState.savedLocation;
    const me = network.room.state.players.get(network.getLocalSessionId());
    if (me?.scene === this.sceneId && Number.isFinite(me.x) && Number.isFinite(me.y)) {
      this.applyTilePosition(me.x, me.y);
      network.syncWorldScene(this.sceneId, loc?.spawnId ?? 'default', me.x, me.y);
    } else if (loc?.scene === this.sceneId) {
      this.applyTilePosition(loc.x, loc.y);
      network.syncWorldScene(this.sceneId, loc.spawnId ?? 'default', loc.x, loc.y);
    }
    network.requestPresenceSync();
  };

  private onApartmentPresence = (): void => {
    if (!this.player?.active || gameState.currentScene !== this.sceneId) return;
    this.syncRemotePlayers();
  };

  private onSameSceneTeleport = (e: Event): void => {
    if (!this.player?.active || gameState.currentScene !== this.sceneId) return;
    const { spawnId } = (e as CustomEvent<{ scene: string; spawnId: string }>).detail;
    const mapDef = gameState.getMap(this.sceneId);
    const spawn =
      mapDef?.spawnPoints.find((s) => s.id === (spawnId || 'default')) ??
      mapDef?.spawnPoints.find((s) => s.id === 'default') ??
      { x: 8, y: 10 };
    // Server-driven reposition (visits, etc.) — instant, no teleport spell.
    this.applyTilePosition(spawn.x, spawn.y);
    network.send('move', { x: spawn.x, y: spawn.y, direction: 'down' });
    network.onPlayersChange = () => this.syncRemotePlayers();
    this.syncRemotePlayers();
  };

  private onMapsUpdated = (): void => {
    if (!this.player?.active || gameState.currentScene !== this.sceneId) return;
    this.rebuildWorldMap();
  };

  protected rebuildWorldMap(): void {
    const mapDef = gameState.getMap(this.sceneId);
    if (!mapDef) return;

    this.floorLayer?.clear(true, true);
    this.wallLayer?.clear(true, true);
    this.collisionLayer?.clear(true, true);
    this.furnitureLayer?.clear(true, true);
    this.interactables?.clear(true, true);

    const { floorLayer, wallLayer, collisionLayer, furnitureLayer, interactables } =
      buildMapFromDefinition(this, mapDef);
    this.floorLayer = floorLayer;
    this.wallLayer = wallLayer;
    this.collisionLayer = collisionLayer;
    this.furnitureLayer = furnitureLayer;
    this.interactables = interactables;
    this.blockers = [this.wallLayer, this.collisionLayer];
    this.registerBlockerColliders();
    applyWorldDepthSort(this.player, this.furnitureLayer, this.remotePlayers, this.remoteNameLabels);
    this.cameras.main.setBounds(0, 0, mapDef.width * TILE_SIZE, mapDef.height * TILE_SIZE);
    this.physics.world.setBounds(0, 0, mapDef.width * TILE_SIZE, mapDef.height * TILE_SIZE);

    window.dispatchEvent(new CustomEvent('game:map-layout-rebuilt', { detail: { sceneId: this.sceneId } }));
  }

  private syncRemotePlayers(): void {
    if (!this.player?.active) return;

    const myId = network.getLocalSessionId();
    const visibleIds = new Set<string>();

    network.forEachSyncedPlayer((sessionId, p) => {
      if (sessionId === myId) return;
      if (!network.isSameWorldSpace(p)) {
        this.removeRemotePlayer(sessionId);
        return;
      }

      visibleIds.add(sessionId);
      const tx = Number.isFinite(p.x) ? p.x : 0;
      const ty = Number.isFinite(p.y) ? p.y : 0;
      const { x: px, y: py } = worldTilesToPixels(tx, ty);

      let remote = this.remotePlayers.get(sessionId);
      if (!remote) {
        remote = this.add.sprite(px, py, 'player_other_walk', 0);
        remote.setOrigin(0.5, 0.85);
        remote.setInteractive({ useHandCursor: true });
        remote.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
          const ev = pointer.event as MouseEvent;
          if (ev.button === 2 && remote) {
            ev.preventDefault();
            ev.stopPropagation();
            this.remotePlayers.forEach((s) => s.clearTint());
            remote.setTint(0x4488ff);
            window.dispatchEvent(new CustomEvent('game:target-player', {
              detail: { sessionId, displayName: p.displayName, x: ev.clientX, y: ev.clientY },
            }));
          }
        });
        this.remotePlayers.set(sessionId, remote);

        const label = this.add
          .text(px, py - 12, p.displayName, {
            fontSize: '6px',
            color: '#aaffcc',
            fontFamily: 'monospace',
          })
          .setOrigin(0.5);
        this.remoteNameLabels.set(sessionId, label);
      } else {
        remote.setPosition(px, py);
        const label = this.remoteNameLabels.get(sessionId);
        label?.setPosition(px, py - 12);
        if (label && label.text !== p.displayName) label.setText(p.displayName);
      }
    });

    for (const [id] of this.remotePlayers) {
      if (!visibleIds.has(id)) this.removeRemotePlayer(id);
    }
  }

  private removeRemotePlayer(sessionId: string): void {
    this.remotePlayers.get(sessionId)?.destroy();
    this.remotePlayers.delete(sessionId);
    this.remoteNameLabels.get(sessionId)?.destroy();
    this.remoteNameLabels.delete(sessionId);
    this.removeSpeechBubble(sessionId);
  }

  private onLocalSpeech = (ev: Event): void => {
    const detail = (ev as CustomEvent<{ channel?: string; message?: string; fromSessionId?: string; from?: string }>).detail;
    if (!detail || detail.channel !== 'local' || !detail.message?.trim()) return;
    const sessionId = this.sessionForSpeaker(detail.fromSessionId, detail.from);
    if (!sessionId) return;
    this.showSpeechBubble(sessionId, detail.message.trim());
  };

  private sessionForSpeaker(sessionId?: string, name?: string): string | null {
    if (sessionId) return sessionId;
    if (!name) return null;
    if (gameState.displayName === name) return network.getLocalSessionId();
    let found: string | null = null;
    network.forEachSyncedPlayer((id, player) => {
      if (player.displayName === name) found = id;
    });
    return found;
  }

  private speakerPoint(sessionId: string): { x: number; y: number } | null {
    if (sessionId === network.getLocalSessionId() && this.player?.active) {
      return { x: this.player.x, y: this.player.y - 28 };
    }
    const remote = this.remotePlayers.get(sessionId);
    if (!remote?.active) return null;
    return { x: remote.x, y: remote.y - 28 };
  }

  private showSpeechBubble(sessionId: string, message: string): void {
    this.removeSpeechBubble(sessionId);
    const spoken = message.length > 140 ? `${message.slice(0, 137)}…` : message;
    const root = document.createElement('div');
    root.className = 'world-speech-bubble';
    root.style.visibility = 'hidden';
    const plate = document.createElement('div');
    plate.className = 'world-speech-bubble__plate';
    plate.textContent = spoken;
    const tail = document.createElement('div');
    tail.className = 'world-speech-bubble__tail';
    const tailStroke = document.createElement('div');
    const tailFill = document.createElement('div');
    tail.append(tailStroke, tailFill);
    root.append(plate, tail);
    this.ensureSpeechLayer().append(root);
    this.speechBubbles.set(sessionId, {
      root,
      plate,
      tail,
      tailStroke,
      tailFill,
      until: this.time.now + Math.min(9000, 2800 + spoken.length * 45),
      metricsKey: '',
      outerHalf: 0,
      innerHalf: 0,
    });
    this.positionSpeechBubbles();
  }

  private tickSpeechBubbles(): void {
    const now = this.time.now;
    for (const [sessionId, bubble] of this.speechBubbles) {
      if (now >= bubble.until) this.removeSpeechBubble(sessionId);
    }
  }

  /** Camera follow runs in preRender, so place bubbles on the render event, not in update. */
  private onSpeechRender = (): void => {
    this.positionSpeechBubbles();
  };

  private ensureSpeechLayer(): HTMLDivElement {
    if (this.speechLayer?.isConnected) return this.speechLayer;
    const layer = document.createElement('div');
    layer.className = 'world-speech-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.append(layer);
    this.speechLayer = layer;
    return layer;
  }

  private clearSpeechBubbles(): void {
    for (const bubble of this.speechBubbles.values()) bubble.root.remove();
    this.speechBubbles.clear();
    this.speechLayer?.remove();
    this.speechLayer = undefined;
  }

  private removeSpeechBubble(sessionId: string): void {
    const bubble = this.speechBubbles.get(sessionId);
    if (!bubble) return;
    bubble.root.remove();
    this.speechBubbles.delete(sessionId);
    if (this.speechBubbles.size === 0) {
      this.speechLayer?.remove();
      this.speechLayer = undefined;
    }
  }

  /**
   * CSS pixels per game pixel. The FIT scale is often fractional (the 512×384
   * buffer stretched to the window). Text is sized in whole CSS pixels instead
   * of being drawn at 7px and nearest-neighbor scaled with the pixel-art canvas.
   */
  private speechCanvasScale(): { cssPerGameX: number; cssPerGameY: number; rect: DOMRect } | null {
    const canvas = this.game?.canvas;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const gameW = this.scale.gameSize.width;
    const gameH = this.scale.gameSize.height;
    if (rect.width < 1 || rect.height < 1 || gameW < 1 || gameH < 1) return null;
    return {
      cssPerGameX: rect.width / gameW,
      cssPerGameY: rect.height / gameH,
      rect,
    };
  }

  private positionSpeechBubbles(): void {
    if (this.speechBubbles.size === 0) return;
    const scale = this.speechCanvasScale();
    if (!scale) return;
    const layer = this.ensureSpeechLayer();
    const originX = Math.round(scale.rect.left);
    const originY = Math.round(scale.rect.top);
    layer.style.left = `${originX}px`;
    layer.style.top = `${originY}px`;
    layer.style.width = `${Math.max(0, Math.round(scale.rect.width))}px`;
    layer.style.height = `${Math.max(0, Math.round(scale.rect.height))}px`;
    for (const [sessionId, bubble] of this.speechBubbles) {
      this.layoutSpeechBubble(bubble, scale.cssPerGameY);
      this.placeSpeechBubble(bubble, sessionId, scale, originX, originY);
    }
  }

  private layoutSpeechBubble(bubble: WorldSpeechBubble, cssPerGame: number): void {
    const fontPx = Math.max(14, Math.round(7 * cssPerGame));
    const borderPx = Math.max(1, Math.round(2 * cssPerGame));
    const padX = Math.round(9 * cssPerGame);
    const padY = Math.round(7 * cssPerGame);
    const radiusPx = Math.max(4, Math.round(8 * cssPerGame));
    const contentMax = Math.round(92 * cssPerGame);
    const minWidth = Math.round(56 * cssPerGame);
    const outerHalf = Math.max(4, Math.round(6 * cssPerGame));
    const outerH = Math.max(6, Math.round(10 * cssPerGame));
    const innerHalf = Math.max(2, outerHalf - borderPx);
    const innerH = Math.max(3, outerH - borderPx);
    const key = [fontPx, borderPx, padX, padY, radiusPx, contentMax, minWidth, outerHalf, outerH, innerHalf, innerH].join(':');
    if (bubble.metricsKey === key) return;
    bubble.metricsKey = key;
    bubble.outerHalf = outerHalf;
    bubble.innerHalf = innerHalf;

    const plate = bubble.plate;
    plate.style.fontSize = `${fontPx}px`;
    plate.style.padding = `${padY}px ${padX}px`;
    plate.style.borderWidth = `${borderPx}px`;
    plate.style.borderRadius = `${radiusPx}px`;
    plate.style.maxWidth = `${contentMax + padX * 2 + borderPx * 2}px`;
    plate.style.minWidth = `${minWidth}px`;

    bubble.tail.style.height = `${outerH}px`;
    bubble.tail.style.marginTop = `${-borderPx}px`;
    this.styleSpeechTail(bubble.tailStroke, outerHalf, outerH, '#c4a15a');
    this.styleSpeechTail(bubble.tailFill, innerHalf, innerH, '#f8edd4');
    this.centerSpeechTail(bubble);
  }

  private styleSpeechTail(el: HTMLDivElement, half: number, height: number, color: string): void {
    el.style.position = 'absolute';
    el.style.top = '0';
    el.style.width = '0';
    el.style.height = '0';
    el.style.margin = '0';
    el.style.padding = '0';
    el.style.borderStyle = 'solid';
    el.style.borderBottomWidth = '0';
    el.style.borderLeft = `${half}px solid transparent`;
    el.style.borderRight = `${half}px solid transparent`;
    el.style.borderTop = `${height}px solid ${color}`;
    el.style.filter = 'none';
    el.style.transform = 'none';
  }

  private centerSpeechTail(bubble: WorldSpeechBubble): void {
    const width = bubble.root.offsetWidth;
    bubble.tailStroke.style.left = `${Math.round((width - bubble.outerHalf * 2) / 2)}px`;
    bubble.tailFill.style.left = `${Math.round((width - bubble.innerHalf * 2) / 2)}px`;
  }

  private placeSpeechBubble(
    bubble: WorldSpeechBubble,
    sessionId: string,
    scale: { cssPerGameX: number; cssPerGameY: number; rect: DOMRect },
    originX: number,
    originY: number,
  ): void {
    const point = this.speakerPoint(sessionId);
    const cam = this.cameras.main;
    const root = bubble.root;
    if (!point || !cam.worldView.contains(point.x, point.y)) {
      root.style.visibility = 'hidden';
      return;
    }
    const gameX = cam.x + (point.x - cam.worldView.x) * cam.zoomX;
    const gameY = cam.y + (point.y - cam.worldView.y) * cam.zoomY;
    const localX = scale.rect.left + gameX * scale.cssPerGameX - originX;
    const localY = scale.rect.top + gameY * scale.cssPerGameY - originY;
    root.style.visibility = 'visible';
    root.style.left = `${Math.round(localX - root.offsetWidth / 2)}px`;
    root.style.top = `${Math.round(localY - root.offsetHeight)}px`;
  }
}
