import Phaser from 'phaser';
import type { AltarState, ContentSpell, TaglockSelection, TaglockType } from '@witchcraft/shared';
import {
  HEX_INTENTS,
  formatContentLabel,
  getTaglockTargetName,
  isEmptyInventorySlot,
  isTaglockItemId,
  totalItemQuantity,
  playerLevel,
  meetsMinLevel,
} from '@witchcraft/shared';
import { gameState } from '../data/game-state';
import { network } from '../net/NetworkManager';
import { getItemIconUrl, iconImgHtml } from '../graphics/ItemIconGenerator';
import { bindDomInputs } from './input-focus';

interface PentacleSlot {
  itemId: string;
  quantity: number;
}

interface BiologicalSlot {
  inventorySlotIndex: number;
  itemId: string;
  taglockType: TaglockType;
  targetName?: string;
}

const TAGLOCK_ITEM_TO_TYPE: Record<string, TaglockType> = {
  taglock_hair: 'hair',
  taglock_blood: 'blood',
  taglock_personal_item: 'personal_item',
  taglock_written_name: 'written_name',
};

/** Pentacle canvas layout — keep bio ◇ row and aug circles vertically separated */
const PENTACLE_CANVAS = { w: 360, h: 320 };
const PENTACLE = {
  cx: PENTACLE_CANVAS.w / 2,
  cy: 108,
  rad: 78,
  innerR: 18,
  slotR: 22,
  bioY: 218,
  bioSize: 28,
  bioSpread: 105,
  augY: 278,
  augR: 18,
  augSpread: 100,
  augmentZoneMinY: 248,
  /** Visual slots for candles / herbs / incense around the pentacle */
  candleY: 36,
  candleSpread: 52,
  candleR: 17,
  herbX: 52,
  herbY: 78,
  incenseX: PENTACLE_CANVAS.w - 52,
  incenseY: 78,
  ambianceR: 17,
  ambianceStackGap: 34,
};

/** Pentacle altar with drag-drop ingredients, taglocks, hex intents */
export class AltarPanel {
  private root!: HTMLDivElement;
  private visible = false;
  private pentacleSlots: (PentacleSlot | null)[] = [null, null, null, null, null];
  private augments: PentacleSlot[] = [];
  /** Diamond slots beside augment circles — biological taglocks with target metadata */
  private biologicalSlots: (BiologicalSlot | null)[] = [null, null, null];
  private taglocks: TaglockSelection[] = [];
  private selectedSpellId: string | null = null;
  private spellDropdownOpen = false;
  private spellTooltipEl: HTMLDivElement | null = null;
  private hexIntents: string[] = [];
  private timing = 'now';
  private targetId?: string;
  private targetSelf = false;
  private magicOnly = false;
  private familiarAssist = false;
  private dragItemId: string | null = null;

  private ing(itemId: string) {
    return gameState.content?.ingredients.find((i) => i.id === itemId);
  }

  /** Quantities staged in candle / herb / incense ambiance slots */
  private getAmbianceHeld(): Map<string, number> {
    const altar = this.loadAltar();
    const held = new Map<string, number>();
    for (const key of ['candles', 'herbs', 'incense'] as const) {
      for (const p of altar[key] ?? []) {
        held.set(p.itemId, (held.get(p.itemId) ?? 0) + (p.quantity ?? 1));
      }
    }
    return held;
  }

  /** Quantities currently staged on the pentacle / augment slots */
  private getAltarHeld(): Map<string, number> {
    const held = new Map<string, number>();
    for (const slot of this.pentacleSlots) {
      if (slot) held.set(slot.itemId, (held.get(slot.itemId) ?? 0) + slot.quantity);
    }
    for (const aug of this.augments) {
      held.set(aug.itemId, (held.get(aug.itemId) ?? 0) + aug.quantity);
    }
    return held;
  }

  private getAvailableQty(itemId: string, inventorySlotIndex?: number): number {
    const inv = gameState.localPlayer?.inventory ?? [];
    if (inventorySlotIndex !== undefined) {
      const slot = inv[inventorySlotIndex];
      if (!slot || slot.itemId !== itemId || slot.quantity <= 0) return 0;
      const onBio = this.biologicalSlots.some(
        (b) => b && b.inventorySlotIndex === inventorySlotIndex
      );
      return onBio ? 0 : slot.quantity;
    }
    const total = totalItemQuantity(inv, itemId);
    const heldOnPentacle = this.getAltarHeld().get(itemId) ?? 0;
    const heldOnBio = this.biologicalSlots.filter((b) => b?.itemId === itemId).length;
    const heldOnAmbiance = this.getAmbianceHeld().get(itemId) ?? 0;
    return total - heldOnPentacle - heldOnBio - heldOnAmbiance;
  }

  private getPlayerIntuition(): number {
    try {
      const stats = JSON.parse(gameState.localPlayer?.statsJson ?? '{}');
      return Number(stats.intuition) || 0;
    } catch {
      return 0;
    }
  }

  private getPlayerExperience(): number {
    try {
      const stats = JSON.parse(gameState.localPlayer?.statsJson ?? '{}');
      return Number(stats.experience) || 0;
    } catch {
      return 0;
    }
  }

  private getPlayerLevel(): number {
    return playerLevel(this.getPlayerExperience());
  }

  private isSpellUnlocked(spell: ContentSpell): boolean {
    return meetsMinLevel(this.getPlayerExperience(), spell.minLevel);
  }

  private canSeeSpellInsight(spell: ContentSpell): boolean {
    return this.getPlayerIntuition() >= spell.difficulty - 2;
  }

  private itemIdToTaglockType(itemId: string): TaglockType | null {
    return TAGLOCK_ITEM_TO_TYPE[itemId] ?? null;
  }

  private biologicalPositions(): { x: number; y: number; size: number }[] {
    const { cx, bioY, bioSize, bioSpread } = PENTACLE;
    return [
      { x: cx - bioSpread, y: bioY, size: bioSize },
      { x: cx, y: bioY, size: bioSize },
      { x: cx + bioSpread, y: bioY, size: bioSize },
    ];
  }

  private hitBiologicalSlot(x: number, y: number): number {
    const pts = this.biologicalPositions();
    for (let i = 0; i < 3; i++) {
      if (Math.hypot(x - pts[i].x, y - pts[i].y) <= pts[i].size * 0.72) return i;
    }
    return -1;
  }

  private syncTargetFromBiologicals(): void {
    if (this.targetSelf) return;
    for (const slot of this.biologicalSlots) {
      if (!slot?.targetName) continue;
      const key = slot.targetName.toLowerCase();
      const match = gameState.nearbyPlayers.find((p) => p.displayName.toLowerCase() === key);
      if (match) {
        this.targetId = match.sessionId;
        return;
      }
    }
  }

