import Phaser from 'phaser';
import {
  TILE_SIZE,
  NPC_WALK_DIRECTIONS,
  NPC_IDLE_FRAMES_PER_DIR,
  NPC_SHEET_FRAME_H,
  NPC_SHEET_FRAME_W,
  NPC_WALK_FRAMES_PER_DIR,
  isTransparentPixel,
  normalizeNpcAuthoredSpriteSheet,
  npcIdleAnimKey,
  npcIdleSheetKey,
  npcLegacySpriteKey,
  npcPortraitKey,
  npcWalkAnimKey,
  npcWalkSheetKey,
  resolveNpcVisualProfile,
  type NpcAccessory,
  type NpcAuthoredSpriteSheet,
  type NpcVisualProfile,
  type NpcWalkDirection,
} from '@witchcraft/shared';
import { ensureMapSpriteTexture } from './MapSpriteTextures';

const NPC_IDLE_FRAMES = NPC_IDLE_FRAMES_PER_DIR;
const FRAME_W = NPC_SHEET_FRAME_W;
const FRAME_H = NPC_SHEET_FRAME_H;
const FRAMES_PER_DIR = NPC_WALK_FRAMES_PER_DIR;

/** Stardew-inspired palette */
const PAL = {
  skin: 0xf5c89a,
  skinShadow: 0xd4a574,
  hair: 0x3d2314,
  shirt: 0x6b4c8a,
  shirtLight: 0x8b6cad,
  pants: 0x2d4a3e,
  pantsDark: 0x1a2e26,
  outline: 0x1a1018,
  grass: 0x5a9e4b,
  grassDark: 0x3d7a35,
  grassLight: 0x7bc96f,
  wood: 0x8b6914,
  woodDark: 0x5c4510,
  woodLight: 0xb8923a,
  path: 0xc4a574,
  brick: 0x8b5a3c,
  brickDark: 0x6b3a24,
  water: 0x4a90c4,
};

/** 8 directions: down, down-right, right, up-right, up, up-left, left, down-left */
const DIRECTIONS = ['down', 'down-right', 'right', 'up-right', 'up', 'up-left', 'left', 'down-left'] as const;

export type WalkDirection = (typeof DIRECTIONS)[number];

/** Combined tile spritesheet key — frames match individual tile_* names */
export const TILES_ATLAS = 'tiles_atlas';

type TileDraw = (g: Phaser.GameObjects.Graphics, ox?: number, oy?: number) => void;

const TILE_DEFS: { key: string; draw: TileDraw }[] = [
  {
    key: 'tile_grass',
    draw: (g, ox = 0, oy = 0) => {
      g.fillStyle(PAL.grass, 1);
      g.fillRect(ox, oy, TILE_SIZE, TILE_SIZE);
      g.fillStyle(PAL.grassLight, 0.4);
      g.fillRect(ox + 2, oy + 2, 3, 3);
      g.fillRect(ox + 10, oy + 8, 2, 2);
      g.fillStyle(PAL.grassDark, 0.5);
      g.fillRect(ox + 12, oy + 12, 3, 3);
    },
  },
  {
    key: 'tile_path',
    draw: (g, ox = 0, oy = 0) => {
      g.fillStyle(PAL.path, 1);
      g.fillRect(ox, oy, TILE_SIZE, TILE_SIZE);
      g.fillStyle(0x000000, 0.08);
      for (let i = 0; i < 4; i++) g.fillRect(ox + i * 4, oy + (i * 3) % 12, 2, 2);
    },
  },
  {
    key: 'tile_floor_wood',
    draw: (g, ox = 0, oy = 0) => {
      g.fillStyle(PAL.wood, 1);
      g.fillRect(ox, oy, TILE_SIZE, TILE_SIZE);
      g.lineStyle(1, PAL.woodDark, 0.5);
      g.lineBetween(ox, oy + 8, ox + TILE_SIZE, oy + 8);
    },
  },
  {
    key: 'tile_floor_stone',
    draw: (g, ox = 0, oy = 0) => {
      g.fillStyle(0x888899, 1);
      g.fillRect(ox, oy, TILE_SIZE, TILE_SIZE);
      g.fillStyle(0x666677, 0.5);
      g.fillRect(ox + 1, oy + 1, 6, 6);
      g.fillRect(ox + 9, oy + 9, 6, 6);
    },
  },
  {
    key: 'tile_wall_brick',
    draw: (g, ox = 0, oy = 0) => {
      g.fillStyle(PAL.brick, 1);
      g.fillRect(ox, oy, TILE_SIZE, TILE_SIZE);
      g.fillStyle(PAL.brickDark, 0.6);
      g.fillRect(ox, oy + 7, TILE_SIZE, 2);
      g.fillRect(ox + 7, oy, 2, 7);
    },
  },
  {
    key: 'tile_fence',
    draw: (g, ox = 0, oy = 0) => {
      g.fillStyle(PAL.grassDark, 0.3);
      g.fillRect(ox, oy, TILE_SIZE, TILE_SIZE);
      g.fillStyle(PAL.woodDark, 1);
      g.fillRect(ox + 2, oy + 4, 3, 10);
      g.fillRect(ox + 11, oy + 4, 3, 10);
      g.fillRect(ox, oy + 6, TILE_SIZE, 2);
      g.fillRect(ox, oy + 12, TILE_SIZE, 2);
    },
  },
];

