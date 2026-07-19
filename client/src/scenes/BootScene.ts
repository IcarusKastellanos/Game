import Phaser from 'phaser';
import { gameState } from '../data/game-state';
import { generateStardewAssets, generateNpcSprites } from '../graphics/SpriteGenerator';
import { preloadItemIcons } from '../graphics/ItemIconGenerator';
import { bindAmbientAudioUnlock } from '../audio/AmbientAudio';
import { initLogin } from '../ui/LoginScreen';

/** Asset bootstrap — login then enter world */
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    this.cameras.main.setBackgroundColor('#1a1025');
  }

  create(): void {
    generateStardewAssets(this);
    bindAmbientAudioUnlock();

    initLogin(async () => {
      await gameState.loadContent();
      if (gameState.content?.ingredients) {
        preloadItemIcons(gameState.content.ingredients);
      }
      if (gameState.content?.npcs) {
        generateNpcSprites(this, gameState.content.npcs);
      }
      await gameState.loadSession();
      const scene = gameState.savedLocation?.scene ?? 'apartment';
      gameState.pendingSpawnId = gameState.savedLocation?.spawnId ?? 'default';
      this.scene.start(scene === 'town' ? 'TownScene' : 'ApartmentScene');
      this.scene.launch('UIScene');
    });
  }
}
