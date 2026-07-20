import {
  resolveElementForState,
  resolveHudElementRect,
  type HudElement,
  type HudLayoutDocument,
  type HudResolution,
} from '@witchcraft/shared';
import { themeManager } from './ThemeManager.js';

/** Public HUD layout endpoint — no auth cookies required. */
function hudApiUrl(): string {
  if (import.meta.env.DEV) return '/api/game/hud/active';
  const base =
    import.meta.env.VITE_SERVER_URL?.replace('ws://', 'http://').replace('wss://', 'https://') ??
    'http://localhost:2567';
  return `${base}/api/game/hud/active`;
}

const POLL_MS = 3000;
const LAYOUT_CLASS = 'hud-layout-driven';
const LIVE_CACHE_KEY = 'wc-hud-live';

/** Roots that can receive layout overrides (cleared back to CSS when collapsed / no doc). */
const LAYOUT_ROOT_IDS = [
  'hud-nav',
  'hud-moon-panel',
  'hud-resources',
] as const;

/** Resource counters are separate catalog types but one live DOM stack. */
const RESOURCE_TYPES = [
  'currency-coins',
  'currency-essence',
  'currency-favor',
  'reputation-counter',
] as const;

type Rect = { x: number; y: number; w: number; h: number };

/**
 * Fetches published HUD layouts and drives live placement.
 *
 * - Intuition meter: always parent-relative to the nameplate (collapsed + expanded).
 * - Nav / moon / resources: layout JSON applied only while the HUD is expanded,
 *   in hud-root logical space (viewport ÷ --hud-scale) so expand/collapse and
 *   auto-fit scaling stay intact.
 */
class HudLayoutRuntime {
  private doc: HudLayoutDocument | null = null;
  private pollTimer: number | null = null;
  private applyQueued = false;
  private bound = false;

  async load(): Promise<void> {
    this.bindOnce();
    this.tryLocalCache();
    try {
      const res = await fetch(`${hudApiUrl()}?_${Date.now()}`, { cache: 'no-store' });
      if (res.status === 204) {
        this.doc = null;
        this.apply();
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.doc = (await res.json()) as HudLayoutDocument;
      this.apply();
    } catch (err) {
      console.warn('[HUD] layout fetch failed — using CSS theme placement', err);
      this.apply();
    }
  }

  applyDocument(doc: HudLayoutDocument): void {
    this.doc = doc;
    this.apply();
  }

  private tryLocalCache(): void {
    try {
      const raw = localStorage.getItem(LIVE_CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { doc?: HudLayoutDocument };
      if (parsed.doc) {
        this.doc = parsed.doc;
        this.apply();
      }
    } catch {
      /* ignore corrupt cache */
    }
  }

  private bindOnce(): void {
    if (this.bound) return;
    this.bound = true;
    window.addEventListener('game:hud-scale-changed', () => this.apply());
    window.addEventListener('resize', () => this.apply());
    window.addEventListener('game:world-ready', () => this.apply());
    window.addEventListener('storage', (e) => {
      if (e.key !== LIVE_CACHE_KEY || !e.newValue) return;
      try {
        const parsed = JSON.parse(e.newValue) as { doc?: HudLayoutDocument };
        if (parsed.doc) this.applyDocument(parsed.doc);
      } catch {
        /* ignore */
      }
    });
    this.pollTimer = window.setInterval(() => void this.load(), POLL_MS);
  }

  apply(): void {
    if (this.applyQueued) return;
    this.applyQueued = true;
    requestAnimationFrame(() => {
      this.applyQueued = false;
      this.applyNow();
    });
  }

  private clearLayoutStyles(el: HTMLElement): void {
    el.classList.remove(LAYOUT_CLASS);
    for (const prop of [
      'display',
      'position',
      'left',
      'top',
      'right',
      'bottom',
      'width',
      'height',
      'margin',
      'transform',
      'opacity',
      'z-index',
      'visibility',
      'pointer-events',
    ]) {
      el.style.removeProperty(prop);
    }
  }

  private stripForcedPlacement(): void {
    for (const id of LAYOUT_ROOT_IDS) {
      const el = document.getElementById(id);
      if (el) this.clearLayoutStyles(el);
    }
  }

  private hudRootViewport(): HudResolution {
    const scale = Math.max(0.01, themeManager.getCombinedScale());
    return {
      width: window.innerWidth / scale,
      height: window.innerHeight / scale,
    };
  }

  private elementRect(el: HudElement, doc: HudLayoutDocument, viewport: HudResolution): Rect {
    return resolveHudElementRect(el, doc.baseResolution, viewport);
  }

  private resolveType(doc: HudLayoutDocument, type: string): HudElement | null {
    const base = doc.elements.find((e) => e.type === type);
    if (!base) return null;
    return resolveElementForState(base, doc, 'default');
  }

  private unionRects(rects: Rect[]): Rect | null {
    if (rects.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const r of rects) {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w);
      maxY = Math.max(maxY, r.y + r.h);
    }
    return { x: minX, y: minY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) };
  }