/** Generate Stardew-style tiles and 8-direction walk spritesheets */
export function generateStardewAssets(scene: Phaser.Scene): void {
  generateTileSpritesheet(scene);
  generatePlayerSheet(scene, 'player_walk', PAL.shirt, PAL.hair);
  generatePlayerSheet(scene, 'player_other_walk', 0x6a8a7a, 0x2a3a2a);
  generateObjects(scene);
}

function generateTileSpritesheet(scene: Phaser.Scene): void {
  const sheetW = TILE_DEFS.length * TILE_SIZE;
  const g = scene.make.graphics({ x: 0, y: 0 });
  TILE_DEFS.forEach((def, index) => {
    def.draw(g, index * TILE_SIZE, 0);
  });
  g.generateTexture(TILES_ATLAS, sheetW, TILE_SIZE);
  g.destroy();

  const tex = scene.textures.get(TILES_ATLAS);
  TILE_DEFS.forEach((def, index) => {
    tex.add(def.key, 0, index * TILE_SIZE, 0, TILE_SIZE, TILE_SIZE);
  });
}

function drawTile(scene: Phaser.Scene, key: string, draw: TileDraw): void {
  const g = scene.make.graphics({ x: 0, y: 0 });
  draw(g);
  g.generateTexture(key, TILE_SIZE, TILE_SIZE);
  g.destroy();
}

function generatePlayerSheet(scene: Phaser.Scene, key: string, shirtColor: number, hairColor: number): void {
  const cols = FRAMES_PER_DIR;
  const rows = DIRECTIONS.length;
  const w = cols * FRAME_W;
  const h = rows * FRAME_H;
  const g = scene.make.graphics({ x: 0, y: 0 });

  DIRECTIONS.forEach((dir, row) => {
    for (let frame = 0; frame < FRAMES_PER_DIR; frame++) {
      const ox = frame * FRAME_W;
      const oy = row * FRAME_H;
      drawCharacter(g, ox, oy, dir, frame, shirtColor, hairColor);
    }
  });

  g.generateTexture(key, w, h);
  g.destroy();

  // Slice spritesheet into frames for Phaser animations
  const tex = scene.textures.get(key);
  tex.remove('__BASE');
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      tex.add(row * cols + col, 0, col * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H);
    }
  }

  // Register walk animations
  DIRECTIONS.forEach((dir, row) => {
    const frames = Array.from({ length: FRAMES_PER_DIR }, (_, i) => ({ key, frame: row * cols + i }));
    scene.anims.create({
      key: `${key}_${dir}`,
      frames,
      frameRate: 8,
      repeat: -1,
    });
  });
}

