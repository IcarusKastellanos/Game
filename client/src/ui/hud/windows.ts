import { formatContentLabel } from '@witchcraft/shared';
import { gameState } from '../../data/game-state.js';
import { network } from '../../net/NetworkManager.js';
import { escapeHtml } from '../ledger-chrome.js';
import { HUDWindowShell } from './HUDWindowShell.js';
import { loadHudPrefs, saveHudPrefs } from './hud-prefs.js';
import { navigationBar } from './NavigationBar.js';
import type { HUDWindowId } from './types.js';
import { themeManager } from './ThemeManager.js';

const GRIMOIRE_SECTIONS = [
  'Basics', 'Spells', 'Hexes', 'Rituals', 'Herbology', 'Potions', 'Spirits', 'Familiars',
  'NPCs', 'Locations', 'Coven History', 'Bestiary', 'Temple Records', 'Correspondences',
  'Dreams', 'Investigations', 'Notes',
];

export class HUDWindows {
  private shells = new Map<HUDWindowId, HUDWindowShell>();

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
    window.addEventListener('game:progression-update', () => this.renderGrimoire());
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
    const prog = gameState.progression;
    const discovered = prog?.discoveredCorrespondences ?? [];
    const books = prog?.readBooks ?? [];
    const recipes = prog?.discoveredRecipes ?? [];

    w.setBodyHtml(`
      <div class="hud-grimoire">
        <nav class="hud-grimoire__tabs">
          ${GRIMOIRE_SECTIONS.map((s, i) => `<button type="button" class="hud-grimoire__tab${i === 0 ? ' is-active' : ''}" data-tab="${s}">${s}</button>`).join('')}
        </nav>
        <div class="hud-grimoire__page">
          <div class="hud-grimoire__section" id="grimoire-section">
            <h3>Correspondences</h3>
            <p>You have written down ${discovered.length} ingredients, read ${books.length} books, and learned ${recipes.length} recipes.</p>
            <ul class="hud-grimoire__list">${discovered.slice(0, 24).map((id) => `<li>${escapeHtml(formatContentLabel(id))}</li>`).join('') || '<li class="hud-muted">Discover more by reading, crafting, and experimenting.</li>'}</ul>
            <p class="hud-muted">Press <kbd>J</kbd> for the correspondence journal. The rest of these pages are still being copied.</p>
          </div>
        </div>
      </div>`);

    w.body.querySelectorAll('.hud-grimoire__tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        w.body.querySelectorAll('.hud-grimoire__tab').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        const tab = (btn as HTMLElement).dataset.tab ?? 'Notes';
        const section = w.body.querySelector('#grimoire-section');
        if (section) {
          section.innerHTML = `<h3>${escapeHtml(tab)}</h3><p>These pages are still being copied. What you have already learned stays listed under Correspondences.</p>`;
        }
      });
    });
  }

  private renderSpells(): void {
    const w = this.shells.get('spells');
    if (!w) return;
    const pockets = gameState.progression?.pocketSpells ?? [];
    const spells = gameState.content?.spells ?? [];

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
          <button type="button" class="hud-btn" id="social-open-friends">Open the circle <kbd>P</kbd></button>
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
          <li><kbd>N</kbd> Social · <kbd>C</kbd> Coven · <kbd>T</kbd> Wayfinding</li>
          <li><kbd>M</kbd> Map · <kbd>I</kbd> Inventory · <kbd>J</kbd> Journal</li>
          <li><kbd>Y</kbd> Ledger · <kbd>X</kbd> Aura · <kbd>F</kbd> Familiar · <kbd>P</kbd> Friends</li>
        </ul>
        ${gameState.isAdmin ? '<p class="hud-muted">Admin: F1 console · admin panel port 5174</p>' : ''}
      </div>`);

    w.body.querySelector('#set-nav-collapsed')?.addEventListener('change', (e) => {
      const collapsed = (e.target as HTMLInputElement).checked;
      const prefs = loadHudPrefs();
      prefs.navCollapsed = collapsed;
      saveHudPrefs(prefs);
      navigationBar.setCollapsed(collapsed);
    });

    w.body.querySelector('#set-scale')?.addEventListener('input', (e) => {
      const v = Number((e.target as HTMLInputElement).value) / 100;
      themeManager.setScale(v);
      const note = w.body.querySelector('#set-scale-note');
      if (note) {
        note.textContent = `Scale: ${Math.round(themeManager.getScale() * 100)}% of window fit · Applied size: ${Math.round(
          themeManager.getCombinedScale() * 100
        )}%`;
      }
    });
  }
}

export const hudWindows = new HUDWindows();
