/** Magical open/close transitions for HUD windows */
export class WindowAnimator {
  unfold(el: HTMLElement): void {
    el.classList.remove('hud-window--closing');
    el.classList.add('hud-window--opening');
    el.style.display = '';
    requestAnimationFrame(() => {
      el.classList.add('hud-window--open');
      el.classList.remove('hud-window--opening');
    });
  }

  fold(el: HTMLElement, onDone?: () => void): void {
    el.classList.remove('hud-window--open');
    el.classList.add('hud-window--closing');
    const done = (): void => {
      el.classList.remove('hud-window--closing');
      el.style.display = 'none';
      onDone?.();
    };
    el.addEventListener('animationend', done, { once: true });
    window.setTimeout(done, 420);
  }

  pulseSuccess(el: HTMLElement): void {
    el.classList.remove('hud-pulse-success');
    void el.offsetWidth;
    el.classList.add('hud-pulse-success');
  }

  pulseError(el: HTMLElement): void {
    el.classList.remove('hud-pulse-error');
    void el.offsetWidth;
    el.classList.add('hud-pulse-error');
  }
}

export const windowAnimator = new WindowAnimator();
