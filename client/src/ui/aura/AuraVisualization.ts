import {
  AURA_ASSETS,
  AURA_Z_INDEX,
  NODE_POSITIONS,
  SIGIL_POSITIONS,
} from './aura-viz-assets';
import {
  DAMAGE_REGION_POSITIONS,
  getHealthCrackCount,
  healthVisualStateOf,
  type AuraVisualizationViewModel,
  type HealthDamageRegion,
  type HealthVisualState,
} from './aura-viz-view-model';

export interface AuraCompositionSizes {
  auraSize: number;
  occultCircle: number;
  outerPerimeter: number;
  wardRing: number;
  innerAuraRing: number;
  silhouetteHeight: number;
  chestGlow: number;
  majorNode: number;
  minorSigil: number;
  familiarNode: number;
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function measureAuraSizes(containerWidth: number, containerHeight: number): AuraCompositionSizes {
  // Container is the visualization region above the legend only. Fit one safe
  // square that fills most of that region (~78–86% width when height allows).
  const auraSize = Math.min(containerWidth * 0.9, containerHeight * 0.92);
  return {
    auraSize,
    occultCircle: auraSize,
    outerPerimeter: auraSize * 0.93,
    wardRing: auraSize * 0.82,
    innerAuraRing: auraSize * 0.64,
    silhouetteHeight: auraSize * 0.44,
    chestGlow: auraSize * 0.09,
    majorNode: auraSize * 0.11,
    minorSigil: auraSize * 0.065,
    familiarNode: auraSize * 0.105,
  };
}

function sprite(
  src: string,
  className: string,
  z: number,
  widthPx: number,
  heightPx: number | null,
  opacity: number,
  extras = '',
  tip = ''
): string {
  const tipAttr = tip ? ` data-tip="${esc(tip)}" tabindex="0" role="img"` : '';
  const h = heightPx != null ? `height:${heightPx.toFixed(1)}px;` : 'height:auto;';
  return `<img class="aura-sprite ${className}" src="${src}" alt="" draggable="false" decoding="async" style="z-index:${z};width:${widthPx.toFixed(1)}px;${h}opacity:${opacity.toFixed(3)};${extras}" onerror="this.style.display='none';if(typeof console!=='undefined')console.error('Failed to load aura asset:',this.src)"${tipAttr} />`;
}

function nodeAt(
  src: string,
  className: string,
  pos: { x: number; y: number },
  sizePx: number,
  z: number,
  opacity: number,
  tip: string,
  extraClass = ''
): string {
  return sprite(
    src,
    `node ${className} ${extraClass}`,
    z,
    sizePx,
    sizePx,
    opacity,
    `left:${(pos.x * 100).toFixed(2)}%;top:${(pos.y * 100).toFixed(2)}%;`,
    tip
  );
}

/** Merge smoothed display health into opacity/crack fields for rendering. */
export function applyDisplayHealth(
  vm: AuraVisualizationViewModel,
  displayHealthRatio: number
): AuraVisualizationViewModel {
  const healthRatio = clamp(displayHealthRatio, 0, 1);
  const healthVisualState = healthVisualStateOf(healthRatio);
  const healthCrackCount = getHealthCrackCount(healthRatio);
  const silhouetteOpacity = lerp(0.32, 1, healthRatio) * lerp(0.92, 1, vm.staminaRatio);
  const silhouetteBrightness =
    lerp(0.55, 1.15, healthRatio) * lerp(0.9, 1, Math.min(1, vm.staminaRatio + 0.2));
  const auraIntegrity = clamp(
    healthRatio * 0.28 +
      vm.magicalEnergyRatio * 0.3 +
      vm.staminaRatio * 0.1 +
      vm.wardIntegrity * 0.12 +
      vm.perimeterIntegrity * 0.08 +
      vm.blessingStrength * 0.12 -
      vm.energeticDamageRatio * 0.28 -
      vm.hexStrength * 0.22 -
      (vm.hungerRatio < 0.2 ? ((0.2 - vm.hungerRatio) / 0.2) * 0.08 : 0),
    0,
    1
  );
  const soulGlowStrength = clamp(
    healthRatio * 0.35 +
      vm.magicalEnergyRatio * 0.45 +
      vm.blessingStrength * 0.15 -
      vm.energeticDamageRatio * 0.2 -
      vm.hexStrength * 0.1 -
      (vm.hungerRatio < 0.25 ? (0.25 - vm.hungerRatio) * 0.15 : 0),
    0.05,
    1
  );
  const normalMoteMultiplier = lerp(0.25, 1, healthRatio);
  const ringGapCount =
    healthVisualState === 'full' || healthVisualState === 'injured'
      ? 0
      : healthVisualState === 'wounded'
        ? healthRatio > 0.45
          ? 1
          : 2
        : healthVisualState === 'zero'
          ? 3
          : 2;
  const band =
    auraIntegrity < 0.2
      ? 'critical'
      : auraIntegrity < 0.4
        ? 'weak'
        : auraIntegrity < 0.7
          ? 'stable'
          : auraIntegrity < 0.9
            ? 'strong'
            : 'radiant';
  const baseParticles =
    band === 'critical' ? 3 : band === 'weak' ? 5 : band === 'stable' ? 7 : band === 'strong' ? 11 : 15;
  const particleBudget = Math.max(
    1,
    Math.round(
      (baseParticles + Math.round(vm.blessingStrength * 2) + Math.round(vm.hexStrength * 2)) *
        normalMoteMultiplier
    )
  );

  return {
    ...vm,
    healthRatio,
    healthVisualState,
    healthCrackCount,
    healthContribution: healthRatio,
    silhouetteOpacity,
    silhouetteBrightness,
    auraIntegrity,
    band,
    soulGlowStrength,
    soulGlowSizeScale: lerp(0.55, 1.05, soulGlowStrength),
    soulPulseSeconds: lerp(5.8, 2.4, soulGlowStrength * healthRatio),
    innerRingOpacity: clamp(0.2 + auraIntegrity * 0.5 + healthRatio * 0.3, 0.15, 1),
    blueAuraOpacity: clamp(0.05 + vm.magicalEnergyRatio * 0.25 + healthRatio * 0.18, 0.05, 0.42),
    normalMoteMultiplier,
    particleBudget,
    showHealthCorruption:
      healthRatio <= 0.2 &&
      (vm.energeticDamageRatio >= 0.5 ||
        vm.hexStrength > 0.3 ||
        vm.healthDamageType === 'magical' ||
        vm.healthDamageType === 'spiritual'),
    showHealthBreach:
      healthRatio <= 0.34 &&
      (vm.energeticDamageRatio >= 0.7 ||
        vm.wardBreached ||
        vm.perimeterBreached ||
        vm.healthDamageType === 'spiritual'),
    showRedVioletTint: healthRatio <= 0.84 && healthRatio > 0,
    ringGapCount,
  };
}

function physicalStateLabel(state: HealthVisualState): string {
  switch (state) {
    case 'full':
      return 'Intact';
    case 'injured':
      return 'Injured';
    case 'wounded':
      return 'Wounded';
    case 'critical':
      return 'Critical';
    case 'zero':
      return 'Extinguished';
  }
}

function crackOffsets(count: number): Array<{ dx: number; dy: number; flip: boolean; scale: number }> {
  const catalog = [
    { dx: -0.04, dy: -0.02, flip: false, scale: 1 },
    { dx: 0.05, dy: 0.04, flip: true, scale: 0.88 },
    { dx: -0.02, dy: 0.08, flip: false, scale: 0.75 },
  ];
  return catalog.slice(0, count);
}

function ringGapOverlays(count: number, sizes: AuraCompositionSizes, opacity: number): string {
  if (count <= 0) return '';
  const angles = [18, 140, 250];
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const angle = ((angles[i] ?? i * 110) * Math.PI) / 180;
    const r = 28;
    const x = 50 + Math.cos(angle) * r;
    const y = 50 + Math.sin(angle) * r * 0.92;
    parts.push(
      sprite(
        AURA_ASSETS.energeticDamageCrack,
        'ring-gap',
        AURA_Z_INDEX.damage,
        sizes.auraSize * 0.1,
        sizes.auraSize * 0.1,
        opacity,
        `left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;transform:translate(-50%,-50%) rotate(${angles[i] ?? 0}deg);`
      )
    );
  }
  return parts.join('');
}