function drawCharacter(
  g: Phaser.GameObjects.Graphics,
  ox: number,
  oy: number,
  dir: WalkDirection,
  frame: number,
  shirt: number,
  hair: number
): void {
  const bob = frame % 2 === 1 ? 1 : 0;
  const cx = ox + FRAME_W / 2;
  const baseY = oy + FRAME_H - 4 + bob;

  // Shadow
  g.fillStyle(0x000000, 0.25);
  g.fillEllipse(cx, baseY + 2, 10, 3);

  // Legs animation offset
  const legOff = frame === 1 ? 1 : frame === 3 ? -1 : 0;

  // Pants
  g.fillStyle(PAL.pants, 1);
  g.fillRect(cx - 4, baseY - 6, 3, 6 + (legOff > 0 ? 1 : 0));
  g.fillRect(cx + 1, baseY - 6, 3, 6 + (legOff < 0 ? 1 : 0));
  g.fillStyle(PAL.pantsDark, 1);
  g.fillRect(cx - 4, baseY - 2, 3, 2);
  g.fillRect(cx + 1, baseY - 2, 3, 2);

  // Body / shirt
  g.fillStyle(shirt, 1);
  g.fillRect(cx - 5, baseY - 14, 10, 9);
  g.fillStyle(shirt === PAL.shirt ? PAL.shirtLight : 0x8aaa9a, 1);
  if (dir.includes('left') || dir === 'left') g.fillRect(cx - 5, baseY - 13, 2, 7);
  if (dir.includes('right') || dir === 'right') g.fillRect(cx + 3, baseY - 13, 2, 7);

  // Arms
  g.fillStyle(PAL.skin, 1);
  const armSwing = frame === 1 ? 1 : frame === 3 ? -1 : 0;
  g.fillRect(cx - 7, baseY - 12 + armSwing, 2, 5);
  g.fillRect(cx + 5, baseY - 12 - armSwing, 2, 5);

  // Head
  g.fillStyle(PAL.skin, 1);
  g.fillRect(cx - 4, baseY - 20, 8, 7);
  g.fillStyle(PAL.skinShadow, 0.5);
  if (dir === 'down' || dir.includes('down')) g.fillRect(cx - 2, baseY - 14, 4, 2);

  // Hair
  g.fillStyle(hair, 1);
  g.fillRect(cx - 5, baseY - 22, 10, 4);
  if (dir.includes('up') || dir === 'up') {
    g.fillRect(cx - 5, baseY - 21, 10, 6);
  } else if (dir.includes('left') || dir === 'left') {
    g.fillRect(cx - 6, baseY - 21, 4, 8);
  } else if (dir.includes('right') || dir === 'right') {
    g.fillRect(cx + 2, baseY - 21, 4, 8);
  }

  // Eyes (direction hint)
  g.fillStyle(PAL.outline, 1);
  if (dir === 'down' || dir.includes('down')) {
    g.fillRect(cx - 3, baseY - 18, 2, 2);
    g.fillRect(cx + 1, baseY - 18, 2, 2);
  } else if (dir === 'up' || dir.includes('up')) {
    // back of head — no eyes
  } else if (dir.includes('left') || dir === 'left') {
    g.fillRect(cx - 4, baseY - 18, 2, 2);
  } else if (dir.includes('right') || dir === 'right') {
    g.fillRect(cx + 2, baseY - 18, 2, 2);
  }
}

