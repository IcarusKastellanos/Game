import {
  getLicensesDocument,
  getRecognitionDocument,
  normalizeLicensesDocument,
  setLicensesContent,
  type LicensesDocument,
} from '@witchcraft/shared';
import { readContentObject, writeContentObject } from './json-persist.js';
import { contentRegistry } from './registry.js';

const FILE = 'progression/licenses.json';

export function loadLicensesDocumentFromDisk(): LicensesDocument {
  const raw = readContentObject<unknown>(FILE);
  const doc = normalizeLicensesDocument(raw ?? { schemaVersion: 1, vows: [], licenses: [] });
  setLicensesContent(doc);
  return doc;
}

export function saveLicensesDocument(raw: unknown): LicensesDocument {
  const doc = normalizeLicensesDocument(raw);
  writeContentObject(FILE, {
    schemaVersion: 1,
    note:
      typeof (raw as { note?: unknown })?.note === 'string'
        ? (raw as { note: string }).note
        : 'Magical Council credentials — stronger than recognition tiers. Exams charge a fee, bind a vow, and open credential-only content. Violations spend Licensure Marks.',
    vows: doc.vows,
    licenses: doc.licenses,
  });
  setLicensesContent(doc);
  return getLicensesDocument();
}

export function licenseEditorCatalog() {
  const placeIds = new Set<string>();
  for (const map of contentRegistry.maps.values()) {
    for (const row of map.interactables ?? []) {
      const placeId = row.data?.placeId;
      if (typeof placeId === 'string' && placeId) placeIds.add(placeId);
    }
  }
  const categories = new Set<string>();
  for (const spell of contentRegistry.spells.values()) {
    if (spell.category) categories.add(spell.category);
  }
  return {
    spells: [...contentRegistry.spells.values()].map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      requiresLicense: s.requiresLicense,
    })),
    npcs: [...contentRegistry.npcs.values()].map((n) => ({
      id: n.id,
      name: n.name,
      role: n.role,
    })),
    spirits: [...contentRegistry.spirits.values()].map((s) => ({
      id: s.id,
      name: String(s.name ?? s.id),
      requiresLicense: typeof s.requiresLicense === 'string' ? s.requiresLicense : undefined,
    })),
    places: [...placeIds].sort().map((id) => ({ id, name: id.replace(/^place_/, '').replace(/_/g, ' ') })),
    spellCategories: [...categories].sort(),
    recognitionTiers: getRecognitionDocument().tiers.map((t) => ({
      id: t.id,
      label: t.label,
      rank: t.rank,
    })),
    skillKeys: [
      'healing',
      'warding',
      'protection',
      'cursecraft',
      'divinationSkill',
      'intuition',
      'spiritualAwareness',
      'willpower',
      'ritualSkill',
      'herbalism',
      'mediumship',
    ],
  };
}
