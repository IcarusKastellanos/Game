import { windowAnimator } from './WindowAnimator.js';
import type { HUDWindowId } from './types.js';
import { loadHudPrefs, saveHudPrefs } from './hud-prefs.js';
import { hudRoot } from './hud-root.js';

/** Draggable brass-and-wood window shell for HUD panels */
export class HUDWindowShell {
  readonly root: HTMLDivElement;
  readonly body: HTMLDivElement;
  private visible = false;
  private dragStart: { x: number; y: number; left: number; top: number } | null = null;

  constructor(
    readonly id: HUDWindowId,
    title: string,
    subtitle?: string
  ) {
    this.root = document.createElement('div');
    this.root.className = 'hud-window';
    this.root.id = `hud-window-${id}`;
    this.root.dataset.windowId = id;
    this.root.style.display = 'none';

    this.root.innerHTML = `
      <div class="hud-window__chrome">
        <header class="hud-window__header">
          <div class="hud-window__title-wrap">
            <h2 class="hud-window__title">${title}</h2>
            ${subtitle ? `<p class="hud-window__subtitle">${subtitle}</p>` : ''}
          </div>
          <button type="button" class="hud-window__close" aria-label="Close">✕</button>
        </header>
        <div class="hud-window__body"></div>
      </div>`;

    hudRoot.appendChild(this.root);
    this.body = this.root.querySelector('.hud-window__body') as HTMLDivElement;

    this.root.querySelector('.hud-window__close')?.addEventListener('click', () => this.hide());
    const header = this.root.querySelector('.hud-window__header') as HTMLElement;
    header.addEventListener('mousedown', (e) => this.startDrag(e));
    window.addEventListener('mousemove', (e) => this.onDrag(e));
    window.addEventListener('mouseup', () => this.endDrag());

    this.restorePosition();
  }

  show(): void {
    if (this.visible) return;
    this.visible = true;
    windowAnimator.unfold(this.root);
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.savePosition();
    windowAnimator.fold(this.root);
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  isOpen(): boolean {
    return this.visible;
  }

  setBodyHtml(html: string): void {
    this.body.innerHTML = html;
  }

  private startDrag(e: MouseEvent): void {
    if ((e.target as HTMLElement).closest('.hud-window__close')) return;
    const rect = this.root.getBoundingClientRect();
    this.dragStart = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
    this.root.classList.add('hud-window--dragging');
  }

  private onDrag(e: MouseEvent): void {
    if (!this.dragStart) return;
    const dx = e.clientX - this.dragStart.x;
    const dy = e.clientY - this.dragStart.y;
    this.root.style.left = `${this.dragStart.left + dx}px`;
    this.root.style.top = `${this.dragStart.top + dy}px`;
    this.root.style.transform = 'none';
  }

  private endDrag(): void {
    if (!this.dragStart) return;
    this.dragStart = null;
    this.root.classList.remove('hud-window--dragging');
    this.savePosition();
  }

  private savePosition(): void {
    const prefs = loadHudPrefs();
    const rect = this.root.getBoundingClientRect();
    prefs.windowState[this.id] = { x: rect.left, y: rect.top };
    saveHudPrefs(prefs);
  }

  private restorePosition(): void {
    const prefs = loadHudPrefs();
    const st = prefs.windowState[this.id];
    if (st?.x != null && st?.y != null) {
      this.root.style.left = `${st.x}px`;
      this.root.style.top = `${st.y}px`;
      this.root.style.transform = 'none';
    }
  }
}
