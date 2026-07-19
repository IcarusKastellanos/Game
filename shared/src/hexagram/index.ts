import type { ItemCategory } from '../types/index.js';
import type { PocketSpellId } from '../progression/index.js';

export const HEXAGRAM_SOCKET_IDS = [
  'power',
  'protection',
  'communication',
  'binding',
  'influence',
  'offering',
  'core',
] as const;

export type HexagramSocketId = (typeof HEXAGRAM_SOCKET_IDS)[number];

export const HEXAGRAM_SOCKET_LABELS: Record<HexagramSocketId, string> = {
  power: 'Power',
  protection: 'Protection',
  communication: 'Communication',
  binding: 'Binding',
  influence: 'Influence',
  offering: 'Offering',
  core: 'Core',
};

export const HEXAGRAM_CATEGORIES = [
  'pocket_spell',
  'familiar_knot',
  'charm',
  'talisman',
  'binding',
  'other',
] as const;

export type HexagramCategory = (typeof HEXAGRAM_CATEGORIES)[number];

export const HEXAGRAM_CATEGORY_LABELS: Record<HexagramCategory, string> = {
  pocket_spell: 'Pocket Spell',
  familiar_knot: 'Familiar Knot',
  charm: 'Charm',
  talisman: 'Talisman',
  binding: 'Binding',
  other: 'Other',
};

export type HexagramVisualTheme =
  | 'protection'
  | 'binding'
  | 'spirit'
  | 'healing'
  | 'baneful'
  | 'dream'
  | 'neutral';

export interface HexagramSocketRequirement {
  socket: HexagramSocketId;
  itemIds?: string[];
  categories?: ItemCategory[];
  label?: string;
}

export interface HexagramAugmentDef {
  itemId: string;
  power?: number;
  stability?: number;
  backlash?: number;
  duration?: number;
  potency?: number;
  affinity?: string;
  visualHint?: HexagramVisualTheme;
}

export interface ContentHexagramRecipe {
  id: string;
  name: string;
  category: HexagramCategory;
  description: string;
  declarationTemplates: string[];
  difficulty: number;
  meCost: number;
  powerTier: number;
  preparedUses: number;
  activationMethod: string;
  durationLabel?: string;
  durationHours?: number;
  requiredSkill?: { stat: string; min: number };
  sockets: HexagramSocketRequirement[];
  augmentations?: HexagramAugmentDef[];
  effect: 'pocket_spell' | 'enchant_knot' | 'item';
  spellId?: PocketSpellId;
  enchantIntent?: 'familiar_protection' | 'ward_strength' | 'longevity';
  output?: { itemId: string; quantity: number };
  visualTheme: HexagramVisualTheme;
  stationType: 'enchanting_table';
  discoverOnCraft?: boolean;
  soundTheme?: string;
  animationSet?: string;
}

export interface HexagramEnchantPayload {
  recipeId: string;
  sockets: Partial<Record<HexagramSocketId, string>>;
  augmentations: string[];
  declaration: string;
}

export interface HexagramPreviewStats {
  stability: number;
  failureChance: number;
  backlashChance: number;
  power: number;
  durationBonus: number;
  potencyBonus: number;
  theme: HexagramVisualTheme;
  complete: boolean;
  missingSockets: HexagramSocketId[];
  correspondenceScore: number;
}

export function socketAcceptsItem(
  req: HexagramSocketRequirement,
  itemId: string,
  itemCategory?: ItemCategory
): boolean {
  if (req.itemIds?.includes(itemId)) return true;
  if (req.categories?.length && itemCategory && req.categories.includes(itemCategory)) return true;
  return false;
}

export function validateHexagramSockets(
  recipe: ContentHexagramRecipe,
  sockets: Partial<Record<HexagramSocketId, string>>,
  itemCategories: Record<string, ItemCategory | undefined>
): { ok: boolean; missing: HexagramSocketId[]; invalid: HexagramSocketId[] } {
  const missing: HexagramSocketId[] = [];
  const invalid: HexagramSocketId[] = [];
  for (const req of recipe.sockets) {
    const placed = sockets[req.socket];
    if (!placed) {
      missing.push(req.socket);
      continue;
    }
    if (!socketAcceptsItem(req, placed, itemCategories[placed])) {
      invalid.push(req.socket);
    }
  }
  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid };
}

