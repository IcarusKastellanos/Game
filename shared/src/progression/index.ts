import type { MagicTradition } from '../types/index.js';
import { getAllBookContent, getBookContent } from './progression-content.js';

export const SPECIALTY_AFFINITY_THRESHOLD = 25;
export const MAX_POCKET_SPELLS = 3;

export const POCKET_SPELL_IDS = [
  'healing_charm',
  'evil_eye_removal',
  'protection_candle',
  'pocket_weakening_hex',
  'pocket_sleep_charm',
  'pocket_fear_working',
  'pocket_pain_touch',
  'pocket_binding_touch',
  'pocket_misfortune_hex',
  'pocket_divination_lens',
  'pocket_divination_veil',
  'pocket_silencing_touch',
] as const;
export type PocketSpellId = (typeof POCKET_SPELL_IDS)[number];

/** Recipe IDs granted to new players and merged into saved progression on load. */
export const BASELINE_DISCOVERED_RECIPES = [
  'recipe_healing_tea',
  'recipe_pocket_healing_charm',
  'recipe_pocket_evil_eye_removal',
  'recipe_pocket_protection_candle',
  'recipe_pocket_weakening_hex',
  'recipe_pocket_sleep_charm',
  'recipe_pocket_fear_working',
  'recipe_pocket_pain_touch',
  'recipe_pocket_binding_touch',
  'recipe_pocket_misfortune_hex',
  'recipe_pocket_divination_lens',
  'recipe_pocket_divination_veil',
  'recipe_pocket_silencing_touch',
  'recipe_enchant_knot_protection',
  'recipe_enchant_knot_longevity',
  'recipe_enchant_knot_ward',
  'hex_charm_good_fortune',
] as const;

function mergeDiscoveredRecipes(saved: string[]): string[] {
  return [...new Set([...saved, ...BASELINE_DISCOVERED_RECIPES])];
}

export interface PocketSpell {
  id: string;
  spellId: PocketSpellId;
  storedMe: number;
  preparedAt: number;
  /** Hexagram craft stability 0–100 at preparation time. */
  craftStability?: number;
  potencyBonus?: number;
  craftPower?: number;
  unstable?: boolean;
}

export interface QuestProgress {
  questId: string;
  stage: string;
  startedAt: number;
  completedAt?: number;
}

export interface PlayerProgression {
  npcRelationships: Record<string, number>;
  discoveredCorrespondences: string[];
  readBooks: string[];
  pocketSpells: PocketSpell[];
  questProgress: Record<string, QuestProgress>;
  discoveredRecipes: string[];
  /** Per-technical-skill XP pools (display keys → XP toward next skill point). */
  skillXp?: Partial<Record<string, number>>;
  /** Recent practitioner XP grants for the character sheet. */
  recentXp?: import('./xp-sources.js').RecentXpEntry[];
  /** actionId → timestamp when the source is usable again. */
  xpSourceCooldowns?: Record<string, number>;
}

export interface ContentRecipe {
  id: string;
  name: string;
  stationType: 'potion_shelf' | 'mirror' | 'enchanting_table';
  inputs: { itemId: string; quantity: number }[];
  /** Omit for pocket_spell recipes (no inventory output). */
  output?: { itemId: string; quantity: number };
  effect?: 'item' | 'pocket_spell' | 'enchant_knot';
  /** Required when effect is pocket_spell */
  spellId?: PocketSpellId;
  /** Required when effect is enchant_knot */
  enchantIntent?: 'familiar_protection' | 'ward_strength' | 'longevity';
  meCost?: number;
  discoverOnCraft?: boolean;
  description?: string;
  /** Minimum Practitioner Level required to craft. */
  minLevel?: number;
}

/** Admin Player Manager grouping: enchants, potions, pocket spells vs other station crafts. */
export type RecipeAdminCategory = 'recipes' | 'crafts';

export function adminRecipeCategory(recipe: ContentRecipe): RecipeAdminCategory {
  if (
    recipe.effect === 'pocket_spell' ||
    recipe.effect === 'enchant_knot' ||
    recipe.stationType === 'potion_shelf'
  ) {
    return 'recipes';
  }
  return 'crafts';
}

export type CraftStationType = ContentRecipe['stationType'];

/** Interactable types that open a crafting panel (legacy `crafting` plus station-specific types). */
export const CRAFTING_INTERACTABLE_TYPES = [
  'crafting',
  'potion_shelf',
  'enchanting_table',
  'craft_mirror',
] as const;

export type CraftingInteractableType = (typeof CRAFTING_INTERACTABLE_TYPES)[number];

const INTERACTABLE_TYPE_TO_STATION: Record<string, CraftStationType> = {
  potion_shelf: 'potion_shelf',
  enchanting_table: 'enchanting_table',
  craft_mirror: 'mirror',
};

export function isCraftingInteractable(type: string): type is CraftingInteractableType {
  return (CRAFTING_INTERACTABLE_TYPES as readonly string[]).includes(type);
}

