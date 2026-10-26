import { playerLevelFromExperience } from '../progression/level-curve.js';

/** Magic tradition identifiers — pluggable systems register here. */
export type MagicTradition =
  | 'traditional_european'
  | 'chaos_magic'
  | 'vodou'
  | 'nordic_seidr'
  | 'greek_mageia';

/** Spell categories aligned with folk practice, not combat magic. */
export type SpellCategory =
  | 'protection'
  | 'healing'
  | 'baneful'
  | 'cleansing'
  | 'divination'
  | 'spirit_work'
  | 'love_friendship'
  | 'luck'
  | 'binding'
  | 'reversal'
  | 'prosperity'
  | 'dreamwork'
  | 'warding';

export type SpellTargetType =
  | 'self'
  | 'player'
  | 'familiar'
  | 'apartment'
  | 'room'
  | 'object'
  | 'area';

export type TaglockType =
  | 'true_name'
  | 'hair'
  | 'blood'
  | 'personal_item'
  | 'written_name'
  | 'photo'
  | 'social_bond'
  | 'familiar_name'
  | 'self';

export type ItemCategory =
  | 'herbs'
  | 'candles'
  | 'incense'
  | 'oils'
  | 'minerals'
  | 'tools'
  | 'poppets'
  | 'written_petitions'
  | 'charms'
  | 'food'
  | 'medicine'
  | 'books'
  | 'decorations'
  | 'offerings'
  | 'familiar_care'
  | 'ritual_clothing';

export type CorrespondenceTag = SpellCategory;

export type FamiliarSpecies = 'cat' | 'owl' | 'frog' | 'rat' | 'snake';

export type SceneId = 'apartment' | 'town';

export type MapLocationId =
  | 'apartment'
  | 'metaphysical_shop'
  | 'grocery'
  | 'pharmacy'
  | 'museum'
  | 'funeral_home'
  | 'park'
  | 'library'
  | 'cafe'
  | 'study_circle'
  | 'apartment_building';

export type MoralityAlignment = 'benevolent' | 'neutral' | 'malevolent';

export interface PlayerStats {
  health: number;
  hunger: number;
  magicalEnergy: number;
  protection: number;
  intuition: number;
  spiritualAwareness: number;
  divinationSkill: number;
  herbalism: number;
  cursecraft: number;
  warding: number;
  healing: number;
  ritualSkill: number;
  experience: number;
  /**
   * Legacy single reputation column (−100…100). Kept in sync with
   * {@link publicReputation} for DB persistence and older clients.
   */
  reputation: number;
  morality: number;
  /** Affinity per magic tradition (0–100) */
  affinities: Record<MagicTradition, number>;
  specialty?: MagicTradition;

  /**
   * Mundane-world standing (−100…100). Migrated from legacy `reputation` on load.
   * Optional so older saves still parse.
   */
  publicReputation?: number;
  /** Occult-community standing (−100…100). Stored in extendedStats. */
  spiritualReputation?: number;

  // ── Extended attributes (Aura & Wards screen). Optional so older saves load. ──
  /** Physical endurance — ritual stamina, travel, carrying. */
  stamina?: number;
  // Mental attributes
  willpower?: number;
  memory?: number;
  presence?: number;
  authority?: number;
  mediumship?: number;
  // Technical skills (awareness/hexWork/divination reuse existing aliases)
  potionMaking?: number;
  spiritNegotiation?: number;
}

export interface InventorySlot {
  itemId: string;
  quantity: number;
  metadata?: InventorySlotMetadata;
}

/** Per-slot data — taglocks use targetName / sourceName for who they belong to */
export interface InventorySlotMetadata {
  targetName?: string;
  sourceName?: string;
  sourcePlayerId?: string;
  collectedAt?: number;
  inscribedAt?: number;
  slotIndex?: number;
  [key: string]: unknown;
}

export interface AltarPlacement {
  slot: string;
  itemId: string;
  quantity: number;
}

