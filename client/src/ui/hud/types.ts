/** HUD window identifiers — central nav + future expansions */
export type HUDWindowId =
  | 'bag'
  | 'grimoire'
  | 'spells'
  | 'social'
  | 'coven'
  | 'teleport'
  | 'map'
  | 'settings';

export interface NavCardDef {
  id: HUDWindowId;
  label: string;
  hotkey: string;
  sprite: string;
}

export interface HUDController {
  openBag: () => void;
  openGrimoire: () => void;
  openSpells: () => void;
  openSocial: () => void;
  openCoven: () => void;
  openTeleport: () => void;
  openMap: () => void;
  openSettings: () => void;
  openAura: () => void;
  openFamiliar: () => void;
  teleportHome: () => void;
}

export interface HUDNotification {
  id: string;
  kind: 'discovery' | 'grimoire' | 'spirit' | 'ritual' | 'blessing' | 'curse' | 'level' | 'achievement' | 'world' | 'info' | 'error';
  title: string;
  body?: string;
  actionLabel?: string;
  actionHotkey?: string;
  onAction?: () => void;
  durationMs?: number;
}

export interface HotbarSlot {
  itemId?: string;
  pocketSpellId?: string;
  label?: string;
}

export interface HUDPreferences {
  scale: number;
  navCollapsed: boolean;
  /** When false, only the pentagram toggle shows (under chat). */
  hudExpanded: boolean;
  hotbar: HotbarSlot[];
  windowState: Record<string, { x?: number; y?: number; w?: number; h?: number; collapsed?: boolean; tab?: string }>;
  pinnedWindows: HUDWindowId[];
}

export const DEFAULT_HUD_PREFS: HUDPreferences = {
  scale: 1,
  navCollapsed: false,
  hudExpanded: false,
  hotbar: [{}, {}, {}, {}, {}],
  windowState: {},
  pinnedWindows: [],
};
