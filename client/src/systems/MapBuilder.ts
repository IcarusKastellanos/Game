import Phaser from 'phaser';
import type { ContentMapDefinition } from '@witchcraft/shared';
import {
  TILE_SIZE,
  runtimeLayersHaveTiles,
  spriteKeyFromTileIndex,
  normalizePlacedRenderLevel,
  isCraftingInteractable,
} from '@witchcraft/shared';
import { TILES_ATLAS } from '../graphics/SpriteGenerator';
import { ensureMapSpriteTexture, evictMapSpritePixelTextures } from '../graphics/MapSpriteTextures';
import { DEPTH_FLOOR, DEPTH_WALL, rotatedFootprintBottomY } from './WorldDepthSort';
import { gameState } from '../data/game-state';

const COLLISION_TEXTURE = 'map_collision';

const BLOCKING_COLLISION_MODES = new Set([
  'full',
  'partial',
  'polygon',
  'rectangle',
  'circle',
  'line_of_sight',
  'magic_block',
]);

function ensureCollisionTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(COLLISION_TEXTURE)) return;
  const g = scene.make.graphics({ x: 0, y: 0 });
  g.fillStyle(0x000000, 0.001);
  g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  g.generateTexture(COLLISION_TEXTURE, TILE_SIZE, TILE_SIZE);
  g.destroy();
}

function isBlockingCollision(mode: string | undefined): boolean {
  return BLOCKING_COLLISION_MODES.has(mode ?? 'full');
}
/** Procedurally generate placeholder tile textures at TILE_SIZE. */
export function generatePlaceholderTextures(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 });
  const s = TILE_SIZE / 16;

  const colors: Record<string, number> = {
    tile_floor_wood: 0x8b6914,
    tile_floor_stone: 0x666677,
    tile_grass: 0x3a7d44,
    tile_path: 0x9b7653,
    tile_wall_brick: 0x5c4033,
    tile_fence: 0x4a3728,
    obj_altar: 0x4a0080,
    obj_door: 0x6b4423,
    obj_bed: 0x8844aa,
    obj_red_bed: 0xcc3333,
    obj_shelf: 0x553311,
    obj_tree: 0x226622,
    obj_shop: 0x884422,
    obj_cleanser: 0x44aaaa,
    player: 0xcc88ff,
    player_other: 0x88ccaa,
    interact_highlight: 0xffff00,
  };

  for (const [key, color] of Object.entries(colors)) {
    g.clear();
    if (key.startsWith('tile_')) {
      g.fillStyle(color, 1);
      g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      g.lineStyle(1, 0x000000, 0.3);
      g.strokeRect(0, 0, TILE_SIZE, TILE_SIZE);
    } else if (key.startsWith('obj_')) {
      g.clear();
      g.fillStyle(color, 1);
      g.fillRect(4 * s, 6 * s, TILE_SIZE - 8 * s, TILE_SIZE - 8 * s);
      g.lineStyle(1, 0xffffff, 0.5);
      g.strokeRect(4 * s, 6 * s, TILE_SIZE - 8 * s, TILE_SIZE - 8 * s);
    } else if (key === 'player' || key === 'player_other') {
      g.fillStyle(color, 1);
      g.fillRect(4 * s, 0, 8 * s, 4 * s);
      g.fillRect(2 * s, 4 * s, 12 * s, 8 * s);
      g.fillRect(4 * s, 12 * s, 3 * s, 4 * s);
      g.fillRect(9 * s, 12 * s, 3 * s, 4 * s);
    } else {
      g.fillStyle(color, 0.5);
      g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    }
    g.generateTexture(key, TILE_SIZE, TILE_SIZE);
  }

  g.destroy();
}

function placeTile(
  layer: Phaser.GameObjects.Group | Phaser.Physics.Arcade.StaticGroup,
  px: number,
  py: number,
  spriteKey: string,
  asWall: boolean
): void {
  const sprite = layer.create(px, py, TILES_ATLAS, spriteKey) as Phaser.Physics.Arcade.Sprite;
  sprite.setDepth(asWall ? DEPTH_WALL : DEPTH_FLOOR);
  if (asWall) {
    sprite.setImmovable(true);
    sprite.refreshBody();
  }
}

