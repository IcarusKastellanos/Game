import type { PlayerStats } from '@witchcraft/shared';
import { resolveStatMax, resolveStatValue } from '@witchcraft/shared';
import type { AuraScreenViewModel, FamiliarLinkState } from './AuraViewModel';

export type AuraBand = 'critical' | 'weak' | 'stable' | 'strong' | 'radiant';

export type HealthVisualState = 'full' | 'injured' | 'wounded' | 'critical' | 'zero';

export type HealthDamageRegion =
  | 'head'
  | 'chest'
  | 'abdomen'
  | 'leftArm'
  | 'rightArm'
  | 'leftLeg'
  | 'rightLeg'
  | 'general';

export type HealthDamageType = 'physical' | 'poison' | 'magical' | 'spiritual' | 'bleeding';

/** Normalized positions over the silhouette / composition square. */
export const DAMAGE_REGION_POSITIONS: Record<HealthDamageRegion, { x: number; y: number }> = {
  head: { x: 0.5, y: 0.31 },
  chest: { x: 0.5, y: 0.43 },
  abdomen: { x: 0.5, y: 0.54 },
  leftArm: { x: 0.42, y: 0.48 },
  rightArm: { x: 0.58, y: 0.48 },
  leftLeg: { x: 0.46, y: 0.67 },
  rightLeg: { x: 0.54, y: 0.67 },
  general: { x: 0.58, y: 0.52 },
};

export interface AuraVisualizationViewModel {
  auraIntegrity: number;
  band: AuraBand;

  health: number;
  maxHealth: number;
  healthRatio: number;
  healthVisualState: HealthVisualState;
  healthCrackCount: number;
  healthDamageRegion: HealthDamageRegion;
  healthDamageType: HealthDamageType;
  healthContribution: number;

  silhouetteOpacity: number;
  silhouetteBrightness: number;
  innerRingOpacity: number;
  blueAuraOpacity: number;
  normalMoteMultiplier: number;
  soulGlowSizeScale: number;
  soulPulseSeconds: number;

  magicalEnergyRatio: number;
  staminaRatio: number;
  hungerRatio: number;

  wardLayers: number;
  wardIntegrity: number;
  wardBreached: boolean;
  wardExpiring: boolean;

  perimeterActive: boolean;
  perimeterIntegrity: number;
  perimeterBreached: boolean;

  blessings: number;
  blessingStrength: number;

  hexes: number;
  hexStrength: number;

  energeticDamage: number;
  energeticDamageRatio: number;

  showHealthCorruption: boolean;
  showHealthBreach: boolean;
  showRedVioletTint: boolean;
  ringGapCount: number;

  familiar: {
    exists: boolean;
    linked: boolean;
    name: string | null;
    integrity: number;
    state: FamiliarLinkState;
  };