export interface AltarState {
  candles: AltarPlacement[];
  herbs: AltarPlacement[];
  incense: AltarPlacement[];
  petitions: AltarPlacement[];
  poppets: AltarPlacement[];
  taglocks: AltarPlacement[];
  intent?: string;
  timing?: string;
  familiarAssist?: boolean;
  decorationIds: string[];
}

export interface WardState {
  id: string;
  targetType: 'player' | 'apartment' | 'room' | 'familiar' | 'coven_grove';
  targetId: string;
  strength: number;
  duration: number;
  maintenanceCost: number;
  feedingRequirement?: string;
  ingredientRequirement?: string[];
  vulnerabilities: string[];
  creatorId: string;
  detectionDifficulty: number;
  expiresAt?: number;
  /** Everweed-bound — no further ME upkeep */
  permanent?: boolean;
}

export interface AuraEffect {
  id: string;
  type: 'blessing' | 'hex' | 'attachment' | 'parasite' | 'protection' | 'ward' | 'curse_residue' | 'energetic_damage';
  name: string;
  strength: number;
  source?: string;
  spellId?: string;
  creatorId?: string;
  /** Gameplay bind from spell effect, e.g. speech_bind or movement_slow */
  bindAction?: string;
  expiresAt?: number;
  permanent?: boolean;
}

export interface PlayerLocation {
  scene: SceneId;
  x: number;
  y: number;
  spawnId: string;
  visitingHostDbPlayerId?: string;
}

export interface FriendEntry {
  playerId: string;
  username: string;
  displayName: string;
  since: number;
}

export interface FriendRequest {
  fromPlayerId: string;
  fromUsername: string;
  fromDisplayName: string;
  sentAt: number;
}

export interface FriendPresence extends FriendEntry {
  online: boolean;
  level: number;
  practitionerType: string;
  scene?: SceneId;
}

export interface AuraState {
  alignment: MoralityAlignment;
  moralityScore: number;
  blessings: AuraEffect[];
  hexes: AuraEffect[];
  attachments: AuraEffect[];
  parasites: AuraEffect[];
  protections: AuraEffect[];
  wards: AuraEffect[];
  curseResidue: AuraEffect[];
  familiarLink?: { familiarId: string; strength: number };
  energeticDamage: number;
}

export interface FamiliarState {
  id: string;
  species: FamiliarSpecies;
  templateId: string;
  /** Faux name — one word, public */
  publicName: string;
  /** True name — first and last, hidden from others */
  trueName: string;
  hunger: number;
  affection: number;
  energy: number;
  spiritualStability: number;
  loyalty: number;
  experience: number;
  level: number;
  /** Primary function stat boosted on level-up */
  mainFunction: string;
  chosen: boolean;
  ownerId: string;
  /** Unix ms — bond action cooldown */
  lastBondAt?: number;
  /** Personal protections woven around the familiar */
  protections?: AuraEffect[];
}

export interface MetPlayer {
  playerId: string;
  username: string;
  displayName: string;
  metAt: number;
}

/** Specialty / skill-focus subtitle (no recognition tier). */
export function getPractitionerSpecialtyLabel(
  stats: Pick<
    PlayerStats,
    'specialty' | 'warding' | 'healing' | 'cursecraft' | 'divinationSkill' | 'herbalism' | 'ritualSkill'
  >
): string {
  if (stats.specialty) {
    const labels: Record<string, string> = {
      traditional_european: 'Folk Witch',
      chaos_magic: 'Chaos Worker',
      vodou: 'Root Worker',
      nordic_seidr: 'Seidr',
      greek_mageia: 'Mage',
    };
    return labels[stats.specialty] ?? 'Practitioner';
  }
  const ranked: [string, number][] = [
    ['Warder', stats.warding],
    ['Healer', stats.healing],
    ['Hex Witch', stats.cursecraft],
    ['Seer', stats.divinationSkill],
    ['Herbalist', stats.herbalism],
    ['Ritualist', stats.ritualSkill],
  ];
  ranked.sort((a, b) => b[1] - a[1]);
  return ranked[0][0];
}

