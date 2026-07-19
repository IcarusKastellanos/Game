import { gameState } from '../../data/game-state.js';
import { network } from '../../net/NetworkManager.js';
import { HUDWindowShell } from './HUDWindowShell.js';
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
    this.create('grimoire', 'Grimoire', 'Magical encyclopedia');
    this.create('spells', 'Spellbook', 'Prepared workings');
    this.create('social', 'Social Circle', 'Letters & practitioners');
    this.create('coven', 'Coven', 'Shared grove (expansion)');
    this.create('teleport', 'Wayfinding', 'Doorways between realms');
    this.create('map', 'World Map', 'Known paths & ley lines');
    this.create('settings', 'Workbench Settings', 'Comfort & accessibility');
    this.renderAll();
    window.addEventListener('game:player-sync', () => this.renderDynamic());
    window.addEventListener('game:progression-update', () => this.renderGrimoire());
  }

  private create(id: HUDWindowId, title: string, subtitle: string): void {
    this.shells.set(id, new HUDWindowShell(id, title, subtitle));
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
            <p class="hud-muted">${discovered.length} ingredients documented · ${books.length} books read · ${recipes.length} recipes known</p>
            <ul class="hud-grimoire__list">${discovered.slice(0, 24).map((id) => `<li>${id}</li>`).join('') || '<li class="hud-muted">Discover through books, craft, and experiment.</li>'}</ul>
            <p class="hud-grimoire__hint">Press <kbd>J</kbd> for quick journal · full page-turn UI — Phase 1</p>
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
          section.innerHTML = `<h3>${tab}</h3><p class="hud-muted">Section content loads from server Grimoire state (Phase 1).</p>`;
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
        <section>
          <h3>Pocket Spells (${pockets.length}/3)</h3>
          <ul class="hud-list">${pockets.map((p) => `<li>${p.spellId} · ${Math.round(p.storedMe)} ME</li>`).join('') || '<li class="hud-muted">Prepare at Enchanting Table</li>'}</ul>
        </section>
        <section>
          <h3>Known Rituals</h3>
          <ul class="hud-list hud-list--scroll">${spells.slice(0, 20).map((s) => `<li>${s.name} · ${s.category} · diff ${s.difficulty}</li>`).join('')}</ul>
        </section>
        <p class="hud-muted">Drag to hotbar — coming soon. Target panel for quick cast.</p>
      </div>`);
  }

  private renderSocial(): void {
    const w = this.shells.get('social');
    if (!w) return;
    const friends = gameState.friendPresence ?? [];
    const nearby = gameState.nearbyPlayers ?? [];

    w.setBodyHtml(`
      <div class="hud-social">
        <div class="hud-social__actions">
          <button type="button" class="hud-btn" id="social-open-friends">Open Circle [P]</button>
          <button type="button" class="hud-btn" id="social-open-chat">Open Chat</button>
        </div>
        <h3>Nearby Practitioners</h3>
        <ul class="hud-list">${nearby.map((p) => `<li>${p.displayName}</li>`).join('') || '<li class="hud-muted">None in range</li>'}</ul>
        <h3>Friends Online</h3>
        <ul class="hud-list">${friends.filter((f) => f.online).map((f) => `<li>${f.displayName} · Lv ${f.level ?? '?'}</li>`).join('') || '<li class="hud-muted">No friends online</li>'}</ul>
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
        <p class="hud-muted">Covens expansion — grove, treasury, shared rituals.</p>
        <ul class="hud-list">
          <li>Members & ranks</li>
          <li>Magical tree tiers</li>
          <li>Shared grimoire shelf</li>
        </ul>
        <p>See <code>server/src/systems/expansion-coven.ts</code></p>
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
        <p>You are in: <strong>${visiting ? `${gameState.visitingHostName}'s apartment` : scene === 'apartment' ? 'Your Sanctum' : 'Hollow Creek Town'}</strong></p>
        <div class="hud-teleport__actions">
          ${visiting ? '<button type="button" class="hud-btn hud-btn--primary" id="tp-leave">Return Home</button>' : ''}
          ${scene === 'town' ? '<button type="button" class="hud-btn hud-btn--primary" id="tp-apartment">Teleport to Sanctum</button>' : ''}
          ${scene === 'apartment' && !visiting ? '<button type="button" class="hud-btn" id="tp-town">Walk to Town (door)</button>' : ''}
        </div>
        <p class="hud-muted">Temple & astral destinations unlock via recognition.</p>
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
      w.setBodyHtml('<p class="hud-muted">Use your apartment door to travel to town.</p>');
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
          ${maps.map((m) => `<li>${m.sceneId} · ${m.width}×${m.height}</li>`).join('')}
        </ul>
        <p class="hud-muted">Quest markers, ley lines, spirit sightings — Phase 1 map layer.</p>
      </div>`);
  }

  private renderSettings(): void {
    const w = this.shells.get('settings');
    if (!w) return;
    const scale = themeManager.getScale();
    w.setBodyHtml(`
      <div class="hud-settings">
        <label class="hud-settings__row">UI Scale <input type="range" id="set-scale" min="50" max="150" step="1" value="${Math.round(scale * 100)}" /></label>
        <p class="hud-muted" id="set-scale-note">Scale: ${Math.round(scale * 100)}% of window fit · Applied size: ${Math.round(themeManager.getCombinedScale() * 100)}%</p>
        <label class="hud-settings__row"><input type="checkbox" id="set-nav-collapsed" /> Collapse nav cards by default</label>
        <h3>Audio</h3>
        <p class="hud-muted">Ambient volume controlled in scene — full mixer Phase 1.</p>
        <h3>Controls</h3>
        <ul class="hud-list hud-list--keys">
          <li><kbd>B</kbd> Bag · <kbd>G</kbd> Grimoire · <kbd>K</kbd> Spells</li>
          <li><kbd>N</kbd> Social · <kbd>C</kbd> Coven · <kbd>T</kbd> Teleport</li>
          <li><kbd>M</kbd> Map · <kbd>I</kbd> Inventory · <kbd>J</kbd> Journal</li>
          <li><kbd>X</kbd> Aura · <kbd>F</kbd> Familiar · <kbd>P</kbd> Friends</li>
        </ul>
        ${gameState.isAdmin ? '<p class="hud-muted">Admin: F1 console · admin panel port 5174</p>' : ''}
      </div>`);

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
