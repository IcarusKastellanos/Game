import type {
  MapBuilderDocument,
  MapLayerState,
  MapPortal,
  MapProjectMetadata,
  MapSpawnpoint,
  MapWardPlacement,
  PlacedDecoration,
  PlacedFurniture,
  PlacedInteractionZone,
  PreviewPersona,
} from '@witchcraft/shared';
import {
  MAP_TYPE_OPTIONS,
  clampPlacementCoord,
  clampRenderLevel,
  defaultBrushForLayerKind,
  DEFAULT_PLACED_RENDER_LEVEL,
  ensureMapDocumentTiles,
  formatTileCoord,
  getInteractionTypeFromProperties,
  INTERACTION_TYPE_OPTIONS,
  interactionTypeGlyph,
  interactionTypeLabel,
  normalizePlacedRenderLevel,
  RENDER_LEVEL_MAX,
  spriteKeyFromTileIndex,
  tileIndexFromSpriteKey,
  tilesForLayerKind,
} from '@witchcraft/shared';
import { mapBuilderApi } from './api.js';
import { removeTwoWayLink, showPortalLinkWizard } from './portal-link-wizard.js';
import { showToast } from './toast.js';
import { drawSpriteRectRotated, drawTileSprite, strokeRectRotated } from './tile-renderer.js';
import { syncCustomSpritesFromAssets } from './asset-sprite-sync.js';

type EditorTool = 'brush' | 'fill' | 'erase' | 'spawn' | 'collision' | 'npc' | 'spirit' | 'ward' | 'portal' | 'furniture' | 'decoration' | 'interaction' | 'select';
type EditorMode = 'tiles' | 'collision' | 'spawnpoints' | 'npcs' | 'spirits' | 'wards' | 'portals' | 'furniture' | 'decorations' | 'interactions';

interface FurnitureDefRow {
  id: string;
  name: string;
  spriteRef: string;
  width: number;
  height: number;
  properties?: unknown;
}

interface DecorationDefRow {
  id: string;
  name: string;
  spriteRef: string;
  wallMounted: boolean;
  properties?: unknown;
}

interface EditorState {
  metadata: MapProjectMetadata;
  document: MapBuilderDocument;
  dirty: boolean;
  activeLayerId: string;
  tool: EditorTool;
  mode: EditorMode;
  brushTile: number;
  zoom: number;
  panX: number;
  panY: number;
  showGrid: boolean;
  snapToGrid: boolean;
  undoStack: MapBuilderDocument[];
  redoStack: MapBuilderDocument[];
  selectedSpawnId: string | null;
  selectedPortalId: string | null;
  selectedFurnitureId: string | null;
  selectedDecorationId: string | null;
  selectedInteractionZoneId: string | null;
  furnitureDefs: Map<string, FurnitureDefRow>;
  decorationDefs: Map<string, DecorationDefRow>;
}