type RuntimeInteractable = ContentMapDefinition['interactables'][number];

function interactableCenterPixels(inter: RuntimeInteractable): { x: number; y: number } {
  if (inter.data?.centerTileCoords === true) {
    return { x: inter.x * TILE_SIZE, y: inter.y * TILE_SIZE };
  }
  return { x: inter.x * TILE_SIZE + TILE_SIZE / 2, y: inter.y * TILE_SIZE + TILE_SIZE / 2 };
}

function addInteractableSprite(
  scene: Phaser.Scene,
  interactables: Phaser.GameObjects.Group,
  inter: RuntimeInteractable
): void {
  const { x, y } = interactableCenterPixels(inter);
  // Crafting zones are invisible triggers; visuals come from placed map furniture only.
  const invisible =
    inter.data?.invisible === true ||
    inter.data?.fromFurniture === true ||
    isCraftingInteractable(inter.type);

  if (invisible) {
    const hit = scene.add.sprite(x, y, COLLISION_TEXTURE).setAlpha(0.001);
    hit.setData('interactable', inter);
    interactables.add(hit);
    return;
  }

  const npcId = inter.type === 'npc' ? String(inter.data?.npcId ?? inter.id) : '';
  const spriteKey =
    inter.type === 'altar'
      ? 'obj_altar'
      : inter.type === 'door'
        ? 'obj_door'
        : inter.type === 'shop'
          ? 'obj_shop'
          : inter.type === 'cleanser'
            ? 'obj_cleanser'
          : inter.type === 'npc'
            ? scene.textures.exists(`${npcId}_walk`)
              ? `${npcId}_walk`
              : npcId
            : 'obj_shelf';

  const obj = scene.add.sprite(x, y, spriteKey).setData('interactable', inter);
  if (inter.type === 'npc') {
    obj.setOrigin(0.5, 0.85);
    const idleKey = `${npcId}_idle_down`;
    const walkDown = `${npcId}_walk_down`;
    if (scene.anims.exists(idleKey)) obj.play(idleKey, true);
    else if (scene.anims.exists(walkDown)) {
      obj.anims.stop();
      obj.setFrame(0);
    }
  }
  interactables.add(obj);

  if (inter.type === 'altar' || inter.type === 'shop' || inter.type === 'door' || inter.type === 'cleanser' || inter.type === 'bed') {
    scene.add
      .text(obj.x, obj.y - 14, inter.type === 'cleanser' ? 'CLEANSE' : inter.type === 'bed' ? 'REST' : inter.type.toUpperCase(), {
        fontSize: '6px',
        color: '#ffdd88',
        fontFamily: 'monospace',
      })
      .setOrigin(0.5);
  }
}

