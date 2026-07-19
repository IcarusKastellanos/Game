/**
 * Intuition Meter — reusable detection & visual logic.
 *
 * The meter represents the player's supernatural sensitivity to nearby magic,
 * spirits, and occult disturbances. This module is deliberately free of DOM so
 * it can be reused by the in-game widget and the admin preview simulator.
 */

export type IntuitionState = 'dormant' | 'faint' | 'active' | 'strong' | 'overwhelming';

/** A single perceivable magical / spiritual source in the world. */
export interface IntuitionSource {
  /** 0..1 magical activity intensity at the source. */
  magicActivity: number;
  /** 0..1 spiritual activity intensity at the source. */
  spiritActivity: number;
  /** Distance from the player, in the same units as `detectionRadius`. */
  distance: number;
  /** Beyond this distance the source is imperceptible. */
  detectionRadius: number;
  /** 0..1 how well the source is hidden (raises the perception threshold). */
  concealment?: number;
  /** Lifecycle of the source — affects how strongly it registers. */
  status?: 'concealed' | 'dormant' | 'hostile' | 'active';
}

/** Player-side + environmental inputs used to gate and scale perception. */
export interface IntuitionPlayer {
  /** Raw player Intuition stat. */
  intuition: number;
  /** Raw player Spiritual Awareness stat. */
  spiritualAwareness: number;
  /** Sum of temporary perception buffs/debuffs (may be negative). */
  temporaryModifiers?: number;
  /** Multiplicative buff modifier (1 = neutral). */
  buffModifier?: number;
  /** 0..1 ambient interference that dampens perception. */
  interference?: number;
  /** Stat value that maps to "fully sensitive" (normalization ceiling). */
  statCeiling?: number;
}

/** Interpolatable visual parameters derived from the display strength. */
export interface IntuitionVisuals {
  glowOpacity: number;
  glowRadius: number;
  irisBrightness: number;
  runeBrightness: number;
  auraOpacity: number;
  particleRate: number;
  particleLifetime: number;
  particleSize: number;
  pulseDepth: number;
  /** Seconds; 0 disables pulsing entirely. */
  pulseDuration: number;
}

export function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

/** Normalize a raw stat to 0..1 against a ceiling. */
export function normalizeStat(v: number, ceiling = 100): number {
  if (ceiling <= 0) return 0;
  return clamp(v / ceiling, 0, 1);
}

// Detection weights (tuned so a strong nearby source with a sensitive player
// approaches — but does not trivially reach — 1.0).
const MAGIC_WEIGHT = 0.62;
const SPIRIT_WEIGHT = 0.58;
const INTUITION_WEIGHT = 0.6;
const AWARENESS_WEIGHT = 0.4;

const STATUS_MODIFIER: Record<NonNullable<IntuitionSource['status']>, number> = {
  active: 1,
  hostile: 1.1,
  dormant: 0.55,
  concealed: 0.4,
};

/**
 * Whether the player is skilled enough to perceive a given source at all.
 * A powerful but well-hidden/distant source stays invisible to a dull player.
 */
export function canDetectSource(source: IntuitionSource, player: IntuitionPlayer): boolean {
  const distancePenalty = source.detectionRadius > 0 ? (source.distance / source.detectionRadius) * 40 : 0;
  const concealment = (source.concealment ?? 0) * 60;
  const interference = (player.interference ?? 0) * 30;
  const requiredSensitivity = concealment + distancePenalty + interference;

  const playerPerception =
    player.intuition + player.spiritualAwareness + (player.temporaryModifiers ?? 0);

  return playerPerception >= requiredSensitivity;
}

/** Perceived strength (0..1) of a single source, gated by `canDetectSource`. */
export function perceivedSourceStrength(source: IntuitionSource, player: IntuitionPlayer): number {
  if (!canDetectSource(source, player)) return 0;

  const rawPresence = clamp(
    source.magicActivity * MAGIC_WEIGHT + source.spiritActivity * SPIRIT_WEIGHT,
    0,
    1.4
  );

  const distanceFactor =
    source.detectionRadius > 0 ? clamp(1 - source.distance / source.detectionRadius, 0, 1) : 1;

  const playerSensitivity = clamp(
    normalizeStat(player.intuition, player.statCeiling) * INTUITION_WEIGHT +
      normalizeStat(player.spiritualAwareness, player.statCeiling) * AWARENESS_WEIGHT,
    0,
    1
  );

  const buffModifier = player.buffModifier ?? 1;
  const interferenceModifier = clamp(1 - (player.interference ?? 0), 0.05, 1);
  const concealmentModifier = clamp(1 - (source.concealment ?? 0), 0, 1);
  const statusModifier = STATUS_MODIFIER[source.status ?? 'active'];

  return clamp(
    rawPresence *
      distanceFactor *
      playerSensitivity *
      buffModifier *
      interferenceModifier *
      concealmentModifier *
      statusModifier,
    0,
    1
  );
}

/**
 * Combine several nearby sources into a single detection strength, weighting the
 * strongest heavily and letting weaker ones contribute a diminishing amount.
 */
export function combineDetection(sources: IntuitionSource[], player: IntuitionPlayer): number {
  if (!sources.length) return 0;
  const perceived = sources
    .map((s) => perceivedSourceStrength(s, player))
    .filter((v) => v > 0)
    .sort((a, b) => b - a);
  if (!perceived.length) return 0;
  const combined =
    (perceived[0] ?? 0) + (perceived[1] ?? 0) * 0.35 + (perceived[2] ?? 0) * 0.15;
  return clamp(combined, 0, 1);
}

export function strengthToState(strength: number): IntuitionState {
  if (strength < 0.15) return 'dormant';
  if (strength < 0.35) return 'faint';
  if (strength < 0.6) return 'active';
  if (strength < 0.85) return 'strong';
  return 'overwhelming';
}

/**
 * Pulse timing per spec: activity does NOT simply pulse faster. The overwhelming
 * state slows to a heavy, oppressive breathing cycle.
 */
export function pulseDurationForStrength(strength: number): number {
  if (strength < 0.15) return 0;
  if (strength < 0.35) return 4.5;
  if (strength < 0.6) return 3.2;
  if (strength < 0.85) return 2.2;
  return 5.5;
}

/** Map a display strength (0..1) to fully interpolated visual parameters. */
export function visualsForStrength(strength: number): IntuitionVisuals {
  const s = clamp(strength, 0, 1);
  // Particles/aura should only become noticeable in the strong+ range.
  const heavy = clamp((s - 0.6) / 0.4, 0, 1);
  const mid = clamp((s - 0.35) / 0.65, 0, 1);
  return {
    glowOpacity: lerp(0, 1, s),
    glowRadius: lerp(0, 36, s),
    irisBrightness: lerp(0.35, 1.8, s),
    runeBrightness: lerp(0, 1.4, mid),
    auraOpacity: lerp(0, 0.75, heavy),
    particleRate: lerp(0, 24, heavy) * (s >= 0.35 ? 1 : 0),
    particleLifetime: lerp(0.8, 3.5, s),
    particleSize: lerp(1, 6, heavy),
    pulseDepth: lerp(0.06, 0.34, s),
    pulseDuration: pulseDurationForStrength(s),
  };
}
