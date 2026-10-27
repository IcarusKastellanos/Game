import Phaser from 'phaser';
import { gameState } from '../data/game-state';
import { network } from '../net/NetworkManager';
import { AltarPanel } from '../ui/AltarPanel';
import { InventoryPanel } from '../ui/InventoryPanel';
import { ShopPanel } from '../ui/ShopPanel';
import { AuraPanel } from '../ui/AuraPanel';
import { CharacterSheet } from '../ui/CharacterSheet';
import { FamiliarPanel } from '../ui/FamiliarPanel';
import { DialoguePanel } from '../ui/DialoguePanel';
import { NpcActionPanel } from '../ui/NpcActionPanel';
import { HUD } from '../ui/HUD';
import { hudWindows } from '../ui/hud/HUDManager';
import type { HUDWindowId } from '../ui/hud/types';
import { AdminConsole } from '../ui/AdminConsole';
import { AdminPanel } from '../ui/AdminPanel';
import { TargetPanel } from '../ui/TargetPanel';
import { ChatPanel, guardGameHotkey } from '../ui/ChatPanel';
import { tradePanel } from '../ui/TradePanel';
import { friendsPanel } from '../ui/FriendsPanel';
import { apartmentInvitePanel } from '../ui/ApartmentInvitePanel';
import { progressionPanels } from '../ui/ProgressionPanels';
import { HexagramEnchantPanel } from '../ui/HexagramEnchantPanel';

/** Overlay UI scene — all panels */
export class UIScene extends Phaser.Scene {
  private altarPanel!: AltarPanel;
  private inventoryPanel!: InventoryPanel;
  private shopPanel!: ShopPanel;
  private auraPanel!: AuraPanel;
  private characterSheet!: CharacterSheet;
  private familiarPanel!: FamiliarPanel;
  private dialoguePanel!: DialoguePanel;
  private npcActionPanel!: NpcActionPanel;
  private hud!: HUD;
  private adminConsole!: AdminConsole;
  private adminPanel!: AdminPanel;
  private targetPanel!: TargetPanel;
  private chatPanel!: ChatPanel;
  private hexagramPanel!: HexagramEnchantPanel;

  constructor() {
    super({ key: 'UIScene', active: false });
  }

