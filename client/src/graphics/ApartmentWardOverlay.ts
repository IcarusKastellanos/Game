import Phaser from 'phaser';
import type { ContentMapDefinition, WardState } from '@witchcraft/shared';
import { TILE_SIZE } from '@witchcraft/shared';
import { gameState } from '../data/game-state';
import { network } from '../net/NetworkManager';

/** Perimeter ward netting around walkable apartment area */
export class ApartmentWardOverlay {
  private graphics!: Phaser.GameObjects.Graphics;
  private perimeter: { x: number; y: number }[] = [];
  private wards: WardState[] = [];
  private shattering = new Map<string, { t: number }>();
  private t = 0;
  private flash = 0;
  private updateHandler!: (time: number, delta: number) => void;

  constructor(
    private scene: Phaser.Scene,
    mapDef: ContentMapDefinition
  ) {
    this.perimeter = this.computeWalkablePerimeter(mapDef);
    this.graphics = scene.add.graphics().setDepth(250);
    this.syncWards();

    this.updateHandler = (_time: number, delta: number) => {
      this.t += delta * 0.001;
      if (this.flash > 0) this.flash = Math.max(0, this.flash - delta * 0.001);
      this.redraw();
    };
    scene.events.on('update', this.updateHandler);

    window.addEventListener('game:apartment-wards', this.onWards as EventListener);
    window.addEventListener('game:ward-shatter', this.onShatter as EventListener);
    window.addEventListener('game:player-loaded', this.onLoaded as EventListener);
    window.addEventListener('game:player-sync', this.onSync as EventListener);
    window.addEventListener('game:ward-placed', this.onPlaced as EventListener);

    this.redraw();
  }

  destroy(): void {
    window.removeEventListener('game:apartment-wards', this.onWards as EventListener);
    window.removeEventListener('game:ward-shatter', this.onShatter as EventListener);
    window.removeEventListener('game:player-loaded', this.onLoaded as EventListener);
    window.removeEventListener('game:player-sync', this.onSync as EventListener);
    window.removeEventListener('game:ward-placed', this.onPlaced as EventListener);
    this.scene.events.off('update', this.updateHandler);
    this.graphics.destroy();
  }

  private syncWards(): void {
    this.wards = gameState.apartmentWards ?? [];
  }

  private onLoaded = (e: CustomEvent<{ wards?: WardState[]; dbPlayerId?: string }>): void => {
    if (e.detail.dbPlayerId) gameState.dbPlayerId = e.detail.dbPlayerId;
    if (
      gameState.visitingHostSessionId &&
      gameState.visitingHostSessionId !== network.getLocalSessionId()
    ) {
      return;
    }
    if (e.detail.wards) gameState.apartmentWards = e.detail.wards;
    this.syncWards();
    this.redraw();
  };

  private onSync = (): void => {
    this.syncWards();
    this.redraw();
  };

  private onWards = (e: CustomEvent<{ wards: WardState[] }>): void => {
    gameState.apartmentWards = e.detail.wards;
    this.wards = e.detail.wards;
    this.flash = 1.2;
    this.redraw();
  };

  private onPlaced = (): void => {
    this.syncWards();
    this.flash = 1.5;
    this.redraw();
  };

  private onShatter = (e: CustomEvent<{ wardIds: string[] }>): void => {
    for (const id of e.detail.wardIds) {
      this.shattering.set(id, { t: 0 });
    }
    this.wards = this.wards.filter((w) => !e.detail.wardIds.includes(w.id));
    gameState.apartmentWards = this.wards;
  };

  private computeWalkablePerimeter(mapDef: ContentMapDefinition): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = [];
    const inset = 1;
    const maxX = mapDef.width - 1 - inset;
    const maxY = mapDef.height - 1 - inset;
    for (let x = inset; x <= maxX; x++) {
      pts.push({ x: x * TILE_SIZE + TILE_SIZE / 2, y: inset * TILE_SIZE + TILE_SIZE / 2 });
    }
    for (let y = inset + 1; y <= maxY; y++) {
      pts.push({ x: maxX * TILE_SIZE + TILE_SIZE / 2, y: y * TILE_SIZE + TILE_SIZE / 2 });
    }
    for (let x = maxX - 1; x >= inset; x--) {
      pts.push({ x: x * TILE_SIZE + TILE_SIZE / 2, y: maxY * TILE_SIZE + TILE_SIZE / 2 });
    }
    for (let y = maxY - 1; y > inset; y--) {
      pts.push({ x: inset * TILE_SIZE + TILE_SIZE / 2, y: y * TILE_SIZE + TILE_SIZE / 2 });
    }
    return pts;
  }

  private wardColor(creatorId: string): number {
    if (!creatorId || creatorId === 'unknown' || creatorId === 'player') {
      return 0x4488ff;
    }
    return creatorId === gameState.dbPlayerId ? 0x4488ff : 0x44cc66;
  }

  private redraw(): void {
    this.graphics.clear();
    if (!this.perimeter.length) return;

    const hasWards = this.wards.length > 0 || this.shattering.size > 0;
    if (!hasWards) return;

    const flashBoost = this.flash > 0 ? this.flash * 0.35 : 0;

    for (const ward of this.wards) {
      this.drawWardRing(this.wardColor(ward.creatorId), false, 0.75 + flashBoost);
    }

    for (const [, shatter] of this.shattering) {
      shatter.t += 0.05;
      const alpha = Math.max(0, 1 - shatter.t);
      if (alpha <= 0) continue;
      this.drawWardRing(0xff4422, true, alpha);
    }
    for (const [id, shatter] of [...this.shattering.entries()]) {
      if (shatter.t >= 1.25) this.shattering.delete(id);
    }
  }

  private drawWardRing(color: number, burning: boolean, alpha: number): void {
    const pulse = 0.55 + Math.sin(this.t * 2.5) * 0.3;
    this.graphics.lineStyle(burning ? 3 : 2, color, Math.min(1, alpha * pulse));

    for (let i = 0; i < this.perimeter.length; i++) {
      const a = this.perimeter[i];
      const b = this.perimeter[(i + 1) % this.perimeter.length];
      this.graphics.beginPath();
      this.graphics.moveTo(a.x, a.y);
      this.graphics.lineTo(b.x, b.y);
      this.graphics.strokePath();

      if (i % 2 === 0) {
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const px = (-dy / len) * (3 + Math.sin(this.t * 2 + i) * 1.5);
        const py = (dx / len) * (3 + Math.sin(this.t * 2 + i) * 1.5);
        this.graphics.beginPath();
        this.graphics.moveTo(mx - px, my - py);
        this.graphics.lineTo(mx + px, my + py);
        this.graphics.strokePath();
      }
    }
  }
}
