import Phaser from 'phaser';
import { ambientAudio } from '../audio/AmbientAudio';

/** Lifecycle phases of a teleport spell (forward + reverse halves). */
export type TeleportPhase = 'idle' | 'departing' | 'loading' | 'arriving' | 'complete';

type EffectMode = 'depart' | 'arrive';

interface Spark {
  active: boolean;
  angle: number;
  radius: number;
  /** vertical offset from the feet base, negative points up */
  y: number;
  life: number;
  maxLife: number;
  size: number;
  color: number;
  angSpeed: number;
  riseSpeed: number;
  radialSpeed: number;
}

/** Arcane blue palette — deep blue, arcane cyan, pale icy, blue-white, rare violet. */
const PALETTE = [0x1a3a8f, 0x2a6bd6, 0x3fd0ff, 0xbfe8ff, 0xeaf6ff, 0x8a6cff];
const PALETTE_WEIGHTS = [0.18, 0.22, 0.28, 0.16, 0.1, 0.06];

const TINT_ICY = { r: 0x8c, g: 0xd4, b: 0xff };
const TINT_WHITE = { r: 0xff, g: 0xff, b: 0xff };

const DEPART_DURATION = 1.6;
const ARRIVE_DURATION = 1.4;
const REDUCED_DURATION = 0.45;
const MAX_PARTICLES = 60;
const REDUCED_PARTICLES = 8;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function pickColor(): number {
  const r = Math.random();
  let acc = 0;
  for (let i = 0; i < PALETTE.length; i++) {
    acc += PALETTE_WEIGHTS[i];
    if (r <= acc) return PALETTE[i];
  }
  return PALETTE[2];
}

/**
 * Reusable, reversible teleport spell effect.
 *
 * The departure (envelop → dissolve → disappear) and arrival (reform → reveal)
 * are two halves of the same animation, driven by a single particle/glow system
 * that simply runs its envelopes forward or in reverse.
 */
export class TeleportEffect {
  private gfx: Phaser.GameObjects.Graphics;
  private sparks: Spark[] = [];
  private elapsed = 0;
  private duration = DEPART_DURATION;
  private mode: EffectMode = 'depart';
  private reduced: boolean;
  private updateHandler?: (time: number, delta: number) => void;
  private resolveFn?: () => void;
  private finished = false;
  private disposed = false;

  // Restore state captured before we mutate the player sprite.
  private origAlpha = 1;
  private baseScale = 1;

