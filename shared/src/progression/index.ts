import type { MagicTradition } from '../types/index.js';
import { getAllBookContent, getBookContent } from './progression-content.js';
import { parseActiveVows, parseLicensureMarks } from './licenses.js';
import { backfillGrimoireIngredients, defaultGrimoire, parseGrimoire, type GrimoireState } from './grimoire.js';
import { emptySocial, parsePlayerSocial } from '../social/index.js';

export {
  GRIMOIRE_INKS,
  GRIMOIRE_MALEVOLENT_WARD,
  GRIMOIRE_MANUSCRIPT_ITEM_ID,
  GRIMOIRE_NOTE_COUNT,
  backfillGrimoireIngredients,
  cleanAuthoredGrimoireBody,
  cleanAuthoredGrimoireTitle,
  customizeGrimoire,
  defaultGrimoire,
  deleteAuthoredGrimoirePage,
  deleteSharedGrimoirePage,
  grimoireBondLabel,
  grimoireKnowsSpell,
  isMalevolentSpell,
  malevolentGrimoireWard,
  applyManuscriptEditToGrimoire,
  applyManuscriptEditToInventory,
  manuscriptMetadataFromPage,
  parseGrimoire,
  purgeManuscriptFromGrimoire,
  purgeManuscriptFromInventory,
  readManuscriptMeta,
  receiveSharedGrimoirePage,
  recordGrimoireCast,
  recordGrimoireIngredients,
  recordGrimoireNpc,
  recordGrimoireSpirit,
  recordGrimoireStudied,
  selectGrimoireSpirit,
  setAuthoredGrimoireActive,
  setGrimoireNotes,
  setGrimoireNpcNote,
  setGrimoireSpellNote,
  setGrimoireSpiritNote,
  setSharedGrimoireActive,
  shareSpellIntoGrimoire,
  upsertAuthoredGrimoirePage,
} from './grimoire.js';
export type {
  GrimoireAuthoredPage,
  GrimoireCustomization,
  GrimoireIngredientEntry,
  GrimoireInk,
  GrimoireManuscriptMeta,
  GrimoireNpcEntry,
  GrimoireSharedPage,
  GrimoireSpellEntry,
  GrimoireSpellSource,
  GrimoireSpiritDraft,
  GrimoireSpiritEncounter,
  GrimoireState,
} from './grimoire.js';

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
  failedAt?: number;
  abandonedAt?: number;
  /** Definition version this instance was started or reconciled against. */
  version?: number;
  objectives?: Record<string, { count: number; doneAt?: number }>;
  choices?: string[];
  onceKeys?: string[];
  /** Short trail of signals that changed this instance. */
  history?: { at: number; type: string; detail?: string }[];
  /** Set when completion rewards have been granted. A second call must not pay again. */
  rewardsGrantedAt?: number;
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
  /** Highest recognition tier currently held (`content/progression/recognition-tiers.json`). */
  recognitionTierId?: string;
  /** Cached label for HUD / friends (filled by evaluateRecognition). */
  recognitionTierLabel?: string;
  /** Formal licenses earned via quests / content (warder, healer, seer, …). */
  earnedLicenses?: string[];
  /** Licensure Marks pools + Magical Council standing per credential. */
  licensureMarks?: Record<string, import('./licenses.js').LicensureMarkState>;
  /** Active professional vows keyed by license id. */
  activeVows?: Record<string, import('./licenses.js').ActiveVowState>;
  /** Story / recognition flags unlocked by tiers and content. */
  storyFlags?: string[];
  /**
   * Per-player NPC shop shelf counts (`shopId → itemId → remaining`).
   * Missing entries mean the content baseline stock. Refilled at local noon.
   */
  shopStock?: Record<string, Record<string, number>>;
  /** Local calendar day key (`YYYY-M-D`) of the last noon shop restock for this player. */
  shopStockDay?: string;
  /** Personal record of workings, ingredients, spirits, people, and the book's own hand. */
  grimoire: GrimoireState;
  /** Per-NPC bonds and community reputation. Separate from public and spiritual reputation. */
  social?: import('../social/index.js').PlayerSocial;
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

