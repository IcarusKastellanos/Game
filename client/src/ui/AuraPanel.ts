import Phaser from 'phaser';
import type { AuraState, StatDisplayKey } from '@witchcraft/shared';
import {
  isActiveAuraEffect,
  playerLevel,
  practitionerXpProgress,
  getMaxPlayerLevel,
  getLevelTitle,
} from '@witchcraft/shared';
import { gameState } from '../data/game-state';
import { network } from '../net/NetworkManager';
import {
  buildAuraViewModel,
  parseStats,
  type AttributeViewModel,
  type AuraScreenViewModel,
} from './aura/AuraViewModel';
import { AURA_SCREEN_LAYOUT, rectStyle, type Rect } from './aura/aura-screen-layout';
import { AuraVisualizationController } from './aura/AuraVisualization';
import { buildAuraVisualizationViewModel } from './aura/aura-viz-view-model';

interface AuraInspectionDetail {
  targetId: string;
  targetName?: string;
  aura: Partial<AuraState> & { depth?: 'surface' | 'deep' };
  depth: 'surface' | 'deep';
}

const EMPTY_AURA: AuraState = {
  alignment: 'neutral',
  moralityScore: 0,
  blessings: [],
  hexes: [],
  attachments: [],
  parasites: [],
  protections: [],
  wards: [],
  curseResidue: [],
  energeticDamage: 0,
};

const L = AURA_SCREEN_LAYOUT;
const BASE_W = L.baseResolution.width;
const BASE_H = L.baseResolution.height;

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pos(r: Rect): string {
  return rectStyle(r);
}

function familiarOverviewText(vm: AuraScreenViewModel, isOther: boolean): string {
  const fam = vm.familiarLink;
  if (isOther && !fam.linked) return 'hidden';
  if (fam.state === 'unlinked') return 'no familiar linked';
  const pct = Math.round(fam.integrity * 100);
  const name = fam.familiarName ? `  ·  ${esc(fam.familiarName)}` : '';
  if (fam.state === 'blocked') return `blocked${name}`;
  if (fam.state === 'weakened' || fam.state === 'distant') return `${pct}% weakened${name}`;
  if (fam.state === 'offline') return `offline${name}`;
  return `${pct}% linked${name}`;
}

/** Aura & Wards — static-background template with live overlays [X] */
export class AuraPanel {
  private root!: HTMLDivElement;
  private shell: HTMLDivElement | null = null;
  private visible = false;
  private mode: 'self' | 'other' = 'self';
  private inspection: AuraInspectionDetail | null = null;
  private lastFocused: HTMLElement | null = null;
  private vizController = new AuraVisualizationController();
  private scale = 1;

  constructor(_scene: Phaser.Scene) {
    this.build();
    this.hide();
    window.addEventListener('game:aura-inspection', this.onInspection as EventListener);
    window.addEventListener('game:spell-result', this.onRefresh as EventListener);
    window.addEventListener('game:player-loaded', this.onRefresh as EventListener);
    window.addEventListener('game:player-sync', this.onRefresh as EventListener);
    window.addEventListener('game:apartment-wards', this.onRefresh as EventListener);
    window.addEventListener('game:familiar-update', this.onRefresh as EventListener);
    window.addEventListener('resize', this.onResize);
  }

  private onRefresh = (): void => {
    if (this.visible && this.mode === 'self') this.render();
  };

  private onResize = (): void => {
    if (this.visible) this.applyScale();
  };

  private build(): void {
    this.root = document.createElement('div');
    this.root.id = 'aura-panel';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Your Aura — Aura & Wards');
    document.body.appendChild(this.root);
  }

  show(): void {
    this.mode = 'self';
    this.inspection = null;
    this.lastFocused = document.activeElement as HTMLElement | null;
    this.visible = true;
    this.root.classList.add('is-open');
    window.addEventListener('keydown', this.onKeyDown);
    this.render();
  }