  constructor(
    private scene: Phaser.Scene,
    private player: Phaser.GameObjects.Sprite
  ) {
    this.reduced = prefersReducedMotion();
    this.gfx = scene.add.graphics();
    this.gfx.setDepth(220);
    this.gfx.setBlendMode(Phaser.BlendModes.ADD);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.sparks.push({
        active: false,
        angle: 0,
        radius: 0,
        y: 0,
        life: 0,
        maxLife: 1,
        size: 1,
        color: 0xffffff,
        angSpeed: 0,
        riseSpeed: 0,
        radialSpeed: 0,
      });
    }
  }

  /** Play the departure half: player is enveloped, dissolves, and disappears. */
  playDeparture(): Promise<void> {
    return this.run('depart');
  }

  /** Play the arrival half: player reforms out of gathering blue light. */
  playArrival(): Promise<void> {
    return this.run('arrive');
  }

  private run(mode: EffectMode): Promise<void> {
    this.mode = mode;
    this.duration = this.reduced ? REDUCED_DURATION : mode === 'depart' ? DEPART_DURATION : ARRIVE_DURATION;
    this.elapsed = 0;
    this.finished = false;
    this.baseScale = this.player.scaleX || 1;
    this.origAlpha = 1;

    if (mode === 'depart') {
      ambientAudio.playTeleportDepart(this.reduced);
    } else {
      ambientAudio.playTeleportArrive(this.reduced);
      // Ensure the player starts invisible so arrival never "pops" in.
      this.player.setAlpha(0);
    }

    return new Promise<void>((resolve) => {
      this.resolveFn = resolve;
      this.updateHandler = (_t: number, deltaMs: number) => this.tick(deltaMs);
      this.scene.events.on('update', this.updateHandler);
    });
  }

  private tick(deltaMs: number): void {
    if (this.finished || this.disposed) return;
    if (!this.player.active) {
      this.finish();
      return;
    }

    const dt = Math.min(0.05, deltaMs / 1000);
    this.elapsed += dt;
    const raw = clamp01(this.elapsed / this.duration);
    // Forward for departure, reversed for arrival so both halves mirror.
    const p = this.mode === 'depart' ? raw : 1 - raw;

    this.updatePlayerVisual(p);
    if (!this.reduced) {
      this.updateParticles(dt, raw);
    }
    this.draw(p, raw);

    if (this.elapsed >= this.duration) this.finish();
  }

  private updatePlayerVisual(p: number): void {
    // p == 1 -> fully present/visible; p == 0 -> fully dissolved/invisible.
    const dissolve = clamp01((p - 0.15) / 0.55); // becomes visible from p~0.15..0.7
    const alpha = this.reduced ? p : dissolve;
    this.player.setAlpha(Math.max(0, alpha) * this.origAlpha);

    // Blue tint intensifies as the player dissolves into the spell.
    const tintAmount = 1 - clamp01((p - 0.1) / 0.6);
    const rgb = {
      r: Math.round(TINT_WHITE.r + (TINT_ICY.r - TINT_WHITE.r) * tintAmount),
      g: Math.round(TINT_WHITE.g + (TINT_ICY.g - TINT_WHITE.g) * tintAmount),
      b: Math.round(TINT_WHITE.b + (TINT_ICY.b - TINT_WHITE.b) * tintAmount),
    };
    if (tintAmount <= 0.02) {
      this.player.clearTint();
    } else {
      this.player.setTint(Phaser.Display.Color.GetColor(rgb.r, rgb.g, rgb.b));
    }

    if (!this.reduced) {
      // Subtle vertical stretch as the body fragments upward into the light.
      const stretch = 1 + (1 - p) * 0.06;
      this.player.setScale(this.baseScale, this.baseScale * stretch);
    }
  }

  private geometry(): { fx: number; fy: number; height: number } {
    const h = this.player.displayHeight || 24;
    // Origin is feet-anchored (0.5, 0.85); the base sits just below sprite y.
    return { fx: this.player.x, fy: this.player.y + h * 0.1, height: h };
  }

  private spawnSpark(startHigh: boolean): void {
    const s = this.sparks.find((sp) => !sp.active);
    if (!s) return;
    const { height } = this.geometry();
    s.active = true;
    s.angle = Math.random() * Math.PI * 2;
    s.radius = 8 + Math.random() * 20;
    s.size = 1 + Math.random() * 4;
    s.color = pickColor();
    s.maxLife = 0.4 + Math.random() * 1.0;
    s.life = s.maxLife;
    s.angSpeed = (0.6 + Math.random() * 1.6) * (Math.random() < 0.5 ? -1 : 1);
    s.riseSpeed = 12 + Math.random() * 30;
    s.radialSpeed = 4 + Math.random() * 10;
    if (startHigh) {
      // Arrival: motes begin scattered high and drift inward/down.
      s.y = -height * (0.6 + Math.random() * 0.9);
      s.radius = 14 + Math.random() * 16;
    } else {
      s.y = -Math.random() * 4;
    }
  }

  private updateParticles(dt: number, raw: number): void {
    const arriving = this.mode === 'arrive';
    // Density ramps in during envelopment/dissolution and eases out at the end.
    const density = arriving ? 1 - raw : raw;
    const spawnChance = 0.35 + easeInOut(clamp01(density)) * 1.4;
    const spawns = Math.random() < spawnChance % 1 ? Math.ceil(spawnChance) : Math.floor(spawnChance);
    for (let i = 0; i < spawns; i++) this.spawnSpark(arriving);

    for (const s of this.sparks) {
      if (!s.active) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.active = false;
        continue;
      }
      s.angle += s.angSpeed * dt;
      if (arriving) {
        // Gather inward and settle downward toward the feet.
        s.radius = Math.max(2, s.radius - s.radialSpeed * dt);
        s.y += s.riseSpeed * 0.5 * dt;
      } else {
        // Spiral inward while rising upward out of the body.
        s.radius = Math.max(2, s.radius - s.radialSpeed * 0.6 * dt);
        s.y -= s.riseSpeed * dt;
      }
    }
  }

  private draw(p: number, raw: number): void {
    const g = this.gfx;
    g.clear();
    if (this.disposed) return;
    const { fx, fy, height } = this.geometry();

    // Spell intensity: brightest as the player fully dissolves / begins to form.
    const intensity = this.reduced ? 0.4 : easeInOut(1 - Math.abs(p - 0.15) / 0.85);
    const flick = 0.85 + Math.sin(this.elapsed * 22) * 0.15;

    // --- Rune ring / glow beneath the feet ---
    const ringAlpha = clamp01((this.mode === 'depart' ? raw : 1 - raw) * 2) * 0.7;
    if (ringAlpha > 0.02) {
      const ringR = 12 + Math.sin(this.elapsed * 4) * 1.5;
      g.lineStyle(1.5, 0x3fd0ff, ringAlpha * flick);
      g.strokeEllipse(fx, fy, ringR * 2, ringR * 0.9);
      g.lineStyle(1, 0xbfe8ff, ringAlpha * 0.6);
      g.strokeEllipse(fx, fy, ringR * 1.3, ringR * 0.6);
      // rotating rune ticks
      const ticks = 6;
      for (let i = 0; i < ticks; i++) {
        const a = (i / ticks) * Math.PI * 2 + this.elapsed * 1.6;
        const ix = fx + Math.cos(a) * ringR;
        const iy = fy + Math.sin(a) * ringR * 0.45;
        g.fillStyle(0xeaf6ff, ringAlpha);
        g.fillCircle(ix, iy, 0.9);
      }
    }

    // --- Vertical magical column (feet -> head) ---
    if (!this.reduced) {
      const columnProgress = clamp01((this.mode === 'depart' ? raw : 1 - raw) / 0.55);
      const columnTop = fy - height * 1.35 * columnProgress;
      const bands = 12;
      for (let i = 0; i < bands; i++) {
        const t = i / (bands - 1);
        const y = fy - (fy - columnTop) * t;
        const width = (10 - t * 6) * flick;
        const bandAlpha = intensity * (0.5 - t * 0.32) * columnProgress;
        if (bandAlpha <= 0.01) continue;
        const col = t < 0.5 ? 0x2a6bd6 : 0xbfe8ff;
        g.fillStyle(col, bandAlpha);
        g.fillEllipse(fx, y, width, width * 0.5);
      }
      // bright core at the peak of the spell
      const core = intensity * 0.6;
      if (core > 0.02) {
        g.fillStyle(0xeaf6ff, core);
        g.fillEllipse(fx, fy - height * 0.45, 6 * flick, height * 0.8 * columnProgress);
      }
    }

    // --- Particles ---
    for (const s of this.sparks) {
      if (!s.active) continue;
      const lifeT = s.life / s.maxLife;
      const alpha = clamp01(lifeT) * 0.9;
      const px = fx + Math.cos(s.angle) * s.radius;
      const py = fy + s.y + Math.sin(s.angle) * s.radius * 0.3;
      g.fillStyle(s.color, alpha);
      g.fillCircle(px, py, s.size * (0.4 + lifeT * 0.6));
    }
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    if (this.updateHandler) {
      this.scene.events.off('update', this.updateHandler);
      this.updateHandler = undefined;
    }
    this.gfx.clear();
    if (this.mode === 'arrive') {
      this.restorePlayer();
      ambientAudio.playTeleportComplete(this.reduced);
    }
    const resolve = this.resolveFn;
    this.resolveFn = undefined;
    resolve?.();
  }

  /** Restore the player sprite to normal rendering state. */
  restorePlayer(): void {
    if (!this.player.active) return;
    this.player.setAlpha(1);
    this.player.clearTint();
    this.player.setScale(this.baseScale, this.baseScale);
  }

  /**
   * Tear down graphics and detach listeners. Safe to call multiple times.
   * Pass `restore = false` after a departure so the player stays invisible
   * until the destination scene/position is ready.
   */
  destroy(restore = false): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.updateHandler) {
      this.scene.events.off('update', this.updateHandler);
      this.updateHandler = undefined;
    }
    this.gfx.destroy();
    if (restore) this.restorePlayer();
    const resolve = this.resolveFn;
    this.resolveFn = undefined;
    resolve?.();
  }
}
