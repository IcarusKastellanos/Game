import { api } from '../api.js';
import type {
  HudLayoutDocument,
  HudLayoutMetadata,
  HudLayoutRecord,
  HudLayoutVersionSummary,
  HudValidationResult,
} from '@witchcraft/shared';

export interface HudAssetEntry {
  path: string;
  name: string;
  category: string;
}

export const hudApi = {
  list: (archived = false) => api<HudLayoutMetadata[]>(`/hud-layouts${archived ? '?archived=1' : ''}`),
  get: (id: string) => api<HudLayoutRecord>(`/hud-layouts/${id}`),
  assets: () => api<HudAssetEntry[]>('/hud-layouts/assets'),
  create: (name: string, document?: HudLayoutDocument) =>
    api<HudLayoutRecord>('/hud-layouts', { method: 'POST', body: JSON.stringify({ name, document }) }),
  save: (id: string, document: HudLayoutDocument, changelog?: string) =>
    api<HudLayoutRecord>(`/hud-layouts/${id}`, { method: 'PUT', body: JSON.stringify({ document, changelog }) }),
  rename: (id: string, name: string) =>
    api<HudLayoutMetadata>(`/hud-layouts/${id}/rename`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  remove: (id: string) => api<{ ok: boolean }>(`/hud-layouts/${id}`, { method: 'DELETE' }),
  duplicate: (id: string) => api<HudLayoutRecord>(`/hud-layouts/${id}/duplicate`, { method: 'POST' }),
  archive: (id: string) => api<HudLayoutMetadata>(`/hud-layouts/${id}/archive`, { method: 'POST' }),
  restore: (id: string) => api<HudLayoutMetadata>(`/hud-layouts/${id}/restore`, { method: 'POST' }),
  validate: (id: string, strict = false) =>
    api<HudValidationResult>(`/hud-layouts/${id}/validate${strict ? '?strict=1' : ''}`, { method: 'POST' }),
  publish: (id: string, changelog?: string) =>
    api<{ ok: boolean; metadata?: HudLayoutMetadata; validation?: HudValidationResult; error?: string }>(
      `/hud-layouts/${id}/publish`,
      { method: 'POST', body: JSON.stringify({ changelog }) }
    ),
  versions: (id: string) => api<HudLayoutVersionSummary[]>(`/hud-layouts/${id}/versions`),
  restoreVersion: (id: string, versionId: string) =>
    api<HudLayoutRecord>(`/hud-layouts/${id}/restore/${versionId}`, { method: 'POST' }),
  import: (document: HudLayoutDocument, replaceId?: string) =>
    api<{ ok: boolean; record?: HudLayoutRecord; error?: string; validation?: HudValidationResult }>(
      '/hud-layouts/import',
      { method: 'POST', body: JSON.stringify({ document, replaceId }) }
    ),
};
