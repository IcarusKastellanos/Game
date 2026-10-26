import { api } from '../api.js';
import { esc } from '../helpers/form-html.js';

type Named = { id: string; name: string; role?: string; category?: string; requiresLicense?: string };
type Catalog = {
  spells: Named[];
  npcs: Named[];
  spirits: Named[];
  places: Named[];
  spellCategories: string[];
  recognitionTiers: { id: string; label: string; rank: number }[];
  skillKeys: string[];
};

type PracticeRules = {
  categories: string[];
  minMoralEffect?: number;
  maxMoralEffect?: number;
};

type LicenseRequirements = {
  minLevel?: number;
  minSpiritualRep?: number;
  minRecognition?: string;
  minSkills: Record<string, number>;
  moralityMin?: number;
  moralityMax?: number;
};

type LicenseUnlocks = {
  spellIds: string[];
  spiritIds: string[];
  npcIds: string[];
  placeIds: string[];
  storyFlags: string[];
};

type VowDef = { id: string; label: string; text: string };

type LicenseDef = {
  id: string;
  label: string;
  examNpcId: string;
  fee: number;
  vowId: string;
  requirements: LicenseRequirements;
  markCapacity: number;
  warnAtMarks: number;
  revokeAtMarks: number;
  violationMarkCost: number;
  forbids: PracticeRules;
  allows: PracticeRules;
  healingPotencyMultiplier?: number;
  unlocks: LicenseUnlocks;
};

type LicensesDocument = {
  schemaVersion: number;
  note?: string;
  vows: VowDef[];
  licenses: LicenseDef[];
};

let doc: LicensesDocument | null = null;
let catalog: Catalog | null = null;
let selectedLicenseId = '';
let selectedVowId = '';
let tab: 'licenses' | 'vows' = 'licenses';

function blankLicense(): LicenseDef {
  return {
    id: `license_${Date.now().toString(36)}`,
    label: 'New Credential',
    examNpcId: catalog?.npcs[0]?.id ?? 'npc_council_clerk',
    fee: 50,
    vowId: doc?.vows[0]?.id ?? '',
    requirements: { minSkills: {} },
    markCapacity: 10,
    warnAtMarks: 4,
    revokeAtMarks: 0,
    violationMarkCost: 2,
    forbids: { categories: [] },
    allows: { categories: [] },
    unlocks: { spellIds: [], spiritIds: [], npcIds: [], placeIds: [], storyFlags: [] },
  };
}

function blankVow(): VowDef {
  return {
    id: `vow_${Date.now().toString(36)}`,
    label: 'New Vow',
    text: '',
  };
}

function currentLicense(): LicenseDef | undefined {
  return doc?.licenses.find((l) => l.id === selectedLicenseId);
}

function currentVow(): VowDef | undefined {
  return doc?.vows.find((v) => v.id === selectedVowId);
}

function csv(ids: string[]): string {
  return ids.join(', ');
}

function parseCsv(raw: string): string[] {
  return [...new Set(raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))];
}