/** Build tilemap layers from content registry map definition */
export function buildMapFromDefinition(
  scene: Phaser.Scene,
  mapDef: ContentMapDefinition
): {
  floorLayer: Phaser.GameObjects.Group;
  wallLayer: Phaser.Physics.Arcade.StaticGroup;
  collisionLayer: Phaser.Physics.Arcade.StaticGroup;
  furnitureLayer: Phaser.GameObjects.Group;
  interactables: Phaser.GameObjects.Group;
} {
  const floorLayer = scene.add.group();
  const wallLayer = scene.physics.add.staticGroup();
  const collisionLayer = scene.physics.add.staticGroup();
  const furnitureLayer = scene.add.group();
  const interactables = scene.add.group();

  evictMapSpritePixelTextures(scene);
  ensureCollisionTexture(scene);
  const floorKey = mapDef.sceneId === 'apartment' ? 'tile_floor_wood' : 'tile_grass';
  const wallKey = mapDef.sceneId === 'apartment' ? 'tile_wall_brick' : 'tile_fence';
  const pathKey = 'tile_path';

  const useSavedTiles = runtimeLayersHaveTiles(mapDef);

  for (let y = 0; y < mapDef.height; y++) {
    for (let x = 0; x < mapDef.width; x++) {
      const px = x * TILE_SIZE + TILE_SIZE / 2;
      const py = y * TILE_SIZE + TILE_SIZE / 2;
      const isBorder =
        x === 0 || y === 0 || x === mapDef.width - 1 || y === mapDef.height - 1;

      if (useSavedTiles) {
        const wallIdx = mapDef.layers.walls[y]?.[x] ?? 0;
        const floorIdx = mapDef.layers.floor[y]?.[x] ?? 0;
        if (wallIdx > 0) {
          const key = spriteKeyFromTileIndex(wallIdx) ?? wallKey;
          placeTile(wallLayer, px, py, key, true);
        } else if (floorIdx > 0) {
          const key = spriteKeyFromTileIndex(floorIdx) ?? floorKey;
          placeTile(floorLayer, px, py, key, false);
        }
        continue;
      }

      if (isBorder) {
        placeTile(wallLayer, px, py, wallKey, true);
      } else {
        const isPath =
          mapDef.sceneId === 'town' &&
          (x === Math.floor(mapDef.width / 2) || y === Math.floor(mapDef.height / 2));
        placeTile(floorLayer, px, py, isPath ? pathKey : floorKey, false);
      }
    }
  }

  for (const inter of mapDef.interactables) {
    if (gameState.hiddenNpcIds.includes(inter.id)) continue;
    addInteractableSprite(scene, interactables, inter);
  }

  for (const f of mapDef.placedFurniture ?? []) {
    const wPx = f.width * TILE_SIZE;
    const hPx = f.height * TILE_SIZE;
    const rot = f.rotation ?? 0;
    const texKey = ensureMapSpriteTexture(scene, f.spriteRef, wPx, hPx, f.spritePixels);
    const renderLevel = normalizePlacedRenderLevel(f.renderLevel);
    const sprite = scene.add
      .sprite(f.x * TILE_SIZE + wPx / 2, f.y * TILE_SIZE + hPx / 2, texKey)
      .setOrigin(0.5, 0.5)
      .setDisplaySize(wPx, hPx)
      .setAngle(rot)
      .setData('renderLevel', renderLevel)
      .setData(
        'sortY',
        rotatedFootprintBottomY(f.x * TILE_SIZE, f.y * TILE_SIZE, wPx, hPx, rot)
      );
    furnitureLayer.add(sprite);
  }

  for (const d of mapDef.placedDecorations ?? []) {
    const size = TILE_SIZE;
    const rot = d.rotation ?? 0;
    const texKey = ensureMapSpriteTexture(scene, d.spriteRef, size, size, d.spritePixels);
    const renderLevel = normalizePlacedRenderLevel(d.renderLevel);
    const sprite = scene.add
      .sprite(d.x * TILE_SIZE + size / 2, d.y * TILE_SIZE + size / 2, texKey)
      .setOrigin(0.5, 0.5)
      .setDisplaySize(size, size)
      .setAngle(rot)
      .setData('renderLevel', renderLevel)
      .setData(
        'sortY',
        rotatedFootprintBottomY(d.x * TILE_SIZE, d.y * TILE_SIZE, size, size, rot)
      );
    furnitureLayer.add(sprite);
  }

  for (const cell of mapDef.collision ?? []) {
    if (!isBlockingCollision(cell.mode)) continue;
    const px = cell.x * TILE_SIZE + TILE_SIZE / 2;
    const py = cell.y * TILE_SIZE + TILE_SIZE / 2;
    const block = collisionLayer.create(px, py, COLLISION_TEXTURE) as Phaser.Physics.Arcade.Sprite;
    block.setVisible(false);
    block.setImmovable(true);
    block.refreshBody();
  }

  return { floorLayer, wallLayer, collisionLayer, furnitureLayer, interactables };
}