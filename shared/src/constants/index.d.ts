import type { MagicTradition, PlayerStats } from '../types/index.js';
export declare const GAME_VERSION = "0.1.0";
export declare const DEFAULT_STATS: PlayerStats;
export declare const STAT_MAX = 100;
export declare const INVENTORY_MAX_SLOTS = 40;
/** Taglock strength multipliers for spell accuracy/potency */
export declare const TAGLOCK_STRENGTH: Record<string, number>;
/** Registered magic systems — add new traditions without rewriting core */
export declare const MAGIC_SYSTEMS: Record<MagicTradition, {
    label: string;
    enabled: boolean;
    description: string;
}>;
export declare const TILE_SIZE = 16;
export declare const PLAYER_SPEED = 80;
export declare const SCENE_TRANSITIONS: Record<string, {
    target: string;
    spawn: string;
}>;
//# sourceMappingURL=index.d.ts.map