function scrapeLicense(license: LicenseDef): void {
  if (!document.getElementById('lic-id')) return;
  const nextId = (document.getElementById('lic-id') as HTMLInputElement).value.trim() || license.id;
  if (nextId !== license.id) {
    const clash = doc!.licenses.some((l) => l.id === nextId && l !== license);
    if (!clash) {
      selectedLicenseId = nextId;
      license.id = nextId;
    }
  }
  license.label = (document.getElementById('lic-label') as HTMLInputElement).value.trim() || license.id;
  license.examNpcId = (document.getElementById('lic-exam') as HTMLSelectElement).value;
  license.fee = Math.max(0, Number((document.getElementById('lic-fee') as HTMLInputElement).value) || 0);
  license.vowId = (document.getElementById('lic-vow') as HTMLSelectElement).value;
  license.markCapacity = Math.max(1, Number((document.getElementById('lic-cap') as HTMLInputElement).value) || 10);
  license.warnAtMarks = Math.max(0, Number((document.getElementById('lic-warn') as HTMLInputElement).value) || 0);
  license.revokeAtMarks = Math.max(0, Number((document.getElementById('lic-revoke') as HTMLInputElement).value) || 0);
  license.violationMarkCost = Math.max(1, Number((document.getElementById('lic-cost') as HTMLInputElement).value) || 1);
  const heal = (document.getElementById('lic-heal') as HTMLInputElement).value.trim();
  license.healingPotencyMultiplier = heal === '' ? undefined : Math.max(0, Number(heal) || 0);

  const minLevel = (document.getElementById('req-level') as HTMLInputElement).value.trim();
  const minSpi = (document.getElementById('req-spi') as HTMLInputElement).value.trim();
  const minRec = (document.getElementById('req-rec') as HTMLSelectElement).value;
  const moralityMin = (document.getElementById('req-mor-min') as HTMLInputElement).value.trim();
  const moralityMax = (document.getElementById('req-mor-max') as HTMLInputElement).value.trim();
  const minSkills: Record<string, number> = {};
  for (const key of catalog?.skillKeys ?? []) {
    const input = document.getElementById(`skill-${key}`) as HTMLInputElement | null;
    if (!input || input.value.trim() === '') continue;
    const n = Number(input.value);
    if (Number.isFinite(n)) minSkills[key] = n;
  }
  license.requirements = {
    minLevel: minLevel === '' ? undefined : Number(minLevel) || undefined,
    minSpiritualRep: minSpi === '' ? undefined : Number(minSpi) || undefined,
    minRecognition: minRec || undefined,
    minSkills,
    moralityMin: moralityMin === '' ? undefined : Number(moralityMin),
    moralityMax: moralityMax === '' ? undefined : Number(moralityMax),
  };

  license.forbids = {
    categories: [...document.querySelectorAll<HTMLInputElement>('input[data-forbid]:checked')].map((el) => el.dataset.forbid!),
    minMoralEffect: (() => {
      const v = (document.getElementById('forbid-min-moral') as HTMLInputElement).value.trim();
      return v === '' ? undefined : Number(v);
    })(),
    maxMoralEffect: (() => {
      const v = (document.getElementById('forbid-max-moral') as HTMLInputElement).value.trim();
      return v === '' ? undefined : Number(v);
    })(),
  };
  license.allows = {
    categories: [...document.querySelectorAll<HTMLInputElement>('input[data-allow]:checked')].map((el) => el.dataset.allow!),
  };

  license.unlocks = {
    spellIds: [...document.querySelectorAll<HTMLInputElement>('input[data-unlock="spellIds"]:checked')].map((el) => el.dataset.id!),
    spiritIds: [...document.querySelectorAll<HTMLInputElement>('input[data-unlock="spiritIds"]:checked')].map((el) => el.dataset.id!),
    npcIds: [...document.querySelectorAll<HTMLInputElement>('input[data-unlock="npcIds"]:checked')].map((el) => el.dataset.id!),
    placeIds: [...document.querySelectorAll<HTMLInputElement>('input[data-unlock="placeIds"]:checked')].map((el) => el.dataset.id!),
    storyFlags: parseCsv((document.getElementById('lic-flags') as HTMLInputElement).value),
  };
}

function scrapeVow(vow: VowDef): void {
  if (!document.getElementById('vow-id')) return;
  const nextId = (document.getElementById('vow-id') as HTMLInputElement).value.trim() || vow.id;
  if (nextId !== vow.id) {
    const clash = doc!.vows.some((v) => v.id === nextId && v !== vow);
    if (!clash) {
      for (const lic of doc!.licenses) {
        if (lic.vowId === vow.id) lic.vowId = nextId;
      }
      selectedVowId = nextId;
      vow.id = nextId;
    }
  }
  vow.label = (document.getElementById('vow-label') as HTMLInputElement).value.trim() || vow.id;
  vow.text = (document.getElementById('vow-text') as HTMLTextAreaElement).value;
}

export async function renderLicenseEditor(el: HTMLElement): Promise<void> {
  el.innerHTML = `<div class="card"><p class="muted-text">Loading Magical Council licenses…</p></div>`;
  try {
    const data = await api<{ document: LicensesDocument; catalog: Catalog }>('/content/licenses');
    doc = {
      schemaVersion: 1,
      note: data.document.note,
      vows: data.document.vows ?? [],
      licenses: (data.document.licenses ?? []).map((l) => ({
        ...l,
        requirements: {
          ...l.requirements,
          minSkills: { ...(l.requirements?.minSkills ?? {}) },
        },
        forbids: {
          ...l.forbids,
          categories: [...(l.forbids?.categories ?? [])],
        },
        allows: {
          ...l.allows,
          categories: [...(l.allows?.categories ?? [])],
        },
        unlocks: {
          spellIds: [...(l.unlocks?.spellIds ?? [])],
          spiritIds: [...(l.unlocks?.spiritIds ?? [])],
          npcIds: [...(l.unlocks?.npcIds ?? [])],
          placeIds: [...(l.unlocks?.placeIds ?? [])],
          storyFlags: [...(l.unlocks?.storyFlags ?? [])],
        },
      })),
    };
    catalog = data.catalog;
    selectedLicenseId = doc.licenses[0]?.id ?? '';
    selectedVowId = doc.vows[0]?.id ?? '';
    paint(el);
  } catch (err) {
    el.innerHTML = `<div class="card"><p class="error">${esc(err instanceof Error ? err.message : err)}</p></div>`;
  }
}

