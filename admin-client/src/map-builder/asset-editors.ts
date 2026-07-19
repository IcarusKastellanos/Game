import { mapBuilderApi } from './api.js';
import {
  getInteractionTypeFromProperties,
  INTERACTION_TYPE_OPTIONS,
} from '@witchcraft/shared';
import { showToast } from './toast.js';
import { esc, field, textInput, numberInput, selectInput } from '../helpers/form-html.js';
import {
  assetModalBody,
  mountMapSpritePanel,
  readData,
  readProperties,
  spriteThumbHtml,
} from './map-sprite-panel.js';
import { getSpritePixels, getTilesetSprites, mapCategoryFillColor, setTilesetSprite, withSpritePixels } from './sprite-storage.js';
import { syncCustomSpritesFromAssets } from './asset-sprite-sync.js';

interface MapTileset {
  id: string;
  name: string;
  imageUrl: string | null;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
  tags: string[];
  data?: Record<string, unknown>;
  archived: boolean;
}

interface MapTileDefinition {
  id: string;
  name: string;
  tilesetId: string;
  category: string;
  spriteRef: string;
  walkable: boolean;
  tags: string[];
  properties?: Record<string, unknown>;
  archived: boolean;
}

interface MapFurnitureDefinition {
  id: string;
  name: string;
  category: string;
  spriteRef: string;
  width: number;
  height: number;
  properties?: Record<string, unknown>;
  archived: boolean;
}

interface MapDecorationDefinition {
  id: string;
  name: string;
  spriteRef: string;
  wallMounted: boolean;
  properties?: Record<string, unknown>;
  archived: boolean;
}

const TILE_CATEGORIES = [
  { value: 'floor', label: 'Floor' },
  { value: 'wall', label: 'Wall' },
  { value: 'ground', label: 'Ground' },
];

function tagsToString(tags: string[] | unknown): string {
  if (Array.isArray(tags)) return tags.join(', ');
  return '';
}

function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function archivedBadge(archived: boolean): string {
  return archived ? '<span class="badge status-archived">archived</span>' : '';
}

function openModal(title: string, bodyHtml: string, onMount: (overlay: HTMLElement) => void, wide = false): void {
  const overlay = document.createElement('div');
  overlay.className = 'mb-modal-overlay';
  overlay.innerHTML = `
    <div class="mb-modal card${wide ? ' mb-modal-wide' : ''}">
      <h2>${esc(title)}</h2>
      ${bodyHtml}
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  onMount(overlay);
}

function bindCancel(overlay: HTMLElement, id = 'asset-cancel'): void {
  overlay.querySelector(`#${id}`)?.addEventListener('click', () => overlay.remove());
}

function readCheckbox(id: string): boolean {
  return (document.getElementById(id) as HTMLInputElement | null)?.checked ?? false;
}

export async function renderTilesetSection(el: HTMLElement, perms: Set<string>): Promise<void> {
  let showArchived = false;
  const canEdit = perms.has('content.map.edit');

  const render = async () => {
    let items: MapTileset[] = [];
    try {
      items = await mapBuilderApi.listTilesets(showArchived);
    } catch (e) {
      showToast(String(e), 'error');
    }

    el.innerHTML = `
      <div class="mb-toolbar">
        <div class="flex">
          ${canEdit ? '<button class="btn" id="asset-new">+ New Tileset</button>' : ''}
          <label class="checkbox-chip"><input type="checkbox" id="asset-show-archived" ${showArchived ? 'checked' : ''} /> Show archived</label>
        </div>
        <input id="asset-search" placeholder="Search..." class="mb-search" />
      </div>
      <table class="mt mb-table">
        <thead><tr>
          <th>Name</th><th>ID</th><th>Size</th><th>Grid</th><th>Image</th><th>Sprite</th><th></th>
        </tr></thead>
        <tbody id="asset-rows">${tilesetRows(items)}</tbody>
      </table>`;

    document.getElementById('asset-show-archived')!.onchange = (e) => {
      showArchived = (e.target as HTMLInputElement).checked;
      void render();
    };
    document.getElementById('asset-search')!.oninput = (e) =>
      filterAssetRows((e.target as HTMLInputElement).value);

    if (canEdit) {
      document.getElementById('asset-new')!.onclick = () => openTilesetModal(null, render);
      el.querySelectorAll('.asset-edit').forEach((b) => {
        b.addEventListener('click', () => {
          const id = String((b as HTMLElement).dataset.id);
          const item = items.find((i) => i.id === id);
          if (item) openTilesetModal(item, render);
        });
      });
    }
  };

  await render();
}

