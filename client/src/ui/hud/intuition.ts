/**
 * Intuition Meter detection & visual logic.
 *
 * The pure, DOM-free logic lives in the shared package so the in-game widget and
 * the admin preview simulator stay in sync. This module simply re-exports it for
 * client-local imports.
 */
export {
  clamp,
  lerp,
  normalizeStat,
  canDetectSource,
  perceivedSourceStrength,
  combineDetection,
  strengthToState,
  pulseDurationForStrength,
  visualsForStrength,
} from '@witchcraft/shared';
export type {
  IntuitionState,
  IntuitionSource,
  IntuitionPlayer,
  IntuitionVisuals,
} from '@witchcraft/shared';
