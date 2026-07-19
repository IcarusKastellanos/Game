/**
 * Player HUD layout schema — shared between the admin HUD editor, the game
 * engine, and the server persistence layer.
 *
 * The layout describes every persistent, non-popup HUD element (status panel,
 * bars, intuition meter, moon/time panel, nav buttons, hotbar, notifications,
 * currency counters, …). Popups (dialogue, inventory screens, character sheets,
 * map overlays, quest windows) are intentionally excluded.
 */

export const HUD_SCHEMA_VERSION = '1.0.0';

export type HudPositionMode = 'absolute' | 'anchored' | 'responsive';

export type HudAnchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'custom';

export const HUD_ANCHORS: HudAnchor[] = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
  'custom',
];

export type HudCategory =
  | 'player'
  | 'status-bars'
  | 'awareness'
  | 'navigation'
  | 'inventory'
  | 'notifications'
  | 'resources'
  | 'world-information'
  | 'decorative'
  | 'custom';

export const HUD_CATEGORIES: { id: HudCategory; label: string }[] = [
  { id: 'player', label: 'Player' },
  { id: 'status-bars', label: 'Status Bars' },
  { id: 'awareness', label: 'Awareness' },
  { id: 'navigation', label: 'Navigation' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'resources', label: 'Resources' },
  { id: 'world-information', label: 'World Information' },
  { id: 'decorative', label: 'Decorative' },
  { id: 'custom', label: 'Custom' },
];

/** Asset-variant slots an element may declare. */
export type HudAssetVariant =
  | 'default'
  | 'hover'
  | 'active'
  | 'disabled'
  | 'warning'
  | 'critical'
  | 'glowing'
  | 'empty'
  | 'full'
  | 'mobile'
  | 'custom';

export const HUD_ASSET_VARIANTS: HudAssetVariant[] = [
  'default',
  'hover',
  'active',
  'disabled',
  'warning',
  'critical',
  'glowing',
  'empty',
  'full',
  'mobile',
  'custom',
];

/** A single data binding: maps a logical field to an engine data path. */
export interface HudBinding {
  /** Dotted engine data path, e.g. `player.health.current`. */
  path: string;
  /** Fallback rendered when the path resolves to null/undefined. */
  fallback?: string | number;
  /** Optional formatter id (e.g. `number`, `percent`, `time`, `truncate`). */
  formatter?: string;
}

/** Named preview states available in the editor / engine. */
export type HudStateId =
  | 'default'
  | 'exploration'
  | 'combat'
  | 'lowHealth'
  | 'highMagicalActivity'
  | 'dialogueMinimized'
  | 'mobile'
  | 'spectator'
  | string;

export const HUD_STATES: { id: HudStateId; label: string; description: string }[] = [
  { id: 'default', label: 'Default gameplay', description: 'Base layout — all other states inherit from this.' },
  { id: 'exploration', label: 'Exploration', description: 'Calm world traversal.' },
  { id: 'combat', label: 'Combat', description: 'Active magical combat.' },
  { id: 'lowHealth', label: 'Low health', description: 'Player near death.' },
  { id: 'highMagicalActivity', label: 'High magical activity', description: 'Strong ambient magic detected.' },
  { id: 'dialogueMinimized', label: 'Dialogue-minimized', description: 'HUD trimmed while conversing.' },
  { id: 'mobile', label: 'Mobile gameplay', description: 'Touch / small-screen layout.' },
  { id: 'spectator', label: 'Spectator / debug', description: 'Observer or debug overlay.' },
];

/**
 * Full definition of a single HUD element. All numeric fields are expressed in
 * the layout's base-resolution pixel space; the engine derives responsive
 * positions from the anchor + normalized offsets.
 */
export interface HudElement {
  id: string;
  type: string;
  category: HudCategory;
  name: string;

  // Lifecycle / editor flags
  enabled: boolean;
  editorVisible: boolean;
  locked: boolean;
  custom?: boolean;