function generateObjects(scene: Phaser.Scene): void {
  const objs: { key: string; draw: (g: Phaser.GameObjects.Graphics) => void }[] = [
    {
      key: 'obj_altar',
      draw: (g) => {
        g.fillStyle(PAL.woodDark, 1);
        g.fillRect(2, 8, 12, 6);
        g.fillStyle(0x4a0080, 1);
        g.fillRect(4, 4, 8, 4);
        g.fillStyle(0xffdd88, 0.8);
        g.fillRect(6, 2, 4, 3);
      },
    },
    {
      key: 'obj_door',
      draw: (g) => {
        g.fillStyle(PAL.wood, 1);
        g.fillRect(3, 2, 10, 12);
        g.fillStyle(PAL.woodDark, 1);
        g.fillRect(3, 2, 10, 2);
        g.fillStyle(0xffcc44, 1);
        g.fillCircle(11, 8, 1);
      },
    },
    {
      key: 'obj_tree',
      draw: (g) => {
        g.fillStyle(PAL.woodDark, 1);
        g.fillRect(6, 10, 4, 6);
        g.fillStyle(PAL.grassDark, 1);
        g.fillCircle(8, 6, 7);
        g.fillStyle(PAL.grass, 1);
        g.fillCircle(7, 5, 5);
      },
    },
    {
      key: 'obj_shop',
      draw: (g) => {
        g.fillStyle(PAL.brick, 1);
        g.fillRect(1, 4, 14, 11);
        g.fillStyle(0x884422, 1);
        g.fillRect(3, 8, 10, 6);
        g.fillStyle(0xffeecc, 1);
        g.fillRect(5, 2, 6, 3);
      },
    },
    {
      key: 'obj_shelf',
      draw: (g) => {
        g.fillStyle(PAL.wood, 1);
        g.fillRect(2, 4, 12, 10);
        g.lineStyle(1, PAL.woodDark, 1);
        g.lineBetween(2, 8, 14, 8);
      },
    },
    {
      key: 'obj_bed',
      draw: (g) => {
        g.fillStyle(PAL.wood, 1);
        g.fillRect(1, 6, 14, 8);
        g.fillStyle(0x6b4c8a, 1);
        g.fillRect(2, 3, 12, 5);
      },
    },
    {
      key: 'obj_red_bed',
      draw: (g) => {
        g.fillStyle(PAL.wood, 1);
        g.fillRect(1, 6, 14, 8);
        g.fillStyle(0xcc3333, 1);
        g.fillRect(2, 3, 12, 5);
      },
    },
  ];

  for (const { key, draw } of objs) {
    const g = scene.make.graphics({ x: 0, y: 0 });
    draw(g);
    g.generateTexture(key, TILE_SIZE, TILE_SIZE);
    g.destroy();
  }

  drawTile(scene, 'interact_highlight', (g) => {
    g.fillStyle(0xffff00, 0.35);
    g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    g.lineStyle(1, 0xffcc00, 0.8);
    g.strokeRect(1, 1, TILE_SIZE - 2, TILE_SIZE - 2);
  });
}

/** Map movement vector to nearest 8-direction animation key */
export function directionFromVelocity(vx: number, vy: number, last: WalkDirection): WalkDirection {
  if (vx === 0 && vy === 0) return last;
  const angle = Math.atan2(vy, vx);
  const oct = Math.round(angle / (Math.PI / 4));
  const map: WalkDirection[] = ['right', 'down-right', 'down', 'down-left', 'left', 'up-left', 'up', 'up-right'];
  const idx = ((oct % 8) + 8) % 8;
  return map[idx] ?? last;
}

export function animKeyForDirection(sheetKey: string, dir: WalkDirection): string {
  return `${sheetKey}_${dir}`;
}

function registerNpcPixelTexture(scene: Phaser.Scene, key: string, pixels: string[]): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  ensureMapSpriteTexture(scene, key, TILE_SIZE, TILE_SIZE, pixels);
}

function sliceSheet(
  scene: Phaser.Scene,
  key: string,
  cols: number,
  rows: number,
  frameW: number,
  frameH: number
): void {
  const tex = scene.textures.get(key);
  tex.remove('__BASE');
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      tex.add(row * cols + col, 0, col * frameW, row * frameH, frameW, frameH);
    }
  }
}

