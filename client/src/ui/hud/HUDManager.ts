import Phaser from 'phaser';
import { gameState } from '../../data/game-state.js';
import { network } from '../../net/NetworkManager.js';
import hudToggleIcon from '../../assets/hud/hud-toggle-icon.png';
import { themeManager } from './ThemeManager.js';
import { compassWidget } from './CompassWidget.js';
import { moonWidget } from './MoonWidget.js';
import { hudRoot } from './hud-root.js';
import { navigationBar } from './NavigationBar.js';
import { notificationManager } from './NotificationManager.js';
import { playerPanel } from './PlayerPanel.js';
import { resourcePanel } from './ResourcePanel.js';
import { hudWindows } from './windows.js';
import { NAV_CARDS } from './NavigationBar.js';
import type { HUDController, HUDWindowId } from './types.js';
import { loadHudPrefs, saveHudPrefs } from './hud-prefs.js';
import { hudLayoutRuntime } from './HudLayoutRuntime.js';

/**
 * Central HUD operating system — layout, navigation, notifications, hotbar.
 * Wires to existing panels via HUDController callbacks from UIScene.
 */
export class HUDManager {
  private shell!: HTMLDivElement;
  private visitBanner!: HTMLDivElement;
  private controller: HUDController | null = null;
  private hidden = false;
  private expanded = false;
  private toggleBtn!: HTMLButtonElement;

  constructor(private scene: Phaser.Scene) {
    themeManager.apply();
    this.buildShell();
    this.wireNavigation();
    this.wireEvents();

    const prefs = loadHudPrefs();
    navigationBar.setCollapsed(prefs.navCollapsed);

    window.addEventListener('game:player-loaded', () => {
      playerPanel.render();
      resourcePanel.render();
      void hudLayoutRuntime.load();
    });
    window.addEventListener('game:hud-layout-reload', () => {
      void hudLayoutRuntime.load();
    });
    window.addEventListener('focus', () => {
      void hudLayoutRuntime.load();
    });

    this.scene.events.on('update', () => this.tick());
  }

  setController(controller: HUDController): void {
    this.controller = controller;
  }

  showMessage(msg: string): void {
    notificationManager.showInfo('Working Complete', msg);
  }

  notifyDiscovery(title: string, body: string, actionLabel?: string, onAction?: () => void): void {
    notificationManager.push({
      id: `d-${Date.now()}`,
      kind: 'discovery',
      title,
      body,
      actionLabel,
      actionHotkey: actionLabel ? 'J' : undefined,
      onAction,
      durationMs: 7000,
    });
  }

  hideHud(): void {
    this.hidden = true;
    document.body.classList.remove('hud-ready', 'hud-expanded');
    this.shell.style.display = 'none';
    if (this.toggleBtn) this.toggleBtn.style.display = 'none';
  }

  showHud(): void {
    this.hidden = false;
    document.body.classList.add('hud-ready');
    this.shell.style.display = '';
    if (this.toggleBtn) this.toggleBtn.style.display = '';
    const prefs = loadHudPrefs();
    this.setExpanded(prefs.hudExpanded ?? false);
    themeManager.refreshFitScale(this.expanded);
    void hudLayoutRuntime.load();
    window.dispatchEvent(new CustomEvent('game:hud-ready'));
  }

  toggleExpanded(force?: boolean): void {
    this.setExpanded(force ?? !this.expanded);
  }

  isExpanded(): boolean {
    return this.expanded;
  }

  private setExpanded(on: boolean): void {
    this.expanded = on;
    document.body.classList.toggle('hud-expanded', on);
    this.toggleBtn?.setAttribute('aria-expanded', String(on));
    this.toggleBtn?.classList.toggle('hud-toggle-btn--active', on);
    const prefs = loadHudPrefs();
    prefs.hudExpanded = on;
    saveHudPrefs(prefs);
    themeManager.refreshFitScale(on);
    hudLayoutRuntime.apply();
  }

