import {
  resolveElementForState,
  type HudLayoutDocument,
} from '@witchcraft/shared';

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

/** Roots that must keep theme CSS placement (not absolute layout JSON coords). */
const CSS_PLACED_IDS = [
  'hud-player-panel',
  'hud-nav',
  'hud-moon-panel',
  'hud-resources',
  'hud-compass',
] as const;

/**
 * Fetches published HUD layouts for live editor sync / intuition offset metadata.
 *
 * Nav, resources, moon, and the nameplate stay on CSS theme placement. Mapping
 * 1920×1080 layout JSON into the scaled hud-root broke expand/collapse and
 * hid the nav icons — do not reintroduce absolute overrides here until the
 * coordinate spaces are reconciled.
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
      if (!raw) {
        this.doc = null;
        this.apply();
        return;
      }
      const parsed = JSON.parse(raw) as { doc?: HudLayoutDocument };
      if (parsed.doc) {
        this.doc = parsed.doc;
        this.apply();
      }
    } catch {
      this.doc = null;
      this.apply();
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
    ]) {
      el.style.removeProperty(prop);
    }
  }

  private stripForcedPlacement(): void {
    for (const id of CSS_PLACED_IDS) {
      const el = document.getElementById(id);
      if (el) this.clearLayoutStyles(el);
    }
    const compass = document.getElementById('hud-compass');
    const frame = compass?.querySelector('.hud-intuition__frame') as HTMLElement | null;
    if (frame) {
      frame.style.removeProperty('width');
      frame.style.removeProperty('height');
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
  }
}

export const hudLayoutRuntime = new HudLayoutRuntime();