function tilesetRows(items: MapTileset[]): string {
  return items
    .map(
      (t) => {
        const sprites = getTilesetSprites(t.data);
        const firstKey = Object.keys(sprites)[0] ?? 'tile_grass';
        const thumb = spriteThumbHtml(firstKey, sprites[firstKey]);
        return `
    <tr data-name="${t.name.toLowerCase()} ${t.id.toLowerCase()}">
      <td><strong>${esc(t.name)}</strong> ${archivedBadge(t.archived)}</td>
      <td class="muted-text">${esc(t.id)}</td>
      <td>${t.tileWidth}×${t.tileHeight}</td>
      <td>${t.columns}×${t.rows}</td>
      <td class="muted-text">${esc(t.imageUrl ?? '—')}</td>
      <td>${thumb}</td>
      <td class="mb-actions"><button class="btn secondary asset-edit" data-id="${esc(t.id)}">Edit</button></td>
    </tr>`;
      }
    )
    .join('');
}

function openTilesetModal(item: MapTileset | null, refresh: () => Promise<void>): void {
  const isNew = !item;
  const data: MapTileset = item ?? {
    id: '',
    name: '',
    imageUrl: null,
    tileWidth: 16,
    tileHeight: 16,
    columns: 16,
    rows: 16,
    tags: [],
    data: {},
    archived: false,
  };
  const existingData = readData(data.data);
  const sprites = getTilesetSprites(existingData);
  const defaultSpriteKey = Object.keys(sprites)[0] ?? 'tile_grass';

  const form = `
    ${field('ID', textInput('asset-id', data.id, 'unique_id'), isNew ? '' : 'readonly-field')}
    ${field('Name', textInput('asset-name', data.name))}
    ${field('Image URL', textInput('asset-image', data.imageUrl ?? ''))}
    <div class="form-grid">
      ${field('Tile width', numberInput('asset-tile-w', data.tileWidth))}
      ${field('Tile height', numberInput('asset-tile-h', data.tileHeight))}
      ${field('Columns', numberInput('asset-cols', data.columns))}
      ${field('Rows', numberInput('asset-rows-n', data.rows))}
    </div>
    ${field('Tags (comma-separated)', textInput('asset-tags', tagsToString(data.tags)))}
    ${field('Sprite key to edit', textInput('asset-sprite-key', defaultSpriteKey, 'tile_grass'))}
    <p class="muted-text">Custom sprites are stored in tileset data under this key.</p>
    <div class="flex mt">
      <button class="btn" id="asset-save">Save</button>
      ${!isNew ? '<button class="btn danger" id="asset-archive">Archive</button>' : ''}
      <button class="btn secondary" id="asset-cancel">Cancel</button>
    </div>`;

  openModal(isNew ? 'New Tileset' : `Edit ${data.name}`, assetModalBody(form), (overlay) => {
    if (!isNew) {
      const idInput = overlay.querySelector('#asset-id') as HTMLInputElement;
      idInput.readOnly = true;
    }
    bindCancel(overlay);

    const spriteKeyInput = overlay.querySelector('#asset-sprite-key') as HTMLInputElement;
    const spritePanel = mountMapSpritePanel(overlay, {
      initialPixels: sprites[defaultSpriteKey],
      spriteRef: () => spriteKeyInput.value.trim() || defaultSpriteKey,
      fillColor: () => mapCategoryFillColor('ground'),
    });

    spriteKeyInput.addEventListener('change', () => {
      const key = spriteKeyInput.value.trim() || 'tile_grass';
      const nextPx = getTilesetSprites(existingData)[key];
      if (nextPx) spritePanel.setPixels(nextPx);
      else spritePanel.loadBuiltin();
    });

    overlay.querySelector('#asset-save')!.addEventListener('click', async () => {
      const id = (overlay.querySelector('#asset-id') as HTMLInputElement).value.trim();
      if (!id) {
        showToast('ID required', 'error');
        return;
      }
      const spriteKey = spriteKeyInput.value.trim() || 'tile_grass';
      const pixels = spritePanel.getPixels();
      try {
        await mapBuilderApi.upsertTileset(id, {
          id,
          name: (overlay.querySelector('#asset-name') as HTMLInputElement).value.trim(),
          imageUrl: (overlay.querySelector('#asset-image') as HTMLInputElement).value.trim() || null,
          tileWidth: Number((overlay.querySelector('#asset-tile-w') as HTMLInputElement).value),
          tileHeight: Number((overlay.querySelector('#asset-tile-h') as HTMLInputElement).value),
          columns: Number((overlay.querySelector('#asset-cols') as HTMLInputElement).value),
          rows: Number((overlay.querySelector('#asset-rows-n') as HTMLInputElement).value),
          tags: parseTags((overlay.querySelector('#asset-tags') as HTMLInputElement).value),
          data: setTilesetSprite(existingData, spriteKey, pixels),
          archived: false,
        });
        overlay.remove();
        showToast('Tileset saved', 'success');
        await syncCustomSpritesFromAssets();
        await refresh();
      } catch (e) {
        showToast(String(e), 'error');
      }
    });

    overlay.querySelector('#asset-archive')?.addEventListener('click', async () => {
      if (!confirm('Archive this tileset?')) return;
      const id = (overlay.querySelector('#asset-id') as HTMLInputElement).value.trim();
      const spriteKey = spriteKeyInput.value.trim() || 'tile_grass';
      try {
        await mapBuilderApi.upsertTileset(id, {
          id,
          name: (overlay.querySelector('#asset-name') as HTMLInputElement).value.trim(),
          imageUrl: (overlay.querySelector('#asset-image') as HTMLInputElement).value.trim() || null,
          tileWidth: Number((overlay.querySelector('#asset-tile-w') as HTMLInputElement).value),
          tileHeight: Number((overlay.querySelector('#asset-tile-h') as HTMLInputElement).value),
          columns: Number((overlay.querySelector('#asset-cols') as HTMLInputElement).value),
          rows: Number((overlay.querySelector('#asset-rows-n') as HTMLInputElement).value),
          tags: parseTags((overlay.querySelector('#asset-tags') as HTMLInputElement).value),
          data: setTilesetSprite(existingData, spriteKey, spritePanel.getPixels()),
          archived: true,
        });
        overlay.remove();
        showToast('Tileset archived', 'success');
        await refresh();
      } catch (e) {
        showToast(String(e), 'error');
      }
    });
  }, true);
}

