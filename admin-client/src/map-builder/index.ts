import { MAP_BUILDER_SECTIONS, type MapBuilderSectionId } from '@witchcraft/shared';
import { renderMapManager } from './map-manager.js';
import { renderMapEditor } from './map-editor.js';
import { mapBuilderApi } from './api.js';
import {
  renderDecorationSection,
  renderFurnitureSection,
  renderTileSection,
  renderTilesetSection,
} from './asset-editors.js';
import { syncCustomSpritesFromAssets } from './asset-sprite-sync.js';

let activeSection: MapBuilderSectionId = 'maps';
let editingMapId: string | null = null;
let cachedPermissions: string[] = [];

export async function renderMapBuilder(el: HTMLElement, permissions: string[]): Promise<void> {
  cachedPermissions = permissions;
  const perms = new Set(permissions);
  await syncCustomSpritesFromAssets().catch(() => undefined);

  const render = async () => {
    if (editingMapId) {
      await renderMapEditor(el, editingMapId, perms, () => {
        editingMapId = null;
        void render();
      });
      return;
    }

    el.innerHTML = `
      <div class="mb-shell">
        <div class="mb-header">
          <h1 class="section-title">Map Builder</h1>
          <p class="muted-text">Professional worldbuilding — maps, tilesets, collision, NPCs, spirits, wards, and publish workflow.</p>
        </div>
        <nav class="mb-subnav" id="mb-subnav">
          ${MAP_BUILDER_SECTIONS.map((s) =>
            `<button class="mb-subnav-btn ${s.id === activeSection ? 'active' : ''}" data-section="${s.id}">${s.label}</button>`
          ).join('')}
        </nav>
        <div id="mb-section-content"></div>
      </div>`;

    document.querySelectorAll('.mb-subnav-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeSection = (btn as HTMLElement).dataset.section as MapBuilderSectionId;
        void render();
      });
    });

    const sectionEl = document.getElementById('mb-section-content')!;
    await renderSection(sectionEl, activeSection, perms);
  };

  await render();
}

async function renderSection(el: HTMLElement, section: MapBuilderSectionId, perms: Set<string>): Promise<void> {
  switch (section) {
    case 'maps':
    case 'rooms':
      return renderMapManager(el, perms, (id) => {
        editingMapId = id;
        void renderMapBuilder(el, [...perms]);
      });
    case 'tilesets':
      return renderTilesetSection(el, perms);
    case 'tiles':
      return renderTileSection(el, perms);
    case 'furniture':
      return renderFurnitureSection(el, perms);
    case 'decorations':
      return renderDecorationSection(el, perms);
    case 'collision':
      return renderInfoSection(el, 'Collision Editor', 'Open a map in the editor and switch to Collision mode, or use the dedicated collision sub-tool.');
    case 'spawnpoints':
      return renderInfoSection(el, 'Spawnpoint Setter', 'Place spawnpoints in the map editor (Spawn tool) or manage them in the Spawns inspector tab.');
    case 'npcs':
      return renderInfoSection(el, 'NPC Placement', 'Select an NPC template from NPC Builder, then use the NPC tool in the map editor.');
    case 'spirits':
      return renderInfoSection(el, 'Spirit Placement', 'References Spirit Builder templates. Use Spirit tool in map editor.');
    case 'wards':
      return renderInfoSection(el, 'Room Ward Editor', 'Ward tool places wards on wardable maps. Unbreakable wards require special permission and confirmation.');
    case 'portals':
      return renderInfoSection(el, 'Portals & Exits', 'Portal tool in map editor. Set target map and spawn in inspector.');
    case 'lighting':
      return renderInfoSection(el, 'Lighting & Weather', 'Region editors — TODO: draw brightness/weather zones on map canvas.');
    case 'audio':
      return renderInfoSection(el, 'Audio Zones', 'Music and ambient region editor — TODO.');
    case 'versions':
      return renderVersionSection(el, perms);
    case 'publish':
      return renderPublishSection(el, perms);
  }
}

function renderInfoSection(el: HTMLElement, title: string, body: string): void {
  el.innerHTML = `
    <div class="card">
      <h2>${title}</h2>
      <p>${body}</p>
      <button class="btn mt" id="mb-goto-maps">Open Map Manager</button>
    </div>`;
  document.getElementById('mb-goto-maps')!.onclick = () => {
    activeSection = 'maps';
    const content = document.getElementById('content')!;
    void renderMapBuilder(content, cachedPermissions);
  };
}

async function renderVersionSection(el: HTMLElement, _perms: Set<string>): Promise<void> {
  const maps = await mapBuilderApi.listMaps();
  el.innerHTML = `
    <div class="card"><h2>Version History</h2>
      <p class="muted-text">Select a map to view versions and rollback from the map editor.</p>
      <table><thead><tr><th>Map</th><th>Version</th><th>Status</th></tr></thead>
      <tbody>${maps.map((m) =>
        `<tr><td>${m.displayName}</td><td>v${m.version}</td><td>${m.status}</td></tr>`
      ).join('')}</tbody></table>
    </div>`;
}

async function renderPublishSection(el: HTMLElement, perms: Set<string>): Promise<void> {
  const [queue, history] = await Promise.all([
    mapBuilderApi.listPublishQueue().catch(() => []),
    mapBuilderApi.listPublishHistory().catch(() => []),
  ]);
  el.innerHTML = `
    <div class="grid">
      <div class="card"><h2>Publish Queue</h2>
        <table><thead><tr><th>Map</th><th>Status</th><th>Updated</th></tr></thead>
        <tbody>${(queue as { displayName?: string; internalName?: string; status?: string; updatedAt?: string }[]).map((m) =>
          `<tr><td>${m.displayName ?? m.internalName}</td><td>${m.status}</td><td>${m.updatedAt ? new Date(m.updatedAt).toLocaleString() : '—'}</td></tr>`
        ).join('') || '<tr><td colspan="3">No drafts pending</td></tr>'}</tbody></table>
      </div>
      <div class="card"><h2>Recent Publish History</h2>
        <table><thead><tr><th>Map</th><th>Action</th><th>By</th><th>When</th></tr></thead>
        <tbody>${(history as { mapProjectId: string; action: string; publishedBy: string; createdAt: string }[]).map((h) =>
          `<tr><td>${h.mapProjectId}</td><td>${h.action}</td><td>${h.publishedBy}</td><td>${new Date(h.createdAt).toLocaleString()}</td></tr>`
        ).join('') || '<tr><td colspan="4">No history yet</td></tr>'}</tbody></table>
      </div>
    </div>
    ${!perms.has('content.map.publish') ? '<p class="muted-text mt">You need content.map.publish to publish maps.</p>' : ''}`;
}