  // Positioning
  positionMode: HudPositionMode;
  anchor: HudAnchor;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  normalizedX: number;
  normalizedY: number;

  // Geometry
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  /** origin point used for scale/rotation, normalized 0..1 */
  origin: { x: number; y: number };

  // Presentation
  asset?: string;
  assets?: Partial<Record<HudAssetVariant, string>>;

  // Data
  bindings?: Record<string, HudBinding>;

  // Free-form metadata for custom elements
  metadata?: Record<string, unknown>;
}

/** State override — a sparse partial of an element keyed by element id. */
export type HudElementOverride = Partial<
  Pick<
    HudElement,
    | 'x'
    | 'y'
    | 'offsetX'
    | 'offsetY'
    | 'normalizedX'
    | 'normalizedY'
    | 'width'
    | 'height'
    | 'scaleX'
    | 'scaleY'
    | 'rotation'
    | 'opacity'
    | 'zIndex'
    | 'anchor'
    | 'enabled'
    | 'editorVisible'
  >
> & { assetVariant?: HudAssetVariant };

export type HudStateOverrides = Record<HudStateId, Record<string, HudElementOverride>>;

export interface HudSafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface HudResolution {
  width: number;
  height: number;
}

export interface HudLayoutSettings {
  snapToGrid: boolean;
  gridSize: number;
  responsiveScaling: boolean;
  nudgeStep: number;
}

export interface HudLayoutDocument {
  schemaVersion: string;
  layoutId: string;
  name: string;
  baseResolution: HudResolution;
  safeArea: HudSafeArea;
  settings: HudLayoutSettings;
  elements: HudElement[];
  states: HudStateOverrides;
}

export type HudLayoutStatus = 'draft' | 'published' | 'archived';

