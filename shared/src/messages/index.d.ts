import type { AltarState, InventorySlot, SceneId } from '../types/index.js';
/** Client → Server message types */
export type ClientMessage = {
    type: 'move';
    x: number;
    y: number;
    direction: 'up' | 'down' | 'left' | 'right';
} | {
    type: 'change_scene';
    scene: SceneId;
    spawnId: string;
} | {
    type: 'interact';
    targetId: string;
} | {
    type: 'cast_spell';
    spellId: string;
    targetPlayerId?: string;
    taglockType?: string;
    altarState: AltarState;
} | {
    type: 'altar_update';
    altar: AltarState;
} | {
    type: 'buy_item';
    shopId: string;
    itemId: string;
    quantity: number;
} | {
    type: 'use_item';
    itemId: string;
    quantity: number;
} | {
    type: 'care_familiar';
    action: 'feed' | 'bond' | 'heal' | 'protect';
} | {
    type: 'place_decoration';
    decorationId: string;
    x: number;
    y: number;
    rotation: number;
} | {
    type: 'place_ward';
    wardPointId: string;
    spellId: string;
} | {
    type: 'inspect_aura';
    targetPlayerId: string;
} | {
    type: 'dialogue_choice';
    dialogueTreeId: string;
    nodeId: string;
    choiceIndex: number;
} | {
    type: 'chat';
    message: string;
};
/** Server → Client message types */
export type ServerMessage = {
    type: 'spell_result';
    success: boolean;
    spellId: string;
    message: string;
    effects?: Record<string, unknown>;
} | {
    type: 'shop_result';
    success: boolean;
    message: string;
    inventory?: InventorySlot[];
} | {
    type: 'aura_inspection';
    targetId: string;
    aura: unknown;
    depth: 'surface' | 'deep';
} | {
    type: 'notification';
    message: string;
    level: 'info' | 'warn' | 'success' | 'error';
} | {
    type: 'familiar_update';
    familiar: unknown;
};
export declare const MESSAGE_TYPES: {
    readonly MOVE: "move";
    readonly CHANGE_SCENE: "change_scene";
    readonly INTERACT: "interact";
    readonly CAST_SPELL: "cast_spell";
    readonly ALTAR_UPDATE: "altar_update";
    readonly BUY_ITEM: "buy_item";
    readonly USE_ITEM: "use_item";
    readonly CARE_FAMILIAR: "care_familiar";
    readonly PLACE_DECORATION: "place_decoration";
    readonly PLACE_WARD: "place_ward";
    readonly INSPECT_AURA: "inspect_aura";
    readonly CHAT: "chat";
};
//# sourceMappingURL=index.d.ts.map