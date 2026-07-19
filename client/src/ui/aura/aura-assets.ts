import type { StatDisplayKey } from '@witchcraft/shared';
import type { FamiliarLinkState } from './AuraViewModel';

/** Base URL for Aura & Wards pixel-art assets (client/public). */
export const AURA_ASSET_BASE = '/assets/ui/aura-screen/';

const STAT_ICON_FILES: Record<StatDisplayKey, string> = {
  health: 'icons/health.png',
  hunger: 'icons/hunger.png',
  stamina: 'icons/stamina.png',
  magicalEnergy: 'icons/magical-energy.png',
  intuition: 'icons/intuition.png',
  awareness: 'icons/awareness.png',
  willpower: 'icons/willpower.png',
  memory: 'icons/memory.png',
  presence: 'icons/presence.png',
  authority: 'icons/authority.png',
  mediumship: 'icons/mediumship.png',
  ritualSkill: 'icons/ritual-skill.png',
  protection: 'icons/protection.png',
  hexWork: 'icons/hex-work.png',
  healing: 'icons/healing.png',
  herbalism: 'icons/herbalism.png',
  divination: 'icons/divination.png',
  potionMaking: 'icons/potion-making.png',
  spiritNegotiation: 'icons/spirit-negotiation.png',
};

export type WardRingVisual = 'inactive' | 'active' | 'damaged' | 'breached';

export function auraAsset(path: string): string {
  return `${AURA_ASSET_BASE}${path}`;
}

/** Safe img tag with alt="" and graceful missing-asset styling via CSS class. */
export function auraImg(path: string, className: string, width = 24, height = 24): string {
  const src = auraAsset(path);
  return `<img class="aura-asset ${className}" src="${src}" width="${width}" height="${height}" alt="" decoding="async" loading="lazy" onerror="this.classList.add('is-missing')" />`;
}

export function statAssetIcon(key: StatDisplayKey, className = 'aura-stat-icon'): string {
  const file = STAT_ICON_FILES[key];
  return auraImg(file, className, 20, 20);
}

export function wardRingAsset(state: WardRingVisual): string {
  const map: Record<WardRingVisual, string> = {
    inactive: 'ward-ring-inactive.png',
    active: 'ward-ring-active.png',
    damaged: 'ward-ring-damaged.png',
    breached: 'ward-ring-breached.png',
  };
  return auraAsset(map[state]);
}

export function familiarNodeAsset(state: FamiliarLinkState): string {
  switch (state) {
    case 'linked':
      return auraAsset('familiar-linked.png');
    case 'weakened':
    case 'distant':
      return auraAsset('familiar-weakened.png');
    case 'blocked':
    case 'offline':
      return auraAsset('familiar-blocked.png');
    default:
      return auraAsset('familiar-unlinked.png');
  }
}

export function pipAsset(key: StatDisplayKey, on: boolean, critical: boolean): string {
  if (!on) return auraAsset('pips/pip-off.png');
  if (critical) return auraAsset('pips/pip-critical-on.png');
  const map: Partial<Record<StatDisplayKey, string>> = {
    health: 'pips/pip-health-on.png',
    hunger: 'pips/pip-hunger-on.png',
    stamina: 'pips/pip-stamina-on.png',
    magicalEnergy: 'pips/pip-magical-energy-on.png',
  };
  return auraAsset(map[key] ?? 'pips/pip-off.png');
}

export const AURA_FRAMES = {
  screen: 'aura-screen-frame.png',
  attributePanel: 'attribute-panel.png',
  overviewPanel: 'overview-panel.png',
  visualization: 'aura-visualization-frame.png',
  close: 'aura-close-frame.png',
  headerDecoration: 'aura-header-decoration.png',
  moon: 'bottom-moon-ornament.png',
  corner: 'corner-filigree.png',
  divider: 'panel-divider.png',
} as const;
