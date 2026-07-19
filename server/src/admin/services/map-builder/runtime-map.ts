import type { MapAssetLookup, MapBuilderDocument, MapProjectMetadata } from '@witchcraft/shared';
import { documentToRuntimeMap } from '@witchcraft/shared';
import { prisma } from '../../../services/db.js';

export async function loadMapAssetLookup(): Promise<MapAssetLookup> {
  const [furniture, decorations] = await Promise.all([
    prisma.mapFurnitureDefinition.findMany({ where: { archived: false } }),
    prisma.mapDecorationDefinition.findMany({ where: { archived: false } }),
  ]);

  return {
    furniture: Object.fromEntries(
      furniture.map((f) => [
        f.id,
        {
          spriteRef: f.spriteRef,
          width: f.width,
          height: f.height,
          properties: f.properties,
        },
      ])
    ),
    decorations: Object.fromEntries(
      decorations.map((d) => [
        d.id,
        {
          spriteRef: d.spriteRef,
          wallMounted: d.wallMounted,
          properties: d.properties,
        },
      ])
    ),
  };
}

export async function documentToRuntimeMapWithAssets(
  meta: MapProjectMetadata,
  doc: MapBuilderDocument
) {
  const assets = await loadMapAssetLookup();
  return documentToRuntimeMap(meta, doc, assets);
}
