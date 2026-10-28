import Phaser from 'phaser';
import type { InventorySlot } from '@witchcraft/shared';
import {
  getTaglockTargetName,
  formatContentLabel,
  isEmptyInventorySlot,
  normalizeInventoryLayout,
  GRIMOIRE_MANUSCRIPT_ITEM_ID,
  NULLIFICATION_POWDER_ITEM_ID,
  readManuscriptMeta,
} from '@witchcraft/shared';
import { gameState } from '../data/game-state';
import { network } from '../net/NetworkManager';
import { getItemIconUrl } from '../graphics/ItemIconGenerator';
import { bindDomInput } from './input-focus';

/** Scrollable 8×5 inventory grid with drag-sort and taglock inscribing */
export class InventoryPanel {
  private root!: HTMLElement;
  private gridEl!: HTMLElement;
  private coinsEl!: HTMLElement;
  private inscribeModal!: HTMLElement;
  private inscribeInput!: HTMLInputElement;
  private inscribeSlotIndex: number | null = null;
  private visible = false;
  private dragFrom: number | null = null;

  constructor(_scene: Phaser.Scene) {
    this.build();
    this.hide();
    window.addEventListener('game:player-sync', this.onSync as EventListener);
  }

  show(): void {
    this.visible = true;
    this.root.style.display = 'flex';
    this.render();
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
    this.hideInscribeModal();
  }

  private onSync = (): void => {
    if (this.visible) this.render();
  };

