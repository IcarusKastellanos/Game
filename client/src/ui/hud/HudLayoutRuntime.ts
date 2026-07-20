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
const LIVE_CACHE_KEY = 'wc-hud-live';

/**
 * Fetches published HUD layouts for intuition offset metadata.
 *
 * Nav, resources, moon, and the nameplate use CSS theme placement. Absolute
 * layout-JSON overrides for those roots were reverted — catalog boxes do not
 * match live sprite sizes and pushed nav off-screen / stacked resources on the
 * moon panel. Intuition stays nameplate-relative via metadata.
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

  /** Clear any leftover inline overrides from earlier layout experiments. */
  private clearChromeInlineStyles(): void {
    for (const id of ['hud-nav', 'hud-moon-panel', 'hud-resources'] as const) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.classList.remove('hud-layout-driven');
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
    this.clearChromeInlineStyles();
    this.applyIntuitionRelative(this.doc);
  }
}

export const hudLayoutRuntime = new HudLayoutRuntime();