export async function renderTileSection(el: HTMLElement, perms: Set<string>): Promise<void> {
  let showArchived = false;
  const canEdit = perms.has('content.map.edit');

  const render = async () => {
    let items: MapTileDefinition[] = [];
    let tilesets: MapTileset[] = [];
    try {
      [items, tilesets] = await Promise.all([
        mapBuilderApi.listTiles(showArchived),
        mapBuilderApi.listTilesets(showArchived),
      ]);
    } catch (e) {
      showToast(String(e), 'error');
    }

    el.innerHTML = `
      <div class="mb-toolbar">
        <div class="flex">
          ${canEdit ? '<button class="btn" id="asset-new">+ New Tile</button>' : ''}
          ${canEdit ? '<button class="btn secondary" id="asset-seed">Seed defaults</button>' : ''}
          <label class="checkbox-chip"><input type="checkbox" id="asset-show-archived" ${showArchived ? 'checked' : ''} /> Show archived</label>
        </div>
        <input id="asset-search" placeholder="Search..." class="mb-search" />
      </div>
      <p class="muted-text">Default catalog tiles from MAP_TILE_CATALOG. Use <strong>Seed defaults</strong> to upsert the default tileset and catalog entries to the database.</p>
      <table class="mt mb-table">
        <thead><tr>
          <th>Name</th><th>ID</th><th>Tileset</th><th>Category</th><th>Sprite</th><th>Preview</th><th>Walkable</th><th></th>
        </tr></thead>
        <tbody id="asset-rows">${tileRows(items)}</tbody>
      </table>`;

    document.getElementById('asset-show-archived')!.onchange = (e) => {
      showArchived = (e.target as HTMLInputElement).checked;
      void render();
    };
    document.getElementById('asset-search')!.oninput = (e) =>
      filterAssetRows((e.target as HTMLInputElement).value);

    if (canEdit) {
      document.getElementById('asset-new')!.onclick = () => openTileModal(null, tilesets, render);
      document.getElementById('asset-seed')!.onclick = () => void seedDefaults(render);
      el.querySelectorAll('.asset-edit').forEach((b) => {
        b.addEventListener('click', () => {
          const id = String((b as HTMLElement).dataset.id);
          const item = items.find((i) => i.id === id);
          if (item) openTileModal(item, tilesets, render);
        });
      });
    }
  };

  await render();
}