function leakMotes(
  vm: AuraVisualizationViewModel,
  sizes: AuraCompositionSizes,
  region: { x: number; y: number },
  reduceMotion: boolean
): string {
  if (reduceMotion || vm.healthRatio > 0.59) return '';
  const n = vm.healthRatio <= 0.34 ? 3 : 2;
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = (region.x + (i - 1) * 0.035) * 100;
    const y = (region.y - 0.02 - i * 0.025) * 100;
    parts.push(
      sprite(
        AURA_ASSETS.blueMagicalMotes,
        'leak-mote',
        AURA_Z_INDEX.foregroundParticles,
        sizes.auraSize * 0.035,
        sizes.auraSize * 0.035,
        0.22 + i * 0.05,
        `left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;filter:hue-rotate(-25deg) saturate(1.35) brightness(0.85);--mote-delay:${(i * 0.7).toFixed(1)}s;`
      )
    );
  }
  return parts.join('');
}

function moteCount(vm: AuraVisualizationViewModel, reduceMotion: boolean): number {
  const base =
    vm.band === 'radiant' ? 15 : vm.band === 'strong' ? 11 : vm.band === 'stable' ? 7 : 5;
  const n = Math.min(vm.particleBudget, Math.round(base * vm.normalMoteMultiplier));
  if (vm.healthVisualState === 'zero') return reduceMotion ? 0 : Math.min(2, n);
  return reduceMotion ? Math.max(vm.healthRatio > 0.2 ? 2 : 0, Math.floor(n * 0.25)) : n;
}

