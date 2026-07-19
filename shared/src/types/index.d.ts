/** Magic tradition identifiers — pluggable systems register here. */
export type MagicTradition = 'traditional_european' | 'chaos_magic' | 'vodou' | 'nordic_seidr' | 'greek_mageia';
/** Spell categories aligned with folk practice, not combat magic. */
export type SpellCategory = 'protection' | 'healing' | 'baneful' | 'cleansing' | 'divination' | 'spirit_work' | 'love_friendship' | 'luck' | 'binding' | 'reversal' | 'prosperity' | 'dreamwork' | 'warding';
export type SpellTargetType = 'self' | 'player' | 'familiar' | 'apartment' | 'room' | 'object' | 'area';
export type TaglockType = 'true_name' | 'hair' | 'blood' | 'personal_item' | 'written_name' | 'photo' | 'social_bond' | 'familiar_name' | 'self';
export type ItemCategory = 'herbs' | 'candles' | 'incense' | 'oils' | 'minerals' | 'tools' | 'poppets' | 'written_petitions' | 'charms' | 'food' | 'medicine' | 'books' | 'decorations' | 'offerings' | 'familiar_care' | 'ritual_clothing';
export type CorrespondenceTag = SpellCategory;
export type FamiliarSpecies = 'cat' | 'owl' | 'frog' | 'rat' | 'snake';
export type SceneId = 'apartment' | 'town';
export type MapLocationId = 'apartment' | 'metaphysical_shop' | 'grocery' | 'pharmacy' | 'museum' | 'funeral_home' | 'park' | 'library' | 'cafe' | 'study_circle' | 'apartment_building';
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
    reputation: number;
    morality: number;
    /** Affinity per magic tradition (0–100) */
    affinities: Record<MagicTradition, number>;
    specialty?: MagicTradition;
}
export interface InventorySlot {
    itemId: string;
    quantity: number;
    metadata?: Record<string, unknown>;
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
}
export interface AuraEffect {
    id: string;
    type: 'blessing' | 'hex' | 'attachment' | 'parasite' | 'protection' | 'ward' | 'curse_residue' | 'energetic_damage';
    name: string;
    strength: number;
    source?: string;
    spellId?: string;
    creatorId?: string;
    expiresAt?: number;
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
    familiarLink?: {
        familiarId: string;
        strength: number;
    };
    energeticDamage: number;
}
export interface FamiliarState {
    id: string;
    species: FamiliarSpecies;
    publicName: string;
    /** Hidden from other players unless discovered */
    trueName: string;
    hunger: number;
    affection: number;
    energy: number;
    spiritualStability: number;
    loyalty: number;
    ownerId: string;
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
}
export interface ContentSpell {
    id: string;
    name: string;
    tradition: MagicTradition;
    category: SpellCategory;
    targetType: SpellTargetType;
    ingredients: {
        itemId: string;
        quantity: number;
    }[];
    requiredTools: string[];
    optionalBoosters?: {
        itemId: string;
        quantity: number;
        potencyBonus: number;
    }[];
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
    }[];
    openHours?: {
        start: number;
        end: number;
    };
}
export interface ContentNpc {
    id: string;
    name: string;
    role: string;
    locationId: MapLocationId;
    schedule: {
        hour: number;
        locationId: MapLocationId;
    }[];
    relationshipLevel: number;
    magicalKnowledge: number;
    dialogueTreeId: string;
    shopId?: string;
    faction?: string;
    secrets?: string[];
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
    spawnPoints: {
        id: string;
        x: number;
        y: number;
    }[];
    interactables: {
        id: string;
        type: 'altar' | 'door' | 'shop' | 'npc' | 'ward_point' | 'crafting' | 'potion_shelf' | 'enchanting_table' | 'craft_mirror';
        x: number;
        y: number;
        targetScene?: SceneId;
        targetSpawn?: string;
        data?: Record<string, unknown>;
    }[];
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
}
export interface AstralSessionState {
    playerId: string;
    entryMethod: 'trance' | 'sleep' | 'dreamwork' | 'herb' | 'spirit_guided';
    active: boolean;
}
//# sourceMappingURL=index.d.ts.map