  activeProtections: number;
  showAuthority: boolean;
  showWardSeal: boolean;
  showSpiritBinding: boolean;
  spiritualActivity: number;
  magicalActivity: number;
  soulGlowStrength: number;
  particleBudget: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function finiteNumber(value: unknown): number | undefined {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function ratioOf(stats: PlayerStats, key: 'health' | 'hunger' | 'stamina' | 'magicalEnergy'): number {
  const value = finiteNumber(resolveStatValue(stats, key)) ?? 0;
  const max = finiteNumber(resolveStatMax(stats, key)) ?? 100;
  return max > 0 ? clamp(value / max, 0, 1) : 0;
}

function bandOf(integrity: number): AuraBand {
  if (integrity < 0.2) return 'critical';
  if (integrity < 0.4) return 'weak';
  if (integrity < 0.7) return 'stable';
  if (integrity < 0.9) return 'strong';
  return 'radiant';
}

export function healthVisualStateOf(healthRatio: number): HealthVisualState {
  if (healthRatio <= 0) return 'zero';
  if (healthRatio <= 0.34) return 'critical';
  if (healthRatio <= 0.59) return 'wounded';
  if (healthRatio <= 0.84) return 'injured';
  return 'full';
}

export function getHealthCrackCount(healthRatio: number): number {
  if (healthRatio > 0.6) return 0;
  if (healthRatio > 0.35) return 1;
  if (healthRatio > 0.15) return 2;
  return 3;
}

function ringGapCountOf(healthRatio: number, healthState: HealthVisualState): number {
  if (healthState === 'full' || healthState === 'injured') return 0;
  if (healthState === 'wounded') return healthRatio > 0.45 ? 1 : 2;
  if (healthState === 'zero') return 3;
  return 2;
}

function inferDamageType(screen: AuraScreenViewModel, energeticDamageRatio: number): HealthDamageType {
  if (screen.hexes > 0 && energeticDamageRatio >= 0.35) return 'magical';
  if (screen.hexes > 0) return 'magical';
  if (energeticDamageRatio >= 0.55) return 'spiritual';
  return 'physical';
}

export function buildAuraVisualizationViewModel(
  screen: AuraScreenViewModel,
  stats: PlayerStats,
  options?: {
    damageRegion?: HealthDamageRegion;
    damageType?: HealthDamageType;
  }
): AuraVisualizationViewModel {
  const health = Math.round(finiteNumber(resolveStatValue(stats, 'health')) ?? 0);
  const maxHealth = Math.max(1, Math.round(finiteNumber(resolveStatMax(stats, 'health')) ?? 100));
  const healthRatio = maxHealth > 0 ? clamp(health / maxHealth, 0, 1) : 0;
  const healthVisualState = healthVisualStateOf(healthRatio);
  const healthCrackCount = getHealthCrackCount(healthRatio);
  const healthContribution = healthRatio;

  const magicalEnergyRatio = ratioOf(stats, 'magicalEnergy');
  const staminaRatio = ratioOf(stats, 'stamina');
  const hungerRatio = ratioOf(stats, 'hunger');

  const perimeterActive = screen.perimeterStrength > 0;
  const perimeterIntegrity = perimeterActive
    ? clamp(screen.perimeterStrength / Math.max(100, screen.perimeterStrength), 0.35, 1)
    : 0;

  const wardLayers = Math.max(0, Math.round(screen.wardLayers));
  const wardIntegrity =
    wardLayers > 0
      ? clamp(0.45 + Math.min(wardLayers, 4) * 0.12 - screen.energeticDamage / 250, 0.1, 1)
      : 0;
  const wardBreached = screen.hexes > 0 && wardLayers === 0;
  const perimeterBreached = wardBreached && !perimeterActive;

  const blessingStrength = clamp(screen.blessings * 0.28, 0, 1);
  const hexStrength = clamp(screen.hexes * 0.34, 0, 1);
  const energeticDamage = clamp(finiteNumber(screen.energeticDamage) ?? 0, 0, 100);
  const energeticDamageRatio = energeticDamage / 100;

  const hungerPenalty = hungerRatio < 0.2 ? (0.2 - hungerRatio) / 0.2 : 0;

  // Display-only integrity — health is a major contributor and cannot be ignored.
  const auraIntegrity = clamp(
    healthRatio * 0.28 +
      magicalEnergyRatio * 0.3 +
      staminaRatio * 0.1 +
      wardIntegrity * 0.12 +
      perimeterIntegrity * 0.08 +
      blessingStrength * 0.12 -
      energeticDamageRatio * 0.28 -
      hexStrength * 0.22 -
      hungerPenalty * 0.08,
    0,
    1
  );

  const famState = screen.familiarLink.state;
  const familiarExists = famState !== 'unlinked';
  const spiritualActivity = clamp(
    (famState === 'linked' ? 0.45 : famState === 'weakened' || famState === 'distant' ? 0.25 : 0) +
      hexStrength * 0.2 +
      blessingStrength * 0.15,
    0,
    1
  );

  // High Magical Energy cannot fully brighten the soul when health is near zero.
  const soulGlowStrength = clamp(
    healthRatio * 0.35 +
      magicalEnergyRatio * 0.45 +
      blessingStrength * 0.15 -
      energeticDamageRatio * 0.2 -
      hexStrength * 0.1 -
      (hungerRatio < 0.25 ? (0.25 - hungerRatio) * 0.15 : 0),
    0.05,
    1
  );

  const silhouetteOpacity = lerp(0.32, 1, healthRatio) * lerp(0.92, 1, staminaRatio);
  const silhouetteBrightness =
    lerp(0.55, 1.15, healthRatio) * lerp(0.9, 1, Math.min(1, staminaRatio + 0.2));

  const innerRingOpacity = clamp(0.2 + auraIntegrity * 0.5 + healthRatio * 0.3, 0.15, 1);

  const blueAuraOpacity = clamp(0.05 + magicalEnergyRatio * 0.25 + healthRatio * 0.18, 0.05, 0.42);

  const normalMoteMultiplier = lerp(0.25, 1, healthRatio);

  const soulGlowSizeScale = lerp(0.55, 1.05, soulGlowStrength);
  const soulPulseSeconds = lerp(5.8, 2.4, soulGlowStrength * healthRatio);

  const healthDamageType = options?.damageType ?? inferDamageType(screen, energeticDamageRatio);
  const healthDamageRegion = options?.damageRegion ?? 'general';

  const showHealthCorruption =
    healthRatio <= 0.2 &&
    (energeticDamageRatio >= 0.5 || hexStrength > 0.3 || healthDamageType === 'magical' || healthDamageType === 'spiritual');

  const showHealthBreach =
    healthRatio <= 0.34 &&
    (energeticDamageRatio >= 0.7 || wardBreached || perimeterBreached || healthDamageType === 'spiritual');

  const showRedVioletTint = healthRatio <= 0.84 && healthRatio > 0;
  const ringGapCount = ringGapCountOf(healthRatio, healthVisualState);

  const band = bandOf(auraIntegrity);
  const baseParticles =
    band === 'critical' ? 3 : band === 'weak' ? 5 : band === 'stable' ? 7 : band === 'strong' ? 11 : 15;
  const particleBudget = Math.max(
    1,
    Math.round(
      (baseParticles + Math.round(blessingStrength * 2) + Math.round(hexStrength * 2)) * normalMoteMultiplier
    )
  );

  return {
    auraIntegrity,
    band,
    health,
    maxHealth,
    healthRatio,
    healthVisualState,
    healthCrackCount,
    healthDamageRegion,
    healthDamageType,
    healthContribution,
    silhouetteOpacity,
    silhouetteBrightness,
    innerRingOpacity,
    blueAuraOpacity,
    normalMoteMultiplier,
    soulGlowSizeScale,
    soulPulseSeconds,
    magicalEnergyRatio,
    staminaRatio,
    hungerRatio,
    wardLayers,
    wardIntegrity,
    wardBreached,
    wardExpiring: false,
    perimeterActive,
    perimeterIntegrity,
    perimeterBreached,
    blessings: screen.blessings,
    blessingStrength,
    hexes: screen.hexes,
    hexStrength,
    energeticDamage,
    energeticDamageRatio,
    showHealthCorruption,
    showHealthBreach,
    showRedVioletTint,
    ringGapCount,
    familiar: {
      exists: familiarExists,
      linked: screen.familiarLink.linked,
      name: screen.familiarLink.familiarName,
      integrity: screen.familiarLink.integrity,
      state: famState,
    },
    activeProtections: screen.activeProtections,
    showAuthority: screen.activeProtections > 0 && blessingStrength > 0.2,
    showWardSeal: wardLayers > 0 || perimeterActive,
    showSpiritBinding: hexStrength > 0.3 || spiritualActivity > 0.55,
    spiritualActivity,
    magicalActivity: magicalEnergyRatio,
    soulGlowStrength,
    particleBudget,
  };
}