function buildMotes(
  vm: AuraVisualizationViewModel,
  sizes: AuraCompositionSizes,
  reduceMotion: boolean
): string {
  const count = moteCount(vm, reduceMotion);
  const parts: string[] = [];
  const staminaSlow = vm.staminaRatio < 0.35 ? 1.35 : 1;
  for (let i = 0; i < count; i++) {
    const angle = (i / Math.max(1, count)) * Math.PI * 2 + 0.35;
    const radius = 22 + (i % 5) * 5.5;
    const x = 50 + Math.cos(angle) * radius;
    const y = 50 + Math.sin(angle) * radius * 0.9;
    const size = clamp(sizes.auraSize * (0.045 + (i % 3) * 0.01), 8, 22);
    const delay = ((i * 0.41) % 5).toFixed(2);
    const opacity = (0.18 + (i % 4) * 0.05) * lerp(0.55, 1, vm.healthRatio);
    parts.push(
      sprite(
        AURA_ASSETS.blueMagicalMotes,
        'mote',
        AURA_Z_INDEX.foregroundParticles,
        size,
        size,
        opacity,
        `left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;--mote-delay:${delay}s;--mote-duration:${(4.8 * staminaSlow).toFixed(2)}s;`
      )
    );
  }
  return parts.join('');
}

function healInwardMotes(
  vm: AuraVisualizationViewModel,
  sizes: AuraCompositionSizes,
  healing: boolean,
  reduceMotion: boolean
): string {
  if (!healing || reduceMotion || vm.healthRatio < 0.15) return '';
  const parts: string[] = [];
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const x = 50 + Math.cos(angle) * 18;
    const y = 48 + Math.sin(angle) * 14;
    parts.push(
      sprite(
        AURA_ASSETS.blueMagicalMotes,
        'heal-mote',
        AURA_Z_INDEX.glints,
        sizes.auraSize * 0.04,
        sizes.auraSize * 0.04,
        0.35,
        `left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;`
      )
    );
  }
  return parts.join('');
}

