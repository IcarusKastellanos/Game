/**
 * NPC overworld visual profiles for procedural 16×24 sheets.
 * Authored sheet overrides (optional) share the same frame contract.
 */

export const NPC_WALK_DIRECTIONS = [
  'down',
  'down-right',
  'right',
  'up-right',
  'up',
  'up-left',
  'left',
  'down-left',
] as const;

export type NpcWalkDirection = (typeof NPC_WALK_DIRECTIONS)[number];

export type NpcBodyBuild = 'slight' | 'average' | 'sturdy' | 'tall';
export type NpcHairStyle = 'bob' | 'short' | 'long' | 'bun' | 'balding' | 'wild' | 'hood';
export type NpcAccessory =
  | 'apron'
  | 'satchel'
  | 'scarf'
  | 'glasses'
  | 'hat'
  | 'vest'
  | 'robe'
  | 'tool_belt'
  | 'crystal_pendant'
  | 'clipboard';

export interface NpcVisualColors {
  skin: number;
  skinShadow: number;
  hair: number;
  shirt: number;
  shirtLight: number;
  pants: number;
  pantsDark: number;
  accent?: number;
}

export interface NpcVisualProfile {
  build: NpcBodyBuild;
  hairStyle: NpcHairStyle;
  colors: NpcVisualColors;
  accessories?: NpcAccessory[];
  /** Default facing when idle at a post. */
  defaultFacing?: NpcWalkDirection;
  idleStyle?: 'breathe' | 'shift' | 'fidget';
}

/** Optional authored override — same grid as procedural sheets. */
export interface NpcAuthoredSpriteSheet {
  frameW: 16;
  frameH: 24;
  walkFrames: number;
  idleFrames: number;
  /** Flattened CSS colors for walk sheet then idle sheet, or a single packed sheet. */
  walkPixels?: string[];
  idlePixels?: string[];
}

/** Sheet keys — npcId already includes the `npc_` prefix (e.g. npc_mara). */
export function npcWalkSheetKey(npcId: string): string {
  return `${npcId}_walk`;
}

export function npcIdleSheetKey(npcId: string): string {
  return `${npcId}_idle`;
}

export function npcPortraitKey(npcId: string): string {
  return `${npcId}_portrait`;
}

/** Legacy key kept for portrait fallbacks / older map posts. */
export function npcLegacySpriteKey(npcId: string): string {
  return npcId;
}

export function npcWalkAnimKey(npcId: string, dir: NpcWalkDirection): string {
  return `${npcWalkSheetKey(npcId)}_${dir}`;
}

export function npcIdleAnimKey(npcId: string, dir: NpcWalkDirection): string {
  return `${npcIdleSheetKey(npcId)}_${dir}`;
}

export function directionFromDelta(
  dx: number,
  dy: number,
  last: NpcWalkDirection = 'down'
): NpcWalkDirection {
  if (dx === 0 && dy === 0) return last;
  const angle = Math.atan2(dy, dx);
  const oct = Math.round(angle / (Math.PI / 4));
  const map: NpcWalkDirection[] = [
    'right',
    'down-right',
    'down',
    'down-left',
    'left',
    'up-left',
    'up',
    'up-right',
  ];
  const idx = ((oct % 8) + 8) % 8;
  return map[idx] ?? last;
}

export function parseNpcWalkDirection(raw: unknown): NpcWalkDirection | undefined {
  return typeof raw === 'string' && (NPC_WALK_DIRECTIONS as readonly string[]).includes(raw)
    ? (raw as NpcWalkDirection)
    : undefined;
}

const BASE = {
  skin: 0xf5c89a,
  skinShadow: 0xd4a574,
  skinDeep: 0xe8b890,
  skinDeepShadow: 0xc49870,
};