async function seedDefaults(refresh: () => Promise<void>): Promise<void> {
  if (!confirm('Seed default tileset and MAP_TILE_CATALOG tile definitions to the database?')) return;
  try {
    const result = await mapBuilderApi.seedDefaultAssets();
    showToast(`Seeded tileset "${result.tilesetId}" with ${result.tiles} tile(s)`, 'success');
    await refresh();
  } catch (e) {
    showToast(String(e), 'error');
  }
}

function tileRows(items: MapTileDefinition[]): string {
  return items
    .map(
      (t) => {
        const px = getSpritePixels(t.properties);
        return `
    <tr data-name="${t.name.toLowerCase()} ${t.id.toLowerCase()} ${t.spriteRef.toLowerCase()}">
      <td><strong>${esc(t.name)}</strong> ${archivedBadge(t.archived)}</td>
      <td class="muted-text">${esc(t.id)}</td>
      <td>${esc(t.tilesetId)}</td>
      <td><span class="badge">${esc(t.category)}</span></td>
      <td class="muted-text">${esc(t.spriteRef)}</td>
      <td>${spriteThumbHtml(t.spriteRef, px)}</td>
      <td>${t.walkable ? 'yes' : 'no'}</td>
      <td class="mb-actions"><button class="btn secondary asset-edit" data-id="${esc(t.id)}">Edit</button></td>
    </tr>`;
      }
    )
    .join('');
}