export async function renderMapEditor(
  el: HTMLElement,
  mapId: string,
  perms: Set<string>,
  onBack: () => void
): Promise<void> {
  await syncCustomSpritesFromAssets().catch(() => undefined);
  const pack = await mapBuilderApi.getMap(mapId);
  const mapDoc = structuredClone(pack.document);
  if (!mapDoc.placedFurniture) mapDoc.placedFurniture = [];
  if (!mapDoc.placedDecorations) mapDoc.placedDecorations = [];
  const autoFilled = ensureMapDocumentTiles(mapDoc, pack.metadata.width, pack.metadata.height, pack.metadata.sceneId);

  let allMaps: MapProjectMetadata[] = [];
  try {
    allMaps = await mapBuilderApi.listMaps(true);
  } catch { /* optional */ }

  const canEdit = perms.has('content.map.edit');
  const canPublish = perms.has('content.map.publish');
  const canPreview = perms.has('content.map.preview');
  const canUnbreakable = perms.has('content.map.ward.unbreakable');

  let npcTemplates: { id: string; name: string }[] = [];
  let spiritTemplates: { id: string; name: string }[] = [];
  let furnitureDefRows: FurnitureDefRow[] = [];
  let decorationDefRows: DecorationDefRow[] = [];
  try {
    [npcTemplates, spiritTemplates, furnitureDefRows, decorationDefRows] = await Promise.all([
      mapBuilderApi.listNpcs(),
      mapBuilderApi.listSpirits(),
      mapBuilderApi.listFurniture().catch(() => []),
      mapBuilderApi.listDecorations().catch(() => []),
    ]) as [typeof npcTemplates, typeof spiritTemplates, FurnitureDefRow[], DecorationDefRow[]];
  } catch { /* optional */ }

  const furnitureById = new Map(furnitureDefRows.map((f) => [f.id, f]));
  const decorationById = new Map(decorationDefRows.map((d) => [d.id, d]));
  if (!mapDoc.interactionZones) mapDoc.interactionZones = [];
  const initialLayer = mapDoc.layers[0]?.id ?? 'ground';
  const initialLayerKind = mapDoc.layers.find((l) => l.id === initialLayer)?.kind ?? 'floor';
  const state: EditorState = {
    metadata: pack.metadata,
    document: mapDoc,
    dirty: autoFilled,
    activeLayerId: initialLayer,
    tool: 'brush',
    mode: 'tiles',
    brushTile: defaultBrushForLayerKind(initialLayerKind, pack.metadata.sceneId),
    zoom: 2,
    panX: 0,
    panY: 0,
    showGrid: true,
    snapToGrid: false,
    undoStack: [],
    redoStack: [],
    selectedSpawnId: null,
    selectedPortalId: null,
    selectedFurnitureId: null,
    selectedDecorationId: null,
    selectedInteractionZoneId: null,
    furnitureDefs: furnitureById,
    decorationDefs: decorationById,
  };

  el.innerHTML = `
    <div class="mb-editor-shell">
      <div class="mb-editor-top">
        <button class="btn secondary" id="mb-back">← Maps</button>
        <span class="mb-editor-title">${esc(state.metadata.displayName)} <span class="badge status-${state.metadata.status}">${state.metadata.status}</span></span>
        <div class="mb-editor-actions">
          ${canEdit ? '<button class="btn secondary" id="mb-undo" title="Ctrl+Z">Undo</button><button class="btn secondary" id="mb-redo" title="Ctrl+Y">Redo</button>' : ''}
          <button class="btn secondary" id="mb-validate">Validate</button>
          ${canPreview ? '<button class="btn secondary" id="mb-preview">Preview Invite</button>' : ''}
          ${canEdit ? '<button class="btn" id="mb-save">Save Draft</button>' : ''}
          ${canPublish && state.metadata.status !== 'published' ? '<button class="btn" id="mb-publish">Publish</button>' : ''}
          ${canPublish && state.metadata.status === 'published' ? '<button class="btn danger" id="mb-unpublish">Unpublish</button>' : ''}
          ${canPublish ? '<button class="btn secondary" id="mb-push-live" title="Force all online players to reload published maps">Push to players</button>' : ''}
        </div>
      </div>
      <div class="mb-editor-body">
        <aside class="mb-panel mb-layers">
          <div class="section-head">Layers</div>
          <div id="mb-layer-list"></div>
          <div class="section-head mt">Tools</div>
          <div class="mb-tool-grid" id="mb-tools"></div>
          <div class="section-head mt">Tile palette</div>
          <div class="mb-palette" id="mb-palette"></div>
        </aside>
        <div class="mb-canvas-wrap">
          <div class="mb-canvas-toolbar">
            <label class="checkbox-chip"><input type="checkbox" id="mb-grid" checked /> Grid</label>
            <label class="checkbox-chip"><input type="checkbox" id="mb-snap" /> Whole tiles</label>
            <button class="btn secondary" id="mb-zoom-out">−</button>
            <span id="mb-zoom-label">200%</span>
            <button class="btn secondary" id="mb-zoom-in">+</button>
            <span id="mb-coords" class="mb-coords">0, 0</span>
          </div>
          <div class="mb-canvas-scroll" id="mb-scroll">
            <canvas id="mb-canvas"></canvas>
          </div>
          <canvas id="mb-minimap" class="mb-minimap" width="120" height="90"></canvas>
        </div>
        <aside class="mb-panel mb-inspector">
          <div class="mb-mode-tabs" id="mb-mode-tabs"></div>
          <div id="mb-inspector-body"></div>
          <div id="mb-validation" class="mt"></div>
        </aside>
      </div>
    </div>`;

  const canvas = document.getElementById('mb-canvas') as HTMLCanvasElement;
  const minimap = document.getElementById('mb-minimap') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;

  document.getElementById('mb-back')!.onclick = () => {
    if (state.dirty && !confirm('Unsaved changes. Leave anyway?')) return;
    onBack();
  };

  renderLayers(state);
  renderTools(state);
  renderPalette(state);
  renderModeTabs(state);
  renderInspector(state, npcTemplates, spiritTemplates, furnitureDefRows, decorationDefRows, canUnbreakable, mapId, allMaps);
  drawMap(state, canvas, ctx, minimap);
  if (autoFilled) {
    showToast('Default tiles applied (wood/grass, walls, paths). Save draft to keep.', 'info');
  }

  document.getElementById('mb-grid')!.onchange = (e) => {
    state.showGrid = (e.target as HTMLInputElement).checked;
    drawMap(state, canvas, ctx, minimap);
  };
  document.getElementById('mb-snap')!.onchange = (e) => {
    state.snapToGrid = (e.target as HTMLInputElement).checked;
    refreshInspector();
    drawMap(state, canvas, ctx, minimap);
  };
  document.getElementById('mb-zoom-in')!.onclick = () => { state.zoom = Math.min(6, state.zoom + 0.5); updateZoomLabel(state); drawMap(state, canvas, ctx, minimap); };
  document.getElementById('mb-zoom-out')!.onclick = () => { state.zoom = Math.max(0.5, state.zoom - 0.5); updateZoomLabel(state); drawMap(state, canvas, ctx, minimap); };

  const refreshInspector = () => renderInspector(state, npcTemplates, spiritTemplates, furnitureDefRows, decorationDefRows, canUnbreakable, mapId, allMaps);

  let painting = false;
  let draggingEntity: 'spawn' | 'portal' | 'furniture' | 'decoration' | 'interaction' | null = null;
  let dragMoved = false;

  canvas.onmousedown = (e) => {
    if (!canEdit) return;
    const { tx, ty } = canvasToTile(e, state, canvas);
    if (trySelectEntityAt(state, tx, ty)) {
      draggingEntity =
        state.selectedSpawnId ? 'spawn'
        : state.selectedPortalId ? 'portal'
        : state.selectedFurnitureId ? 'furniture'
        : state.selectedDecorationId ? 'decoration'
        : state.selectedInteractionZoneId ? 'interaction'
        : null;
      dragMoved = false;
      refreshInspector();
      drawMap(state, canvas, ctx, minimap);
      return;
    }
    if (state.mode === 'spawnpoints' || state.mode === 'portals' || state.mode === 'furniture' || state.mode === 'decorations' || state.mode === 'interactions') {
      pushUndo(state);
      applyEntityModeAt(state, tx, ty);
      drawMap(state, canvas, ctx, minimap);
      refreshInspector();
      state.dirty = true;
      return;
    }
    painting = true;
    pushUndo(state);
    applyToolAt(e, state, canvas);
    drawMap(state, canvas, ctx, minimap);
    refreshInspector();
    state.dirty = true;
  };
  canvas.onmousemove = (e) => {
    const { tx, ty } = canvasToTile(e, state, canvas);
    (document.getElementById('mb-coords')!).textContent = formatCoordLabel(tx, ty);
    if (draggingEntity && canEdit && inBounds(tx, ty, state)) {
      if (!dragMoved) pushUndo(state);
      dragMoved = true;
      if (draggingEntity === 'spawn' && state.selectedSpawnId) {
        const sp = state.document.spawnpoints.find((s) => s.id === state.selectedSpawnId);
        if (sp) { sp.x = tx; sp.y = ty; }
      } else if (draggingEntity === 'portal' && state.selectedPortalId) {
        const p = state.document.portals.find((p) => p.id === state.selectedPortalId);
        if (p) { p.sourceX = tx; p.sourceY = ty; }
      } else if (draggingEntity === 'furniture' && state.selectedFurnitureId) {
        const item = state.document.placedFurniture.find((f) => f.id === state.selectedFurnitureId);
        const def = item ? state.furnitureDefs.get(item.furnitureDefId) : undefined;
        if (item && canPlaceFootprint(state, tx, ty, def?.width ?? 1, def?.height ?? 1)) {
          item.x = tx;
          item.y = ty;
        }
      } else if (draggingEntity === 'decoration' && state.selectedDecorationId) {
        const item = state.document.placedDecorations.find((d) => d.id === state.selectedDecorationId);
        if (item && inBounds(tx, ty, state)) {
          item.x = tx;
          item.y = ty;
        }
      } else if (draggingEntity === 'interaction' && state.selectedInteractionZoneId) {
        const item = state.document.interactionZones!.find((z) => z.id === state.selectedInteractionZoneId);
        const center = canvasToInteractionCenter(e, state, canvas);
        if (item && inBoundsCenter(center.x, center.y, state)) {
          item.x = center.x;
          item.y = center.y;
        }
      }
      state.dirty = true;
      drawMap(state, canvas, ctx, minimap);
      syncSelectedCoordsInInspector(state);
      return;
    }
    if (painting && canEdit) {
      applyToolAt(e, state, canvas);
      drawMap(state, canvas, ctx, minimap);
      state.dirty = true;
    }
  };
  window.onmouseup = () => {
    if (draggingEntity && dragMoved) refreshInspector();
    painting = false;
    draggingEntity = null;
  };

  document.getElementById('mb-save')?.addEventListener('click', async () => {
    try {
      const saved = await mapBuilderApi.saveDraft(mapId, state.metadata, state.document, 'Manual save from editor');
      state.metadata = saved.metadata;
      state.dirty = false;
      showToast(`Saved draft v${saved.metadata.version}`, 'success');
    } catch (e) {
      showToast(String(e), 'error');
    }
  });

  document.getElementById('mb-validate')!.onclick = async () => {
    try {
      if (state.dirty) await mapBuilderApi.saveDraft(mapId, state.metadata, state.document, 'Pre-validation autosave');
      const result = await mapBuilderApi.validate(mapId);
      renderValidation(result);
    } catch (e) {
      showToast(String(e), 'error');
    }
  };

  document.getElementById('mb-publish')?.addEventListener('click', async () => {
    const notes = prompt('Changelog notes for this publish?') ?? '';
    try {
      if (state.dirty) await mapBuilderApi.saveDraft(mapId, state.metadata, state.document, 'Pre-publish save');
      const result = await mapBuilderApi.publish(mapId, notes);
      if (!result.ok) {
        renderValidation(result.validation ?? { valid: false, issues: [{ severity: 'error', message: result.error ?? 'Publish failed' }] });
        showToast(result.error ?? 'Publish failed', 'error');
        return;
      }
      state.metadata.status = 'published';
      state.dirty = false;
      showToast('Map published — click Push to players to update everyone online.', 'success');
    } catch (e) {
      showToast(String(e), 'error');
    }
  });

  document.getElementById('mb-unpublish')?.addEventListener('click', async () => {
    if (!confirm('Unpublish this map? Players will no longer load the published version.')) return;
    try {
      const meta = await mapBuilderApi.unpublish(mapId);
      state.metadata = meta;
      showToast('Map unpublished', 'info');
    } catch (e) {
      showToast(String(e), 'error');
    }
  });

  document.getElementById('mb-push-live')?.addEventListener('click', async () => {
    if (state.dirty) {
      const save = confirm('Save unsaved draft changes before pushing? OK = save, Cancel = push published version only.');
      if (save) {
        try {
          const saved = await mapBuilderApi.saveDraft(mapId, state.metadata, state.document, 'Pre-push save');
          state.metadata = saved.metadata;
          state.dirty = false;
        } catch (e) {
          showToast(String(e), 'error');
          return;
        }
      }
    }
    if (state.metadata.status !== 'published') {
      if (!confirm('This map is still a draft. Publish it first, or push will not include your latest spawn/tile edits. Push anyway?')) return;
    }
    try {
      const result = await mapBuilderApi.pushLive({ resnapSpawns: true });
      if (result.warnings?.length) showToast(result.warnings.join(' '), 'info');
      showToast(`Live push: ${result.clientsNotified} client(s) updated (revision ${result.revision}).`, 'success');
    } catch (e) {
      showToast(String(e), 'error');
    }
  });

  document.getElementById('mb-preview')?.addEventListener('click', () => {
    showPreviewModal(mapId, state.dirty, async () => {
      if (state.dirty) {
        await mapBuilderApi.saveDraft(mapId, state.metadata, state.document, 'Pre-preview save');
        state.dirty = false;
      }
    });
  });

  document.getElementById('mb-undo')?.addEventListener('click', () => {
    if (state.undoStack.length) {
      state.redoStack.push(structuredClone(state.document));
      state.document = state.undoStack.pop()!;
      drawMap(state, canvas, ctx, minimap);
      renderInspector(state, npcTemplates, spiritTemplates, furnitureDefRows, decorationDefRows, canUnbreakable, mapId, allMaps);
      state.dirty = true;
    }
  });
  document.getElementById('mb-redo')?.addEventListener('click', () => {
    if (state.redoStack.length) {
      state.undoStack.push(structuredClone(state.document));
      state.document = state.redoStack.pop()!;
      drawMap(state, canvas, ctx, minimap);
      renderInspector(state, npcTemplates, spiritTemplates, furnitureDefRows, decorationDefRows, canUnbreakable, mapId, allMaps);
      state.dirty = true;
    }
  });

  window.onkeydown = (e) => {
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); document.getElementById('mb-undo')?.click(); }
    if (e.ctrlKey && e.key === 'y') { e.preventDefault(); document.getElementById('mb-redo')?.click(); }
  };

  function renderValidation(result: { valid: boolean; issues: { severity: string; message: string }[] }): void {
    const box = document.getElementById('mb-validation')!;
    box.innerHTML = `<div class="section-head">Validation ${result.valid ? '✓' : '✗'}</div>
      <ul class="mb-validation-list">${result.issues.map((i) =>
        `<li class="sev-${i.severity}">${esc(i.message)}</li>`
      ).join('') || '<li class="sev-info">No issues</li>'}</ul>`;
  }

  function renderLayers(st: EditorState): void {
    const list = document.getElementById('mb-layer-list')!;
    const sorted = [...st.document.layers].sort((a, b) => a.order - b.order);
    list.innerHTML = sorted.map((l) => `
      <div class="mb-layer-row ${l.id === st.activeLayerId ? 'active' : ''}" data-id="${l.id}">
        <label><input type="checkbox" class="layer-vis" data-id="${l.id}" ${l.visible ? 'checked' : ''} /> ${esc(l.name)}</label>
        <button class="btn secondary layer-lock" data-id="${l.id}" title="Lock">${l.locked ? '🔒' : '🔓'}</button>
      </div>`).join('');

    list.querySelectorAll('.mb-layer-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.layer-lock, .layer-vis')) return;
        st.activeLayerId = (row as HTMLElement).dataset.id!;
        const layer = st.document.layers.find((l) => l.id === st.activeLayerId);
        if (layer) {
          st.brushTile = defaultBrushForLayerKind(layer.kind, st.metadata.sceneId);
        }
        renderLayers(st);
        renderPalette(st);
      });
    });
    list.querySelectorAll('.layer-vis').forEach((cb) => {
      cb.addEventListener('change', () => {
        const layer = st.document.layers.find((l) => l.id === (cb as HTMLElement).dataset.id);
        if (layer) layer.visible = (cb as HTMLInputElement).checked;
        drawMap(st, canvas, ctx, minimap);
      });
    });
    list.querySelectorAll('.layer-lock').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const layer = st.document.layers.find((l) => l.id === (btn as HTMLElement).dataset.id);
        if (layer) { layer.locked = !layer.locked; renderLayers(st); }
      });
    });
  }

  function renderTools(st: EditorState): void {
    const tools: { id: EditorTool; label: string }[] = [
      { id: 'brush', label: 'Brush' }, { id: 'fill', label: 'Fill' }, { id: 'erase', label: 'Erase' },
      { id: 'spawn', label: 'Spawn' }, { id: 'collision', label: 'Collide' }, { id: 'npc', label: 'NPC' },
      { id: 'spirit', label: 'Spirit' }, { id: 'ward', label: 'Ward' }, { id: 'portal', label: 'Portal' },
      { id: 'furniture', label: 'Furn' }, { id: 'decoration', label: 'Decor' },
      { id: 'interaction', label: 'Interact' },
    ];
    const box = document.getElementById('mb-tools')!;
    box.innerHTML = tools.map((t) =>
      `<button class="mb-tool-btn ${st.tool === t.id ? 'active' : ''}" data-tool="${t.id}">${t.label}</button>`
    ).join('');
    box.querySelectorAll('.mb-tool-btn').forEach((b) => {
      b.addEventListener('click', () => {
        st.tool = (b as HTMLElement).dataset.tool as EditorTool;
        if (['spawn', 'collision', 'npc', 'spirit', 'ward', 'portal', 'furniture', 'decoration', 'interaction'].includes(st.tool)) {
          st.mode = ({
            spawn: 'spawnpoints', collision: 'collision', npc: 'npcs', spirit: 'spirits',
            ward: 'wards', portal: 'portals', furniture: 'furniture', decoration: 'decorations',
            interaction: 'interactions',
          } as Record<string, EditorMode>)[st.tool] ?? 'tiles';
        } else {
          st.mode = 'tiles';
        }
        renderTools(st);
        renderModeTabs(st);
        refreshInspector();
      });
    });
  }

  function renderPalette(st: EditorState): void {
    const box = document.getElementById('mb-palette')!;
    const layer = st.document.layers.find((l) => l.id === st.activeLayerId);
    const tiles = tilesForLayerKind(layer?.kind ?? 'floor');
    box.innerHTML = tiles.map((t) => {
      const globalIdx = tileIndexFromSpriteKey(t.spriteKey);
      return `<button type="button" class="mb-tile-swatch ${st.brushTile === globalIdx ? 'active' : ''}" data-tile="${globalIdx}" title="${esc(t.name)}">
        <canvas width="16" height="16" data-sprite="${t.spriteKey}"></canvas>
        <span>${esc(t.name)}</span>
      </button>`;
    }).join('');
    box.querySelectorAll('canvas[data-sprite]').forEach((c) => {
      const spriteKey = (c as HTMLCanvasElement).dataset.sprite!;
      const ctx = (c as HTMLCanvasElement).getContext('2d')!;
      drawTileSprite(ctx, spriteKey, 0, 0, 16);
    });
    box.querySelectorAll('.mb-tile-swatch').forEach((sw) => {
      sw.addEventListener('click', () => {
        st.brushTile = Number((sw as HTMLElement).dataset.tile);
        renderPalette(st);
      });
    });
  }

  function renderModeTabs(st: EditorState): void {
    const modes: { id: EditorMode; label: string }[] = [
      { id: 'tiles', label: 'Tiles' }, { id: 'collision', label: 'Collision' }, { id: 'spawnpoints', label: 'Spawns' },
      { id: 'npcs', label: 'NPCs' }, { id: 'spirits', label: 'Spirits' }, { id: 'wards', label: 'Wards' },
      { id: 'portals', label: 'Portals' }, { id: 'furniture', label: 'Furniture' }, { id: 'decorations', label: 'Decor' },
      { id: 'interactions', label: 'Interact' },
    ];
    const box = document.getElementById('mb-mode-tabs')!;
    box.innerHTML = modes.map((m) =>
      `<button class="mb-tab ${st.mode === m.id ? 'active' : ''}" data-mode="${m.id}">${m.label}</button>`
    ).join('');
    box.querySelectorAll('.mb-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        st.mode = (tab as HTMLElement).dataset.mode as EditorMode;
        renderModeTabs(st);
        refreshInspector();
        drawMap(st, canvas, ctx, minimap);
      });
    });
  }

  function renderInspector(
    st: EditorState,
    npcs: { id: string; name: string }[],
    spirits: { id: string; name: string }[],
    furnitureList: FurnitureDefRow[],
    decorationList: DecorationDefRow[],
    unbreakablePerm: boolean,
    _mapId: string,
    maps: MapProjectMetadata[]
  ): void {
    const body = document.getElementById('mb-inspector-body')!;
    if (st.mode === 'tiles') {
      body.innerHTML = renderMetadataForm(st.metadata);
      bindMetadataForm(st);
      return;
    }
    if (st.mode === 'spawnpoints') {
      body.innerHTML = renderSpawnInspector(st);
      bindSpawnInspector(st, () => drawMap(st, canvas, ctx, minimap), refreshInspector);
      return;
    }
    if (st.mode === 'collision') {
      body.innerHTML = renderCollisionInspector(st);
      bindCollisionInspector(st, () => drawMap(st, canvas, ctx, minimap));
      return;
    }
    if (st.mode === 'npcs') {
      body.innerHTML = renderNpcInspector(st, npcs);
      bindNpcInspector(st, npcs, () => drawMap(st, canvas, ctx, minimap));
      return;
    }
    if (st.mode === 'spirits') {
      body.innerHTML = renderSpiritInspector(st, spirits);
      bindSpiritInspector(st, spirits, () => drawMap(st, canvas, ctx, minimap));
      return;
    }
    if (st.mode === 'wards') {
      body.innerHTML = renderWardInspector(st, unbreakablePerm);
      bindWardInspector(st, unbreakablePerm, () => drawMap(st, canvas, ctx, minimap));
      return;
    }
    if (st.mode === 'portals') {
      body.innerHTML = renderPortalInspector(st, maps);
      bindPortalInspector(st, () => drawMap(st, canvas, ctx, minimap), maps, refreshInspector);
      return;
    }
    if (st.mode === 'furniture') {
      body.innerHTML = renderFurnitureInspector(st, furnitureList);
      bindFurnitureInspector(st, () => drawMap(st, canvas, ctx, minimap), refreshInspector);
      return;
    }
    if (st.mode === 'decorations') {
      body.innerHTML = renderDecorationInspector(st, decorationList);
      bindDecorationInspector(st, () => drawMap(st, canvas, ctx, minimap), refreshInspector);
      return;
    }
    if (st.mode === 'interactions') {
      body.innerHTML = renderInteractionInspector(st);
      bindInteractionInspector(st, () => drawMap(st, canvas, ctx, minimap), refreshInspector);
    }
  }
}

