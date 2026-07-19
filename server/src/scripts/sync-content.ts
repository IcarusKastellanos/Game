import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../services/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = resolve(__dirname, '../../../content');

function load<T>(file: string): T[] {
  return JSON.parse(readFileSync(resolve(CONTENT_DIR, file), 'utf-8'));
}

/** Sync JSON content files into PostgreSQL for admin editing */
async function syncContent() {
  console.log('[sync-content] Starting...');

  for (const ing of load<Record<string, unknown>>('ingredients.json')) {
    const iconPixels = ing.iconPixels as string[] | undefined;
    await prisma.contentIngredient.upsert({
      where: { id: ing.id as string },
      create: {
        id: ing.id as string,
        name: ing.name as string,
        category: ing.category as string,
        correspondences: ing.correspondences as object,
        description: ing.description as string,
        rarity: ing.rarity as string,
        basePotency: ing.basePotency as number,
        traditions: ing.traditions as object,
        data: { iconPixels: iconPixels ?? null },
      },
      update: {
        name: ing.name as string,
        description: ing.description as string,
        data: { iconPixels: iconPixels ?? null },
      },
    });
  }

  for (const spell of load<Record<string, unknown>>('spells.json')) {
    await prisma.contentSpell.upsert({
      where: { id: spell.id as string },
      create: {
        id: spell.id as string,
        name: spell.name as string,
        tradition: spell.tradition as string,
        category: spell.category as string,
        targetType: spell.targetType as string,
        ingredients: spell.ingredients as object,
        requiredTools: spell.requiredTools as object,
        optionalBoosters: (spell.optionalBoosters as object) ?? undefined,
        taglockRequirement: (spell.taglockRequirement as object) ?? undefined,
        altarRequirements: (spell.altarRequirements as object) ?? undefined,
        castingTime: spell.castingTime as number,
        duration: spell.duration as number,
        difficulty: spell.difficulty as number,
        basePotency: spell.basePotency as number,
        maintenanceCost: spell.maintenanceCost as number,
        counterspellTags: spell.counterspellTags as object,
        moralEffect: spell.moralEffect as number,
        familiarInteractions: (spell.familiarInteractions as object) ?? undefined,
        visualEffect: (spell.visualEffect as string) ?? undefined,
        audioEffect: (spell.audioEffect as string) ?? undefined,
        gameplayEffect: spell.gameplayEffect as object,
        description: spell.description as string,
      },
      update: { name: spell.name as string, description: spell.description as string },
    });
  }

  for (const map of load<Record<string, unknown>>('maps.json')) {
    await prisma.contentMap.upsert({
      where: { id: map.id as string },
      create: {
        id: map.id as string,
        name: map.name as string,
        sceneId: map.sceneId as string,
        width: map.width as number,
        height: map.height as number,
        tileSize: map.tileSize as number,
        layers: map.layers as object,
        spawnPoints: map.spawnPoints as object,
        interactables: map.interactables as object,
      },
      update: { name: map.name as string },
    });
  }

  console.log('[sync-content] Done.');
}

syncContent()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