export function calculateHexagramPreview(
  recipe: ContentHexagramRecipe,
  sockets: Partial<Record<HexagramSocketId, string>>,
  augmentations: string[],
  itemCategories: Record<string, ItemCategory | undefined>,
  playerStats?: Record<string, number>
): HexagramPreviewStats {
  const validation = validateHexagramSockets(recipe, sockets, itemCategories);
  let stability = 40 + recipe.difficulty * 0.5;
  let failureChance = Math.max(5, 45 - recipe.difficulty);
  let backlashChance = Math.max(2, 20 - recipe.difficulty * 0.5);
  let power = recipe.powerTier * 10;
  let durationBonus = 0;
  let potencyBonus = 0;
  let correspondenceScore = 0;

  for (const req of recipe.sockets) {
    const itemId = sockets[req.socket];
    if (!itemId) continue;
    if (socketAcceptsItem(req, itemId, itemCategories[itemId])) {
      correspondenceScore += 12;
      stability += 8;
      failureChance -= 4;
    } else {
      stability -= 15;
      failureChance += 12;
      backlashChance += 8;
    }
  }

  for (const augId of augmentations) {
    const def = recipe.augmentations?.find((a) => a.itemId === augId);
    if (!def) {
      stability -= 5;
      continue;
    }
    if (def.power) power += def.power;
    if (def.stability) stability += def.stability;
    if (def.backlash) backlashChance += def.backlash;
    if (def.duration) durationBonus += def.duration;
    if (def.potency) potencyBonus += def.potency;
    stability += 3;
  }

  if (playerStats) {
    const skill = recipe.requiredSkill;
    if (skill) {
      const val = Number(playerStats[skill.stat] ?? 0);
      if (val >= skill.min) {
        stability += 10;
        failureChance -= 8;
      } else {
        failureChance += (skill.min - val) * 2;
      }
    }
    stability += Math.min(15, (Number(playerStats.ritualSkill ?? 0) + Number(playerStats.intuition ?? 0)) / 8);
  }

  stability = Math.max(0, Math.min(100, Math.round(stability)));
  failureChance = Math.max(2, Math.min(95, Math.round(failureChance)));
  backlashChance = Math.max(0, Math.min(80, Math.round(backlashChance)));

  return {
    stability,
    failureChance,
    backlashChance,
    power,
    durationBonus,
    potencyBonus,
    theme: recipe.visualTheme,
    complete: validation.ok,
    missingSockets: validation.missing,
    correspondenceScore,
  };
}

export function hexagramSocketPositions(): Record<
  HexagramSocketId,
  { x: number; y: number; r: number }
> {
  const cx = 0.5;
  const cy = 0.5;
  const rad = 0.32;
  const angles: Record<Exclude<HexagramSocketId, 'core'>, number> = {
    power: -Math.PI / 2,
    protection: -Math.PI / 2 + (2 * Math.PI) / 6,
    communication: -Math.PI / 2 + (4 * Math.PI) / 6,
    binding: -Math.PI / 2 + (6 * Math.PI) / 6,
    influence: -Math.PI / 2 + (8 * Math.PI) / 6,
    offering: -Math.PI / 2 + (10 * Math.PI) / 6,
  };
  const out = {} as Record<HexagramSocketId, { x: number; y: number; r: number }>;
  for (const [id, angle] of Object.entries(angles) as [Exclude<HexagramSocketId, 'core'>, number][]) {
    out[id] = { x: cx + Math.cos(angle) * rad, y: cy + Math.sin(angle) * rad, r: 0.065 };
  }
  out.core = { x: cx, y: cy, r: 0.085 };
  return out;
}
