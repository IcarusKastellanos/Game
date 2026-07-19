import { prisma } from '../services/db.js';
import { DEFAULT_STATS } from '@witchcraft/shared';

/** Seed a demo player for persistence testing */
async function seed() {
  console.log('[seed] Creating demo player...');

  const player = await prisma.player.upsert({
    where: { username: 'demo_witch' },
    create: {
      username: 'demo_witch',
      displayName: 'Demo Witch',
      stats: {
        create: {
          ...DEFAULT_STATS,
          affinities: DEFAULT_STATS.affinities,
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
    update: {},
  });

  console.log(`[seed] Demo player: ${player.id}`);
}

seed()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