function renderMetadataForm(meta: MapProjectMetadata): string {
  return `
    <div class="section-head">Map metadata</div>
    <label class="form-field"><span class="form-label">Display name</span><input id="mf-display" value="${esc(meta.displayName)}" /></label>
    <label class="form-field"><span class="form-label">Description</span><textarea id="mf-desc" rows="2">${esc(meta.description)}</textarea></label>
    <label class="form-field"><span class="form-label">Map type</span>
      <select id="mf-type">${MAP_TYPE_OPTIONS.map((o) => `<option value="${o.value}" ${o.value === meta.mapType ? 'selected' : ''}>${o.label}</option>`).join('')}</select>
    </label>
    <div class="form-grid">
      <label class="form-field"><span class="form-label">Biome</span><input id="mf-biome" value="${esc(meta.biome)}" /></label>
      <label class="form-field"><span class="form-label">Theme</span><input id="mf-theme" value="${esc(meta.theme)}" /></label>
      <label class="form-field"><span class="form-label">Scene ID</span><input id="mf-scene" value="${esc(meta.sceneId)}" /></label>
      <label class="form-field"><span class="form-label">Access</span>
        <select id="mf-access">
          ${['public','private','instance_only','apartment_only','coven_only','event_only','admin_only'].map((a) =>
            `<option value="${a}" ${a === meta.accessLevel ? 'selected' : ''}>${a}</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="form-grid">
      <label class="form-field"><span class="form-label">Default music</span><input id="mf-music" value="${esc(meta.defaultMusic)}" /></label>
      <label class="form-field"><span class="form-label">Ambient</span><input id="mf-ambient" value="${esc(meta.defaultAmbientSound)}" /></label>
    </div>
    <div class="checkbox-group mt">
      <label class="checkbox-chip"><input type="checkbox" id="mf-wardable" ${meta.isWardable ? 'checked' : ''} /> Wardable</label>
      <label class="checkbox-chip"><input type="checkbox" id="mf-unbreakable" ${meta.allowUnbreakableWards ? 'checked' : ''} /> Allow unbreakable wards</label>
      <label class="checkbox-chip"><input type="checkbox" id="mf-spirits" ${meta.allowSpirits ? 'checked' : ''} /> Spirits</label>
      <label class="checkbox-chip"><input type="checkbox" id="mf-instanced" ${meta.isInstanced ? 'checked' : ''} /> Instanced</label>
    </div>`;
}

function bindMetadataForm(st: EditorState): void {
  const bind = () => { st.dirty = true; };
  ['mf-display','mf-desc','mf-type','mf-biome','mf-theme','mf-scene','mf-access','mf-music','mf-ambient'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', () => {
      st.metadata.displayName = (document.getElementById('mf-display') as HTMLInputElement).value;
      st.metadata.description = (document.getElementById('mf-desc') as HTMLTextAreaElement).value;
      st.metadata.mapType = (document.getElementById('mf-type') as HTMLSelectElement).value as MapProjectMetadata['mapType'];
      st.metadata.biome = (document.getElementById('mf-biome') as HTMLInputElement).value;
      st.metadata.theme = (document.getElementById('mf-theme') as HTMLInputElement).value;
      st.metadata.sceneId = (document.getElementById('mf-scene') as HTMLInputElement).value;
      st.metadata.accessLevel = (document.getElementById('mf-access') as HTMLSelectElement).value as MapProjectMetadata['accessLevel'];
      st.metadata.defaultMusic = (document.getElementById('mf-music') as HTMLInputElement).value;
      st.metadata.defaultAmbientSound = (document.getElementById('mf-ambient') as HTMLInputElement).value;
      st.metadata.isWardable = (document.getElementById('mf-wardable') as HTMLInputElement).checked;
      st.metadata.allowUnbreakableWards = (document.getElementById('mf-unbreakable') as HTMLInputElement).checked;
      st.metadata.allowSpirits = (document.getElementById('mf-spirits') as HTMLInputElement).checked;
      st.metadata.isInstanced = (document.getElementById('mf-instanced') as HTMLInputElement).checked;
      bind();
    });
  });
}

function renderSpawnInspector(st: EditorState): string {
  const selected = st.document.spawnpoints.find((s) => s.id === st.selectedSpawnId);
  return `
    <div class="section-head">Spawnpoints</div>
    <p class="muted-text">Click a spawn on the map to select it, drag to move, or edit coordinates below.</p>
    <div id="sp-list">${st.document.spawnpoints.map((s) => spawnRow(s, st)).join('')}</div>
    <button class="btn secondary mt" id="sp-add">+ Add spawn</button>
    ${selected ? renderSpawnDetail(selected, st) : '<p class="muted-text mt">No spawn selected.</p>'}`;
}

function renderSpawnDetail(s: MapSpawnpoint, st: EditorState): string {
  const maxX = st.metadata.width - 1;
  const maxY = st.metadata.height - 1;
  return `
    <div class="mb-detail-panel mt">
      <div class="section-head">Selected: ${esc(s.name)}</div>
      <label class="form-field"><span class="form-label">Name</span><input id="sp-sel-name" value="${esc(s.name)}" /></label>
      <label class="form-field"><span class="form-label">Type</span>
        <select id="sp-sel-type">${spawnTypes.map((t) => `<option value="${t}" ${t === s.type ? 'selected' : ''}>${t}</option>`).join('')}</select>
      </label>
      <div class="form-grid">
        <label class="form-field"><span class="form-label">X</span><input type="number" id="sp-sel-x" min="0" max="${maxX}" value="${s.x}" /></label>
        <label class="form-field"><span class="form-label">Y</span><input type="number" id="sp-sel-y" min="0" max="${maxY}" value="${s.y}" /></label>
      </div>
      <label class="form-field"><span class="form-label">Facing</span>
        <select id="sp-sel-facing">
          ${(['up', 'down', 'left', 'right'] as const).map((f) => `<option value="${f}" ${f === s.facing ? 'selected' : ''}>${f}</option>`).join('')}
        </select>
      </label>
      <label class="checkbox-chip"><input type="checkbox" id="sp-sel-en" ${s.enabled ? 'checked' : ''} /> Enabled</label>
    </div>`;
}

function spawnRow(s: MapSpawnpoint, st: EditorState): string {
  const sel = s.id === st.selectedSpawnId ? ' selected' : '';
  return `<div class="mb-list-item${sel}" data-id="${s.id}" data-select="spawn">
    <input value="${esc(s.name)}" class="sp-name" />
    <select class="sp-type">${spawnTypes.map((t) => `<option value="${t}" ${t === s.type ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <input type="number" class="sp-x" min="0" max="${st.metadata.width - 1}" value="${s.x}" title="X" />
    <input type="number" class="sp-y" min="0" max="${st.metadata.height - 1}" value="${s.y}" title="Y" />
    <label><input type="checkbox" class="sp-en" ${s.enabled ? 'checked' : ''} /></label>
    <button class="btn danger sp-del">×</button>
  </div>`;
}

const spawnTypes = [
  'default_player', 'room_entrance', 'apartment', 'shop_entrance', 'npc', 'familiar',
  'spirit', 'event', 'admin_teleport', 'coven_ritual', 'astral_entry', 'respawn', 'death_recovery',
];

function bindSpawnInspector(st: EditorState, redraw: () => void, refresh: () => void): void {
  const getRow = (el: Element) => st.document.spawnpoints.find((s) => s.id === el.closest('.mb-list-item')?.getAttribute('data-id'));

  document.querySelectorAll('[data-select="spawn"]').forEach((row) => {
    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('input, select, button')) return;
      st.selectedSpawnId = (row as HTMLElement).getAttribute('data-id');
      st.selectedPortalId = null;
      refresh();
      redraw();
    });
  });

  document.querySelectorAll('.mb-list-item[data-id]').forEach((row) => {
    const sp = getRow(row);
    if (!sp) return;
    row.querySelector('.sp-name')?.addEventListener('input', (e) => { sp.name = (e.target as HTMLInputElement).value; st.dirty = true; });
    row.querySelector('.sp-type')?.addEventListener('change', (e) => { sp.type = (e.target as HTMLSelectElement).value as MapSpawnpoint['type']; st.dirty = true; });
    row.querySelector('.sp-x')?.addEventListener('change', (e) => { sp.x = clampCoord(Number((e.target as HTMLInputElement).value), st.metadata.width); st.dirty = true; redraw(); });
    row.querySelector('.sp-y')?.addEventListener('change', (e) => { sp.y = clampCoord(Number((e.target as HTMLInputElement).value), st.metadata.height); st.dirty = true; redraw(); });
    row.querySelector('.sp-en')?.addEventListener('change', (e) => { sp.enabled = (e.target as HTMLInputElement).checked; st.dirty = true; redraw(); });
  });

  bindSelectedSpawnFields(st, redraw, refresh);

  document.getElementById('sp-add')?.addEventListener('click', () => {
    const id = `sp_${Date.now()}`;
    st.document.spawnpoints.push({
      id, name: 'Spawn', type: 'default_player', x: 1, y: 1, facing: 'down', enabled: true, priority: 0,
    });
    st.selectedSpawnId = id;
    st.dirty = true;
    redraw();
    refresh();
  });
  document.querySelectorAll('.sp-del').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).closest('.mb-list-item')!.getAttribute('data-id')!;
      st.document.spawnpoints = st.document.spawnpoints.filter((s) => s.id !== id);
      if (st.selectedSpawnId === id) st.selectedSpawnId = null;
      st.dirty = true;
      redraw();
      refresh();
    });
  });
}

