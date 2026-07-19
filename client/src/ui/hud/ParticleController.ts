/** Lightweight DOM particle bursts for hover / success (no WebGL) */
export class ParticleController {
  spawn(x: number, y: number, count = 6, color = '#c8a878'): void {
    for (let i = 0; i < count; i++) {
      const p = document.createElement('span');
      p.className = 'hud-particle';
      p.style.cssText = `
        position:fixed;left:${x}px;top:${y}px;width:3px;height:3px;
        background:${color};border-radius:50%;pointer-events:none;z-index:9999;
        animation:hud-particle-drift 0.8s ease-out forwards;
        --dx:${(Math.random() - 0.5) * 40}px;--dy:${-Math.random() * 30 - 10}px;`;
      document.body.appendChild(p);
      window.setTimeout(() => p.remove(), 900);
    }
  }
}

export const particleController = new ParticleController();
