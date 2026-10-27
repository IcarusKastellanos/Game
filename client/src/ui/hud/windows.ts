import { defaultProgression, formatContentLabel } from '@witchcraft/shared';
import { gameState } from '../../data/game-state.js';
import { isLicenseSpellHidden } from '../license-spell-visibility.js';
import { mountGrimoire } from './grimoire-view.js';
import { network } from '../../net/NetworkManager.js';
import { escapeHtml } from '../ledger-chrome.js';
import { HUDWindowShell } from './HUDWindowShell.js';
import { loadHudPrefs, saveHudPrefs } from './hud-prefs.js';
import { navigationBar } from './NavigationBar.js';
import type { HUDWindowId } from './types.js';
import { themeManager } from './ThemeManager.js';

export class HUDWindows {
  private shells = new Map<HUDWindowId, HUDWindowShell>();
  private grimoireTab = 'The Book';

  constructor() {
    this.create('grimoire', 'Grimoire', 'What you have learned, written in one place', 'Record');
    this.create('spells', 'Spellbook', 'Workings you can carry and cast', 'Workings');
    this.create('social', 'Social Circle', 'Letters, neighbors, and friends', 'Circle');
    this.create('coven', 'Coven', 'A grove kept in common', 'Grove');
    this.create('teleport', 'Wayfinding', 'Doorways between the places you know', 'Threshold');
    this.create('map', 'World Map', 'Paths and ground you have walked', 'Paths');
    this.create('settings', 'Settings', 'How the workbench sits with you', 'Comfort');
    this.renderAll();
    window.addEventListener('game:player-sync', () => this.renderDynamic());
    window.addEventListener('game:progression-update', () => {
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        active.closest('.hud-grimoire') &&
        (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement)
      ) {
        return;
      }
      this.renderGrimoire();
    });
  }

  private create(id: HUDWindowId, title: string, subtitle: string, kicker: string): void {
    this.shells.set(id, new HUDWindowShell(id, title, subtitle, kicker));
  }

  get(id: HUDWindowId): HUDWindowShell | undefined {
    return this.shells.get(id);
  }

  toggle(id: HUDWindowId): void {
    const w = this.shells.get(id);
    w?.toggle();
    if (w?.isOpen()) this.renderWindow(id);
  }

  hide(id: HUDWindowId): void {
    this.shells.get(id)?.hide();
  }

  hideAll(): void {
    for (const w of this.shells.values()) w.hide();
  }

  renderWindow(id: HUDWindowId): void {
    switch (id) {
      case 'grimoire':
        this.renderGrimoire();
        break;
      case 'spells':
        this.renderSpells();
        break;
      case 'social':
        this.renderSocial();
        break;
      case 'coven':
        this.renderCoven();
        break;
      case 'teleport':
        this.renderTeleport();
        break;
      case 'map':
        this.renderMap();
        break;
      case 'settings':
        this.renderSettings();
        break;
    }
  }

  private renderAll(): void {
    for (const id of this.shells.keys()) this.renderWindow(id);
  }

  private renderDynamic(): void {
    if (this.shells.get('spells')?.isOpen()) this.renderSpells();
    if (this.shells.get('social')?.isOpen()) this.renderSocial();
  }

  renderGrimoire(): void {
    const w = this.shells.get('grimoire');
    if (!w) return;
    mountGrimoire(w.body, this.grimoireTab, (tab) => {
      this.grimoireTab = tab;
    });
  }

  private renderSpells(): void {
    const w = this.shells.get('spells');
    if (!w) return;
    const pockets = gameState.progression?.pocketSpells ?? [];
    const progression = gameState.progression ?? defaultProgression();
    const spells = (gameState.content?.spells ?? []).filter((spell) => !isLicenseSpellHidden(spell, progression));

    w.setBodyHtml(`
      <div class="hud-spells">
        <p>Three workings can wait in your pockets. The rest stay in this book until you prepare them.</p>
        <section>
          <h3>Pocket spells (${pockets.length} of 3)</h3>
          <ul class="hud-list">${pockets.map((p) => `<li>${escapeHtml(formatContentLabel(p.spellId))} — ${Math.round(p.storedMe)} magical energy stored</li>`).join('') || '<li class="hud-muted">Prepare one at the enchanting table.</li>'}</ul>
        </section>
        <section>
          <h3>Known rituals</h3>
          <ul class="hud-list">${spells.slice(0, 20).map((s) => `<li>${escapeHtml(s.name)} — ${escapeHtml(formatContentLabel(s.category))}, difficulty ${s.difficulty}</li>`).join('')}</ul>
        </section>
        <p class="hud-muted">Cast from the person you are facing. A hotbar for these pockets is still being bound.</p>
      </div>`);
  }

  private renderSocial(): void {
    const w = this.shells.get('social');
    if (!w) return;
    const friends = gameState.friendPresence ?? [];
    const nearby = gameState.nearbyPlayers ?? [];

    w.setBodyHtml(`
      <div class="hud-social">
        <p>The circle is who you write to. The street is who is close enough to greet.</p>
        <div class="hud-social__actions">
          <button type="button" class="hud-btn" id="social-open-friends">Open friends</button>
          <button type="button" class="hud-btn" id="social-open-chat">Open chat</button>
        </div>
        <h3>Nearby practitioners</h3>
        <ul class="hud-list">${nearby.map((p) => `<li>${escapeHtml(p.displayName)}</li>`).join('') || '<li class="hud-muted">No one is in range.</li>'}</ul>
        <h3>Friends online</h3>
        <ul class="hud-list">${friends.filter((f) => f.online).map((f) => `<li>${escapeHtml(f.displayName)} — level ${f.level ?? '?'}</li>`).join('') || '<li class="hud-muted">No friends are online.</li>'}</ul>
      </div>`);

    w.body.querySelector('#social-open-friends')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('game:hud-action', { detail: { action: 'social-friends' } }));
    });
    w.body.querySelector('#social-open-chat')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('game:hud-action', { detail: { action: 'social-chat' } }));
    });
  }

  private renderCoven(): void {
    const w = this.shells.get('coven');
    w?.setBodyHtml(`
      <div class="hud-coven">
        <p>A coven is a grove kept by more than one practitioner: names, a treasury, and rituals no one holds alone. This page is where those bonds will be written.</p>
        <ul class="hud-list">
          <li>Members and the ranks they keep</li>
          <li>The tree at the center, and how it grows</li>
          <li>A shelf of workings shared by the circle</li>
        </ul>
        <p class="hud-muted">The grove itself is still being raised.</p>
      </div>`);
  }

  private renderTeleport(): void {
    const w = this.shells.get('teleport');
    if (!w) return;
    const scene = gameState.currentScene;
    const visiting = !!gameState.visitingHostSessionId;

    w.setBodyHtml(`
      <div class="hud-teleport">
        <div class="hud-teleport__door">
          <div class="hud-teleport__portal"></div>
        </div>
        <p class="hud-lead">You are in <strong>${visiting ? `${escapeHtml(gameState.visitingHostName ?? 'a friend')}'s apartment` : scene === 'apartment' ? 'your sanctum' : 'Hollow Creek'}</strong>.</p>
        <div class="hud-teleport__actions">
          ${visiting ? '<button type="button" class="hud-btn hud-btn--primary" id="tp-leave">Return home</button>' : ''}
          ${scene === 'town' ? '<button type="button" class="hud-btn hud-btn--primary" id="tp-apartment">Step through to your sanctum</button>' : ''}
          ${scene === 'apartment' && !visiting ? '<button type="button" class="hud-btn" id="tp-town">Walk to town by the door</button>' : ''}
        </div>
        <p class="hud-muted">The temple and the astral roads open as your recognition grows.</p>
      </div>`);

    w.body.querySelector('#tp-leave')?.addEventListener('click', () => {
      network.send('leave_apartment', {});
      w.hide();
    });
    w.body.querySelector('#tp-apartment')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('game:hud-action', { detail: { action: 'teleport-home' } }));
      w.hide();
    });
    w.body.querySelector('#tp-town')?.addEventListener('click', () => {
      w.setBodyHtml('<p>Use the door of your sanctum when you want the town. This page cannot carry you there.</p>');
    });
  }

  private renderMap(): void {
    const w = this.shells.get('map');
    if (!w) return;
    const maps = gameState.content?.maps ?? [];
    w.setBodyHtml(`
      <div class="hud-map">
        <div class="hud-map__canvas">
          <div class="hud-map__scroll"></div>
        </div>
        <ul class="hud-list">
          ${maps.map((m) => `<li>${escapeHtml(formatContentLabel(m.sceneId))} — ${m.width} by ${m.height} tiles</li>`).join('')}
        </ul>
        <p class="hud-muted">Quest marks, ley lines, and spirit sightings will be drawn here as you learn the ground.</p>
      </div>`);
  }

  private renderSettings(): void {
    const w = this.shells.get('settings');
    if (!w) return;
    const scale = themeManager.getScale();
    const navCollapsed = loadHudPrefs().navCollapsed;
    w.setBodyHtml(`
      <div class="hud-settings">
        <h3>Scale</h3>
        <p>How large the workbench sits on your screen.</p>
        <label class="hud-settings__row"><span>UI scale</span><input type="range" id="set-scale" min="50" max="150" step="1" value="${Math.round(scale * 100)}" /></label>
        <p class="hud-muted" id="set-scale-note">Scale: ${Math.round(scale * 100)}% of the window fit. Applied size: ${Math.round(themeManager.getCombinedScale() * 100)}%.</p>
        <label class="hud-settings__row"><input type="checkbox" id="set-nav-collapsed"${navCollapsed ? ' checked' : ''} /> Fold the navigation cards until you ask for them</label>
        <h3>Sound</h3>
        <p class="hud-muted">You hear the room you are standing in. A separate mixer is not on this page yet.</p>
        <h3>Keys</h3>
        <ul class="hud-list hud-list--keys">
          <li><kbd>B</kbd> Bag · <kbd>G</kbd> Grimoire · <kbd>K</kbd> Spells</li>
          <li><kbd>N</kbd> or <kbd>P</kbd> Social Circle · <kbd>C</kbd> Coven · <kbd>T</kbd> Wayfinding</li>
          <li><kbd>M</kbd> Map · <kbd>I</kbd> Inventory · <kbd>J</kbd> Journal</li>
          <li><kbd>Y</kbd> Ledger · <kbd>X</kbd> Aura · <kbd>F</kbd> Familiar</li>
        </ul>
        ${gameState.isAdmin ? '<p class="hud-muted">Admin: /apanel opens the panel · ` opens the console · admin site on port 5174</p>' : ''}
      </div>`);

    w.body.querySelector('#set-nav-collapsed')?.addEventListener('change', (e) => {
      const collapsed = (e.target as HTMLInputElement).checked;
      const prefs = loadHudPrefs();
      prefs.navCollapsed = collapsed;
      saveHudPrefs(prefs);
      navigationBar.setCollapsed(collapsed);
    });

    const slider = w.body.querySelector('#set-scale') as HTMLInputElement | null;
    const note = w.body.querySelector('#set-scale-note');
    const preview = (): void => {
      if (!slider || !note) return;
      note.textContent = `Scale: ${slider.value}% — applied when you release the slider. Current size: ${Math.round(
        themeManager.getCombinedScale() * 100
      )}%.`;
    };
    const apply = (): void => {
      if (!slider) return;
      themeManager.setScale(Number(slider.value) / 100);
      preview();
    };
    slider?.addEventListener('input', preview);
    slider?.addEventListener('change', apply);
    preview();
  }
}

export const hudWindows = new HUDWindows();