function drawNpcCharacter(
  g: Phaser.GameObjects.Graphics,
  ox: number,
  oy: number,
  dir: NpcWalkDirection,
  frame: number,
  profile: NpcVisualProfile,
  mode: 'walk' | 'idle'
): void {
  const c = profile.colors;
  const buildPad = profile.build === 'sturdy' ? 1 : profile.build === 'slight' ? -1 : 0;
  const tall = profile.build === 'tall' ? 1 : 0;
  const bob =
    mode === 'walk'
      ? frame % 2 === 1
        ? 1
        : 0
      : profile.idleStyle === 'breathe'
        ? frame === 1
          ? 1
          : 0
        : profile.idleStyle === 'shift'
          ? frame === 1
            ? 1
            : 0
          : frame === 1
            ? 1
            : 0;
  const cx = ox + FRAME_W / 2;
  const baseY = oy + FRAME_H - 4 + bob;

  g.fillStyle(0x000000, 0.25);
  g.fillEllipse(cx, baseY + 2, 10 + buildPad, 3);

  const legOff = mode === 'walk' ? (frame === 1 ? 1 : frame === 3 ? -1 : 0) : 0;
  g.fillStyle(c.pants, 1);
  g.fillRect(cx - 4 - buildPad, baseY - 6 - tall, 3 + buildPad, 6 + (legOff > 0 ? 1 : 0) + tall);
  g.fillRect(cx + 1, baseY - 6 - tall, 3 + buildPad, 6 + (legOff < 0 ? 1 : 0) + tall);
  g.fillStyle(c.pantsDark, 1);
  g.fillRect(cx - 4 - buildPad, baseY - 2, 3 + buildPad, 2);
  g.fillRect(cx + 1, baseY - 2, 3 + buildPad, 2);

  g.fillStyle(c.shirt, 1);
  g.fillRect(cx - 5 - buildPad, baseY - 14 - tall, 10 + buildPad * 2, 9 + tall);
  g.fillStyle(c.shirtLight, 1);
  if (dir.includes('left') || dir === 'left') g.fillRect(cx - 5 - buildPad, baseY - 13 - tall, 2, 7);
  if (dir.includes('right') || dir === 'right') g.fillRect(cx + 3, baseY - 13 - tall, 2, 7);

  const accessories = profile.accessories ?? [];
  drawNpcAccessories(g, cx, baseY, dir, accessories, c.accent ?? c.shirtLight, 'body');

  g.fillStyle(c.skin, 1);
  const armSwing = mode === 'walk' ? (frame === 1 ? 1 : frame === 3 ? -1 : 0) : frame === 1 ? 1 : 0;
  const fidget = mode === 'idle' && profile.idleStyle === 'fidget' && frame === 1 ? 1 : 0;
  g.fillRect(cx - 7 - buildPad, baseY - 12 + armSwing - tall, 2, 5);
  g.fillRect(cx + 5 + buildPad, baseY - 12 - armSwing + fidget - tall, 2, 5);

  g.fillStyle(c.skin, 1);
  g.fillRect(cx - 4, baseY - 20 - tall, 8, 7);
  g.fillStyle(c.skinShadow, 0.5);
  if (dir === 'down' || dir.includes('down')) g.fillRect(cx - 2, baseY - 14 - tall, 4, 2);

  drawNpcHair(g, cx, baseY - tall, dir, profile);
  drawNpcAccessories(g, cx, baseY - tall, dir, accessories, c.accent ?? c.shirtLight, 'head');

  g.fillStyle(PAL.outline, 1);
  if (dir === 'down' || dir.includes('down')) {
    g.fillRect(cx - 3, baseY - 18 - tall, 2, 2);
    g.fillRect(cx + 1, baseY - 18 - tall, 2, 2);
  } else if (dir.includes('left') || dir === 'left') {
    g.fillRect(cx - 4, baseY - 18 - tall, 2, 2);
  } else if (dir.includes('right') || dir === 'right') {
    g.fillRect(cx + 2, baseY - 18 - tall, 2, 2);
  }
}

