import type { HUDPreferences } from './types.js';
import { DEFAULT_HUD_PREFS } from './types.js';

const STORAGE_KEY = 'witchcraft-hud-prefs-v1';

export function loadHudPrefs(): HUDPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_HUD_PREFS, hotbar: [...DEFAULT_HUD_PREFS.hotbar.map(() => ({}))] };
    const parsed = JSON.parse(raw) as Partial<HUDPreferences>;
    return {
      ...DEFAULT_HUD_PREFS,
      ...parsed,
      hotbar: parsed.hotbar?.length === 5 ? parsed.hotbar : DEFAULT_HUD_PREFS.hotbar,
      windowState: parsed.windowState ?? {},
      pinnedWindows: parsed.pinnedWindows ?? [],
    };
  } catch {
    return { ...DEFAULT_HUD_PREFS, hotbar: [...DEFAULT_HUD_PREFS.hotbar.map(() => ({}))] };
  }
}

export function saveHudPrefs(prefs: HUDPreferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}