export type QuestScope = 'personal' | 'party' | 'world';
export type QuestOffer = 'on_talk' | 'follow_up' | 'event';
export type QuestObjectiveType =
  | 'talk'
  | 'deliver'
  | 'collect'
  | 'defeat'
  | 'discover'
  | 'license'
  | 'bond'
  | 'interact'
  | 'quest'
  | 'schedule'
  | 'dialogue'
  | 'help_player'
  | 'public_event'
  | 'cast_spell';

export interface QuestObjective {
  id: string;
  type: QuestObjectiveType;
  optional?: boolean;
  text?: string;
  npcId?: string;
  itemId?: string;
  quantity?: number;
  spellId?: string;
  locationId?: string;
  licenseId?: string;
  stage?: string;
  questId?: string;
  choiceId?: string;
  /** This objective counts only after the player makes this dialogue choice. */
  afterChoiceId?: string;
  eventId?: string;
  interactableId?: string;
  hour?: number;
  count?: number;
}

export interface QuestRewardGrant {
  items?: { itemId: string; quantity: number }[];
  stats?: Record<string, number>;
  /** Legacy alias → public reputation. */
  reputation?: number;
  publicReputation?: number;
  spiritualReputation?: number;
  /** Recognition licenses granted on quest complete. */
  licenses?: string[];
}

export interface QuestDecision {
  id: string;
  choiceId: string;
  setFlags?: string[];
  /** Objective ids marked done when this choice is taken. */
  waiveObjectives?: string[];
  followUpQuestIds?: string[];
  /** Used instead of the quest rewards when this choice was taken. */
  rewards?: QuestRewardGrant;
}

export interface ContentQuest {
  id: string;
  /** Bumped when a definition changes. In-progress instances keep their completion. */
  version?: number;
  name: string;
  description: string;
  /** Who shares progress. Defaults to personal. */
  scope?: QuestScope;
  npcId?: string;
  npcIds?: string[];
  /** Bond stage id required before this quest is offered. */
  minStage?: string;
  offer?: QuestOffer;
  prerequisites?: {
    questsCompleted?: string[];
    licenses?: string[];
    vows?: string[];
    coins?: number;
    items?: { itemId: string; quantity: number }[];
    storyFlags?: string[];
    noStoryFlags?: string[];
    publicReputation?: number;
    spiritualReputation?: number;
    bond?: import('../social/index.js').BondGate;
  };
  objectives?: QuestObjective[];
  optionalObjectives?: QuestObjective[];
  /** once: a completion sticks. always: may be offered again after completion. */
  repeat?: 'once' | 'always';
  followUpQuestIds?: string[];
  expiresHours?: number;
  party?: { contribution: 'any' | 'all'; requiredContributors?: number; reward: 'each' | 'leader' };
  world?: { reward: 'each_contributor' };
  failure?: { eventId?: string };
  /** Dialogue choices that set flags, waive steps, or swap rewards. */
  decisions?: QuestDecision[];
  startStage: string;
  nodes: ContentQuestNode[];
  /** Minimum Practitioner Level to accept / complete this quest. */
  minLevel?: number;
  rewards?: QuestRewardGrant;
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
    recognitionTierId: 'initiate',
    recognitionTierLabel: 'Initiate',
    earnedLicenses: [],
    licensureMarks: {},
    activeVows: {},
    storyFlags: [],
    shopStock: {},
    shopStockDay: '',
    grimoire: defaultGrimoire(),
    social: emptySocial(),
  };
}

