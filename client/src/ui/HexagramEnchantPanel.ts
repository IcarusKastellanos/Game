import Phaser from 'phaser';
import type {
  ContentHexagramRecipe,
  HexagramCategory,
  HexagramSocketId,
  HexagramPreviewStats,
  ItemCategory,
} from '@witchcraft/shared';
import {
  HEXAGRAM_CATEGORIES,
  HEXAGRAM_CATEGORY_LABELS,
  HEXAGRAM_SOCKET_IDS,
  HEXAGRAM_SOCKET_LABELS,
  calculateHexagramPreview,
  hexagramSocketPositions,
  socketAcceptsItem,
  totalItemQuantity,
  playerLevel,
  meetsMinLevel,
} from '@witchcraft/shared';
import { gameState } from '../data/game-state';
import { network } from '../net/NetworkManager';
import { iconImgHtml } from '../graphics/ItemIconGenerator';
import { bindDomInputs } from './input-focus';

type HexRecipeRow = Pick<
  ContentHexagramRecipe,
  | 'id'
  | 'name'
  | 'category'
  | 'description'
  | 'declarationTemplates'
  | 'difficulty'
  | 'meCost'
  | 'powerTier'
  | 'preparedUses'
  | 'activationMethod'
  | 'durationLabel'
  | 'requiredSkill'
  | 'sockets'
  | 'augmentations'
  | 'effect'
  | 'spellId'
  | 'visualTheme'
  | 'minLevel'
>;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  hue: number;
}

const CANVAS = { w: 520, h: 480 };
const THEME_COLORS: Record<string, { stroke: string; glow: string; particle: number }> = {
  protection: { stroke: '#88bbff', glow: '#4466aa', particle: 210 },
  binding: { stroke: '#aa88ff', glow: '#664488', particle: 270 },
  spirit: { stroke: '#bbaacc', glow: '#887799', particle: 280 },
  healing: { stroke: '#ffcc66', glow: '#aa8844', particle: 45 },
  baneful: { stroke: '#cc4444', glow: '#882222', particle: 0 },
  dream: { stroke: '#8899cc', glow: '#556688', particle: 240 },
  neutral: { stroke: '#ccaa88', glow: '#886644', particle: 35 },
};

/** Ceremonial hexagram enchanting — stored enchantments at the enchanting table */
export class HexagramEnchantPanel {
  private root!: HTMLDivElement;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private visible = false;
  private recipes: HexRecipeRow[] = [];
  private selectedId: string | null = null;
  private categoryTab: HexagramCategory | 'all' = 'all';
  private sockets: Partial<Record<HexagramSocketId, string>> = {};
  private augmentations: string[] = [];
  private declaration = '';
  private search = '';
  private categoryFilter = '';
  private favorites = new Set<string>();
  private dragItemId: string | null = null;
  private animFrame = 0;
  private phase = 0;
  private ritualActive = false;
  private ritualPhase = 0;
  private particles: Particle[] = [];
  private rafId = 0;
  private boundResult?: (e: Event) => void;

  constructor(_scene: Phaser.Scene) {
    this.build();
    this.boundResult = (e: Event) => this.onResult(e as CustomEvent);
    window.addEventListener('game:hexagram-result', this.boundResult);
  }

  private ing(itemId: string) {
    return gameState.content?.ingredients.find((i) => i.id === itemId);
  }

  private selectedRecipe(): HexRecipeRow | null {
    return this.recipes.find((r) => r.id === this.selectedId) ?? null;
  }

  private itemCategories(): Record<string, ItemCategory | undefined> {
    const map: Record<string, ItemCategory | undefined> = {};
    for (const i of gameState.content?.ingredients ?? []) {
      map[i.id] = i.category as ItemCategory;
    }
    return map;
  }

  private getHeld(): Map<string, number> {
    const held = new Map<string, number>();
    for (const id of Object.values(this.sockets)) {
      if (id) held.set(id, (held.get(id) ?? 0) + 1);
    }
    for (const id of this.augmentations) held.set(id, (held.get(id) ?? 0) + 1);
    return held;
  }

  private availableQty(itemId: string): number {
    const total = totalItemQuantity(gameState.localPlayer?.inventory ?? [], itemId);
    return total - (this.getHeld().get(itemId) ?? 0);
  }

