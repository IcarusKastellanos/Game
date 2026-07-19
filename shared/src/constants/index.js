export const GAME_VERSION = '0.1.0';
export const DEFAULT_STATS = {
    health: 100,
    hunger: 80,
    magicalEnergy: 50,
    protection: 10,
    intuition: 5,
    spiritualAwareness: 5,
    divinationSkill: 3,
    herbalism: 3,
    cursecraft: 2,
    warding: 3,
    healing: 3,
    ritualSkill: 5,
    experience: 0,
    reputation: 0,
    morality: 0,
    affinities: {
        traditional_european: 10,
        chaos_magic: 0,
        vodou: 0,
        nordic_seidr: 0,
        greek_mageia: 0,
    },
};
export const STAT_MAX = 100;
export const INVENTORY_MAX_SLOTS = 40;
/** Taglock strength multipliers for spell accuracy/potency */
export const TAGLOCK_STRENGTH = {
    true_name: 1.0,
    blood: 0.95,
    hair: 0.85,
    personal_item: 0.75,
    written_name: 0.65,
    photo: 0.6,
    social_bond: 0.5,
    familiar_name: 0.9,
};
/** Registered magic systems — add new traditions without rewriting core */
export const MAGIC_SYSTEMS = {
    traditional_european: {
        label: 'Traditional European Folk Magic',
        enabled: true,
        description: 'Candles, herbs, poppets, wards, and household charms.',
    },
    chaos_magic: {
        label: 'Chaos Magic',
        enabled: false,
        description: 'Sigils, belief-shifting, and experimental practice.',
    },
    vodou: {
        label: 'Vodou-Inspired Practice',
        enabled: false,
        description: 'Loa veneration, offerings, and spirit work.',
    },
    nordic_seidr: {
        label: 'Nordic Seidr',
        enabled: false,
        description: 'Seidr trance, runes, and ancestral magic.',
    },
    greek_mageia: {
        label: 'Greek Mageia',
        enabled: false,
        description: 'Phylacteries, defixiones, and Hellenistic ritual.',
    },
};
export const TILE_SIZE = 16;
export const PLAYER_SPEED = 80;
export const SCENE_TRANSITIONS = {
    apartment_door: { target: 'town', spawn: 'apartment_building' },
    town_apartment: { target: 'apartment', spawn: 'door' },
};
//# sourceMappingURL=index.js.map