function bindSelectedSpawnFields(st: EditorState, redraw: () => void, refresh: () => void): void {
  const sp = st.document.spawnpoints.find((s) => s.id === st.selectedSpawnId);
  if (!sp) return;
  document.getElementById('sp-sel-name')?.addEventListener('input', (e) => { sp.name = (e.target as HTMLInputElement).value; st.dirty = true; refresh(); });
  document.getElementById('sp-sel-type')?.addEventListener('change', (e) => { sp.type = (e.target as HTMLSelectElement).value as MapSpawnpoint['type']; st.dirty = true; });
  document.getElementById('sp-sel-x')?.addEventListener('change', (e) => {
    sp.x = clampCoord(Number((e.target as HTMLInputElement).value), st.metadata.width);
    st.dirty = true; redraw();
  });
  document.getElementById('sp-sel-y')?.addEventListener('change', (e) => {
    sp.y = clampCoord(Number((e.target as HTMLInputElement).value), st.metadata.height);
    st.dirty = true; redraw();
  });
  document.getElementById('sp-sel-facing')?.addEventListener('change', (e) => { sp.facing = (e.target as HTMLSelectElement).value as MapSpawnpoint['facing']; st.dirty = true; });
  document.getElementById('sp-sel-en')?.addEventListener('change', (e) => { sp.enabled = (e.target as HTMLInputElement).checked; st.dirty = true; redraw(); });
}

