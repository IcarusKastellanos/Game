/** Configurable NPC personality. Traits color reactions; they never bypass server rules. */

export type PersonalityTrait =
  | 'friendliness'
  | 'caution'
  | 'honesty'
  | 'generosity'
  | 'curiosity'
  | 'ambition'
  | 'pride'
  | 'suspicion'
  | 'humor'
  | 'socialOpenness';

export const PERSONALITY_TRAITS: PersonalityTrait[] = [
  'friendliness',
  'caution',
  'honesty',
  'generosity',
  'curiosity',
  'ambition',
  'pride',
  'suspicion',
  'humor',
  'socialOpenness',
];

export type PersonalityProfile = Partial<Record<PersonalityTrait, number>>;

const DEFAULT_TRAIT = 50;

export function clampTrait(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TRAIT;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function parsePersonality(raw: unknown): PersonalityProfile | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: PersonalityProfile = {};
  let any = false;
  for (const trait of PERSONALITY_TRAITS) {
    const value = (raw as Record<string, unknown>)[trait];
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[trait] = clampTrait(value);
      any = true;
    }
  }
  return any ? out : undefined;
}

export function traitOf(profile: PersonalityProfile | undefined, trait: PersonalityTrait): number {
  const value = profile?.[trait];
  return typeof value === 'number' ? clampTrait(value) : DEFAULT_TRAIT;
}

/**
 * Soft gift affinity scale from generosity/suspicion.
 * Explicit gift tiers and server cooldowns still decide the outcome.
 */
export function personalityGiftAffinityScale(profile: PersonalityProfile | undefined): number {
  const generosity = traitOf(profile, 'generosity');
  const suspicion = traitOf(profile, 'suspicion');
  const friendliness = traitOf(profile, 'friendliness');
  const raw = 0.55 + generosity / 200 + friendliness / 400 - suspicion / 400;
  return Math.max(0.35, Math.min(1.65, Number(raw.toFixed(3))));
}

/** How readily an NPC shares optional lore flavor. Explicit knowledge gates still decide. */
export function personalityRumorWillingness(profile: PersonalityProfile | undefined): number {
  const curiosity = traitOf(profile, 'curiosity');
  const honesty = traitOf(profile, 'honesty');
  const caution = traitOf(profile, 'caution');
  const openness = traitOf(profile, 'socialOpenness');
  return clampTrait(Math.round((curiosity + honesty + openness - caution) / 2 + 25));
}

/** Teacher patience / willingness flavor for lesson dialogue. */
export function personalityTeachingOpenness(profile: PersonalityProfile | undefined): number {
  return clampTrait(
    Math.round(
      (traitOf(profile, 'friendliness') +
        traitOf(profile, 'curiosity') +
        traitOf(profile, 'socialOpenness') -
        traitOf(profile, 'pride') / 2) /
        2.5 +
        20
    )
  );
}

/** Prefer humorous lines when humor is high and suspicion is not. */
export function personalityPrefersHumor(profile: PersonalityProfile | undefined): boolean {
  return traitOf(profile, 'humor') >= 65 && traitOf(profile, 'suspicion') <= 55;
}

/** Prefer cautious / guarded lines when caution or suspicion is high. */
export function personalityPrefersGuard(profile: PersonalityProfile | undefined): boolean {
  return traitOf(profile, 'caution') >= 70 || traitOf(profile, 'suspicion') >= 70;
}

export function validatePersonality(
  raw: unknown
): { ok: true; personality?: PersonalityProfile } | { ok: false; error: string } {
  if (raw == null) return { ok: true };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Personality must be an object of trait scores.' };
  }
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!PERSONALITY_TRAITS.includes(key as PersonalityTrait)) {
      return { ok: false, error: `Unknown personality trait: ${key}` };
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false, error: `Personality trait ${key} must be a number.` };
    }
  }
  return { ok: true, personality: parsePersonality(raw) };
}
