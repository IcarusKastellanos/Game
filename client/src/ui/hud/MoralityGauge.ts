/**
 * Morality gauge — ornate red→green alignment bar with a moving gold slider.
 *
 * The single source PNG (`/assets/hud/morality-gauge.png`) is processed once at
 * runtime into transparent layers so the baked-in central diamond can move:
 *   1. black background is removed (→ transparent)
 *   2. the central gold diamond is cropped into a standalone slider sprite
 *   3. the diamond is erased from the base bar (horizontal gradient in-fill)
 *
 * The value binds to `player.morality` on a -100..+100 scale. The slider eases
 * toward the target; threshold effects (gold particles / purple goo) are drawn
 * on an overlay canvas and are mutually exclusive.
 */

import { hudSprites } from './hud-assets.js';

const SRC = hudSprites.player.moralityGauge;
/** Standalone gold four-pointed-star sprite used as the moving slider icon. */
const SLIDER_SRC = hudSprites.player.moralitySlider;

const MIN = -100;
const MAX = 100;
const POS_THRESHOLD = 85;
const NEG_THRESHOLD = -85;

// --- Tunable layout fractions (relative to the detected gauge content box) ---
/** Background is any pixel whose brightest channel is below this (0-255). */
const BG_MAX = 44;
/** Half-width of the central diamond as a fraction of the bar's content width. */
const DIAMOND_HALF_FRAC = 0.05;
/** Slider star width as a fraction of the bar's content width (~a touch taller than the band). */
const SLIDER_WIDTH_FRAC = 0.1;
/** Column (fraction of width) sampled to measure the gradient band height. */
const SCAN_X_FRAC = 0.24;
/** Slider travel extent across the bar (fraction of content width). */
const BAR_LEFT_FRAC = 0.16;
const BAR_RIGHT_FRAC = 0.84;

