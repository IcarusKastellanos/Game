import type { AuraState } from '@witchcraft/shared';
import { isActiveAuraEffect } from '@witchcraft/shared';
import type { AuraScreenViewModel } from './AuraViewModel';
import {
  auraAsset,
  auraImg,
  familiarNodeAsset,
  wardRingAsset,
  type WardRingVisual,
} from './aura-assets';

function wardVisualState(vm: AuraScreenViewModel): WardRingVisual {
  if (vm.hexes > 0 && vm.wardLayers === 0) return 'breached';
  if (vm.energeticDamage >= 50) return 'damaged';
  if (vm.wardLayers > 0) return 'active';
  return 'inactive';
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/** Layered aura diagram markup — separate PNG layers, no baked text. */
export function auraDiagramHtml(vm: AuraScreenViewModel, aura: AuraState): string {
  const wardState = wardVisualState(vm);
  const famSrc = familiarNodeAsset(vm.familiarLink.state);
  const intensity = vm.visualState.intensity;
  const mood = vm.visualState.mood;
  const auraOpacity = Math.max(0.15, Math.min(1, intensity));
  const perimeterOn = vm.perimeterStrength > 0;
  const blessings = vm.blessings > 0;
  const hexes = vm.hexes > 0;
  const damage = vm.energeticDamage > 0;

  const protectionActive = vm.activeProtections > 0;
  const blessingActive = blessings;
  const hexActive = hexes;

  return `
    <div class="aura-diagram" role="img" aria-label="Aura visualization diagram">
      ${auraImg('occult-circle-background.png', 'aura-layer occult-base', 256, 256)}
      <img class="aura-layer perimeter-ring ${perimeterOn ? 'is-active' : 'is-inactive'}" src="${auraAsset('perimeter-ring.png')}" alt="" decoding="async" style="opacity:${perimeterOn ? 0.85 : 0.25}" />
      <img class="aura-layer ward-ring is-${wardState}" src="${wardRingAsset(wardState)}" alt="" decoding="async" />
      <img class="aura-layer aura-ring mood-${mood}" src="${auraAsset('aura-ring.png')}" alt="" decoding="async" style="opacity:${auraOpacity}" />
      ${auraImg('player-aura-silhouette.png', 'aura-layer body-silhouette', 64, 96)}
      <div class="aura-nodes" aria-hidden="true">
        <img class="aura-node node-n ${blessingActive ? 'is-active' : 'is-inactive'}" src="${auraAsset('effects/blessing-glow.png')}" alt="" />
        <img class="aura-node node-e ${hexActive ? 'is-active' : 'is-inactive'}" src="${auraAsset('effects/hex-distortion.png')}" alt="" />
        <img class="aura-node node-s ${vm.familiarLink.linked ? 'is-active' : 'is-inactive'}" src="${famSrc}" alt="" />
        <img class="aura-node node-w ${protectionActive ? 'is-active' : 'is-inactive'}" src="${auraAsset('protection-node.png')}" alt="" />
      </div>
      ${damage ? `<img class="aura-effect damage" src="${auraAsset('effects/damage-distortion.png')}" alt="" style="opacity:${Math.min(1, vm.energeticDamage / 100)}" />` : ''}
      ${blessings ? `<img class="aura-effect blessing" src="${auraAsset('effects/blessing-glow.png')}" alt="" />` : ''}
      ${hexes ? `<img class="aura-effect hex" src="${auraAsset('effects/hex-distortion.png')}" alt="" />` : ''}
      <div class="aura-particles" aria-hidden="true">
        ${[0, 1, 2, 3, 4, 5].map((i) => `<img class="aura-particle" src="${auraAsset('effects/aura-particle.png')}" alt="" style="--p-i:${i}" />`).join('')}
      </div>
    </div>`;
}

export function legendItemHtml(
  iconPath: string,
  label: string,
  active: boolean,
  extraClass = ''
): string {
  return `<div class="aura-legend__item ${extraClass} ${active ? '' : 'is-off'}" role="listitem">
    ${auraImg(iconPath, 'aura-legend__marker', 14, 14)}
    <span>${esc(label)}</span>
  </div>`;
}
