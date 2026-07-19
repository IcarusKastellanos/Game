import { api } from '../api.js';
import type {
  MapBuilderDocument,
  MapProjectMetadata,
  MapValidationResult,
} from '@witchcraft/shared';

export interface MapProjectPack {
  metadata: MapProjectMetadata;
  document: MapBuilderDocument;
  versionId?: string;
}

export const mapBuilderApi = {
  listMaps: (archived = false) =>
    api<MapProjectMetadata[]>(`/map-builder/maps${archived ? '?archived=1' : ''}`),

  getMap: (id: string) => api<MapProjectPack>(`/map-builder/maps/${id}`),

  createMap: (partial: Partial<MapProjectMetadata>) =>
    api<MapProjectPack>('/map-builder/maps', { method: 'POST', body: JSON.stringify(partial) }),

  saveDraft: (id: string, metadata: MapProjectMetadata, document: MapBuilderDocument, changelog?: string) =>
    api<MapProjectPack>(`/map-builder/maps/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ metadata, document, changelog }),
    }),

  deleteDraft: (id: string) =>
    api<{ ok: boolean }>(`/map-builder/maps/${id}`, { method: 'DELETE' }),

  duplicate: (id: string) =>
    api<MapProjectPack>(`/map-builder/maps/${id}/duplicate`, { method: 'POST' }),

  archive: (id: string) =>
    api<MapProjectMetadata>(`/map-builder/maps/${id}/archive`, { method: 'POST' }),

  restore: (id: string) =>
    api<MapProjectMetadata>(`/map-builder/maps/${id}/restore`, { method: 'POST' }),

  validate: (id: string) =>
    api<MapValidationResult>(`/map-builder/maps/${id}/validate`, { method: 'POST' }),

  publish: (id: string, changelog?: string) =>
    api<{ ok: boolean; error?: string; validation?: MapValidationResult; metadata?: MapProjectMetadata }>(
      `/map-builder/maps/${id}/publish`,
      { method: 'POST', body: JSON.stringify({ changelog }) }
    ),

  unpublish: (id: string) =>
    api<MapProjectMetadata>(`/map-builder/maps/${id}/unpublish`, { method: 'POST' }),

  listVersions: (id: string) =>
    api<{ id: string; version: number; changelog: string | null; createdBy: string | null; createdAt: string }[]>(
      `/map-builder/maps/${id}/versions`
    ),

  rollback: (id: string, versionId: string) =>
    api<MapProjectPack>(`/map-builder/maps/${id}/rollback/${versionId}`, { method: 'POST' }),

  previewInvite: (id: string, username: string, persona = 'player') =>
    api<unknown>(`/map-builder/maps/${id}/preview-invite`, {
      method: 'POST',
      body: JSON.stringify({ username, persona }),
    }),

  listTilesets: (archived = false) =>
    api<unknown[]>(`/map-builder/tilesets${archived ? '?archived=1' : ''}`),

  upsertTileset: (id: string, data: Record<string, unknown>) =>
    api<unknown>(`/map-builder/tilesets/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  listTiles: (archived = false) =>
    api<unknown[]>(`/map-builder/tiles${archived ? '?archived=1' : ''}`),

  upsertTile: (id: string, data: Record<string, unknown>) =>
    api<unknown>(`/map-builder/tiles/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  listFurniture: (archived = false) =>
    api<unknown[]>(`/map-builder/furniture${archived ? '?archived=1' : ''}`),

  upsertFurniture: (id: string, data: Record<string, unknown>) =>
    api<unknown>(`/map-builder/furniture/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  listDecorations: (archived = false) =>
    api<unknown[]>(`/map-builder/decorations${archived ? '?archived=1' : ''}`),

  upsertDecoration: (id: string, data: Record<string, unknown>) =>
    api<unknown>(`/map-builder/decorations/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  seedDefaultAssets: () =>
    api<{ ok: boolean; tilesetId: string; tiles: number }>('/map-builder/seed-default-assets', {
      method: 'POST',
    }),
  listPublishQueue: () => api<unknown[]>('/map-builder/publish-queue'),
  listPublishHistory: (mapId?: string) =>
    api<unknown[]>(`/map-builder/publish-history${mapId ? `?mapId=${encodeURIComponent(mapId)}` : ''}`),
  listNpcs: () => api<{ id: string; name: string }[]>('/content/npcs').catch(() => []),
  listSpirits: () => api<{ id: string; name: string }[]>('/content/spirits').catch(() => []),

  pushLive: (opts?: { resnapSpawns?: boolean }) =>
    api<{ ok: boolean; revision: number; merged: number; clientsNotified: number; warnings: string[] }>(
      '/map-builder/push-live',
      { method: 'POST', body: JSON.stringify(opts ?? {}) }
    ),
};
