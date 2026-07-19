import { Schema, type, MapSchema } from '@colyseus/schema';
import {
  DEFAULT_STATS,
  type AltarState,
  type AuraState,
  type InventorySlot,
  type PlayerStats,
  serializeInventoryForSchema,
} from '@witchcraft/shared';

/** Colyseus-synced player schema */
export class PlayerSchema extends Schema {
  @type('string') id: string = '';
  @type('string') sessionId: string = '';
  @type('string') displayName: string = 'Witch';
  @type('number') x: number = 8;
  @type('number') y: number = 10;
  @type('string') scene: string = 'apartment';
  @type('string') direction: string = 'down';

  // Stats serialized as JSON strings for flexibility
  @type('string') statsJson: string = JSON.stringify(DEFAULT_STATS);
  @type('string') inventoryJson: string = '[]';
  @type('string') altarJson: string = JSON.stringify(defaultAltar());
  @type('string') auraJson: string = JSON.stringify(defaultAura());
  @type('string') familiarId: string = '';
  @type('number') coins: number = 100;
  @type('string') dbPlayerId: string = '';
  @type('string') decorationsJson: string = '[]';

  get stats(): PlayerStats {
    return JSON.parse(this.statsJson);
  }
  set stats(v: PlayerStats) {
    this.statsJson = JSON.stringify(v);
  }

  get inventory(): InventorySlot[] {
    return JSON.parse(this.inventoryJson);
  }
  set inventory(v: InventorySlot[]) {
    this.inventoryJson = JSON.stringify(serializeInventoryForSchema(v));
  }

  get altar(): AltarState {
    return JSON.parse(this.altarJson);
  }
  set altar(v: AltarState) {
    this.altarJson = JSON.stringify(v);
  }

  get aura(): AuraState {
    return JSON.parse(this.auraJson);
  }
  set aura(v: AuraState) {
    this.auraJson = JSON.stringify(v);
  }
}

export class GameRoomState extends Schema {
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  @type('string') scene: string = 'apartment';
  @type('number') tick: number = 0;
}

function defaultAltar(): AltarState {
  return {
    candles: [],
    herbs: [],
    incense: [],
    petitions: [],
    poppets: [],
    taglocks: [],
    decorationIds: [],
  };
}

function defaultAura(): AuraState {
  return {
    alignment: 'neutral',
    moralityScore: 0,
    blessings: [],
    hexes: [],
    attachments: [],
    parasites: [],
    protections: [],
    wards: [],
    curseResidue: [],
    energeticDamage: 0,
  };
}

export { defaultAltar, defaultAura };