function renderInteractionInspector(st: EditorState): string {
  const zones = st.document.interactionZones ?? [];
  const selected = zones.find((z) => z.id === st.selectedInteractionZoneId);
  const halfTiles = placementUsesHalfTiles(st);
  const step = halfTiles ? 0.5 : 0.5;
  const maxX = st.metadata.width - 0.5;
  const maxY = st.metadata.height - 0.5;
  const typeOptions = INTERACTION_TYPE_OPTIONS.map(
    (o) => `<option value="${o.value}" ${o.value === (selected?.interactionType ?? 'altar') ? 'selected' : ''}>${esc(o.label)}</option>`
  ).join('');
  return `
    <div class="section-head">Interaction zones</div>
    <p class="muted-text">Invisible triggers for altar, shop, crafting, etc. Click the map to place. Players press E nearby to interact.</p>
    <label class="form-field"><span class="form-label">Default type for new zones</span>
      <select id="iz-template">${typeOptions}</select>
    </label>
    <button class="btn secondary mt" id="iz-add" type="button">+ Add zone at 1,1</button>
    <div id="iz-list" class="mt">${zones.map((z) => {
      const sel = z.id === st.selectedInteractionZoneId ? ' selected' : '';
      return `<div class="mb-list-item${sel}" data-id="${z.id}" data-select="interaction">
        <strong>${esc(z.name)}</strong> · ${esc(interactionTypeLabel(z.interactionType))} @ ${formatTileCoord(z.x)},${formatTileCoord(z.y)}
        <button class="btn danger iz-del" data-id="${z.id}">×</button>
      </div>`;
    }).join('') || '<p class="muted-text">No interaction zones yet.</p>'}
    </div>
    ${selected ? `
    <div class="mb-detail-panel mt">
      <div class="section-head">Selected zone</div>
      <label class="form-field"><span class="form-label">Name</span><input type="text" id="iz-sel-name" value="${esc(selected.name)}" /></label>
      <label class="form-field"><span class="form-label">Interaction type</span>
        <select id="iz-sel-type">${INTERACTION_TYPE_OPTIONS.map((o) => `<option value="${o.value}" ${o.value === selected.interactionType ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
      </label>
      <div class="form-grid">
        <label class="form-field"><span class="form-label">X (center)</span><input type="number" id="iz-sel-x" min="0.5" max="${maxX}" step="${step}" value="${selected.x}" /></label>
        <label class="form-field"><span class="form-label">Y (center)</span><input type="number" id="iz-sel-y" min="0.5" max="${maxY}" step="${step}" value="${selected.y}" /></label>
      </div>
      <label class="form-field"><span class="form-label">Shop ID (shop only)</span><input type="text" id="iz-sel-shop" value="${esc(String(selected.data?.shopId ?? ''))}" placeholder="metaphysical_shop" /></label>
      <label class="form-field"><span class="form-label">Station type (legacy crafting only)</span><input type="text" id="iz-sel-station" value="${esc(String(selected.data?.stationType ?? ''))}" placeholder="potion_shelf" ${selected.interactionType === 'crafting' ? '' : 'disabled'} /></label>
      <div class="form-grid">
        <label class="form-field"><span class="form-label">Target scene (door)</span><input type="text" id="iz-sel-scene" value="${esc(selected.targetScene ?? '')}" placeholder="town" /></label>
        <label class="form-field"><span class="form-label">Target spawn (door)</span><input type="text" id="iz-sel-spawn" value="${esc(selected.targetSpawn ?? '')}" placeholder="default" /></label>
      </div>
      <button class="btn danger secondary mt" id="iz-sel-del" type="button">Remove zone</button>
    </div>` : '<p class="muted-text mt">No zone selected.</p>'}`;
}

function bindInteractionInspector(st: EditorState, redraw: () => void, refresh: () => void): void {
  const win = window as unknown as { __mbInteractionTemplate?: string };
  win.__mbInteractionTemplate = (document.getElementById('iz-template') as HTMLSelectElement)?.value ?? 'altar';
  document.getElementById('iz-template')?.addEventListener('change', (e) => {
    win.__mbInteractionTemplate = (e.target as HTMLSelectElement).value;
  });

  document.querySelectorAll('[data-select="interaction"]').forEach((row) => {
    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      clearEntitySelection(st);
      st.selectedInteractionZoneId = (row as HTMLElement).getAttribute('data-id');
      refresh();
      redraw();
    });
  });

  document.querySelectorAll('.iz-del').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.id!;
      st.document.interactionZones = (st.document.interactionZones ?? []).filter((z) => z.id !== id);
      if (st.selectedInteractionZoneId === id) st.selectedInteractionZoneId = null;
      st.dirty = true;
      refresh();
      redraw();
    });
  });

  document.getElementById('iz-add')?.addEventListener('click', () => {
    placeInteractionZoneAt(st, 1.5, 1.5);
    st.dirty = true;
    refresh();
    redraw();
  });

  const item = (st.document.interactionZones ?? []).find((z) => z.id === st.selectedInteractionZoneId);
  if (!item) return;

  document.getElementById('iz-sel-name')?.addEventListener('input', (e) => {
    item.name = (e.target as HTMLInputElement).value;
    st.dirty = true;
    refresh();
  });
  document.getElementById('iz-sel-type')?.addEventListener('change', (e) => {
    item.interactionType = (e.target as HTMLSelectElement).value;
    st.dirty = true;
    refresh();
    redraw();
  });
  document.getElementById('iz-sel-x')?.addEventListener('change', (e) => {
    const x = clampInteractionCenter(Number((e.target as HTMLInputElement).value), st.metadata.width, placementUsesHalfTiles(st));
    if (inBoundsCenter(x, item.y, st)) {
      item.x = x;
      st.dirty = true;
      redraw();
      refresh();
    }
  });
  document.getElementById('iz-sel-y')?.addEventListener('change', (e) => {
    const y = clampInteractionCenter(Number((e.target as HTMLInputElement).value), st.metadata.height, placementUsesHalfTiles(st));
    if (inBoundsCenter(item.x, y, st)) {
      item.y = y;
      st.dirty = true;
      redraw();
      refresh();
    }
  });
  document.getElementById('iz-sel-shop')?.addEventListener('change', (e) => {
    item.data = { ...(item.data ?? {}), shopId: (e.target as HTMLInputElement).value.trim() };
    st.dirty = true;
  });
  document.getElementById('iz-sel-station')?.addEventListener('change', (e) => {
    item.data = { ...(item.data ?? {}), stationType: (e.target as HTMLInputElement).value.trim() };
    st.dirty = true;
  });
  document.getElementById('iz-sel-scene')?.addEventListener('change', (e) => {
    item.targetScene = (e.target as HTMLInputElement).value.trim();
    st.dirty = true;
  });
  document.getElementById('iz-sel-spawn')?.addEventListener('change', (e) => {
    item.targetSpawn = (e.target as HTMLInputElement).value.trim();
    st.dirty = true;
  });
  document.getElementById('iz-sel-del')?.addEventListener('click', () => {
    st.document.interactionZones = (st.document.interactionZones ?? []).filter((z) => z.id !== item.id);
    st.selectedInteractionZoneId = null;
    st.dirty = true;
    refresh();
    redraw();
  });
}

function renderCollisionInspector(st: EditorState): string {
  return `
    <div class="section-head">Collision</div>
    <p class="muted-text">${st.document.collision.length} collision cells. Paint with Collide tool.</p>
    <button class="btn secondary" id="col-clear">Clear all collision</button>
    <button class="btn secondary mt" id="col-from-tiles">Copy from tile defaults</button>
    <!-- TODO: polygon editor, pathfinding preview, line-of-sight overlay -->`;
}

function bindCollisionInspector(st: EditorState, redraw: () => void): void {
  document.getElementById('col-clear')?.addEventListener('click', () => {
    if (!confirm('Clear all collision data?')) return;
    st.document.collision = [];
    st.dirty = true;
    redraw();
  });
  document.getElementById('col-from-tiles')?.addEventListener('click', () => {
    showToast('Tile default collision import — TODO: wire tile definitions', 'info');
  });
}

function renderNpcInspector(st: EditorState, npcs: { id: string; name: string }[]): string {
  return `
    <div class="section-head">NPC placements</div>
    <label class="form-field"><span class="form-label">Template</span>
      <select id="npc-template"><option value="">Select NPC...</option>
        ${npcs.map((n) => `<option value="${n.id}">${esc(n.name)}</option>`).join('')}
      </select>
    </label>
    <div id="npc-list">${st.document.npcPlacements.map((n) =>
      `<div class="mb-list-item">${esc(n.npcTemplateId)} @ ${n.x},${n.y} <button class="btn danger npc-del" data-id="${n.id}">×</button></div>`
    ).join('')}</div>`;
}

function bindNpcInspector(st: EditorState, npcs: { id: string; name: string }[], redraw: () => void): void {
  document.querySelectorAll('.npc-del').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.id!;
      st.document.npcPlacements = st.document.npcPlacements.filter((n) => n.id !== id);
      st.dirty = true;
      redraw();
    });
  });
  (window as unknown as { __mbNpcTemplate?: string }).__mbNpcTemplate =
    (document.getElementById('npc-template') as HTMLSelectElement)?.value ?? '';
  document.getElementById('npc-template')?.addEventListener('change', (e) => {
    (window as unknown as { __mbNpcTemplate?: string }).__mbNpcTemplate = (e.target as HTMLSelectElement).value;
  });
}

function renderSpiritInspector(st: EditorState, spirits: { id: string; name: string }[]): string {
  return `
    <div class="section-head">Spirit placements</div>
    <select id="spirit-template"><option value="">Zone only</option>
      ${spirits.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
    </select>
    <div id="spirit-list" class="mt">${st.document.spiritPlacements.map((s) =>
      `<div class="mb-list-item">${s.spiritTemplateId ?? 'zone'} @ ${s.x},${s.y} <button class="btn danger spirit-del" data-id="${s.id}">×</button></div>`
    ).join('')}</div>`;
}

function bindSpiritInspector(st: EditorState, _spirits: { id: string; name: string }[], redraw: () => void): void {
  document.querySelectorAll('.spirit-del').forEach((btn) => {
    btn.addEventListener('click', () => {
      st.document.spiritPlacements = st.document.spiritPlacements.filter((s) => s.id !== (btn as HTMLElement).dataset.id);
      st.dirty = true;
      redraw();
    });
  });
  (window as unknown as { __mbSpiritTemplate?: string }).__mbSpiritTemplate =
    (document.getElementById('spirit-template') as HTMLSelectElement)?.value ?? '';
  document.getElementById('spirit-template')?.addEventListener('change', (e) => {
    (window as unknown as { __mbSpiritTemplate?: string }).__mbSpiritTemplate = (e.target as HTMLSelectElement).value;
  });
}

function renderWardInspector(st: EditorState, canUnbreakable: boolean): string {
  return `
    <div class="section-head">Room wards</div>
    ${!st.metadata.isWardable ? '<p class="error">Map is not wardable — enable in metadata.</p>' : ''}
    ${!canUnbreakable ? '<p class="muted-text">Unbreakable wards require content.map.ward.unbreakable permission.</p>' : ''}
    <div id="ward-list">${st.document.wardPlacements.map((w) => wardRow(w)).join('')}</div>
    <button class="btn secondary mt" id="ward-add">+ Place ward (use Ward tool on map)</button>`;
}

function wardRow(w: MapWardPlacement): string {
  const warn = w.unbreakable ? '<span class="mb-danger-badge">UNBREAKABLE</span>' : '';
  return `<div class="mb-list-item ${w.unbreakable ? 'mb-unbreakable-row' : ''}" data-id="${w.id}">
    ${warn}<strong>${esc(w.name)}</strong> (${w.wardType}) @ ${w.x},${w.y}
    <button class="btn danger ward-del" data-id="${w.id}">×</button>
  </div>`;
}

function bindWardInspector(st: EditorState, canUnbreakable: boolean, redraw: () => void): void {
  document.querySelectorAll('.ward-del').forEach((btn) => {
    btn.addEventListener('click', () => {
      const w = st.document.wardPlacements.find((x) => x.id === (btn as HTMLElement).dataset.id);
      if (w?.unbreakable && !confirm('Remove unbreakable ward? This affects live protection boundaries.')) return;
      st.document.wardPlacements = st.document.wardPlacements.filter((x) => x.id !== (btn as HTMLElement).dataset.id);
      st.dirty = true;
      redraw();
    });
  });
  (window as unknown as { __mbWardUnbreakable?: boolean }).__mbWardUnbreakable = canUnbreakable;
}

function renderPortalInspector(st: EditorState, maps: MapProjectMetadata[]): string {
  const selected = st.document.portals.find((p) => p.id === st.selectedPortalId);
  const mapOpts = maps
    .filter((m) => m.status !== 'archived')
    .map((m) => `<option value="${esc(m.sceneId)}" ${m.sceneId === selected?.targetMapId ? 'selected' : ''}>${esc(m.displayName)} (${esc(m.sceneId)})</option>`)
    .join('');
  return `
    <div class="section-head">Portals & exits</div>
    <p class="muted-text">Click a portal on the map to select and drag it, or use the link wizard for two-way connections.</p>
    <div id="portal-list">${st.document.portals.map((p) => portalRow(p, st)).join('')}</div>
    ${selected ? renderPortalDetail(selected, mapOpts, st) : '<p class="muted-text mt">No portal selected — use Portal tool to place one.</p>'}
    <button class="btn secondary mt" id="portal-wizard" ${selected ? '' : 'disabled'}>Link wizard…</button>`;
}

function portalRow(p: MapPortal, st: EditorState): string {
  const sel = p.id === st.selectedPortalId ? ' selected' : '';
  const link = p.twoWay ? ' ↔' : ' →';
  return `<div class="mb-list-item${sel}" data-id="${p.id}" data-select="portal">
    <strong>${esc(p.name)}</strong>${link} ${esc(p.targetMapId || '?')} @ ${p.sourceX},${p.sourceY}
    <button class="btn danger portal-del" data-id="${p.id}">×</button>
  </div>`;
}

function renderPortalDetail(p: MapPortal, mapOpts: string, st: EditorState): string {
  const maxX = st.metadata.width - 1;
  const maxY = st.metadata.height - 1;
  return `
    <div class="mb-detail-panel mt">
      <div class="section-head">Selected portal</div>
      <label class="form-field"><span class="form-label">Name</span><input id="pt-sel-name" value="${esc(p.name)}" /></label>
      <div class="form-grid">
        <label class="form-field"><span class="form-label">Source X</span><input type="number" id="pt-sel-x" min="0" max="${maxX}" value="${p.sourceX}" /></label>
        <label class="form-field"><span class="form-label">Source Y</span><input type="number" id="pt-sel-y" min="0" max="${maxY}" value="${p.sourceY}" /></label>
      </div>
      <label class="form-field"><span class="form-label">Target scene</span>
        <select id="pt-sel-target"><option value="">—</option>${mapOpts}</select>
      </label>
      <label class="form-field"><span class="form-label">Target spawn id</span><input id="pt-sel-spawn" value="${esc(p.targetSpawnId)}" placeholder="default" /></label>
      <label class="form-field"><span class="form-label">Facing</span>
        <select id="pt-sel-dir">${(['up','down','left','right'] as const).map((d) => `<option value="${d}" ${d === p.direction ? 'selected' : ''}>${d}</option>`).join('')}</select>
      </label>
      <label class="checkbox-chip"><input type="checkbox" id="pt-sel-visible" ${p.visible ? 'checked' : ''} /> Visible</label>
      <label class="checkbox-chip"><input type="checkbox" id="pt-sel-tw" ${p.twoWay ? 'checked' : ''} /> Two-way linked</label>
      ${p.linkedPortalId ? `<p class="muted-text">Return portal id: <code>${esc(p.linkedPortalId)}</code></p>` : ''}
      <button class="btn secondary mt" id="pt-unlink" ${p.twoWay ? '' : 'disabled'}>Remove return link</button>
    </div>`;
}

function bindPortalInspector(
  st: EditorState,
  redraw: () => void,
  maps: MapProjectMetadata[],
  refresh: () => void
): void {
  document.querySelectorAll('[data-select="portal"]').forEach((row) => {
    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      st.selectedPortalId = (row as HTMLElement).getAttribute('data-id');
      st.selectedSpawnId = null;
      refresh();
      redraw();
    });
  });

  const p = st.document.portals.find((x) => x.id === st.selectedPortalId);
  if (p) {
    document.getElementById('pt-sel-name')?.addEventListener('input', (e) => { p.name = (e.target as HTMLInputElement).value; st.dirty = true; refresh(); });
    document.getElementById('pt-sel-x')?.addEventListener('change', (e) => {
      p.sourceX = clampCoord(Number((e.target as HTMLInputElement).value), st.metadata.width);
      st.dirty = true; redraw();
    });
    document.getElementById('pt-sel-y')?.addEventListener('change', (e) => {
      p.sourceY = clampCoord(Number((e.target as HTMLInputElement).value), st.metadata.height);
      st.dirty = true; redraw();
    });
    document.getElementById('pt-sel-target')?.addEventListener('change', (e) => { p.targetMapId = (e.target as HTMLSelectElement).value; st.dirty = true; });
    document.getElementById('pt-sel-spawn')?.addEventListener('input', (e) => { p.targetSpawnId = (e.target as HTMLInputElement).value; st.dirty = true; });
    document.getElementById('pt-sel-dir')?.addEventListener('change', (e) => { p.direction = (e.target as HTMLSelectElement).value as MapPortal['direction']; st.dirty = true; });
    document.getElementById('pt-sel-visible')?.addEventListener('change', (e) => { p.visible = (e.target as HTMLInputElement).checked; st.dirty = true; redraw(); });
    document.getElementById('pt-sel-tw')?.addEventListener('change', (e) => {
      if (!(e.target as HTMLInputElement).checked && p.twoWay) {
        void removeTwoWayLink(p, maps).then(() => { st.dirty = true; refresh(); showToast('Return link removed', 'info'); }).catch(() => refresh());
      }
    });
    document.getElementById('pt-unlink')?.addEventListener('click', () => {
      void removeTwoWayLink(p, maps).then(() => { st.dirty = true; refresh(); redraw(); showToast('Return link removed', 'info'); }).catch(() => refresh());
    });
  }

  document.getElementById('portal-wizard')?.addEventListener('click', () => {
    const portal = st.document.portals.find((x) => x.id === st.selectedPortalId);
    if (!portal) return;
    showPortalLinkWizard({
      portal,
      currentMapMeta: st.metadata,
      currentDoc: st.document,
      allMaps: maps,
      onApplied: () => { st.dirty = true; refresh(); redraw(); },
    });
  });

  document.querySelectorAll('.portal-del').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.id!;
      const portal = st.document.portals.find((x) => x.id === id);
      if (portal?.twoWay && portal.linkedPortalId) {
        try { await removeTwoWayLink(portal, maps); } catch { return; }
      }
      st.document.portals = st.document.portals.filter((x) => x.id !== id);
      if (st.selectedPortalId === id) st.selectedPortalId = null;
      st.dirty = true;
      redraw();
      refresh();
    });
  });
}

function renderFurnitureInspector(st: EditorState, defs: FurnitureDefRow[]): string {
  const selected = st.document.placedFurniture.find((f) => f.id === st.selectedFurnitureId);
  const def = selected ? st.furnitureDefs.get(selected.furnitureDefId) : undefined;
  const halfTiles = placementUsesHalfTiles(st);
  const step = halfTiles ? 0.5 : 1;
  const maxX = Math.max(0, st.metadata.width - (def?.width ?? 1));
  const maxY = Math.max(0, st.metadata.height - (def?.height ?? 1));
  const level = normalizePlacedRenderLevel(selected?.renderLevel);
  return `
    <div class="section-head">Furniture placement</div>
    <p class="muted-text">Choose a piece, then click the map to place (0.5 tile steps by default). Use <strong>Altar</strong> furniture for a visible altar with interaction. Invisible-only triggers: use the Interact tool.</p>
    <label class="form-field"><span class="form-label">Furniture</span>
      <select id="furn-template"><option value="">Select furniture...</option>
        ${defs.map((f) => `<option value="${f.id}" ${f.id === selected?.furnitureDefId ? 'selected' : ''}>${esc(f.name)} (${f.width}×${f.height})</option>`).join('')}
      </select>
    </label>
    <div id="furn-list">${st.document.placedFurniture.map((f) => {
      const d = st.furnitureDefs.get(f.furnitureDefId);
      const sel = f.id === st.selectedFurnitureId ? ' selected' : '';
      const lvl = normalizePlacedRenderLevel(f.renderLevel);
      const inter = getInteractionTypeFromProperties(d?.properties);
      const interTag = inter ? ` · ${esc(interactionTypeLabel(inter))}` : '';
      return `<div class="mb-list-item${sel}" data-id="${f.id}" data-select="furniture">
        <strong>${esc(d?.name ?? f.furnitureDefId)}</strong> @ ${formatTileCoord(f.x)},${formatTileCoord(f.y)} · L${lvl}${interTag}
        <button class="btn danger furn-del" data-id="${f.id}">×</button>
      </div>`;
    }).join('') || '<p class="muted-text">No furniture placed yet.</p>'}
    </div>
    ${selected ? `
    <div class="mb-detail-panel mt">
      <div class="section-head">Selected furniture</div>
      <div class="form-grid">
        <label class="form-field"><span class="form-label">X</span><input type="number" id="furn-sel-x" min="0" max="${maxX}" step="${step}" value="${selected.x}" /></label>
        <label class="form-field"><span class="form-label">Y</span><input type="number" id="furn-sel-y" min="0" max="${maxY}" step="${step}" value="${selected.y}" /></label>
      </div>
      <label class="form-field"><span class="form-label">Render level (0–${RENDER_LEVEL_MAX})</span>
        <input type="number" id="furn-sel-level" min="0" max="${RENDER_LEVEL_MAX}" step="1" value="${level}" />
      </label>
      <p class="muted-text">0 = background, 1 = floor, higher draws in front. Player sorts at level 50.</p>
      <label class="form-field"><span class="form-label">Rotation</span>
        <select id="furn-sel-rot">${([0, 90, 180, 270] as const).map((r) => `<option value="${r}" ${r === selected.rotation ? 'selected' : ''}>${r}°</option>`).join('')}</select>
      </label>
      <div class="btn-row mt">
        <button class="btn secondary" id="furn-sel-clear" type="button">Clear selection</button>
        <button class="btn danger secondary" id="furn-sel-del" type="button">Remove</button>
      </div>
    </div>` : '<p class="muted-text mt">No furniture selected.</p>'}`;
}

function bindFurnitureInspector(st: EditorState, redraw: () => void, refresh: () => void): void {
  const win = window as unknown as { __mbFurnitureTemplate?: string };
  win.__mbFurnitureTemplate = (document.getElementById('furn-template') as HTMLSelectElement)?.value ?? '';
  document.getElementById('furn-template')?.addEventListener('change', (e) => {
    win.__mbFurnitureTemplate = (e.target as HTMLSelectElement).value;
  });

  document.querySelectorAll('[data-select="furniture"]').forEach((row) => {
    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      const id = (row as HTMLElement).getAttribute('data-id');
      if (st.selectedFurnitureId === id) {
        st.selectedFurnitureId = null;
      } else {
        clearEntitySelection(st);
        st.selectedFurnitureId = id;
      }
      refresh();
      redraw();
    });
  });

  document.querySelectorAll('.furn-del').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.id!;
      st.document.placedFurniture = st.document.placedFurniture.filter((f) => f.id !== id);
      if (st.selectedFurnitureId === id) st.selectedFurnitureId = null;
      st.dirty = true;
      refresh();
      redraw();
    });
  });

  const item = st.document.placedFurniture.find((f) => f.id === st.selectedFurnitureId);
  if (item) {
    const def = st.furnitureDefs.get(item.furnitureDefId);
    document.getElementById('furn-sel-x')?.addEventListener('change', (e) => {
      const x = clampPlacementCoord(
        Number((e.target as HTMLInputElement).value),
        st.metadata.width,
        def?.width ?? 1,
        placementUsesHalfTiles(st)
      );
      if (canPlaceFootprint(st, x, item.y, def?.width ?? 1, def?.height ?? 1)) {
        item.x = x;
        st.dirty = true;
        redraw();
        refresh();
      }
    });
    document.getElementById('furn-sel-y')?.addEventListener('change', (e) => {
      const y = clampPlacementCoord(
        Number((e.target as HTMLInputElement).value),
        st.metadata.height,
        def?.height ?? 1,
        placementUsesHalfTiles(st)
      );
      if (canPlaceFootprint(st, item.x, y, def?.width ?? 1, def?.height ?? 1)) {
        item.y = y;
        st.dirty = true;
        redraw();
        refresh();
      }
    });
    document.getElementById('furn-sel-level')?.addEventListener('change', (e) => {
      item.renderLevel = clampRenderLevel(Number((e.target as HTMLInputElement).value));
      st.dirty = true;
      redraw();
      refresh();
    });
    document.getElementById('furn-sel-rot')?.addEventListener('change', (e) => {
      item.rotation = Number((e.target as HTMLSelectElement).value) as PlacedFurniture['rotation'];
      st.dirty = true;
      redraw();
    });
    document.getElementById('furn-sel-clear')?.addEventListener('click', () => {
      st.selectedFurnitureId = null;
      refresh();
      redraw();
    });
    document.getElementById('furn-sel-del')?.addEventListener('click', () => {
      st.document.placedFurniture = st.document.placedFurniture.filter((f) => f.id !== item.id);
      st.selectedFurnitureId = null;
      st.dirty = true;
      refresh();
      redraw();
    });
  }
}

function renderDecorationInspector(st: EditorState, defs: DecorationDefRow[]): string {
  const selected = st.document.placedDecorations.find((d) => d.id === st.selectedDecorationId);
  const halfTiles = placementUsesHalfTiles(st);
  const step = halfTiles ? 0.5 : 1;
  const maxX = Math.max(0, st.metadata.width - 1);
  const maxY = Math.max(0, st.metadata.height - 1);
  const level = normalizePlacedRenderLevel(selected?.renderLevel);
  return `
    <div class="section-head">Decoration placement</div>
    <p class="muted-text">Choose a decoration, then click the map to place (0.5 tile steps by default). Drag to move. Click empty map to deselect.</p>
    <label class="form-field"><span class="form-label">Decoration</span>
      <select id="decor-template"><option value="">Select decoration...</option>
        ${defs.map((d) => `<option value="${d.id}" ${d.id === selected?.decorationDefId ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
      </select>
    </label>
    <div id="decor-list">${st.document.placedDecorations.map((d) => {
      const def = st.decorationDefs.get(d.decorationDefId);
      const sel = d.id === st.selectedDecorationId ? ' selected' : '';
      const lvl = normalizePlacedRenderLevel(d.renderLevel);
      return `<div class="mb-list-item${sel}" data-id="${d.id}" data-select="decoration">
        <strong>${esc(def?.name ?? d.decorationDefId)}</strong> @ ${formatTileCoord(d.x)},${formatTileCoord(d.y)} · L${lvl}
        <button class="btn danger decor-del" data-id="${d.id}">×</button>
      </div>`;
    }).join('') || '<p class="muted-text">No decorations placed yet.</p>'}
    </div>
    ${selected ? `
    <div class="mb-detail-panel mt">
      <div class="section-head">Selected decoration</div>
      <div class="form-grid">
        <label class="form-field"><span class="form-label">X</span><input type="number" id="decor-sel-x" min="0" max="${maxX}" step="${step}" value="${selected.x}" /></label>
        <label class="form-field"><span class="form-label">Y</span><input type="number" id="decor-sel-y" min="0" max="${maxY}" step="${step}" value="${selected.y}" /></label>
      </div>
      <label class="form-field"><span class="form-label">Render level (0–${RENDER_LEVEL_MAX})</span>
        <input type="number" id="decor-sel-level" min="0" max="${RENDER_LEVEL_MAX}" step="1" value="${level}" />
      </label>
      <p class="muted-text">0 = background, 1 = floor, higher draws in front. Player sorts at level 50.</p>
      <label class="form-field"><span class="form-label">Rotation</span>
        <select id="decor-sel-rot">${([0, 90, 180, 270] as const).map((r) => `<option value="${r}" ${r === selected.rotation ? 'selected' : ''}>${r}°</option>`).join('')}</select>
      </label>
      <div class="btn-row mt">
        <button class="btn secondary" id="decor-sel-clear" type="button">Clear selection</button>
        <button class="btn danger secondary" id="decor-sel-del" type="button">Remove</button>
      </div>
    </div>` : '<p class="muted-text mt">No decoration selected.</p>'}`;
}

function bindDecorationInspector(st: EditorState, redraw: () => void, refresh: () => void): void {
  const win = window as unknown as { __mbDecorationTemplate?: string };
  win.__mbDecorationTemplate = (document.getElementById('decor-template') as HTMLSelectElement)?.value ?? '';
  document.getElementById('decor-template')?.addEventListener('change', (e) => {
    win.__mbDecorationTemplate = (e.target as HTMLSelectElement).value;
  });

  document.querySelectorAll('[data-select="decoration"]').forEach((row) => {
    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      const id = (row as HTMLElement).getAttribute('data-id');
      if (st.selectedDecorationId === id) {
        st.selectedDecorationId = null;
      } else {
        clearEntitySelection(st);
        st.selectedDecorationId = id;
      }
      refresh();
      redraw();
    });
  });

  document.querySelectorAll('.decor-del').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.id!;
      st.document.placedDecorations = st.document.placedDecorations.filter((d) => d.id !== id);
      if (st.selectedDecorationId === id) st.selectedDecorationId = null;
      st.dirty = true;
      refresh();
      redraw();
    });
  });

  const item = st.document.placedDecorations.find((d) => d.id === st.selectedDecorationId);
  if (item) {
    document.getElementById('decor-sel-x')?.addEventListener('change', (e) => {
      item.x = clampPlacementCoord(
        Number((e.target as HTMLInputElement).value),
        st.metadata.width,
        1,
        placementUsesHalfTiles(st)
      );
      st.dirty = true;
      redraw();
      refresh();
    });
    document.getElementById('decor-sel-y')?.addEventListener('change', (e) => {
      item.y = clampPlacementCoord(
        Number((e.target as HTMLInputElement).value),
        st.metadata.height,
        1,
        placementUsesHalfTiles(st)
      );
      st.dirty = true;
      redraw();
      refresh();
    });
    document.getElementById('decor-sel-level')?.addEventListener('change', (e) => {
      item.renderLevel = clampRenderLevel(Number((e.target as HTMLInputElement).value));
      st.dirty = true;
      redraw();
      refresh();
    });
    document.getElementById('decor-sel-rot')?.addEventListener('change', (e) => {
      item.rotation = Number((e.target as HTMLSelectElement).value) as PlacedDecoration['rotation'];
      st.dirty = true;
      redraw();
    });
    document.getElementById('decor-sel-clear')?.addEventListener('click', () => {
      st.selectedDecorationId = null;
      refresh();
      redraw();
    });
    document.getElementById('decor-sel-del')?.addEventListener('click', () => {
      st.document.placedDecorations = st.document.placedDecorations.filter((d) => d.id !== item.id);
      st.selectedDecorationId = null;
      st.dirty = true;
      refresh();
      redraw();
    });
  }
}

