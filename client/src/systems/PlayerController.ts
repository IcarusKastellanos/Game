import Phaser from 'phaser';
import { PLAYER_SPEED } from '@witchcraft/shared';
import { gameState } from '../data/game-state';
import { shouldBlockGameHotkeys } from '../ui/input-focus';
import { network } from '../net/NetworkManager';
import { pixelsToWorldTiles } from '../utils/world-coords';
import {
  directionFromVelocity,
  animKeyForDirection,
  type WalkDirection,
} from '../graphics/SpriteGenerator';
import { applyMovementVelocity } from './WorldMovement';

const K = Phaser.Input.Keyboard.KeyCodes;

/** Add a key without capturing DOM events (enableCapture: false) */
function gameKey(keyboard: Phaser.Input.Keyboard.KeyboardPlugin, code: number): Phaser.Input.Keyboard.Key {
  return keyboard.addKey(code, false, false);
}

/** WASD movement with 8-direction Stardew-style walk animations */
export class PlayerController {
  private cursors: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };
  private wasd: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  private interactKey: Phaser.Input.Keyboard.Key;
  private lastSent = { tx: 0, ty: 0, direction: 'down' as WalkDirection };
  private sendCooldown = 0;
  private currentDir: WalkDirection = 'down';
  private sheetKey = 'player_walk';

  constructor(private scene: Phaser.Scene) {
    if (!scene.input.keyboard) throw new Error('Keyboard not available');
    const kb = scene.input.keyboard;
    // Do NOT use createCursorKeys / addKeys defaults — they preventDefault and block DOM typing
    this.cursors = {
      up: gameKey(kb, K.UP),
      down: gameKey(kb, K.DOWN),
      left: gameKey(kb, K.LEFT),
      right: gameKey(kb, K.RIGHT),
    };
    this.wasd = {
      W: gameKey(kb, K.W),
      A: gameKey(kb, K.A),
      S: gameKey(kb, K.S),
      D: gameKey(kb, K.D),
    };
    this.interactKey = gameKey(kb, K.E);
  }

  setSheetKey(key: string): void {
    this.sheetKey = key;
  }

  update(
    player: Phaser.Physics.Arcade.Sprite,
    _blockers: Phaser.Physics.Arcade.StaticGroup[],
    onInteract?: () => void
  ): void {
    if (shouldBlockGameHotkeys()) {
      player.setVelocity(0);
      return;
    }

    let vx = 0;
    let vy = 0;

    if (this.cursors.left.isDown || this.wasd.A.isDown) vx = -PLAYER_SPEED;
    else if (this.cursors.right.isDown || this.wasd.D.isDown) vx = PLAYER_SPEED;
    if (this.cursors.up.isDown || this.wasd.W.isDown) vy = -PLAYER_SPEED;
    else if (this.cursors.down.isDown || this.wasd.S.isDown) vy = PLAYER_SPEED;

    if (vx !== 0 && vy !== 0) {
      const diag = PLAYER_SPEED / Math.SQRT2;
      vx = Math.sign(vx) * diag;
      vy = Math.sign(vy) * diag;
    }

    applyMovementVelocity(player, vx, vy);

    if (vx !== 0 || vy !== 0) {
      this.currentDir = directionFromVelocity(vx, vy, this.currentDir);
      const anim = animKeyForDirection(this.sheetKey, this.currentDir);
      if (player.anims.currentAnim?.key !== anim) player.play(anim, true);
    } else {
      player.anims.stop();
      player.setFrame(this.frameForDirection(this.currentDir));
    }

    this.sendCooldown -= this.scene.game.loop.delta;
    const { x: tx, y: ty } = pixelsToWorldTiles(player.x, player.y);
    const moving = vx !== 0 || vy !== 0;
    const moved =
      Math.abs(tx - this.lastSent.tx) > 0.02 || Math.abs(ty - this.lastSent.ty) > 0.02;
    if ((moving || moved) && this.sendCooldown <= 0) {
      this.lastSent = { tx, ty, direction: this.currentDir };
      network.send('move', {
        x: tx,
        y: ty,
        direction: this.currentDir.includes('left') ? 'left' : this.currentDir.includes('right') ? 'right' : this.currentDir.includes('up') ? 'up' : 'down',
      });
      if (gameState.savedLocation) {
        gameState.savedLocation = { ...gameState.savedLocation, x: tx, y: ty };
      }
      this.sendCooldown = 16;
    }

    if (Phaser.Input.Keyboard.JustDown(this.interactKey)) {
      onInteract?.();
    }
  }

  private frameForDirection(dir: WalkDirection): number {
    const dirs = ['down', 'down-right', 'right', 'up-right', 'up', 'up-left', 'left', 'down-left'];
    return dirs.indexOf(dir) * 4;
  }

  resetPosition(x: number, y: number): void {
    const { x: tx, y: ty } = pixelsToWorldTiles(x, y);
    this.lastSent = { tx, ty, direction: 'down' };
  }
}
