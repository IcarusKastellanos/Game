import type { PlayerProgression, RecognitionDocument } from '@witchcraft/shared';
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
  }[];
  requiresRecognition?: string;
  requiresLicense?: string;
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
  shops: { id: string; name: string; inventory: { itemId: string; price: number; stock: number; minLevel?: number }[] }[];
  npcs: { id: string; name: string; dialogueTreeId: string }[];
  decorations: { id: string; name: string; category: string }[];
  dialogues?: DialogueTree[];
  recognitionTiers?: RecognitionDocument;
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
  activeUI: 'none' | 'altar' | 'hexagram' | 'inventory' | 'shop' | 'aura' | 'familiar' | 'dialogue' = 'none';
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
  hiddenNpcIds: string[] = [];
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
}

export const gameState = new GameState();
