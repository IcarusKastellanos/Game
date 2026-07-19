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

const FAMILIAR_INFO: Record<string, { pros: string[]; cons: string[]; icon: string; main: string }> = {
  cat_familiar: {
    icon: '🐈',
    main: 'Magical potency & protection',
    pros: ['+ME & protection', 'Strong ritual assist', 'Low maintenance'],
    cons: ['Attracts spirit attention', 'Needs regular feeding'],
  },
  owl_familiar: {
    icon: '🦉',
    main: 'Divination & spirit sight',
    pros: ['+Divination & awareness', 'Extends spell duration', 'Night work bonus'],
    cons: ['Fragile energy', 'Dislikes loud spaces'],
  },
  frog_familiar: {
    icon: '🐸',
    main: 'Herbalism & cleansing',
    pros: ['+Herbalism & healing', 'Cleansing boost', 'Water affinity'],
    cons: ['Needs moisture', 'Weak in baneful work'],
  },
  rat_familiar: {
    icon: '🐀',
    main: 'Survival & scavenging',
    pros: ['+Health & hunger resist', 'Finds curiosities', 'Streetwise'],
    cons: ['Social stigma', 'Lower loyalty baseline'],
  },
  snake_familiar: {
    icon: '🐍',
    main: 'Curse-craft & venom',
    pros: ['+Cursecraft power', 'Baneful assist', 'Ward piercing'],
    cons: ['Attracts hostile spirits', 'Morality drift risk'],
  },
};

