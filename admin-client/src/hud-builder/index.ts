import {
  HUD_ANCHORS,
  HUD_ASSET_VARIANTS,
  HUD_CATEGORIES,
  HUD_ELEMENT_CATALOG,
  HUD_RESOLUTION_PRESETS,
  HUD_STATES,
  anchorToNormalized,
  createHudElementFromCatalog,
  createDefaultHudLayout,
  resolveElementForState,
  validateHudLayout,
  combineDetection,
  strengthToState,
  visualsForStrength,
  type IntuitionPlayer,
  type IntuitionSource,
  type HudAnchor,
  type HudAssetVariant,
  type HudCatalogEntry,
  type HudCategory,
  type HudElement,
  type HudLayoutDocument,
  type HudLayoutRecord,
  type HudPositionMode,
  type HudStateId,
} from '@witchcraft/shared';
import { hudApi, type HudAssetEntry } from './api.js';

// --- module state ---------------------------------------------------------

let rootEl: HTMLElement;
let permsSet = new Set<string>();
let mode: 'list' | 'edit' = 'list';
let record: HudLayoutRecord | null = null;
let assets: HudAssetEntry[] = [];

let selectedIds: string[] = [];
let activeState: HudStateId = 'default';
let previewRes = { width: 1920, height: 1080 };
let zoom = 0.4;
let previewMode = false;
let dirty = false;
let bottomTab: 'layers' | 'bindings' | 'assets' | 'json' | 'versions' = 'layers';
let librarySearch = '';

const guides = { grid: false, safe: true, center: false, bounds: true, names: true };

const undoStack: string[] = [];
const redoStack: string[] = [];
let clipboard: { x: number; y: number; scaleX: number; scaleY: number } | null = null;

// preview simulation values (never written back to live game data)
const previewData: Record<string, string | number> = {
  'player.displayName': 'Seraphina Nightshade',
  'player.rank': 'Adept',
  'player.reputation': 'Trusted',
  'player.health.current': 72,
  'player.health.max': 100,
  'player.magic.current': 48,
  'player.magic.max': 100,
  'player.experience.current': 640,
  'player.experience.max': 1000,
  'player.currency.coins': 1240,
  'player.currency.essence': 87,
  'player.favor': 12,
  'world.time': '21:40',
  'world.moonPhase': 'Waning Gibbous',
  'world.currentLocation': 'Hollow Creek',
};

// Intuition Meter preview simulation (never written to live game data).
const intuitionSim = {
  magicActivity: 0.6,
  spiritActivity: 0.4,
  intuition: 60,
  spiritualAwareness: 55,
  distance: 0,
  detectionRadius: 1,
  concealment: 0.1,
  interference: 0.05,
  /** < 0 = auto (use detection calc); >= 0 = direct glow-strength override. */
  glowOverride: -1,
  particles: true,
  forceOverwhelming: false,
  animationScale: 1,
};

function intuitionPreviewStrength(): number {
  if (intuitionSim.forceOverwhelming) return 1;
  if (intuitionSim.glowOverride >= 0) return Math.min(1, intuitionSim.glowOverride);
  const player: IntuitionPlayer = {
    intuition: intuitionSim.intuition,
    spiritualAwareness: intuitionSim.spiritualAwareness,
    interference: intuitionSim.interference,
    statCeiling: 100,
  };
  const source: IntuitionSource = {
    magicActivity: intuitionSim.magicActivity,
    spiritActivity: intuitionSim.spiritActivity,
    distance: intuitionSim.distance,
    detectionRadius: intuitionSim.detectionRadius,
    concealment: intuitionSim.concealment,
    status: 'active',
  };
  return combineDetection([source], player);
}

function canEdit(): boolean {
  return permsSet.has('content.hud.edit');
}
function canPublish(): boolean {
  return permsSet.has('content.hud.publish');
}