function openTileModal(
  item: MapTileDefinition | null,
  tilesets: MapTileset[],
  refresh: () => Promise<void>
): void {
  const isNew = !item;
  const data: MapTileDefinition = item ?? {
    id: '',
    name: '',
    tilesetId: tilesets[0]?.id ?? 'default',
    category: 'floor',
    spriteRef: '',
    walkable: true,
    tags: [],
    properties: {},
    archived: false,
  };
  const properties = readProperties(data.properties);

  const tilesetOptions = tilesets.map((t) => ({ value: t.id, label: t.name }));
  if (!tilesetOptions.length) tilesetOptions.push({ value: 'default', label: 'default' });

  const form = `
    ${field('ID', textInput('asset-id', data.id, 'unique_id'), isNew ? '' : 'readonly-field')}
    ${field('Name', textInput('asset-name', data.name))}
    ${field('Tileset', selectInput('asset-tileset', tilesetOptions, data.tilesetId))}
    ${field('Category', selectInput('asset-category', TILE_CATEGORIES, data.category))}
    ${field('Sprite ref', textInput('asset-sprite', data.spriteRef, 'tile_grass'))}
  <label class="form-field checkbox-chip"><input type="checkbox" id="asset-walkable" ${data.walkable ? 'checked' : ''} /> Walkable</label>
    ${field('Tags (comma-separated)', textInput('asset-tags', tagsToString(data.tags)))}
    <div class="flex mt">
      <button class="btn" id="asset-save">Save</button>
      ${!isNew ? '<button class="btn danger" id="asset-archive">Archive</button>' : ''}
      <button class="btn secondary" id="asset-cancel">Cancel</button>
    </div>`;

  openModal(isNew ? 'New Tile Definition' : `Edit ${data.name}`, assetModalBody(form), (overlay) => {
    if (!isNew) {
      (overlay.querySelector('#asset-id') as HTMLInputElement).readOnly = true;
    }
    bindCancel(overlay);

    const spriteInput = overlay.querySelector('#asset-sprite') as HTMLInputElement;
    const categoryInput = overlay.querySelector('#asset-category') as HTMLSelectElement;
    const spritePanel = mountMapSpritePanel(overlay, {
      initialPixels: getSpritePixels(properties),
      spriteRef: () => spriteInput.value.trim(),
      fillColor: () => mapCategoryFillColor(categoryInput.value),
    });

    spriteInput.addEventListener('change', () => spritePanel.loadBuiltin());

    const save = async (archived: boolean) => {
      const id = (overlay.querySelector('#asset-id') as HTMLInputElement).value.trim();
      if (!id) {
        showToast('ID required', 'error');
        return;
      }
      await mapBuilderApi.upsertTile(id, {
        id,
        name: (overlay.querySelector('#asset-name') as HTMLInputElement).value.trim(),
        tilesetId: (overlay.querySelector('#asset-tileset') as HTMLSelectElement).value,
        category: categoryInput.value,
        spriteRef: spriteInput.value.trim(),
        walkable: readCheckbox('asset-walkable'),
        tags: parseTags((overlay.querySelector('#asset-tags') as HTMLInputElement).value),
        properties: withSpritePixels(properties, spritePanel.getPixels()),
        archived,
      });
      overlay.remove();
      showToast(archived ? 'Tile archived' : 'Tile saved', 'success');
      await syncCustomSpritesFromAssets();
      await refresh();
    };

    overlay.querySelector('#asset-save')!.addEventListener('click', () => void save(false).catch((e) => showToast(String(e), 'error')));
    overlay.querySelector('#asset-archive')?.addEventListener('click', () => {
      if (!confirm('Archive this tile definition?')) return;
      void save(true).catch((e) => showToast(String(e), 'error'));
    });
  }, true);
}

