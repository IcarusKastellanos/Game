import { gameState } from '../data/game-state';
import { network } from '../net/NetworkManager';
import type { FamiliarState } from '@witchcraft/shared';
import {
  describeFamiliarWardWebLayers,
  totalWardWebStrength,
  type WardWebLayerSource,
} from '@witchcraft/shared';
import { getItemIconUrl } from '../graphics/ItemIconGenerator';
import { bindDomInputs } from './input-focus';
import { FamiliarWardNetRenderer, type WardNetLayer } from '../graphics/AuraLayerRenderer';
import { escapeHtml, ledgerOverlayShell } from './ledger-chrome';

const FAMILIAR_INFO: Record<string, { gifts: string; costs: string; main: string }> = {
  cat_familiar: {
    main: 'Magical potency and protection',
    gifts: 'They raise magical energy and protection, assist strongly in ritual, and ask little day to day.',
    costs: 'They draw spirit attention, and they need to be fed.',
  },
  owl_familiar: {
    main: 'Divination and spirit sight',
    gifts: 'They sharpen divination and awareness, lengthen a working, and favor the night.',
    costs: 'Their energy is fragile, and they dislike loud rooms.',
  },
  frog_familiar: {
    main: 'Herbalism and cleansing',
    gifts: 'They help with herbs, healing, and cleansing, and they take to water.',
    costs: 'They need moisture, and baneful work is not their strength.',
  },
  rat_familiar: {
    main: 'Survival and scavenging',
    gifts: 'They steady health and hunger, find small curiosities, and know the street.',
    costs: 'Some people will not welcome them, and their loyalty starts lower.',
  },
  snake_familiar: {
    main: 'Curse-craft and venom',
    gifts: 'They strengthen curse-work, assist baneful castings, and can pierce a ward.',
    costs: 'They draw hostile spirits, and the work can pull on your morality.',
  },
};

/** Familiar onboarding and care. The ward-net canvas is the aura drawing and is left as it was. */
export class FamiliarPanel {
  private root!: HTMLDivElement;
  private scroller!: HTMLElement;
  private titleEl!: HTMLElement;
  private subtitleEl!: HTMLElement;
  private visible = false;
  private familiar: FamiliarState | null = null;
  private lastBody = '';
  private selectedTemplateId = '';
  private wardRenderer = new FamiliarWardNetRenderer();

  constructor(_scene: Phaser.Scene) {
    this.build();
    this.hide();
    window.addEventListener('game:familiar-update', this.onUpdate as EventListener);
    window.addEventListener('game:player-loaded', this.onLoaded as EventListener);
    window.addEventListener('game:player-sync', this.onPlayerSync as EventListener);
    window.addEventListener('game:apartment-wards', this.onPlayerSync as EventListener);
  }

  private layerSourceColor(source: WardWebLayerSource): string {
    const map: Record<WardWebLayerSource, string> = {
      knot: 'rgba(120, 200, 255, 0.55)',
      household: 'rgba(255, 215, 120, 0.5)',
      practitioner: 'rgba(180, 140, 255, 0.5)',
      linked: 'rgba(140, 220, 190, 0.5)',
    };
    return map[source];
  }

  private layerSourceLabel(source: WardWebLayerSource): string {
    const map: Record<WardWebLayerSource, string> = {
      knot: 'knot',
      household: 'household',
      practitioner: 'your aura',
      linked: 'cross-link',
    };
    return map[source];
  }

  private onPlayerSync = (): void => {
    if (!this.visible || !this.familiar?.chosen) return;
    this.render();
  };

