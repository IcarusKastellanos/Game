import type { GrimoireEntryMap, LicensesDocument, NpcPublicPresence, PlayerProgression, RecognitionDocument } from '@witchcraft/shared';
import {
  ContentMapDefinition,
  ContentSpell,
  FamiliarState,
  FriendEntry,
  FriendPresence,
  FriendRequest,
  InventorySlot,
  MetPlayer,
  PlayerLocation,
  WardState,
  setLicensesContent,
  setRecognitionContent,
} from '@witchcraft/shared';
import { verifyItemIconsOncePerLogin } from '../assets/ItemIconAssetStore';

export interface DialogueNode {
  id: string;
  text: string;
  choices: {
    label: string;
    next: string;
    requiresRecognition?: string;
    requiresLicense?: string;
    requiresAnyLicense?: string[];
    chargeCoins?: number;
    grantLicense?: string;
    acceptVow?: string;
    requiresExamEligibility?: string;
  }[];
  requiresRecognition?: string;
  requiresLicense?: string;
  requiresAnyLicense?: string[];
}

export interface DialogueTree {
  id: string;
  npcId: string;
  nodes: DialogueNode[];
}

/** Global client-side game state cache */
export interface ClientContentBundle {
  spells: ContentSpell[];
  maps: ContentMapDefinition[];
  ingredients: { id: string; name: string; category: string; iconPixels?: string[] }[];
  familiars?: { id: string; species: string; description: string; defaultPublicName: string }[];
  shops: { id: string; name: string; npcId?: string; inventory: { itemId: string; price: number; stock: number; minLevel?: number }[] }[];
  npcs: {
    id: string;
    name: string;
    role?: string;
    biography?: string;
    dialogueTreeId: string;
    spritePixels?: string[];
    shopId?: string;
    locationId?: string;
  }[];
  decorations: { id: string; name: string; category: string }[];
  dialogues?: DialogueTree[];
  recognitionTiers?: RecognitionDocument;
  licenses?: LicensesDocument;
  spirits?: { id: string; name: string; description?: string; domains?: string[]; requiresLicense?: string }[];
  grimoireEntries?: GrimoireEntryMap;
  grimoireEntryNames?: Partial<GrimoireEntryMap>;
}

export interface LocalPlayerState {
  sessionId: string;
  displayName: string;
  inventory: InventorySlot[];
  coins: number;
  statsJson: string;
  altarJson: string;
  auraJson: string;
  familiarId: string;
}

export interface NearbyPlayer {
  sessionId: string;
  displayName: string;
}

class GameState {
  content: ClientContentBundle | null = null;
  localPlayer: LocalPlayerState | null = null;
  username = '';
  displayName = '';
  currentScene: 'apartment' | 'town' = 'apartment';
  activeUI: 'none' | 'altar' | 'hexagram' | 'inventory' | 'shop' | 'aura' | 'familiar' | 'dialogue' | 'npc_actions' | 'npc_gift' | 'ledger' = 'none';
  activeShopId: string | null = null;
  lastSpellResult: string | null = null;
  nearbyPlayers: NearbyPlayer[] = [];
  metPlayers: MetPlayer[] = [];
  selectedTargetId: string | null = null;
  authToken = '';
  familiar: FamiliarState | null = null;
  /** Spawn point id when entering a scene via door */
  pendingSpawnId = 'default';
  isTransitioning = false;
  /** Set when a teleport departure has played; the next world load plays the arrival spell. */
  teleportArrivalPending = false;
  /** Guards against overlapping teleport casts / duplicate requests. */
  isTeleporting = false;
  isAdmin = false;
  domInputFocused = false;
  chatChannel: 'global' | 'local' = 'local';
  dbPlayerId = '';
  apartmentWards: WardState[] = [];
  savedLocation: PlayerLocation | null = null;
  friends: FriendEntry[] = [];
  friendRequests: FriendRequest[] = [];
  friendPresence: FriendPresence[] = [];
  /** When visiting another player's apartment */
  visitingHostSessionId: string | null = null;
  visitingHostDbPlayerId = '';
  visitingHostName = '';
  /** Server-authoritative apartment instance id (own session id when at home). */
  localApartmentHostSessionId = '';
  activeTradeId: string | null = null;
  tradePartnerName = '';
  pendingApartmentInvite: { inviteId: string; hostName: string } | null = null;
  progression: PlayerProgression | null = null;
  /** Last applied progression sync sequence (drop older updates). */
  progressionSeq = 0;
  hiddenNpcIds: string[] = [];
  /** Server-published NPC presence. The client only interpolates it. */
  npcPresences: NpcPublicPresence[] = [];
  /** Last applied world_state sequence. */
  worldStateSeq = 0;
  worldHour = 12;

  async loadSession(): Promise<void> {
    const API = import.meta.env.VITE_SERVER_URL?.replace('ws://', 'http://').replace('wss://', 'https://') ?? 'http://localhost:2567';
    if (!this.authToken) return;
    try {
      const res = await fetch(`${API}/api/auth/session`, {
        headers: { Authorization: `Bearer ${this.authToken}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      this.savedLocation = data.location ?? null;
      this.visitingHostDbPlayerId = data.location?.visitingHostDbPlayerId ?? '';
      this.friends = data.friends ?? [];
      this.friendRequests = data.friendRequests ?? [];
      this.friendPresence = data.friendPresence ?? [];
      if (data.dbPlayerId) this.dbPlayerId = data.dbPlayerId;
    } catch {
      /* use defaults */
    }
  }

  async loadContent(): Promise<void> {
    const res = await fetch('/api/content/all');
    this.content = await res.json();
    if (this.content?.recognitionTiers) {
      setRecognitionContent(this.content.recognitionTiers);
    }
    if (this.content?.licenses) {
      setLicensesContent(this.content.licenses);
    }
    if (this.content?.ingredients) {
      await verifyItemIconsOncePerLogin(this.content.ingredients);
    }
  }

  applyLiveMaps(maps: ContentMapDefinition[]): void {
    if (!this.content) return;
    this.content.maps = maps;
  }

  getMap(sceneId: string): ContentMapDefinition | undefined {
    const maps = this.content?.maps ?? [];
    const canonicalId = sceneId === 'town' ? 'town_main' : sceneId === 'apartment' ? 'apartment_main' : undefined;
    if (canonicalId) {
      const canon = maps.find((m) => m.id === canonicalId);
      if (canon) return canon;
    }
    return maps.find((m) => m.sceneId === sceneId);
  }

  getSpells(): ContentSpell[] {
    return this.content?.spells.filter((s) => s.tradition === 'traditional_european') ?? [];
  }

  /** Apply live NPC shop shelf counts from the server. */
  applyShopStock(shopId: string, stock: { itemId: string; stock: number }[]): void {
    const shop = this.content?.shops.find((s) => s.id === shopId);
    if (!shop) return;
    const next = new Map(stock.map((row) => [row.itemId, row.stock]));
    for (const listing of shop.inventory) {
      const value = next.get(listing.itemId);
      if (value != null) listing.stock = value;
    }
  }
}

export const gameState = new GameState();

export function applyShopStock(shopId: string, stock: { itemId: string; stock: number }[]): void {
  gameState.applyShopStock(shopId, stock);
}
