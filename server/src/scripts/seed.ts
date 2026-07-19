import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '../services/db.js';
import { DEFAULT_STATS } from '@witchcraft/shared';
import { seedAdminFramework } from './seed-admin.js';

/** Seed a demo player + default admin for local development */
async function seed() {
  console.log('[seed] Creating demo player...');

  const demoPassword = process.env.DEMO_PLAYER_PASSWORD ?? 'demo123';
  const passwordHash = await bcrypt.hash(demoPassword, 12);

  const player = await prisma.player.upsert({
    where: { username: 'demo_witch' },
    create: {
      username: 'demo_witch',
      displayName: 'Demo Witch',
      passwordHash,
      stats: {
        create: {
          health: DEFAULT_STATS.health,
          hunger: DEFAULT_STATS.hunger,
          magicalEnergy: DEFAULT_STATS.magicalEnergy,
          protection: DEFAULT_STATS.protection,
          intuition: DEFAULT_STATS.intuition,
          spiritualAwareness: DEFAULT_STATS.spiritualAwareness,
          divinationSkill: DEFAULT_STATS.divinationSkill,
          herbalism: DEFAULT_STATS.herbalism,
          cursecraft: DEFAULT_STATS.cursecraft,
          warding: DEFAULT_STATS.warding,
          healing: DEFAULT_STATS.healing,
          ritualSkill: DEFAULT_STATS.ritualSkill,
          experience: DEFAULT_STATS.experience,
          reputation: DEFAULT_STATS.reputation,
          morality: DEFAULT_STATS.morality,
          affinities: DEFAULT_STATS.affinities as Prisma.InputJsonValue,
          // stamina + mental/technical skills live in JSON, not columns
          extendedStats: {
            stamina: DEFAULT_STATS.stamina,
            willpower: DEFAULT_STATS.willpower,
            memory: DEFAULT_STATS.memory,
            presence: DEFAULT_STATS.presence,
            authority: DEFAULT_STATS.authority,
            mediumship: DEFAULT_STATS.mediumship,
            potionMaking: DEFAULT_STATS.potionMaking,
            spiritNegotiation: DEFAULT_STATS.spiritNegotiation,
          } as Prisma.InputJsonValue,
        },
      },
      apartment: { create: {} },
      aura: { create: { effects: [] } },
      inventory: {
        create: [
          { itemId: 'white_candle', quantity: 3 },
          { itemId: 'rosemary', quantity: 5 },
          { itemId: 'salt', quantity: 4 },
        ],
      },
    },
    update: {
      // Ensure existing demo rows can sign in after a DB wipe / reseed
      passwordHash,
    },
  });

  console.log(`[seed] Demo player: ${player.id} (username=demo_witch password=${demoPassword})`);

  await seedAdminFramework();
}

seed()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