  showTarget(targetSessionId: string, targetName: string): void {
    this.mode = 'other';
    this.lastFocused = document.activeElement as HTMLElement | null;
    this.visible = true;
    this.root.classList.add('is-open');
    window.addEventListener('keydown', this.onKeyDown);
    network.send('inspect_aura', { targetPlayerId: targetSessionId });
    this.inspection = { targetId: targetSessionId, targetName, aura: {}, depth: 'surface' };
    this.render();
  }

  hide(): void {
    this.visible = false;
    this.vizController.destroy();
    this.root.classList.remove('is-open');
    window.removeEventListener('keydown', this.onKeyDown);
    if (gameState.activeUI === 'aura') gameState.activeUI = 'none';
    if (this.lastFocused && document.contains(this.lastFocused)) {
      this.lastFocused.focus();
    }
    this.lastFocused = null;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.hide();
    }
  };

  private onInspection = (e: CustomEvent<AuraInspectionDetail>): void => {
    this.inspection = e.detail;
    if (this.visible) this.render();
  };

  private currentAura(): AuraState {
    if (this.mode === 'other' && this.inspection) {
      return { ...EMPTY_AURA, ...(this.inspection.aura as AuraState) };
    }
    if (gameState.localPlayer?.auraJson) {
      try {
        return { ...EMPTY_AURA, ...(JSON.parse(gameState.localPlayer.auraJson) as AuraState) };
      } catch {
        return { ...EMPTY_AURA };
      }
    }
    return { ...EMPTY_AURA };
  }

  private isInspectionLoading(): boolean {
    if (this.mode !== 'other' || !this.inspection) return false;
    const aura = this.inspection.aura;
    const keys = Object.keys(aura).filter((k) => k !== 'depth');
    return keys.length === 0;
  }

  private applyScale(): void {
    if (!this.shell) return;
    const pad = 16;
    const availW = Math.max(160, this.root.clientWidth - pad);
    const availH = Math.max(120, this.root.clientHeight - pad);
    this.scale = Math.min(availW / BASE_W, availH / BASE_H, 1.25);
    this.shell.style.transform = `scale(${this.scale})`;
  }

  private render(): void {
    const isOther = this.mode === 'other' && !!this.inspection;
    const loading = this.isInspectionLoading();
    const aura = this.currentAura();
    const stats = parseStats(gameState.localPlayer?.statsJson);
    const apartmentWards =
      !isOther && !gameState.visitingHostSessionId ? gameState.apartmentWards : [];

    const vm = loading
      ? null
      : buildAuraViewModel({
          aura,
          stats,
          apartmentWards,
          familiarName: gameState.familiar?.publicName ?? null,
          familiarChosen: !!gameState.familiar?.chosen,
          isOther,
          progression: isOther ? null : gameState.progression,
        });

    const viz = L.zones.auraVisualization;
    const overview = L.zones.auraOverviewValues;
    const status = L.zones.auraStatusMessage;
    const close = L.zones.closeButton;
    const dock = L.zones.actionsDock;

    this.root.innerHTML = `
      <div class="aura-screen-shell" id="aura-screen-shell">
        <img
          class="aura-screen__background"
          src="${esc(L.background)}"
          alt=""
          draggable="false"
          decoding="async"
        />
        <div class="aura-screen__dynamic-layer">
          <div class="aura-zone aura-visualization-container ${loading ? 'is-loading' : ''}" style="${pos(viz)}" id="aura-viz-zone" aria-label="Aura visualization">
            ${loading ? `<div class="aura-visualization__spinner" aria-hidden="true"></div>` : ''}
          </div>

          ${vm ? this.overviewValuesHtml(vm, isOther, overview) : ''}
          ${vm ? this.statusMessageHtml(vm, status, isOther) : this.loadingStatusHtml(status)}
          ${vm ? this.coreOverlaysHtml(vm) : ''}
          ${vm ? this.mentalOverlaysHtml(vm) : ''}
          ${vm ? this.technicalOverlaysHtml(vm) : ''}
          ${vm ? this.hitboxesHtml(vm) : ''}

          <div class="aura-zone aura-zone--interactive aura-actions-dock" style="${pos(dock)}" id="aura-actions">
            ${vm ? this.actionsHtml(aura, isOther) : ''}
          </div>

          <button
            type="button"
            class="aura-close-hitbox"
            id="aura-close"
            style="${pos(close)}"
            aria-label="Close Aura and Wards"
            title="Close (Esc)"
          ></button>

          <div class="aura-tooltip" id="aura-tooltip" role="tooltip"></div>
        </div>

        ${vm ? this.srOnlyHtml(vm, isOther) : ''}
      </div>`;

    this.shell = document.getElementById('aura-screen-shell') as HTMLDivElement | null;
    this.applyScale();
    this.wireEvents(vm);
    if (vm && !loading) this.mountVisualization(vm, stats);
    else this.vizController.destroy();
  }

  private mountVisualization(
    vm: AuraScreenViewModel,
    stats: ReturnType<typeof parseStats>
  ): void {
    const container = document.getElementById('aura-viz-zone');
    if (!container) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const vizVm = buildAuraVisualizationViewModel(vm, stats);
    const tip = document.getElementById('aura-tooltip');
    this.vizController.mount(container, vizVm, tip, reduceMotion);
  }

  private overviewValuesHtml(vm: AuraScreenViewModel, isOther: boolean, zone: Rect): string {
    const famClass =
      vm.familiarLink.linked && vm.familiarLink.state === 'linked' ? 'good' : '';
    const dmgClass = vm.energeticDamage > 0 ? 'bad' : '';
    const hexClass = vm.hexes > 0 ? 'bad' : '';
    // Upper overview panel is only ~72px — keep Level + dual reputation first so they never clip.
    return `
      <div class="aura-zone aura-overview-values" style="${pos(zone)}">
        ${isOther ? '' : this.practitionerXpOverviewHtml()}
        ${isOther ? '' : this.reputationOverviewHtml()}
        <div><span class="k">Alignment:</span> <span class="v accent">${esc(vm.alignment.label)} (${vm.alignment.value})</span>
          <span class="sep">•</span>
          <span class="k">Blessings:</span> <span class="v">${vm.blessings}</span>
          <span class="sep">•</span>
          <span class="k">Hexes:</span> <span class="v ${hexClass}">${vm.hexes}</span>
        </div>
        <div>
          <span class="k">Wards:</span> <span class="v">${vm.activeProtections}/${vm.wardLayers}</span>
          <span class="sep">•</span>
          <span class="k">Familiar:</span> <span class="v ${famClass}">${familiarOverviewText(vm, isOther)}</span>
          <span class="sep">•</span>
          <span class="k">Damage:</span> <span class="v ${dmgClass}">${vm.energeticDamage}</span>
        </div>
      </div>`;
  }

  private practitionerXpOverviewHtml(): string {
    const stats = parseStats(gameState.localPlayer?.statsJson);
    const xp = stats.experience ?? 0;
    const progress = practitionerXpProgress(xp);
    const level = playerLevel(xp);
    const max = getMaxPlayerLevel();
    const xpText = progress.isMaxLevel
      ? `MAX (${max})`
      : `${progress.xpIntoLevel}/${progress.xpToNext} XP`;
    return `<div class="aura-overview-values__progress"><span class="k">Practitioner Level</span> <span class="v accent">${level}/${max}</span> <span class="v">${esc(getLevelTitle(level))}</span> <span class="v">${xpText}</span></div>`;
  }

  private reputationOverviewHtml(): string {
    const stats = parseStats(gameState.localPlayer?.statsJson);
    const pub = Math.round(stats.publicReputation ?? stats.reputation ?? 0);
    const spi = Math.round(stats.spiritualReputation ?? 0);
    const pubCls = pub < 0 ? 'bad' : pub > 0 ? 'good' : '';
    const spiCls = spi < 0 ? 'bad' : spi > 0 ? 'good' : '';
    return `<div class="aura-overview-values__progress"><span class="k">Public</span> <span class="v ${pubCls}">${pub >= 0 ? '+' : ''}${pub}</span> <span class="sep">·</span> <span class="k">Spiritual</span> <span class="v ${spiCls}">${spi >= 0 ? '+' : ''}${spi}</span></div>`;
  }

  private recentXpStatusLine(): string {
    const recent = (gameState.progression?.recentXp ?? []).slice(-3).reverse();
    if (!recent.length) return 'Recent XP: —';
    return `Recent XP: ${recent
      .map((e) => `+${e.amount} ${e.label}${e.levelAfter > e.levelBefore ? ' ▲' : ''}`)
      .join(' · ')}`;
  }

  private statusMessageHtml(vm: AuraScreenViewModel, zone: Rect, isOther: boolean): string {
    const m = vm.statusMessage;
    const recent = isOther ? '' : this.recentXpStatusLine();
    const title = recent ? `${m.text} — ${recent}` : m.text;
    return `
      <div class="aura-zone aura-status-message sev-${m.severity}" style="${pos(zone)}" title="${esc(title)}">
        <span>${esc(m.text)}${recent ? `<br/><span class="aura-status-recent">${esc(recent)}</span>` : ''}</span>
      </div>`;
  }

  private loadingStatusHtml(zone: Rect): string {
    const name = this.inspection?.targetName ?? 'Target';
    return `
      <div class="aura-zone aura-status-message sev-info" style="${pos(zone)}" role="status">
        <span>Reading ${esc(name)}'s aura…</span>
      </div>`;
  }

  private coreOverlaysHtml(vm: AuraScreenViewModel): string {
    const byKey = new Map(vm.coreAttributes.map((a) => [a.key, a]));
    const parts: string[] = [];
    for (const key of Object.keys(L.core.rows) as Array<keyof typeof L.core.rows>) {
      const attr = byKey.get(key);
      if (!attr) continue;
      const row = L.core.rows[key];
      const badge = attr.badge ? `${esc(attr.badge)} ` : '';
      const valueText =
        attr.maxValue != null ? `${badge}${attr.value}/${attr.maxValue}` : `${badge}${attr.value}`;
      const statusClass =
        attr.status === 'critical' ? 'is-critical' : attr.status === 'debuffed' ? 'is-debuffed' : '';
      const filled = Math.round((attr.ratio ?? 0) * L.core.segments);
      const segs = Array.from({ length: L.core.segments }, (_, i) => {
        return `<span class="seg ${i < filled ? 'on' : ''}"></span>`;
      }).join('');

      parts.push(`
        <div class="aura-core-value ${statusClass}" style="left:${L.core.valueRight}px;top:${row.valueY}px;transform:translate(-100%,-50%)">${valueText}</div>
        <div class="aura-seg-fill ${key} ${statusClass}" style="left:${L.core.barX}px;top:${row.barY}px;width:${L.core.barWidth}px;height:${L.core.barHeight}px" aria-hidden="true">${segs}</div>
      `);
    }
    return parts.join('');
  }

  private mentalOverlaysHtml(vm: AuraScreenViewModel): string {
    const byKey = new Map(vm.mentalAttributes.map((a) => [a.key, a]));
    return Object.entries(L.mental.rows)
      .map(([key, row]) => {
        const attr = byKey.get(key as StatDisplayKey);
        if (!attr) return '';
        return `<div class="aura-stat-value" style="left:${L.mental.valueX}px;top:${row.y}px">${attr.value}</div>`;
      })
      .join('');
  }

  private technicalOverlaysHtml(vm: AuraScreenViewModel): string {
    const byKey = new Map(vm.technicalSkills.map((a) => [a.key, a]));
    return Object.entries(L.technical.rows)
      .map(([key, row]) => {
        const attr = byKey.get(key as StatDisplayKey);
        if (!attr) return '';
        return `<div class="aura-stat-value" style="left:${L.technical.valueX}px;top:${row.y}px">${attr.value}</div>`;
      })
      .join('');
  }

  private tipFor(attr: AttributeViewModel): string {
    const valueText =
      attr.maxValue != null ? `${attr.value}/${attr.maxValue}` : `${attr.value}`;
    const xpLine =
      attr.skillXp != null && attr.skillXpToNext != null
        ? `\nSkill XP: ${attr.skillXp}/${attr.skillXpToNext}`
        : '';
    return `${attr.label}\n\n${attr.description}\n\nCurrent: ${valueText}${xpLine}`;
  }

  private hitboxesHtml(vm: AuraScreenViewModel): string {
    const parts: string[] = [];
    const coreByKey = new Map(vm.coreAttributes.map((a) => [a.key, a]));
    for (const key of Object.keys(L.core.rows) as Array<keyof typeof L.core.rows>) {
      const attr = coreByKey.get(key);
      if (!attr) continue;
      const hb = L.core.rows[key].hitbox;
      parts.push(
        `<button type="button" class="aura-hitbox" style="${pos(hb)}" data-tip="${esc(this.tipFor(attr))}" aria-label="${esc(attr.label)}"></button>`
      );
    }

    const mentalByKey = new Map(vm.mentalAttributes.map((a) => [a.key, a]));
    for (const [key, row] of Object.entries(L.mental.rows)) {
      const attr = mentalByKey.get(key as StatDisplayKey);
      if (!attr) continue;
      const hb: Rect = {
        x: L.mental.hitboxX,
        y: row.y - L.mental.rowHeight / 2,
        width: L.mental.hitboxWidth,
        height: L.mental.rowHeight,
      };
      parts.push(
        `<button type="button" class="aura-hitbox" style="${pos(hb)}" data-tip="${esc(this.tipFor(attr))}" aria-label="${esc(attr.label)}"></button>`
      );
    }

    const techByKey = new Map(vm.technicalSkills.map((a) => [a.key, a]));
    for (const [key, row] of Object.entries(L.technical.rows)) {
      const attr = techByKey.get(key as StatDisplayKey);
      if (!attr) continue;
      const hb: Rect = {
        x: L.technical.hitboxX,
        y: row.y - L.technical.rowHeight / 2,
        width: L.technical.hitboxWidth,
        height: L.technical.rowHeight,
      };
      parts.push(
        `<button type="button" class="aura-hitbox" style="${pos(hb)}" data-tip="${esc(this.tipFor(attr))}" aria-label="${esc(attr.label)}"></button>`
      );
    }
    return parts.join('');
  }

  private actionsHtml(aura: AuraState, isOther: boolean): string {
    if (isOther) {
      return `<button type="button" class="aura-btn" id="aura-back">← Your aura</button>`;
    }
    const buttons: string[] = [];
    const now = Date.now();
    const soon = now + 15 * 60 * 1000;
    const apartmentWards = gameState.visitingHostSessionId ? [] : gameState.apartmentWards;

    for (const ward of apartmentWards) {
      const weak = ward.strength < 75;
      const expiring = ward.expiresAt != null && ward.expiresAt < soon && !ward.permanent;
      if (!weak && !expiring) continue;
      buttons.push(
        `<button type="button" class="aura-btn feed-ward" data-kind="apartment" data-id="${esc(ward.id)}">Feed ward (${Math.round(ward.strength)})</button>`
      );
    }
    for (const ward of (aura.wards ?? []).filter(isActiveAuraEffect)) {
      const weak = ward.strength < 75;
      const expiring = ward.expiresAt != null && ward.expiresAt < soon && !ward.permanent;
      if (!weak && !expiring) continue;
      const name = ward.name || ward.spellId || 'ward';
      buttons.push(
        `<button type="button" class="aura-btn feed-ward" data-kind="aura_ward" data-id="${esc(ward.id)}">Feed ${esc(name)}</button>`
      );
    }
    for (const p of gameState.nearbyPlayers) {
      buttons.push(
        `<button type="button" class="aura-btn inspect-btn" data-id="${esc(p.sessionId)}" data-name="${esc(p.displayName)}">Inspect ${esc(p.displayName)}</button>`
      );
    }
    return buttons.join('');
  }

  private srOnlyHtml(vm: AuraScreenViewModel, isOther: boolean): string {
    const title = isOther ? this.inspection?.targetName ?? 'Target' : 'Your Aura';
    return `
      <section class="aura-sr-only" aria-labelledby="aura-screen-title">
        <h1 id="aura-screen-title">${esc(title)} — Aura and Wards</h1>
        <dl>
          <dt>Alignment</dt><dd>${esc(vm.alignment.label)} (${vm.alignment.value})</dd>
          <dt>Blessings</dt><dd>${vm.blessings}</dd>
          <dt>Hexes</dt><dd>${vm.hexes}</dd>
          <dt>Active protections</dt><dd>${vm.activeProtections}</dd>
          <dt>Ward layers</dt><dd>${vm.wardLayers}</dd>
          <dt>Familiar ward web</dt><dd>${familiarOverviewText(vm, isOther)}</dd>
          <dt>Energetic damage</dt><dd>${vm.energeticDamage}</dd>
          <dt>Status</dt><dd>${esc(vm.statusMessage.text)}</dd>
          ${vm.coreAttributes.map((a) => `<dt>${esc(a.label)}</dt><dd>${a.maxValue != null ? `${a.value}/${a.maxValue}` : a.value}</dd>`).join('')}
          ${vm.mentalAttributes.map((a) => `<dt>${esc(a.label)}</dt><dd>${a.value}</dd>`).join('')}
          ${vm.technicalSkills.map((a) => `<dt>${esc(a.label)}</dt><dd>${a.value}</dd>`).join('')}
        </dl>
      </section>`;
  }

  private wireEvents(vm: AuraScreenViewModel | null): void {
    const closeBtn = document.getElementById('aura-close') as HTMLButtonElement | null;
    if (closeBtn) {
      closeBtn.onclick = () => this.hide();
      closeBtn.focus();
    }

    const back = document.getElementById('aura-back');
    if (back) back.addEventListener('click', () => this.show());

    this.root.querySelectorAll('.inspect-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const el = btn as HTMLElement;
        this.showTarget(el.dataset.id!, el.dataset.name!);
      });
    });
    this.root.querySelectorAll('.feed-ward').forEach((btn) => {
      btn.addEventListener('click', () => {
        const el = btn as HTMLElement;
        network.send('feed_ward', { targetKind: el.dataset.kind, targetId: el.dataset.id });
      });
    });

    const tip = document.getElementById('aura-tooltip');
    if (tip && vm) {
      const show = (el: HTMLElement) => {
        const text = el.dataset.tip;
        if (!text) return;
        tip.textContent = text;
        tip.classList.add('is-visible');
        const hb = el.getBoundingClientRect();
        const shell = this.shell?.getBoundingClientRect();
        if (!shell) return;
        const x = (hb.left - shell.left) / this.scale;
        const y = (hb.top - shell.top) / this.scale;
        tip.style.left = `${Math.min(BASE_W - 270, Math.max(8, x))}px`;
        tip.style.top = `${Math.max(8, y - 8)}px`;
        tip.style.transform = 'translateY(-100%)';
      };
      const hide = () => tip.classList.remove('is-visible');
      this.root.querySelectorAll('.aura-hitbox').forEach((btn) => {
        const el = btn as HTMLElement;
        el.addEventListener('mouseenter', () => show(el));
        el.addEventListener('focus', () => show(el));
        el.addEventListener('mouseleave', hide);
        el.addEventListener('blur', hide);
      });
    }
  }
}