/** Designer defaults for the ten shipped NPCs — unique silhouette + palette. */
export const NPC_VISUAL_PROFILES: Record<string, NpcVisualProfile> = {
  npc_mara: {
    build: 'average',
    hairStyle: 'long',
    colors: {
      skin: BASE.skin,
      skinShadow: BASE.skinShadow,
      hair: 0x2a1a12,
      shirt: 0x5a3a7a,
      shirtLight: 0x7a5a9a,
      pants: 0x2a2438,
      pantsDark: 0x1a1428,
      accent: 0xc9a227,
    },
    accessories: ['apron', 'crystal_pendant'],
    defaultFacing: 'down',
    idleStyle: 'breathe',
  },
  npc_tom: {
    build: 'sturdy',
    hairStyle: 'short',
    colors: {
      skin: BASE.skinDeep,
      skinShadow: BASE.skinDeepShadow,
      hair: 0x4a3020,
      shirt: 0x3a6a4a,
      shirtLight: 0x5a8a6a,
      pants: 0x3a3428,
      pantsDark: 0x2a2418,
      accent: 0xb8860b,
    },
    accessories: ['apron', 'satchel'],
    defaultFacing: 'down',
    idleStyle: 'shift',
  },
  npc_elena: {
    build: 'slight',
    hairStyle: 'bun',
    colors: {
      skin: BASE.skin,
      skinShadow: BASE.skinShadow,
      hair: 0x1a1a28,
      shirt: 0xe8eef4,
      shirtLight: 0xffffff,
      pants: 0x3a4a5a,
      pantsDark: 0x2a3a4a,
      accent: 0x4a90c4,
    },
    accessories: ['glasses', 'vest'],
    defaultFacing: 'down',
    idleStyle: 'fidget',
  },
  npc_librarian: {
    build: 'slight',
    hairStyle: 'bun',
    colors: {
      skin: BASE.skin,
      skinShadow: BASE.skinShadow,
      hair: 0x6a5a4a,
      shirt: 0x4a3a5a,
      shirtLight: 0x6a5a7a,
      pants: 0x2a2430,
      pantsDark: 0x1a1420,
      accent: 0xc4a574,
    },
    accessories: ['glasses', 'scarf'],
    defaultFacing: 'down',
    idleStyle: 'breathe',
  },
  npc_cafe_owner: {
    build: 'average',
    hairStyle: 'short',
    colors: {
      skin: BASE.skinDeep,
      skinShadow: BASE.skinDeepShadow,
      hair: 0x1a1210,
      shirt: 0x5a2a2a,
      shirtLight: 0x7a4a4a,
      pants: 0x2a2420,
      pantsDark: 0x1a1410,
      accent: 0xd4a574,
    },
    accessories: ['apron', 'vest'],
    defaultFacing: 'down',
    idleStyle: 'shift',
  },
  npc_circle_leader: {
    build: 'tall',
    hairStyle: 'wild',
    colors: {
      skin: BASE.skin,
      skinShadow: BASE.skinShadow,
      hair: 0x5c4033,
      shirt: 0x3a5a4a,
      shirtLight: 0x5a7a6a,
      pants: 0x2a3a30,
      pantsDark: 0x1a2a20,
      accent: 0x8b6cad,
    },
    accessories: ['robe', 'crystal_pendant'],
    defaultFacing: 'down',
    idleStyle: 'breathe',
  },
  npc_council_clerk: {
    build: 'average',
    hairStyle: 'bob',
    colors: {
      skin: BASE.skin,
      skinShadow: BASE.skinShadow,
      hair: 0x2a2a3a,
      shirt: 0x3a4a6a,
      shirtLight: 0x5a6a8a,
      pants: 0x2a2a38,
      pantsDark: 0x1a1a28,
      accent: 0xc9a227,
    },
    accessories: ['clipboard', 'glasses'],
    defaultFacing: 'down',
    idleStyle: 'fidget',
  },
  npc_temple_healer: {
    build: 'average',
    hairStyle: 'hood',
    colors: {
      skin: BASE.skin,
      skinShadow: BASE.skinShadow,
      hair: 0x3d2314,
      shirt: 0xe8e0d0,
      shirtLight: 0xfff8f0,
      pants: 0xd0c4b0,
      pantsDark: 0xb0a490,
      accent: 0x6b4c8a,
    },
    accessories: ['robe', 'scarf'],
    defaultFacing: 'down',
    idleStyle: 'breathe',
  },
  npc_seal_yard_foreman: {
    build: 'sturdy',
    hairStyle: 'balding',
    colors: {
      skin: BASE.skinDeep,
      skinShadow: BASE.skinDeepShadow,
      hair: 0x3a2a20,
      shirt: 0x5a4a3a,
      shirtLight: 0x7a6a5a,
      pants: 0x2a2a28,
      pantsDark: 0x1a1a18,
      accent: 0x8b6914,
    },
    accessories: ['tool_belt', 'vest'],
    defaultFacing: 'down',
    idleStyle: 'shift',
  },
  npc_psychic_tent_reader: {
    build: 'slight',
    hairStyle: 'long',
    colors: {
      skin: BASE.skin,
      skinShadow: BASE.skinShadow,
      hair: 0x1a0a18,
      shirt: 0x4a1a4a,
      shirtLight: 0x6a3a6a,
      pants: 0x2a1228,
      pantsDark: 0x1a0a18,
      accent: 0xc9a227,
    },
    accessories: ['scarf', 'crystal_pendant', 'hat'],
    defaultFacing: 'down',
    idleStyle: 'fidget',
  },
};

export function resolveNpcVisualProfile(
  npcId: string,
  override?: NpcVisualProfile
): NpcVisualProfile {
  if (override) return override;
  return (
    NPC_VISUAL_PROFILES[npcId] ?? {
      build: 'average',
      hairStyle: 'short',
      colors: {
        skin: BASE.skin,
        skinShadow: BASE.skinShadow,
        hair: 0x3d2314,
        shirt: 0x6b4c8a,
        shirtLight: 0x8b6cad,
        pants: 0x2d4a3e,
        pantsDark: 0x1a2e26,
      },
      defaultFacing: 'down',
      idleStyle: 'breathe',
    }
  );
}