/** Persistence metadata wrapping a layout document. */
export interface HudLayoutMetadata {
  id: string;
  name: string;
  status: HudLayoutStatus;
  version: number;
  isActive: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HudLayoutRecord {
  metadata: HudLayoutMetadata;
  document: HudLayoutDocument;
}

export interface HudLayoutVersionSummary {
  id: string;
  version: number;
  changelog: string | null;
  createdBy: string | null;
  createdAt: string;
}

// --- Resolution presets ---------------------------------------------------

export interface HudResolutionPreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const HUD_RESOLUTION_PRESETS: HudResolutionPreset[] = [
  { id: '1920x1080', label: '1920 × 1080', width: 1920, height: 1080 },
  { id: '1600x900', label: '1600 × 900', width: 1600, height: 900 },
  { id: '1366x768', label: '1366 × 768', width: 1366, height: 768 },
  { id: '1280x720', label: '1280 × 720', width: 1280, height: 720 },
  { id: 'mobile-portrait', label: 'Mobile portrait', width: 390, height: 844 },
  { id: 'mobile-landscape', label: 'Mobile landscape', width: 844, height: 390 },
];

// --- Element catalog (built-in persistent HUD components) ------------------

export interface HudCatalogEntry {
  type: string;
  category: HudCategory;
  name: string;
  defaultWidth: number;
  defaultHeight: number;
  defaultAnchor: HudAnchor;
  asset?: string;
  bindings?: Record<string, HudBinding>;
  description: string;
}

/**
 * The catalog of built-in persistent HUD elements. New persistent HUD elements
 * added to the game should be registered here so they appear in the editor
 * library automatically.
 */
export const HUD_ELEMENT_CATALOG: HudCatalogEntry[] = [
  {
    type: 'player-status',
    category: 'player',
    name: 'Player Status Panel',
    defaultWidth: 573,
    defaultHeight: 318,
    defaultAnchor: 'top-left',
    asset: '/assets/hud/sprites/portrait_frame.png',
    bindings: {
      playerName: { path: 'player.displayName' },
      rank: { path: 'player.rank' },
      reputation: { path: 'player.reputation' },
    },
    description: 'Portrait frame with player name, rank and alignment.',
  },
  {
    type: 'health-bar',
    category: 'status-bars',
    name: 'Health Bar',
    defaultWidth: 253,
    defaultHeight: 18,
    defaultAnchor: 'top-left',
    asset: '/assets/hud/sprites/bar_track_health.png',
    bindings: {
      current: { path: 'player.health.current', formatter: 'number' },
      max: { path: 'player.health.max', formatter: 'number' },
    },
    description: 'Overlays the health track on the portrait frame.',
  },
  {
    type: 'magic-bar',
    category: 'status-bars',
    name: 'Magical Energy Bar',
    defaultWidth: 258,
    defaultHeight: 18,
    defaultAnchor: 'top-left',
    asset: '/assets/hud/sprites/bar_track_magical_energy.png',
    bindings: {
      current: { path: 'player.magic.current', formatter: 'number' },
      max: { path: 'player.magic.max', formatter: 'number' },
    },
    description: 'Overlays the magical-energy track on the portrait frame.',
  },
  {
    type: 'experience-bar',
    category: 'status-bars',
    name: 'Experience Bar',
    defaultWidth: 261,
    defaultHeight: 18,
    defaultAnchor: 'top-left',
    asset: '/assets/hud/sprites/bar_track_experience.png',
    bindings: {
      current: { path: 'player.experience.current', formatter: 'number' },
      max: { path: 'player.experience.max', formatter: 'number' },
    },
    description: 'Overlays the experience track on the portrait frame.',
  },
  {
    type: 'awareness-meter',
    category: 'awareness',
    name: 'Intuition Meter',
    defaultWidth: 180,
    defaultHeight: 180,
    defaultAnchor: 'top-center',
    asset: '/assets/hud/sprites/intuition_eye.png',
    bindings: {
      intuition: { path: 'player.stats.intuition' },
      spiritualAwareness: { path: 'player.stats.spiritualAwareness' },
      magicActivity: { path: 'world.localMagicActivity' },
      spiritActivity: { path: 'world.localSpiritActivity' },
    },
    description: 'Magical-detection awareness meter — the awakening eye with glow states.',
  },
  {
    type: 'world-panel',
    category: 'world-information',
    name: 'Moon / Time / Location Panel',
    defaultWidth: 220,
    defaultHeight: 120,
    defaultAnchor: 'top-right',
    asset: '/assets/hud/sprites/moon_time_location_panel.png',
    bindings: {
      time: { path: 'world.time', formatter: 'time' },
      moonPhase: { path: 'world.moonPhase' },
      location: { path: 'world.currentLocation' },
    },
    description: 'Displays moon phase, in-game time and current location.',
  },
  {
    type: 'nav-buttons',
    category: 'navigation',
    name: 'Navigation Buttons',
    defaultWidth: 360,
    defaultHeight: 72,
    defaultAnchor: 'bottom-center',
    asset: '/assets/hud/sprites/nav_button_template.png',
    description: 'Row of persistent navigation buttons (bag, map, teleport, …).',
  },
  {
    type: 'hotbar',
    category: 'inventory',
    name: 'Inventory Hotbar',
    defaultWidth: 340,
    defaultHeight: 72,
    defaultAnchor: 'bottom-center',
    asset: '/assets/hud/sprites/hotbar_frame.png',
    description: 'Quick-access inventory hotbar slots.',
  },
  {
    type: 'notifications',
    category: 'notifications',
    name: 'Notification Area',
    defaultWidth: 320,
    defaultHeight: 160,
    defaultAnchor: 'top-right',
    asset: '/assets/hud/sprites/notification_panel_empty.png',
    description: 'Transient gameplay notifications feed.',
  },
  {
    type: 'currency-coins',
    category: 'resources',
    name: 'Coin Counter',
    defaultWidth: 120,
    defaultHeight: 40,
    defaultAnchor: 'top-right',
    asset: '/assets/hud/sprites/resource_coin.png',
    bindings: { value: { path: 'player.currency.coins', formatter: 'number' } },
    description: 'Coin currency counter.',
  },
  {
    type: 'currency-essence',
    category: 'resources',
    name: 'Essence Counter',
    defaultWidth: 120,
    defaultHeight: 40,
    defaultAnchor: 'top-right',
    asset: '/assets/hud/sprites/resource_essence.png',
    bindings: { value: { path: 'player.currency.essence', formatter: 'number' } },
    description: 'Essence currency counter.',
  },
  {
    type: 'currency-favor',
    category: 'resources',
    name: 'Favor Counter',
    defaultWidth: 120,
    defaultHeight: 40,
    defaultAnchor: 'top-right',
    asset: '/assets/hud/sprites/resource_favor.png',
    bindings: { value: { path: 'player.favor', formatter: 'number' } },
    description: 'Favor currency counter.',
  },
  {
    type: 'reputation-counter',
    category: 'resources',
    name: 'Reputation Counter',
    defaultWidth: 120,
    defaultHeight: 40,
    defaultAnchor: 'top-right',
    asset: '/assets/hud/sprites/reputation_counter.png',
    bindings: { value: { path: 'player.reputation', formatter: 'number' } },
    description: 'Reputation counter.',
  },
];

// --- Factory helpers ------------------------------------------------------

function slugToId(type: string): string {
  return type.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

/** Anchor → default normalized origin used when creating anchored elements. */
export function anchorToNormalized(anchor: HudAnchor): { x: number; y: number } {
  const map: Record<Exclude<HudAnchor, 'custom'>, { x: number; y: number }> = {
    'top-left': { x: 0, y: 0 },
    'top-center': { x: 0.5, y: 0 },
    'top-right': { x: 1, y: 0 },
    'center-left': { x: 0, y: 0.5 },
    center: { x: 0.5, y: 0.5 },
    'center-right': { x: 1, y: 0.5 },
    'bottom-left': { x: 0, y: 1 },
    'bottom-center': { x: 0.5, y: 1 },
    'bottom-right': { x: 1, y: 1 },
  };
  return anchor === 'custom' ? { x: 0, y: 0 } : map[anchor];
}

export function createHudElementFromCatalog(
  entry: HudCatalogEntry,
  overrides: Partial<HudElement> = {},
  base: HudResolution = { width: 1920, height: 1080 }
): HudElement {
  const anchorN = anchorToNormalized(entry.defaultAnchor);
  const x = overrides.x ?? Math.round(anchorN.x * base.width - anchorN.x * entry.defaultWidth);
  const y = overrides.y ?? Math.round(anchorN.y * base.height - anchorN.y * entry.defaultHeight);
  const width = overrides.width ?? entry.defaultWidth;
  const height = overrides.height ?? entry.defaultHeight;
  const scaleX = overrides.scaleX ?? 1;
  const scaleY = overrides.scaleY ?? 1;
  const w = width * scaleX;
  const h = height * scaleY;
  const offsetX =
    overrides.offsetX ?? Math.round(x - (anchorN.x * base.width - anchorN.x * w));
  const offsetY =
    overrides.offsetY ?? Math.round(y - (anchorN.y * base.height - anchorN.y * h));
  return {
    id: overrides.id ?? slugToId(entry.type),
    type: entry.type,
    category: entry.category,
    name: overrides.name ?? entry.name,
    enabled: true,
    editorVisible: true,
    locked: false,
    positionMode: 'anchored',
    anchor: entry.defaultAnchor,
    x,
    y,
    offsetX,
    offsetY,
    normalizedX: base.width ? x / base.width : 0,
    normalizedY: base.height ? y / base.height : 0,
    width: entry.defaultWidth,
    height: entry.defaultHeight,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    zIndex: 10,
    origin: { x: 0, y: 0 },
    asset: entry.asset,
    assets: entry.asset ? { default: entry.asset } : undefined,
    bindings: entry.bindings ? structuredCloneSafe(entry.bindings) : undefined,
    ...overrides,
  };
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Build the default player HUD layout from the built-in catalog. */
export function createDefaultHudLayout(): HudLayoutDocument {
  const base: HudResolution = { width: 1920, height: 1080 };
  const positions: Record<string, Partial<HudElement>> = {
    'player-status': { x: 24, y: 24, zIndex: 10 },
    'health-bar': { x: 332, y: 96, zIndex: 12 },
    'magic-bar': { x: 330, y: 128, zIndex: 12 },
    'experience-bar': { x: 327, y: 160, zIndex: 12 },
    'awareness-meter': {
      x: 870,
      y: 24,
      zIndex: 20,
      metadata: {
        parentType: 'player-status',
        parentRelativeX: 0.31,
        parentRelativeY: 0.86,
        parentRelativeWidth: 0.67,
      },
    },
    'world-panel': { x: 1676, y: 24, zIndex: 10 },
    'nav-buttons': { x: 780, y: 984, zIndex: 15 },
    hotbar: { x: 790, y: 1000, zIndex: 15 },
    notifications: { x: 1576, y: 160, zIndex: 30 },
    'currency-coins': { x: 1440, y: 24, zIndex: 12 },
    'currency-essence': { x: 1440, y: 72, zIndex: 12 },
    'currency-favor': { x: 1440, y: 120, zIndex: 12 },
    'reputation-counter': { x: 1440, y: 168, zIndex: 12 },
  };
  const elements = HUD_ELEMENT_CATALOG.map((entry) =>
    createHudElementFromCatalog(entry, positions[entry.type] ?? {}, base)
  );
  return {
    schemaVersion: HUD_SCHEMA_VERSION,
    layoutId: 'default-player-hud',
    name: 'Default Player HUD',
    baseResolution: base,
    safeArea: { top: 24, right: 24, bottom: 24, left: 24 },
    settings: { snapToGrid: true, gridSize: 8, responsiveScaling: true, nudgeStep: 10 },
    elements,
    states: {
      default: {},
      exploration: {},
      combat: {},
      lowHealth: {},
      highMagicalActivity: {},
      dialogueMinimized: {},
      mobile: {},
      spectator: {},
    },
  };
}

// --- Validation -----------------------------------------------------------

export interface HudValidationIssue {
  level: 'error' | 'warning';
  elementId?: string;
  field?: string;
  message: string;
}

export interface HudValidationResult {
  valid: boolean;
  errors: HudValidationIssue[];
  warnings: HudValidationIssue[];
}

/**
 * Validate a HUD layout. `strict` (publish) treats out-of-viewport elements as
 * errors unless they set `metadata.allowOffscreen === true`.
 */
export function validateHudLayout(
  doc: HudLayoutDocument,
  options: { strict?: boolean } = {}
): HudValidationResult {
  const errors: HudValidationIssue[] = [];
  const warnings: HudValidationIssue[] = [];
  const push = (
    level: 'error' | 'warning',
    message: string,
    elementId?: string,
    field?: string
  ): void => {
    (level === 'error' ? errors : warnings).push({ level, message, elementId, field });
  };

  if (!doc || typeof doc !== 'object') {
    return { valid: false, errors: [{ level: 'error', message: 'Layout document is missing or malformed.' }], warnings: [] };
  }
  if (!doc.layoutId?.trim()) push('error', 'Layout id is required.');
  if (!doc.name?.trim()) push('error', 'Layout name is required.');

  const base = doc.baseResolution;
  if (!base || !(base.width > 0) || !(base.height > 0)) {
    push('error', 'Base resolution must have positive width and height.');
  }

  if (!Array.isArray(doc.elements)) {
    push('error', 'Layout must contain an elements array.');
    return { valid: errors.length === 0, errors, warnings };
  }

  const seen = new Set<string>();
  for (const el of doc.elements) {
    if (!el.id?.trim()) {
      push('error', 'Element is missing an id.', el.id);
      continue;
    }
    if (seen.has(el.id)) push('error', `Duplicate element id "${el.id}".`, el.id);
    seen.add(el.id);

    if (!HUD_ANCHORS.includes(el.anchor)) push('error', `Invalid anchor "${el.anchor}".`, el.id, 'anchor');
    if (!(el.width > 0)) push('error', 'Width must be greater than zero.', el.id, 'width');
    if (!(el.height > 0)) push('error', 'Height must be greater than zero.', el.id, 'height');
    if (!(el.scaleX > 0)) push('error', 'Scale X must be greater than zero.', el.id, 'scaleX');
    if (!(el.scaleY > 0)) push('error', 'Scale Y must be greater than zero.', el.id, 'scaleY');
    if (el.opacity < 0 || el.opacity > 1) push('warning', 'Opacity should be between 0 and 1.', el.id, 'opacity');

    if (el.enabled && !el.asset && !el.assets?.default && needsAsset(el.type)) {
      push('error', 'Required asset is missing.', el.id, 'asset');
    }

    if (el.bindings) {
      for (const [key, binding] of Object.entries(el.bindings)) {
        if (!binding || typeof binding.path !== 'string' || !binding.path.trim()) {
          push('error', `Binding "${key}" has a malformed data path.`, el.id, `bindings.${key}`);
        }
      }
    }

    // Viewport bounds check
    if (base && base.width > 0) {
      const outLeft = el.x + el.width < 0;
      const outTop = el.y + el.height < 0;
      const outRight = el.x > base.width;
      const outBottom = el.y > base.height;
      if (outLeft || outTop || outRight || outBottom) {
        const allow = el.metadata?.allowOffscreen === true;
        if (options.strict && !allow) {
          push('error', 'Element is fully outside the viewport.', el.id);
        } else if (!allow) {
          push('warning', 'Element is outside the viewport.', el.id);
        }
      }
    }
  }

  // State references
  if (doc.states) {
    for (const [stateId, overrides] of Object.entries(doc.states)) {
      for (const elId of Object.keys(overrides ?? {})) {
        if (!seen.has(elId)) {
          push('error', `State "${stateId}" references nonexistent element "${elId}".`, elId);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

const ASSET_REQUIRED_TYPES = new Set(['player-status', 'awareness-meter', 'hotbar']);
function needsAsset(type: string): boolean {
  return ASSET_REQUIRED_TYPES.has(type);
}

/** Resolve the effective element (base merged with a state's overrides). */
export function resolveElementForState(
  el: HudElement,
  doc: HudLayoutDocument,
  stateId: HudStateId
): HudElement & { assetVariant?: HudAssetVariant } {
  if (stateId === 'default') return el;
  const override = doc.states?.[stateId]?.[el.id];
  if (!override) return el;
  return { ...el, ...override };
}

/**
 * Axis-aligned rect of an element in viewport space. Uses the same geometry as
 * the admin HUD editor (`displayRect`) so published positions match exactly.
 */
export function resolveHudElementRect(
  el: HudElement,
  base: HudResolution,
  viewport: HudResolution = base
): { x: number; y: number; w: number; h: number } {
  const w = el.width * el.scaleX;
  const h = el.height * el.scaleY;
  const sx = base.width ? viewport.width / base.width : 1;
  const sy = base.height ? viewport.height / base.height : 1;
  const a = anchorToNormalized(el.anchor);
  let x: number;
  let y: number;
  if (el.positionMode === 'anchored') {
    x = a.x * base.width - a.x * w + el.offsetX;
    y = a.y * base.height - a.y * h + el.offsetY;
  } else if (el.positionMode === 'responsive') {
    x = el.normalizedX * base.width;
    y = el.normalizedY * base.height;
  } else {
    x = el.x;
    y = el.y;
  }
  return { x: x * sx, y: y * sy, w: w * sx, h: h * sy };
}