/**
 * Display label: recognition tier when known, with optional specialty subtitle.
 * Pass `recognitionTierLabel` from progression content (keeps this module free of progression imports).
 */
export function getPractitionerType(
  stats: Pick<
    PlayerStats,
    'specialty' | 'warding' | 'healing' | 'cursecraft' | 'divinationSkill' | 'herbalism' | 'ritualSkill'
  >,
  recognitionTierLabel?: string | null
): string {
  const specialty = getPractitionerSpecialtyLabel(stats);
  const tier = recognitionTierLabel?.trim();
  if (tier) {
    if (specialty && specialty !== 'Practitioner') return `${tier} · ${specialty}`;
    return tier;
  }
  return specialty;
}

export function playerLevel(experience: number): number {
  // Delegates to content-driven curve (default max Level 10).
  return playerLevelFromExperience(experience);
}

export interface TaglockSelection {
  type: TaglockType;
  /** Written name text, item ids for biological, player id for social */
  value?: string;
  itemIds?: string[];
  playerId?: string;
}

export interface PentacleCastPayload {
  spellId: string;
  /** Max 5 unique ingredient types on pentacle */
  pentacleSlots: { itemId: string; quantity: number }[];
  /** Up to 3 augment slots under pentacle for hex intents */
  augmentSlots: { itemId: string; quantity: number }[];
  hexIntents?: string[];
  taglocks: TaglockSelection[];
  targetPlayerId?: string;
  targetSelf?: boolean;
  timing?: string;
  magicOnly?: boolean;
  altarState: AltarState;
}

export interface PlayerState {
  id: string;
  sessionId: string;
  displayName: string;
  x: number;
  y: number;
  scene: SceneId;
  direction: 'up' | 'down' | 'left' | 'right';
  stats: PlayerStats;
  inventory: InventorySlot[];
  altar: AltarState;
  aura: AuraState;
  familiarId?: string;
  apartmentId?: string;
}

export interface GameRoomState {
  players: Record<string, PlayerState>;
  scene: SceneId;
  tick: number;
}

export interface ContentIngredient {
  id: string;
  name: string;
  category: ItemCategory;
  correspondences: CorrespondenceTag[];
  description: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'exotic';
  basePotency: number;
  traditions: MagicTradition[];
  /** Optional 16×16 #rrggbb pixels (256 entries) for custom icon art */
  iconPixels?: string[];
  /** Restricted to admin give / use until released publicly */
  adminOnly?: boolean;
  /** Food: hunger restored when used (defaults from potency if omitted). */
  hungerRestore?: number;
  /** Food: ms spent in the `eating` survival activity after use. */
  eatingDurationMs?: number;
}

export interface ContentSpell {
  id: string;
  name: string;
  tradition: MagicTradition;
  category: SpellCategory;
  targetType: SpellTargetType;
  ingredients: { itemId: string; quantity: number }[];
  requiredTools: string[];
  optionalBoosters?: { itemId: string; quantity: number; potencyBonus: number }[];
  taglockRequirement?: TaglockType[];
  altarRequirements?: string[];
  castingTime: number;
  duration: number;
  difficulty: number;
  basePotency: number;
  maintenanceCost: number;
  counterspellTags: string[];
  moralEffect: number;
  familiarInteractions?: string[];
  visualEffect?: string;
  audioEffect?: string;
  gameplayEffect: Record<string, unknown>;
  description: string;
  /** Minimum Practitioner Level required to cast (1–maxLevel). */
  minLevel?: number;
}

export interface ContentShop {
  id: string;
  name: string;
  locationId: MapLocationId;
  npcId?: string;
  inventory: {
    itemId: string;
    price: number;
    stock: number;
    /** Occult standing required to purchase this listing (spiritual reputation). */
    minSpiritualReputation?: number;
    /** Mundane standing required to purchase this listing (public reputation). */
    minPublicReputation?: number;
    /** Practitioner Level required to purchase this listing. */
    minLevel?: number;
  }[];
  openHours?: { start: number; end: number };
  /** Shop-wide occult standing gate (spiritual reputation). */
  minSpiritualReputation?: number;
  /** Shop-wide mundane standing gate (public reputation). */
  minPublicReputation?: number;
  /** Shop-wide Practitioner Level gate. */
  minLevel?: number;
}