function drawNpcHair(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  baseY: number,
  dir: NpcWalkDirection,
  profile: NpcVisualProfile
): void {
  const hair = profile.colors.hair;
  g.fillStyle(hair, 1);
  const style = profile.hairStyle;
  if (style === 'balding') {
    g.fillRect(cx - 4, baseY - 22, 8, 2);
    g.fillRect(cx - 5, baseY - 21, 2, 3);
    g.fillRect(cx + 3, baseY - 21, 2, 3);
    return;
  }
  if (style === 'hood') {
    g.fillStyle(profile.colors.shirt, 1);
    g.fillRect(cx - 6, baseY - 23, 12, 8);
    g.fillStyle(hair, 1);
    g.fillRect(cx - 3, baseY - 20, 6, 3);
    return;
  }
  g.fillRect(cx - 5, baseY - 22, 10, 4);
  if (style === 'bun') {
    g.fillRect(cx - 2, baseY - 24, 4, 3);
  }
  if (style === 'long' || style === 'wild') {
    if (dir.includes('up') || dir === 'up') g.fillRect(cx - 5, baseY - 21, 10, 8);
    else if (dir.includes('left') || dir === 'left') g.fillRect(cx - 7, baseY - 21, 5, 10);
    else if (dir.includes('right') || dir === 'right') g.fillRect(cx + 2, baseY - 21, 5, 10);
    else g.fillRect(cx - 5, baseY - 16, 3, 5), g.fillRect(cx + 2, baseY - 16, 3, 5);
  } else if (dir.includes('up') || dir === 'up') {
    g.fillRect(cx - 5, baseY - 21, 10, 6);
  } else if (dir.includes('left') || dir === 'left') {
    g.fillRect(cx - 6, baseY - 21, 4, 8);
  } else if (dir.includes('right') || dir === 'right') {
    g.fillRect(cx + 2, baseY - 21, 4, 8);
  }
  if (style === 'wild') {
    g.fillRect(cx - 6, baseY - 23, 2, 2);
    g.fillRect(cx + 4, baseY - 23, 2, 2);
  }
}

function drawNpcAccessories(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  baseY: number,
  dir: NpcWalkDirection,
  accessories: NpcAccessory[],
  accent: number,
  layer: 'body' | 'head'
): void {
  for (const item of accessories) {
    if (layer === 'body') {
      if (item === 'apron') {
        g.fillStyle(0xe8e0d0, 1);
        g.fillRect(cx - 4, baseY - 12, 8, 7);
      }
      if (item === 'vest') {
        g.fillStyle(accent, 1);
        g.fillRect(cx - 5, baseY - 14, 2, 8);
        g.fillRect(cx + 3, baseY - 14, 2, 8);
      }
      if (item === 'robe') {
        g.fillStyle(accent, 0.85);
        g.fillRect(cx - 6, baseY - 14, 12, 10);
      }
      if (item === 'tool_belt') {
        g.fillStyle(0x5c4510, 1);
        g.fillRect(cx - 5, baseY - 7, 10, 2);
        g.fillStyle(accent, 1);
        g.fillRect(cx + 2, baseY - 8, 3, 3);
      }
      if (item === 'satchel' && (dir.includes('left') || dir === 'left' || dir === 'down' || dir.includes('down'))) {
        g.fillStyle(0x5c4510, 1);
        g.fillRect(cx + 4, baseY - 11, 3, 4);
      }
      if (item === 'clipboard' && (dir === 'down' || dir.includes('down') || dir.includes('right'))) {
        g.fillStyle(0xe8eef4, 1);
        g.fillRect(cx + 4, baseY - 13, 3, 5);
      }
      if (item === 'crystal_pendant' && (dir === 'down' || dir.includes('down'))) {
        g.fillStyle(accent, 1);
        g.fillRect(cx - 1, baseY - 11, 2, 2);
      }
    } else {
      if (item === 'glasses' && (dir === 'down' || dir.includes('down') || dir.includes('left') || dir.includes('right'))) {
        g.fillStyle(0x88aacc, 0.9);
        g.fillRect(cx - 4, baseY - 18, 3, 2);
        g.fillRect(cx + 1, baseY - 18, 3, 2);
      }
      if (item === 'scarf') {
        g.fillStyle(accent, 1);
        g.fillRect(cx - 5, baseY - 15, 10, 2);
        if (dir === 'down' || dir.includes('down')) g.fillRect(cx - 1, baseY - 13, 2, 4);
      }
      if (item === 'hat') {
        g.fillStyle(accent, 1);
        g.fillRect(cx - 6, baseY - 23, 12, 3);
        g.fillRect(cx - 4, baseY - 25, 8, 2);
      }
    }
  }
}