/** Build layered aura visualization markup from normalized VM + measured sizes. */
export function buildAuraVisualizationHtml(
  vm: AuraVisualizationViewModel,
  sizes: AuraCompositionSizes,
  reduceMotion = false,
  fx: { impact?: boolean; healing?: boolean } = {}
): string {
  const motion = reduceMotion ? 'reduce-motion' : '';
  const healthClass = `health-${vm.healthVisualState}`;
  const periOpacity = vm.perimeterActive ? 0.55 + vm.perimeterIntegrity * 0.35 : 0.12;
  const wardOpacity = vm.wardLayers > 0 ? 0.5 + vm.wardIntegrity * 0.45 : 0.1;
  const innerOpacity = vm.innerRingOpacity;
  const silOpacity = vm.silhouetteOpacity;
  const purpleBurst = clamp(0.08 + vm.auraIntegrity * 0.1, 0.06, 0.18);
  const blueBurst = vm.blueAuraOpacity;
  const soulOpacity = clamp(0.2 + vm.soulGlowStrength * 0.7, 0.08, 1);
  const chestSize = sizes.chestGlow * vm.soulGlowSizeScale;

  const regionKey: HealthDamageRegion = vm.healthDamageRegion;
  const region = DAMAGE_REGION_POSITIONS[regionKey] ?? DAMAGE_REGION_POSITIONS.general;

  const tipAura =
    `Health: ${vm.health}/${vm.maxHealth}\n` +
    `Physical Aura State: ${physicalStateLabel(vm.healthVisualState)}\n` +
    `Aura Integrity Contribution: ${Math.round(vm.healthContribution * 100)}%\n` +
    `Health-related fractures: ${vm.healthCrackCount}\n` +
    `Aura Integrity: ${Math.round(vm.auraIntegrity * 100)}%\n` +
    `Band: ${vm.band}\n` +
    `Magical Energy: ${Math.round(vm.magicalEnergyRatio * 100)}%`;

  const tipWard = `Ward Layers: ${vm.wardLayers}\nWard Integrity: ${Math.round(vm.wardIntegrity * 100)}%\nBreached: ${vm.wardBreached ? 'yes' : 'no'}`;
  const tipPerim = `Perimeter: ${vm.perimeterActive ? 'Active' : 'Inactive'}\nIntegrity: ${Math.round(vm.perimeterIntegrity * 100)}%`;
  const tipFam = vm.familiar.exists
    ? `Familiar Link: ${Math.round(vm.familiar.integrity * 100)}% · ${vm.familiar.name ?? 'bound'}\nState: ${vm.familiar.state}`
    : 'Familiar Link: none';

  const protectionSrc =
    vm.activeProtections > 0 ? AURA_ASSETS.protectionShieldNode : AURA_ASSETS.emptyProtectionNode;
  const protectionOpacity = vm.activeProtections > 0 ? 1 : 0.28;

  let familiarOpacity = 0.2;
  if (vm.familiar.state === 'linked') familiarOpacity = 1;
  else if (vm.familiar.state === 'weakened' || vm.familiar.state === 'distant') familiarOpacity = 0.55;
  else if (vm.familiar.state === 'blocked' || vm.familiar.state === 'offline') familiarOpacity = 0.35;

  const familiarSrc =
    vm.familiar.exists && vm.familiar.state !== 'unlinked'
      ? AURA_ASSETS.familiarLinkNode
      : AURA_ASSETS.emptyProtectionNode;

  const energeticCrackCount =
    vm.energeticDamageRatio <= 0 ? 0 : vm.energeticDamageRatio < 0.35 ? 1 : vm.energeticDamageRatio < 0.7 ? 2 : 3;
  const crackCount = Math.min(3, Math.max(vm.healthCrackCount, energeticCrackCount));
  const crackOpacityBase =
    0.28 + Math.max(vm.energeticDamageRatio, 1 - vm.healthRatio) * 0.35 * (vm.healthCrackCount > 0 ? 1 : 0.85);

  const silFilterParts = [`brightness(${vm.silhouetteBrightness.toFixed(3)})`];
  if (vm.healthVisualState === 'injured' || vm.healthVisualState === 'wounded') {
    silFilterParts.push('saturate(0.92)');
  }
  if (vm.healthVisualState === 'critical' || vm.healthVisualState === 'zero') {
    silFilterParts.push('saturate(0.75)');
  }
  if (vm.healthDamageType === 'poison' && vm.healthRatio < 0.7) {
    silFilterParts.push('hue-rotate(35deg)');
  }
  const silFilter = `filter:${silFilterParts.join(' ')};`;

  const pulseClass =
    vm.healthVisualState === 'critical' || vm.healthVisualState === 'zero'
      ? 'pulse-soul-slow'
      : vm.healthVisualState === 'wounded'
        ? 'pulse-soul-uneven'
        : 'pulse-soul';

  const silMotionClass =
    reduceMotion
      ? ''
      : vm.healthVisualState === 'critical' || vm.healthVisualState === 'zero'
        ? 'silhouette-flicker'
        : 'breathe';

  const fxClass = `${fx.impact ? 'is-impact' : ''} ${fx.healing ? 'is-healing' : ''}`.trim();

  const sigils: string[] = [];
  if (vm.wardLayers > 0) {
    sigils.push(
      nodeAt(AURA_ASSETS.wardSigilA, 'ward-sigil', SIGIL_POSITIONS.upperLeft, sizes.minorSigil, AURA_Z_INDEX.sigils, 0.8, tipWard)
    );
  }
  if (vm.wardLayers > 1) {
    sigils.push(
      nodeAt(AURA_ASSETS.wardSigilB, 'ward-sigil', SIGIL_POSITIONS.upperRight, sizes.minorSigil, AURA_Z_INDEX.sigils, 0.75, tipWard)
    );
  }
  if (vm.wardLayers > 2) {
    sigils.push(
      nodeAt(AURA_ASSETS.wardSigilC, 'ward-sigil', SIGIL_POSITIONS.lowerLeft, sizes.minorSigil, AURA_Z_INDEX.sigils, 0.75, tipWard)
    );
  }
  if (vm.showSpiritBinding) {
    sigils.push(
      nodeAt(
        AURA_ASSETS.spiritBindingSigil,
        'spirit-binding',
        SIGIL_POSITIONS.lowerRight,
        sizes.minorSigil,
        AURA_Z_INDEX.sigils,
        0.78,
        'Spirit binding active'
      )
    );
  }

  const healthCracks = crackOffsets(crackCount)
    .map((off, i) => {
      const x = (region.x + off.dx) * 100;
      const y = (region.y + off.dy) * 100;
      const size = sizes.auraSize * (0.16 - i * 0.02) * off.scale;
      const flip = off.flip ? ' flip' : '';
      const transform = off.flip
        ? `transform:translate(-50%,-50%) scaleX(-1);`
        : '';
      return sprite(
        AURA_ASSETS.energeticDamageCrack,
        `damage-crack health-crack${flip}`,
        AURA_Z_INDEX.damage,
        size,
        size,
        crackOpacityBase - i * 0.04,
        `left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;${transform}`
      );
    })
    .join('');

  const tintOverlay =
    vm.showRedVioletTint && vm.healthVisualState !== 'full'
      ? sprite(
          AURA_ASSETS.purpleAuraBurst,
          'health-tint',
          AURA_Z_INDEX.player,
          sizes.silhouetteHeight * 0.55,
          sizes.silhouetteHeight * 0.7,
          clamp(0.06 + (1 - vm.healthRatio) * 0.12, 0.06, 0.2),
          `left:${(region.x * 100).toFixed(1)}%;top:${(region.y * 100).toFixed(1)}%;filter:hue-rotate(-18deg) saturate(1.4);`
        )
      : '';

  const bleedPulse =
    vm.healthDamageType === 'bleeding' && vm.healthRatio < 0.6
      ? sprite(
          AURA_ASSETS.chestSoulGlow,
          'bleed-pulse',
          AURA_Z_INDEX.damage,
          sizes.auraSize * 0.07,
          sizes.auraSize * 0.07,
          0.22,
          `left:${(region.x * 100).toFixed(1)}%;top:${(region.y * 100).toFixed(1)}%;filter:hue-rotate(-55deg) saturate(1.6) brightness(0.7);`
        )
      : '';

  const centerYBiasPct = -1;

  return `
    <div class="aura-visualization ${motion} band-${vm.band} ${healthClass} dmg-${vm.healthDamageType} ${fxClass}" data-band="${vm.band}" data-health="${vm.healthVisualState}" style="--soul-pulse-duration:${vm.soulPulseSeconds.toFixed(2)}s;">
      <div class="aura-composition" style="width:${sizes.auraSize.toFixed(1)}px;height:${sizes.auraSize.toFixed(1)}px;--aura-center-y-bias:${centerYBiasPct}%;">
        ${sprite(
          AURA_ASSETS.occultCircleBase,
          'occult-base spin-slow',
          AURA_Z_INDEX.occultBase,
          sizes.occultCircle,
          sizes.occultCircle,
          0.8
        )}

        ${sprite(
          AURA_ASSETS.purpleAuraBurst,
          'purple-burst haze-pulse',
          AURA_Z_INDEX.backgroundAura,
          sizes.auraSize * 0.92,
          sizes.auraSize * 0.92,
          clamp(purpleBurst, 0.06, 0.18)
        )}
        ${sprite(
          AURA_ASSETS.blueAuraBurst,
          'blue-burst haze-pulse',
          AURA_Z_INDEX.backgroundAura,
          sizes.auraSize * 0.78,
          sizes.auraSize * 0.78,
          clamp(blueBurst, 0.05, 0.42)
        )}

        ${sprite(
          AURA_ASSETS.outerPerimeterRing,
          `perimeter spin-perimeter ${vm.perimeterActive ? 'is-active' : 'is-inactive'}`,
          AURA_Z_INDEX.perimeter,
          sizes.outerPerimeter,
          sizes.outerPerimeter,
          periOpacity,
          '',
          tipPerim
        )}

        ${sprite(
          AURA_ASSETS.wardRingWithSigilNodes,
          `ward-ring spin-ward ${vm.wardLayers > 0 ? 'is-active' : 'is-inactive'}`,
          AURA_Z_INDEX.wards,
          sizes.wardRing,
          sizes.wardRing,
          wardOpacity,
          '',
          tipWard
        )}

        ${sprite(
          AURA_ASSETS.innerAuraRing,
          `inner-ring pulse-aura gaps-${vm.ringGapCount}`,
          AURA_Z_INDEX.innerAura,
          sizes.innerAuraRing,
          sizes.innerAuraRing,
          innerOpacity,
          '',
          tipAura
        )}
        ${ringGapOverlays(vm.ringGapCount, sizes, clamp(0.35 + (1 - vm.healthRatio) * 0.25, 0.3, 0.65))}

        ${sprite(
          AURA_ASSETS.playerAuraSilhouette,
          `silhouette ${silMotionClass}`,
          AURA_Z_INDEX.player,
          sizes.silhouetteHeight * 0.62,
          sizes.silhouetteHeight,
          silOpacity,
          `top:48%;${silFilter}`,
          tipAura
        )}
        ${tintOverlay}
        ${bleedPulse}

        ${sprite(
          AURA_ASSETS.chestSoulGlow,
          `soul-glow ${pulseClass}${vm.healthVisualState === 'zero' ? ' is-ember' : ''}`,
          AURA_Z_INDEX.soulGlow,
          chestSize,
          chestSize,
          soulOpacity,
          'top:42%;'
        )}

        ${nodeAt(
          vm.showAuthority ? AURA_ASSETS.authorityCrownNode : AURA_ASSETS.emptyProtectionNode,
          'authority-node',
          NODE_POSITIONS.authority,
          vm.showAuthority ? sizes.majorNode : sizes.majorNode * 0.85,
          AURA_Z_INDEX.nodes,
          vm.showAuthority ? 0.95 : 0.22,
          vm.showAuthority ? 'Authority presence' : 'Authority node inactive'
        )}
        ${nodeAt(
          protectionSrc,
          'protection-node',
          NODE_POSITIONS.protection,
          sizes.majorNode,
          AURA_Z_INDEX.nodes,
          protectionOpacity,
          `Active protections: ${vm.activeProtections}`
        )}
        ${nodeAt(
          vm.showWardSeal ? AURA_ASSETS.wardRitualSealNode : AURA_ASSETS.emptyProtectionNode,
          'ward-seal',
          NODE_POSITIONS.wardSeal,
          vm.showWardSeal ? sizes.majorNode : sizes.majorNode * 0.85,
          AURA_Z_INDEX.nodes,
          vm.showWardSeal ? 0.95 : 0.22,
          tipWard
        )}
        ${nodeAt(
          familiarSrc,
          `familiar-node state-${vm.familiar.state}`,
          NODE_POSITIONS.familiar,
          sizes.familiarNode,
          AURA_Z_INDEX.nodes,
          familiarOpacity,
          tipFam,
          vm.familiar.linked ? 'is-linked' : ''
        )}

        ${sigils.join('')}

        ${
          vm.blessings > 0
            ? sprite(
                AURA_ASSETS.blessingStarburst,
                'blessing-burst pulse-mid',
                AURA_Z_INDEX.statusEffects,
                sizes.auraSize * 0.12,
                sizes.auraSize * 0.12,
                0.35 + vm.blessingStrength * 0.25,
                'top:34%;'
              )
            : ''
        }
        ${
          vm.blessings > 0
            ? sprite(
                AURA_ASSETS.smallGoldenGlint,
                'gold-glint glint',
                AURA_Z_INDEX.glints,
                sizes.auraSize * 0.055,
                sizes.auraSize * 0.055,
                0.65,
                'top:30%;left:58%;'
              )
            : ''
        }
        ${
          vm.band === 'radiant' && vm.blessings > 0 && vm.healthRatio > 0.5
            ? sprite(
                AURA_ASSETS.arcaneStarburst,
                'arcane-burst',
                AURA_Z_INDEX.glints,
                sizes.auraSize * 0.14,
                sizes.auraSize * 0.14,
                0.28,
                'top:36%;'
              )
            : ''
        }

        ${
          vm.hexes > 0
            ? sprite(
                AURA_ASSETS.hexPatternCloud,
                'hex-cloud drift',
                AURA_Z_INDEX.statusEffects,
                sizes.auraSize * 0.22,
                sizes.auraSize * 0.22,
                clamp(0.18 + vm.hexStrength * 0.28, 0.15, 0.5),
                'left:70%;top:38%;'
              )
            : ''
        }
        ${
          vm.hexes > 0
            ? sprite(
                AURA_ASSETS.verticalRuneFragment,
                'rune-vert float-up',
                AURA_Z_INDEX.foregroundParticles,
                sizes.auraSize * 0.045,
                sizes.auraSize * 0.09,
                0.4,
                'left:74%;top:55%;'
              )
            : ''
        }
        ${
          vm.hexes > 0
            ? sprite(
                AURA_ASSETS.circularRuneFragments,
                'rune-circle spin-ward',
                AURA_Z_INDEX.foregroundParticles,
                sizes.auraSize * 0.2,
                sizes.auraSize * 0.2,
                0.28,
                'left:68%;top:48%;'
              )
            : ''
        }
        ${
          vm.showHealthCorruption || vm.hexStrength >= 0.65 || vm.energeticDamageRatio >= 0.7
            ? sprite(
                AURA_ASSETS.darkCorruptionCloud,
                'corruption drift-slow',
                AURA_Z_INDEX.damage,
                sizes.auraSize * 0.28,
                sizes.auraSize * 0.28,
                clamp(
                  0.15 +
                    Math.max(vm.hexStrength, vm.energeticDamageRatio, vm.showHealthCorruption ? 0.4 : 0) *
                      0.25,
                  0.15,
                  0.45
                ),
                'left:28%;top:58%;'
              )
            : ''
        }

        ${healthCracks}
        ${leakMotes(vm, sizes, region, reduceMotion)}
        ${healInwardMotes(vm, sizes, !!fx.healing, reduceMotion)}

        ${
          vm.perimeterBreached || vm.wardBreached || vm.showHealthBreach
            ? sprite(
                AURA_ASSETS.auraBreachRing,
                'breach pulse-warn',
                AURA_Z_INDEX.damage,
                sizes.outerPerimeter * 1.02,
                sizes.outerPerimeter * 1.02,
                vm.showHealthBreach && !(vm.perimeterBreached || vm.wardBreached) ? 0.32 : 0.45
              )
            : ''
        }

        ${
          vm.spiritualActivity > 0.45
            ? sprite(
                AURA_ASSETS.spiritualVortex,
                'vortex spin-vortex',
                AURA_Z_INDEX.statusEffects,
                sizes.auraSize * 0.22,
                sizes.auraSize * 0.22,
                0.12 + vm.spiritualActivity * 0.18,
                'left:72%;top:70%;'
              )
            : ''
        }
        ${
          vm.magicalActivity > 0.45 && vm.band !== 'critical' && vm.healthRatio > 0.35
            ? sprite(
                AURA_ASSETS.floatingRuneCrystal,
                'rune-crystal float',
                AURA_Z_INDEX.foregroundParticles,
                sizes.auraSize * 0.06,
                sizes.auraSize * 0.08,
                0.45,
                'left:66%;top:30%;'
              )
            : ''
        }

        ${buildMotes(vm, sizes, reduceMotion)}
      </div>
    </div>`;
}

