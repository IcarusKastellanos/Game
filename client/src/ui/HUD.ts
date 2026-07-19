import Phaser from 'phaser';
import { HUDManager } from './hud/HUDManager.js';

/** Persistent practitioner HUD — delegates to HUDManager */
export class HUD {
  private manager: HUDManager;

  constructor(scene: Phaser.Scene) {
    this.manager = new HUDManager(scene);
  }

  getManager(): HUDManager {
    return this.manager;
  }

  showMessage(msg: string): void {
    this.manager.showMessage(msg);
  }
}
