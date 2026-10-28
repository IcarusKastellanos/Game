import Phaser from 'phaser';
import { NPC_SHEET_FRAME_H, NPC_SHEET_FRAME_W } from '@witchcraft/shared';

const FEET_RADIUS = 10;

/** Smaller circular hitbox at the feet — reduces snagging on tile corners. */
export function configureFeetHitbox(
  sprite: Phaser.Physics.Arcade.Sprite,
  frameW = NPC_SHEET_FRAME_W,
  frameH = NPC_SHEET_FRAME_H,
  feetAnchorY = 0.85
): void {
  const body = sprite.body as Phaser.Physics.Arcade.Body;
  const cx = frameW / 2 - FEET_RADIUS;
  const cy = frameH * feetAnchorY - FEET_RADIUS;
  body.setCircle(FEET_RADIUS, cx, cy);
}

/** Arcade defaults that reduce corner bounce when sliding along tile edges. */
export function configurePlayerPhysics(sprite: Phaser.Physics.Arcade.Sprite): void {
  const body = sprite.body as Phaser.Physics.Arcade.Body;
  body.setBounce(0, 0);
  body.setFriction(0, 0);
  body.setDrag(0, 0);
  // Movement is velocity-driven and resolved by Phaser's physics step against
  // colliders registered in the scene. No manual position mutation.
}

/**
 * Drive the player with velocity so Phaser's fixed-timestep physics resolves
 * collisions against the registered blocker colliders. Diagonal input is
 * already normalized by the caller.
 */
export function applyMovementVelocity(
  player: Phaser.Physics.Arcade.Sprite,
  vx: number,
  vy: number
): void {
  player.setVelocity(vx, vy);
}
