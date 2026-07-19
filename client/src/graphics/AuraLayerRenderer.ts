import type { AuraEffect, AuraState, WardState } from '@witchcraft/shared';

export type AuraVisualMood = 'dim' | 'stable' | 'bright' | 'distorted' | 'uneven' | 'radiant';

export interface AuraVisualState {
  intensity: number;
  mood: AuraVisualMood;
  hpRatio: number;
}

export interface AuraRenderInput {
  aura: AuraState;
  apartmentWards?: WardState[];
  familiarProtections?: AuraEffect[];
  familiarLink?: { familiarId: string; strength: number };
  health?: number;
  maxHealth?: number;
  glowColor?: string;
  visualState?: AuraVisualState;
  blessingsCount?: number;
  hexesCount?: number;
  energeticDamage?: number;
  familiarLinked?: boolean;
  activeProtections?: number;
}

export interface WardNetLayer {
  strength: number;
  color: string;
  label?: string;
}

/** Animated multi-layer aura diagram: perimeter → wards → protections → aura → body */
export class AuraLayerRenderer {
  private animId = 0;
  private t = 0;
  private particles: { x: number; y: number; r: number; phase: number }[] = [];

  start(canvas: HTMLCanvasElement, getInput: () => AuraRenderInput, animate = true): void {
    this.stop();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (this.particles.length === 0) {
      for (let i = 0; i < 24; i++) {
        this.particles.push({
          x: Math.random(),
          y: Math.random(),
          r: 0.4 + Math.random() * 1.2,
          phase: Math.random() * Math.PI * 2,
        });
      }
    }

    const render = (now: number) => {
      this.t = now * 0.001;
      const input = getInput();
      this.draw(ctx, canvas.width, canvas.height, input);
    };

    if (!animate) {
      render(0);
      return;
    }

    const loop = (now: number) => {
      render(now);
      this.animId = requestAnimationFrame(loop);
    };
    this.animId = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.animId) cancelAnimationFrame(this.animId);
    this.animId = 0;
  }

  private draw(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    input: AuraRenderInput
  ): void {
    const {
      aura,
      apartmentWards = [],
      familiarProtections = [],
      familiarLink,
      health = 100,
      maxHealth = 100,
      glowColor = '#8866cc55',
      visualState,
      blessingsCount = 0,
      hexesCount = 0,
      energeticDamage = 0,
      familiarLinked = false,
      activeProtections = 0,
    } = input;

    const cx = w / 2;
    const cy = h * 0.46;
    const scale = Math.min(w, h);
    const intensity = visualState?.intensity ?? 0.5;
    const mood = visualState?.mood ?? 'stable';
    const hpRatio = visualState?.hpRatio ?? Math.max(0, Math.min(1, health / Math.max(1, maxHealth)));

    ctx.clearRect(0, 0, w, h);

    this.drawBackground(ctx, cx, cy, scale);
    this.drawParticles(ctx, w, h, intensity, mood);

    const protections = aura.protections ?? [];
    const wards = aura.wards ?? [];

    const perimeterR = scale * 0.48;
    if (apartmentWards.length) {
      const totalPerim = apartmentWards.reduce((s, ward) => s + ward.strength, 0);
      this.drawPerimeterRing(ctx, cx, cy, perimeterR, totalPerim, apartmentWards.length);
    } else {
      this.drawInactiveRing(ctx, cx, cy, perimeterR, 'rgba(100, 180, 160, 0.12)', [5, 4]);
    }

    const wardR = scale * 0.42;
    const wardCount = Math.max(wards.length, 1);
    this.drawWardLayers(ctx, cx, cy, wardR, wards.length, wards);
    wards.forEach((ward, i) => {
      this.drawOrbitingSpell(ctx, cx, cy, wardR, i, wardCount, ward, '#ffd866', this.t);
    });

    const protR = wardR - 22;
    if (protections.length || activeProtections > 0) {
      ctx.strokeStyle = 'rgba(100, 200, 255, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, protR, 0, Math.PI * 2);
      ctx.stroke();
    }
    protections.forEach((prot, i) => {
      this.drawOrbitingSpell(ctx, cx, cy, protR, i, protections.length, prot, '#88ddff', this.t * 1.2);
    });

    this.drawCardinalNodes(ctx, cx, cy, protR + 8, {
      hasBlessing: blessingsCount > 0,
      hasProtection: activeProtections > 0 || protections.length > 0,
      hasHex: hexesCount > 0,
      familiarLinked,
      familiarStrength: familiarLink?.strength ?? 0,
    });

    const famR = protR - 14;
    if (familiarProtections.length) {
      ctx.strokeStyle = 'rgba(120, 220, 180, 0.45)';
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(cx, cy, famR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      familiarProtections.forEach((prot, i) => {
        this.drawOrbitingSpell(ctx, cx, cy, famR, i, familiarProtections.length, prot, '#88ddbb', this.t * 0.9);
      });
    }

    const auraR = famR - (familiarProtections.length ? 12 : 18);
    this.drawAuraRing(ctx, cx, cy, auraR, glowColor, intensity, mood, hexesCount, blessingsCount);

    if (energeticDamage > 0) {
      this.drawDamageDistortion(ctx, cx, cy, auraR, energeticDamage);
    }

    const bodyTint = hpRatio > 0.6 ? '#ccbbee' : hpRatio > 0.3 ? '#ddaa88' : '#ff8888';
    this.drawBody(ctx, cx, cy, bodyTint, hpRatio, mood, energeticDamage);
  }

  private drawBackground(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number): void {
    const r = scale * 0.5;
    const grad = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
    grad.addColorStop(0, 'rgba(50, 30, 90, 0.35)');
    grad.addColorStop(0.6, 'rgba(20, 12, 40, 0.2)');
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(140, 100, 200, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2);
    ctx.stroke();

    const ticks = 12;
    for (let i = 0; i < ticks; i++) {
      const a = (i / ticks) * Math.PI * 2 - Math.PI / 2;
      const x1 = cx + Math.cos(a) * r * 0.88;
      const y1 = cy + Math.sin(a) * r * 0.88;
      const x2 = cx + Math.cos(a) * r * 0.94;
      const y2 = cy + Math.sin(a) * r * 0.94;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }

  private drawParticles(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    intensity: number,
    mood: AuraVisualMood
  ): void {
    const alphaBase = mood === 'dim' ? 0.15 : mood === 'bright' || mood === 'radiant' ? 0.55 : 0.35;
    for (const p of this.particles) {
      const twinkle = 0.5 + Math.sin(this.t * 2 + p.phase) * 0.5;
      const a = alphaBase * twinkle * (0.4 + intensity * 0.6);
      ctx.fillStyle = `rgba(200, 180, 255, ${a})`;
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawInactiveRing(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    color: string,
    dash: number[]
  ): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawAuraRing(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    glowColor: string,
    intensity: number,
    mood: AuraVisualMood,
    hexes: number,
    blessings: number
  ): void {
    const pulse =
      mood === 'dim'
        ? 0.15
        : mood === 'bright' || mood === 'radiant'
          ? 0.55 + Math.sin(this.t * 3) * 0.15
          : 0.35 + Math.sin(this.t * 2) * 0.1;

    const wobble = mood === 'uneven' || mood === 'distorted' ? Math.sin(this.t * 5) * 4 : 0;

    const grad = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r + wobble);
    grad.addColorStop(0, glowColor.replace(/[\d.]+\)$/, `${pulse * intensity})`));
    grad.addColorStop(0.7, glowColor.replace(/[\d.]+\)$/, `${pulse * 0.4 * intensity})`));
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r + wobble, 0, Math.PI * 2);
    ctx.fill();

    const ringAlpha = 0.2 + intensity * 0.4;
    ctx.strokeStyle =
      mood === 'radiant'
        ? `rgba(120, 255, 180, ${ringAlpha})`
        : hexes > blessings
          ? `rgba(255, 90, 120, ${ringAlpha})`
          : `rgba(180, 120, 255, ${ringAlpha})`;
    ctx.lineWidth = mood === 'distorted' ? 1.5 : 1;
    if (mood === 'distorted' || mood === 'uneven') {
      ctx.setLineDash([3, 2, 1, 2]);
    }
    ctx.beginPath();
    ctx.arc(cx, cy + wobble * 0.3, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    if (blessings > 0) {
      ctx.strokeStyle = `rgba(100, 255, 160, ${0.25 + Math.sin(this.t * 2) * 0.1})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(cx, cy, r - 6, -Math.PI * 0.3, Math.PI * 0.1);
      ctx.stroke();
    }
  }

  private drawDamageDistortion(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    damage: number
  ): void {
    const severity = Math.min(1, damage / 100);
    ctx.strokeStyle = `rgba(255, 80, 100, ${0.2 + severity * 0.4})`;
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const offset = Math.sin(this.t * 4 + i) * severity * 6;
      ctx.beginPath();
      ctx.arc(cx - 20 + offset, cy - 10, r * 0.35, Math.PI * 0.6, Math.PI * 1.4);
      ctx.stroke();
    }
  }

  private drawCardinalNodes(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    state: {
      hasBlessing: boolean;
      hasProtection: boolean;
      hasHex: boolean;
      familiarLinked: boolean;
      familiarStrength: number;
    }
  ): void {
    const nodes: { angle: number; active: boolean; color: string; symbol: string }[] = [
      { angle: -Math.PI / 2, active: state.hasBlessing, color: '#eef', symbol: '✦' },
      { angle: 0, active: state.hasHex, color: '#ffd866', symbol: '⬡' },
      { angle: Math.PI / 2, active: state.familiarLinked, color: '#88ddbb', symbol: '◈' },
      { angle: Math.PI, active: state.hasProtection, color: '#88ddff', symbol: '⛨' },
    ];

    for (const node of nodes) {
      const nx = cx + Math.cos(node.angle) * r;
      const ny = cy + Math.sin(node.angle) * r;
      const alpha = node.active ? 0.85 : 0.2;
      ctx.fillStyle = `${node.color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
      ctx.strokeStyle = node.active ? node.color : 'rgba(120, 100, 160, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(nx, ny, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = node.active ? node.color : 'rgba(140, 130, 170, 0.5)';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(node.symbol, nx, ny + 1);
    }

    if (state.familiarLinked && state.familiarStrength > 0) {
      const linkY = cy + r + 4;
      ctx.strokeStyle = `rgba(140, 220, 190, ${0.3 + state.familiarStrength * 0.35})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, cy + 30);
      ctx.lineTo(cx, linkY);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawBody(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    tint: string,
    hpRatio: number,
    mood: AuraVisualMood,
    damage: number
  ): void {
    const skew = mood === 'distorted' || mood === 'uneven' ? Math.sin(this.t * 3) * 2 : 0;
    const outlineAlpha = mood === 'dim' ? 0.5 : mood === 'bright' || mood === 'radiant' ? 1 : 0.75;

    ctx.save();
    ctx.translate(skew, 0);
    ctx.strokeStyle = tint;
    ctx.globalAlpha = outlineAlpha;
    ctx.fillStyle = `${tint}33`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy - 50, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - 36);
    ctx.lineTo(cx, cy + 30);
    ctx.moveTo(cx - 30, cy - 10);
    ctx.lineTo(cx + 30, cy - 10);
    ctx.moveTo(cx, cy + 30);
    ctx.lineTo(cx - 18, cy + 70);
    ctx.moveTo(cx, cy + 30);
    ctx.lineTo(cx + 18, cy + 70);
    ctx.stroke();

    ctx.fillStyle = 'rgba(180, 140, 255, 0.6)';
    ctx.beginPath();
    ctx.arc(cx, cy - 5, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (damage > 0) {
      const sev = Math.min(1, damage / 100);
      ctx.fillStyle = `rgba(255, 60, 80, ${0.15 + sev * 0.25})`;
      ctx.beginPath();
      ctx.ellipse(cx - 12, cy - 20, 10, 18, 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawWardLayers(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    baseR: number,
    activeCount: number,
    wards: AuraEffect[]
  ): void {
    if (activeCount === 0) {
      this.drawInactiveRing(ctx, cx, cy, baseR, 'rgba(255, 215, 100, 0.15)', []);
      return;
    }

    const layers = Math.min(activeCount, 3);
    for (let layer = 0; layer < layers; layer++) {
      const r = baseR - layer * 8;
      const ward = wards[layer];
      const strength = ward?.strength ?? 50;
      const expiring = ward?.expiresAt && ward.expiresAt < Date.now() + 600_000;
      const pulse = expiring
        ? 0.25 + Math.sin(this.t * 4) * 0.2
        : 0.35 + Math.sin(this.t * 2 + layer) * 0.15;
      const alpha = pulse * (0.4 + Math.min(1, strength / 100) * 0.6);

      ctx.strokeStyle = `rgba(255, 215, 100, ${alpha})`;
      ctx.lineWidth = 1 + layer * 0.3;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    this.drawWardWeb(ctx, cx, cy, baseR, Math.max(6, activeCount * 2));
  }

  private drawWardWeb(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    segments: number
  ): void {
    const n = Math.max(6, segments);
    ctx.strokeStyle = `rgba(255, 215, 100, ${0.15 + Math.sin(this.t * 2) * 0.05})`;
    ctx.lineWidth = 0.8;

    for (let i = 0; i < n; i++) {
      const a1 = (i / n) * Math.PI * 2 + this.t * 0.15;
      const a2 = a1 + Math.PI / n + Math.sin(this.t + i) * 0.08;
      const x1 = cx + Math.cos(a1) * r;
      const y1 = cy + Math.sin(a1) * r;
      const x2 = cx + Math.cos(a2) * r * 0.55;
      const y2 = cy + Math.sin(a2) * r * 0.55;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(cx + Math.cos(a2 + 0.4) * r * 0.85, cy + Math.sin(a2 + 0.4) * r * 0.85);
      ctx.stroke();
    }
  }

  private drawOrbitingSpell(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    index: number,
    total: number,
    effect: AuraEffect,
    color: string,
    time: number
  ): void {
    const angle = (index / Math.max(1, total)) * Math.PI * 2 + time * 0.6;
    const ox = cx + Math.cos(angle) * radius;
    const oy = cy + Math.sin(angle) * radius;

    ctx.fillStyle = `${color}44`;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(ox, oy, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = '7px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('✦', ox, oy + 2);
  }

  private drawPerimeterRing(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    totalStrength: number,
    count: number
  ): void {
    const pulse = 0.3 + Math.sin(this.t * 2.2) * 0.15;
    ctx.strokeStyle = `rgba(255, 200, 80, ${pulse})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + this.t * 0.2;
      const ox = cx + Math.cos(a) * r;
      const oy = cy + Math.sin(a) * r;
      ctx.fillStyle = '#ffd866';
      ctx.beginPath();
      ctx.arc(ox, oy, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(238, 204, 204, 0.6)';
    ctx.font = '6px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`perimeter ${Math.round(totalStrength)}`, cx, cy - r - 6);
  }
}

/** Animated ward netting for familiar status box — stacked linked layers */
export class FamiliarWardNetRenderer {
  private animId = 0;
  private t = 0;

  start(canvas: HTMLCanvasElement, getLayers: () => WardNetLayer[]): void {
    this.stop();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const loop = (now: number) => {
      this.t = now * 0.001;
      const layers = getLayers().filter((l) => l.strength > 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (layers.length) this.drawNet(ctx, canvas.width, canvas.height, layers);
      this.animId = requestAnimationFrame(loop);
    };
    this.animId = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.animId) cancelAnimationFrame(this.animId);
    this.animId = 0;
  }

  private drawNet(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    layers: WardNetLayer[]
  ): void {
    const total = layers.reduce((s, l) => s + l.strength, 0);
    layers.forEach((layer, idx) => {
      const pulse = 0.35 + Math.sin(this.t * 3 + idx) * 0.15;
      ctx.strokeStyle = layer.color.includes('rgba')
        ? layer.color.replace(/[\d.]+\)$/, `${pulse})`)
        : `rgba(120, 200, 255, ${pulse})`;
      ctx.lineWidth = 1 + idx * 0.25;
      const cols = 4 + idx;
      const rows = 4 + idx;
      for (let r = 0; r <= rows; r++) {
        for (let c = 0; c <= cols; c++) {
          const x = (c / cols) * w + Math.sin(this.t * 2 + r + idx) * 2;
          const y = (r / rows) * h + Math.cos(this.t * 2 + c + idx) * 2;
          if (c < cols) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(((c + 1) / cols) * w, (r / rows) * h);
            ctx.stroke();
          }
          if (r < rows) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo((c / cols) * w, ((r + 1) / rows) * h);
            ctx.stroke();
          }
        }
      }
    });
    ctx.fillStyle = '#bdf';
    ctx.font = '6px monospace';
    ctx.textAlign = 'center';
    const label = layers.length > 1 ? `web ${Math.round(total)}` : `ward ${Math.round(total)}`;
    ctx.fillText(label, w / 2, h - 2);
  }
}
