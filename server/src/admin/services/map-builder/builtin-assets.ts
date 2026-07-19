import { prisma } from '../../../services/db.js';
import type { MapBuilderDocument } from '@witchcraft/shared';

const ENCHANTING_TABLE_OLD_ID = 'enchanting_table';
const ENCHANTING_TABLE_NEW_ID = 'furn_enchanting_table';

const BUILTIN_FURNITURE = [
  {
    id: 'furn_altar',
    name: 'Altar',
    category: 'altar',
    spriteRef: 'obj_altar',
    width: 1,
    height: 1,
    properties: {
      interactionType: 'altar',
      interactionData: { upgradeLevel: 1 },
    },
    archived: false,
  },
  {
    id: 'furn_potion_shelf',
    name: 'Potion Shelf',
    category: 'crafting',
    spriteRef: 'obj_shelf',
    width: 1,
    height: 1,
    properties: {
      interactionType: 'potion_shelf',
      interactionData: { stationType: 'potion_shelf' },
    },
    archived: false,
  },
  {
    id: 'furn_enchanting_table',
    name: 'Enchanting Table',
    category: 'crafting',
    spriteRef: 'obj_shelf',
    width: 2,
    height: 1,
    properties: {
      interactionType: 'enchanting_table',
      interactionData: { stationType: 'enchanting_table' },
    },
    archived: false,
  },
  {
    id: 'furn_cleanser',
    name: 'Cleansing Basin',
    category: 'utility',
    spriteRef: 'obj_cleanser',
    width: 1,
    height: 1,
    properties: {
      interactionType: 'cleanser',
      interactionData: { label: 'Cleansing Basin' },
    },
    archived: false,
  },
] as const;

/** Rename legacy furniture def id and fix map project references. */
async function migrateEnchantingTableFurnitureId(): Promise<void> {
  const old = await prisma.mapFurnitureDefinition.findUnique({
    where: { id: ENCHANTING_TABLE_OLD_ID },
  });
  if (!old) return;

  const existingNew = await prisma.mapFurnitureDefinition.findUnique({
    where: { id: ENCHANTING_TABLE_NEW_ID },
  });

  if (existingNew) {
    await prisma.mapFurnitureDefinition.delete({ where: { id: ENCHANTING_TABLE_OLD_ID } });
  } else {
    await prisma.mapFurnitureDefinition.create({
      data: {
        id: ENCHANTING_TABLE_NEW_ID,
        name: old.name,
        category: old.category,
        spriteRef: old.spriteRef,
        width: old.width,
        height: old.height,
        properties: old.properties as never,
        archived: old.archived,
      },
    });
    await prisma.mapFurnitureDefinition.delete({ where: { id: ENCHANTING_TABLE_OLD_ID } });
  }

  const versions = await prisma.mapVersion.findMany({ select: { id: true, document: true } });
  for (const version of versions) {
    const doc = version.document as unknown as MapBuilderDocument;
    let changed = false;
    for (const piece of doc.placedFurniture ?? []) {
      if (piece.furnitureDefId === ENCHANTING_TABLE_OLD_ID) {
        piece.furnitureDefId = ENCHANTING_TABLE_NEW_ID;
        changed = true;
      }
    }
    if (changed) {
      await prisma.mapVersion.update({
        where: { id: version.id },
        data: { document: doc as never },
      });
    }
  }
}

/** Seed default furniture definitions when missing (altar, etc.). */
export async function ensureBuiltinFurnitureDefinitions(): Promise<void> {
  await migrateEnchantingTableFurnitureId();

  for (const item of BUILTIN_FURNITURE) {
    const existing = await prisma.mapFurnitureDefinition.findUnique({ where: { id: item.id } });
    if (existing) continue;
    await prisma.mapFurnitureDefinition.create({
      data: {
        id: item.id,
        name: item.name,
        category: item.category,
        spriteRef: item.spriteRef,
        width: item.width,
        height: item.height,
        properties: item.properties,
        archived: item.archived,
      },
    });
  }
}