export async function renderFurnitureSection(el: HTMLElement, perms: Set<string>): Promise<void> {
  let showArchived = false;
  const canEdit = perms.has('content.map.edit');

  const render = async () => {
    let items: MapFurnitureDefinition[] = [];
    try {
      items = await mapBuilderApi.listFurniture(showArchived);
    } catch (e) {
      showToast(String(e), 'error');
    }

    el.innerHTML = `
      <div class="mb-toolbar">
        <div class="flex">
          ${canEdit ? '<button class="btn" id="asset-new">+ New Furniture</button>' : ''}
          <label class="checkbox-chip"><input type="checkbox" id="asset-show-archived" ${showArchived ? 'checked' : ''} /> Show archived</label>
        </div>
        <input id="asset-search" placeholder="Search..." class="mb-search" />
      </div>
      <table class="mt mb-table">
        <thead><tr>
          <th>Name</th><th>ID</th><th>Category</th><th>Sprite</th><th>Preview</th><th>Size</th><th></th>
        </tr></thead>
        <tbody id="asset-rows">${furnitureRows(items)}</tbody>
      </table>`;

    document.getElementById('asset-show-archived')!.onchange = (e) => {
      showArchived = (e.target as HTMLInputElement).checked;
      void render();
    };
    document.getElementById('asset-search')!.oninput = (e) =>
      filterAssetRows((e.target as HTMLInputElement).value);

    if (canEdit) {
      document.getElementById('asset-new')!.onclick = () => openFurnitureModal(null, render);
      el.querySelectorAll('.asset-edit').forEach((b) => {
        b.addEventListener('click', () => {
          const id = String((b as HTMLElement).dataset.id);
          const item = items.find((i) => i.id === id);
          if (item) openFurnitureModal(item, render);
        });
      });
    }
  };

  await render();
}

function furnitureRows(items: MapFurnitureDefinition[]): string {
  return items
    .map(
      (f) => {
        const px = getSpritePixels(f.properties);
        return `
    <tr data-name="${f.name.toLowerCase()} ${f.id.toLowerCase()} ${f.category.toLowerCase()}">
      <td><strong>${esc(f.name)}</strong> ${archivedBadge(f.archived)}</td>
      <td class="muted-text">${esc(f.id)}</td>
      <td><span class="badge">${esc(f.category)}</span></td>
      <td class="muted-text">${esc(f.spriteRef)}</td>
      <td>${spriteThumbHtml(f.spriteRef, px, f.width, f.height)}</td>
      <td>${f.width}×${f.height}</td>
      <td class="mb-actions"><button class="btn secondary asset-edit" data-id="${esc(f.id)}">Edit</button></td>
    </tr>`;
      }
    )
    .join('');
}

function openFurnitureModal(item: MapFurnitureDefinition | null, refresh: () => Promise<void>): void {
  const isNew = !item;
  const data: MapFurnitureDefinition = item ?? {
    id: '',
    name: '',
    category: 'altar',
    spriteRef: '',
    width: 1,
    height: 1,
    properties: {},
    archived: false,
  };
  const properties = readProperties(data.properties);
  const interactionType = getInteractionTypeFromProperties(properties) ?? '';

  const form = `
    ${field('ID', textInput('asset-id', data.id, 'unique_id'), isNew ? '' : 'readonly-field')}
    ${field('Name', textInput('asset-name', data.name))}
    ${field('Category', textInput('asset-category', data.category, 'altar, bed, counter'))}
    ${field('Interaction type', selectInput('asset-interaction', [
      { value: '', label: 'None (decorative only)' },
      ...INTERACTION_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
    ], interactionType))}
    <p class="muted-text">Interaction type makes placed furniture open altar/shop/etc. when the player presses E.</p>
    ${field('Sprite ref', textInput('asset-sprite', data.spriteRef, 'obj_altar'))}
    <div class="form-grid">
      ${field('Width (tiles)', numberInput('asset-width', data.width))}
      ${field('Height (tiles)', numberInput('asset-height', data.height))}
    </div>
    <div class="flex mt">
      <button class="btn" id="asset-save">Save</button>
      ${!isNew ? '<button class="btn danger" id="asset-archive">Archive</button>' : ''}
      <button class="btn secondary" id="asset-cancel">Cancel</button>
    </div>`;

  openModal(isNew ? 'New Furniture' : `Edit ${data.name}`, assetModalBody(form), (overlay) => {
    if (!isNew) (overlay.querySelector('#asset-id') as HTMLInputElement).readOnly = true;
    bindCancel(overlay);

    const spriteInput = overlay.querySelector('#asset-sprite') as HTMLInputElement;
    const categoryInput = overlay.querySelector('#asset-category') as HTMLInputElement;
    const widthInput = overlay.querySelector('#asset-width') as HTMLInputElement;
    const heightInput = overlay.querySelector('#asset-height') as HTMLInputElement;

    const spritePanel = mountMapSpritePanel(overlay, {
      initialPixels: getSpritePixels(properties),
      widthTiles: () => Number(widthInput.value) || 1,
      heightTiles: () => Number(heightInput.value) || 1,
      spriteRef: () => spriteInput.value.trim(),
      fillColor: () => mapCategoryFillColor(categoryInput.value.trim()),
    });

    const syncSize = (): void => spritePanel.syncDimensions();
    widthInput.addEventListener('change', syncSize);
    heightInput.addEventListener('change', syncSize);
    spriteInput.addEventListener('change', () => spritePanel.loadBuiltin());

    const save = async (archived: boolean) => {
      const id = (overlay.querySelector('#asset-id') as HTMLInputElement).value.trim();
      if (!id) {
        showToast('ID required', 'error');
        return;
      }
      await mapBuilderApi.upsertFurniture(id, {
        id,
        name: (overlay.querySelector('#asset-name') as HTMLInputElement).value.trim(),
        category: categoryInput.value.trim(),
        spriteRef: spriteInput.value.trim(),
        width: Number(widthInput.value),
        height: Number(heightInput.value),
        properties: withSpritePixels({
          ...properties,
          interactionType: (overlay.querySelector('#asset-interaction') as HTMLSelectElement).value.trim() || undefined,
        }, spritePanel.getPixels()),
        archived,
      });
      overlay.remove();
      showToast(archived ? 'Furniture archived' : 'Furniture saved', 'success');
      await syncCustomSpritesFromAssets();
      await refresh();
    };

    overlay.querySelector('#asset-save')!.addEventListener('click', () => void save(false).catch((e) => showToast(String(e), 'error')));
    overlay.querySelector('#asset-archive')?.addEventListener('click', () => {
      if (!confirm('Archive this furniture definition?')) return;
      void save(true).catch((e) => showToast(String(e), 'error'));
    });
  }, true);
}