/** Per-second easing rate for the slider (higher = snappier, ~300ms feel). */
const SMOOTH_SPEED = 9;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  ttl: number;
  size: number;
  kind: 'gold' | 'goo';
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class MoralityGauge {
  readonly root: HTMLDivElement;
  private stage: HTMLDivElement;
  private baseImg: HTMLImageElement;
  private slider: HTMLImageElement;
  private sliderMarker: HTMLDivElement;
  private goldGlow: HTMLDivElement;
  private purpleGlow: HTMLDivElement;
  private fx: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;

  private target = 0;
  private display = 0;
  private firstApply = true;

  private ready = false;
  /** Vertical center of the gradient band as a fraction of content height. */
  private bandCenterFrac = 0.5;
  /** Slider sprite width as a fraction of content width. */
  private sliderWidthFrac = 0.1;

  private particles: Particle[] = [];
  private goldAcc = 0;
  private gooAcc = 0;

  private raf = 0;
  private lastTs = 0;
  private reduced = false;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'hud-morality';
    this.root.id = 'hud-morality';

    this.stage = document.createElement('div');
    this.stage.className = 'hud-morality__stage';
    this.root.appendChild(this.stage);

    this.baseImg = new Image();
    this.baseImg.className = 'hud-morality__base';
    this.baseImg.alt = '';
    this.baseImg.draggable = false;
    this.stage.appendChild(this.baseImg);

    this.goldGlow = document.createElement('div');
    this.goldGlow.className = 'hud-morality__glow hud-morality__glow--gold';
    this.stage.appendChild(this.goldGlow);

    this.purpleGlow = document.createElement('div');
    this.purpleGlow.className = 'hud-morality__glow hud-morality__glow--purple';
    this.stage.appendChild(this.purpleGlow);

    this.slider = new Image();
    this.slider.className = 'hud-morality__slider';
    this.slider.alt = '';
    this.slider.draggable = false;
    this.stage.appendChild(this.slider);

    this.sliderMarker = document.createElement('div');
    this.sliderMarker.className = 'hud-morality__marker';
    this.sliderMarker.setAttribute('aria-hidden', 'true');
    this.stage.appendChild(this.sliderMarker);

    this.fx = document.createElement('canvas');
    this.fx.className = 'hud-morality__fx';
    this.stage.appendChild(this.fx);
    this.ctx = this.fx.getContext('2d');

    try {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.reduced = mq.matches;
      mq.addEventListener?.('change', (e) => (this.reduced = e.matches));
    } catch {
      this.reduced = false;
    }

    this.processSource();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  /** Set the target morality (-100..+100). First call snaps without animating. */
  setMorality(value: number): void {
    const v = clamp(Number.isFinite(value) ? value : 0, MIN, MAX);
    this.target = v;
    if (this.firstApply) {
      this.display = v;
      this.firstApply = false;
    }
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.root.remove();
  }

  // ── Source processing ──────────────────────────────────────────────────
  private processSource(): void {
    const img = new Image();
    img.onload = () => {
      try {
        this.buildLayers(img);
        this.sliderMarker.style.display = 'none';
      } catch {
        this.useRawFallback();
      }
    };
    img.onerror = () => {
      this.useCssFallback();
    };
    img.src = SRC;
  }

  private useRawFallback(): void {
    this.baseImg.src = SRC;
    this.baseImg.classList.add('hud-morality__base--raw');
    this.bandCenterFrac = 0.5;
    this.configureSlider();
    this.ready = true;
  }

  private useCssFallback(): void {
    this.root.classList.add('hud-morality--css-fallback');
    this.bandCenterFrac = 0.5;
    this.configureSlider();
    this.ready = true;
  }

  private applySliderPosition(posFrac: number): void {
    const left = `${posFrac * 100}%`;
    const top = `${this.bandCenterFrac * 100}%`;
    this.slider.style.left = left;
    this.slider.style.top = top;
    this.sliderMarker.style.left = left;
    this.sliderMarker.style.top = top;
  }

  private buildLayers(img: HTMLImageElement): void {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) throw new Error('bad image');

    const src = document.createElement('canvas');
    src.width = w;
    src.height = h;
    const sg = src.getContext('2d');
    if (!sg) throw new Error('no ctx');
    sg.drawImage(img, 0, 0);

    const id = sg.getImageData(0, 0, w, h);
    const d = id.data;

    // Remove black background and find the content bounding box.
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const mx = Math.max(d[i], d[i + 1], d[i + 2]);
        if (mx < BG_MAX) {
          d[i + 3] = 0;
        } else {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX <= minX || maxY <= minY) throw new Error('empty content');
    sg.putImageData(id, 0, 0);

    const cw = maxX - minX + 1;
    const ch = maxY - minY + 1;

    // Cropped base (transparent bg).
    const base = document.createElement('canvas');
    base.width = cw;
    base.height = ch;
    const bg = base.getContext('2d');
    if (!bg) throw new Error('no ctx');
    bg.drawImage(src, minX, minY, cw, ch, 0, 0, cw, ch);

    // Measure the gradient band vertical extent at a point over the red bar.
    const scanX = Math.round(cw * SCAN_X_FRAC);
    const { top: bandTop, bottom: bandBot } = this.measureBand(bg, scanX, cw, ch);
    this.bandCenterFrac = (bandTop + bandBot) / 2 / ch;

    // Region of the baked diamond to erase from the base (centered horizontally).
    const centerX = cw / 2;
    const dHalf = Math.max(4, Math.round(cw * DIAMOND_HALF_FRAC));
    const dx0 = clamp(Math.round(centerX - dHalf), 0, cw - 1);
    const dx1 = clamp(Math.round(centerX + dHalf), 0, cw - 1);

    // Erase the baked diamond body from the base by in-filling the gradient band
    // (horizontal interpolation between the columns bordering the diamond).
    this.eraseDiamond(bg, dx0, dx1, bandTop, bandBot);

    this.baseImg.src = base.toDataURL();
    // The moving slider is the standalone gold star sprite (not the cropped
    // diamond) so it renders crisply and with a fully transparent background.
    this.configureSlider();

    this.ready = true;
  }

  /** Point the slider at the standalone star sprite and size/center it on the band. */
  private configureSlider(): void {
    this.sliderWidthFrac = SLIDER_WIDTH_FRAC;
    this.slider.src = SLIDER_SRC;
    this.slider.style.width = `${this.sliderWidthFrac * 100}%`;
    this.slider.style.height = 'auto';
    this.slider.style.display = 'block';
    this.sliderMarker.style.display = 'none';
    this.applySliderPosition(0.5);
  }

  private measureBand(
    g: CanvasRenderingContext2D,
    x: number,
    _cw: number,
    ch: number
  ): { top: number; bottom: number } {
    let top = -1;
    let bottom = -1;
    const col = g.getImageData(x, 0, 1, ch).data;
    for (let y = 0; y < ch; y++) {
      if (col[y * 4 + 3] > 24) {
        if (top < 0) top = y;
        bottom = y;
      }
    }
    if (top < 0) {
      // Fallback: assume the band is the vertical middle third.
      return { top: Math.round(ch * 0.33), bottom: Math.round(ch * 0.66) };
    }
    return { top, bottom };
  }

  private eraseDiamond(
    g: CanvasRenderingContext2D,
    dx0: number,
    dx1: number,
    bandTop: number,
    bandBot: number
  ): void {
    const gapW = dx1 - dx0;
    const bandH = bandBot - bandTop + 1;
    if (gapW <= 0 || bandH <= 0) return;
    const leftX = clamp(dx0 - 1, 0, g.canvas.width - 1);
    const rightX = clamp(dx1 + 1, 0, g.canvas.width - 1);
    const left = g.getImageData(leftX, bandTop, 1, bandH).data;
    const right = g.getImageData(rightX, bandTop, 1, bandH).data;
    const gap = g.getImageData(dx0, bandTop, gapW, bandH);
    const gd = gap.data;
    for (let yy = 0; yy < bandH; yy++) {
      const li = yy * 4;
      for (let xx = 0; xx < gapW; xx++) {
        const t = (xx + 1) / (gapW + 1);
        const gi = (yy * gapW + xx) * 4;
        gd[gi] = lerp(left[li], right[li], t);
        gd[gi + 1] = lerp(left[li + 1], right[li + 1], t);
        gd[gi + 2] = lerp(left[li + 2], right[li + 2], t);
        gd[gi + 3] = lerp(left[li + 3], right[li + 3], t);
      }
    }
    g.putImageData(gap, dx0, bandTop);
  }

  // ── Animation loop ─────────────────────────────────────────────────────
  private loop(ts: number): void {
    this.raf = requestAnimationFrame(this.loop);
    const dt = this.lastTs ? Math.min(0.05, (ts - this.lastTs) / 1000) : 0;
    this.lastTs = ts;

    const visible =
      document.body.classList.contains('hud-ready') &&
      this.root.isConnected &&
      this.stage.getBoundingClientRect().width > 0;
    if (!visible) return;

    // Ease the slider toward the target (frame-rate independent).
    const k = 1 - Math.exp(-SMOOTH_SPEED * dt);
    this.display += (this.target - this.display) * (dt > 0 ? k : 1);
    if (Math.abs(this.target - this.display) < 0.05) this.display = this.target;

    const norm = (clamp(this.display, MIN, MAX) - MIN) / (MAX - MIN);
    const posFrac = BAR_LEFT_FRAC + norm * (BAR_RIGHT_FRAC - BAR_LEFT_FRAC);
    this.applySliderPosition(posFrac);

    // Emphasis glows + threshold intensities.
    const m = this.display;
    const goodEmphasis = clamp(m / 100, 0, 1);
    const badEmphasis = clamp(-m / 100, 0, 1);
    const posSpan = MAX - POS_THRESHOLD; // 15
    const negSpan = MIN - NEG_THRESHOLD; // -15
    const holy = clamp((m - POS_THRESHOLD) / posSpan, 0, 1);
    const corrupt = clamp((m - NEG_THRESHOLD) / negSpan, 0, 1);

    this.goldGlow.style.opacity = String(0.12 * goodEmphasis + 0.5 * holy);
    this.purpleGlow.style.opacity = String(0.12 * badEmphasis + 0.5 * corrupt);

    this.updateEffects(dt, holy, corrupt, posFrac);
  }

  private updateEffects(dt: number, holy: number, corrupt: number, posFrac: number): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const rect = this.stage.getBoundingClientRect();
    const W = Math.max(1, Math.round(rect.width));
    const H = Math.max(1, Math.round(rect.height));
    if (this.fx.width !== W || this.fx.height !== H) {
      this.fx.width = W;
      this.fx.height = H;
    }

    // Reduced motion: no moving particles — a static glow (above) carries it.
    if (this.reduced) {
      ctx.clearRect(0, 0, W, H);
      this.particles.length = 0;
      return;
    }

    const active = holy > 0 ? 'gold' : corrupt > 0 ? 'goo' : 'none';

    // Spawn (mutually exclusive).
    if (active === 'gold') {
      const rate = lerp(2, 8, holy);
      this.goldAcc += rate * dt;
      while (this.goldAcc >= 1) {
        this.goldAcc -= 1;
        this.spawnGold(W, H, posFrac, holy);
      }
    } else {
      this.goldAcc = 0;
    }
    if (active === 'goo') {
      const rate = lerp(1, 5, corrupt);
      this.gooAcc += rate * dt;
      while (this.gooAcc >= 1) {
        this.gooAcc -= 1;
        this.spawnGoo(W, H, corrupt);
      }
    } else {
      this.gooAcc = 0;
    }

    // Integrate + draw.
    ctx.clearRect(0, 0, W, H);
    const alive: Particle[] = [];
    for (const p of this.particles) {
      p.life += dt;
      if (p.life >= p.ttl) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'goo') p.vy += 60 * dt; // slight gravity
      const fade = 1 - p.life / p.ttl;
      if (p.kind === 'gold') {
        const r = p.size * (0.6 + 0.4 * fade);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, `rgba(255,232,150,${0.85 * fade})`);
        g.addColorStop(1, 'rgba(255,200,90,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const r = p.size * (0.5 + 0.5 * fade);
        ctx.fillStyle = `rgba(150,60,190,${0.8 * fade})`;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, r * 0.7, r, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      alive.push(p);
    }
    this.particles = alive;
  }

  private spawnGold(W: number, H: number, posFrac: number, holy: number): void {
    // Rise from around the slider and the green (right) half.
    const fromSlider = Math.random() < 0.5;
    const baseX = fromSlider ? posFrac : lerp(0.55, BAR_RIGHT_FRAC, Math.random());
    const x = baseX * W + (Math.random() - 0.5) * 10;
    const y = H * (0.5 + (Math.random() - 0.5) * 0.3);
    this.particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 6,
      vy: -lerp(10, 22, Math.random()),
      life: 0,
      ttl: lerp(0.6, 1.4, Math.random()),
      size: lerp(1.5, 3.2, holy) + Math.random(),
      kind: 'gold',
    });
  }

  private spawnGoo(W: number, H: number, corrupt: number): void {
    // Drip from the lower edge of the red (left) half.
    const baseX = lerp(BAR_LEFT_FRAC, 0.42, Math.random());
    const x = baseX * W + (Math.random() - 0.5) * 8;
    const y = H * 0.72;
    this.particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 3,
      vy: lerp(12, 26, Math.random()),
      life: 0,
      ttl: lerp(0.4, 1.0, Math.random()),
      size: lerp(1.4, 2.8, corrupt) + Math.random(),
      kind: 'goo',
    });
  }
}
