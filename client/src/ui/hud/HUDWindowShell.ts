import { windowAnimator } from './WindowAnimator.js';
import type { HUDWindowId } from './types.js';
import { loadHudPrefs, saveHudPrefs } from './hud-prefs.js';
import { hudRoot } from './hud-root.js';
import { escapeHtml, LEDGER_ART, ledgerOrnaments } from '../ledger-chrome.js';

/** Draggable ledger page for HUD panels (grimoire, teleport, settings, and the rest). */
export class HUDWindowShell {
  readonly root: HTMLDivElement;
  readonly body: HTMLDivElement;
  private visible = false;
  private dragStart: { x: number; y: number; left: number; top: number } | null = null;

  constructor(
    readonly id: HUDWindowId,
    title: string,
    subtitle?: string,
    kicker = 'Workbench'
  ) {
    this.root = document.createElement('div');
    this.root.className = 'hud-window';
    this.root.id = `hud-window-${id}`;
    this.root.dataset.windowId = id;
    this.root.style.display = 'none';

    this.root.innerHTML = `
      <div class="hud-window__chrome ledger-frame" role="dialog" aria-label="${escapeHtml(title)}">
        ${ledgerOrnaments()}
        <header class="hud-window__header ledger-head">
          <img class="ledger-head__ornament" src="${LEDGER_ART}/aura-header-decoration.png" alt="" />
          <p class="ledger-kicker">${escapeHtml(kicker)}</p>
          <h2 class="hud-window__title">${escapeHtml(title)}</h2>
          ${subtitle ? `<p class="ledger-type">${escapeHtml(subtitle)}</p>` : ''}
          <button type="button" class="hud-window__close ledger-close" aria-label="Close">
            <img src="${LEDGER_ART}/aura-close-frame.png" alt="" />
          </button>
        </header>
        <div class="hud-window__body ledger-scroll"></div>
        <footer class="ledger-foot">
          <img src="${LEDGER_ART}/bottom-moon-ornament.png" alt="" />
          <p>Drag the heading if you want this page somewhere else on the desk.</p>
        </footer>
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