export async function renderDecorationSection(el: HTMLElement, perms: Set<string>): Promise<void> {
  let showArchived = false;
  const canEdit = perms.has('content.map.edit');

  const render = async () => {
    let items: MapDecorationDefinition[] = [];
    try {
      items = await mapBuilderApi.listDecorations(showArchived);
    } catch (e) {
      showToast(String(e), 'error');
    }

    el.innerHTML = `
      <div class="mb-toolbar">
        <div class="flex">
          ${canEdit ? '<button class="btn" id="asset-new">+ New Decoration</button>' : ''}
          <label class="checkbox-chip"><input type="checkbox" id="asset-show-archived" ${showArchived ? 'checked' : ''} /> Show archived</label>
        </div>
        <input id="asset-search" placeholder="Search..." class="mb-search" />
      </div>
      <table class="mt mb-table">
        <thead><tr>
          <th>Name</th><th>ID</th><th>Sprite</th><th>Preview</th><th>Wall mounted</th><th></th>
        </tr></thead>
        <tbody id="asset-rows">${decorationRows(items)}</tbody>
      </table>`;

    document.getElementById('asset-show-archived')!.onchange = (e) => {
      showArchived = (e.target as HTMLInputElement).checked;
      void render();
    };
    document.getElementById('asset-search')!.oninput = (e) =>
      filterAssetRows((e.target as HTMLInputElement).value);

    if (canEdit) {
      document.getElementById('asset-new')!.onclick = () => openDecorationModal(null, render);
      el.querySelectorAll('.asset-edit').forEach((b) => {
        b.addEventListener('click', () => {
          const id = String((b as HTMLElement).dataset.id);
          const item = items.find((i) => i.id === id);
          if (item) openDecorationModal(item, render);
        });
      });
    }
  };

  await render();
}