function pushUndo(st: EditorState): void {
  st.undoStack.push(structuredClone(st.document));
  if (st.undoStack.length > 40) st.undoStack.shift();
  st.redoStack = [];
}

function getActiveLayer(st: EditorState): MapLayerState | undefined {
  return st.document.layers.find((l) => l.id === st.activeLayerId);
}

function usesHalfTilePlacement(st: EditorState): boolean {
  return (
    st.mode === 'furniture'
    || st.mode === 'decorations'
    || st.mode === 'interactions'
    || st.tool === 'furniture'
    || st.tool === 'decoration'
    || st.tool === 'interaction'
  );
}

function placementUsesHalfTiles(st: EditorState): boolean {
  return usesHalfTilePlacement(st) && !st.snapToGrid;
}

function canvasToTile(e: MouseEvent, st: EditorState, canvas: HTMLCanvasElement): { tx: number; ty: number } {
  const rect = canvas.getBoundingClientRect();
  const ts = st.metadata.tileSize * st.zoom;
  const rawX = (e.clientX - rect.left) / ts;
  const rawY = (e.clientY - rect.top) / ts;
  if (placementUsesHalfTiles(st)) {
    return { tx: snapPlacementCoord(rawX), ty: snapPlacementCoord(rawY) };
  }
  return { tx: Math.floor(rawX), ty: Math.floor(rawY) };
}

function snapPlacementCoord(v: number): number {
  return Math.round(v * 2) / 2;
}

function formatCoordLabel(tx: number, ty: number): string {
  return `${formatTileCoord(tx)}, ${formatTileCoord(ty)}`;
}

function applyEntityModeAt(st: EditorState, tx: number, ty: number): void {
  if (!inBounds(tx, ty, st)) return;
  if (st.mode === 'spawnpoints') {
    if (st.selectedSpawnId) {
      const sp = st.document.spawnpoints.find((s) => s.id === st.selectedSpawnId);
      if (sp) { sp.x = tx; sp.y = ty; }
      return;
    }
    const sp = st.document.spawnpoints.find((s) => s.type === 'default_player') ?? st.document.spawnpoints[0];
    if (sp) { sp.x = tx; sp.y = ty; }
    return;
  }
  if (st.mode === 'portals') {
    if (st.selectedPortalId) {
      const p = st.document.portals.find((x) => x.id === st.selectedPortalId);
      if (p) { p.sourceX = tx; p.sourceY = ty; }
      return;
    }
    const id = `portal_${Date.now()}`;
    st.document.portals.push({
      id, name: 'Portal', sourceX: tx, sourceY: ty,
      targetMapId: '', targetSpawnId: 'default', direction: 'down', twoWay: false, visible: true,
    });
    st.selectedPortalId = id;
    clearEntitySelection(st, { keepPortal: true });
    return;
  }
  if (st.mode === 'furniture') {
    placeFurnitureAt(st, tx, ty);
    return;
  }
  if (st.mode === 'decorations') {
    placeDecorationAt(st, tx, ty);
    return;
  }
  if (st.mode === 'interactions') {
    if (st.selectedInteractionZoneId) return;
    const center = canvasToInteractionCenterFromTile(tx, ty, st);
    placeInteractionZoneAt(st, center.x, center.y);
  }
}

