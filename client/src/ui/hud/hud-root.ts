/** Shared HUD layer — all chrome mounts here for unified viewport scaling. */
export const hudRoot: HTMLDivElement = (() => {
  const existing = document.getElementById('hud-root');
  if (existing) return existing as HTMLDivElement;

  const el = document.createElement('div');
  el.id = 'hud-root';
  el.className = 'hud-root';
  document.body.appendChild(el);
  return el;
})();