  create(): void {
    this.altarPanel = new AltarPanel(this);
    this.inventoryPanel = new InventoryPanel(this);
    this.shopPanel = new ShopPanel();
    this.auraPanel = new AuraPanel(this);
    this.characterSheet = new CharacterSheet(this);
    this.familiarPanel = new FamiliarPanel(this);
    this.dialoguePanel = new DialoguePanel();
    this.npcActionPanel = new NpcActionPanel();
    this.hud = new HUD(this);
    this.adminConsole = new AdminConsole(this);
    this.adminPanel = new AdminPanel(this);
    this.targetPanel = new TargetPanel(this.auraPanel);
    this.chatPanel = new ChatPanel(this);
    this.hexagramPanel = new HexagramEnchantPanel(this);
    void tradePanel;
    void friendsPanel;

    this.hud.getManager().setController({
      openBag: () => this.togglePanel('inventory'),
      openGrimoire: () => {
        progressionPanels.toggleJournal();
        this.openHudWindow('grimoire');
      },
      openSpells: () => this.openHudWindow('spells'),
      openSocial: () => {
        this.openHudWindow('social');
      },
      openCoven: () => this.openHudWindow('coven'),
      openTeleport: () => this.openHudWindow('teleport'),
      openMap: () => this.openHudWindow('map'),
      openSettings: () => this.openHudWindow('settings'),
      openAura: () => this.togglePanel('aura'),
      openFamiliar: () => this.togglePanel('familiar'),
      teleportHome: () => {
        if (gameState.isTeleporting || gameState.isTransitioning) return;
        if (gameState.visitingHostSessionId) {
          network.send('leave_apartment', {});
          return;
        }
        if (gameState.currentScene === 'town') {
          window.dispatchEvent(
            new CustomEvent('game:teleport-scene-change', { detail: { scene: 'apartment', spawnId: 'door' } })
          );
        } else {
          this.openHudWindow('teleport');
        }
      },
    });

    window.addEventListener('game:open-friends', () => friendsPanel.show());
    window.addEventListener('game:book-open', this.onBookOpen as EventListener);
    window.addEventListener('game:specialty-offer', this.onSpecialtyOffer as EventListener);

    window.addEventListener('game:player-loaded', () => {
      this.adminConsole.bindRoom();
      this.adminPanel.bindRoom();
    });
    window.addEventListener('game:target-player', this.onTarget as EventListener);
    window.addEventListener('game:trade-request', this.onTradeRequest as EventListener);
    window.addEventListener('game:apartment-invite', this.onApartmentInvite as EventListener);

    const guard = guardGameHotkey;
    this.input.keyboard?.on('keydown-B', guard(() => this.togglePanel('inventory')));
    this.input.keyboard?.on('keydown-I', guard(() => this.togglePanel('inventory')));
    this.input.keyboard?.on('keydown-G', guard(() => {
      progressionPanels.toggleJournal();
      this.openHudWindow('grimoire');
    }));
    this.input.keyboard?.on('keydown-K', guard(() => this.openHudWindow('spells')));
    this.input.keyboard?.on('keydown-N', guard(() => {
      this.openHudWindow('social');
    }));
    this.input.keyboard?.on('keydown-C', guard(() => this.openHudWindow('coven')));
    this.input.keyboard?.on('keydown-H', guard(() => this.openHudWindow('teleport')));
    this.input.keyboard?.on('keydown-M', guard(() => this.openHudWindow('map')));
    this.input.keyboard?.on('keydown-P', guard(() => {
      friendsPanel.hide();
      hudWindows.renderWindow('social');
      hudWindows.get('social')?.show();
    }));
    this.input.keyboard?.on('keydown-X', guard(() => this.togglePanel('aura')));
    this.input.keyboard?.on('keydown-Y', guard(() => this.toggleLedger()));
    window.addEventListener('game:open-character-sheet', () => this.toggleLedger());
    this.input.keyboard?.on('keydown-F', guard(() => this.togglePanel('familiar')));
    this.input.keyboard?.on('keydown-J', guard(() => {
      progressionPanels.toggleJournal();
      this.openHudWindow('grimoire');
    }));
    this.input.keyboard?.on('keydown-ESC', guard(() => {
      if (this.anyHudWindowOpen()) {
        hudWindows.hideAll();
        return;
      }
      if (this.hud.getManager().isExpanded()) {
        this.hud.getManager().toggleExpanded(false);
        return;
      }
      this.closeAll();
    }));

    const NUM_KEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'] as const;
    NUM_KEYS.forEach((key, i) => {
      this.input.keyboard?.on(`keydown-${key}`, guard(() => {
        this.hud.getManager().handleHotkey(String(i + 1));
      }));
    });

    window.addEventListener('game:open-ui', this.onOpenUI as EventListener);
  }

  shutdown(): void {
    window.removeEventListener('game:open-ui', this.onOpenUI as EventListener);
    window.removeEventListener('game:target-player', this.onTarget as EventListener);
    window.removeEventListener('game:trade-request', this.onTradeRequest as EventListener);
    window.removeEventListener('game:apartment-invite', this.onApartmentInvite as EventListener);
  }

  private onApartmentInvite = (e: CustomEvent<{ inviteId: string; hostName: string }>): void => {
    apartmentInvitePanel.show(e.detail.inviteId, e.detail.hostName);
  };

  private onTradeRequest = (e: CustomEvent<{ targetSessionId?: string; friendDbPlayerId?: string }>): void => {
    if (e.detail.friendDbPlayerId) {
      network.send('trade_request', { targetSessionId: '', friendDbPlayerId: e.detail.friendDbPlayerId });
      return;
    }
    if (e.detail.targetSessionId) tradePanel.requestTrade(e.detail.targetSessionId);
  };

  private onTarget = (e: CustomEvent<{ sessionId: string; displayName: string; x: number; y: number }>): void => {
    this.closeAll();
    this.targetPanel.show(e.detail.sessionId, e.detail.displayName, e.detail.x, e.detail.y);
  };

