import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { ApartmentScene } from './scenes/ApartmentScene';
import { TownScene } from './scenes/TownScene';
import { UIScene } from './scenes/UIScene';
import { TILE_SIZE } from '@witchcraft/shared';
import { registerPhaserGame } from './ui/input-focus';
import './ui/admin-panel.css';
import './ui/inventory-panel.css';
import './ui/altar-panel.css';
import './ui/hexagram-panel.css';
import './ui/chat-panel.css';
import './ui/hud/hud-theme.css';
import './ui/workbench-panels.css';
import './ui/friends-panel.css';
import './ui/aura-panel.css';
import './ui/character-sheet.css';
import './ui/ledger-overlay.css';
import './ui/aura/aura-visualization.css';

/** Phaser game bootstrap — 16-bit pixel scale */
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: 512,
  height: 384,
  backgroundColor: '#2d1b3d',
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      fps: 60,
      fixedStep: true,
    },
  },
  disableContextMenu: true,
  scene: [BootScene, ApartmentScene, TownScene, UIScene],
};

export const GAME_CONFIG = config;
export const TILE_PX = TILE_SIZE;

const game = new Phaser.Game(config);
game.canvas.setAttribute('tabindex', '-1');
game.canvas.oncontextmenu = () => false;
document.getElementById('game-container')?.addEventListener('contextmenu', (e) => e.preventDefault());
registerPhaserGame(game);
