/** Brief full-screen distortion when a ward is broken and intuition detects it */
export function triggerScreenDistortion(durationMs = 1200): void {
  let el = document.getElementById('shield-distort-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'shield-distort-overlay';
    el.style.cssText = `
      pointer-events:none;position:fixed;inset:0;z-index:9500;
      opacity:0;mix-blend-mode:screen;
      background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(255,80,80,0.08) 2px,rgba(255,80,80,0.08) 4px);
      transition:opacity 0.15s;
    `;
    document.body.appendChild(el);
  }

  el.style.opacity = '1';

  const start = performance.now();
  const tick = (): void => {
    const elapsed = performance.now() - start;
    if (elapsed >= durationMs) {
      el!.style.opacity = '0';
      el!.style.transform = '';
      return;
    }
    el!.style.transform = `skewX(${Math.sin(elapsed * 0.02) * 3}deg) translateX(${Math.sin(elapsed * 0.03) * 4}px)`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