function applyToolAt(e: MouseEvent, st: EditorState, canvas: HTMLCanvasElement): void {
  const { tx, ty } = canvasToTile(e, st, canvas);
  if (tx < 0 || ty < 0 || tx >= st.metadata.width || ty >= st.metadata.height) return;

  if (st.tool === 'brush' || st.tool === 'erase') {
    const layer = getActiveLayer(st);
    if (!layer || layer.locked) return;
    layer.cells[ty][tx] = st.tool === 'erase' ? 0 : st.brushTile;
    return;
  }
  if (st.tool === 'fill') {
    const layer = getActiveLayer(st);
    if (!layer || layer.locked) return;
    floodFill(layer, tx, ty, layer.cells[ty][tx], st.brushTile);
    return;
  }
  if (st.tool === 'spawn') {
    if (st.selectedSpawnId) {
      const sp = st.document.spawnpoints.find((s) => s.id === st.selectedSpawnId);
      if (sp) { sp.x = tx; sp.y = ty; }
      return;
    }
    const sp = st.document.spawnpoints.find((s) => s.type === 'default_player') ?? st.document.spawnpoints[0];
    if (sp) { sp.x = tx; sp.y = ty; }
    return;
  }
  if (st.tool === 'collision') {
    const idx = st.document.collision.findIndex((c) => c.x === tx && c.y === ty);
    if (idx >= 0) st.document.collision.splice(idx, 1);
    else st.document.collision.push({ x: tx, y: ty, mode: 'full' });
    return;
  }
  if (st.tool === 'npc') {
    const tpl = (window as unknown as { __mbNpcTemplate?: string }).__mbNpcTemplate;
    if (!tpl) { showToast('Select an NPC template first', 'info'); return; }
    st.document.npcPlacements.push({ id: `npc_${Date.now()}`, npcTemplateId: tpl, x: tx, y: ty, staticPosition: true });
    return;
  }
  if (st.tool === 'spirit') {
    const tpl = (window as unknown as { __mbSpiritTemplate?: string }).__mbSpiritTemplate;
    st.document.spiritPlacements.push({
      id: `spirit_${Date.now()}`, spiritTemplateId: tpl || undefined, zoneType: tpl ? 'entity' : 'spawn_zone', x: tx, y: ty, radius: 3,
    });
    return;
  }
  if (st.tool === 'ward') {
    const canUb = (window as unknown as { __mbWardUnbreakable?: boolean }).__mbWardUnbreakable;
    const unbreakable = canUb && confirm('Create UNBREAKABLE ward? Only admins can remove it. Click OK to confirm.');
    st.document.wardPlacements.push({
      id: `ward_${Date.now()}`, name: unbreakable ? 'Admin Ward' : 'Room Ward', description: '',
      wardType: unbreakable ? 'unbreakable' : 'environmental', x: tx, y: ty, strength: 10,
      visibility: 'subtle', unbreakable: !!unbreakable, adminLocked: !!unbreakable, breakability: unbreakable ? 'unbreakable' : 'normal',
    });
    return;
  }
  if (st.tool === 'portal') {
    if (st.selectedPortalId) {
      const p = st.document.portals.find((x) => x.id === st.selectedPortalId);
      if (p) { p.sourceX = tx; p.sourceY = ty; }
      return;
    }
    const id = `portal_${Date.now()}`;
    st.document.portals.push({
      id, name: 'Portal', sourceX: tx, sourceY: ty,
      targetMapId: '', targetSpawnId: 'default', direction: 'down', twoWay: false, visible: true,
    });
    st.selectedPortalId = id;
    clearEntitySelection(st, { keepPortal: true });
    return;
  }
  if (st.tool === 'furniture') {
    placeFurnitureAt(st, tx, ty);
    return;
  }
  if (st.tool === 'decoration') {
    placeDecorationAt(st, tx, ty);
    return;
  }
  if (st.tool === 'interaction') {
    if (st.selectedInteractionZoneId) return;
    const center = canvasToInteractionCenterFromTile(tx, ty, st);
    placeInteractionZoneAt(st, center.x, center.y);
  }
}

function floodFill(layer: MapLayerState, x: number, y: number, oldVal: number, newVal: number): void {
  if (oldVal === newVal) return;
  const h = layer.cells.length;
  const w = layer.cells[0]?.length ?? 0;
  const stack: [number, number][] = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop()!;
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
    if (layer.cells[cy][cx] !== oldVal) continue;
    layer.cells[cy][cx] = newVal;
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
}

function drawMap(st: EditorState, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, minimap: HTMLCanvasElement): void {
  const ts = st.metadata.tileSize;
  const w = st.metadata.width;
  const h = st.metadata.height;
  const scale = st.zoom;
  canvas.width = w * ts * scale;
  canvas.height = h * ts * scale;

  ctx.fillStyle = '#120f1a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const sorted = [...st.document.layers].sort((a, b) => a.order - b.order);
  for (const layer of sorted) {
    if (!layer.visible || layer.kind === 'collision') continue;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = layer.cells[y]?.[x] ?? 0;
        if (!idx) continue;
        const spriteKey = spriteKeyFromTileIndex(idx);
        if (!spriteKey) continue;
        const pad = st.showGrid ? 1 : 0;
        drawTileSprite(ctx, spriteKey, x * ts * scale, y * ts * scale, ts * scale - pad);
      }
    }
  }

  if (st.mode === 'collision' || st.tool === 'collision') {
    ctx.fillStyle = 'rgba(196,68,68,0.45)';
    for (const c of st.document.collision) {
      ctx.fillRect(c.x * ts * scale, c.y * ts * scale, ts * scale, ts * scale);
    }
  }

  ctx.font = `${10 * scale}px sans-serif`;
  for (const sp of st.document.spawnpoints) {
    if (!sp.enabled) continue;
    const selected = sp.id === st.selectedSpawnId;
    ctx.fillStyle = selected ? '#6cf' : '#4a8';
    ctx.fillRect(sp.x * ts * scale + 2, sp.y * ts * scale + 2, ts * scale - 4, ts * scale - 4);
    if (selected) {
      ctx.strokeStyle = '#ffeb3b';
      ctx.lineWidth = 2;
      ctx.strokeRect(sp.x * ts * scale, sp.y * ts * scale, ts * scale, ts * scale);
    }
    ctx.fillStyle = '#fff';
    ctx.fillText('S', sp.x * ts * scale + 4, sp.y * ts * scale + ts * scale - 4);
  }

  for (const n of st.document.npcPlacements) {
    ctx.fillStyle = '#c9a227';
    ctx.beginPath();
    ctx.arc(n.x * ts * scale + ts * scale / 2, n.y * ts * scale + ts * scale / 2, ts * scale * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const w of st.document.wardPlacements) {
    ctx.strokeStyle = w.unbreakable ? '#f44' : '#7b5ea7';
    ctx.lineWidth = w.unbreakable ? 3 : 1;
    ctx.strokeRect(w.x * ts * scale, w.y * ts * scale, ts * scale, ts * scale);
  }

  for (const p of st.document.portals) {
    const selected = p.id === st.selectedPortalId;
    ctx.fillStyle = selected ? '#2a6a9a' : '#1a4a6b';
    ctx.fillRect(p.sourceX * ts * scale, p.sourceY * ts * scale, ts * scale, ts * scale);
    if (selected) {
      ctx.strokeStyle = '#ffeb3b';
      ctx.lineWidth = 2;
      ctx.strokeRect(p.sourceX * ts * scale, p.sourceY * ts * scale, ts * scale, ts * scale);
    }
    ctx.fillStyle = '#8cf';
    ctx.fillText(p.twoWay ? '↔' : 'P', p.sourceX * ts * scale + 4, p.sourceY * ts * scale + ts * scale - 4);
  }

  for (const z of st.document.interactionZones ?? []) {
    const selected = z.id === st.selectedInteractionZoneId;
    const half = ts * scale * 0.45;
    const cx = z.x * ts * scale;
    const cy = z.y * ts * scale;
    ctx.fillStyle = selected ? 'rgba(180, 80, 220, 0.55)' : 'rgba(120, 40, 160, 0.35)';
    ctx.fillRect(cx - half, cy - half, half * 2, half * 2);
    if (selected) {
      ctx.strokeStyle = '#ffeb3b';
      ctx.lineWidth = 2;
      ctx.strokeRect(cx - half, cy - half, half * 2, half * 2);
    }
    ctx.fillStyle = '#f8eaff';
    ctx.font = `${Math.max(8, ts * scale * 0.45)}px monospace`;
    ctx.fillText(interactionTypeGlyph(z.interactionType), cx - half * 0.35, cy + half * 0.35);
  }

  for (const f of [...st.document.placedFurniture].sort(
    (a, b) => normalizePlacedRenderLevel(a.renderLevel) - normalizePlacedRenderLevel(b.renderLevel) || a.y - b.y
  )) {
    const def = st.furnitureDefs.get(f.furnitureDefId);
    const fw = def?.width ?? 1;
    const fh = def?.height ?? 1;
    const spriteRef = def?.spriteRef ?? 'obj_altar';
    const px = f.x * ts * scale;
    const py = f.y * ts * scale;
    const pw = fw * ts * scale;
    const ph = fh * ts * scale;
    drawSpriteRectRotated(ctx, spriteRef, px, py, pw, ph, f.rotation);
    if (f.id === st.selectedFurnitureId) {
      ctx.strokeStyle = '#ffeb3b';
      ctx.lineWidth = 2;
      strokeRectRotated(ctx, px, py, pw, ph, f.rotation);
    }
  }

  for (const d of [...st.document.placedDecorations].sort(
    (a, b) => normalizePlacedRenderLevel(a.renderLevel) - normalizePlacedRenderLevel(b.renderLevel) || a.y - b.y
  )) {
    const def = st.decorationDefs.get(d.decorationDefId);
    const spriteRef = def?.spriteRef ?? 'obj_tree';
    const px = d.x * ts * scale;
    const py = d.y * ts * scale;
    const size = ts * scale;
    drawSpriteRectRotated(ctx, spriteRef, px, py, size, size, d.rotation);
    if (d.id === st.selectedDecorationId) {
      ctx.strokeStyle = '#ffeb3b';
      ctx.lineWidth = 2;
      strokeRectRotated(ctx, px, py, size, size, d.rotation);
    }
  }

  if (st.showGrid) {
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x++) {
      ctx.beginPath(); ctx.moveTo(x * ts * scale, 0); ctx.lineTo(x * ts * scale, h * ts * scale); ctx.stroke();
    }
    for (let y = 0; y <= h; y++) {
      ctx.beginPath(); ctx.moveTo(0, y * ts * scale); ctx.lineTo(w * ts * scale, y * ts * scale); ctx.stroke();
    }
  }

  drawMinimap(st, minimap);
}

function drawMinimap(st: EditorState, canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')!;
  const w = st.metadata.width;
  const h = st.metadata.height;
  const px = canvas.width / w;
  const py = canvas.height / h;
  ctx.fillStyle = '#0a0810';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const ground = st.document.layers.find((l) => l.kind === 'ground') ?? st.document.layers[0];
  if (ground) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = ground.cells[y]?.[x] ?? 0;
        if (!idx) continue;
        const spriteKey = spriteKeyFromTileIndex(idx);
        if (!spriteKey) continue;
        drawTileSprite(ctx, spriteKey, x * px, y * py, px);
      }
    }
  }
}