export interface ContentNpc {
  id: string;
  name: string;
  role: string;
  locationId: MapLocationId;
  schedule: { hour: number; locationId: MapLocationId }[];
  relationshipLevel: number;
  magicalKnowledge: number;
  dialogueTreeId: string;
  shopId?: string;
  faction?: string;
  secrets?: string[];
  /** Custom 16×16 overworld sprite pixels (admin-painted or imported) */
  spritePixels?: string[];
}

export interface ContentFamiliarTemplate {
  id: string;
  species: FamiliarSpecies;
  defaultPublicName: string;
  description: string;
  statBonuses: Partial<Record<keyof PlayerStats, number>>;
  vulnerabilities?: string[];
}

export interface ContentDecoration {
  id: string;
  name: string;
  category: 'furniture' | 'wall' | 'floor' | 'altar_object';
  width: number;
  height: number;
  altarBuffs?: Partial<Record<SpellCategory, number>>;
  placementRules?: string[];
}

export interface ContentTile {
  id: string;
  name: string;
  walkable: boolean;
  spriteKey: string;
  layer: 'floor' | 'wall' | 'object';
}

export interface ContentMapDefinition {
  id: string;
  name: string;
  sceneId: SceneId;
  width: number;
  height: number;
  tileSize: number;
  layers: {
    floor: number[][];
    walls: number[][];
    objects: number[][];
  };
  spawnPoints: { id: string; x: number; y: number }[];
  interactables: {
    id: string;
    type: 'altar' | 'door' | 'shop' | 'npc' | 'ward_point' | 'crafting' | 'potion_shelf' | 'enchanting_table' | 'craft_mirror' | 'cleanser' | 'bed';
    x: number;
    y: number;
    targetScene?: SceneId;
    targetSpawn?: string;
    data?: Record<string, unknown>;
  }[];
  /** Static furniture from Map Builder placedFurniture */
  placedFurniture?: RuntimePlacedFurniture[];
  /** Static decorations from Map Builder placedDecorations */
  placedDecorations?: RuntimePlacedDecoration[];
  /** Tile collision cells painted in Map Builder */
  collision?: MapCollisionCell[];
}

export interface MapCollisionCell {
  x: number;
  y: number;
  mode:
    | 'full'
    | 'partial'
    | 'polygon'
    | 'rectangle'
    | 'circle'
    | 'one_way'
    | 'player_only'
    | 'npc_only'
    | 'familiar_only'
    | 'spirit_only'
    | 'line_of_sight'
    | 'magic_block';
}

export interface RuntimePlacedFurniture {
  id: string;
  furnitureDefId: string;
  spriteRef: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  /** Draw priority 0–100 (0=background, 1=floor, higher=in front). */
  renderLevel?: number;
  spritePixels?: string[];
}

export interface RuntimePlacedDecoration {
  id: string;
  decorationDefId: string;
  spriteRef: string;
  x: number;
  y: number;
  rotation: 0 | 90 | 180 | 270;
  /** Draw priority 0–100 (0=background, 1=floor, higher=in front). */
  renderLevel?: number;
  wallMounted?: boolean;
  spritePixels?: string[];
}

/** Expansion stubs — designed but not fully implemented */
export interface CovenState {
  id: string;
  name: string;
  memberIds: string[];
  roles: Record<string, 'leader' | 'priestess' | 'scribe' | 'guardian' | 'member'>;
  groveId: string;
  reputation: number;
  rentDueAt: number;
  // TODO: shared storage, shared rituals, tree upgrades
}

export interface AstralSessionState {
  playerId: string;
  entryMethod: 'trance' | 'sleep' | 'dreamwork' | 'herb' | 'spirit_guided';
  active: boolean;
  // TODO: astral combat, spirit encounters, travel
}
