/** Aura screen overlay layout — mirrors content/ui/aura-screen-layout.json (1024×576 native). */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AuraScreenLayout {
  baseResolution: { width: number; height: number };
  background: string;
  zones: {
    auraVisualization: Rect;
    auraOverviewValues: Rect;
    auraStatusMessage: Rect;
    closeButton: Rect;
    actionsDock: Rect;
  };
  core: {
    segments: number;
    barX: number;
    barWidth: number;
    barHeight: number;
    valueRight: number;
    rows: Record<
      'health' | 'hunger' | 'stamina' | 'magicalEnergy',
      { valueY: number; barY: number; hitbox: Rect }
    >;
  };
  mental: {
    valueX: number;
    rowHeight: number;
    hitboxWidth: number;
    hitboxX: number;
    rows: Record<string, { y: number }>;
  };
  technical: {
    valueX: number;
    rowHeight: number;
    hitboxWidth: number;
    hitboxX: number;
    rows: Record<string, { y: number }>;
  };
}

export const AURA_SCREEN_LAYOUT: AuraScreenLayout = {
  baseResolution: { width: 1024, height: 576 },
  background: '/assets/ui/aura-screen/aura-screen-static-background.png',
  zones: {
    // Viz region only (ends ~11px above baked legend divider at y≈411).
    auraVisualization: { x: 52, y: 68, width: 392, height: 332 },
    // Upper panel holds Level / Public·Spiritual / compact aura summary (~4 rows).
    // Status panel below shows aura status + recent XP.
    auraOverviewValues: { x: 536, y: 98, width: 432, height: 86 },
    auraStatusMessage: { x: 536, y: 188, width: 432, height: 58 },
    closeButton: { x: 932, y: 14, width: 43, height: 43 },
    actionsDock: { x: 536, y: 252, width: 432, height: 20 },
  },
  core: {
    segments: 12,
    barX: 470,
    barWidth: 140,
    barHeight: 10,
    valueRight: 602,
    rows: {
      health: { valueY: 330, barY: 346, hitbox: { x: 452, y: 316, width: 178, height: 44 } },
      hunger: { valueY: 376, barY: 392, hitbox: { x: 452, y: 362, width: 178, height: 44 } },
      stamina: { valueY: 422, barY: 438, hitbox: { x: 452, y: 408, width: 178, height: 44 } },
      magicalEnergy: { valueY: 468, barY: 484, hitbox: { x: 452, y: 454, width: 178, height: 44 } },
    },
  },
  mental: {
    valueX: 784,
    rowHeight: 24,
    hitboxWidth: 168,
    hitboxX: 632,
    rows: {
      intuition: { y: 342 },
      awareness: { y: 366 },
      willpower: { y: 390 },
      memory: { y: 414 },
      presence: { y: 438 },
      authority: { y: 462 },
      mediumship: { y: 486 },
    },
  },
  technical: {
    valueX: 968,
    rowHeight: 22,
    hitboxWidth: 168,
    hitboxX: 812,
    rows: {
      ritualSkill: { y: 336 },
      protection: { y: 358 },
      hexWork: { y: 380 },
      healing: { y: 402 },
      herbalism: { y: 424 },
      divination: { y: 446 },
      potionMaking: { y: 468 },
      spiritNegotiation: { y: 490 },
    },
  },
};

export function rectStyle(r: Rect): string {
  return `left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px`;
}