/** Familiar onboarding + care panel (DOM overlay) */
export class FamiliarPanel {
  private root!: HTMLDivElement;
  private visible = false;
  private familiar: FamiliarState | null = null;
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
    if (this.visible) this.render();
  };

  private build(): void {
    this.root = document.createElement('div');
    this.root.id = 'familiar-panel';
    this.root.style.cssText = `
      display:none;position:fixed;inset:0;z-index:9000;background:#0a0812ee;
      font-family:'Courier New',monospace;color:#ffeedd;overflow-y:auto;padding:16px;
    `;
    document.body.appendChild(this.root);
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  show(): void {
    this.visible = true;
    this.root.style.display = 'block';
    if (gameState.familiar) this.familiar = gameState.familiar;
    this.render();
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
    this.wardRenderer.stop();
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

  private renderChooser(): void {
    const templates = gameState.content?.familiars ?? [];
    this.root.innerHTML = `
      <button id="fam-close" style="float:right;background:#331111;border:1px solid #f66;color:#faa;cursor:pointer;padding:4px 8px;">✕</button>
      <h2 style="color:#ffcc88;text-align:center;">◆ Familiar Bond ◆</h2>
      <p style="max-width:520px;margin:12px auto;color:#ccb;text-align:center;line-height:1.5;">
        A familiar is a spirit housed within an animal form — a companion that assists the practitioner
        in ritual, sensing, and magical work. Choose wisely; this bond is for life.
      </p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;max-width:720px;margin:16px auto;">
        ${templates.map((t) => {
          const info = FAMILIAR_INFO[t.id] ?? { icon: '✨', main: t.description, pros: [], cons: [] };
          return `
          <div class="fam-card" data-id="${t.id}" style="border:1px solid #8866aa;background:#1a1025;padding:12px;cursor:pointer;border-radius:4px;">
            <div style="font-size:36px;text-align:center;">${info.icon}</div>
            <div style="color:#ffcc88;font-weight:bold;text-align:center;">${t.species.toUpperCase()}</div>
            <div style="font-size:10px;color:#aaf;margin:6px 0;">${info.main}</div>
            <div style="font-size:9px;color:#8f8;">+ ${info.pros.join(', ')}</div>
            <div style="font-size:9px;color:#f88;">− ${info.cons.join(', ')}</div>
          </div>`;
        }).join('')}
      </div>
      <div id="fam-form" style="display:none;max-width:400px;margin:16px auto;border:1px solid #8866aa;padding:16px;background:#120818;">
        <h3 id="fam-form-title" style="color:#ffcc88;"></h3>
        <label style="font-size:10px;display:block;margin:8px 0;">True Name (First & Last — hidden from others)
          <input id="fam-true" style="width:100%;padding:6px;background:#221133;border:1px solid #664;color:#fff;margin-top:4px;" placeholder="e.g. Morgana Blackwood" />
        </label>
        <label style="font-size:10px;display:block;margin:8px 0;">Faux Name (one word, letters only — public)
          <input id="fam-faux" style="width:100%;padding:6px;background:#221133;border:1px solid #664;color:#fff;margin-top:4px;" placeholder="e.g. Shadow" />
        </label>
        <button id="fam-bind" style="width:100%;margin-top:12px;padding:8px;background:#442200;border:1px solid #fc8;color:#fc8;cursor:pointer;">Bind Familiar</button>
      </div>`;

    document.getElementById('fam-close')!.onclick = () => this.hide();
    let selectedId = '';
    this.root.querySelectorAll('.fam-card').forEach((card) => {
      card.addEventListener('click', () => {
        selectedId = (card as HTMLElement).dataset.id!;
        const t = templates.find((x) => x.id === selectedId);
        (document.getElementById('fam-form')!).style.display = 'block';
        (document.getElementById('fam-form-title')!).textContent = `Name your ${t?.species ?? 'familiar'}`;
        const trueInput = document.getElementById('fam-true') as HTMLInputElement | null;
        trueInput?.focus();
      });
    });
    document.getElementById('fam-bind')!.onclick = () => {
      const trueName = (document.getElementById('fam-true') as HTMLInputElement).value.trim();
      const publicName = (document.getElementById('fam-faux') as HTMLInputElement).value.trim();
      if (!selectedId) return;
      network.send('choose_familiar', { templateId: selectedId, trueName, publicName });
    };
    bindDomInputs(this.root);
  }

  private renderCare(): void {
    const f = this.familiar!;
    const info = FAMILIAR_INFO[f.templateId] ?? { icon: '✨', main: f.species };
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

    const actions: { id: string; label: string; hint: string; disabled: boolean }[] = [
      { id: 'feed', label: 'FEED', hint: 'Requires Familiar Food', disabled: !hasFood },
      { id: 'bond', label: 'BOND', hint: bondHrs > 0 ? `Cooldown ~${bondHrs}h` : '6h cooldown after use', disabled: bondHrs > 0 },
      { id: 'heal', label: 'HEAL +1', hint: 'Costs 3 ME · heals 1 energy & stability', disabled: stats.magicalEnergy < 3 },
      { id: 'protect', label: 'PROTECT', hint: 'Requires Familiar Knot · weak ward', disabled: !hasKnot },
    ];

    this.root.innerHTML = `
      <button id="fam-close" style="float:right;background:#331111;border:1px solid #f66;color:#faa;cursor:pointer;padding:4px 8px;">✕</button>
      <div style="display:flex;gap:20px;max-width:560px;margin:20px auto;align-items:flex-start;">
        <div style="text-align:center;">
          <div style="font-size:48px;">${info.icon}</div>
          <div style="position:relative;display:inline-block;margin-top:4px;">
            <img src="${iconUrl}" width="48" height="48" style="border:1px solid #8866aa;display:block;" />
            <canvas id="fam-ward-net" width="48" height="48" style="position:absolute;inset:0;pointer-events:none;"></canvas>
          </div>
        </div>
        <div style="flex:1;">
          <h2 style="color:#ffcc88;margin:0;">${f.publicName}</h2>
          <div style="font-size:10px;color:#888;">True Name: ${f.trueName} (secret)</div>
          <div style="font-size:10px;color:#aaf;margin:4px 0;">Level ${f.level} · ${info.main}</div>
          <div style="background:#221133;height:10px;border-radius:4px;margin:8px 0;overflow:hidden;">
            <div style="background:linear-gradient(90deg,#6644aa,#ffcc88);height:100%;width:${xpPct}%;"></div>
          </div>
          <div style="font-size:9px;color:#888;">XP ${f.experience}/${xpNeeded}</div>
          <div style="font-size:9px;margin-top:8px;line-height:1.6;">
            Hunger ${Math.round(f.hunger)} · Affection ${Math.round(f.affection)} · Energy ${Math.round(f.energy)}<br/>
            Stability ${Math.round(f.spiritualStability)} · Loyalty ${Math.round(f.loyalty)}
          </div>
        </div>
      </div>
      ${webLayers.length ? `
        <div style="max-width:560px;margin:12px auto;border:1px solid #664;padding:8px;background:#0a0618;">
          <div style="color:#caf;font-size:10px;margin-bottom:6px;">◆ Ward Web (cross-linked) — total ${Math.round(webStrength)} ◆</div>
          ${webLayers.map((layer) => {
            const mins = layer.expiresAt && !layer.permanent
              ? ` · ${Math.max(0, Math.round((layer.expiresAt - Date.now()) / 60000))}m`
              : layer.permanent ? ' · bound' : '';
            return `<div style="font-size:9px;color:#bdf;">⬡ ${layer.label} — str ${Math.round(layer.strength)} · <span style="color:#8af;">${this.layerSourceLabel(layer.source)}</span>${mins}</div>`;
          }).join('')}
          <div style="font-size:8px;color:#666;margin-top:6px;">Knot wards link to your aura · your protections mirror onto ${f.publicName} · household perimeter shared in apartment</div>
        </div>
      ` : `<div style="max-width:560px;margin:12px auto;font-size:9px;color:#666;text-align:center;">No active ward web — Protect with a Knot or raise household wards at the altar.</div>`}
      <div style="text-align:center;margin-top:16px;">
        ${actions.map((a) =>
          `<button class="fam-action" data-a="${a.id}" title="${a.hint}" ${a.disabled ? 'disabled' : ''}
            style="margin:4px;padding:8px 14px;background:${a.disabled ? '#221' : '#442200'};border:1px solid ${a.disabled ? '#444' : '#fa8'};color:${a.disabled ? '#666' : '#fa8'};cursor:${a.disabled ? 'not-allowed' : 'pointer'};">
            ${a.label}
          </button>`
        ).join('')}
      </div>
      <div style="text-align:center;font-size:9px;color:#888;margin-top:8px;">Feed · Bond (6h CD) · Heal (3 ME) · Protect (Knot)</div>`;

    document.getElementById('fam-close')!.onclick = () => this.hide();
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
}
