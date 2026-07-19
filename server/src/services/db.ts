import '../config/env.js';
import { PrismaClient } from '@prisma/client';

/** Singleton Prisma client for the game server */
export const prisma = new PrismaClient();

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
