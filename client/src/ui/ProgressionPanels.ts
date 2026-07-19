import { gameState } from '../data/game-state';
import { network } from '../net/NetworkManager';
import { formatContentLabel } from '@witchcraft/shared';
import { bindDomInputs } from './input-focus';

type CraftRecipeRow = {
  id: string;
  name: string;
  description?: string;
  inputs: { itemId: string; quantity: number }[];
  effect?: string;
  meCost?: number;
};

/** Book reading, journal, specialty, and crafting panels */
export class ProgressionPanels {
  private bookRoot!: HTMLDivElement;
  private journalRoot!: HTMLDivElement;
  private specialtyRoot!: HTMLDivElement;
  private craftRoot!: HTMLDivElement;
  private bookId = '';
  private bookPages: string[] = [];
  private bookPage = 0;

  constructor() {
    this.build();
    window.addEventListener('game:progression-update', this.onProgression as EventListener);
  }

  private build(): void {
    const style = `
      display:none;position:fixed;z-index:9600;background:#120818;border:2px solid #664;
      font-family:monospace;color:#ddd;padding:14px;border-radius:6px;max-width:420px;
    `;
    this.bookRoot = document.createElement('div');
    this.bookRoot.style.cssText = style + 'top:50%;left:50%;transform:translate(-50%,-50%);min-width:320px;';
    document.body.appendChild(this.bookRoot);

    this.journalRoot = document.createElement('div');
    this.journalRoot.style.cssText = style + 'top:60px;right:12px;width:300px;max-height:70vh;overflow:auto;';
    document.body.appendChild(this.journalRoot);

    this.specialtyRoot = document.createElement('div');
    this.specialtyRoot.style.cssText = style + 'top:50%;left:50%;transform:translate(-50%,-50%);';
    document.body.appendChild(this.specialtyRoot);

    this.craftRoot = document.createElement('div');
    this.craftRoot.style.cssText = style + 'top:50%;left:50%;transform:translate(-50%,-50%);min-width:340px;max-height:80vh;overflow:auto;';
    document.body.appendChild(this.craftRoot);
  }

  private onProgression = (): void => {
    if (this.journalRoot.style.display !== 'none') this.showJournal();
  };

  showBook(bookId: string, pages: string[], title: string): void {
    this.bookId = bookId;
    this.bookPages = pages;
    this.bookPage = 0;
    this.renderBook(title);
    this.bookRoot.style.display = 'block';
  }

  private renderBook(title: string): void {
    this.bookRoot.innerHTML = `
      <h3 style="color:#fc8;margin:0 0 8px;">📖 ${title}</h3>
      <div style="font-size:10px;line-height:1.5;white-space:pre-wrap;min-height:120px;">${this.bookPages[this.bookPage] ?? ''}</div>
      <div style="margin-top:10px;display:flex;gap:8px;">
        <button id="book-prev" style="padding:4px 8px;background:#221133;border:1px solid #664;color:#ccc;cursor:pointer;">Prev</button>
        <button id="book-next" style="padding:4px 8px;background:#221133;border:1px solid #664;color:#ccc;cursor:pointer;">Next</button>
        <button id="book-done" style="padding:4px 8px;background:#224422;border:1px solid #484;color:#afa;cursor:pointer;margin-left:auto;">Finish</button>
        <button id="book-close" style="padding:4px 8px;background:#311;border:1px solid #844;color:#faa;cursor:pointer;">✕</button>
      </div>`;
    this.bookRoot.querySelector('#book-prev')!.addEventListener('click', () => {
      this.bookPage = Math.max(0, this.bookPage - 1);
      this.renderBook(title);
    });
    this.bookRoot.querySelector('#book-next')!.addEventListener('click', () => {
      this.bookPage = Math.min(this.bookPages.length - 1, this.bookPage + 1);
      this.renderBook(title);
    });
    this.bookRoot.querySelector('#book-done')!.addEventListener('click', () => {
      network.send('read_book_complete', { bookId: this.bookId });
      this.hideBook();
    });
    this.bookRoot.querySelector('#book-close')!.addEventListener('click', () => this.hideBook());
    bindDomInputs(this.bookRoot);
  }

  hideBook(): void {
    this.bookRoot.style.display = 'none';
  }