function generateNpcDirectionalSheet(
  scene: Phaser.Scene,
  key: string,
  profile: NpcVisualProfile,
  mode: 'walk' | 'idle',
  framesPerDir: number
): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const cols = framesPerDir;
  const rows = NPC_WALK_DIRECTIONS.length;
  const w = cols * FRAME_W;
  const h = rows * FRAME_H;
  const g = scene.make.graphics({ x: 0, y: 0 });
  NPC_WALK_DIRECTIONS.forEach((dir, row) => {
    for (let frame = 0; frame < framesPerDir; frame++) {
      drawNpcCharacter(g, frame * FRAME_W, row * FRAME_H, dir, frame, profile, mode);
    }
  });
  g.generateTexture(key, w, h);
  g.destroy();
  sliceSheet(scene, key, cols, rows, FRAME_W, FRAME_H);

  NPC_WALK_DIRECTIONS.forEach((dir, row) => {
    const frames = Array.from({ length: framesPerDir }, (_, i) => ({ key, frame: row * cols + i }));
    const animKey = mode === 'walk' ? `${key}_${dir}` : `${key}_${dir}`;
    if (scene.anims.exists(animKey)) scene.anims.remove(animKey);
    scene.anims.create({
      key: animKey,
      frames,
      frameRate: mode === 'walk' ? 8 : 2,
      repeat: -1,
    });
  });
}

function generateNpcPortrait(
  scene: Phaser.Scene,
  npc: { id: string; spritePixels?: string[] },
  profile: NpcVisualProfile
): void {
  const portrait = npcPortraitKey(npc.id);
  const legacy = npcLegacySpriteKey(npc.id);
  if (npc.spritePixels?.length === 256) {
    registerNpcPixelTexture(scene, portrait, npc.spritePixels);
    registerNpcPixelTexture(scene, legacy, npc.spritePixels);
    return;
  }
  if (scene.textures.exists(portrait)) return;
  const g = scene.make.graphics({ x: 0, y: 0 });
  const c = profile.colors;
  g.fillStyle(PAL.outline, 0.35);
  g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  g.fillStyle(c.skin, 1);
  g.fillRect(5, 3, 6, 5);
  g.fillStyle(c.hair, 1);
  g.fillRect(4, 2, 8, 3);
  if (profile.hairStyle === 'long' || profile.hairStyle === 'wild') {
    g.fillRect(3, 3, 2, 5);
    g.fillRect(11, 3, 2, 5);
  }
  g.fillStyle(c.shirt, 1);
  g.fillRect(4, 8, 8, 6);
  g.fillStyle(PAL.outline, 1);
  g.fillRect(6, 5, 1, 1);
  g.fillRect(9, 5, 1, 1);
  if (profile.accessories?.includes('glasses')) {
    g.fillStyle(0x88aacc, 0.9);
    g.fillRect(5, 5, 2, 1);
    g.fillRect(9, 5, 2, 1);
  }
  g.fillStyle(c.accent ?? 0xffeedd, 1);
  g.fillRect(5, 14, 6, 1);
  g.generateTexture(portrait, TILE_SIZE, TILE_SIZE);
  // Duplicate for any leftover legacy lookups.
  if (scene.textures.exists(legacy)) scene.textures.remove(legacy);
  g.generateTexture(legacy, TILE_SIZE, TILE_SIZE);
  g.destroy();
}