function toast(msg: string, kind: 'ok' | 'err' = 'ok'): void {
  const t = document.createElement('div');
  t.className = `hud-toast ${kind}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 2600);
}

// --- entry ----------------------------------------------------------------

export async function renderHudBuilder(el: HTMLElement, permissions: string[]): Promise<void> {
  rootEl = el;
  permsSet = new Set(permissions);
  if (mode === 'edit' && record) {
    renderEditor();
  } else {
    await renderManager();
  }
}

// --- manager (layout list) ------------------------------------------------

async function renderManager(): Promise<void> {
  mode = 'list';
  rootEl.innerHTML = `<div class="muted-text">Loading HUD layouts…</div>`;
  let layouts;
  try {
    layouts = await hudApi.list(true);
  } catch (e) {
    rootEl.innerHTML = `<div class="error">Failed to load layouts: ${String(e)}</div>`;
    return;
  }
  rootEl.innerHTML = `
    <div class="hud-mgr">
      <div class="mb-header">
        <h1 class="section-title">Player HUD</h1>
        <p class="muted-text">Visually arrange every persistent HUD element, preview across resolutions, and export an engine-ready JSON layout.</p>
      </div>
      <div class="flex" style="margin-bottom:1rem;">
        ${canEdit() ? `<button class="btn" id="hud-new">+ New Layout</button>` : ''}
        ${canEdit() ? `<button class="btn secondary" id="hud-import">Import JSON</button>` : ''}
        <input type="file" id="hud-import-file" accept="application/json" style="display:none" />
      </div>
      <div class="grid" id="hud-list">
        ${layouts
          .map(
            (l) => `
          <div class="card hud-card" data-id="${l.id}">
            <div class="flex" style="justify-content:space-between;align-items:flex-start;">
              <h2 style="margin:0">${escapeHtml(l.name)}</h2>
              ${l.isActive ? `<span class="hud-badge active">● Live</span>` : `<span class="hud-badge ${l.status}">${l.status}</span>`}
            </div>
            <p class="muted-text" style="margin:.4rem 0">v${l.version} · edited ${new Date(l.updatedAt).toLocaleString()}${l.updatedBy ? ` by ${escapeHtml(l.updatedBy)}` : ''}</p>
            <div class="flex">
              <button class="btn btn-sm" data-open="${l.id}">Open</button>
              ${canEdit() ? `<button class="btn btn-sm secondary" data-dup="${l.id}">Duplicate</button>` : ''}
              ${canEdit() && l.status !== 'archived' ? `<button class="btn btn-sm secondary" data-arch="${l.id}">Archive</button>` : ''}
              ${canEdit() && l.status === 'archived' ? `<button class="btn btn-sm secondary" data-rest="${l.id}">Restore</button>` : ''}
            </div>
          </div>`
          )
          .join('') || '<p class="muted-text">No layouts yet. Create one to get started.</p>'}
      </div>
    </div>`;

  document.getElementById('hud-new')?.addEventListener('click', async () => {
    const name = prompt('Layout name?', 'New HUD Layout');
    if (!name) return;
    try {
      const rec = await hudApi.create(name);
      await openLayout(rec.metadata.id);
    } catch (e) {
      toast(String(e), 'err');
    }
  });

  const fileInput = document.getElementById('hud-import-file') as HTMLInputElement | null;
  document.getElementById('hud-import')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const doc = JSON.parse(await file.text()) as HudLayoutDocument;
      const result = await hudApi.import(doc);
      if (!result.ok) {
        showImportErrors(result.validation);
        return;
      }
      toast('Imported layout');
      if (result.record) await openLayout(result.record.metadata.id);
    } catch (e) {
      toast(`Import failed: ${String(e)}`, 'err');
    }
    fileInput.value = '';
  });

  rootEl.querySelectorAll('[data-open]').forEach((b) =>
    b.addEventListener('click', () => openLayout((b as HTMLElement).dataset.open!))
  );
  rootEl.querySelectorAll('[data-dup]').forEach((b) =>
    b.addEventListener('click', async () => {
      await hudApi.duplicate((b as HTMLElement).dataset.dup!);
      toast('Duplicated');
      void renderManager();
    })
  );
  rootEl.querySelectorAll('[data-arch]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Archive this layout?')) return;
      await hudApi.archive((b as HTMLElement).dataset.arch!);
      void renderManager();
    })
  );
  rootEl.querySelectorAll('[data-rest]').forEach((b) =>
    b.addEventListener('click', async () => {
      await hudApi.restore((b as HTMLElement).dataset.rest!);
      void renderManager();
    })
  );
}

async function openLayout(id: string): Promise<void> {
  try {
    record = await hudApi.get(id);
    assets = await hudApi.assets().catch(() => []);
    mode = 'edit';
    selectedIds = [];
    activeState = 'default';
    previewMode = false;
    dirty = false;
    undoStack.length = 0;
    redoStack.length = 0;
    previewRes = { ...record.document.baseResolution };
    ensureCatalogElements();
    fitZoom();
    renderEditor();
  } catch (e) {
    toast(`Failed to open: ${String(e)}`, 'err');
  }
}

/**
 * Ensure every built-in catalog element (e.g. the Intuition Meter) exists in the
 * layout so admins can always see and position it. Catalog elements are meant to
 * be persistent, so missing ones are appended at their default positions.
 */
function ensureCatalogElements(): void {
  if (!record) return;
  const d = record.document;
  const present = new Set(d.elements.map((e) => e.type));
  const defaults = createDefaultHudLayout();
  let added = 0;
  for (const entry of HUD_ELEMENT_CATALOG) {
    if (present.has(entry.type)) continue;
    const def = defaults.elements.find((e) => e.type === entry.type);
    const el = createHudElementFromCatalog(
      entry,
      def ? { x: def.x, y: def.y, zIndex: def.zIndex } : {},
      d.baseResolution
    );
    recomputeDerived(el);
    d.elements.push(el);
    added++;
  }
  if (added > 0) {
    dirty = true;
    toast(`Added ${added} missing HUD element${added > 1 ? 's' : ''} (e.g. Intuition Meter). Save to keep.`);
  }
}

// --- geometry helpers -----------------------------------------------------

function doc(): HudLayoutDocument {
  return record!.document;
}

function elementById(id: string): HudElement | undefined {
  return doc().elements.find((e) => e.id === id);
}

/** Effective (state-resolved) element used for display. */
function effective(el: HudElement): HudElement {
  return resolveElementForState(el, doc(), activeState) as HudElement;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function displayRect(el: HudElement, res = previewRes): Rect {
  const w = el.width * el.scaleX;
  const h = el.height * el.scaleY;
  const a = anchorToNormalized(el.anchor);
  const base = doc().baseResolution;
  if (el.positionMode === 'anchored') {
    return { x: a.x * res.width - a.x * w + el.offsetX, y: a.y * res.height - a.y * h + el.offsetY, w, h };
  }
  if (el.positionMode === 'responsive') {
    return { x: el.normalizedX * res.width, y: el.normalizedY * res.height, w, h };
  }
  // absolute — fixed pixels relative to base top-left
  return { x: el.x * (res.width / base.width), y: el.y * (res.height / base.height), w, h };
}

/** After a drag, convert a new display top-left back into stored fields. */
function applyDisplayPosition(el: HudElement, x: number, y: number, res = previewRes): void {
  const w = el.width * el.scaleX;
  const h = el.height * el.scaleY;
  const a = anchorToNormalized(el.anchor);
  const base = doc().baseResolution;

  // Awareness meter is parented to player-status in the live HUD — store relative offsets.
  if (el.type === 'awareness-meter') {
    const parent = doc().elements.find((e) => e.type === 'player-status');
    if (parent) {
      const pr = displayRect(effective(parent), res);
      const relX = pr.w > 0 ? (x - pr.x) / pr.w : 0.31;
      const relY = pr.h > 0 ? (y - pr.y) / pr.h : 0.86;
      const relW = pr.w > 0 ? w / pr.w : 0.67;
      el.metadata = {
        ...(el.metadata ?? {}),
        parentType: 'player-status',
        parentRelativeX: Math.max(0, Math.min(1.5, Number(relX.toFixed(4)))),
        parentRelativeY: Math.max(0, Math.min(1.5, Number(relY.toFixed(4)))),
        parentRelativeWidth: Math.max(0.2, Math.min(1.5, Number(relW.toFixed(4)))),
      };
    }
  }

  if (el.positionMode === 'anchored') {
    el.offsetX = Math.round(x - (a.x * res.width - a.x * w));
    el.offsetY = Math.round(y - (a.y * res.height - a.y * h));
    el.x = Math.round(a.x * base.width - a.x * w + el.offsetX);
    el.y = Math.round(a.y * base.height - a.y * h + el.offsetY);
  } else if (el.positionMode === 'responsive') {
    el.normalizedX = clamp01(x / res.width);
    el.normalizedY = clamp01(y / res.height);
    el.x = Math.round(el.normalizedX * base.width);
    el.y = Math.round(el.normalizedY * base.height);
    el.offsetX = el.x;
    el.offsetY = el.y;
  } else {
    el.x = Math.round(x * (base.width / res.width));
    el.y = Math.round(y * (base.height / res.height));
    el.offsetX = el.x;
    el.offsetY = el.y;
  }
  el.normalizedX = base.width ? el.x / base.width : 0;
  el.normalizedY = base.height ? el.y / base.height : 0;
}

/** Recompute derived offset/normalized fields from x/y (base space). */
function recomputeDerived(el: HudElement): void {
  const base = doc().baseResolution;
  const w = el.width * el.scaleX;
  const h = el.height * el.scaleY;
  const a = anchorToNormalized(el.anchor);
  el.offsetX = Math.round(el.x - (a.x * base.width - a.x * w));
  el.offsetY = Math.round(el.y - (a.y * base.height - a.y * h));
  el.normalizedX = base.width ? el.x / base.width : 0;
  el.normalizedY = base.height ? el.y / base.height : 0;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function fitZoom(): void {
  const avail = Math.max(360, (rootEl?.clientWidth ?? 1200) - 620);
  zoom = Math.min(0.85, Math.max(0.12, avail / previewRes.width));
}

// --- history --------------------------------------------------------------

function pushHistory(): void {
  if (!record) return;
  undoStack.push(JSON.stringify(record.document));
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
  dirty = true;
}

function undo(): void {
  if (!undoStack.length || !record) return;
  redoStack.push(JSON.stringify(record.document));
  record.document = JSON.parse(undoStack.pop()!) as HudLayoutDocument;
  renderEditor();
}

function redo(): void {
  if (!redoStack.length || !record) return;
  undoStack.push(JSON.stringify(record.document));
  record.document = JSON.parse(redoStack.pop()!) as HudLayoutDocument;
  renderEditor();
}

// --- editor render --------------------------------------------------------

function renderEditor(): void {
  if (!record) return;
  const d = record.document;
  rootEl.innerHTML = `
    <div class="hud-editor ${previewMode ? 'is-preview' : ''}">
      ${renderToolbar()}
      <div class="hud-workspace">
        ${previewMode ? '' : `<aside class="hud-library">${renderLibrary()}</aside>`}
        <div class="hud-canvas-host" id="hud-canvas-host">${renderCanvas()}</div>
        ${previewMode ? renderPreviewControls() : `<aside class="hud-inspector">${renderInspector()}</aside>`}
      </div>
      ${previewMode ? '' : `<div class="hud-bottom">${renderBottom()}</div>`}
    </div>`;
  void d;
  wireToolbar();
  wireCanvas();
  if (!previewMode) {
    wireLibrary();
    wireInspector();
    wireBottom();
  } else {
    wirePreviewControls();
  }
}

function renderToolbar(): string {
  const d = doc();
  return `
    <div class="hud-toolbar">
      <button class="btn btn-sm secondary" id="hud-back">← Layouts</button>
      <span class="hud-title" id="hud-name" title="Click to rename">${escapeHtml(d.name)}${dirty ? ' <em>•unsaved</em>' : ''}</span>
      <span class="hud-badge ${record!.metadata.isActive ? 'active' : record!.metadata.status}">${record!.metadata.isActive ? '● Live' : record!.metadata.status}</span>
      <div class="hud-spacer"></div>
      <label class="hud-tb-field">State
        <select id="hud-state">
          ${HUD_STATES.map((s) => `<option value="${s.id}" ${s.id === activeState ? 'selected' : ''}>${s.label}</option>`).join('')}
        </select>
      </label>
      <label class="hud-tb-field">Resolution
        <select id="hud-res">
          ${HUD_RESOLUTION_PRESETS.map(
            (p) => `<option value="${p.id}" ${p.width === previewRes.width && p.height === previewRes.height ? 'selected' : ''}>${p.label}</option>`
          ).join('')}
          <option value="custom">Custom…</option>
        </select>
      </label>
      <label class="hud-tb-field">Zoom
        <input type="range" id="hud-zoom" min="12" max="85" value="${Math.round(zoom * 100)}" />
      </label>
      <div class="hud-tb-group hud-guides">
        <label title="Pixel grid"><input type="checkbox" data-guide="grid" ${guides.grid ? 'checked' : ''}/> Grid</label>
        <label title="Safe area"><input type="checkbox" data-guide="safe" ${guides.safe ? 'checked' : ''}/> Safe</label>
        <label title="Center lines"><input type="checkbox" data-guide="center" ${guides.center ? 'checked' : ''}/> Center</label>
        <label title="Element names"><input type="checkbox" data-guide="names" ${guides.names ? 'checked' : ''}/> Names</label>
      </div>
      <div class="hud-tb-group">
        <button class="btn btn-sm secondary" id="hud-undo" ${undoStack.length ? '' : 'disabled'} title="Undo (Ctrl+Z)">↶</button>
        <button class="btn btn-sm secondary" id="hud-redo" ${redoStack.length ? '' : 'disabled'} title="Redo (Ctrl+Shift+Z)">↷</button>
      </div>
      <button class="btn btn-sm secondary" id="hud-preview">${previewMode ? 'Exit Preview' : 'Preview'}</button>
      ${!previewMode && canEdit() ? `<button class="btn btn-sm" id="hud-save" title="Save draft (Ctrl+S)">Save Draft</button>` : ''}
      ${!previewMode && canPublish() ? `<button class="btn btn-sm" id="hud-publish" style="background:var(--success)">Publish</button>` : ''}
    </div>`;
}

function renderCanvas(): string {
  const d = doc();
  const cw = Math.round(previewRes.width * zoom);
  const ch = Math.round(previewRes.height * zoom);
  const safe = d.safeArea;
  const els = [...d.elements].sort((a, b) => a.zIndex - b.zIndex);
  const grid = guides.grid
    ? `background-size:${d.settings.gridSize * zoom}px ${d.settings.gridSize * zoom}px;background-image:linear-gradient(to right,#ffffff10 1px,transparent 1px),linear-gradient(to bottom,#ffffff10 1px,transparent 1px);`
    : '';
  return `
    <div class="hud-canvas-scroll">
      <div class="hud-canvas" id="hud-canvas" style="width:${cw}px;height:${ch}px;${grid}">
        ${guides.safe ? `<div class="hud-guide-safe" style="inset:${safe.top * zoom}px ${safe.right * zoom}px ${safe.bottom * zoom}px ${safe.left * zoom}px"></div>` : ''}
        ${guides.center ? `<div class="hud-guide-vline" style="left:${cw / 2}px"></div><div class="hud-guide-hline" style="top:${ch / 2}px"></div>` : ''}
        ${els.map((el) => renderCanvasElement(el)).join('')}
      </div>
      <div class="hud-coord" id="hud-coord"></div>
    </div>`;
}

function renderCanvasElement(base: HudElement): string {
  const el = effective(base);
  if (previewMode && (!el.enabled || !el.editorVisible)) return '';
  if (!previewMode && !el.editorVisible && !selectedIds.includes(base.id)) {
    // hidden-in-editor elements render faintly so they can still be reselected via layers
  }
  const r = displayRect(el);
  const selected = selectedIds.includes(base.id);
  const variant = (el as HudElement & { assetVariant?: HudAssetVariant }).assetVariant;
  const asset = (variant && el.assets?.[variant]) || el.asset || el.assets?.default;
  const dimmed = !el.enabled ? 'is-disabled' : '';
  const hidden = !el.editorVisible ? 'is-hidden' : '';
  const style = [
    `left:${r.x * zoom}px`,
    `top:${r.y * zoom}px`,
    `width:${r.w * zoom}px`,
    `height:${r.h * zoom}px`,
    `opacity:${previewMode ? el.opacity : Math.max(0.35, el.opacity)}`,
    `transform:rotate(${el.rotation}deg)`,
    `z-index:${el.zIndex}`,
  ].join(';');
  const label = guides.names && !previewMode ? `<span class="hud-el-label">${escapeHtml(el.name)}</span>` : '';
  const composite = renderCompositeVisual(el);
  const content =
    composite ||
    (asset
      ? `<img src="${asset}" alt="" draggable="false" onerror="this.style.display='none';this.parentElement.classList.add('no-asset')" />`
      : '');
  const fallback = `<span class="hud-el-fallback">${escapeHtml(shortType(el.type))}</span>`;
  const bindingPreview = previewMode ? renderElementBindingPreview(el) : '';
  const handles =
    selected && !previewMode && !el.locked
      ? ['nw', 'ne', 'sw', 'se'].map((h) => `<span class="hud-handle ${h}" data-handle="${h}"></span>`).join('')
      : '';
  return `
    <div class="hud-el ${selected ? 'selected' : ''} ${dimmed} ${hidden} ${el.locked ? 'is-locked' : ''}"
         data-id="${base.id}" style="${style}">
      ${content}${fallback}${bindingPreview}${label}${handles}
    </div>`;
}

const NAV_ICONS = [
  'nav_bag',
  'nav_grimoire',
  'nav_spells',
  'nav_social',
  'nav_coven',
  'nav_teleport',
  'nav_map',
  'nav_settings',
];

/**
 * Some HUD elements are multi-part in game (a row of nav buttons, a counter with
 * an icon + number). Render a faithful composite so the editor mirrors the real
 * screen instead of a single stretched sprite.
 */
function renderCompositeVisual(el: HudElement): string {
  if (el.type === 'nav-buttons') {
    const btns = NAV_ICONS.map(
      (n) =>
        `<img src="/assets/hud/sprites/${n}.png" alt="" draggable="false" onerror="this.style.visibility='hidden'" />`
    ).join('');
    return `<div class="hud-el-navrow">${btns}</div>`;
  }
  return '';
}

function renderElementBindingPreview(el: HudElement): string {
  if (!el.bindings) return '';
  const parts: string[] = [];
  for (const [key, b] of Object.entries(el.bindings)) {
    const v = previewData[b.path] ?? b.fallback ?? '—';
    parts.push(`<span class="hud-bp"><b>${key}</b> ${escapeHtml(String(v))}</span>`);
  }
  return `<div class="hud-el-preview">${parts.join('')}</div>`;
}

function shortType(type: string): string {
  return type.replace(/-/g, ' ');
}

// --- library --------------------------------------------------------------

function renderLibrary(): string {
  const placed = new Set(doc().elements.map((e) => e.type));
  const q = librarySearch.toLowerCase();
  const byCat = new Map<HudCategory, HudCatalogEntry[]>();
  for (const entry of HUD_ELEMENT_CATALOG) {
    if (q && !entry.name.toLowerCase().includes(q) && !entry.type.includes(q)) continue;
    const arr = byCat.get(entry.category) ?? [];
    arr.push(entry);
    byCat.set(entry.category, arr);
  }
  const sections = HUD_CATEGORIES.filter((c) => byCat.has(c.id))
    .map((c) => {
      const items = byCat.get(c.id)!;
      return `
      <div class="hud-lib-cat">
        <div class="hud-lib-cat-head">${c.label}</div>
        ${items
          .map(
            (entry) => `
          <div class="hud-lib-item" data-type="${entry.type}" title="${escapeHtml(entry.description)}">
            <span class="hud-lib-thumb">${entry.asset ? `<img src="${entry.asset}" onerror="this.style.display='none'"/>` : '▦'}</span>
            <span class="hud-lib-info">
              <span class="hud-lib-name">${escapeHtml(entry.name)}</span>
              <span class="hud-lib-id">${entry.type}</span>
            </span>
            ${placed.has(entry.type) ? '<span class="hud-lib-placed">✓</span>' : canEdit() ? '<button class="btn btn-sm hud-add" data-add="' + entry.type + '">Add</button>' : ''}
          </div>`
          )
          .join('')}
      </div>`;
    })
    .join('');
  return `
    <div class="hud-lib-head">
      <strong>Element Library</strong>
      <input id="hud-lib-search" placeholder="Search…" value="${escapeHtml(librarySearch)}" />
    </div>
    <div class="hud-lib-list">${sections || '<p class="muted-text" style="padding:8px">No matches.</p>'}</div>
    ${canEdit() ? '<button class="btn btn-sm secondary" id="hud-add-custom" style="margin:8px;width:calc(100% - 16px)">+ Add Custom Element</button>' : ''}`;
}

// --- inspector ------------------------------------------------------------

function renderInspector(): string {
  if (selectedIds.length === 0) {
    return `<div class="hud-insp-empty"><p class="muted-text">Select an element on the canvas to edit its properties.</p></div>`;
  }
  if (selectedIds.length > 1) return renderMultiInspector();
  const el = elementById(selectedIds[0]);
  if (!el) return '<div class="hud-insp-empty">—</div>';
  const num = (label: string, field: string, value: number, step = 1) =>
    `<label class="hud-f">${label}<input type="number" step="${step}" data-prop="${field}" value="${round(value)}" /></label>`;
  return `
    <div class="hud-insp">
      <div class="hud-insp-title">
        <input class="hud-insp-name" data-prop="name" value="${escapeHtml(el.name)}" />
        <span class="hud-id-tag">${el.id}</span>
      </div>
      <div class="hud-insp-flags">
        <label><input type="checkbox" data-flag="enabled" ${el.enabled ? 'checked' : ''}/> Enabled (in game)</label>
        <label><input type="checkbox" data-flag="editorVisible" ${el.editorVisible ? 'checked' : ''}/> Visible in editor</label>
        <label><input type="checkbox" data-flag="locked" ${el.locked ? 'checked' : ''}/> Locked</label>
      </div>

      <div class="hud-insp-sec">Position</div>
      <label class="hud-f">Mode
        <select data-prop="positionMode">
          ${(['absolute', 'anchored', 'responsive'] as HudPositionMode[]).map((m) => `<option value="${m}" ${el.positionMode === m ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
      </label>
      <label class="hud-f">Anchor
        <select data-prop="anchor">
          ${HUD_ANCHORS.map((a) => `<option value="${a}" ${el.anchor === a ? 'selected' : ''}>${a}</option>`).join('')}
        </select>
      </label>
      <div class="hud-f2">${num('X', 'x', el.x)}${num('Y', 'y', el.y)}</div>
      <div class="hud-f2">${num('Offset X', 'offsetX', el.offsetX)}${num('Offset Y', 'offsetY', el.offsetY)}</div>

      <div class="hud-insp-sec">Size &amp; Scale</div>
      <div class="hud-f2">${num('Width', 'width', el.width)}${num('Height', 'height', el.height)}</div>
      <div class="hud-f2">${num('Scale X', 'scaleX', el.scaleX, 0.05)}${num('Scale Y', 'scaleY', el.scaleY, 0.05)}</div>
      <label class="hud-f-inline"><input type="checkbox" id="hud-lock-aspect" ${el.scaleX === el.scaleY ? 'checked' : ''}/> Lock aspect ratio</label>
      <label class="hud-f">Uniform scale <span id="hud-scale-pct">${Math.round(el.scaleX * 100)}%</span>
        <input type="range" id="hud-scale-slider" min="10" max="300" value="${Math.round(el.scaleX * 100)}" />
      </label>
      <div class="flex" style="gap:4px">
        <button class="btn btn-sm secondary" data-fit="width">Fit width</button>
        <button class="btn btn-sm secondary" data-fit="height">Fit height</button>
        <button class="btn btn-sm secondary" data-fit="safe">Fit safe area</button>
        <button class="btn btn-sm secondary" data-fit="reset">Reset scale</button>
      </div>

      <div class="hud-insp-sec">Appearance</div>
      <div class="hud-f2">${num('Rotation', 'rotation', el.rotation)}${num('Z-Index', 'zIndex', el.zIndex)}</div>
      <label class="hud-f">Opacity <span>${el.opacity.toFixed(2)}</span>
        <input type="range" data-prop="opacity" min="0" max="100" value="${Math.round(el.opacity * 100)}" />
      </label>

      <div class="hud-insp-sec">Layer</div>
      <div class="flex" style="gap:4px">
        <button class="btn btn-sm secondary" data-layer="front">To Front</button>
        <button class="btn btn-sm secondary" data-layer="fwd">Forward</button>
        <button class="btn btn-sm secondary" data-layer="back">Backward</button>
        <button class="btn btn-sm secondary" data-layer="bottom">To Back</button>
      </div>

      ${activeState !== 'default' ? renderStateOverrideNote(el) : ''}

      <div class="hud-insp-sec">Actions</div>
      <div class="flex" style="gap:4px">
        <button class="btn btn-sm secondary" id="hud-copy-pos">Copy pos/scale</button>
        <button class="btn btn-sm secondary" id="hud-paste-pos" ${clipboard ? '' : 'disabled'}>Paste</button>
        <button class="btn btn-sm secondary" id="hud-dup-el">Duplicate</button>
        <button class="btn btn-sm secondary" id="hud-reset-el">Reset</button>
        ${el.custom ? `<button class="btn btn-sm danger" id="hud-del-el">Delete</button>` : ''}
      </div>
    </div>`;
}

function renderStateOverrideNote(el: HudElement): string {
  const ov = doc().states[activeState]?.[el.id];
  const variant = ov?.assetVariant;
  return `
    <div class="hud-insp-sec">State override — ${activeState}</div>
    <p class="muted-text">Changes made now are stored as overrides for the <b>${activeState}</b> state only.</p>
    <label class="hud-f">Asset variant
      <select data-prop="assetVariant">
        <option value="">(inherit)</option>
        ${HUD_ASSET_VARIANTS.map((v) => `<option value="${v}" ${variant === v ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
    </label>
    ${ov ? `<button class="btn btn-sm secondary" id="hud-clear-override">Clear this state's overrides</button>` : ''}`;
}

function renderMultiInspector(): string {
  return `
    <div class="hud-insp">
      <div class="hud-insp-title"><strong>${selectedIds.length} elements selected</strong></div>
      <div class="hud-insp-sec">Align</div>
      <div class="flex" style="gap:4px">
        <button class="btn btn-sm secondary" data-align="left">Left</button>
        <button class="btn btn-sm secondary" data-align="hcenter">Center</button>
        <button class="btn btn-sm secondary" data-align="right">Right</button>
        <button class="btn btn-sm secondary" data-align="top">Top</button>
        <button class="btn btn-sm secondary" data-align="vcenter">Middle</button>
        <button class="btn btn-sm secondary" data-align="bottom">Bottom</button>
      </div>
      <div class="hud-insp-sec">Distribute &amp; Match</div>
      <div class="flex" style="gap:4px">
        <button class="btn btn-sm secondary" data-dist="h">Distribute H</button>
        <button class="btn btn-sm secondary" data-dist="v">Distribute V</button>
        <button class="btn btn-sm secondary" data-match="width">Match W</button>
        <button class="btn btn-sm secondary" data-match="height">Match H</button>
        <button class="btn btn-sm secondary" data-match="scale">Match scale</button>
      </div>
    </div>`;
}

// --- bottom panels --------------------------------------------------------

function renderBottom(): string {
  const tabs: { id: typeof bottomTab; label: string }[] = [
    { id: 'layers', label: 'Layers' },
    { id: 'bindings', label: 'Data Bindings' },
    { id: 'assets', label: 'Asset Variants' },
    { id: 'json', label: 'JSON' },
    { id: 'versions', label: 'Versions' },
  ];
  let body = '';
  if (bottomTab === 'layers') body = renderLayers();
  else if (bottomTab === 'bindings') body = renderBindings();
  else if (bottomTab === 'assets') body = renderAssetVariants();
  else if (bottomTab === 'json') body = renderJsonPanel();
  else if (bottomTab === 'versions') body = `<div id="hud-versions-body" class="hud-bottom-body">Loading…</div>`;
  return `
    <div class="hud-bottom-tabs">
      ${tabs.map((t) => `<button class="hud-bt ${t.id === bottomTab ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
    </div>
    ${body}`;
}

function renderLayers(): string {
  const els = [...doc().elements].sort((a, b) => b.zIndex - a.zIndex);
  return `<div class="hud-bottom-body"><table class="hud-layers">
    <thead><tr><th>Name</th><th>ID</th><th>Cat</th><th>Z</th><th>Enabled</th><th>Editor</th><th>Locked</th></tr></thead>
    <tbody>
    ${els
      .map(
        (el) => `<tr class="${selectedIds.includes(el.id) ? 'sel' : ''}" data-row="${el.id}">
        <td>${escapeHtml(el.name)}</td>
        <td class="muted-text">${el.id}</td>
        <td class="muted-text">${el.category}</td>
        <td>${el.zIndex}</td>
        <td><input type="checkbox" data-row-flag="enabled" data-id="${el.id}" ${el.enabled ? 'checked' : ''}/></td>
        <td><input type="checkbox" data-row-flag="editorVisible" data-id="${el.id}" ${el.editorVisible ? 'checked' : ''}/></td>
        <td><input type="checkbox" data-row-flag="locked" data-id="${el.id}" ${el.locked ? 'checked' : ''}/></td>
      </tr>`
      )
      .join('')}
    </tbody></table></div>`;
}

function renderBindings(): string {
  const el = selectedIds.length === 1 ? elementById(selectedIds[0]) : null;
  if (!el) return `<div class="hud-bottom-body"><p class="muted-text">Select a single element to edit its data bindings.</p></div>`;
  const rows = Object.entries(el.bindings ?? {});
  return `<div class="hud-bottom-body">
    <table class="hud-bindings">
      <thead><tr><th>Field</th><th>Data path</th><th>Fallback</th><th>Formatter</th><th>Preview</th><th></th></tr></thead>
      <tbody>
      ${rows
        .map(([key, b]) => {
          const val = previewData[b.path] ?? b.fallback ?? '—';
          const ok = typeof b.path === 'string' && b.path.trim().length > 0;
          return `<tr data-bkey="${key}">
            <td><input data-bfield="key" value="${escapeHtml(key)}" /></td>
            <td><input data-bfield="path" value="${escapeHtml(b.path)}" list="hud-paths" /></td>
            <td><input data-bfield="fallback" value="${escapeHtml(String(b.fallback ?? ''))}" /></td>
            <td><input data-bfield="formatter" value="${escapeHtml(b.formatter ?? '')}" placeholder="number/percent/time" /></td>
            <td class="${ok ? '' : 'hud-invalid'}">${escapeHtml(String(val))}</td>
            <td><button class="btn btn-sm danger" data-bdel="${key}">✕</button></td>
          </tr>`;
        })
        .join('')}
      </tbody>
    </table>
    <datalist id="hud-paths">${Object.keys(previewData).map((p) => `<option value="${p}"></option>`).join('')}</datalist>
    ${canEdit() ? '<button class="btn btn-sm secondary" id="hud-add-binding">+ Add binding</button>' : ''}
  </div>`;
}

function renderAssetVariants(): string {
  const el = selectedIds.length === 1 ? elementById(selectedIds[0]) : null;
  if (!el) return `<div class="hud-bottom-body"><p class="muted-text">Select a single element to assign asset variants.</p></div>`;
  return `<div class="hud-bottom-body hud-assets-grid">
    ${HUD_ASSET_VARIANTS.map((v) => {
      const path = el.assets?.[v] ?? '';
      return `<div class="hud-variant">
        <div class="hud-variant-head">${v}</div>
        <div class="hud-variant-thumb">${path ? `<img src="${path}" onerror="this.style.display='none'"/>` : '<span class="muted-text">none</span>'}</div>
        <input data-variant="${v}" value="${escapeHtml(path)}" placeholder="/assets/hud/…" list="hud-asset-list" />
      </div>`;
    }).join('')}
    <datalist id="hud-asset-list">${assets.map((a) => `<option value="${a.path}">${a.name}</option>`).join('')}</datalist>
  </div>`;
}

function renderJsonPanel(): string {
  const json = JSON.stringify(doc(), null, 2);
  return `<div class="hud-bottom-body">
    <div class="flex" style="margin-bottom:6px">
      <button class="btn btn-sm secondary" id="hud-json-copy">Copy JSON</button>
      <button class="btn btn-sm secondary" id="hud-json-download">Download JSON</button>
      <button class="btn btn-sm secondary" id="hud-json-validate">Validate</button>
      ${canEdit() ? '<button class="btn btn-sm secondary" id="hud-json-apply">Apply edits</button>' : ''}
      <span id="hud-json-status" class="muted-text"></span>
    </div>
    <textarea id="hud-json-text" class="hud-json" spellcheck="false" ${canEdit() ? '' : 'readonly'}>${escapeHtml(json)}</textarea>
  </div>`;
}

function renderEyePreview(): string {
  const s = intuitionPreviewStrength();
  const v = visualsForStrength(s);
  const state = strengthToState(s);
  const open = s < 0.15 ? 0.15 : 0.55 + 0.45 * Math.min(1, (s - 0.15) / 0.85);
  const pulse = intuitionSim.animationScale > 0 ? v.pulseDuration / intuitionSim.animationScale : 0;
  const irisSize = 90 + v.glowRadius * 2.6;
  const irisAnim = pulse > 0 ? `animation:hud-eye-pulse ${pulse.toFixed(2)}s ease-in-out infinite;` : '';
  const showParticles = intuitionSim.particles && v.particleRate > 0.1;
  const particles = showParticles
    ? Array.from({ length: Math.min(14, Math.round(v.particleRate * 0.6)) })
        .map((_, i) => {
          const left = 40 + Math.random() * 20;
          const delay = (Math.random() * 3).toFixed(2);
          const dur = (2.4 + Math.random() * 2).toFixed(2);
          const size = Math.max(2, v.particleSize * (0.7 + Math.random() * 0.7)).toFixed(1);
          return `<span class="eye-particle" style="left:${left}%;width:${size}px;height:${size}px;animation-delay:${delay}s;animation-duration:${dur}s"></span>`;
        })
        .join('')
    : '';
  return `
    <div class="hud-eye-preview" data-state="${state}"
         style="--glow-op:${v.glowOpacity.toFixed(3)};--iris-b:${v.irisBrightness.toFixed(3)};--rune-b:${v.runeBrightness.toFixed(3)};--aura-op:${v.auraOpacity.toFixed(3)};--pulse-depth:${v.pulseDepth.toFixed(3)}">
      <div class="eye-stage">
        <img src="/assets/hud/sprites/intuition_eye.png" alt="Intuition eye" draggable="false" />
        <div class="eye-runes"></div>
        <div class="eye-aura"></div>
        <div class="eye-iris" style="width:${irisSize.toFixed(0)}px;height:${irisSize.toFixed(0)}px;${irisAnim}"></div>
        <div class="eye-lid" style="opacity:${(1 - open).toFixed(3)}"></div>
        <div class="eye-particles">${particles}</div>
      </div>
      <div class="eye-readout"><strong>${state}</strong> · strength ${(s * 100).toFixed(0)}%</div>
    </div>`;
}

function simRow(key: keyof typeof intuitionSim, label: string, min: number, max: number, step: number): string {
  const val = intuitionSim[key] as number;
  return `<label class="hud-f hud-sim-row">${label}
    <input type="range" data-sim="${key}" min="${min}" max="${max}" step="${step}" value="${val}" />
    <span class="hud-sim-val" data-simval="${key}">${val}</span></label>`;
}

function renderIntuitionControls(): string {
  return `
    <div class="hud-insp hud-intuition-sim">
      <div class="hud-insp-title"><strong>Intuition Meter Preview</strong></div>
      <p class="muted-text">Simulate detection inputs. Preview-only — never writes to player data.</p>
      <div id="intuition-preview-host">${renderEyePreview()}</div>
      ${simRow('magicActivity', 'Magical activity', 0, 1, 0.01)}
      ${simRow('spiritActivity', 'Spiritual activity', 0, 1, 0.01)}
      ${simRow('intuition', 'Player Intuition', 0, 100, 1)}
      ${simRow('spiritualAwareness', 'Spiritual Awareness', 0, 100, 1)}
      ${simRow('distance', 'Distance', 0, 1, 0.01)}
      ${simRow('concealment', 'Concealment', 0, 1, 0.01)}
      ${simRow('interference', 'Environmental interference', 0, 1, 0.01)}
      ${simRow('glowOverride', 'Glow strength (−1 = auto)', -1, 1, 0.01)}
      ${simRow('animationScale', 'Animation speed', 0.25, 3, 0.05)}
      <label class="hud-f hud-sim-check"><input type="checkbox" data-sim="particles" ${intuitionSim.particles ? 'checked' : ''}/> Particles</label>
      <label class="hud-f hud-sim-check"><input type="checkbox" data-sim="forceOverwhelming" ${intuitionSim.forceOverwhelming ? 'checked' : ''}/> Force overwhelming state</label>
    </div>`;
}

function renderPreviewControls(): string {
  const fields: [string, string][] = [
    ['player.displayName', 'Player name'],
    ['player.rank', 'Rank'],
    ['player.reputation', 'Reputation'],
    ['player.health.current', 'Health'],
    ['player.magic.current', 'Magic'],
    ['player.experience.current', 'Experience'],
    ['player.currency.coins', 'Coins'],
    ['world.moonPhase', 'Moon phase'],
    ['world.time', 'Time'],
    ['world.currentLocation', 'Location'],
  ];
  return `<aside class="hud-inspector">
    <div class="hud-insp">
      <div class="hud-insp-title"><strong>Preview Simulation</strong></div>
      <p class="muted-text">Values are simulated for preview only and never touch live player data.</p>
      ${fields
        .map(
          ([path, label]) =>
            `<label class="hud-f">${label}<input data-preview="${path}" value="${escapeHtml(String(previewData[path]))}" /></label>`
        )
        .join('')}
    </div>
    ${renderIntuitionControls()}
  </aside>`;
}

// --- wiring: toolbar ------------------------------------------------------

function wireToolbar(): void {
  document.getElementById('hud-back')?.addEventListener('click', async () => {
    if (dirty && !confirm('Discard unsaved changes and return to the layout list?')) return;
    mode = 'list';
    record = null;
    await renderManager();
  });
  document.getElementById('hud-name')?.addEventListener('click', async () => {
    if (!canEdit()) return;
    const name = prompt('Rename layout', doc().name);
    if (!name) return;
    doc().name = name;
    await hudApi.rename(record!.metadata.id, name).catch((e) => toast(String(e), 'err'));
    record!.metadata.name = name;
    renderEditor();
  });
  document.getElementById('hud-state')?.addEventListener('change', (e) => {
    activeState = (e.target as HTMLSelectElement).value;
    selectedIds = [];
    renderEditor();
  });
  document.getElementById('hud-res')?.addEventListener('change', (e) => {
    const val = (e.target as HTMLSelectElement).value;
    if (val === 'custom') {
      const w = Number(prompt('Custom width', String(previewRes.width)));
      const h = Number(prompt('Custom height', String(previewRes.height)));
      if (w > 0 && h > 0) previewRes = { width: w, height: h };
    } else {
      const preset = HUD_RESOLUTION_PRESETS.find((p) => p.id === val);
      if (preset) previewRes = { width: preset.width, height: preset.height };
    }
    fitZoom();
    renderEditor();
  });
  document.getElementById('hud-zoom')?.addEventListener('input', (e) => {
    zoom = Number((e.target as HTMLInputElement).value) / 100;
    const canvas = document.getElementById('hud-canvas-host');
    if (canvas) canvas.innerHTML = renderCanvas();
    wireCanvas();
  });
  rootEl.querySelectorAll('[data-guide]').forEach((input) =>
    input.addEventListener('change', () => {
      const g = (input as HTMLElement).dataset.guide as keyof typeof guides;
      guides[g] = (input as HTMLInputElement).checked;
      const host = document.getElementById('hud-canvas-host');
      if (host) {
        host.innerHTML = renderCanvas();
        wireCanvas();
      }
    })
  );
  document.getElementById('hud-undo')?.addEventListener('click', undo);
  document.getElementById('hud-redo')?.addEventListener('click', redo);
  document.getElementById('hud-preview')?.addEventListener('click', () => {
    previewMode = !previewMode;
    renderEditor();
  });
  document.getElementById('hud-save')?.addEventListener('click', saveDraft);
  document.getElementById('hud-publish')?.addEventListener('click', publish);
}

const LIVE_CACHE_KEY = 'wc-hud-live';

function pushHudLayoutLive(doc: HudLayoutDocument): void {
  try {
    localStorage.setItem(LIVE_CACHE_KEY, JSON.stringify({ ts: Date.now(), doc }));
  } catch {
    /* ignore */
  }
}

async function saveDraft(): Promise<void> {
  if (!record) return;
  try {
    const saved = await hudApi.save(record.metadata.id, record.document);
    record.metadata = saved.metadata;
    dirty = false;
    if (saved.metadata.isActive) {
      pushHudLayoutLive(record.document);
      toast('Saved — live HUD updated');
    } else {
      toast('Draft saved (not live — Publish to apply in game)');
    }
    renderEditor();
  } catch (e) {
    toast(`Save failed: ${String(e)}`, 'err');
  }
}

async function publish(): Promise<void> {
  if (!record) return;
  const check = validateHudLayout(record.document, { strict: true });
  if (!check.valid) {
    showImportErrors(check);
    return;
  }
  if (!confirm('Publish this layout? It becomes the live HUD for all players.')) return;
  try {
    if (dirty) await hudApi.save(record.metadata.id, record.document);
    const result = await hudApi.publish(record.metadata.id);
    if (!result.ok) {
      showImportErrors(result.validation);
      return;
    }
    if (result.metadata) record.metadata = result.metadata;
    dirty = false;
    pushHudLayoutLive(record.document);
    toast('Published live — game clients will update');
    renderEditor();
  } catch (e) {
    toast(`Publish failed: ${String(e)}`, 'err');
  }
}

// --- wiring: library ------------------------------------------------------

function wireLibrary(): void {
  const search = document.getElementById('hud-lib-search') as HTMLInputElement | null;
  search?.addEventListener('input', () => {
    librarySearch = search.value;
    const lib = document.querySelector('.hud-library');
    if (lib) {
      lib.innerHTML = renderLibrary();
      wireLibrary();
    }
    search.focus();
    search.setSelectionRange(search.value.length, search.value.length);
  });
  document.querySelectorAll('[data-add]').forEach((b) =>
    b.addEventListener('click', () => addElement((b as HTMLElement).dataset.add!))
  );
  document.getElementById('hud-add-custom')?.addEventListener('click', addCustomElement);
}

function addElement(type: string): void {
  const entry = HUD_ELEMENT_CATALOG.find((e) => e.type === type);
  if (!entry) return;
  pushHistory();
  let id = type;
  let n = 2;
  while (elementById(id)) id = `${type}-${n++}`;
  const el = createHudElementFromCatalog(entry, { id }, doc().baseResolution);
  recomputeDerived(el);
  doc().elements.push(el);
  selectedIds = [id];
  renderEditor();
}

function addCustomElement(): void {
  const name = prompt('Element name?');
  if (!name) return;
  let id = prompt('Unique ID?', name.toLowerCase().replace(/[^a-z0-9]+/g, '-')) ?? '';
  id = id.trim();
  if (!id) return;
  if (elementById(id)) {
    toast('An element with that ID already exists.', 'err');
    return;
  }
  const assetPath = prompt('Asset path (optional)') ?? '';
  const width = Number(prompt('Width', '120')) || 120;
  const height = Number(prompt('Height', '120')) || 120;
  pushHistory();
  const el: HudElement = {
    id,
    type: 'custom',
    category: 'custom',
    name,
    enabled: true,
    editorVisible: true,
    locked: false,
    custom: true,
    positionMode: 'anchored',
    anchor: 'top-left',
    x: 100,
    y: 100,
    offsetX: 100,
    offsetY: 100,
    normalizedX: 100 / doc().baseResolution.width,
    normalizedY: 100 / doc().baseResolution.height,
    width,
    height,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    zIndex: 10,
    origin: { x: 0, y: 0 },
    asset: assetPath || undefined,
    assets: assetPath ? { default: assetPath } : undefined,
  };
  doc().elements.push(el);
  selectedIds = [id];
  renderEditor();
}

// --- wiring: canvas -------------------------------------------------------

function wireCanvas(): void {
  const canvas = document.getElementById('hud-canvas');
  if (!canvas) return;
  if (previewMode) return;

  canvas.querySelectorAll('.hud-el').forEach((node) => {
    const id = (node as HTMLElement).dataset.id!;
    node.addEventListener('pointerdown', (ev) => onElementPointerDown(ev as PointerEvent, id, node as HTMLElement));
  });

  canvas.addEventListener('pointerdown', (ev) => {
    if ((ev.target as HTMLElement).classList.contains('hud-canvas')) {
      selectedIds = [];
      renderEditor();
    }
  });
}

function onElementPointerDown(ev: PointerEvent, id: string, node: HTMLElement): void {
  ev.stopPropagation();
  const el = elementById(id);
  if (!el) return;

  // selection
  if (ev.shiftKey) {
    if (selectedIds.includes(id)) selectedIds = selectedIds.filter((x) => x !== id);
    else selectedIds = [...selectedIds, id];
    renderEditor();
    return;
  }
  if (!selectedIds.includes(id)) {
    selectedIds = [id];
    renderEditor();
  }
  if (el.locked) return;

  const handle = (ev.target as HTMLElement).dataset.handle;
  const target = elementById(selectedIds[0])!;
  const startRect = displayRect(effective(target));
  const startX = ev.clientX;
  const startY = ev.clientY;
  const startW = target.width;
  const startH = target.height;
  const startScaleX = target.scaleX;
  const startScaleY = target.scaleY;
  let moved = false;
  const coord = document.getElementById('hud-coord');

  pushHistory();

  const domNode = node;
  const onMove = (m: PointerEvent) => {
    const dx = (m.clientX - startX) / zoom;
    const dy = (m.clientY - startY) / zoom;
    if (Math.abs(dx) + Math.abs(dy) > 1) moved = true;
    if (handle) {
      // resize
      const uni = m.shiftKey;
      let newW = startW + (handle.includes('e') ? dx : handle.includes('w') ? -dx : 0);
      let newH = startH + (handle.includes('s') ? dy : handle.includes('n') ? -dy : 0);
      newW = Math.max(8, Math.round(newW));
      newH = Math.max(8, Math.round(newH));
      if (uni) {
        const ratio = startW / startH;
        newH = Math.round(newW / ratio);
      }
      target.width = newW;
      target.height = newH;
      domNode.style.width = `${newW * target.scaleX * zoom}px`;
      domNode.style.height = `${newH * target.scaleY * zoom}px`;
      if (coord) coord.textContent = `W ${newW} · H ${newH}`;
      void startScaleX;
      void startScaleY;
    } else {
      const nx = snap(startRect.x + dx);
      const ny = snap(startRect.y + dy);
      domNode.style.left = `${nx * zoom}px`;
      domNode.style.top = `${ny * zoom}px`;
      if (coord) coord.textContent = `X ${Math.round(nx)} · Y ${Math.round(ny)}`;
      applyDisplayPosition(target, nx, ny);
    }
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (!moved) undoStack.pop(); // no-op drag: discard history entry
    if (handle) recomputeDerived(target);
    if (activeState !== 'default' && moved) writeStateOverride(target);
    if (coord) coord.textContent = '';
    renderEditor();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function snap(v: number): number {
  const d = doc();
  if (!d.settings.snapToGrid) return v;
  const g = d.settings.gridSize;
  return Math.round(v / g) * g;
}

/** In a non-default state, capture the current geometry as a state override. */
function writeStateOverride(el: HudElement): void {
  const states = doc().states;
  states[activeState] = states[activeState] ?? {};
  states[activeState][el.id] = {
    ...states[activeState][el.id],
    x: el.x,
    y: el.y,
    offsetX: el.offsetX,
    offsetY: el.offsetY,
    normalizedX: el.normalizedX,
    normalizedY: el.normalizedY,
    width: el.width,
    height: el.height,
    scaleX: el.scaleX,
    scaleY: el.scaleY,
  };
}

// --- wiring: inspector ----------------------------------------------------

function wireInspector(): void {
  if (selectedIds.length === 1) wireSingleInspector();
  else if (selectedIds.length > 1) wireMultiInspector();
}

function wireSingleInspector(): void {
  const el = elementById(selectedIds[0]);
  if (!el) return;
  const commit = (mutate: () => void, structural = false) => {
    pushHistory();
    mutate();
    if (activeState !== 'default') writeStateOverride(el);
    if (structural) renderEditor();
    else refreshCanvasOnly();
  };

  rootEl.querySelectorAll('[data-prop]').forEach((input) => {
    const prop = (input as HTMLElement).dataset.prop!;
    input.addEventListener('change', () => {
      const target = input as HTMLInputElement | HTMLSelectElement;
      commit(() => {
        if (prop === 'name') el.name = target.value;
        else if (prop === 'anchor') {
          el.anchor = target.value as HudAnchor;
          recomputeDerived(el);
        } else if (prop === 'positionMode') {
          el.positionMode = target.value as HudPositionMode;
          recomputeDerived(el);
        } else if (prop === 'opacity') el.opacity = Number(target.value) / 100;
        else if (prop === 'assetVariant') {
          const states = doc().states;
          states[activeState] = states[activeState] ?? {};
          states[activeState][el.id] = { ...states[activeState][el.id], assetVariant: (target.value || undefined) as HudAssetVariant };
        } else {
          const v = Number(target.value);
          (el as unknown as Record<string, number>)[prop] = v;
          if (['x', 'y', 'width', 'height', 'scaleX', 'scaleY'].includes(prop)) recomputeDerived(el);
        }
      }, prop === 'anchor' || prop === 'positionMode' || prop === 'assetVariant');
    });
  });

  rootEl.querySelectorAll('[data-flag]').forEach((input) => {
    input.addEventListener('change', () => {
      const flag = (input as HTMLElement).dataset.flag as 'enabled' | 'editorVisible' | 'locked';
      commit(() => {
        el[flag] = (input as HTMLInputElement).checked;
      }, true);
    });
  });

  const slider = document.getElementById('hud-scale-slider') as HTMLInputElement | null;
  slider?.addEventListener('input', () => {
    const pct = Number(slider.value) / 100;
    const lock = (document.getElementById('hud-lock-aspect') as HTMLInputElement)?.checked;
    el.scaleX = pct;
    if (lock) el.scaleY = pct;
    (document.getElementById('hud-scale-pct')!).textContent = `${slider.value}%`;
    recomputeDerived(el);
    dirty = true;
    refreshCanvasOnly();
  });

  rootEl.querySelectorAll('[data-fit]').forEach((b) =>
    b.addEventListener('click', () => {
      const kind = (b as HTMLElement).dataset.fit!;
      commit(() => {
        const d = doc();
        if (kind === 'reset') {
          el.scaleX = 1;
          el.scaleY = 1;
        } else if (kind === 'width') {
          el.scaleX = el.scaleY = round((d.baseResolution.width - d.safeArea.left - d.safeArea.right) / el.width);
        } else if (kind === 'height') {
          el.scaleX = el.scaleY = round((d.baseResolution.height - d.safeArea.top - d.safeArea.bottom) / el.height);
        } else if (kind === 'safe') {
          const sw = (d.baseResolution.width - d.safeArea.left - d.safeArea.right) / el.width;
          const sh = (d.baseResolution.height - d.safeArea.top - d.safeArea.bottom) / el.height;
          el.scaleX = el.scaleY = round(Math.min(sw, sh));
        }
        recomputeDerived(el);
      }, true);
    })
  );

  rootEl.querySelectorAll('[data-layer]').forEach((b) =>
    b.addEventListener('click', () => {
      commit(() => changeLayer(el, (b as HTMLElement).dataset.layer!), true);
    })
  );

  document.getElementById('hud-copy-pos')?.addEventListener('click', () => {
    clipboard = { x: el.x, y: el.y, scaleX: el.scaleX, scaleY: el.scaleY };
    toast('Position & scale copied');
    renderEditor();
  });
  document.getElementById('hud-paste-pos')?.addEventListener('click', () => {
    if (!clipboard) return;
    commit(() => {
      el.x = clipboard!.x;
      el.y = clipboard!.y;
      el.scaleX = clipboard!.scaleX;
      el.scaleY = clipboard!.scaleY;
      recomputeDerived(el);
    }, true);
  });
  document.getElementById('hud-dup-el')?.addEventListener('click', () => duplicateElement(el));
  document.getElementById('hud-reset-el')?.addEventListener('click', () => resetElement(el));
  document.getElementById('hud-del-el')?.addEventListener('click', () => deleteElement(el));
  document.getElementById('hud-clear-override')?.addEventListener('click', () => {
    pushHistory();
    delete doc().states[activeState]?.[el.id];
    renderEditor();
  });
}

function wireMultiInspector(): void {
  rootEl.querySelectorAll('[data-align]').forEach((b) =>
    b.addEventListener('click', () => alignSelected((b as HTMLElement).dataset.align!))
  );
  rootEl.querySelectorAll('[data-dist]').forEach((b) =>
    b.addEventListener('click', () => distributeSelected((b as HTMLElement).dataset.dist as 'h' | 'v'))
  );
  rootEl.querySelectorAll('[data-match]').forEach((b) =>
    b.addEventListener('click', () => matchSelected((b as HTMLElement).dataset.match!))
  );
}

function changeLayer(el: HudElement, dir: string): void {
  const zs = doc().elements.map((e) => e.zIndex);
  const max = Math.max(...zs);
  const min = Math.min(...zs);
  if (dir === 'front') el.zIndex = max + 1;
  else if (dir === 'bottom') el.zIndex = min - 1;
  else if (dir === 'fwd') el.zIndex += 1;
  else if (dir === 'back') el.zIndex -= 1;
}

function duplicateElement(el: HudElement): void {
  pushHistory();
  let id = `${el.id}-copy`;
  let n = 2;
  while (elementById(id)) id = `${el.id}-copy-${n++}`;
  const copy: HudElement = JSON.parse(JSON.stringify(el));
  copy.id = id;
  copy.name = `${el.name} copy`;
  copy.custom = true;
  copy.x += 16;
  copy.y += 16;
  recomputeDerived(copy);
  doc().elements.push(copy);
  selectedIds = [id];
  renderEditor();
}

function resetElement(el: HudElement): void {
  const entry = HUD_ELEMENT_CATALOG.find((e) => e.type === el.type);
  if (!entry) {
    toast('No default to reset to for custom elements.', 'err');
    return;
  }
  pushHistory();
  const fresh = createHudElementFromCatalog(entry, { id: el.id, name: el.name }, doc().baseResolution);
  const def = createDefaultHudLayout().elements.find((e) => e.type === el.type);
  Object.assign(el, def ? { ...fresh, x: def.x, y: def.y } : fresh);
  recomputeDerived(el);
  renderEditor();
}

function deleteElement(el: HudElement): void {
  if (!confirm(`Delete element "${el.name}"?`)) return;
  pushHistory();
  doc().elements = doc().elements.filter((e) => e.id !== el.id);
  selectedIds = [];
  renderEditor();
}

function selectedElements(): HudElement[] {
  return selectedIds.map((id) => elementById(id)).filter((e): e is HudElement => !!e);
}

function alignSelected(kind: string): void {
  const els = selectedElements();
  if (els.length < 2) return;
  pushHistory();
  const rects = els.map((e) => ({ e, r: displayRect(effective(e)) }));
  const left = Math.min(...rects.map((x) => x.r.x));
  const right = Math.max(...rects.map((x) => x.r.x + x.r.w));
  const top = Math.min(...rects.map((x) => x.r.y));
  const bottom = Math.max(...rects.map((x) => x.r.y + x.r.h));
  for (const { e, r } of rects) {
    let nx = r.x;
    let ny = r.y;
    if (kind === 'left') nx = left;
    else if (kind === 'right') nx = right - r.w;
    else if (kind === 'hcenter') nx = (left + right) / 2 - r.w / 2;
    else if (kind === 'top') ny = top;
    else if (kind === 'bottom') ny = bottom - r.h;
    else if (kind === 'vcenter') ny = (top + bottom) / 2 - r.h / 2;
    applyDisplayPosition(e, nx, ny);
  }
  renderEditor();
}

function distributeSelected(axis: 'h' | 'v'): void {
  const els = selectedElements();
  if (els.length < 3) return;
  pushHistory();
  const rects = els.map((e) => ({ e, r: displayRect(effective(e)) }));
  rects.sort((a, b) => (axis === 'h' ? a.r.x - b.r.x : a.r.y - b.r.y));
  const first = rects[0].r;
  const last = rects[rects.length - 1].r;
  const startC = axis === 'h' ? first.x + first.w / 2 : first.y + first.h / 2;
  const endC = axis === 'h' ? last.x + last.w / 2 : last.y + last.h / 2;
  const step = (endC - startC) / (rects.length - 1);
  rects.forEach(({ e, r }, i) => {
    const c = startC + step * i;
    if (axis === 'h') applyDisplayPosition(e, c - r.w / 2, r.y);
    else applyDisplayPosition(e, r.x, c - r.h / 2);
  });
  renderEditor();
}

function matchSelected(kind: string): void {
  const els = selectedElements();
  if (els.length < 2) return;
  pushHistory();
  const ref = els[0];
  for (const e of els.slice(1)) {
    if (kind === 'width') e.width = ref.width;
    else if (kind === 'height') e.height = ref.height;
    else if (kind === 'scale') {
      e.scaleX = ref.scaleX;
      e.scaleY = ref.scaleY;
    }
    recomputeDerived(e);
  }
  renderEditor();
}

function refreshCanvasOnly(): void {
  dirty = true;
  const host = document.getElementById('hud-canvas-host');
  if (host) {
    host.innerHTML = renderCanvas();
    wireCanvas();
  }
}

// --- wiring: bottom -------------------------------------------------------

function wireBottom(): void {
  rootEl.querySelectorAll('.hud-bt').forEach((b) =>
    b.addEventListener('click', () => {
      bottomTab = (b as HTMLElement).dataset.tab as typeof bottomTab;
      const bottom = document.querySelector('.hud-bottom');
      if (bottom) {
        bottom.innerHTML = renderBottom();
        wireBottom();
        if (bottomTab === 'versions') void loadVersions();
      }
    })
  );

  if (bottomTab === 'layers') wireLayers();
  else if (bottomTab === 'bindings') wireBindings();
  else if (bottomTab === 'assets') wireAssetVariants();
  else if (bottomTab === 'json') wireJson();
  else if (bottomTab === 'versions') void loadVersions();
}

function wireLayers(): void {
  rootEl.querySelectorAll('[data-row]').forEach((row) =>
    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      const id = (row as HTMLElement).dataset.row!;
      selectedIds = (e as MouseEvent).shiftKey ? [...new Set([...selectedIds, id])] : [id];
      renderEditor();
    })
  );
  rootEl.querySelectorAll('[data-row-flag]').forEach((input) =>
    input.addEventListener('change', () => {
      const flag = (input as HTMLElement).dataset.rowFlag as 'enabled' | 'editorVisible' | 'locked';
      const id = (input as HTMLElement).dataset.id!;
      const el = elementById(id);
      if (!el) return;
      pushHistory();
      el[flag] = (input as HTMLInputElement).checked;
      renderEditor();
    })
  );
}

function wireBindings(): void {
  const el = selectedIds.length === 1 ? elementById(selectedIds[0]) : null;
  if (!el) return;
  document.getElementById('hud-add-binding')?.addEventListener('click', () => {
    pushHistory();
    el.bindings = el.bindings ?? {};
    let key = 'field';
    let n = 2;
    while (el.bindings[key]) key = `field${n++}`;
    el.bindings[key] = { path: '' };
    renderEditor();
  });
  rootEl.querySelectorAll('[data-bkey]').forEach((row) => {
    const key = (row as HTMLElement).dataset.bkey!;
    row.querySelectorAll('[data-bfield]').forEach((input) =>
      input.addEventListener('change', () => {
        const field = (input as HTMLElement).dataset.bfield!;
        const val = (input as HTMLInputElement).value;
        pushHistory();
        el.bindings = el.bindings ?? {};
        const b = el.bindings[key] ?? { path: '' };
        if (field === 'key') {
          delete el.bindings[key];
          el.bindings[val || key] = b;
        } else if (field === 'path') b.path = val;
        else if (field === 'fallback') b.fallback = val;
        else if (field === 'formatter') b.formatter = val || undefined;
        if (field !== 'key') el.bindings[key] = b;
        const bottom = document.querySelector('.hud-bottom');
        if (bottom) {
          bottom.innerHTML = renderBottom();
          wireBottom();
        }
      })
    );
    row.querySelector('[data-bdel]')?.addEventListener('click', () => {
      pushHistory();
      delete el.bindings?.[key];
      const bottom = document.querySelector('.hud-bottom');
      if (bottom) {
        bottom.innerHTML = renderBottom();
        wireBottom();
      }
    });
  });
}

function wireAssetVariants(): void {
  const el = selectedIds.length === 1 ? elementById(selectedIds[0]) : null;
  if (!el) return;
  rootEl.querySelectorAll('[data-variant]').forEach((input) =>
    input.addEventListener('change', () => {
      const v = (input as HTMLElement).dataset.variant as HudAssetVariant;
      const val = (input as HTMLInputElement).value.trim();
      pushHistory();
      el.assets = el.assets ?? {};
      if (val) el.assets[v] = val;
      else delete el.assets[v];
      if (v === 'default') el.asset = val || undefined;
      const bottom = document.querySelector('.hud-bottom');
      if (bottom) {
        bottom.innerHTML = renderBottom();
        wireBottom();
      }
      refreshCanvasOnly();
    })
  );
}

function wireJson(): void {
  document.getElementById('hud-json-copy')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(JSON.stringify(doc(), null, 2));
    toast('JSON copied');
  });
  document.getElementById('hud-json-download')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(doc(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${doc().layoutId}.hud.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  document.getElementById('hud-json-validate')?.addEventListener('click', () => {
    const result = validateHudLayout(doc(), { strict: true });
    const status = document.getElementById('hud-json-status')!;
    if (result.valid) {
      status.textContent = `Valid${result.warnings.length ? ` · ${result.warnings.length} warning(s)` : ''}`;
      status.className = 'muted-text';
    } else {
      status.textContent = `${result.errors.length} error(s)`;
      status.style.color = 'var(--danger)';
      showImportErrors(result);
    }
  });
  document.getElementById('hud-json-apply')?.addEventListener('click', () => {
    const text = (document.getElementById('hud-json-text') as HTMLTextAreaElement).value;
    try {
      const parsed = JSON.parse(text) as HudLayoutDocument;
      const result = validateHudLayout(parsed, { strict: false });
      if (!result.valid) {
        showImportErrors(result);
        return;
      }
      pushHistory();
      record!.document = parsed;
      selectedIds = [];
      renderEditor();
      toast('JSON applied');
    } catch (e) {
      toast(`Invalid JSON: ${String(e)}`, 'err');
    }
  });
}

async function loadVersions(): Promise<void> {
  const body = document.getElementById('hud-versions-body');
  if (!body || !record) return;
  try {
    const versions = await hudApi.versions(record.metadata.id);
    body.innerHTML = `<table class="hud-versions">
      <thead><tr><th>Version</th><th>Changelog</th><th>By</th><th>When</th><th></th></tr></thead>
      <tbody>${versions
        .map(
          (v) => `<tr><td>v${v.version}</td><td>${escapeHtml(v.changelog ?? '')}</td><td>${escapeHtml(v.createdBy ?? '')}</td>
        <td>${new Date(v.createdAt).toLocaleString()}</td>
        <td>${canEdit() ? `<button class="btn btn-sm secondary" data-restore="${v.id}">Restore</button>` : ''}</td></tr>`
        )
        .join('')}</tbody></table>`;
    body.querySelectorAll('[data-restore]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('Restore this version as a new draft?')) return;
        const restored = await hudApi.restoreVersion(record!.metadata.id, (b as HTMLElement).dataset.restore!);
        record = restored;
        dirty = false;
        toast('Version restored');
        renderEditor();
      })
    );
  } catch (e) {
    body.innerHTML = `<div class="error">${String(e)}</div>`;
  }
}

function wirePreviewControls(): void {
  rootEl.querySelectorAll('[data-preview]').forEach((input) =>
    input.addEventListener('input', () => {
      const path = (input as HTMLElement).dataset.preview!;
      const raw = (input as HTMLInputElement).value;
      previewData[path] = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
      const host = document.getElementById('hud-canvas-host');
      if (host) host.innerHTML = renderCanvas();
    })
  );

  const refreshEye = (): void => {
    const host = document.getElementById('intuition-preview-host');
    if (host) host.innerHTML = renderEyePreview();
  };
  rootEl.querySelectorAll('[data-sim]').forEach((input) =>
    input.addEventListener('input', () => {
      const el = input as HTMLInputElement;
      const key = el.dataset.sim as keyof typeof intuitionSim;
      if (el.type === 'checkbox') {
        (intuitionSim[key] as boolean) = el.checked;
      } else {
        (intuitionSim[key] as number) = Number(el.value);
        const label = rootEl.querySelector(`[data-simval="${key}"]`);
        if (label) label.textContent = el.value;
      }
      refreshEye();
    })
  );
}

// --- keyboard shortcuts ---------------------------------------------------

function onKeyDown(e: KeyboardEvent): void {
  if (mode !== 'edit' || !record) return;
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const meta = e.ctrlKey || e.metaKey;

  if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
    return;
  }
  if (meta && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
    e.preventDefault();
    redo();
    return;
  }
  if (meta && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (canEdit()) void saveDraft();
    return;
  }
  if (meta && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    const el = elementById(selectedIds[0]);
    if (el) duplicateElement(el);
    return;
  }
  if (!selectedIds.length) return;
  const el = elementById(selectedIds[0]);
  if (!el) return;

  if (e.key === 'Delete') {
    if (el.custom) deleteElement(el);
    return;
  }
  if (e.key.toLowerCase() === 'l') {
    pushHistory();
    el.locked = !el.locked;
    renderEditor();
    return;
  }
  if (e.key.toLowerCase() === 'h') {
    pushHistory();
    el.editorVisible = !el.editorVisible;
    renderEditor();
    return;
  }
  const arrows: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  if (arrows[e.key]) {
    e.preventDefault();
    if (el.locked) return;
    pushHistory();
    const stepMul = e.shiftKey ? doc().settings.nudgeStep : 1;
    const [dx, dy] = arrows[e.key];
    const r = displayRect(effective(el));
    applyDisplayPosition(el, r.x + dx * stepMul, r.y + dy * stepMul);
    if (activeState !== 'default') writeStateOverride(el);
    refreshCanvasOnly();
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', onKeyDown);
}

// --- misc -----------------------------------------------------------------

function showImportErrors(validation?: { errors: { message: string; elementId?: string }[]; warnings: { message: string }[] }): void {
  if (!validation) {
    toast('Validation failed', 'err');
    return;
  }
  const lines = [
    ...validation.errors.map((x) => `✕ ${x.elementId ? `[${x.elementId}] ` : ''}${x.message}`),
    ...validation.warnings.map((x) => `⚠ ${x.message}`),
  ];
  alert(`Layout issues:\n\n${lines.join('\n')}`);
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