  private buildCastTaglocks(): TaglockSelection[] {
    const fromBio = this.biologicalSlots
      .filter((b): b is BiologicalSlot => b !== null)
      .map((b) => ({
        type: b.taglockType,
        value: b.targetName,
        itemIds: [b.itemId],
      }));
    const fromUi = this.taglocks.filter((t) => t.type === 'social_bond' || t.type === 'written_name');
    return [...fromBio, ...fromUi];
  }

  constructor(_scene: Phaser.Scene) {
    this.build();
    this.hide();
    window.addEventListener('game:spell-result', this.onSpellResult as EventListener);
    window.addEventListener('game:player-sync', this.onPlayerSync as EventListener);
    window.addEventListener('game:nearby-players', this.onNearbyPlayers as EventListener);
  }

  private onNearbyPlayers = (): void => {
    if (this.visible) this.updateTargetRow();
  };

  private onPlayerSync = (): void => {
    if (this.visible) this.refreshInventorySidebar();
  };

  private build(): void {
    this.root = document.createElement('div');
    this.root.id = 'altar-panel';
    document.body.appendChild(this.root);
  }

  show(): void {
    network.refreshNearbyPlayers();
    this.visible = true;
    this.root.style.display = 'flex';
    this.render();
  }

  hide(): void {
    if (this.visible) {
      network.send('altar_update', { altar: this.loadAltar() });
    }
    this.visible = false;
    this.root.style.display = 'none';
    this.hideSpellTooltip();
    this.spellDropdownOpen = false;
  }

  private loadAltar(): AltarState {
    const base = gameState.localPlayer?.altarJson
      ? JSON.parse(gameState.localPlayer.altarJson)
      : { candles: [], herbs: [], incense: [], petitions: [], poppets: [], taglocks: [], decorationIds: [] };
    return { ...base, timing: this.timing, familiarAssist: this.familiarAssist };
  }

  private renderAmbianceRow(): string {
    const altar = this.loadAltar();
    const slot = (label: string, key: 'candles' | 'herbs' | 'incense') => {
      const items = altar[key] ?? [];
      const icons = items
        .map((p: { itemId: string }, idx: number) => {
          const ing = this.ing(p.itemId);
          return `<span class="ambiance-item" data-key="${key}" data-index="${idx}" title="Right-click to remove" style="cursor:pointer;display:inline-block;margin:0 2px;">${iconImgHtml(p.itemId, ing?.category, ing?.name, 18, ing?.iconPixels)}</span>`;
        })
        .join('');
      return `<div style="font-size:8px;color:#888;margin-top:3px;">${label}: ${icons || '<span style="color:#444;">empty — right-click inventory item</span>'}</div>`;
    };
    return `<div id="ambiance-row">${slot('Candles', 'candles')}${slot('Herbs', 'herbs')}${slot('Incense', 'incense')}</div>`;
  }