/** Register a flat authored atlas under a stable key and create per-direction animations. */
function registerAuthoredNpcSheet(
  scene: Phaser.Scene,
  key: string,
  pixels: string[],
  framesPerDir: number,
  mode: 'walk' | 'idle'
): boolean {
  const cols = framesPerDir;
  const rows = NPC_WALK_DIRECTIONS.length;
  const w = cols * FRAME_W;
  const h = rows * FRAME_H;
  if (pixels.length !== w * h) return false;

  if (scene.textures.exists(key)) scene.textures.remove(key);
  const canvas = scene.textures.createCanvas(key, w, h);
  if (!canvas) return false;
  const ctx = canvas.getContext();
  ctx.clearRect(0, 0, w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const color = pixels[y * w + x];
      if (isTransparentPixel(color)) continue;
      ctx.fillStyle = color!;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  canvas.refresh();
  sliceSheet(scene, key, cols, rows, FRAME_W, FRAME_H);

  NPC_WALK_DIRECTIONS.forEach((dir, row) => {
    const frames = Array.from({ length: framesPerDir }, (_, i) => ({ key, frame: row * cols + i }));
    const animKey = `${key}_${dir}`;
    if (scene.anims.exists(animKey)) scene.anims.remove(animKey);
    scene.anims.create({
      key: animKey,
      frames,
      frameRate: mode === 'walk' ? 8 : 2,
      repeat: -1,
    });
  });
  return true;
}

function applyAuthoredOrProceduralSheets(
  scene: Phaser.Scene,
  npcId: string,
  profile: NpcVisualProfile,
  sheet: NpcAuthoredSpriteSheet | undefined
): void {
  const walkKey = npcWalkSheetKey(npcId);
  const idleKey = npcIdleSheetKey(npcId);
  const authored = normalizeNpcAuthoredSpriteSheet(sheet);

  const walkAuthored =
    !!authored?.walkPixels &&
    registerAuthoredNpcSheet(
      scene,
      walkKey,
      authored.walkPixels,
      authored.walkFrames || FRAMES_PER_DIR,
      'walk'
    );
  if (!walkAuthored) {
    generateNpcDirectionalSheet(scene, walkKey, profile, 'walk', FRAMES_PER_DIR);
  }

  const idleAuthored =
    !!authored?.idlePixels &&
    registerAuthoredNpcSheet(
      scene,
      idleKey,
      authored.idlePixels,
      authored.idleFrames || NPC_IDLE_FRAMES,
      'idle'
    );
  if (!idleAuthored) {
    generateNpcDirectionalSheet(scene, idleKey, profile, 'idle', NPC_IDLE_FRAMES);
  }
}

/**
 * Portraits (16×16) + 8-dir walk/idle overworld sheets (16×24).
 * Authored spritePixels remain portraits only; spriteSheet overrides walk/idle.
 */
export function generateNpcSprites(
  scene: Phaser.Scene,
  npcs: {
    id: string;
    name: string;
    spritePixels?: string[];
    visual?: NpcVisualProfile;
    spriteSheet?: NpcAuthoredSpriteSheet;
  }[]
): void {
  for (const npc of npcs) {
    const profile = resolveNpcVisualProfile(npc.id, npc.visual);
    generateNpcPortrait(scene, npc, profile);
    applyAuthoredOrProceduralSheets(scene, npc.id, profile, npc.spriteSheet);

    void npcWalkAnimKey(npc.id, 'down');
    void npcIdleAnimKey(npc.id, 'down');
  }
}

export function npcFacingFromPresence(presence: {
  facing?: string;
  moving?: boolean;
  from?: { x: number; y: number };
  to?: { x: number; y: number };
}): NpcWalkDirection {
  if (presence.facing && (NPC_WALK_DIRECTIONS as readonly string[]).includes(presence.facing)) {
    return presence.facing as NpcWalkDirection;
  }
  if (presence.moving && presence.from && presence.to) {
    return directionFromVelocity(
      presence.to.x - presence.from.x,
      presence.to.y - presence.from.y,
      'down'
    ) as NpcWalkDirection;
  }
  return 'down';
}