function decorationRows(items: MapDecorationDefinition[]): string {
  return items
    .map(
      (d) => {
        const px = getSpritePixels(d.properties);
        return `
    <tr data-name="${d.name.toLowerCase()} ${d.id.toLowerCase()}">
      <td><strong>${esc(d.name)}</strong> ${archivedBadge(d.archived)}</td>
      <td class="muted-text">${esc(d.id)}</td>
      <td class="muted-text">${esc(d.spriteRef)}</td>
      <td>${spriteThumbHtml(d.spriteRef, px)}</td>
      <td>${d.wallMounted ? 'yes' : 'no'}</td>
      <td class="mb-actions"><button class="btn secondary asset-edit" data-id="${esc(d.id)}">Edit</button></td>
    </tr>`;
      }
    )
    .join('');
}

function openDecorationModal(item: MapDecorationDefinition | null, refresh: () => Promise<void>): void {
  const isNew = !item;
  const data: MapDecorationDefinition = item ?? {
    id: '',
    name: '',
    spriteRef: '',
    wallMounted: false,
    properties: {},
    archived: false,
  };
  const properties = readProperties(data.properties);

  const form = `
    ${field('ID', textInput('asset-id', data.id, 'unique_id'), isNew ? '' : 'readonly-field')}
    ${field('Name', textInput('asset-name', data.name))}
    ${field('Sprite ref', textInput('asset-sprite', data.spriteRef, 'obj_tree'))}
  <label class="form-field checkbox-chip"><input type="checkbox" id="asset-wall" ${data.wallMounted ? 'checked' : ''} /> Wall mounted</label>
    <div class="flex mt">
      <button class="btn" id="asset-save">Save</button>
      ${!isNew ? '<button class="btn danger" id="asset-archive">Archive</button>' : ''}
      <button class="btn secondary" id="asset-cancel">Cancel</button>
    </div>`;

  openModal(isNew ? 'New Decoration' : `Edit ${data.name}`, assetModalBody(form), (overlay) => {
    if (!isNew) (overlay.querySelector('#asset-id') as HTMLInputElement).readOnly = true;
    bindCancel(overlay);

    const spriteInput = overlay.querySelector('#asset-sprite') as HTMLInputElement;
    const spritePanel = mountMapSpritePanel(overlay, {
      initialPixels: getSpritePixels(properties),
      spriteRef: () => spriteInput.value.trim(),
      fillColor: () => mapCategoryFillColor('decoration'),
    });

    spriteInput.addEventListener('change', () => spritePanel.loadBuiltin());

    const save = async (archived: boolean) => {
      const id = (overlay.querySelector('#asset-id') as HTMLInputElement).value.trim();
      if (!id) {
        showToast('ID required', 'error');
        return;
      }
      await mapBuilderApi.upsertDecoration(id, {
        id,
        name: (overlay.querySelector('#asset-name') as HTMLInputElement).value.trim(),
        spriteRef: spriteInput.value.trim(),
        wallMounted: readCheckbox('asset-wall'),
        properties: withSpritePixels(properties, spritePanel.getPixels()),
        archived,
      });
      overlay.remove();
      showToast(archived ? 'Decoration archived' : 'Decoration saved', 'success');
      await syncCustomSpritesFromAssets();
      await refresh();
    };

    overlay.querySelector('#asset-save')!.addEventListener('click', () => void save(false).catch((e) => showToast(String(e), 'error')));
    overlay.querySelector('#asset-archive')?.addEventListener('click', () => {
      if (!confirm('Archive this decoration definition?')) return;
      void save(true).catch((e) => showToast(String(e), 'error'));
    });
  }, true);
}

function filterAssetRows(q: string): void {
  const needle = q.trim().toLowerCase();
  document.querySelectorAll('#asset-rows tr').forEach((tr) => {
    const name = (tr as HTMLElement).dataset.name ?? '';
    (tr as HTMLElement).style.display = !needle || name.includes(needle) ? '' : 'none';
  });
}