  private build(): void {
    this.root = document.createElement('div');
    this.root.id = 'familiar-panel';
    this.root.className = 'ledger-overlay';
    this.root.innerHTML = ledgerOverlayShell({
      kicker: 'Companion',
      title: 'A familiar',
      subtitle: 'A bond kept for life',
      foot: 'Close this page when you are done. Press F to open it again.',
    });
    document.body.appendChild(this.root);
    this.scroller = this.root.querySelector('.ledger-scroll') as HTMLElement;
    this.titleEl = this.root.querySelector('h1') as HTMLElement;
    this.subtitleEl = this.root.querySelector('.ledger-type') as HTMLElement;
    this.root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-ledger-close]')) this.hide();
    });
    this.root.addEventListener('mousedown', (event) => event.stopPropagation());
  }

  show(): void {
    this.visible = true;
    this.root.classList.add('is-open');
    if (gameState.familiar) this.familiar = gameState.familiar;
    this.render();
  }

  hide(): void {
    this.visible = false;
    this.lastBody = '';
    this.root.classList.remove('is-open');
    this.wardRenderer.stop();
    if (this.scroller) this.scroller.innerHTML = '';
    if (gameState.activeUI === 'familiar') gameState.activeUI = 'none';
  }

  private onLoaded = (e: CustomEvent<{ familiar?: FamiliarState }>): void => {
    if (e.detail.familiar) this.familiar = e.detail.familiar as FamiliarState;
  };

  private onUpdate = (e: CustomEvent<{ familiar: FamiliarState }>): void => {
    this.familiar = e.detail.familiar;
    if (this.visible) this.render();
  };

  private render(): void {
    if (!this.familiar?.chosen) {
      this.renderChooser();
      return;
    }
    this.renderCare();
  }

  private setPage(title: string, subtitle: string, body: string, bind: () => void): void {
    this.titleEl.textContent = title;
    this.subtitleEl.textContent = subtitle;
    this.root.querySelector('.ledger-frame')?.setAttribute('aria-label', title);
    if (body === this.lastBody) return;
    const scrollTop = this.scroller.scrollTop;
    this.wardRenderer.stop();
    this.scroller.innerHTML = body;
    this.lastBody = body;
    bind();
    const restore = (): void => {
      if (!this.visible || !this.scroller.isConnected) return;
      const max = Math.max(0, this.scroller.scrollHeight - this.scroller.clientHeight);
      this.scroller.scrollTop = Math.min(scrollTop, max);
    };
    restore();
    requestAnimationFrame(restore);
  }

  private renderChooser(): void {
    const templates = gameState.content?.familiars ?? [];
    const cards = templates.map((t) => {
      const info = FAMILIAR_INFO[t.id] ?? {
        main: t.description,
        gifts: t.description,
        costs: '',
      };
      const icon = getItemIconUrl(`familiar_${t.species}`, 'familiar_care', t.species);
      const species = t.species.charAt(0).toUpperCase() + t.species.slice(1);
      return `
        <article class="ledger-familiar" data-id="${escapeHtml(t.id)}">
          <header>
            <img class="fam-icon" src="${icon}" alt="" />
            <div>
              <span class="k">${escapeHtml(species)}</span>
              <h3>${escapeHtml(info.main)}</h3>
            </div>
          </header>
          <p>${escapeHtml(info.gifts)}</p>
          ${info.costs ? `<p class="dim">${escapeHtml(info.costs)}</p>` : ''}
          <button type="button" class="ledger-choice fam-pick"><span class="k">Choose</span>Name this ${escapeHtml(species.toLowerCase())}</button>
        </article>`;
    }).join('');

    this.setPage(
      'Choose a familiar',
      'A spirit housed in an animal form. This bond is for life.',
      `<p class="ledger-lead">A familiar assists in ritual, sensing, and magical work. Read what each one asks of you, then give them a true name and a name the town may hear.</p>
        <div class="fam-list">${cards || '<p class="dim">No familiars are written in the book yet.</p>'}</div>
        <div id="fam-form" class="fam-form" style="display:none">
          <h3 id="fam-form-title">Name your familiar</h3>
          <label>True name, first and last. Others do not see this.
            <input id="fam-true" placeholder="Morgana Blackwood" autocomplete="off" />
          </label>
          <label>Public name. One word, letters only.
            <input id="fam-faux" placeholder="Shadow" autocomplete="off" />
          </label>
          <button type="button" class="ledger-choice" id="fam-bind"><span class="k">Bind</span>Keep this companion</button>
        </div>`,
      () => {
        this.root.querySelectorAll('.ledger-familiar').forEach((card) => {
          card.addEventListener('click', () => {
            this.selectedTemplateId = (card as HTMLElement).dataset.id ?? '';
            this.root.querySelectorAll('.ledger-familiar').forEach((el) => el.classList.remove('is-selected'));
            card.classList.add('is-selected');
            const t = templates.find((x) => x.id === this.selectedTemplateId);
            const form = document.getElementById('fam-form');
            if (form) {
              form.style.display = 'block';
              form.scrollIntoView({ block: 'nearest' });
            }
            const title = document.getElementById('fam-form-title');
            if (title) title.textContent = `Name your ${t?.species ?? 'familiar'}`;
            document.getElementById('fam-true')?.focus();
          });
        });
        document.getElementById('fam-bind')?.addEventListener('click', () => {
          const trueName = (document.getElementById('fam-true') as HTMLInputElement | null)?.value.trim() ?? '';
          const publicName = (document.getElementById('fam-faux') as HTMLInputElement | null)?.value.trim() ?? '';
          if (!this.selectedTemplateId) return;
          network.send('choose_familiar', {
            templateId: this.selectedTemplateId,
            trueName,
            publicName,
          });
        });
        bindDomInputs(this.root);
      }
    );
  }

  private renderCare(): void {
    const f = this.familiar!;
    const info = FAMILIAR_INFO[f.templateId] ?? { main: f.species, gifts: '', costs: '' };
    const xpNeeded = 100 * f.level;
    const xpPct = Math.min(100, (f.experience / xpNeeded) * 100);
    const iconUrl = getItemIconUrl(`familiar_${f.species}`, 'familiar_care', f.species);
    const bondLeft = f.lastBondAt ? Math.max(0, 6 * 60 * 60 * 1000 - (Date.now() - f.lastBondAt)) : 0;
    const bondHrs = bondLeft > 0 ? Math.ceil(bondLeft / (60 * 60 * 1000)) : 0;
    const stats = gameState.localPlayer?.statsJson ? JSON.parse(gameState.localPlayer.statsJson) : { magicalEnergy: 0 };
    const inv = gameState.localPlayer?.inventory ?? [];
    const hasFood = inv.some((s) => s.itemId === 'familiar_food' && s.quantity > 0);
    const hasKnot = inv.some((s) => s.itemId === 'familiar_knot' && s.quantity > 0);
    const playerAura = gameState.localPlayer?.auraJson ? JSON.parse(gameState.localPlayer.auraJson) : null;
    const inApartment = gameState.currentScene === 'apartment' && !gameState.visitingHostSessionId;
    const webLayers = describeFamiliarWardWebLayers(
      f,
      playerAura,
      gameState.apartmentWards,
      inApartment
    );
    const webStrength = totalWardWebStrength(webLayers);
    const species = f.species.charAt(0).toUpperCase() + f.species.slice(1);

    const actions: { id: string; kicker: string; label: string; hint: string; disabled: boolean }[] = [
      { id: 'feed', kicker: 'Feed', label: 'Offer familiar food', hint: 'Requires familiar food in your bag.', disabled: !hasFood },
      {
        id: 'bond',
        kicker: 'Bond',
        label: bondHrs > 0 ? `Sit with them in about ${bondHrs}h` : 'Sit with them',
        hint: bondHrs > 0 ? `The bond needs about ${bondHrs} more hours.` : 'After this, the bond rests for six hours.',
        disabled: bondHrs > 0,
      },
      { id: 'heal', kicker: 'Mend', label: 'Spend 3 magical energy', hint: 'Restores a little energy and stability.', disabled: stats.magicalEnergy < 3 },
      { id: 'protect', kicker: 'Ward', label: 'Weave a familiar knot', hint: 'A weak protection. Requires a familiar knot.', disabled: !hasKnot },
    ];

    const web = webLayers.length
      ? `<section class="ledger-section">
          <h2>Ward web</h2>
          <p>These threads are woven around ${escapeHtml(f.publicName)}. Together they hold about ${Math.round(webStrength)}.</p>
          <ul class="ledger-facts">
            ${webLayers.map((layer) => {
              const mins = layer.expiresAt && !layer.permanent
                ? `${Math.max(0, Math.round((layer.expiresAt - Date.now()) / 60000))} min left`
                : layer.permanent ? 'bound' : 'holding';
              return `<li><span class="k">${escapeHtml(layer.label)} · ${escapeHtml(this.layerSourceLabel(layer.source))}</span><strong>${Math.round(layer.strength)} · ${mins}</strong></li>`;
            }).join('')}
          </ul>
          <p class="fam-note dim">Knot wards link to your aura. Your protections mirror onto ${escapeHtml(f.publicName)}. In your sanctum, the household perimeter is shared.</p>
        </section>`
      : `<p class="fam-note dim">No ward web is active. Weave a knot, or raise household wards at the altar.</p>`;

    this.setPage(
      f.publicName || species,
      `${species} · level ${f.level}`,
      `<div class="fam-identity">
          <div class="fam-portrait">
            <img src="${iconUrl}" alt="" />
            ${webLayers.length ? '<canvas id="fam-ward-net" width="48" height="48"></canvas>' : ''}
          </div>
          <div>
            <span class="k">${escapeHtml(species)}</span>
            <p class="fam-note">Their true name is ${escapeHtml(f.trueName || 'still unspoken')}. It is not for the town to hear.</p>
            <div class="ledger-level">
              <div class="ledger-level__meta"><strong>Level ${f.level}</strong><em>${Math.round(f.experience)} / ${xpNeeded} experience</em></div>
              <div class="ledger-bar"><span style="width:${xpPct}%"></span></div>
              <p>${escapeHtml(info.main)}</p>
            </div>
          </div>
        </div>
        <ul class="ledger-facts">
          <li><span class="k">Hunger</span><strong>${Math.round(f.hunger)}</strong></li>
          <li><span class="k">Affection</span><strong>${Math.round(f.affection)}</strong></li>
          <li><span class="k">Energy</span><strong>${Math.round(f.energy)}</strong></li>
          <li><span class="k">Stability</span><strong>${Math.round(f.spiritualStability)}</strong></li>
          <li><span class="k">Loyalty</span><strong>${Math.round(f.loyalty)}</strong></li>
        </ul>
        ${web}
        <div class="fam-actions">
          ${actions.map((a) =>
            `<button type="button" class="ledger-choice fam-action" data-a="${a.id}" ${a.disabled ? 'disabled' : ''}><span class="k">${escapeHtml(a.kicker)}</span>${escapeHtml(a.label)}. ${escapeHtml(a.hint)}</button>`
          ).join('')}
        </div>`,
      () => {
        this.root.querySelectorAll('.fam-action').forEach((btn) => {
          btn.addEventListener('click', () => {
            if ((btn as HTMLButtonElement).disabled) return;
            network.send('care_familiar', { action: (btn as HTMLElement).dataset.a });
          });
        });
        requestAnimationFrame(() => {
          this.wardRenderer.stop();
          const canvas = document.getElementById('fam-ward-net') as HTMLCanvasElement | null;
          if (canvas && webLayers.length) {
            this.wardRenderer.start(canvas, (): WardNetLayer[] =>
              webLayers.map((layer) => ({
                strength: layer.strength,
                color: this.layerSourceColor(layer.source),
                label: layer.label,
              }))
            );
          }
        });
      }
    );
  }
}
