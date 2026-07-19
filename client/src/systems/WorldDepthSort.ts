import Phaser from 'phaser';
import {
  normalizePlacedRenderLevel,
  placedObjectDepth,
  RENDER_LEVEL_PLAYER,
} from '@witchcraft/shared';

/** Baseline depth for floor tiles (always below actors). */
export const DEPTH_FLOOR = 0;
/** Baseline depth for walls. */
export const DEPTH_WALL = 1;

/** Y at the sprite's feet / ground contact — higher Y draws in front (top-down). */
export function feetDepthY(feetY: number): number {
  return feetY;
}

export function spriteFeetY(sprite: Phaser.GameObjects.Sprite): number {
  return sprite.y;
}

export function furnitureFeetY(sprite: Phaser.GameObjects.Sprite): number {
  const fromData = sprite.getData('sortY') as number | undefined;
  if (fromData != null) return fromData;
  return sprite.y + sprite.displayHeight;
}

/** Bottom Y of a tile footprint after a 90°-step rotation around its center. */
export function rotatedFootprintBottomY(
  originXPx: number,
  originYPx: number,
  widthPx: number,
  heightPx: number,
  rotationDegrees: number
): number {
  const cx = originXPx + widthPx / 2;
  const cy = originYPx + heightPx / 2;
  const rad = Phaser.Math.DegToRad(rotationDegrees);
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  const halfW = widthPx / 2;
  const halfH = heightPx / 2;
  const corners: [number, number][] = [
    [-halfW, -halfH],
    [halfW, -halfH],
    [halfW, halfH],
    [-halfW, halfH],
  ];
  let maxY = -Infinity;
  for (const [dx, dy] of corners) {
    const y = cy + dx * sin + dy * cos;
    if (y > maxY) maxY = y;
  }
  return maxY;
}

/** Re-sort local player, furniture, decorations, and remote players by render level + feet Y. */
export function applyWorldDepthSort(
  player: Phaser.Physics.Arcade.Sprite,
  furnitureLayer: Phaser.GameObjects.Group,
  remotePlayers: Map<string, Phaser.GameObjects.Sprite>,
  remoteNameLabels: Map<string, Phaser.GameObjects.Text>
): void {
  player.setDepth(placedObjectDepth(RENDER_LEVEL_PLAYER, spriteFeetY(player)));

  for (const child of furnitureLayer.getChildren()) {
    const sprite = child as Phaser.GameObjects.Sprite;
    const level = normalizePlacedRenderLevel(sprite.getData('renderLevel') as number | undefined);
    sprite.setDepth(placedObjectDepth(level, furnitureFeetY(sprite)));
  }

  for (const [sessionId, remote] of remotePlayers) {
    const depth = placedObjectDepth(RENDER_LEVEL_PLAYER, spriteFeetY(remote));
    remote.setDepth(depth);
    remoteNameLabels.get(sessionId)?.setDepth(depth + 0.1);
  }
}
