import type { AltarState, InventorySlot, PentacleCastPayload, SceneId, TaglockSelection } from '../types/index.js';

/** Client → Server message types */
export type ClientMessage =
  | { type: 'move'; x: number; y: number; direction: 'up' | 'down' | 'left' | 'right' }
  | { type: 'change_scene'; scene: SceneId; spawnId: string }
  | { type: 'interact'; targetId: string }
  | { type: 'cast_spell'; spellId: string; targetPlayerId?: string; taglockType?: string; taglockTypes?: string[]; taglocks?: TaglockSelection[]; altarState: AltarState; pentacleSlots?: { itemId: string; quantity: number }[]; augmentSlots?: { itemId: string; quantity: number }[]; hexIntents?: string[]; magicOnly?: boolean; targetSelf?: boolean; timing?: string }
  | { type: 'altar_update'; altar: AltarState }
  | { type: 'buy_item'; shopId: string; itemId: string; quantity: number }
  | { type: 'use_item'; itemId: string; quantity: number }
  | { type: 'care_familiar'; action: 'feed' | 'bond' | 'heal' | 'protect' }
  | { type: 'choose_familiar'; templateId: string; trueName: string; publicName: string }
  | { type: 'collect_taglock'; targetPlayerId: string }
  | { type: 'whisper'; targetPlayerId: string; message: string }
  | { type: 'place_ward'; wardPointId: string; spellId: string }
  | { type: 'inspect_aura'; targetPlayerId: string }
  | { type: 'dialogue_choice'; dialogueTreeId: string; nodeId: string; choiceIndex: number }
  | { type: 'admin_command'; command: string }
  | { type: 'admin_action'; action: string; targetSessionId?: string; args?: string[] }
  | { type: 'chat'; message: string; channel?: 'global' | 'local' | 'whisper'; targetPlayerId?: string; targetDisplayName?: string }
  | { type: 'visit_apartment'; targetSessionId: string }
  | { type: 'leave_apartment' }
  | { type: 'apartment_invite'; friendDbPlayerId: string }
  | { type: 'apartment_invite_response'; inviteId: string; accept: boolean }
  | { type: 'friend_request'; targetUsername: string }
  | { type: 'friend_respond'; fromPlayerId: string; accept: boolean }
  | { type: 'friend_remove'; friendPlayerId: string }
  | { type: 'friends_refresh' }
  | { type: 'feed_ward'; targetKind: 'apartment' | 'aura_ward' | 'protection'; targetId: string }
  | { type: 'trade_request'; targetSessionId: string; friendDbPlayerId?: string }
  | { type: 'trade_offer'; tradeId: string; coins: number; items: { itemId: string; quantity: number }[] }
  | { type: 'trade_accept'; tradeId: string; accepted: boolean }
  | { type: 'trade_cancel'; tradeId: string }
  | { type: 'inventory_reorder'; slots: InventorySlot[] }
  | { type: 'inscribe_taglock'; slotIndex: number; targetName: string }
  | { type: 'choose_specialty'; specialty: string }
  | { type: 'cast_pocket_spell'; pocketId: string; targetPlayerId?: string }
  | { type: 'craft_recipe'; recipeId: string }
  | { type: 'hexagram_enchant'; recipeId: string; sockets: Partial<Record<string, string>>; augmentations: string[]; declaration: string }
  | { type: 'experiment_ingredients'; itemIds: string[] }
  | { type: 'read_book_complete'; bookId: string }
  | { type: 'presence_ready' }
  | {
      type: 'grimoire_write';
      custom?: { title?: string; dedication?: string; ink?: string; showLockedShared?: boolean };
      notes?: string[];
      notesActive?: number;
      spellNote?: { spellId: string; note: string };
      npcNote?: { npcId: string; note: string };
      spiritNote?: { spiritId: string; note: string };
    }
  | { type: 'grimoire_share'; spellId: string; targetSessionId?: string; friendPlayerId?: string }
  | { type: 'grimoire_petition'; spiritId: string }
  | { type: 'grimoire_recall'; spiritId: string };

/** Server → Client message types */
export type ServerMessage =
  | { type: 'spell_result'; success: boolean; spellId: string; message: string; effects?: Record<string, unknown> }
  | {
      type: 'shop_result';
      success: boolean;
      message: string;
      inventory?: InventorySlot[];
      shopId?: string;
      stock?: { itemId: string; stock: number }[];
    }
  | {
      type: 'shop_stock';
      reason: 'noon_restock' | 'sync';
      shops: { shopId: string; inventory: { itemId: string; stock: number }[] }[];
    }
  | { type: 'aura_inspection'; targetId: string; aura: unknown; depth: 'surface' | 'deep' }
  | { type: 'notification'; message: string; level: 'info' | 'warn' | 'success' | 'error' }
  | { type: 'familiar_update'; familiar: unknown }
  | { type: 'chat'; from: string; message: string; channel?: 'global' | 'local' | 'whisper' | 'system'; fromSessionId?: string; targetDisplayName?: string; scene?: string; timestamp?: number }
  | { type: 'player_loaded'; username: string; familiar?: unknown; metPlayers?: unknown[]; isAdmin?: boolean; adminCommands?: string[]; dbPlayerId?: string; wards?: unknown[]; location?: unknown; friends?: unknown[]; friendRequests?: unknown[]; friendPresence?: unknown[] }
  | { type: 'friends_update'; friends: unknown[]; friendRequests: unknown[]; friendPresence: unknown[] }
  | { type: 'apartment_invite_received'; inviteId: string; hostName: string; hostDbPlayerId: string }
  | { type: 'apartment_invite_result'; success: boolean; message: string }
  | { type: 'apartment_visit'; hostSessionId: string; hostName: string; wards: unknown[] }
  | { type: 'apartment_left'; wards: unknown[] }
  | { type: 'trade_invite'; tradeId: string; fromName: string; fromSessionId: string }
  | { type: 'trade_state'; tradeId: string; partnerName: string; partnerSessionId: string; yourOffer: { coins: number; items: { itemId: string; quantity: number }[] }; theirOffer: { coins: number; items: { itemId: string; quantity: number }[] }; youAccepted: boolean; theyAccepted: boolean }
  | { type: 'trade_complete'; message: string }
  | { type: 'trade_cancelled'; message: string }
  | { type: 'content_maps_update'; maps: unknown[]; revision: number }
  | { type: 'hexagram_result'; success: boolean; message: string; unstable?: boolean; preview?: unknown }
  | { type: 'pocket_spell_result'; success: boolean; message: string; spellId?: string; blocked?: boolean; partial?: boolean; backlash?: boolean; detected?: boolean; potency?: number; detail?: string; fromName?: string };

export const MESSAGE_TYPES = {
  MOVE: 'move',
  CHANGE_SCENE: 'change_scene',
  INTERACT: 'interact',
  CAST_SPELL: 'cast_spell',
  ALTAR_UPDATE: 'altar_update',
  BUY_ITEM: 'buy_item',
  USE_ITEM: 'use_item',
  CARE_FAMILIAR: 'care_familiar',
  CHOOSE_FAMILIAR: 'choose_familiar',
  COLLECT_TAGLOCK: 'collect_taglock',
  WHISPER: 'whisper',
  PLACE_WARD: 'place_ward',
  INSPECT_AURA: 'inspect_aura',
  CHAT: 'chat',
} as const;