function unlockGrid(
  key: 'spellIds' | 'spiritIds' | 'npcIds' | 'placeIds',
  rows: Named[],
  owned: string[],
  title: string,
  hint: string
): string {
  return `<div class="card"><h2>${esc(title)}</h2><p class="muted-text">${esc(hint)}</p>
    <div class="unlock-grid">
      ${rows.map((row) => {
        const extra = row.role || row.category ? ` · ${row.role || row.category}` : '';
        const tag = row.requiresLicense && row.requiresLicense !== selectedLicenseId
          ? ` <span class="badge">${esc(row.requiresLicense)}</span>`
          : '';
        return `<label class="checkbox-chip"><input type="checkbox" data-unlock="${key}" data-id="${esc(row.id)}" ${owned.includes(row.id) ? 'checked' : ''} /> ${esc(row.name)}${esc(extra)}${tag}</label>`;
      }).join('') || '<p class="muted-text">No catalog entries yet.</p>'}
    </div></div>`;
}

function paint(el: HTMLElement): void {
  if (!doc || !catalog) return;
  const cat = catalog;

  el.innerHTML = `
    <div class="card">
      <h2>Magical Council credentials</h2>
      <p class="muted-text">Edit exams, vows, Licensure Marks, practice forbids/allows, and credential unlocks. Saving writes <code>content/progression/licenses.json</code> and reloads live license gates.</p>
      <div class="level-tabs">
        <button type="button" class="secondary ${tab === 'licenses' ? 'active' : ''}" data-tab="licenses">Licenses (${doc.licenses.length})</button>
        <button type="button" class="secondary ${tab === 'vows' ? 'active' : ''}" data-tab="vows">Vows (${doc.vows.length})</button>
      </div>
    </div>
    ${tab === 'licenses' ? paintLicenses(cat) : paintVows()}
    <div class="card flex">
      <button class="btn" id="lic-save" type="button">Save licenses</button>
      <span id="lic-status" class="muted-text"></span>
    </div>`;

  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => {
    button.onclick = () => {
      if (tab === 'licenses') {
        const lic = currentLicense();
        if (lic) scrapeLicense(lic);
      } else {
        const vow = currentVow();
        if (vow) scrapeVow(vow);
      }
      tab = button.dataset.tab === 'vows' ? 'vows' : 'licenses';
      paint(el);
    };
  });

  if (tab === 'licenses') bindLicenseHandlers(el);
  else bindVowHandlers(el);

  document.getElementById('lic-save')!.onclick = async () => {
    const status = document.getElementById('lic-status')!;
    if (!doc) return;
    if (tab === 'licenses') {
      const lic = currentLicense();
      if (lic) scrapeLicense(lic);
    } else {
      const vow = currentVow();
      if (vow) scrapeVow(vow);
    }
    status.textContent = 'Saving…';
    try {
      const saved = await api<{ document: LicensesDocument; catalog: Catalog }>('/content/licenses', {
        method: 'PUT',
        body: JSON.stringify({ document: doc }),
      });
      doc = {
        schemaVersion: 1,
        note: saved.document.note,
        vows: saved.document.vows ?? [],
        licenses: saved.document.licenses ?? [],
      };
      catalog = saved.catalog;
      if (!doc.licenses.some((l) => l.id === selectedLicenseId)) selectedLicenseId = doc.licenses[0]?.id ?? '';
      if (!doc.vows.some((v) => v.id === selectedVowId)) selectedVowId = doc.vows[0]?.id ?? '';
      paint(el);
      const again = document.getElementById('lic-status');
      if (again) again.textContent = 'Saved. Live credential gates updated.';
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : String(err);
    }
  };
}