  private bindAmbianceRow(): void {
    this.root.querySelectorAll('.ambiance-item').forEach((el) => {
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const key = (el as HTMLElement).dataset.key as 'candles' | 'herbs' | 'incense';
        const index = Number((el as HTMLElement).dataset.index);
        if (key && Number.isFinite(index)) this.removeAmbiance(key, index);
      });
    });
  }

  private refreshAmbianceRow(): void {
    const row = document.getElementById('ambiance-row');
    if (!row) return;
    const altar = this.loadAltar();
    const slot = (label: string, key: 'candles' | 'herbs' | 'incense') => {
      const items = altar[key] ?? [];
      const icons = items
        .map((p: { itemId: string }, idx: number) => {
          const ing = this.ing(p.itemId);
          return `<span class="ambiance-item" data-key="${key}" data-index="${idx}" title="Right-click to remove" style="cursor:pointer;display:inline-block;margin:0 2px;">${iconImgHtml(p.itemId, ing?.category, ing?.name, 18, ing?.iconPixels)}</span>`;
        })
        .join('');
      return `<div style="font-size:8px;color:#888;margin-top:3px;">${label}: ${icons || '<span style="color:#444;">empty — right-click inventory item</span>'}</div>`;
    };
    row.innerHTML = slot('Candles', 'candles') + slot('Herbs', 'herbs') + slot('Incense', 'incense');
    this.bindAmbianceRow();
  }

  private saveAltar(altar: AltarState): void {
    const next = { ...altar, timing: this.timing, familiarAssist: this.familiarAssist };
    if (gameState.localPlayer) gameState.localPlayer.altarJson = JSON.stringify(next);
    network.send('altar_update', { altar: next });
  }

  private placeAmbiance(key: 'candles' | 'herbs' | 'incense', itemId: string): void {
    if (this.getAvailableQty(itemId) <= 0) return;
    const altar = this.loadAltar();
    const list = [...(altar[key] ?? [])];
    if (list.length >= 3) return;
    list.push({ slot: key, itemId, quantity: 1 });
    altar[key] = list;
    this.saveAltar(altar);
    this.drawPentacle();
    this.refreshInventorySidebar();
    this.refreshAmbianceRow();
  }

  private removeAmbiance(key: 'candles' | 'herbs' | 'incense', index: number): void {
    const altar = this.loadAltar();
    const list = [...(altar[key] ?? [])];
    if (index < 0 || index >= list.length) return;
    list.splice(index, 1);
    altar[key] = list;
    this.saveAltar(altar);
    this.drawPentacle();
    this.refreshInventorySidebar();
    this.refreshAmbianceRow();
  }

  private ambiancePositions(): {
    key: 'candles' | 'herbs' | 'incense';
    index: number;
    x: number;
    y: number;
    r: number;
  }[] {
    const { cx, candleY, candleSpread, candleR, herbX, herbY, incenseX, incenseY, ambianceR, ambianceStackGap } =
      PENTACLE;
    const altar = this.loadAltar();
    const out: { key: 'candles' | 'herbs' | 'incense'; index: number; x: number; y: number; r: number }[] = [];

    (altar.candles ?? []).forEach((_, index) => {
      const count = altar.candles!.length;
      const offset = (index - (count - 1) / 2) * candleSpread;
      out.push({ key: 'candles', index, x: cx + offset, y: candleY, r: candleR });
    });
    (altar.herbs ?? []).forEach((_, index) => {
      out.push({ key: 'herbs', index, x: herbX, y: herbY + index * ambianceStackGap, r: ambianceR });
    });
    (altar.incense ?? []).forEach((_, index) => {
      out.push({ key: 'incense', index, x: incenseX, y: incenseY + index * ambianceStackGap, r: ambianceR });
    });
    return out;
  }

  private hitAmbianceSlot(x: number, y: number): { key: 'candles' | 'herbs' | 'incense'; index: number } | null {
    for (const slot of this.ambiancePositions()) {
      if (Math.hypot(x - slot.x, y - slot.y) <= slot.r + 4) {
        return { key: slot.key, index: slot.index };
      }
    }
    return null;
  }

  private render(): void {
    const allInv = gameState.localPlayer?.inventory ?? [];
    const invEntries = allInv
      .map((slot, slotIndex) => ({ slot, slotIndex }))
      .filter(({ slot }) => !isEmptyInventorySlot(slot));
    const spells = gameState.getSpells();
    const met = gameState.metPlayers ?? [];

    this.root.innerHTML = `
      <div class="altar-layout">
      <aside class="altar-sidebar">
        <div class="altar-sidebar-label">Components — drag or right-click to place</div>
        ${invEntries.map(({ slot: s, slotIndex }) => {
          const ing = gameState.content?.ingredients.find((i) => i.id === s.itemId);
          const onBio = this.biologicalSlots.some((b) => b?.inventorySlotIndex === slotIndex);
          const available = isTaglockItemId(s.itemId)
            ? this.getAvailableQty(s.itemId, slotIndex)
            : this.getAvailableQty(s.itemId);
          const onPentacle = isTaglockItemId(s.itemId) ? 0 : s.quantity - this.getAvailableQty(s.itemId);
          const disabled = available <= 0 || onBio;
          const targetHint = isTaglockItemId(s.itemId) ? getTaglockTargetName(s) : undefined;
          return `<div class="inv-row" draggable="${disabled ? 'false' : 'true'}" data-item="${s.itemId}" data-slot="${slotIndex}" data-qty="${available}"
            style="display:flex;align-items:center;gap:6px;padding:4px;margin:2px 0;background:#1a1025;cursor:${disabled ? 'default' : 'grab'};font-size:9px;opacity:${disabled && (onPentacle > 0 || onBio) ? '0.55' : '1'};">
            ${iconImgHtml(s.itemId, ing?.category, ing?.name, 28, ing?.iconPixels)}
            <span>${ing?.name ?? formatContentLabel(s.itemId)}${targetHint ? ` <span style="color:#a8a;">→ ${targetHint}</span>` : ''} ×${available}${onPentacle > 0 ? ` <span style="color:#888;">(${onPentacle} on altar)</span>` : ''}${onBio ? ` <span style="color:#886;">(◇ bio)</span>` : ''}</span>
          </div>`;
        }).join('')}
      </aside>
      <div class="altar-main">
        <div class="altar-main-header">
          <h2>Ritual Altar — Pentacle</h2>
          <button type="button" id="altar-close" class="wb-close" aria-label="Close">✕</button>
        </div>
        <div class="altar-work-area">
          <div>
            <canvas id="pentacle-canvas" width="${PENTACLE_CANVAS.w}" height="${PENTACLE_CANVAS.h}"></canvas>
            <div class="altar-canvas-hint">Candles above · herbs left · incense right · right-click to return</div>
            ${this.renderAmbianceRow()}
            <div class="altar-cast-row">
              <button type="button" id="cast-sigil">✦ CAST SIGIL ✦</button>
              <label class="altar-cast-options"><input type="checkbox" id="magic-only" ${this.magicOnly ? 'checked' : ''}/> Raw magic only (weak)</label>
              ${this.canFamiliarAssist() ? `
                <button type="button" id="fam-assist" class="${this.familiarAssist ? 'is-active' : ''}">
                  ${this.familiarAssist ? '🐾 Familiar Assisting' : '🐾 Involve Familiar'}
                </button>` : ''}
            </div>
          </div>
          <div class="altar-controls">
            <div class="altar-section-label">Timing</div>
            ${['now', 'dawn', 'dusk', 'midnight', 'waxing_moon'].map((t) =>
              `<button type="button" class="time-btn${this.timing === t ? ' is-active' : ''}" data-t="${t}">${t.replace('_', ' ')}</button>`
            ).join('')}
            <div class="altar-section-label">Target</div>
            <button type="button" id="target-self" class="${this.targetSelf ? 'is-active' : ''}" title="Cast on yourself">Self</button>
            <span id="target-players">${gameState.nearbyPlayers.map((p) =>
              `<button type="button" class="target-btn${!this.targetSelf && this.targetId === p.sessionId ? ' is-active' : ''}" data-id="${p.sessionId}">${p.displayName}</button>`
            ).join('') || '<span class="wb-muted">No one nearby</span>'}</span>
            ${this.targetSelf ? `<div class="wb-muted" style="margin-top:4px;font-size:0.68rem;">Self-target — taglock not required</div>` : ''}
            <div class="altar-section-label">Taglock ${this.targetSelf ? '(not needed)' : ''}</div>
            <select id="taglock-add" class="wb-select" ${this.targetSelf ? 'disabled' : ''}>
              <option value="">+ Add taglock...</option>
              <option value="written_name">Written Name</option>
              <option value="social_bond">Social Bond</option>
            </select>
            <div id="taglock-list" style="margin-top:6px;"></div>
          </div>
        </div>
        <div class="altar-working-block">
          <div class="altar-section-label">Working — choose a spell</div>
          ${this.spellDropdownHtml(spells)}
          <div id="hex-intents" style="margin-top:8px;display:${this.isBaneful() ? 'block' : 'none'};"></div>
          ${this.selectedSpellId ? (() => {
            const sp = gameState.getSpells().find((x) => x.id === this.selectedSpellId);
            if (!sp) return '';
            const everweedHint =
              sp.category === 'protection' || sp.category === 'warding'
                ? `<div class="wb-muted" style="font-size:0.68rem;margin-top:4px;">Optional: add Everweed to bind permanently (+20 ME).</div>`
                : '';
            return `<div id="spell-me-info">${this.spellMeLabel(sp)}</div>${everweedHint}`;
          })() : ''}
        </div>
        <div id="altar-msg"></div>
      </div>
      </div>`;

    this.bindEvents(met);
    this.bindAmbianceRow();
    this.bindSpellDropdown(spells);
    this.drawPentacle();
    this.renderTaglocks(met);
    this.renderHexIntents();
    bindDomInputs(this.root);
  }

  /** Update TARGET row only — avoids resetting scroll / selections on movement sync */
  private updateTargetRow(): void {
    const el = document.getElementById('target-players');
    if (!el) return;
    el.innerHTML =
      gameState.nearbyPlayers
        .map(
          (p) =>
            `<button type="button" class="target-btn${!this.targetSelf && this.targetId === p.sessionId ? ' is-active' : ''}" data-id="${p.sessionId}">${p.displayName}</button>`
        )
        .join('') || '<span class="wb-muted">No one nearby</span>';
    el.querySelectorAll('.target-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.targetId = (btn as HTMLElement).dataset.id;
        this.targetSelf = false;
        this.updateTargetRow();
      });
    });
  }

  private canFamiliarAssist(): boolean {
    const f = gameState.familiar;
    const sp = gameState.getSpells().find((s) => s.id === this.selectedSpellId);
    if (!f?.chosen || !sp) return false;
    if (f.templateId === 'cat_familiar' || f.templateId === 'snake_familiar') return true;
    const key = f.templateId.replace('_familiar', '_boost');
    return (sp.familiarInteractions ?? []).includes(key);
  }

  private spellDropdownHtml(spells: ContentSpell[]): string {
    const selected = spells.find((s) => s.id === this.selectedSpellId && this.isSpellUnlocked(s));
    if (this.selectedSpellId && !selected) this.selectedSpellId = null;
    const label = selected
      ? `${selected.name} · ME ${selected.maintenanceCost}`
      : 'Select a working…';
    const level = this.getPlayerLevel();
    return `<div class="altar-spell-picker">
      <button type="button" id="altar-spell-trigger" class="altar-spell-trigger">
        <span>${label}</span>
        <span class="altar-spell-caret">${this.spellDropdownOpen ? '▴' : '▾'}</span>
      </button>
      <div id="altar-spell-menu" class="altar-spell-menu${this.spellDropdownOpen ? ' open' : ''}">
        ${spells.map((s) => {
          const unlocked = this.isSpellUnlocked(s);
          const sel = this.selectedSpellId === s.id && unlocked;
          const need = s.minLevel ?? 1;
          const lockedCls = unlocked ? '' : ' locked';
          const meta = unlocked
            ? `ME ${s.maintenanceCost} · focus ${s.difficulty} · ${s.category.replace(/_/g, ' ')}`
            : `Requires Practitioner Level ${need} (you are ${level})`;
          return `<button type="button" class="altar-spell-option${sel ? ' selected' : ''}${lockedCls}" data-id="${s.id}" data-locked="${unlocked ? '0' : '1'}" ${unlocked ? '' : 'aria-disabled="true"'}>
            ${s.name}${unlocked ? '' : ' <span class="altar-spell-lock">Locked</span>'}
            <span class="altar-spell-me">${meta}</span>
          </button>`;
        }).join('')}
      </div>
    </div>`;
  }

  private buildSpellTooltip(spell: ContentSpell): string {
    const unlocked = this.isSpellUnlocked(spell);
    const need = spell.minLevel ?? 1;
    const level = this.getPlayerLevel();
    const effectKeys = Object.keys(spell.gameplayEffect ?? {})
      .slice(0, 4)
      .map((k) => k.replace(/([A-Z])/g, ' $1').trim())
      .join(', ');

    if (!unlocked) {
      return `
      <div class="altar-tip-title">${spell.name}</div>
      <div class="altar-tip-gate">Level gated — requires Practitioner Level ${need} (you are ${level})</div>
      <div class="altar-tip-desc">${spell.description}</div>
      <div class="altar-tip-row"><span>Effect</span> ${effectKeys || spell.category.replace(/_/g, ' ')}</div>
      <div class="altar-tip-row"><span>Target</span> ${spell.targetType.replace(/_/g, ' ')} · ${Math.round(spell.duration / 60)} min duration</div>
      <div class="altar-tip-muted">Ingredients and preparation details stay sealed until you reach Level ${need}.</div>
    `;
    }

    const intuition = this.getPlayerIntuition();
    const insight = this.canSeeSpellInsight(spell);
    const ingList = spell.ingredients
      .map((i) => {
        const ing = this.ing(i.itemId);
        return `${ing?.name ?? formatContentLabel(i.itemId)} ×${i.quantity}`;
      })
      .join(', ');
    const tagReq = spell.taglockRequirement?.length
      ? `<div class="altar-tip-row"><span>Taglock</span> ${spell.taglockRequirement.join(' or ')} (SELF bypasses)</div>`
      : '';
    const boosters =
      insight && spell.optionalBoosters?.length
        ? `<div class="altar-tip-boosters"><strong>Booster insight</strong> (Intuition ${intuition} ≥ ${spell.difficulty - 2})<ul>${spell.optionalBoosters
            .map((b) => {
              const ing = this.ing(b.itemId);
              return `<li>${ing?.name ?? formatContentLabel(b.itemId)} ×${b.quantity} → +${b.potencyBonus} potency</li>`;
            })
            .join('')}</ul></div>`
        : insight
          ? `<div class="altar-tip-muted">Your intuition senses no optional boosters for this working.</div>`
          : `<div class="altar-tip-muted">Intuition ${spell.difficulty - 2}+ reveals optional booster ingredients.</div>`;

    return `
      <div class="altar-tip-title">${spell.name}</div>
      <div class="altar-tip-desc">${spell.description}</div>
      <div class="altar-tip-row"><span>Effect</span> ${effectKeys || spell.category}</div>
      <div class="altar-tip-row"><span>Target</span> ${spell.targetType.replace(/_/g, ' ')} · ${Math.round(spell.duration / 60)} min duration</div>
      <div class="altar-tip-row"><span>Focus</span> difficulty ${spell.difficulty} · roll Ritual + Intuition + specialty</div>
      <div class="altar-tip-row"><span>ME</span> ${spell.maintenanceCost} with ingredients · ${Math.ceil(spell.maintenanceCost * 2.5)} raw magic</div>
      <div class="altar-tip-row"><span>Requires</span> ${ingList || 'none'}</div>
      ${tagReq}
      ${boosters}
    `;
  }

  private ensureSpellTooltip(): HTMLDivElement {
    if (!this.spellTooltipEl) {
      this.spellTooltipEl = document.createElement('div');
      this.spellTooltipEl.id = 'altar-spell-tooltip';
      this.spellTooltipEl.style.display = 'none';
      document.body.appendChild(this.spellTooltipEl);
    }
    return this.spellTooltipEl;
  }

  private showSpellTooltip(spell: ContentSpell, x: number, y: number): void {
    const el = this.ensureSpellTooltip();
    el.innerHTML = this.buildSpellTooltip(spell);
    el.style.display = 'block';
    const pad = 12;
    const rect = el.getBoundingClientRect();
    let left = x + pad;
    let top = y + pad;
    if (left + rect.width > window.innerWidth - 8) left = x - rect.width - pad;
    if (top + rect.height > window.innerHeight - 8) top = y - rect.height - pad;
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top = `${Math.max(8, top)}px`;
  }

  private hideSpellTooltip(): void {
    if (this.spellTooltipEl) this.spellTooltipEl.style.display = 'none';
  }

  private bindSpellDropdown(spells: ContentSpell[]): void {
    const trigger = document.getElementById('altar-spell-trigger');
    const menu = document.getElementById('altar-spell-menu');
    if (!trigger || !menu) return;

    trigger.onclick = (e) => {
      e.stopPropagation();
      this.spellDropdownOpen = !this.spellDropdownOpen;
      menu.classList.toggle('open', this.spellDropdownOpen);
      trigger.querySelector('.altar-spell-caret')!.textContent = this.spellDropdownOpen ? '▴' : '▾';
    };

    const selectedSpell = spells.find((s) => s.id === this.selectedSpellId);
    if (selectedSpell) {
      trigger.addEventListener('mouseenter', (e) => {
        if (this.spellDropdownOpen) return;
        this.showSpellTooltip(selectedSpell, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
      });
      trigger.addEventListener('mousemove', (e) => {
        if (this.spellDropdownOpen) return;
        this.showSpellTooltip(selectedSpell, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
      });
      trigger.addEventListener('mouseleave', () => this.hideSpellTooltip());
    }

    const closeMenu = (): void => {
      if (!this.spellDropdownOpen) return;
      this.spellDropdownOpen = false;
      menu.classList.remove('open');
      trigger.querySelector('.altar-spell-caret')!.textContent = '▾';
    };

    menu.querySelectorAll('.altar-spell-option').forEach((btn) => {
      const spellId = (btn as HTMLElement).dataset.id!;
      const spell = spells.find((s) => s.id === spellId);
      if (!spell) return;

      btn.addEventListener('mouseenter', (e) => {
        this.showSpellTooltip(spell, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
      });
      btn.addEventListener('mousemove', (e) => {
        this.showSpellTooltip(spell, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
      });
      btn.addEventListener('mouseleave', () => this.hideSpellTooltip());

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!this.isSpellUnlocked(spell)) {
          this.showSpellTooltip(spell, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
          return;
        }
        this.selectedSpellId = spellId;
        this.hideSpellTooltip();
        closeMenu();
        this.render();
      });
    });

    const onDocClick = (): void => {
      closeMenu();
      this.hideSpellTooltip();
    };
    setTimeout(() => document.addEventListener('click', onDocClick, { once: true }), 0);
  }

  private spellMeLabel(s: ContentSpell): string {
    return `ME ${s.maintenanceCost} with ingredients · ${Math.ceil(s.maintenanceCost * 2.5)} raw magic`;
  }

  private isBaneful(): boolean {
    const spell = gameState.getSpells().find((s) => s.id === this.selectedSpellId);
    return spell?.category === 'baneful';
  }

  private bindEvents(met: typeof gameState.metPlayers): void {
    document.getElementById('altar-close')!.onclick = () => this.hide();
    document.getElementById('cast-sigil')!.onclick = () => this.cast();

    this.root.querySelectorAll('.inv-row').forEach((row) => {
      row.addEventListener('dragstart', (e: Event) => {
        const de = e as DragEvent;
        this.dragItemId = (row as HTMLElement).dataset.item ?? null;
        de.dataTransfer?.setData('text/plain', this.dragItemId ?? '');
        de.dataTransfer?.setData('application/x-altar-slot', (row as HTMLElement).dataset.slot ?? '');
      });
      row.addEventListener('contextmenu', (e: Event) => {
        e.preventDefault();
        const itemId = (row as HTMLElement).dataset.item;
        if (!itemId || Number((row as HTMLElement).dataset.qty) <= 0) return;
        const cat = this.ing(itemId)?.category;
        if (cat === 'candles') {
          this.placeAmbiance('candles', itemId);
          return;
        }
        if (cat === 'herbs') {
          this.placeAmbiance('herbs', itemId);
          return;
        }
        if (cat === 'incense') {
          this.placeAmbiance('incense', itemId);
          return;
        }
        this.placeFromInventory(itemId);
      });
    });

    const canvas = document.getElementById('pentacle-canvas') as HTMLCanvasElement;
    canvas.addEventListener('dragover', (e) => e.preventDefault());
    canvas.addEventListener('drop', (e) => {
      e.preventDefault();
      const itemId = e.dataTransfer?.getData('text/plain') || this.dragItemId;
      if (!itemId) return;
      const slotRaw = e.dataTransfer?.getData('application/x-altar-slot');
      const invSlotIndex = slotRaw !== '' && slotRaw != null ? Number(slotRaw) : undefined;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      this.dropOnPentacle(itemId, x, y, invSlotIndex);
    });
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      this.returnFromAltar(x, y);
    });

    this.root.querySelectorAll('.time-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.timing = (btn as HTMLElement).dataset.t!;
        this.render();
      });
    });

    document.getElementById('target-self')!.onclick = () => {
      this.targetSelf = !this.targetSelf;
      if (this.targetSelf) {
        this.targetId = undefined;
        this.taglocks = [];
      }
      this.render();
    };
    this.root.querySelectorAll('.target-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.targetId = (btn as HTMLElement).dataset.id;
        this.targetSelf = false;
        this.render();
      });
    });

    document.getElementById('magic-only')!.addEventListener('change', (e) => {
      this.magicOnly = (e.target as HTMLInputElement).checked;
    });

    document.getElementById('fam-assist')?.addEventListener('click', () => {
      this.familiarAssist = !this.familiarAssist;
      this.render();
    });

    document.getElementById('taglock-add')!.addEventListener('change', (e) => {
      const type = (e.target as HTMLSelectElement).value as TaglockType;
      if (!type || this.targetSelf) return;
      this.taglocks = [{ type }];
      this.targetSelf = false;
      (e.target as HTMLSelectElement).value = '';
      this.renderTaglocks(met);
    });
  }

  /** Right-click inventory — place on pentacle (full spell qty if selected) */
  private placeFromInventory(itemId: string): void {
    const spell = this.selectedSpellId
      ? gameState.getSpells().find((s) => s.id === this.selectedSpellId)
      : null;
    const reqQty = spell?.ingredients.find((i) => i.itemId === itemId)?.quantity ?? 1;
    this.addItemToPentacle(itemId, reqQty);
  }

  private addItemToPentacle(itemId: string, qty: number): void {
    for (let q = 0; q < qty; q++) {
      if (this.getAvailableQty(itemId) <= 0) break;

      let placed = false;
      for (let i = 0; i < 5; i++) {
        const slot = this.pentacleSlots[i];
        if (slot?.itemId === itemId) {
          slot.quantity++;
          placed = true;
          break;
        }
      }
      if (!placed) {
        const empty = this.pentacleSlots.findIndex((s) => !s);
        if (empty >= 0) this.pentacleSlots[empty] = { itemId, quantity: 1 };
      }
    }
    this.drawPentacle();
    this.refreshInventorySidebar();
  }

  private dropOnPentacle(itemId: string, x: number, y: number, invSlotIndex?: number): void {
    const bioIdx = this.hitBiologicalSlot(x, y);
    if (bioIdx >= 0) {
      if (invSlotIndex === undefined || !isTaglockItemId(itemId)) return;
      this.dropOnBiological(itemId, invSlotIndex, bioIdx);
      return;
    }

    if (this.getAvailableQty(itemId) <= 0) return;

    const augmentZone = y > PENTACLE.augmentZoneMinY;
    if (augmentZone) {
      if (this.augments.length >= 3) return;
      const existing = this.augments.find((s) => s.itemId === itemId);
      if (existing) existing.quantity++;
      else this.augments.push({ itemId, quantity: 1 });
      this.drawPentacle();
      this.refreshInventorySidebar();
      return;
    }

    const pts = this.pentaclePositions();
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < 5; i++) {
      const p = pts[i];
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < bestDist && d < p.r + 12) {
        bestDist = d;
        best = i;
      }
    }
    if (best < 0) return;

    const slot = this.pentacleSlots[best];
    if (slot && slot.itemId !== itemId) return;
    if (slot) slot.quantity++;
    else this.pentacleSlots[best] = { itemId, quantity: 1 };
    this.drawPentacle();
    this.refreshInventorySidebar();
  }

  private dropOnBiological(itemId: string, invSlotIndex: number, slotIndex: number): void {
    if (!isTaglockItemId(itemId)) return;
    const taglockType = this.itemIdToTaglockType(itemId);
    if (!taglockType || taglockType === 'written_name') return;
    if (this.getAvailableQty(itemId, invSlotIndex) <= 0) return;
    if (this.biologicalSlots.some((b) => b && b.inventorySlotIndex === invSlotIndex)) return;

    const inv = gameState.localPlayer?.inventory ?? [];
    const slot = inv[invSlotIndex];
    if (!slot || slot.itemId !== itemId) return;

    this.biologicalSlots[slotIndex] = {
      inventorySlotIndex: invSlotIndex,
      itemId,
      taglockType,
      targetName: getTaglockTargetName(slot),
    };
    this.syncTargetFromBiologicals();
    this.updateTargetRow();
    this.drawPentacle();
    this.refreshInventorySidebar();
  }

  /** Right-click on pentacle slot, biological diamond, augment, or ambiance to return */
  private returnFromAltar(x: number, y: number): void {
    const ambiance = this.hitAmbianceSlot(x, y);
    if (ambiance) {
      this.removeAmbiance(ambiance.key, ambiance.index);
      return;
    }

    const bioIdx = this.hitBiologicalSlot(x, y);
    if (bioIdx >= 0 && this.biologicalSlots[bioIdx]) {
      this.biologicalSlots[bioIdx] = null;
      this.drawPentacle();
      this.refreshInventorySidebar();
      return;
    }

    if (y > PENTACLE.augmentZoneMinY) {
      const { cx, augY, augSpread } = PENTACLE;
      for (let i = 0; i < 3; i++) {
        const ax = cx - augSpread + i * augSpread;
        const ay = augY;
        if (Math.hypot(x - ax, y - ay) <= PENTACLE.augR + 4 && this.augments[i]) {
          const aug = this.augments[i];
          if (aug.quantity > 1) aug.quantity--;
          else this.augments.splice(i, 1);
          this.drawPentacle();
          this.refreshInventorySidebar();
          return;
        }
      }
      return;
    }

    const pts = this.pentaclePositions();
    for (let i = 0; i < 5; i++) {
      const p = pts[i];
      const slot = this.pentacleSlots[i];
      if (!slot) continue;
      if (Math.hypot(x - p.x, y - p.y) > p.r + 8) continue;
      if (slot.quantity > 1) slot.quantity--;
      else this.pentacleSlots[i] = null;
      this.drawPentacle();
      this.refreshInventorySidebar();
      return;
    }
  }

  /** Update inventory counts without rebuilding the whole panel */
  private refreshInventorySidebar(): void {
    const inv = gameState.localPlayer?.inventory ?? [];
    this.root.querySelectorAll('.inv-row').forEach((row) => {
      const itemId = (row as HTMLElement).dataset.item!;
      const slotIndex = Number((row as HTMLElement).dataset.slot);
      const ing = gameState.content?.ingredients.find((i) => i.id === itemId);
      const onBio = this.biologicalSlots.some((b) => b?.inventorySlotIndex === slotIndex);
      const available = isTaglockItemId(itemId)
        ? this.getAvailableQty(itemId, slotIndex)
        : this.getAvailableQty(itemId);
      const total = inv[slotIndex]?.quantity ?? 0;
      const onPentacle = isTaglockItemId(itemId) ? 0 : total - this.getAvailableQty(itemId);
      const targetHint = isTaglockItemId(itemId) ? getTaglockTargetName(inv[slotIndex]) : undefined;
      (row as HTMLElement).dataset.qty = String(available);
      (row as HTMLElement).setAttribute('draggable', available > 0 && !onBio ? 'true' : 'false');
      (row as HTMLElement).style.cursor = available > 0 && !onBio ? 'grab' : 'default';
      (row as HTMLElement).style.opacity = available <= 0 && (onPentacle > 0 || onBio) ? '0.55' : '1';
      const label = row.querySelector('span');
      if (label) {
        label.innerHTML = `${ing?.name ?? formatContentLabel(itemId)}${targetHint ? ` <span style="color:#a8a;">→ ${targetHint}</span>` : ''} ×${available}${onPentacle > 0 ? ` <span style="color:#888;">(${onPentacle} on altar)</span>` : ''}${onBio ? ` <span style="color:#886;">(◇ bio)</span>` : ''}`;
      }
    });
  }

  private pentaclePositions(): { x: number; y: number; r: number }[] {
    const { cx, cy, rad, slotR } = PENTACLE;
    const pts = [];
    for (let i = 0; i < 5; i++) {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      pts.push({ x: cx + Math.cos(angle) * rad, y: cy + Math.sin(angle) * rad, r: slotR });
    }
    return pts;
  }

  private drawPentacle(): void {
    const canvas = document.getElementById('pentacle-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const { w, h } = PENTACLE_CANVAS;
    const { cx, cy, innerR } = PENTACLE;
    ctx.clearRect(0, 0, w, h);
    const pts = this.pentaclePositions();

    ctx.strokeStyle = '#8866aa';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      for (let j = i + 1; j < 5; j++) {
        if ((j - i) % 2 === 1 || j - i === 2) {
          ctx.beginPath();
          ctx.moveTo(pts[i].x, pts[i].y);
          ctx.lineTo(pts[j].x, pts[j].y);
          ctx.stroke();
        }
      }
    }

    ctx.strokeStyle = '#664488';
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const p = pts[i];
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.stroke();

    ctx.fillStyle = '#221133';
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffcc88';
    ctx.stroke();
    ctx.fillStyle = '#ffcc88';
    ctx.font = '16px serif';
    ctx.textAlign = 'center';
    ctx.fillText('✦', cx, cy + 6);

    this.drawAmbianceSlots(ctx);

    this.pentacleSlots.forEach((slot, i) => {
      if (i >= 5) return;
      const p = pts[i];
      ctx.fillStyle = slot ? '#1a1025' : '#0e0818';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = slot ? '#aaccff' : '#554466';
      ctx.setLineDash(slot ? [] : [3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (!slot) {
        ctx.fillStyle = '#665';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(String(i + 1), p.x, p.y + 3);
        return;
      }
      const ing = this.ing(slot.itemId);
      const img = new Image();
      img.src = getItemIconUrl(slot.itemId, ing?.category, ing?.name, ing?.iconPixels);
      img.onload = () => {
        ctx.drawImage(img, p.x - 14, p.y - 14, 28, 28);
        ctx.fillStyle = '#fff';
        ctx.font = '8px monospace';
        ctx.fillText(`×${slot.quantity}`, p.x, p.y + 20);
      };
    });

    const { augY, augR, augSpread } = PENTACLE;
    [0, 1, 2].forEach((i) => {
      const ax = cx - augSpread + i * augSpread;
      const ay = augY;
      ctx.fillStyle = '#1a0818';
      ctx.beginPath();
      ctx.arc(ax, ay, augR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#884444';
      ctx.stroke();
      ctx.fillStyle = '#886';
      ctx.font = '7px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('aug', ax, ay + 3);
      const aug = this.augments[i];
      if (aug) {
        const ing = this.ing(aug.itemId);
        const img = new Image();
        img.src = getItemIconUrl(aug.itemId, ing?.category, ing?.name, ing?.iconPixels);
        img.onload = () => ctx.drawImage(img, ax - 12, ay - 12, 24, 24);
      }
    });

    this.biologicalPositions().forEach((p, i) => {
      this.drawDiamondSlot(ctx, p.x, p.y, p.size, !!this.biologicalSlots[i]);
      ctx.fillStyle = '#665544';
      ctx.font = '7px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('◇', p.x, p.y + 3);
      const bio = this.biologicalSlots[i];
      if (bio) {
        const ing = this.ing(bio.itemId);
        const img = new Image();
        img.src = getItemIconUrl(bio.itemId, ing?.category, ing?.name, ing?.iconPixels);
        img.onload = () => {
          ctx.drawImage(img, p.x - 11, p.y - 11, 22, 22);
          if (bio.targetName) {
            ctx.fillStyle = '#cca';
            ctx.font = '6px monospace';
            ctx.fillText(bio.targetName.slice(0, 8), p.x, p.y + p.size * 0.55);
          }
        };
      }
    });
  }

  private drawAmbianceSlots(ctx: CanvasRenderingContext2D): void {
    const altar = this.loadAltar();
    const labelStyle = (text: string, x: number, y: number, color: string): void => {
      ctx.fillStyle = color;
      ctx.font = '7px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(text, x, y);
    };

    for (const slot of this.ambiancePositions()) {
      const list = altar[slot.key] ?? [];
      const placement = list[slot.index];
      if (!placement) continue;

      ctx.fillStyle = '#1a1025';
      ctx.beginPath();
      ctx.arc(slot.x, slot.y, slot.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle =
        slot.key === 'candles' ? '#ffcc66' : slot.key === 'herbs' ? '#66aa66' : '#aa8866';
      ctx.stroke();

      const ing = this.ing(placement.itemId);
      const img = new Image();
      img.src = getItemIconUrl(placement.itemId, ing?.category, ing?.name, ing?.iconPixels);
      const { x, y, r } = slot;
      img.onload = () => {
        ctx.drawImage(img, x - r + 2, y - r + 2, r * 2 - 4, r * 2 - 4);
      };
    }

    labelStyle('CANDLES', PENTACLE.cx, PENTACLE.candleY - 22, '#886644');
    labelStyle('HERBS', PENTACLE.herbX, PENTACLE.herbY - 18, '#446644');
    labelStyle('INCENSE', PENTACLE.incenseX, PENTACLE.incenseY - 18, '#664444');
  }

  private drawDiamondSlot(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    size: number,
    filled: boolean
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = filled ? '#1a1025' : '#0e0818';
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.strokeStyle = filled ? '#cc8866' : '#554433';
    ctx.setLineDash(filled ? [] : [2, 2]);
    ctx.strokeRect(-size / 2, -size / 2, size, size);
    ctx.setLineDash([]);
    ctx.restore();
  }

  private renderTaglocks(met: typeof gameState.metPlayers): void {
    const el = document.getElementById('taglock-list');
    if (!el) return;
    if (this.targetSelf) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = this.taglocks.map((t, i) => {
      let extra = '';
      if (t.type === 'written_name') {
        extra = `<input class="tl-written" data-i="${i}" placeholder="Target name" value="${t.value ?? ''}" style="width:100%;padding:2px;background:#221133;color:#fff;border:1px solid #664;margin-top:2px;font-size:9px;" />`;
      } else if (t.type === 'social_bond') {
        extra = met.map((m) =>
          `<button class="met-btn" data-i="${i}" data-pid="${m.playerId}" style="display:block;width:100%;text-align:left;padding:2px 4px;margin:2px 0;background:#111;border:1px solid #664;color:#ccc;cursor:pointer;font-size:9px;">${m.displayName}</button>`
        ).join('') || '<div style="color:#666;">No one met yet</div>';
      }
      return `<div style="border:1px solid #664;padding:4px;margin:4px 0;background:#110818;">
        <span style="color:#f88;">${t.type}</span>
        <button class="tl-rm" data-i="${i}" style="float:right;background:none;border:none;color:#f66;cursor:pointer;">×</button>
        ${extra}
      </div>`;
    }).join('');

    el.querySelectorAll('.tl-rm').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.taglocks.splice(Number((btn as HTMLElement).dataset.i), 1);
        this.renderTaglocks(met);
      });
    });
    el.querySelectorAll('.tl-written').forEach((inp) => {
      inp.addEventListener('input', () => {
        const idx = Number((inp as HTMLInputElement).dataset.i);
        this.taglocks[idx].value = (inp as HTMLInputElement).value;
      });
    });
    el.querySelectorAll('.met-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number((btn as HTMLElement).dataset.i);
        this.taglocks[idx].playerId = (btn as HTMLElement).dataset.pid;
      });
    });
  }

  private renderHexIntents(): void {
    const el = document.getElementById('hex-intents');
    if (!el || !this.isBaneful()) return;
    el.innerHTML = `<div style="color:#f88;font-size:9px;margin-bottom:4px;">HEX INTENTS (max 3) — add matching augments below pentacle</div>` +
      HEX_INTENTS.map((h) => {
        const checked = this.hexIntents.includes(h.id);
        return `<label style="display:block;font-size:9px;margin:2px 0;color:#ccc;">
          <input type="checkbox" class="hex-int" data-id="${h.id}" ${checked ? 'checked' : ''}/> ${h.label} (needs ${h.ingredient})
        </label>`;
      }).join('');
    el.querySelectorAll('.hex-int').forEach((cb) => {
      cb.addEventListener('change', () => {
        const id = (cb as HTMLInputElement).dataset.id!;
        if ((cb as HTMLInputElement).checked) {
          if (this.hexIntents.length < 3) this.hexIntents.push(id);
          else (cb as HTMLInputElement).checked = false;
        } else {
          this.hexIntents = this.hexIntents.filter((x) => x !== id);
        }
      });
    });
  }

  private cast(): void {
    const msg = document.getElementById('altar-msg');
    if (!this.selectedSpellId) {
      if (msg) msg.textContent = 'Select a working first.';
      return;
    }
    const spell = gameState.getSpells().find((s) => s.id === this.selectedSpellId);
    if (spell && !this.isSpellUnlocked(spell)) {
      if (msg) {
        msg.textContent = `Requires Practitioner Level ${spell.minLevel ?? 1} (you are ${this.getPlayerLevel()}).`;
        msg.style.color = '#f88';
      }
      this.selectedSpellId = null;
      this.render();
      return;
    }
    let targetSelf = this.targetSelf;
    let targetPlayerId = this.targetId;

    if (!targetSelf && !targetPlayerId) {
      if (spell?.targetType === 'self' || spell?.targetType === 'apartment') {
        targetSelf = true;
      } else {
        if (msg) {
          msg.textContent = 'Choose SELF or a nearby practitioner under TARGET.';
          msg.style.color = '#f88';
        }
        return;
      }
    }

    const pentacle = this.pentacleSlots.filter((s): s is PentacleSlot => s !== null);
    network.send('cast_spell', {
      spellId: this.selectedSpellId,
      altarState: this.loadAltar(),
      pentacleSlots: pentacle,
      augmentSlots: this.augments,
      hexIntents: this.hexIntents,
      taglocks: targetSelf ? [] : this.buildCastTaglocks(),
      targetPlayerId: targetSelf ? undefined : targetPlayerId,
      targetSelf,
      timing: this.timing,
      magicOnly: this.magicOnly,
    });
    if (msg) msg.textContent = 'Working in progress...';
  }

  private onSpellResult = (e: CustomEvent<{ message: string; success: boolean }>): void => {
    if (!this.visible) return;
    const msg = document.getElementById('altar-msg');
    if (msg) {
      msg.textContent = e.detail.message;
      msg.style.color = e.detail.success ? '#8f8' : '#f88';
    }
    if (e.detail.success) {
      this.playCastAnimation();
      this.pentacleSlots = [null, null, null, null, null];
      this.augments = [];
      this.biologicalSlots = [null, null, null];
      this.drawPentacle();
      this.refreshInventorySidebar();
    } else if (e.detail.message?.includes('fizzles')) {
      this.pentacleSlots = [null, null, null, null, null];
      this.augments = [];
      this.biologicalSlots = [null, null, null];
      this.drawPentacle();
      this.refreshInventorySidebar();
    }
  };

  private playCastAnimation(): void {
    const canvas = document.getElementById('pentacle-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;pointer-events:none;z-index:9500;
      left:${canvas.getBoundingClientRect().left}px;top:${canvas.getBoundingClientRect().top}px;
      width:${canvas.width}px;height:${canvas.height}px;
      background:radial-gradient(circle,#ffcc8866 0%,#8866ff44 40%,transparent 70%);
      animation:altar-flash 1.2s ease-out forwards;
    `;
    if (!document.getElementById('altar-vfx-style')) {
      const style = document.createElement('style');
      style.id = 'altar-vfx-style';
      style.textContent = `@keyframes altar-flash{0%{opacity:0;transform:scale(0.8)}30%{opacity:1;transform:scale(1.05)}100%{opacity:0;transform:scale(1.2)}}`;
      document.head.appendChild(style);
    }
    document.body.appendChild(overlay);
    setTimeout(() => overlay.remove(), 1300);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const candleSources = this.ambiancePositions().filter((s) => s.key === 'candles');
    const incenseSources = this.ambiancePositions().filter((s) => s.key === 'incense');
    type Particle = {
      x: number;
      y: number;
      vx: number;
      vy: number;
      life: number;
      max: number;
      size: number;
      hue: number;
    };
    const particles: Particle[] = [];
    const spawnFrom = (x: number, y: number, count: number, hue: number) => {
      for (let i = 0; i < count; i++) {
        particles.push({
          x: x + (Math.random() - 0.5) * 10,
          y: y - 4,
          vx: (Math.random() - 0.5) * 0.55,
          vy: -0.6 - Math.random() * 1.1,
          life: 0,
          max: 36 + Math.floor(Math.random() * 28),
          size: 2 + Math.random() * 3.5,
          hue,
        });
      }
    };
    for (const c of candleSources) spawnFrom(c.x, c.y - c.r * 0.4, 10, 28);
    for (const c of incenseSources) spawnFrom(c.x, c.y - c.r * 0.2, 7, 210);
    if (candleSources.length === 0) {
      spawnFrom(PENTACLE.cx - 40, PENTACLE.cy - PENTACLE.innerR, 8, 28);
      spawnFrom(PENTACLE.cx + 40, PENTACLE.cy - PENTACLE.innerR, 8, 28);
    }

    let frame = 0;
    const pulse = (): void => {
      frame++;
      if (frame > 48) return;
      this.drawPentacle();
      ctx.save();
      ctx.strokeStyle = `rgba(255,204,136,${Math.max(0, 1 - frame / 28)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(PENTACLE.cx, PENTACLE.cy, PENTACLE.innerR + frame * 2.4, 0, Math.PI * 2);
      ctx.stroke();

      // Soft candle glow
      for (const c of candleSources) {
        const g = ctx.createRadialGradient(c.x, c.y, 2, c.x, c.y, 22);
        g.addColorStop(0, `rgba(255,210,120,${0.55 * (1 - frame / 48)})`);
        g.addColorStop(1, 'rgba(255,140,40,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(c.x, c.y - 4, 22, 0, Math.PI * 2);
        ctx.fill();
      }

      // Rising smoke / incense wisps
      for (const p of particles) {
        p.life++;
        p.x += p.vx + Math.sin((p.life + frame) * 0.12) * 0.2;
        p.y += p.vy;
        p.vy *= 0.992;
        const t = 1 - p.life / p.max;
        if (t <= 0) continue;
        ctx.beginPath();
        ctx.fillStyle =
          p.hue < 40
            ? `rgba(200,200,210,${0.22 * t})`
            : `rgba(160,170,220,${0.28 * t})`;
        ctx.arc(p.x, p.y, p.size * (0.7 + (1 - t) * 0.8), 0, Math.PI * 2);
        ctx.fill();
      }

      // Central ritual sparkles
      if (frame < 20) {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + frame * 0.08;
          const r = PENTACLE.innerR * 0.35 + frame * 1.5;
          ctx.fillStyle = `rgba(255,230,180,${0.55 * (1 - frame / 20)})`;
          ctx.beginPath();
          ctx.arc(PENTACLE.cx + Math.cos(a) * r, PENTACLE.cy + Math.sin(a) * r, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore();
      requestAnimationFrame(pulse);
    };
    pulse();
  }
}
