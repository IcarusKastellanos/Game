/** Brass-framed parchment tooltips for HUD elements */
export class TooltipManager {
  private el!: HTMLDivElement;
  private hideTimer = 0;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'hud-tooltip';
    this.el.setAttribute('role', 'tooltip');
    document.body.appendChild(this.el);
  }

  show(target: HTMLElement, html: string): void {
    window.clearTimeout(this.hideTimer);
    this.el.innerHTML = html;
    this.el.classList.add('hud-tooltip--visible');
    const rect = target.getBoundingClientRect();
    const tipRect = this.el.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - tipRect.width / 2;
    let top = rect.top - tipRect.height - 10;
    if (top < 8) top = rect.bottom + 10;
    left = Math.max(8, Math.min(window.innerWidth - tipRect.width - 8, left));
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
  }

  hideSoon(delayMs = 80): void {
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.hide(), delayMs);
  }

  hide(): void {
    this.el.classList.remove('hud-tooltip--visible');
  }

  bind(target: HTMLElement, html: string | (() => string)): void {
    target.addEventListener('mouseenter', () => {
      const content = typeof html === 'function' ? html() : html;
      this.show(target, content);
    });
    target.addEventListener('mouseleave', () => this.hideSoon());
  }
}

export const tooltipManager = new TooltipManager();