export function withGrimoire(
  progression: PlayerProgression,
  update: (grimoire: GrimoireState) => GrimoireState
): PlayerProgression {
  const current = progression.grimoire ?? defaultGrimoire();
  const next = update(current);
  if (next === current) return progression;
  return { ...progression, grimoire: next };
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

/**
 * Completions saved before quest versions existed already paid their rewards.
 * Versioned instances keep an explicit rewardsGrantedAt so a finished step can still be paid once.
 */
function sealLegacyQuestRewards(quests: Record<string, QuestProgress>): Record<string, QuestProgress> {
  const next: Record<string, QuestProgress> = {};
  for (const [id, entry] of Object.entries(quests)) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.completedAt && entry.rewardsGrantedAt == null && entry.version == null) {
      next[id] = { ...entry, rewardsGrantedAt: entry.completedAt };
      continue;
    }
    next[id] = entry;
  }
  return next;
}

export function parseProgression(raw: unknown): PlayerProgression {
  const base = defaultProgression();
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Record<string, unknown>;
  const npcRelationships =
    o.npcRelationships && typeof o.npcRelationships === 'object'
      ? (o.npcRelationships as Record<string, number>)
      : base.npcRelationships;
  return {
    npcRelationships,
    discoveredCorrespondences: Array.isArray(o.discoveredCorrespondences)
      ? (o.discoveredCorrespondences as string[])
      : base.discoveredCorrespondences,
    readBooks: Array.isArray(o.readBooks) ? (o.readBooks as string[]) : base.readBooks,
    pocketSpells: Array.isArray(o.pocketSpells) ? (o.pocketSpells as PocketSpell[]) : base.pocketSpells,
    questProgress: sealLegacyQuestRewards(
      o.questProgress && typeof o.questProgress === 'object'
        ? (o.questProgress as Record<string, QuestProgress>)
        : base.questProgress
    ),
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
    recognitionTierId:
      typeof o.recognitionTierId === 'string' && o.recognitionTierId
        ? o.recognitionTierId
        : base.recognitionTierId,
    recognitionTierLabel:
      typeof o.recognitionTierLabel === 'string' && o.recognitionTierLabel
        ? o.recognitionTierLabel
        : base.recognitionTierLabel,
    earnedLicenses: Array.isArray(o.earnedLicenses)
      ? [...new Set((o.earnedLicenses as unknown[]).filter((id): id is string => typeof id === 'string'))]
      : [],
    licensureMarks: parseLicensureMarks(o.licensureMarks),
    activeVows: parseActiveVows(o.activeVows),
    storyFlags: Array.isArray(o.storyFlags)
      ? [...new Set((o.storyFlags as unknown[]).filter((id): id is string => typeof id === 'string'))]
      : [],
    shopStock: parseShopStock(o.shopStock),
    shopStockDay: typeof o.shopStockDay === 'string' ? o.shopStockDay : '',
    grimoire: parseGrimoire(o.grimoire),
    social: parsePlayerSocial(o.social, npcRelationships),
  };
}

function parseShopStock(raw: unknown): Record<string, Record<string, number>> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, Record<string, number>> = {};
  for (const [shopId, items] of Object.entries(raw as Record<string, unknown>)) {
    if (!items || typeof items !== 'object') continue;
    const row: Record<string, number> = {};
    for (const [itemId, stock] of Object.entries(items as Record<string, unknown>)) {
      if (typeof stock === 'number' && Number.isFinite(stock) && stock >= 0) {
        row[itemId] = Math.floor(stock);
      }
    }
    out[shopId] = row;
  }
  return out;
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
  return withGrimoire(
    { ...progression, discoveredCorrespondences: [...set] },
    (grimoire) => backfillGrimoireIngredients(grimoire, itemIds)
  );
}

export function eligibleSpecialtyTraditions(
  affinities: Record<string, number>
): MagicTradition[] {
  return (Object.entries(affinities) as [MagicTradition, number][])
    .filter(([, v]) => v >= SPECIALTY_AFFINITY_THRESHOLD)
    .map(([k]) => k);
}
