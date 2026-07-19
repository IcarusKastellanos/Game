import { gameState } from '../../data/game-state.js';
import { hudSprites } from './hud-assets.js';
import { tooltipManager } from './TooltipManager.js';
import {
  clamp,
  combineDetection,
  lerp,
  strengthToState,
  visualsForStrength,
  type IntuitionPlayer,
  type IntuitionSource,
  type IntuitionState,
} from './intuition.js';

/** Admin/debug preview override — never mutates real player data. */
export interface IntuitionPreview {
  active: boolean;
  magicActivity?: number;
  spiritActivity?: number;
  intuition?: number;
  spiritualAwareness?: number;
  distance?: number;
  detectionRadius?: number;
  concealment?: number;
  interference?: number;
  /** Direct 0..1 strength override (bypasses the detection calc). */
  strength?: number;
  /** Toggle particle emission in preview. */
  particles?: boolean;
  /** Pin the eye to the overwhelming state. */
  forceOverwhelming?: boolean;
  /** Animation-speed multiplier for preview (1 = normal). */
  animationScale?: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

const SMOOTHING_SPEED = 2.4;
const PARTICLE_COLORS = ['#b98cff', '#8a5fe0', '#d9c7ff', '#a87bf0', '#ffffff'];

function parseStats(): { intuition?: number; spiritualAwareness?: number } | null {
  if (!gameState.localPlayer?.statsJson) return null;
  try {
    return JSON.parse(gameState.localPlayer.statsJson);
  } catch {
    return null;
  }
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Intuition Meter — a magical eye that awakens in response to nearby unseen
 * magical and spiritual forces. Not a compass or directional detector.
 */
export class CompassWidget {
  readonly root: HTMLDivElement;

  private frame!: HTMLDivElement;
  private iris!: HTMLDivElement;
  private lid!: HTMLDivElement;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D | null;

  private displayStrength = 0;
  private state: IntuitionState = 'dormant';
  private explicitSources: IntuitionSource[] | null = null;
  private preview: IntuitionPreview = { active: false };

  private particles: Particle[] = [];
  private particleAccumulator = 0;
  private lastFrame = 0;
  private nextBlink = 3;
  private blinkTimer = 0;
  private openAmount = 0.15;
  private reducedMotion = prefersReducedMotion();

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'hud-intuition';
    this.root.id = 'hud-compass';
    this.build();

    tooltipManager.bind(this.root, () => this.tooltipHtml());
    window.addEventListener('game:player-sync', () => this.updateStateLabel());

    if (typeof window.matchMedia === 'function') {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      const onChange = (): void => {
        this.reducedMotion = mq.matches;
      };
      mq.addEventListener?.('change', onChange);
    }

    this.lastFrame = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  /** Feed real world sources from gameplay systems (optional). */
  setSources(sources: IntuitionSource[] | null): void {
    this.explicitSources = sources && sources.length ? sources : null;
  }

  /** Admin preview override; pass null to clear. */
  setPreview(preview: IntuitionPreview | null): void {
    this.preview = preview ?? { active: false };
  }

  /** Mount inside the player nameplate so the eye scales and moves with it. */
  attachTo(slot: HTMLElement): void {
    if (this.root.parentElement !== slot) {
      slot.appendChild(this.root);
    }
    this.root.classList.remove('hud-layout-driven');
    for (const prop of ['display', 'position', 'left', 'top', 'right', 'bottom', 'margin', 'transform', 'opacity', 'z-index']) {
      this.root.style.removeProperty(prop);
    }
    const frame = this.root.querySelector('.hud-intuition__frame') as HTMLElement | null;
    if (frame) {
      frame.style.removeProperty('width');
      frame.style.removeProperty('height');
    }
  }

  /** Legacy no-op kept for callers that still invoke render(). */
  render(): void {
    this.updateStateLabel();
  }

  private build(): void {
    this.root.innerHTML = `
      <div class="hud-intuition__frame">
        <img class="hud-intuition__eye" src="${hudSprites.intuition.eye}" alt="" draggable="false" />
        <div class="hud-intuition__runes" aria-hidden="true"></div>
        <div class="hud-intuition__aura" aria-hidden="true"></div>
        <div class="hud-intuition__iris" aria-hidden="true"></div>
        <div class="hud-intuition__lid" aria-hidden="true"></div>
        <canvas class="hud-intuition__particles" aria-hidden="true"></canvas>
      </div>`;
    this.frame = this.root.querySelector('.hud-intuition__frame') as HTMLDivElement;
    this.iris = this.root.querySelector('.hud-intuition__iris') as HTMLDivElement;
    this.lid = this.root.querySelector('.hud-intuition__lid') as HTMLDivElement;
    this.canvas = this.root.querySelector('.hud-intuition__particles') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d');
  }

  // ── Detection ──────────────────────────────────────────────────────────
  private readPlayer(): IntuitionPlayer {
    const stats = parseStats();
    return {
      intuition: this.preview.active ? this.preview.intuition ?? 50 : stats?.intuition ?? 0,
      spiritualAwareness: this.preview.active
        ? this.preview.spiritualAwareness ?? 50
        : stats?.spiritualAwareness ?? 0,
      temporaryModifiers: 0,
      buffModifier: 1,
      interference: this.preview.active ? this.preview.interference ?? 0 : this.environmentInterference(),
      statCeiling: 100,
    };
  }

  private environmentInterference(): number {
    // Busy town squares add a little ambient noise that dampens perception.
    const nearby = gameState.nearbyPlayers?.length ?? 0;
    return clamp(nearby * 0.04, 0, 0.35);
  }

  /**
   * Synthesize an ambient source from existing world signals so the eye reacts
   * believably before dedicated magic-source data exists. Real systems can
   * override this via setSources().
   */
  private ambientSources(): IntuitionSource[] {
    const questActive =
      !!gameState.progression?.questProgress &&
      Object.keys(gameState.progression.questProgress).length > 0;
    const nearby = gameState.nearbyPlayers?.length ?? 0;
    const hearth = gameState.currentScene === 'apartment' && !gameState.visitingHostSessionId;
    const hour = gameState.worldHour ?? 12;
    const night = hour >= 20 || hour < 5;

    const magicActivity = clamp(
      0.04 + nearby * 0.1 + (questActive ? 0.22 : 0) + (gameState.familiar ? 0.08 : 0),
      0,
      1
    );
    const spiritActivity = clamp(
      0.04 + (hearth ? 0.16 : 0) + (night ? 0.18 : 0) + (gameState.visitingHostSessionId ? 0.12 : 0),
      0,
      1
    );

    return [
      {
        magicActivity,
        spiritActivity,
        distance: 0,
        detectionRadius: 1,
        concealment: 0.1,
        status: night ? 'active' : 'dormant',
      },
    ];
  }

  private computeTarget(): number {
    if (this.preview.active) {
      if (this.preview.forceOverwhelming) return 1;
      if (typeof this.preview.strength === 'number') return clamp(this.preview.strength, 0, 1);
      const player = this.readPlayer();
      const source: IntuitionSource = {
        magicActivity: this.preview.magicActivity ?? 0.5,
        spiritActivity: this.preview.spiritActivity ?? 0.5,
        distance: this.preview.distance ?? 0,
        detectionRadius: this.preview.detectionRadius ?? 1,
        concealment: this.preview.concealment ?? 0,
        status: 'active',
      };
      return combineDetection([source], player);
    }
    const player = this.readPlayer();
    const sources = this.explicitSources ?? this.ambientSources();
    return combineDetection(sources, player);
  }

  // ── Animation loop ─────────────────────────────────────────────────────
  private loop(now: number): void {
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    // Visible in both the passive (under the portrait) and activated (top-center) HUD.
    const visible = document.body.classList.contains('hud-ready');

    if (visible) {
      const target = this.computeTarget();
      this.displayStrength = lerp(this.displayStrength, target, dt * SMOOTHING_SPEED);
      if (Math.abs(target - this.displayStrength) < 0.002) this.displayStrength = target;
      this.applyVisuals(dt);
    }

    requestAnimationFrame((t) => this.loop(t));
  }

  private applyVisuals(dt: number): void {
    const s = this.displayStrength;
    const v = visualsForStrength(s);
    const newState = strengthToState(s);
    if (newState !== this.state) {
      this.state = newState;
      this.root.dataset.state = newState;
      this.updateStateLabel();
    }

    const animScale = this.preview.active ? this.preview.animationScale ?? 1 : 1;
    const reduced = this.reducedMotion;

    // Eye open amount + blink handling.
    const targetOpen = s < 0.15 ? 0.15 : lerp(0.55, 1, clamp((s - 0.15) / 0.85, 0, 1));
    if (!reduced && s >= 0.15 && s < 0.85) {
      this.blinkTimer += dt;
      if (this.blinkTimer >= this.nextBlink) {
        this.blinkTimer = 0;
        this.nextBlink = 4 + Math.random() * 6;
      }
    }
    const blinking = this.blinkTimer < 0.16 && this.blinkTimer > 0 && !reduced && s >= 0.15 && s < 0.85;
    this.openAmount = lerp(this.openAmount, blinking ? 0.1 : targetOpen, dt * 10);

    const style = this.root.style;
    style.setProperty('--glow-opacity', v.glowOpacity.toFixed(3));
    style.setProperty('--glow-radius', `${v.glowRadius.toFixed(1)}px`);
    style.setProperty('--iris-bright', v.irisBrightness.toFixed(3));
    style.setProperty('--rune-bright', v.runeBrightness.toFixed(3));
    style.setProperty('--aura-opacity', v.auraOpacity.toFixed(3));
    style.setProperty('--pulse-depth', v.pulseDepth.toFixed(3));
    style.setProperty('--lid-opacity', (1 - this.openAmount).toFixed(3));

    const pulseDuration = reduced || v.pulseDuration === 0 ? 0 : v.pulseDuration / clamp(animScale, 0.1, 4);
    if (pulseDuration === 0) {
      this.iris.style.animation = 'none';
    } else {
      this.iris.style.animation = `hud-eye-pulse ${pulseDuration.toFixed(2)}s ease-in-out infinite`;
    }

    // Particles.
    const particlesOn =
      !reduced &&
      (this.preview.active ? this.preview.particles !== false : true) &&
      v.particleRate > 0.1;
    this.updateParticles(dt, particlesOn ? v.particleRate : 0, v);
  }

  // ── Particles ──────────────────────────────────────────────────────────
  private ensureCanvasSize(): void {
    const w = this.frame.clientWidth;
    const h = this.frame.clientHeight;
    if (!w || !h) return;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  private updateParticles(dt: number, rate: number, v: ReturnType<typeof visualsForStrength>): void {
    if (!this.ctx) return;
    this.ensureCanvasSize();
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (!w || !h) return;

    if (rate > 0) {
      this.particleAccumulator += rate * dt;
      while (this.particleAccumulator >= 1) {
        this.particleAccumulator -= 1;
        this.spawnParticle(w, h, v);
      }
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    // Overwhelming particles are more numerous but move slowly & heavily.
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy -= dt * 4; // gentle upward drift
      const t = p.life / p.maxLife;
      const alpha = Math.sin(clamp(t, 0, 1) * Math.PI) * 0.85;
      const r = p.size;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.4);
      g.addColorStop(0, this.withAlpha(p.color, alpha));
      g.addColorStop(1, this.withAlpha(p.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  private spawnParticle(w: number, h: number, v: ReturnType<typeof visualsForStrength>): void {
    // Spawn around the eye (~center) and upper frame.
    const cx = w * 0.505;
    const cy = h * 0.46;
    const spread = w * 0.16;
    const x = cx + (Math.random() - 0.5) * spread;
    const y = cy + (Math.random() - 0.5) * spread * 0.7;
    const overwhelming = this.displayStrength >= 0.85;
    const speed = overwhelming ? 6 + Math.random() * 8 : 12 + Math.random() * 16;
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.1;
    this.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: v.particleLifetime * (0.7 + Math.random() * 0.6),
      maxLife: v.particleLifetime,
      size: Math.max(1, v.particleSize * (0.6 + Math.random() * 0.8)),
      color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
    });
    if (this.particles.length > 220) this.particles.splice(0, this.particles.length - 220);
  }

  private withAlpha(hex: string, alpha: number): string {
    const n = hex.replace('#', '');
    const r = parseInt(n.substring(0, 2), 16);
    const g = parseInt(n.substring(2, 4), 16);
    const b = parseInt(n.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1).toFixed(3)})`;
  }

  // ── Tooltip ────────────────────────────────────────────────────────────
  private updateStateLabel(): void {
    this.root.dataset.state = this.state;
  }

  private tooltipHtml(): string {
    const labels: Record<IntuitionState, string> = {
      dormant: 'Dormant — the veil is quiet',
      faint: 'Faint Presence — a whisper on the wind',
      active: 'Active Presence — currents stir nearby',
      strong: 'Strong Presence — power gathers close',
      overwhelming: 'Overwhelming Presence — the unseen presses in',
    };
    const stats = parseStats();
    return [
      '<strong>Intuition Meter</strong>',
      labels[this.state],
      `Intuition ${stats?.intuition ?? 0} · Awareness ${stats?.spiritualAwareness ?? 0}`,
      '<em>Reacts to nearby magic, spirits, and occult disturbances</em>',
    ].join('<br/>');
  }
}

export const compassWidget = new CompassWidget();