  private build(): void {
    this.root = document.createElement('div');
    this.root.id = 'inventory-panel';
    this.root.innerHTML = `
      <div class="inventory-panel-inner">
        <header class="inventory-header">
          <h2>Practitioner's Bag</h2>
          <span class="inventory-hint">Drag to sort · Right-click written taglock to inscribe</span>
          <button type="button" class="inventory-btn wb-close" id="inv-close" aria-label="Close">✕</button>
        </header>
        <div class="inventory-scroll">
          <div class="inventory-grid" id="inv-grid"></div>
        </div>
        <footer class="inventory-footer" id="inv-coins"></footer>
      </div>
      <div class="inventory-inscribe-modal" id="inv-inscribe-modal">
        <div class="inventory-inscribe-box">
          <h3>Inscribe Written Name Taglock</h3>
          <p style="font-size:0.78rem;color:#aaa;margin:0 0 8px;">This cannot be changed once saved. Max 3 taglocks per person.</p>
          <input id="inv-inscribe-input" type="text" maxlength="48" placeholder="Target name" />
          <div class="inventory-inscribe-actions">
            <button type="button" class="inventory-btn" id="inv-inscribe-cancel">Cancel</button>
            <button type="button" class="inventory-btn" id="inv-inscribe-save">Inscribe</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(this.root);

    this.gridEl = this.root.querySelector('#inv-grid')!;
    this.coinsEl = this.root.querySelector('#inv-coins')!;
    this.inscribeModal = this.root.querySelector('#inv-inscribe-modal')!;
    this.inscribeInput = this.root.querySelector('#inv-inscribe-input') as HTMLInputElement;

    this.root.querySelector('#inv-close')!.addEventListener('click', () => this.hide());
    this.root.querySelector('#inv-inscribe-cancel')!.addEventListener('click', () => this.hideInscribeModal());
    this.root.querySelector('#inv-inscribe-save')!.addEventListener('click', () => this.submitInscribe());
    this.inscribeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.submitInscribe();
      if (e.key === 'Escape') this.hideInscribeModal();
    });
    bindDomInput(this.inscribeInput);
  }

  private getSlots(): InventorySlot[] {
    return normalizeInventoryLayout(gameState.localPlayer?.inventory ?? []);
  }

  private ingredient(itemId: string) {
    return gameState.content?.ingredients.find((i) => i.id === itemId);
  }

  private render(): void {
    const slots = this.getSlots();
    this.coinsEl.textContent = `Coins: ${gameState.localPlayer?.coins ?? 0}`;

    this.gridEl.innerHTML = slots
      .map((slot, index) => {
        if (isEmptyInventorySlot(slot)) {
          return `<div class="inventory-slot empty" data-index="${index}"></div>`;
        }
        const ing = this.ingredient(slot.itemId);
        const url = getItemIconUrl(slot.itemId, ing?.category, ing?.name, ing?.iconPixels);
        const target = getTaglockTargetName(slot);
        const manuscript = readManuscriptMeta(slot);
        const manuscriptLabel = manuscript ? manuscript.manuscriptTitle : '';
        const tagLabel = target
          ? `<span class="inventory-tag" title="${target}">${target.slice(0, 8)}</span>`
          : manuscriptLabel
            ? `<span class="inventory-tag" title="${manuscriptLabel}">${manuscriptLabel.slice(0, 8)}</span>`
            : '';
        const qty = slot.quantity > 1 ? `<span class="inventory-qty">${slot.quantity}</span>` : '';
        const title = manuscript
          ? `${manuscript.manuscriptTitle} — by ${manuscript.manuscriptAuthor}`
          : `${ing?.name ?? formatContentLabel(slot.itemId)}${target ? ` — ${target}` : ''}`;
        return `<div class="inventory-slot filled" data-index="${index}" draggable="true" title="${title}">
          ${tagLabel}
          <img src="${url}" alt="${slot.itemId}" />
          ${qty}
        </div>`;
      })
      .join('');

    this.gridEl.querySelectorAll('.inventory-slot.filled').forEach((el) => {
      const index = Number((el as HTMLElement).dataset.index);
      el.addEventListener('dragstart', (e) => {
        this.dragFrom = index;
        (e as DragEvent).dataTransfer?.setData('text/plain', String(index));
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.onSlotContextMenu(index);
      });
    });

    this.gridEl.querySelectorAll('.inventory-slot').forEach((el) => {
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        el.classList.add('drag-over');
      });
      el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('drag-over');
        const to = Number((el as HTMLElement).dataset.index);
        const from = this.dragFrom ?? Number((e as DragEvent).dataTransfer?.getData('text/plain'));
        if (Number.isFinite(from) && Number.isFinite(to)) this.swapSlots(from, to);
        this.dragFrom = null;
      });
    });
  }

  private swapSlots(from: number, to: number): void {
    if (from === to) return;
    const slots = this.getSlots();
    const tmp = slots[from];
    slots[from] = slots[to] ?? { itemId: '', quantity: 0 };
    slots[to] = tmp;
    if (gameState.localPlayer) gameState.localPlayer.inventory = slots;
    network.send('inventory_reorder', { slots });
    this.render();
  }

  private onSlotContextMenu(index: number): void {
    const slot = this.getSlots()[index];
    if (!slot?.itemId) return;

    if (slot.itemId === NULLIFICATION_POWDER_ITEM_ID) {
      if (!gameState.isAdmin) {
        window.dispatchEvent(
          new CustomEvent('game:notification', {
            detail: { message: 'Nullification Powder is restricted to admins.' },
          })
        );
        return;
      }
      if (
        !confirm(
          'Use Nullification Powder?\n\nClears all hexes, blessings, and personal protections/ward layers on you. Household perimeter wards are not affected.'
        )
      ) {
        return;
      }
      network.send('use_item', { itemId: NULLIFICATION_POWDER_ITEM_ID, quantity: 1 });
      return;
    }

    if (slot.itemId === GRIMOIRE_MANUSCRIPT_ITEM_ID) {
      const manuscript = readManuscriptMeta(slot);
      const label = manuscript?.manuscriptTitle ?? 'this manuscript';
      if (
        !confirm(
          `Take "${label}" into your grimoire Shared section?\n\nThe manuscript item will be consumed.`
        )
      ) {
        return;
      }
      network.send('use_item', { itemId: GRIMOIRE_MANUSCRIPT_ITEM_ID, quantity: 1, slotIndex: index });
      return;
    }

    const cat = gameState.content?.ingredients.find((i) => i.id === slot.itemId)?.category;
    if (cat === 'books' || cat === 'food') {
      network.send('use_item', { itemId: slot.itemId, quantity: 1 });
      return;
    }

    if (slot.itemId !== 'taglock_written_name') return;
    if (getTaglockTargetName(slot)) return;
    this.inscribeSlotIndex = index;
    this.inscribeInput.value = '';
    this.inscribeModal.style.display = 'flex';
    this.inscribeInput.focus();
  }

  private hideInscribeModal(): void {
    this.inscribeModal.style.display = 'none';
    this.inscribeSlotIndex = null;
  }

  private submitInscribe(): void {
    if (this.inscribeSlotIndex === null) return;
    const targetName = this.inscribeInput.value.trim();
    if (!targetName) return;
    network.send('inscribe_taglock', { slotIndex: this.inscribeSlotIndex, targetName });
    this.hideInscribeModal();
  }
}