  handleNav(id: HUDWindowId): void {
    if (!this.controller) return;

    switch (id) {
      case 'bag':
        this.controller.openBag();
        break;
      case 'grimoire':
        this.controller.openGrimoire();
        break;
      case 'spells':
        this.controller.openSpells();
        break;
      case 'social':
        this.controller.openSocial();
        break;
      case 'coven':
        this.controller.openCoven();
        break;
      case 'teleport':
        this.controller.openTeleport();
        break;
      case 'map':
        this.controller.openMap();
        break;
      case 'settings':
        this.controller.openSettings();
        break;
    }
  }

  handleHotkey(key: string): boolean {
    const upper = key.toUpperCase();
    const card = NAV_CARDS.find((c) => c.hotkey.toUpperCase() === upper);
    if (card) {
      this.handleNav(card.id);
      return true;
    }
    return false;
  }

  private buildShell(): void {
    this.shell = document.createElement('div');
    this.shell.id = 'practitioner-hud';
    this.shell.className = 'practitioner-hud';
    hudRoot.appendChild(this.shell);

    this.buildToggle();
    this.hideHud();
    window.addEventListener('game:player-loaded', () => this.showHud());
    window.addEventListener('game:world-ready', () => {
      compassWidget.render();
      moonWidget.render();
      hudLayoutRuntime.apply();
    });

    this.visitBanner = document.createElement('div');
    this.visitBanner.className = 'hud-visit-banner';
    this.visitBanner.innerHTML = `
      <span id="hud-visit-label"></span>
      <button type="button" id="hud-visit-leave">Return Home</button>`;
    this.shell.appendChild(this.visitBanner);
    this.visitBanner.querySelector('#hud-visit-leave')?.addEventListener('click', () => {
      network.send('leave_apartment', {});
    });

    void compassWidget;
    void moonWidget;
    void playerPanel;
    void navigationBar;
    void notificationManager;
    void resourcePanel;
  }

  private buildToggle(): void {
    this.toggleBtn = document.createElement('button');
    this.toggleBtn.id = 'hud-toggle-btn';
    this.toggleBtn.type = 'button';
    this.toggleBtn.className = 'hud-toggle-btn';
    this.toggleBtn.title = 'Open practitioner workbench';
    this.toggleBtn.setAttribute('aria-label', 'Toggle practitioner HUD');
    this.toggleBtn.setAttribute('aria-expanded', 'false');
    this.toggleBtn.innerHTML = `<img src="${hudToggleIcon}" alt="" draggable="false" />`;
    this.toggleBtn.style.display = 'none';
    this.toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleExpanded();
    });
    hudRoot.appendChild(this.toggleBtn);
  }

  private wireNavigation(): void {
    navigationBar.setHandler((id) => this.handleNav(id));
  }

  private wireEvents(): void {
    window.addEventListener('game:notification', (e: Event) => {
      const msg = (e as CustomEvent<{ message: string }>).detail.message;
      notificationManager.showInfo('Notice', msg);
    });
    window.addEventListener('game:spell-result', (e: Event) => {
      const msg = (e as CustomEvent<{ message: string }>).detail.message;
      this.showMessage(msg);
    });
    window.addEventListener('game:pocket-spell-result', (e: Event) => {
      const detail = (e as CustomEvent<{ message?: string; detail?: string; success?: boolean }>).detail;
      const parts = [detail.message, detail.detail].filter(Boolean);
      const msg = parts.join(' ').trim() || (detail.success ? 'Pocket working complete.' : 'Pocket working failed.');
      this.showMessage(msg);
    });
    window.addEventListener('game:hud-action', (e: Event) => {
      const action = (e as CustomEvent<{ action: string }>).detail.action;
      if (action === 'teleport-home') this.controller?.teleportHome();
      if (action === 'social-friends') this.controller?.openSocial();
      if (action === 'social-chat') {
        window.dispatchEvent(new CustomEvent('game:focus-chat', { detail: {} }));
      }
    });
  }

  private tick(): void {
    if (this.hidden) return;

    if (gameState.visitingHostSessionId) {
      this.visitBanner.classList.add('hud-visit-banner--visible');
      const label = this.visitBanner.querySelector('#hud-visit-label');
      if (label) label.textContent = `Visiting ${gameState.visitingHostName}'s apartment — household wards shelter you.`;
    } else {
      this.visitBanner.classList.remove('hud-visit-banner--visible');
    }
  }
}

export { hudWindows };