/** Mounted aura visualization controller — measures container, rebuilds on resize. */
export class AuraVisualizationController {
  private container: HTMLElement | null = null;
  private tipEl: HTMLElement | null = null;
  private vm: AuraVisualizationViewModel | null = null;
  private reduceMotion = false;
  private root: HTMLElement | null = null;
  private visibilityHandler: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private tipHide: (() => void) | null = null;

  private displayHealthRatio: number | null = null;
  private targetHealthRatio = 1;
  private lastTargetHealthRatio = 1;
  private hasSyncedHealth = false;
  private rafId: number | null = null;
  private lastFrameTs = 0;
  private impactUntil = 0;
  private healingUntil = 0;
  private impactPlayedForDrop = false;

  mount(
    container: HTMLElement,
    vm: AuraVisualizationViewModel,
    tipHost: HTMLElement | null,
    reduceMotion = false
  ): void {
    // Panel HTML is rebuilt often; keep smoothed health across new containers until hide/destroy.
    if (this.container !== container) {
      this.teardownObservers();
      this.container = container;
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => this.render());
        this.resizeObserver.observe(container);
      }
      this.visibilityHandler = () => {
        this.root?.classList.toggle('is-paused', document.hidden);
      };
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    this.tipEl = tipHost;
    this.reduceMotion = reduceMotion;
    this.applyViewModel(vm);
  }

  private applyViewModel(vm: AuraVisualizationViewModel): void {
    this.vm = vm;
    this.targetHealthRatio = vm.healthRatio;

    if (!this.hasSyncedHealth || this.displayHealthRatio == null || this.reduceMotion) {
      this.displayHealthRatio = vm.healthRatio;
      this.lastTargetHealthRatio = vm.healthRatio;
      this.hasSyncedHealth = true;
      this.render();
      return;
    }

    const drop = this.lastTargetHealthRatio - vm.healthRatio;
    if (drop >= 0.15 && !this.impactPlayedForDrop) {
      this.impactUntil = performance.now() + 420;
      this.impactPlayedForDrop = true;
    } else if (drop < 0.05) {
      this.impactPlayedForDrop = false;
    }

    if (vm.healthRatio - this.lastTargetHealthRatio >= 0.08) {
      this.healingUntil = performance.now() + 700;
    }
    this.lastTargetHealthRatio = vm.healthRatio;

    this.render();
    this.ensureAnimLoop();
  }

  private ensureAnimLoop(): void {
    if (this.reduceMotion || this.rafId != null) return;
    this.lastFrameTs = performance.now();
    const tick = (ts: number) => {
      this.rafId = null;
      if (!this.vm || this.displayHealthRatio == null) return;
      const dt = Math.min(0.05, Math.max(0, (ts - this.lastFrameTs) / 1000));
      this.lastFrameTs = ts;
      const prev = this.displayHealthRatio;
      this.displayHealthRatio = lerp(prev, this.targetHealthRatio, Math.min(1, dt * 3.5));
      const fxActive = ts < this.impactUntil || ts < this.healingUntil;
      if (Math.abs(this.displayHealthRatio - this.targetHealthRatio) > 0.002 || fxActive) {
        this.render();
        this.rafId = requestAnimationFrame(tick);
      } else {
        this.displayHealthRatio = this.targetHealthRatio;
        if (Math.abs(prev - this.targetHealthRatio) > 0.001) this.render();
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private render(): void {
    if (!this.container || !this.vm || this.displayHealthRatio == null) return;
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const sizes = measureAuraSizes(w, h);
    const displayVm = applyDisplayHealth(this.vm, this.displayHealthRatio);
    const now = performance.now();
    this.container.innerHTML = buildAuraVisualizationHtml(displayVm, sizes, this.reduceMotion, {
      impact: now < this.impactUntil,
      healing: now < this.healingUntil && this.displayHealthRatio < this.targetHealthRatio + 0.02,
    });
    this.root = this.container.querySelector('.aura-visualization');
    if (document.hidden) this.root?.classList.add('is-paused');
    this.bindTips();
  }

  private bindTips(): void {
    if (!this.container || !this.tipEl) return;
    const tip = this.tipEl;
    const show = (el: HTMLElement) => {
      const text = el.dataset.tip;
      if (!text) return;
      tip.textContent = text;
      tip.classList.add('is-visible');
    };
    const hide = () => tip.classList.remove('is-visible');
    this.tipHide = hide;
    this.container.querySelectorAll('[data-tip]').forEach((node) => {
      const el = node as HTMLElement;
      el.addEventListener('mouseenter', () => show(el));
      el.addEventListener('focus', () => show(el));
      el.addEventListener('mouseleave', hide);
      el.addEventListener('blur', hide);
    });
  }

  private teardownObservers(): void {
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.tipHide) {
      this.tipHide();
      this.tipHide = null;
    }
  }

  destroy(): void {
    this.teardownObservers();
    this.root = null;
    this.container = null;
    this.vm = null;
    this.displayHealthRatio = null;
    this.targetHealthRatio = 1;
    this.lastTargetHealthRatio = 1;
    this.hasSyncedHealth = false;
    this.impactUntil = 0;
    this.healingUntil = 0;
    this.impactPlayedForDrop = false;
  }
}