function paintLicenses(cat: Catalog): string {
  if (!doc) return '';
  const license = currentLicense();
  if (!license) {
    return `<div class="card"><p class="muted-text">No licenses yet.</p><button class="btn" id="lic-add" type="button">Add license</button></div>`;
  }
  const req = license.requirements;
  return `
    <div class="card">
      <div class="level-tabs" id="license-tabs">
        ${doc.licenses.map((row) => `<button type="button" class="secondary ${row.id === selectedLicenseId ? 'active' : ''}" data-license="${esc(row.id)}">${esc(row.label)}</button>`).join('')}
      </div>
      <div class="flex mt" style="gap:8px;flex-wrap:wrap">
        <button class="btn secondary" id="lic-add" type="button">Add license</button>
        <button class="btn danger" id="lic-del" type="button">Delete selected</button>
      </div>
    </div>
    <div class="card">
      <h2>${esc(license.label)}</h2>
      <div class="form-grid">
        <label class="form-field"><span class="form-label">Id</span><input id="lic-id" value="${esc(license.id)}" /></label>
        <label class="form-field"><span class="form-label">Label</span><input id="lic-label" value="${esc(license.label)}" /></label>
        <label class="form-field"><span class="form-label">Exam fee (coins)</span><input id="lic-fee" type="number" min="0" value="${license.fee}" /></label>
        <label class="form-field"><span class="form-label">Examiner NPC</span>
          <select id="lic-exam">${cat.npcs.map((n) => `<option value="${esc(n.id)}" ${n.id === license.examNpcId ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}</select>
        </label>
        <label class="form-field"><span class="form-label">Vow</span>
          <select id="lic-vow"><option value="">—</option>${doc.vows.map((v) => `<option value="${esc(v.id)}" ${v.id === license.vowId ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
        </label>
        <label class="form-field"><span class="form-label">Healing potency × (hexworkers)</span><input id="lic-heal" type="number" step="0.05" min="0" max="1" value="${license.healingPotencyMultiplier ?? ''}" placeholder="1.0" /></label>
      </div>
    </div>
    <div class="card">
      <h2>Licensure Marks</h2>
      <div class="form-grid">
        <label class="form-field"><span class="form-label">Mark capacity</span><input id="lic-cap" type="number" min="1" value="${license.markCapacity}" /></label>
        <label class="form-field"><span class="form-label">Warn at marks ≤</span><input id="lic-warn" type="number" min="0" value="${license.warnAtMarks}" /></label>
        <label class="form-field"><span class="form-label">Revoke at marks ≤</span><input id="lic-revoke" type="number" min="0" value="${license.revokeAtMarks}" /></label>
        <label class="form-field"><span class="form-label">Marks lost per violation</span><input id="lic-cost" type="number" min="1" value="${license.violationMarkCost}" /></label>
      </div>
    </div>
    <div class="card">
      <h2>Exam requirements (holistic scan)</h2>
      <div class="form-grid">
        <label class="form-field"><span class="form-label">Min level</span><input id="req-level" type="number" min="1" value="${req.minLevel ?? ''}" placeholder="—" /></label>
        <label class="form-field"><span class="form-label">Min spiritual rep</span><input id="req-spi" type="number" value="${req.minSpiritualRep ?? ''}" placeholder="—" /></label>
        <label class="form-field"><span class="form-label">Min recognition</span>
          <select id="req-rec"><option value="">—</option>${cat.recognitionTiers.map((t) => `<option value="${esc(t.id)}" ${t.id === req.minRecognition ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
        </label>
        <label class="form-field"><span class="form-label">Morality min</span><input id="req-mor-min" type="number" value="${req.moralityMin ?? ''}" placeholder="—" /></label>
        <label class="form-field"><span class="form-label">Morality max</span><input id="req-mor-max" type="number" value="${req.moralityMax ?? ''}" placeholder="—" /></label>
      </div>
      <h3 class="mt">Minimum skills</h3>
      <div class="form-grid">
        ${cat.skillKeys.map((key) => `<label class="form-field"><span class="form-label">${esc(key)}</span><input id="skill-${esc(key)}" type="number" value="${req.minSkills[key] ?? ''}" placeholder="—" /></label>`).join('')}
      </div>
    </div>
    <div class="card">
      <h2>Practice forbids</h2>
      <p class="muted-text">Casting these categories (or moral polarity) while holding the seal spends Licensure Marks.</p>
      <div class="checkbox-group">
        ${cat.spellCategories.map((c) => `<label class="checkbox-chip"><input type="checkbox" data-forbid="${esc(c)}" ${license.forbids.categories.includes(c) ? 'checked' : ''} /> ${esc(c)}</label>`).join('')}
      </div>
      <div class="form-grid mt">
        <label class="form-field"><span class="form-label">Min moralEffect allowed</span><input id="forbid-min-moral" type="number" value="${license.forbids.minMoralEffect ?? ''}" placeholder="e.g. 0 for healers" /></label>
        <label class="form-field"><span class="form-label">Max moralEffect allowed</span><input id="forbid-max-moral" type="number" value="${license.forbids.maxMoralEffect ?? ''}" placeholder="—" /></label>
      </div>
    </div>
    <div class="card">
      <h2>Practice allows (clean recovery)</h2>
      <p class="muted-text">Successful casts in these categories slowly restore marks.</p>
      <div class="checkbox-group">
        ${cat.spellCategories.map((c) => `<label class="checkbox-chip"><input type="checkbox" data-allow="${esc(c)}" ${license.allows.categories.includes(c) ? 'checked' : ''} /> ${esc(c)}</label>`).join('')}
      </div>
    </div>
    ${unlockGrid('spellIds', cat.spells, license.unlocks.spellIds, 'Credential spells', 'Spells that only this license unlocks (also set requiresLicense on the spell).')}
    ${unlockGrid('spiritIds', cat.spirits, license.unlocks.spiritIds, 'License spirits', 'Spirit contacts reserved for this credential.')}
    ${unlockGrid('npcIds', cat.npcs, license.unlocks.npcIds, 'License NPCs', 'Teachers / temple staff gated by this credential.')}
    ${unlockGrid('placeIds', cat.places, license.unlocks.placeIds, 'License places', 'Map interactables with placeId (healer office, seal yard, psychic tent).')}
    <div class="card">
      <label class="form-field"><span class="form-label">Story flags (comma-separated)</span><input id="lic-flags" value="${esc(csv(license.unlocks.storyFlags))}" /></label>
    </div>`;
}

function paintVows(): string {
  if (!doc) return '';
  const vow = currentVow();
  if (!vow) {
    return `<div class="card"><p class="muted-text">No vows yet.</p><button class="btn" id="vow-add" type="button">Add vow</button></div>`;
  }
  return `
    <div class="card">
      <div class="level-tabs" id="vow-tabs">
        ${doc.vows.map((row) => `<button type="button" class="secondary ${row.id === selectedVowId ? 'active' : ''}" data-vow="${esc(row.id)}">${esc(row.label)}</button>`).join('')}
      </div>
      <div class="flex mt" style="gap:8px;flex-wrap:wrap">
        <button class="btn secondary" id="vow-add" type="button">Add vow</button>
        <button class="btn danger" id="vow-del" type="button">Delete selected</button>
      </div>
    </div>
    <div class="card">
      <h2>${esc(vow.label)}</h2>
      <div class="form-grid">
        <label class="form-field"><span class="form-label">Id</span><input id="vow-id" value="${esc(vow.id)}" /></label>
        <label class="form-field"><span class="form-label">Label</span><input id="vow-label" value="${esc(vow.label)}" /></label>
      </div>
      <label class="form-field"><span class="form-label">Vow text (spoken at exam)</span><textarea id="vow-text" rows="5">${esc(vow.text)}</textarea></label>
    </div>`;
}

function bindLicenseHandlers(el: HTMLElement): void {
  document.querySelectorAll<HTMLButtonElement>('#license-tabs button').forEach((button) => {
    button.onclick = () => {
      const lic = currentLicense();
      if (lic) scrapeLicense(lic);
      selectedLicenseId = button.dataset.license ?? selectedLicenseId;
      paint(el);
    };
  });
  document.getElementById('lic-add')!.onclick = () => {
    const lic = currentLicense();
    if (lic) scrapeLicense(lic);
    const created = blankLicense();
    doc!.licenses.push(created);
    selectedLicenseId = created.id;
    paint(el);
  };
  document.getElementById('lic-del')?.addEventListener('click', () => {
    if (!doc || doc.licenses.length <= 1) return;
    if (!confirm(`Delete credential ${selectedLicenseId}?`)) return;
    doc.licenses = doc.licenses.filter((l) => l.id !== selectedLicenseId);
    selectedLicenseId = doc.licenses[0]?.id ?? '';
    paint(el);
  });
}

function bindVowHandlers(el: HTMLElement): void {
  document.querySelectorAll<HTMLButtonElement>('#vow-tabs button').forEach((button) => {
    button.onclick = () => {
      const vow = currentVow();
      if (vow) scrapeVow(vow);
      selectedVowId = button.dataset.vow ?? selectedVowId;
      paint(el);
    };
  });
  document.getElementById('vow-add')!.onclick = () => {
    const vow = currentVow();
    if (vow) scrapeVow(vow);
    const created = blankVow();
    doc!.vows.push(created);
    selectedVowId = created.id;
    paint(el);
  };
  document.getElementById('vow-del')?.addEventListener('click', () => {
    if (!doc || !doc.vows.length) return;
    if (!confirm(`Delete vow ${selectedVowId}?`)) return;
    doc.vows = doc.vows.filter((v) => v.id !== selectedVowId);
    for (const lic of doc.licenses) {
      if (lic.vowId === selectedVowId) lic.vowId = '';
    }
    selectedVowId = doc.vows[0]?.id ?? '';
    paint(el);
  });
}