  showJournal(): void {
    const prog = gameState.progression;
    const discovered = prog?.discoveredCorrespondences ?? [];
    const items = gameState.content?.ingredients.filter((i) => discovered.includes(i.id)) ?? [];
    this.journalRoot.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <strong style="color:#fc8;">Correspondence Journal</strong>
        <button id="journal-close" style="background:#311;border:1px solid #844;color:#faa;cursor:pointer;">✕</button>
      </div>
      ${items.length ? items.map((i) => `<div style="font-size:9px;margin:4px 0;padding:4px;background:#1a1025;">${i.name} <span style="color:#888;">(${i.category})</span></div>`).join('') : '<div style="color:#666;font-size:9px;">Read books, craft, or experiment to discover correspondences.</div>'}
      <div style="margin-top:10px;font-size:8px;color:#888;">Quests: ${Object.keys(prog?.questProgress ?? {}).length || 'none'}</div>`;
    this.journalRoot.style.display = 'block';
    this.journalRoot.querySelector('#journal-close')!.addEventListener('click', () => this.hideJournal());
  }

  hideJournal(): void {
    this.journalRoot.style.display = 'none';
  }

  toggleJournal(): void {
    if (this.journalRoot.style.display === 'none') this.showJournal();
    else this.hideJournal();
  }

  showSpecialtyOffer(traditions: string[]): void {
    this.specialtyRoot.innerHTML = `
      <h3 style="color:#fc8;">Choose Your Specialty</h3>
      <p style="font-size:9px;color:#aaa;">Your affinity has crossed the threshold — claim a magical tradition.</p>
      ${traditions.map((t) =>
        `<button class="spec-btn" data-t="${t}" style="display:block;width:100%;margin:6px 0;padding:8px;background:#221133;border:1px solid #868;color:#ddf;cursor:pointer;">${formatContentLabel(t)}</button>`
      ).join('')}
      <button id="spec-later" style="margin-top:8px;padding:4px 8px;background:#111;border:1px solid #444;color:#888;cursor:pointer;">Decide Later</button>`;
    this.specialtyRoot.style.display = 'block';
    this.specialtyRoot.querySelectorAll('.spec-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        network.send('choose_specialty', { specialty: (btn as HTMLElement).dataset.t });
        this.specialtyRoot.style.display = 'none';
      });
    });
    this.specialtyRoot.querySelector('#spec-later')!.addEventListener('click', () => {
      this.specialtyRoot.style.display = 'none';
    });
  }

  showCrafting(stationType: string, recipes: CraftRecipeRow[]): void {
    const craftLabel = (r: CraftRecipeRow) =>
      r.effect === 'pocket_spell' ? 'Prepare' : r.effect === 'enchant_knot' ? 'Enchant' : 'Craft';

    this.craftRoot.innerHTML = `
      <h3 style="color:#fc8;">${formatContentLabel(stationType)}</h3>
      ${recipes.map((r) => `
        <div style="margin:8px 0;padding:8px;background:#1a1025;border:1px solid #443;">
          <strong style="font-size:10px;">${r.name}</strong>
          <div style="font-size:8px;color:#888;">${r.description ?? ''}</div>
          <div style="font-size:8px;margin:4px 0;">Needs: ${r.inputs.map((i) => `${i.quantity}× ${i.itemId}`).join(', ')}</div>
          ${r.meCost ? `<div style="font-size:8px;color:#88a;">Costs ${r.meCost} ME</div>` : ''}
          <button class="craft-btn" data-id="${r.id}" style="padding:4px 8px;background:#224422;border:1px solid #484;color:#afa;cursor:pointer;">${craftLabel(r)}</button>
        </div>`).join('') || '<div style="color:#666;">No known recipes here.</div>'}
      ${stationType !== 'mirror' ? '' : '<div style="margin-top:10px;font-size:9px;color:#aaa;">Experiment: combine ingredients to discover hidden recipes.</div>'}
      <button id="craft-close" style="margin-top:8px;padding:4px 8px;background:#311;border:1px solid #844;color:#faa;cursor:pointer;">Close</button>`;
    this.craftRoot.style.display = 'block';
    this.craftRoot.querySelectorAll('.craft-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        network.send('craft_recipe', { recipeId: (btn as HTMLElement).dataset.id });
      });
    });
    this.craftRoot.querySelector('#craft-close')!.addEventListener('click', () => {
      this.craftRoot.style.display = 'none';
    });
  }

  hideAll(): void {
    this.hideBook();
    this.hideJournal();
    this.craftRoot.style.display = 'none';
    this.specialtyRoot.style.display = 'none';
  }
}

export const progressionPanels = new ProgressionPanels();
