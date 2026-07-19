import type { StatDisplayKey } from '@witchcraft/shared';

/**
 * Compact line icons for attribute rows and the legend. Each returns an inline
 * SVG string using `currentColor` so it inherits the row's text colour. Kept in
 * one coherent thin-stroke occult style — no emoji, no mixed art.
 */
const S = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ICONS: Record<StatDisplayKey, string> = {
  health: S('<path d="M12 20s-7-4.6-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.4-7 10-7 10z"/>'),
  hunger: S('<path d="M12 3c3 3 4 5 4 8a4 4 0 1 1-8 0c0-3 1-5 4-8z"/>'),
  stamina: S('<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/>'),
  magicalEnergy: S('<path d="M12 2l2.2 6.6H21l-5.4 4 2 6.6L12 15.6 6.4 19.2l2-6.6L3 8.6h6.8L12 2z"/>'),
  intuition: S('<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>'),
  awareness: S('<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M6 6l1.5 1.5M16.5 16.5 18 18M18 6l-1.5 1.5M7.5 16.5 6 18"/>'),
  willpower: S('<path d="M12 3l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V6l7-3z"/><path d="M12 9c1.5 1.2 1.5 3.5 0 5-1.5-1.5-1.5-3.8 0-5z"/>'),
  memory: S('<path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V4z"/><path d="M9 4v14"/>'),
  presence: S('<circle cx="12" cy="7" r="3"/><path d="M6 21c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M12 2v1M4.5 9.5 4 9M20 9l-.5.5"/>'),
  authority: S('<path d="M4 8l3 4 5-6 5 6 3-4v9H4V8z"/>'),
  mediumship: S('<path d="M12 3c4 0 7 3 7 7 0 5-4 8-7 11-3-3-7-6-7-11 0-4 3-7 7-7z"/><circle cx="9.5" cy="10" r="1"/><circle cx="14.5" cy="10" r="1"/>'),
  ritualSkill: S('<circle cx="12" cy="12" r="9"/><path d="M12 3l2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3z"/>'),
  protection: S('<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3z"/>'),
  hexWork: S('<path d="M9 3h6l-1 5h3l-8 13 2-8H8l1-10z"/>'),
  healing: S('<circle cx="12" cy="12" r="5"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3M4 4l2 2M18 18l2 2M20 4l-2 2M6 18l-2 2"/>'),
  herbalism: S('<path d="M12 21c0-6 3-11 8-13-1 7-4 11-8 13z"/><path d="M12 21c0-4-2-8-6-10 1 5 3 8 6 10z"/>'),
  divination: S('<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5 21 21"/>'),
  potionMaking: S('<path d="M9 3h6M10 3v5l-4 8a3 3 0 0 0 3 4h6a3 3 0 0 0 3-4l-4-8V3"/>'),
  spiritNegotiation: S('<path d="M7 11l-3 3 3 3M17 11l3 3-3 3M4 14h6M14 14h6"/><path d="M12 3v8"/>'),
};

export function statIcon(key: StatDisplayKey): string {
  return ICONS[key] ?? '';
}

export const LEGEND_ICONS = {
  body: S('<circle cx="12" cy="7" r="3"/><path d="M6 21c0-3.3 2.7-6 6-6s6 2.7 6 6"/>'),
  aura: S('<circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="8" stroke-dasharray="2 3"/>'),
  protections: S('<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3z"/>'),
  wards: S('<path d="M12 2l2.6 6.4L21 11l-6.4 2.6L12 20l-2.6-6.4L3 11l6.4-2.6L12 2z"/>'),
  perimeter: S('<circle cx="12" cy="12" r="9" stroke-dasharray="3 3"/>'),
  familiarLink: S('<path d="M7 11l-3 3 3 3M17 11l3 3-3 3M9 14h6"/>'),
} as const;

/** Compact icons for the Aura Overview rows (matches reference layout). */
export const OVERVIEW_ICONS = {
  alignment: S('<path d="M12 2l2.2 6.6H21l-5.4 4 2 6.6L12 15.6 6.4 19.2l2-6.6L3 8.6h6.8L12 2z"/>'),
  blessingsHexes: S('<path d="M8 4h8l-1 4h3L9 20l2-7H8l0-9z"/>'),
  protectionsWards: S('<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3z"/>'),
  familiarLink: S('<circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/>'),
  energeticDamage: S('<circle cx="12" cy="12" r="5"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/>'),
  statusLeaf: S('<path d="M12 21c0-6 3-11 8-13-1 7-4 11-8 13z"/><path d="M12 21c0-4-2-8-6-10 1 5 3 8 6 10z"/>'),
} as const;
