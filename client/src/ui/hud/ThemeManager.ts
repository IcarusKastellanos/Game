import { loadHudPrefs, saveHudPrefs } from './hud-prefs.js';

const USER_SCALE_MIN = 0.5;
const USER_SCALE_MAX = 2.5;
/** Absolute floor so the HUD never collapses to nothing on tiny windows. */
const COMBINED_MIN = 0.3;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Native player panel art size (portrait_frame.png). */
export const PLAYER_PANEL_NATIVE = { width: 573, height: 318 };

/**
 * Real layout bounding boxes (in HUD-root px) that must fit inside the window
 * with no overlap. The "fit" scale is the largest scale at which the box still
 * fits the viewport — used as the 100% baseline for the UI Scale slider.
 */
const HUD_FOOTPRINT = {
  collapsed: {
    width: PLAYER_PANEL_NATIVE.width,
    height: PLAYER_PANEL_NATIVE.height,
    marginX: 16,
    marginY: 80,
  },
  expanded: { width: 1680, height: 860, marginX: 24, marginY: 32 },
};

/** Keep the collapsed status panel modest — a corner element, not a banner. */
function collapsedPanelCap(): number {
  const maxW = window.innerWidth * 0.26;
  const maxH = (window.innerHeight - 80) * 0.3;
  return Math.min(maxW / PLAYER_PANEL_NATIVE.width, maxH / PLAYER_PANEL_NATIVE.height, 0.55);
}

/** Largest scale at which the given state's footprint fits the current window. */
function maxFitScale(expanded: boolean): number {
  const box = expanded ? HUD_FOOTPRINT.expanded : HUD_FOOTPRINT.collapsed;
  const sx = (window.innerWidth - box.marginX * 2) / box.width;
  const sy = (window.innerHeight - box.marginY * 2) / box.height;
  return Math.min(sx, sy);
}

/**
 * Global HUD scaling. Everything in `.hud-root` is uniformly scaled by
 * `--hud-scale`.
 *
 * Prefs `scale` is a **multiplier of the window-fit baseline**:
 * - 1.0 = recommended fit (100%)
 * - 0.5 = half of fit
 * - 1.5 = 50% larger than fit
 *
 * Absolute applied scale is still hard-capped at USER_SCALE_MAX so the HUD
 * cannot grow without bound on huge monitors.
 */
export class ThemeManager {
  private userScale = 1;
  private ceiling = 1;
  private combined = 1;
  private resizeListener: (() => void) | null = null;

  apply(): void {
    const prefs = loadHudPrefs();
    this.userScale = this.normalizeUserScale(prefs.scale);
    if (prefs.scale !== this.userScale) {
      prefs.scale = this.userScale;
      saveHudPrefs(prefs);
    }
    document.documentElement.classList.add('practitioner-hud-theme');
    this.refreshFitScale();
    this.bindResize();
  }

  setScale(scale: number): void {
    this.userScale = this.normalizeUserScale(scale);
    const prefs = loadHudPrefs();
    prefs.scale = this.userScale;
    saveHudPrefs(prefs);
    this.applyCombinedScale();
  }

  /** User scale multiplier relative to window fit (1.0 = 100% of fit). */
  getScale(): number {
    return this.userScale;
  }

  /** Window-fit baseline for the current collapsed/expanded state. */
  getFitScale(): number {
    return this.ceiling;
  }

  /** Effective absolute scale applied to `.hud-root`. */
  getCombinedScale(): number {
    return this.combined;
  }

  refreshFitScale(hudExpanded?: boolean): void {
    const expanded = hudExpanded ?? document.body.classList.contains('hud-expanded');
    const fit = maxFitScale(expanded);
    this.ceiling = expanded ? Math.max(0.35, fit) : Math.min(Math.max(0.35, fit), collapsedPanelCap());
    this.applyCombinedScale();
  }

  /** Convert legacy absolute prefs (often 1.54+) into fit-relative multipliers. */
  private normalizeUserScale(raw: number): number {
    if (!Number.isFinite(raw)) return 1;
    // Legacy absolute targets that sat permanently above every window-fit cap.
    if (raw > 1.35) return 1;
    return clamp(raw, USER_SCALE_MIN, USER_SCALE_MAX);
  }

  private applyCombinedScale(): void {
    // Multiplier of the fit baseline, with an absolute ceiling for sanity.
    this.combined = clamp(this.ceiling * this.userScale, COMBINED_MIN, USER_SCALE_MAX);
    const root = document.documentElement;
    root.style.setProperty('--hud-user-scale', String(this.userScale));
    root.style.setProperty('--hud-fit-scale', String(this.ceiling));
    root.style.setProperty('--hud-scale', String(this.combined));
    window.dispatchEvent(new CustomEvent('game:hud-scale-changed'));
  }

  private bindResize(): void {
    if (this.resizeListener) return;
    let frame = 0;
    this.resizeListener = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => this.refreshFitScale());
    };
    window.addEventListener('resize', this.resizeListener);
  }
}

export const themeManager = new ThemeManager();