/** Resolve which crafting station recipes to show for a map interactable. */
export function craftStationTypeFromInteractable(inter: {
  type: string;
  id?: string;
  data?: Record<string, unknown>;
}): CraftStationType {
  const fromData = inter.data?.stationType;
  if (fromData === 'potion_shelf' || fromData === 'mirror' || fromData === 'enchanting_table') {
    return fromData;
  }
  const fromType = INTERACTABLE_TYPE_TO_STATION[inter.type];
  if (fromType) return fromType;
  const id = inter.id ?? '';
  if (id.includes('enchant')) return 'enchanting_table';
  if (id.includes('mirror')) return 'mirror';
  if (id.includes('shelf') || id.includes('potion')) return 'potion_shelf';
  return 'potion_shelf';
}

export interface ContentQuestNode {
  id: string;
  text: string;
  objective?: string;
  next?: string;
  complete?: boolean;
}

export interface ContentQuest {
  id: string;
  name: string;
  description: string;
  npcId?: string;
  startStage: string;
  nodes: ContentQuestNode[];
  /** Minimum Practitioner Level to accept / complete this quest. */
  minLevel?: number;
  rewards?: {
    items?: { itemId: string; quantity: number }[];
    stats?: Record<string, number>;
    /** Legacy alias → public reputation. */
    reputation?: number;
    publicReputation?: number;
    spiritualReputation?: number;
  };
}

export const BOOK_CONTENT: Record<
  string,
  { pages: string[]; statBoost?: Record<string, number>; discoverItems?: string[]; affinity?: MagicTradition }
> = new Proxy(
  {},
  {
    get(_target, bookId: string) {
      return getBookContent(bookId);
    },
    has(_target, bookId: string) {
      return getBookContent(bookId) != null;
    },
    ownKeys() {
      return Object.keys(getAllBookContent());
    },
    getOwnPropertyDescriptor(_target, bookId: string) {
      const book = getBookContent(bookId);
      if (!book) return undefined;
      return { configurable: true, enumerable: true, value: book };
    },
  }
) as Record<
  string,
  { pages: string[]; statBoost?: Record<string, number>; discoverItems?: string[]; affinity?: MagicTradition }
>;

export function defaultProgression(): PlayerProgression {
  return {
    npcRelationships: {},
    discoveredCorrespondences: [],
    readBooks: [],
    pocketSpells: [],
    questProgress: {},
    discoveredRecipes: [...BASELINE_DISCOVERED_RECIPES],
    skillXp: {},
    recentXp: [],
    xpSourceCooldowns: {},
  };
}

function parseSkillXp(raw: unknown): Partial<Record<string, number>> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Partial<Record<string, number>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      out[key] = Math.floor(value);
    }
  }
  return out;
}

export function parseProgression(raw: unknown): PlayerProgression {
  const base = defaultProgression();
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Record<string, unknown>;
  return {
    npcRelationships:
      o.npcRelationships && typeof o.npcRelationships === 'object'
        ? (o.npcRelationships as Record<string, number>)
        : base.npcRelationships,
    discoveredCorrespondences: Array.isArray(o.discoveredCorrespondences)
      ? (o.discoveredCorrespondences as string[])
      : base.discoveredCorrespondences,
    readBooks: Array.isArray(o.readBooks) ? (o.readBooks as string[]) : base.readBooks,
    pocketSpells: Array.isArray(o.pocketSpells) ? (o.pocketSpells as PocketSpell[]) : base.pocketSpells,
    questProgress:
      o.questProgress && typeof o.questProgress === 'object'
        ? (o.questProgress as Record<string, QuestProgress>)
        : base.questProgress,
    discoveredRecipes: mergeDiscoveredRecipes(
      Array.isArray(o.discoveredRecipes) ? (o.discoveredRecipes as string[]) : base.discoveredRecipes
    ),
    skillXp: parseSkillXp(o.skillXp),
    recentXp: Array.isArray(o.recentXp)
      ? (o.recentXp as import('./xp-sources.js').RecentXpEntry[]).filter(
          (e) => e && typeof e.actionId === 'string' && typeof e.amount === 'number'
        )
      : [],
    xpSourceCooldowns:
      o.xpSourceCooldowns && typeof o.xpSourceCooldowns === 'object'
        ? (o.xpSourceCooldowns as Record<string, number>)
        : {},
  };
}

export function getNpcRelationshipLevel(progression: PlayerProgression, npcId: string): number {
  return progression.npcRelationships[npcId] ?? 0;
}

export function applyNpcRelationshipDelta(
  progression: PlayerProgression,
  npcId: string,
  delta: number
): PlayerProgression {
  const current = getNpcRelationshipLevel(progression, npcId);
  return {
    ...progression,
    npcRelationships: { ...progression.npcRelationships, [npcId]: Math.max(0, Math.min(100, current + delta)) },
  };
}

export function discoverCorrespondences(
  progression: PlayerProgression,
  itemIds: string[]
): PlayerProgression {
  const set = new Set(progression.discoveredCorrespondences);
  for (const id of itemIds) set.add(id);
  return { ...progression, discoveredCorrespondences: [...set] };
}

export function eligibleSpecialtyTraditions(
  affinities: Record<string, number>
): MagicTradition[] {
  return (Object.entries(affinities) as [MagicTradition, number][])
    .filter(([, v]) => v >= SPECIALTY_AFFINITY_THRESHOLD)
    .map(([k]) => k);
}