function updateZoomLabel(st: EditorState): void {
  (document.getElementById('mb-zoom-label')!).textContent = `${Math.round(st.zoom * 100)}%`;
}

function showPreviewModal(mapId: string, dirty: boolean, saveFirst: () => Promise<void>): void {
  const overlay = document.createElement('div');
  overlay.className = 'mb-modal-overlay';
  overlay.innerHTML = `
    <div class="mb-modal card">
      <h2>Preview Invite</h2>
      <p class="muted-text">Invite a player by username to preview this map draft. They stay until they leave (like apartment invites).</p>
      <label class="form-field"><span class="form-label">Username</span><input id="pv-user" placeholder="player username" /></label>
      <label class="form-field"><span class="form-label">Preview as</span>
        <select id="pv-persona">
          ${(['player','high_awareness','admin','npc','spirit','familiar'] as PreviewPersona[]).map((p) =>
            `<option value="${p}">${p}</option>`).join('')}
        </select>
      </label>
      <div class="flex mt">
        <button class="btn" id="pv-send">Send Invite</button>
        <button class="btn secondary" id="pv-cancel">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#pv-cancel')!.addEventListener('click', () => overlay.remove());
  overlay.querySelector('#pv-send')!.addEventListener('click', async () => {
    const username = (document.getElementById('pv-user') as HTMLInputElement).value.trim();
    if (!username) return;
    try {
      if (dirty) await saveFirst();
      await mapBuilderApi.previewInvite(mapId, username, (document.getElementById('pv-persona') as HTMLSelectElement).value);
      overlay.remove();
      showToast(`Preview invite sent to ${username}`, 'success');
    } catch (e) {
      showToast(String(e), 'error');
    }
  });
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function inBounds(tx: number, ty: number, st: EditorState): boolean {
  return tx >= 0 && ty >= 0 && tx < st.metadata.width && ty < st.metadata.height;
}

function clampCoord(v: number, size: number): number {
  const max = Math.max(0, size - 1);
  return Math.min(max, Math.max(0, Number.isFinite(v) ? Math.floor(v) : 0));
}

function trySelectEntityAt(st: EditorState, tx: number, ty: number): boolean {
  const canPickPortal = st.mode === 'portals' || st.tool === 'portal';
  const canPickSpawn = st.mode === 'spawnpoints' || st.tool === 'spawn';
  const canPickFurniture = st.mode === 'furniture' || st.tool === 'furniture';
  const canPickDecoration = st.mode === 'decorations' || st.tool === 'decoration';
  const canPickInteraction = st.mode === 'interactions' || st.tool === 'interaction';

  if (canPickInteraction) {
    for (let i = (st.document.interactionZones ?? []).length - 1; i >= 0; i--) {
      const z = st.document.interactionZones![i]!;
      if (hitInteractionZone(z, tx, ty, placementUsesHalfTiles(st))) {
        clearEntitySelection(st);
        st.selectedInteractionZoneId = z.id;
        return true;
      }
    }
    if (st.selectedInteractionZoneId) {
      st.selectedInteractionZoneId = null;
      return true;
    }
  }

  if (canPickFurniture) {
    for (let i = st.document.placedFurniture.length - 1; i >= 0; i--) {
      const f = st.document.placedFurniture[i]!;
      if (hitFurnitureFootprint(f, st, tx, ty)) {
        clearEntitySelection(st);
        st.selectedFurnitureId = f.id;
        return true;
      }
    }
    if (st.selectedFurnitureId) {
      st.selectedFurnitureId = null;
      return true;
    }
  }
  if (canPickDecoration) {
    for (let i = st.document.placedDecorations.length - 1; i >= 0; i--) {
      const d = st.document.placedDecorations[i]!;
      if (hitDecorationFootprint(d, tx, ty)) {
        clearEntitySelection(st);
        st.selectedDecorationId = d.id;
        return true;
      }
    }
    if (st.selectedDecorationId) {
      st.selectedDecorationId = null;
      return true;
    }
  }
  if (canPickPortal) {
    const portal = st.document.portals.find((p) => p.sourceX === tx && p.sourceY === ty);
    if (portal) {
      clearEntitySelection(st);
      st.selectedPortalId = portal.id;
      return true;
    }
  }
  if (canPickSpawn) {
    const spawn = st.document.spawnpoints.find((s) => s.enabled && s.x === tx && s.y === ty);
    if (spawn) {
      clearEntitySelection(st);
      st.selectedSpawnId = spawn.id;
      return true;
    }
  }
  return false;
}

function syncSelectedCoordsInInspector(st: EditorState): void {
  const sp = st.document.spawnpoints.find((s) => s.id === st.selectedSpawnId);
  if (sp) {
    const x = document.getElementById('sp-sel-x') as HTMLInputElement | null;
    const y = document.getElementById('sp-sel-y') as HTMLInputElement | null;
    if (x) x.value = String(sp.x);
    if (y) y.value = String(sp.y);
    document.querySelectorAll(`.mb-list-item[data-id="${sp.id}"] .sp-x`).forEach((el) => { (el as HTMLInputElement).value = String(sp.x); });
    document.querySelectorAll(`.mb-list-item[data-id="${sp.id}"] .sp-y`).forEach((el) => { (el as HTMLInputElement).value = String(sp.y); });
  }
  const p = st.document.portals.find((x) => x.id === st.selectedPortalId);
  if (p) {
    const x = document.getElementById('pt-sel-x') as HTMLInputElement | null;
    const y = document.getElementById('pt-sel-y') as HTMLInputElement | null;
    if (x) x.value = String(p.sourceX);
    if (y) y.value = String(p.sourceY);
  }
  const furn = st.document.placedFurniture.find((f) => f.id === st.selectedFurnitureId);
  if (furn) {
    const x = document.getElementById('furn-sel-x') as HTMLInputElement | null;
    const y = document.getElementById('furn-sel-y') as HTMLInputElement | null;
    if (x) x.value = String(furn.x);
    if (y) y.value = String(furn.y);
  }
  const decor = st.document.placedDecorations.find((d) => d.id === st.selectedDecorationId);
  if (decor) {
    const x = document.getElementById('decor-sel-x') as HTMLInputElement | null;
    const y = document.getElementById('decor-sel-y') as HTMLInputElement | null;
    if (x) x.value = String(decor.x);
    if (y) y.value = String(decor.y);
  }
}

function clearEntitySelection(st: EditorState, opts?: { keepPortal?: boolean; keepSpawn?: boolean; keepFurniture?: boolean; keepDecoration?: boolean; keepInteraction?: boolean }): void {
  if (!opts?.keepSpawn) st.selectedSpawnId = null;
  if (!opts?.keepPortal) st.selectedPortalId = null;
  if (!opts?.keepFurniture) st.selectedFurnitureId = null;
  if (!opts?.keepDecoration) st.selectedDecorationId = null;
  if (!opts?.keepInteraction) st.selectedInteractionZoneId = null;
}

function canPlaceFootprint(st: EditorState, x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && y >= 0 && x + width <= st.metadata.width && y + height <= st.metadata.height;
}

function hitDecorationFootprint(d: PlacedDecoration, tx: number, ty: number): boolean {
  return tx >= d.x && ty >= d.y && tx < d.x + 1 && ty < d.y + 1;
}

function hitInteractionZone(z: PlacedInteractionZone, tx: number, ty: number, halfTiles: boolean): boolean {
  const probeX = halfTiles ? tx : tx + 0.5;
  const probeY = halfTiles ? ty : ty + 0.5;
  return Math.abs(z.x - probeX) < 0.51 && Math.abs(z.y - probeY) < 0.51;
}

function canvasToInteractionCenter(e: MouseEvent, st: EditorState, canvas: HTMLCanvasElement): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const ts = st.metadata.tileSize * st.zoom;
  const rawX = (e.clientX - rect.left) / ts;
  const rawY = (e.clientY - rect.top) / ts;
  if (placementUsesHalfTiles(st)) {
    return { x: snapPlacementCoord(rawX), y: snapPlacementCoord(rawY) };
  }
  return { x: Math.floor(rawX) + 0.5, y: Math.floor(rawY) + 0.5 };
}

function canvasToInteractionCenterFromTile(tx: number, ty: number, st: EditorState): { x: number; y: number } {
  if (placementUsesHalfTiles(st)) return { x: tx, y: ty };
  return { x: tx + 0.5, y: ty + 0.5 };
}

function inBoundsCenter(x: number, y: number, st: EditorState): boolean {
  return x >= 0.5 && y >= 0.5 && x <= st.metadata.width - 0.5 && y <= st.metadata.height - 0.5;
}

function clampInteractionCenter(v: number, mapSize: number, halfTiles: boolean): number {
  const min = 0.5;
  const max = mapSize - 0.5;
  const step = halfTiles ? 0.5 : 0.5;
  const snapped = Math.round(v / step) * step;
  return Math.min(max, Math.max(min, snapped));
}

function placeInteractionZoneAt(st: EditorState, x: number, y: number): void {
  if (!inBoundsCenter(x, y, st)) return;
  const type = (window as unknown as { __mbInteractionTemplate?: string }).__mbInteractionTemplate ?? 'altar';
  const id = `iz_${Date.now()}`;
  if (!st.document.interactionZones) st.document.interactionZones = [];
  st.document.interactionZones.push({
    id,
    name: interactionTypeLabel(type),
    x,
    y,
    interactionType: type,
    data: {},
  });
  clearEntitySelection(st, { keepInteraction: true });
  st.selectedInteractionZoneId = id;
}

function hitFurnitureFootprint(f: PlacedFurniture, st: EditorState, tx: number, ty: number): boolean {
  const def = st.furnitureDefs.get(f.furnitureDefId);
  const w = def?.width ?? 1;
  const h = def?.height ?? 1;
  return tx >= f.x && ty >= f.y && tx < f.x + w && ty < f.y + h;
}

function placeFurnitureAt(st: EditorState, tx: number, ty: number): void {
  const defId = (window as unknown as { __mbFurnitureTemplate?: string }).__mbFurnitureTemplate;
  if (!defId) {
    showToast('Select a furniture piece in the inspector first', 'info');
    return;
  }
  const def = st.furnitureDefs.get(defId);
  if (!def) {
    showToast('Unknown furniture definition', 'error');
    return;
  }
  if (!canPlaceFootprint(st, tx, ty, def.width, def.height)) {
    showToast('Furniture does not fit here', 'error');
    return;
  }
  const id = `furn_${Date.now()}`;
  st.document.placedFurniture.push({
    id,
    furnitureDefId: def.id,
    x: tx,
    y: ty,
    rotation: 0,
    renderLevel: DEFAULT_PLACED_RENDER_LEVEL,
  });
  clearEntitySelection(st, { keepFurniture: true });
  st.selectedFurnitureId = id;
}

function placeDecorationAt(st: EditorState, tx: number, ty: number): void {
  const defId = (window as unknown as { __mbDecorationTemplate?: string }).__mbDecorationTemplate;
  if (!defId) {
    showToast('Select a decoration in the inspector first', 'info');
    return;
  }
  const def = st.decorationDefs.get(defId);
  if (!def) {
    showToast('Unknown decoration definition', 'error');
    return;
  }
  if (!inBounds(tx, ty, st)) return;
  const id = `decor_${Date.now()}`;
  st.document.placedDecorations.push({
    id,
    decorationDefId: def.id,
    x: tx,
    y: ty,
    rotation: 0,
    renderLevel: DEFAULT_PLACED_RENDER_LEVEL,
    wallMounted: def.wallMounted,
  });
  clearEntitySelection(st, { keepDecoration: true });
  st.selectedDecorationId = id;
}

// TODO: rectangle/line tools, multi-select, move/rotate polish
// TODO: lighting/weather/audio region overlays
// TODO: autosave interval, version compare UI, publish queue approval workflow