  private onOpenUI = (e: CustomEvent<{
    ui: string;
    shopId?: string;
    npcId?: string;
    name?: string;
    role?: string;
    dialogueTreeId?: string;
    nodeId?: string;
    text?: string;
    notice?: string;
    choices?: import('@witchcraft/shared').PublishedDialogueChoice[];
    options?: import('@witchcraft/shared').NpcInteractionOffer[];
    stationType?: string;
    interactableId?: string;
    recipes?: unknown[];
  }>): void => {
    const d = e.detail;
    this.closeAll();
    switch (d.ui) {
      case 'altar':
        gameState.activeUI = 'altar';
        this.altarPanel.show();
        break;
      case 'shop':
        if (d.shopId) {
          gameState.activeUI = 'shop';
          gameState.activeShopId = d.shopId;
          this.shopPanel.show(d.shopId);
        }
        break;
      case 'dialogue':
        if (d.npcId && d.dialogueTreeId) {
          gameState.activeUI = 'dialogue';
          this.dialoguePanel.show(d.npcId, d.dialogueTreeId, d.nodeId ?? 'start', d.text ?? '', d.choices ?? [], d.notice ?? '');
        }
        break;
      case 'npc_actions':
        if (d.npcId) {
          gameState.activeUI = 'npc_actions';
          this.npcActionPanel.show({ npcId: d.npcId, name: d.name, role: d.role, options: d.options });
        }
        break;
      case 'none':
        break;
      case 'crafting':
        progressionPanels.showCrafting(
          String(d.stationType ?? 'potion_shelf'),
          (d.recipes as {
            id: string;
            name: string;
            description?: string;
            inputs: { itemId: string; quantity: number }[];
            effect?: string;
            meCost?: number;
            minLevel?: number;
          }[]) ?? []
        );
        break;
      case 'hexagram':
        gameState.activeUI = 'hexagram';
        this.hexagramPanel.show(
          (d.recipes as Parameters<HexagramEnchantPanel['show']>[0]) ?? []
        );
        break;
    }
  };

  private onBookOpen = (e: CustomEvent<{ bookId: string; pages: string[]; title?: string }>): void => {
    this.closeAll();
    progressionPanels.showBook(e.detail.bookId, e.detail.pages, e.detail.title ?? 'Book');
  };

  private onSpecialtyOffer = (e: CustomEvent<{ traditions: string[] }>): void => {
    // TEMPORARY: tradition specialty choice deactivated until tradition packs ship.
    void e;
    // progressionPanels.showSpecialtyOffer(e.detail.traditions);
  };

  private openHudWindow(id: HUDWindowId): void {
    hudWindows.renderWindow(id);
    hudWindows.toggle(id);
  }

  private anyHudWindowOpen(): boolean {
    const ids: HUDWindowId[] = ['grimoire', 'spells', 'social', 'coven', 'teleport', 'map', 'settings'];
    return ids.some((id) => hudWindows.get(id)?.isOpen());
  }

  private toggleLedger(): void {
    const already = gameState.activeUI === 'ledger';
    this.targetPanel.hide();
    friendsPanel.hide();
    this.closeAll();
    if (already) return;
    gameState.activeUI = 'ledger';
    this.characterSheet.show();
  }

  private togglePanel(panel: 'inventory' | 'aura' | 'familiar'): void {
    const alreadyOpen =
      (panel === 'inventory' && gameState.activeUI === 'inventory') ||
      (panel === 'aura' && gameState.activeUI === 'aura') ||
      (panel === 'familiar' && gameState.activeUI === 'familiar');

    this.targetPanel.hide();
    friendsPanel.hide();
    this.closeAll();
    if (alreadyOpen) return;

    if (panel === 'inventory') {
      gameState.activeUI = 'inventory';
      this.inventoryPanel.show();
    } else if (panel === 'aura') {
      gameState.activeUI = 'aura';
      this.auraPanel.show();
    } else if (panel === 'familiar') {
      gameState.activeUI = 'familiar';
      this.familiarPanel.show();
    }
  }

  private closeAll(): void {
    gameState.activeUI = 'none';
    this.altarPanel.hide();
    this.inventoryPanel.hide();
    this.shopPanel.hide();
    this.auraPanel.hide();
    this.characterSheet.hide();
    this.familiarPanel.hide();
    this.dialoguePanel.hide();
    this.npcActionPanel.hide();
    this.targetPanel.hide();
    friendsPanel.hide();
    progressionPanels.hideAll();
    this.hexagramPanel.hide();
    hudWindows.hideAll();
  }
}