  private placeRoot(
    domId: string,
    rect: Rect,
    viewport: HudResolution,
    opts: {
      zIndex?: number;
      opacity?: number;
      size?: boolean;
      /** Align using bottom edge (nav/resources live taller than catalog boxes). */
      pinBottom?: boolean;
      pinRight?: boolean;
    } = {},
  ): void {
    const el = document.getElementById(domId);
    if (!el) return;
    el.classList.add(LAYOUT_CLASS);
    el.style.position = 'absolute';
    el.style.margin = '0';
    el.style.transform = 'none';
    el.style.visibility = 'visible';
    el.style.pointerEvents = 'auto';
    el.style.opacity = String(typeof opts.opacity === 'number' ? opts.opacity : 1);

    if (opts.pinBottom) {
      el.style.top = 'auto';
      el.style.bottom = `${Math.max(0, Math.round(viewport.height - (rect.y + rect.h)))}px`;
    } else {
      el.style.bottom = 'auto';
      el.style.top = `${Math.round(rect.y)}px`;
    }

    if (opts.pinRight) {
      el.style.left = 'auto';
      el.style.right = `${Math.max(0, Math.round(viewport.width - (rect.x + rect.w)))}px`;
    } else {
      el.style.right = 'auto';
      el.style.left = `${Math.round(rect.x)}px`;
    }

    if (opts.size) {
      if (rect.w > 0) el.style.width = `${Math.round(rect.w)}px`;
      if (rect.h > 0) el.style.height = `${Math.round(rect.h)}px`;
    }
    if (typeof opts.zIndex === 'number') el.style.zIndex = String(opts.zIndex);
  }

  private hideRoot(domId: string): void {
    const el = document.getElementById(domId);
    if (!el) return;
    el.classList.add(LAYOUT_CLASS);
    el.style.visibility = 'hidden';
    el.style.pointerEvents = 'none';
    el.style.opacity = '0';
  }

  private applyExpandedChrome(doc: HudLayoutDocument): void {
    const viewport = this.hudRootViewport();

    // Navigation row — missing from layout ⇒ keep CSS; disabled ⇒ hide.
    // Pin to layout bottom so tall live sprites stay on-screen (catalog box is short).
    const nav = this.resolveType(doc, 'nav-buttons');
    if (nav && !nav.enabled) {
      this.hideRoot('hud-nav');
    } else if (nav) {
      this.placeRoot('hud-nav', this.elementRect(nav, doc, viewport), viewport, {
        zIndex: nav.zIndex || 1450,
        opacity: nav.opacity,
        pinBottom: true,
      });
    }

    // Moon / time / location panel
    const moon = this.resolveType(doc, 'world-panel');
    if (moon && !moon.enabled) {
      this.hideRoot('hud-moon-panel');
    } else if (moon) {
      this.placeRoot('hud-moon-panel', this.elementRect(moon, doc, viewport), viewport, {
        zIndex: moon.zIndex,
        opacity: moon.opacity,
        size: true,
      });
    }

    // Resource stack — union of currency / reputation catalog entries
    const resourceRects: Rect[] = [];
    let resourceZ = 1410;
    let resourceOpacity = 1;
    let anyResource = false;
    let anyEnabled = false;
    for (const type of RESOURCE_TYPES) {
      const entry = this.resolveType(doc, type);
      if (!entry) continue;
      anyResource = true;
      if (!entry.enabled) continue;
      anyEnabled = true;
      resourceRects.push(this.elementRect(entry, doc, viewport));
      resourceZ = Math.max(resourceZ, entry.zIndex);
      resourceOpacity = Math.min(resourceOpacity, entry.opacity);
    }

    if (anyResource && !anyEnabled) {
      this.hideRoot('hud-resources');
    } else if (anyEnabled) {
      const union = this.unionRects(resourceRects);
      if (union) {
        this.placeRoot('hud-resources', union, viewport, {
          zIndex: resourceZ,
          opacity: resourceOpacity,
          pinBottom: true,
          pinRight: true,
        });
      }
    }
  }

  private applyIntuitionRelative(doc: HudLayoutDocument | null): void {
    const slot = document.getElementById('hud-player-panel-intuition');
    if (!slot) return;
    if (!doc) {
      this.clearIntuitionInline();
      return;
    }
    const awareness = doc.elements.find((e) => e.type === 'awareness-meter');
    if (!awareness) {
      this.clearIntuitionInline();
      return;
    }
    const resolved = resolveElementForState(awareness, doc, 'default');
    const meta = resolved.metadata ?? {};
    const parentType = typeof meta.parentType === 'string' ? meta.parentType : null;
    const hasRelative =
      parentType === 'player-status' &&
      typeof meta.parentRelativeX === 'number' &&
      typeof meta.parentRelativeY === 'number';

    if (!hasRelative) {
      this.clearIntuitionInline();
      return;
    }

    const relX = meta.parentRelativeX as number;
    const relY = meta.parentRelativeY as number;
    const relW =
      typeof meta.parentRelativeWidth === 'number' && Number.isFinite(meta.parentRelativeWidth)
        ? (meta.parentRelativeWidth as number)
        : 0.67;

    slot.style.left = `${(relX * 100).toFixed(2)}%`;
    slot.style.top = `${(relY * 100).toFixed(2)}%`;
    slot.style.width = `${(relW * 100).toFixed(2)}%`;
    slot.style.transform = 'translateY(-10%)';
  }

  private clearIntuitionInline(): void {
    const slot = document.getElementById('hud-player-panel-intuition');
    if (!slot) return;
    slot.style.removeProperty('left');
    slot.style.removeProperty('top');
    slot.style.removeProperty('width');
    slot.style.removeProperty('transform');
  }

  private applyNow(): void {
    this.stripForcedPlacement();
    this.applyIntuitionRelative(this.doc);

    const expanded = document.body.classList.contains('hud-expanded');
    if (expanded && this.doc) {
      this.applyExpandedChrome(this.doc);
    }
  }
}

export const hudLayoutRuntime = new HudLayoutRuntime();