  private playerStats(): Record<string, number> {
    try {
      return JSON.parse(gameState.localPlayer?.statsJson ?? '{}') as Record<string, number>;
    } catch {
      return {};
    }
  }

  private preview(): HexagramPreviewStats | null {
    const recipe = this.selectedRecipe();
    if (!recipe) return null;
    return calculateHexagramPreview(
      recipe as ContentHexagramRecipe,
      this.sockets,
      this.augmentations,
      this.itemCategories(),
      this.playerStats()
    );
  }

  private build(): void {
    this.root = document.createElement('div');
    this.root.id = 'hexagram-panel';
    this.root.innerHTML = `
      <div class="hex-backdrop"></div>
      <div class="hex-shell">
        <header class="hex-header">
          <h2>Hexagram Enchanting</h2>
          <p class="hex-sub">Prepare stored workings — pocket spells, knots, and charms</p>
          <button type="button" class="hex-close" title="Close (Esc)">✕</button>
        </header>
        <nav class="hex-tabs" id="hex-tabs"></nav>
        <div class="hex-body">
          <aside class="hex-inventory" id="hex-inventory"></aside>
          <main class="hex-center">
            <canvas id="hex-canvas" width="${CANVAS.w}" height="${CANVAS.h}"></canvas>
            <div class="hex-recipe-picker" id="hex-recipe-picker"></div>
            <div class="hex-actions">
              <button type="button" class="hex-btn secondary" id="hex-clear">Clear Hexagram</button>
              <button type="button" class="hex-btn secondary" id="hex-undo">Undo</button>
              <button type="button" class="hex-btn primary" id="hex-begin" disabled>Begin Enchantment</button>
            </div>
          </main>
          <aside class="hex-info" id="hex-info"></aside>
        </div>
      </div>`;
    document.body.appendChild(this.root);
    this.canvas = this.root.querySelector('#hex-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    bindDomInputs(this.root);

    this.root.querySelector('.hex-close')!.addEventListener('click', () => this.hide());
    this.root.querySelector('#hex-clear')!.addEventListener('click', () => this.clearHexagram());
    this.root.querySelector('#hex-undo')!.addEventListener('click', () => this.undo());
    this.root.querySelector('#hex-begin')!.addEventListener('click', () => this.beginEnchantment());

    this.canvas.addEventListener('dragover', (e) => e.preventDefault());
    this.canvas.addEventListener('drop', (e) => this.onCanvasDrop(e));
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const sock = this.hitSocket(e.offsetX, e.offsetY);
      if (sock && this.sockets[sock]) {
        delete this.sockets[sock];
        this.render();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (!this.visible) return;
      if (e.key === 'Escape') this.hide();
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.undo();
      }
    });
  }

  show(recipes: HexRecipeRow[]): void {
    this.recipes = recipes;
    this.visible = true;
    this.ritualActive = false;
    this.ritualPhase = 0;
    if (!this.selectedId || !recipes.some((r) => r.id === this.selectedId)) {
      this.selectedId = recipes[0]?.id ?? null;
    }
    const recipe = this.selectedRecipe();
    if (recipe && !this.declaration) {
      this.declaration = recipe.declarationTemplates[0] ?? '';
    }
    this.root.style.display = 'block';
    gameState.activeUI = 'hexagram';
    this.render();
    this.startAnim();
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
    this.stopAnim();
    if (gameState.activeUI === 'hexagram') gameState.activeUI = 'none';
  }

  private startAnim(): void {
    this.stopAnim();
    const tick = () => {
      if (!this.visible) return;
      this.phase += this.ritualActive ? 0.04 : 0.012;
      this.drawHexagram();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopAnim(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private onResult(e: CustomEvent<{ success: boolean; unstable?: boolean; message: string }>): void {
    if (!this.visible) return;
    void e.detail;
    // Ingredients are always spent on the server once the working fires — clear the hexagon either way.
    this.resetHexagramBoard();
    this.render();
  }

  private getPlayerExperience(): number {
    try {
      const stats = JSON.parse(gameState.localPlayer?.statsJson ?? '{}');
      return Number(stats.experience) || 0;
    } catch {
      return 0;
    }
  }

  private isRecipeUnlocked(recipe: HexRecipeRow): boolean {
    return meetsMinLevel(this.getPlayerExperience(), recipe.minLevel);
  }

  private filteredRecipes(): HexRecipeRow[] {
    return this.recipes.filter((r) => {
      if (this.categoryTab !== 'all' && r.category !== this.categoryTab) return false;
      return true;
    });
  }

  private inventoryItems(): { itemId: string; qty: number }[] {
    const inv = gameState.localPlayer?.inventory ?? [];
    const seen = new Map<string, number>();
    for (const slot of inv) {
      if (!slot?.itemId || slot.quantity <= 0) continue;
      seen.set(slot.itemId, (seen.get(slot.itemId) ?? 0) + slot.quantity);
    }
    const held = this.getHeld();
    const rows: { itemId: string; qty: number }[] = [];
    for (const [itemId, total] of seen) {
      const avail = total - (held.get(itemId) ?? 0);
      if (avail <= 0) continue;
      if (this.search) {
        const ing = this.ing(itemId);
        const q = this.search.toLowerCase();
        if (!itemId.includes(q) && !ing?.name.toLowerCase().includes(q)) continue;
      }
      if (this.categoryFilter && this.ing(itemId)?.category !== this.categoryFilter) continue;
      rows.push({ itemId, qty: avail });
    }
    rows.sort((a, b) => {
      const fa = this.favorites.has(a.itemId) ? 0 : 1;
      const fb = this.favorites.has(b.itemId) ? 0 : 1;
      if (fa !== fb) return fa - fb;
      return (this.ing(a.itemId)?.name ?? a.itemId).localeCompare(this.ing(b.itemId)?.name ?? b.itemId);
    });
    return rows;
  }

  private render(): void {
    this.renderTabs();
    this.renderInventory();
    this.renderRecipePicker();
    this.renderInfo();
    const prev = this.preview();
    const btn = this.root.querySelector('#hex-begin') as HTMLButtonElement;
    btn.disabled = !prev?.complete || this.ritualActive;
    this.drawHexagram();
  }

  private renderTabs(): void {
    const el = this.root.querySelector('#hex-tabs')!;
    const tabs: (HexagramCategory | 'all')[] = ['all', ...HEXAGRAM_CATEGORIES];
    el.innerHTML = tabs
      .map((t) => {
        const label = t === 'all' ? 'All' : HEXAGRAM_CATEGORY_LABELS[t];
        const active = t === this.categoryTab ? ' active' : '';
        return `<button type="button" class="hex-tab${active}" data-cat="${t}">${label}</button>`;
      })
      .join('');
    el.querySelectorAll('.hex-tab').forEach((b) => {
      b.addEventListener('click', () => {
        this.categoryTab = (b as HTMLElement).dataset.cat as HexagramCategory | 'all';
        const list = this.filteredRecipes();
        if (this.selectedId && !list.some((r) => r.id === this.selectedId)) {
          this.selectedId = list[0]?.id ?? null;
        }
        this.render();
      });
    });
  }

  private renderInventory(): void {
    const el = this.root.querySelector('#hex-inventory')!;
    const items = this.inventoryItems();
    el.innerHTML = `
      <h3>Magical Inventory</h3>
      <input type="search" class="hex-search" id="hex-search" placeholder="Search ingredients…" value="${this.escape(this.search)}" />
      <select class="hex-filter" id="hex-cat-filter">
        <option value="">All categories</option>
        ${[...new Set((gameState.content?.ingredients ?? []).map((i) => i.category))].sort().map((c) =>
          `<option value="${c}" ${c === this.categoryFilter ? 'selected' : ''}>${c}</option>`
        ).join('')}
      </select>
      <div class="hex-inv-grid">${items.map(({ itemId, qty }) => {
        const ing = this.ing(itemId);
        const fav = this.favorites.has(itemId);
        return `<div class="hex-inv-card ${fav ? 'fav' : ''}" draggable="true" data-item="${itemId}" title="${this.escape(ing?.name ?? itemId)}">
          ${iconImgHtml(itemId, ing?.category, ing?.name, 32, ing?.iconPixels)}
          <span class="hex-inv-qty">${qty}</span>
          <span class="hex-inv-name">${this.escape(ing?.name ?? itemId)}</span>
          <button type="button" class="hex-fav-btn" data-fav="${itemId}" title="Favorite">${fav ? '★' : '☆'}</button>
        </div>`;
      }).join('') || '<p class="hex-empty">No ingredients available.</p>'}
      </div>
      <h4 class="hex-aug-title">Augmentations</h4>
      <div class="hex-aug-list" id="hex-aug-list"></div>`;

    const searchEl = el.querySelector('#hex-search') as HTMLInputElement;
    searchEl.oninput = () => { this.search = searchEl.value; this.renderInventory(); };
    const filterEl = el.querySelector('#hex-cat-filter') as HTMLSelectElement;
    filterEl.onchange = () => { this.categoryFilter = filterEl.value; this.renderInventory(); };

    el.querySelectorAll('.hex-inv-card').forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        this.dragItemId = (card as HTMLElement).dataset.item ?? null;
        (e as DragEvent).dataTransfer?.setData('text/plain', this.dragItemId ?? '');
      });
      card.addEventListener('dblclick', () => {
        const itemId = (card as HTMLElement).dataset.item!;
        this.tryAutoPlace(itemId);
      });
    });
    el.querySelectorAll('.hex-fav-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.fav!;
        if (this.favorites.has(id)) this.favorites.delete(id);
        else this.favorites.add(id);
        this.renderInventory();
      });
    });

    const augEl = el.querySelector('#hex-aug-list')!;
    const recipe = this.selectedRecipe();
    const compatible = recipe?.augmentations?.map((a) => a.itemId) ?? [];
    augEl.innerHTML = compatible.length
      ? compatible.map((itemId) => {
          const active = this.augmentations.includes(itemId);
          const ing = this.ing(itemId);
          const can = this.availableQty(itemId) > 0 || active;
          return `<button type="button" class="hex-aug-chip ${active ? 'on' : ''} ${can ? '' : 'disabled'}" data-aug="${itemId}">
            ${iconImgHtml(itemId, ing?.category, ing?.name, 20, ing?.iconPixels)}
            <span>${this.escape(ing?.name ?? itemId)}</span>
          </button>`;
        }).join('')
      : '<p class="hex-empty">No augmentations for this working.</p>';
    augEl.querySelectorAll('.hex-aug-chip:not(.disabled)').forEach((chip) => {
      chip.addEventListener('click', () => {
        const id = (chip as HTMLElement).dataset.aug!;
        const idx = this.augmentations.indexOf(id);
        if (idx >= 0) this.augmentations.splice(idx, 1);
        else if (this.availableQty(id) > 0) this.augmentations.push(id);
        this.render();
      });
    });
  }

  private renderRecipePicker(): void {
    const el = this.root.querySelector('#hex-recipe-picker')!;
    const list = this.filteredRecipes();
    const level = playerLevel(this.getPlayerExperience());
    if (this.selectedId) {
      const current = list.find((r) => r.id === this.selectedId);
      if (current && !this.isRecipeUnlocked(current)) this.selectedId = null;
    }
    if (!this.selectedId) {
      this.selectedId = list.find((r) => this.isRecipeUnlocked(r))?.id ?? null;
    }
    el.innerHTML = `
      <label>Enchantment
        <select id="hex-recipe-select">${list.map((r) => {
          const unlocked = this.isRecipeUnlocked(r);
          const need = r.minLevel ?? 1;
          const label = unlocked
            ? this.escape(r.name)
            : `${this.escape(r.name)} — Level ${need} (you are ${level})`;
          return `<option value="${r.id}" ${r.id === this.selectedId ? 'selected' : ''} ${unlocked ? '' : 'disabled'}>${label}</option>`;
        }).join('')}</select>
      </label>`;
    const sel = el.querySelector('#hex-recipe-select') as HTMLSelectElement;
    sel.onchange = () => {
      const recipe = list.find((r) => r.id === sel.value);
      if (recipe && !this.isRecipeUnlocked(recipe)) {
        sel.value = this.selectedId ?? '';
        return;
      }
      this.selectedId = sel.value;
      const next = this.selectedRecipe();
      this.declaration = next?.declarationTemplates[0] ?? '';
      this.clearHexagram(false);
      this.render();
    };
  }

  private formatSocketRequirement(req: HexRecipeRow['sockets'][number]): string {
    const parts: string[] = [];
    if (req.itemIds?.length) {
      for (const id of req.itemIds) {
        parts.push(this.ing(id)?.name ?? id);
      }
    }
    if (req.categories?.length) {
      parts.push(`any ${req.categories.join(' / ')}`);
    }
    return parts.join(' · ') || '—';
  }

  private requirementIcons(req: HexRecipeRow['sockets'][number]): string {
    const ids = req.itemIds ?? [];
    if (!ids.length) return '';
    return ids
      .slice(0, 3)
      .map((id) => {
        const ing = this.ing(id);
        return iconImgHtml(id, ing?.category, ing?.name, 22, ing?.iconPixels);
      })
      .join('');
  }

  private renderInfo(): void {
    const el = this.root.querySelector('#hex-info')!;
    const recipe = this.selectedRecipe();
    const prev = this.preview();
    if (!recipe) {
      el.innerHTML = '<p class="hex-empty">No enchantments known.</p>';
      return;
    }
    const reqGuide = recipe.sockets.map((s) => {
      const placed = this.sockets[s.socket];
      const ing = placed ? this.ing(placed) : null;
      const ok = placed && socketAcceptsItem(s, placed, this.itemCategories()[placed]);
      const status = !placed ? 'pending' : ok ? 'ok' : 'bad';
      return `<li class="hex-req-row ${status}">
        <div class="hex-req-head">
          <span class="hex-req-socket">${HEXAGRAM_SOCKET_LABELS[s.socket]}</span>
          ${s.label ? `<em class="hex-req-flavor">${this.escape(s.label)}</em>` : ''}
        </div>
        <div class="hex-req-needs">${this.requirementIcons(s)}<span>${this.escape(this.formatSocketRequirement(s))}</span></div>
        <div class="hex-req-placed">${placed
          ? `${ok ? '✓' : '✗'} Placed: ${this.escape(ing?.name ?? placed)}`
          : '— not yet placed —'}</div>
      </li>`;
    }).join('');

    const augGuide = (recipe.augmentations ?? []).length
      ? `<h4>Optional Augmentations</h4>
        <ul class="hex-aug-guide">${(recipe.augmentations ?? []).map((a) => {
          const ing = this.ing(a.itemId);
          const active = this.augmentations.includes(a.itemId);
          const bits = [
            a.power ? `+power` : '',
            a.stability ? `+stability` : '',
            a.potency ? `+potency` : '',
            a.duration ? `+duration` : '',
            a.backlash ? `${a.backlash} backlash` : '',
          ].filter(Boolean).join(', ');
          return `<li class="${active ? 'on' : ''}">${iconImgHtml(a.itemId, ing?.category, ing?.name, 18, ing?.iconPixels)}
            <span>${this.escape(ing?.name ?? a.itemId)}</span>
            ${bits ? `<em>${bits}</em>` : ''}</li>`;
        }).join('')}</ul>`
      : '';

    el.innerHTML = `
      <h3>${this.escape(recipe.name)}</h3>
      <p class="hex-desc">${this.escape(recipe.description)}</p>
      <dl class="hex-stats">
        <dt>Difficulty</dt><dd>${recipe.difficulty}</dd>
        <dt>Power Tier</dt><dd>${recipe.powerTier}</dd>
        <dt>Prepared Uses</dt><dd>${recipe.preparedUses}</dd>
        <dt>ME Cost</dt><dd>${recipe.meCost}</dd>
        <dt>Activation</dt><dd>${this.escape(recipe.activationMethod)}</dd>
        <dt>Duration</dt><dd>${this.escape(recipe.durationLabel ?? '—')}</dd>
        ${recipe.requiredSkill ? `<dt>Required Skill</dt><dd>${recipe.requiredSkill.stat} ≥ ${recipe.requiredSkill.min}</dd>` : ''}
      </dl>
      ${prev ? `<div class="hex-preview">
        <div class="hex-meter"><span>Stability</span><div class="bar"><i style="width:${prev.stability}%"></i></div><em>${prev.stability}%</em></div>
        <div class="hex-meter warn"><span>Failure</span><div class="bar"><i style="width:${prev.failureChance}%"></i></div><em>${prev.failureChance}%</em></div>
        <div class="hex-meter danger"><span>Backlash</span><div class="bar"><i style="width:${prev.backlashChance}%"></i></div><em>${prev.backlashChance}%</em></div>
        <p class="hex-correspondence">Correspondence: ${prev.correspondenceScore}</p>
      </div>` : ''}
      <h4>Requirements</h4>
      <ul class="hex-req-guide">${reqGuide}</ul>
      ${augGuide}
      <h4>Declared Intent</h4>
      <select id="hex-declaration" class="hex-decl">${recipe.declarationTemplates.map((t) =>
        `<option value="${this.escape(t)}" ${t === this.declaration ? 'selected' : ''}>${this.escape(t)}</option>`
      ).join('')}</select>
      <textarea id="hex-decl-custom" class="hex-decl-custom" rows="2" placeholder="Or write your own declaration…">${this.escape(this.declaration)}</textarea>`;

    const declSel = el.querySelector('#hex-declaration') as HTMLSelectElement;
    const declCustom = el.querySelector('#hex-decl-custom') as HTMLTextAreaElement;
    declSel.onchange = () => { this.declaration = declSel.value; declCustom.value = declSel.value; };
    declCustom.oninput = () => { this.declaration = declCustom.value; };
  }

  private socketPixels(): Record<HexagramSocketId, { x: number; y: number; r: number }> {
    const pos = hexagramSocketPositions();
    const out = {} as Record<HexagramSocketId, { x: number; y: number; r: number }>;
    for (const id of HEXAGRAM_SOCKET_IDS) {
      const p = pos[id];
      out[id] = {
        x: p.x * CANVAS.w,
        y: p.y * CANVAS.h,
        r: p.r * Math.min(CANVAS.w, CANVAS.h),
      };
    }
    return out;
  }

  private hitSocket(x: number, y: number): HexagramSocketId | null {
    for (const [id, p] of Object.entries(this.socketPixels()) as [HexagramSocketId, { x: number; y: number; r: number }][]) {
      if (Math.hypot(x - p.x, y - p.y) <= p.r * 1.4) return id;
    }
    return null;
  }

  private onCanvasDrop(e: DragEvent): void {
    e.preventDefault();
    const itemId = e.dataTransfer?.getData('text/plain') || this.dragItemId;
    if (!itemId || this.availableQty(itemId) <= 0) return;
    const sock = this.hitSocket(e.offsetX, e.offsetY);
    if (!sock) return;
    this.sockets[sock] = itemId;
    this.spawnParticles(e.offsetX, e.offsetY, 12);
    this.render();
  }

  private tryAutoPlace(itemId: string): void {
    const recipe = this.selectedRecipe();
    if (!recipe || this.availableQty(itemId) <= 0) return;
    for (const req of recipe.sockets) {
      if (this.sockets[req.socket]) continue;
      if (socketAcceptsItem(req, itemId, this.itemCategories()[itemId])) {
        this.sockets[req.socket] = itemId;
        this.render();
        return;
      }
    }
  }

  private clearHexagram(rerender = true): void {
    this.resetHexagramBoard();
    if (rerender) this.render();
  }

  /** Remove placed ingredients/augments and return the board to a blank working. */
  private resetHexagramBoard(): void {
    this.sockets = {};
    this.augmentations = [];
    this.undoStack = [];
    this.particles = [];
    this.ritualActive = false;
    this.ritualPhase = 0;
    const recipe = this.selectedRecipe();
    this.declaration = recipe?.declarationTemplates[0] ?? '';
  }

  private undoStack: { sockets: Partial<Record<HexagramSocketId, string>>; augmentations: string[] }[] = [];

  private pushUndo(): void {
    this.undoStack.push({
      sockets: { ...this.sockets },
      augmentations: [...this.augmentations],
    });
    if (this.undoStack.length > 20) this.undoStack.shift();
  }

  private undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.sockets = prev.sockets;
    this.augmentations = prev.augmentations;
    this.render();
  }

  private beginEnchantment(): void {
    const recipe = this.selectedRecipe();
    const prev = this.preview();
    if (!recipe || !prev?.complete || this.ritualActive) return;
    if (!this.isRecipeUnlocked(recipe)) {
      this.selectedId = null;
      this.render();
      return;
    }
    this.pushUndo();
    this.ritualActive = true;
    this.ritualPhase = 0;
    const start = performance.now();
    const run = (now: number) => {
      this.ritualPhase = Math.min(1, (now - start) / 2800);
      if (this.ritualPhase < 1) {
        requestAnimationFrame(run);
        return;
      }
      this.ritualActive = false;
      network.send('hexagram_enchant', {
        recipeId: recipe.id,
        sockets: this.sockets,
        augmentations: this.augmentations,
        declaration: this.declaration || recipe.declarationTemplates[0] || '',
      });
    };
    requestAnimationFrame(run);
  }

  private spawnParticles(x: number, y: number, n: number): void {
    const theme = THEME_COLORS[this.preview()?.theme ?? 'neutral'] ?? THEME_COLORS.neutral;
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2 - 1,
        life: 1,
        maxLife: 0.6 + Math.random() * 0.6,
        hue: theme.particle + (Math.random() - 0.5) * 20,
      });
    }
  }

  private drawHexagram(): void {
    const ctx = this.ctx;
    const w = CANVAS.w;
    const h = CANVAS.h;
    const cx = w / 2;
    const cy = h / 2;
    const recipe = this.selectedRecipe();
    const prev = this.preview();
    const themeKey = prev?.theme ?? recipe?.visualTheme ?? 'neutral';
    const theme = THEME_COLORS[themeKey] ?? THEME_COLORS.neutral;
    const complete = prev?.complete ?? false;
    const ritual = this.ritualActive ? this.ritualPhase : 0;
    const rot = this.phase * (complete ? 1.4 : 0.6) + ritual * 2;

    ctx.fillStyle = '#0a0610';
    ctx.fillRect(0, 0, w, h);

    const grad = ctx.createRadialGradient(cx, cy, 20, cx, cy, Math.max(w, h) * 0.55);
    grad.addColorStop(0, `${theme.glow}33`);
    grad.addColorStop(1, '#0a061000');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot * 0.15);

    const outerR = Math.min(w, h) * 0.38;
    ctx.strokeStyle = theme.stroke;
    ctx.lineWidth = 2;
    ctx.shadowColor = theme.glow;
    ctx.shadowBlur = complete ? 18 + ritual * 20 : 8;
    ctx.beginPath();
    ctx.arc(0, 0, outerR, 0, Math.PI * 2);
    ctx.stroke();

    const tri1 = outerR * 0.92;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
      const x = Math.cos(a) * tri1;
      const y = Math.sin(a) * tri1;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();

    ctx.rotate(Math.PI);
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
      const x = Math.cos(a) * tri1;
      const y = Math.sin(a) * tri1;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    const sockets = this.socketPixels();
    for (const id of HEXAGRAM_SOCKET_IDS) {
      const p = sockets[id];
      const itemId = this.sockets[id];
      const req = recipe?.sockets.find((s) => s.socket === id);
      const valid = itemId && req ? socketAcceptsItem(req, itemId, this.itemCategories()[itemId]) : !itemId;
      const glow = itemId ? (valid ? 1 : 0.35) : 0.15;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(30, 20, 40, ${0.85 - ritual * 0.2})`;
      ctx.fill();
      ctx.strokeStyle = valid ? theme.stroke : '#aa4444';
      ctx.lineWidth = itemId ? 2.5 : 1.5;
      ctx.shadowBlur = 6 + glow * 14;
      ctx.shadowColor = valid ? theme.glow : '#882222';
      ctx.stroke();
      ctx.shadowBlur = 0;

      if (itemId) {
        ctx.fillStyle = valid ? `${theme.stroke}88` : '#aa333366';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = '#ddccaa';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(HEXAGRAM_SOCKET_LABELS[id].slice(0, 4), p.x, p.y + p.r + 12);
    }

    this.updateParticles(theme.particle);
    this.drawParticles();

    if (complete) {
      ctx.strokeStyle = `${theme.stroke}55`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, outerR * 0.35 * (1 + Math.sin(this.phase * 2) * 0.05), 0, Math.PI * 2);
      ctx.stroke();
    }

    if (ritual > 0) {
      ctx.fillStyle = `rgba(255, 220, 140, ${ritual * 0.35})`;
      ctx.beginPath();
      ctx.arc(cx, cy, outerR * ritual * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private updateParticles(hue: number): void {
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.02;
      p.vy -= 0.02;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.particles.length < 40 && Math.random() < 0.3) {
      const cx = CANVAS.w / 2;
      const cy = CANVAS.h / 2;
      this.particles.push({
        x: cx + (Math.random() - 0.5) * 80,
        y: cy + (Math.random() - 0.5) * 80,
        vx: (Math.random() - 0.5) * 0.5,
        vy: -0.3 - Math.random() * 0.5,
        life: 1,
        maxLife: 1,
        hue: hue + Math.random() * 30,
      });
    }
  }

  private drawParticles(): void {
    const ctx = this.ctx;
    for (const p of this.particles) {
      const a = p.life / p.maxLife;
      ctx.fillStyle = `hsla(${p.hue}, 80%, 70%, ${a * 0.7})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2 * a, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private escape(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }
}
