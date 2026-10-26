import { api } from '../api.js';
import { esc } from '../helpers/form-html.js';

type Named = { id: string; name: string };
type Catalog = {
  spells: Named[];
  recipes: Named[];
  hexagrams: Named[];
  items: Named[];
  npcs: { id: string; name: string; role?: string }[];
  quests: Named[];
  statKeys: string[];
  traditions: string[];
};

type SpiritRange = {
  label: string;
  minPower: number;
  maxPower: number;
  traditions: string[];
  notes: string;
};

type LevelProfile = {
  level: number;
  title: string;
  rankLabel: string;
  unlockMessage: string;
  notes: string;
  meCapBonus: number;
  spellIds: string[];
  recipeIds: string[];
  hexagramIds: string[];
  shopItemIds: string[];
  npcIds: string[];
  questIds: string[];
  spiritRange: SpiritRange;
  statFloors: Record<string, number>;
};

type LevelDocument = {
  schemaVersion: number;
  maxLevel: number;
  xpPerLevel: number;
  levels: LevelProfile[];
};

type UnlockBucket = 'spellIds' | 'recipeIds' | 'hexagramIds' | 'shopItemIds' | 'npcIds' | 'questIds';
type CatalogListKey = 'spells' | 'recipes' | 'hexagrams' | 'items' | 'npcs' | 'quests';

const BUCKETS: { key: UnlockBucket; label: string; catalog: CatalogListKey; hint: string }[] = [
  { key: 'spellIds', label: 'Spells that unlock here', catalog: 'spells', hint: 'Checking a spell moves its unlock to this level and updates its minLevel on save.' },
  { key: 'recipeIds', label: 'Craft recipes', catalog: 'recipes', hint: 'Potions, pocket preps, and knot crafts.' },
  { key: 'hexagramIds', label: 'Hexagram enchantments', catalog: 'hexagrams', hint: 'Enchanting-table workings.' },
  { key: 'shopItemIds', label: 'Shop listings', catalog: 'items', hint: 'Items that require this level to buy.' },
  { key: 'npcIds', label: 'NPCs who will speak', catalog: 'npcs', hint: 'Left unchecked, an NPC stays open to every level.' },
  { key: 'questIds', label: 'Quests', catalog: 'quests', hint: 'Quests that can be started at this level.' },
];

let doc: LevelDocument | null = null;
let catalog: Catalog | null = null;
let selected = 1;

export async function renderLevelEditor(el: HTMLElement): Promise<void> {
  el.innerHTML = `<div class="card"><p class="muted-text">Loading practitioner levels…</p></div>`;
  try {
    const data = await api<{ document: LevelDocument; catalog: Catalog }>('/content/levels');
    doc = data.document;
    catalog = data.catalog;
    if (!doc.levels.some((l) => l.level === selected)) selected = doc.levels[0]?.level ?? 1;
    paint(el);
  } catch (err) {
    el.innerHTML = `<div class="card"><p class="error">${esc(err instanceof Error ? err.message : err)}</p></div>`;
  }
}

function currentLevel(): LevelProfile | undefined {
  return doc?.levels.find((level) => level.level === selected);
}

function scrape(level: LevelProfile): void {
  const title = document.getElementById('lvl-title') as HTMLInputElement | null;
  if (!title) return;
  level.title = title.value.trim() || `Level ${level.level}`;
  level.rankLabel = (document.getElementById('lvl-rank') as HTMLInputElement).value.trim() || level.rankLabel;
  level.unlockMessage = (document.getElementById('lvl-msg') as HTMLTextAreaElement).value;
  level.notes = (document.getElementById('lvl-notes') as HTMLTextAreaElement).value;
  level.meCapBonus = Number((document.getElementById('lvl-me') as HTMLInputElement).value) || 0;
  level.spiritRange = {
    label: (document.getElementById('spirit-label') as HTMLInputElement).value.trim(),
    minPower: Number((document.getElementById('spirit-min') as HTMLInputElement).value) || 0,
    maxPower: Number((document.getElementById('spirit-max') as HTMLInputElement).value) || 0,
    traditions: [...document.querySelectorAll<HTMLInputElement>('input[data-tradition]:checked')].map((el) => el.dataset.tradition!),
    notes: (document.getElementById('spirit-notes') as HTMLTextAreaElement).value,
  };
  const floors: Record<string, number> = {};
  for (const key of catalog?.statKeys ?? []) {
    const input = document.getElementById(`floor-${key}`) as HTMLInputElement | null;
    if (!input || input.value.trim() === '') continue;
    const n = Number(input.value);
    if (Number.isFinite(n)) floors[key] = n;
  }
  level.statFloors = floors;
  for (const bucket of BUCKETS) {
    const ids = [...document.querySelectorAll<HTMLInputElement>(`input[data-bucket="${bucket.key}"]:checked`)].map(
      (el) => el.dataset.id!
    );
    for (const other of doc!.levels) {
      if (other.level === level.level) continue;
      other[bucket.key] = other[bucket.key].filter((id) => !ids.includes(id));
    }
    level[bucket.key] = ids;
  }
}

function resizeLevels(maxLevel: number): void {
  if (!doc) return;
  doc.maxLevel = maxLevel;
  const kept = new Map(doc.levels.map((level) => [level.level, level]));
  const next: LevelProfile[] = [];
  for (let level = 1; level <= maxLevel; level++) {
    next.push(
      kept.get(level) ?? {
        level,
        title: `Level ${level}`,
        rankLabel: `Rank ${level}`,
        unlockMessage: '',
        notes: '',
        meCapBonus: 0,
        spellIds: [],
        recipeIds: [],
        hexagramIds: [],
        shopItemIds: [],
        npcIds: [],
        questIds: [],
        spiritRange: { label: '', minPower: 0, maxPower: 10, traditions: [], notes: '' },
        statFloors: {},
      }
    );
  }
  doc.levels = next;
  if (selected > maxLevel) selected = maxLevel;
}

function namesFor(bucket: UnlockBucket, ids: string[]): string {
  const cat = catalog!;
  const bucketDef = BUCKETS.find((b) => b.key === bucket)!;
  const rows = cat[bucketDef.catalog] as { id: string; name: string }[];
  const byId = new Map(rows.map((row) => [row.id, row.name]));
  return ids.map((id) => byId.get(id) ?? id).join(', ');
}

function paint(el: HTMLElement): void {
  if (!doc || !catalog) return;
  const levelsDoc = doc;
  const cat = catalog;
  const level = currentLevel();
  if (!level) return;
  const earlier = levelsDoc.levels.filter((row) => row.level < level.level);

  el.innerHTML = `
    <div class="card">
      <h2>Practitioner levels</h2>
      <p class="muted-text">Each level owns a title, the spells and entities that unlock there, a spirit band, and stat floors. Saving writes <code>content/progression/levels.json</code> and updates minLevel on spells, recipes, hexagrams, shops, and quests. Familiars are not level-gated — every implemented species is available at character start.</p>
      <div class="form-grid">
        <label class="form-field"><span class="form-label">Max level</span><input id="lvl-max" type="number" min="1" max="50" value="${levelsDoc.maxLevel}" /></label>
        <label class="form-field"><span class="form-label">XP per level</span><input id="lvl-xp" type="number" min="1" value="${levelsDoc.xpPerLevel}" /></label>
      </div>
      <div class="level-tabs" id="level-tabs">
        ${levelsDoc.levels.map((row) => `<button type="button" class="secondary ${row.level === selected ? 'active' : ''}" data-level="${row.level}">${row.level} ${esc(row.title)}</button>`).join('')}
      </div>
    </div>
    <div class="card">
      <h2>Level ${level.level} — ${esc(level.title)}</h2>
      <div class="form-grid">
        <label class="form-field"><span class="form-label">Title</span><input id="lvl-title" value="${esc(level.title)}" /></label>
        <label class="form-field"><span class="form-label">Rank label</span><input id="lvl-rank" value="${esc(level.rankLabel)}" /></label>
        <label class="form-field"><span class="form-label">ME cap bonus</span><input id="lvl-me" type="number" value="${level.meCapBonus}" /></label>
      </div>
      <label class="form-field"><span class="form-label">Level-up message</span><textarea id="lvl-msg" rows="2">${esc(level.unlockMessage)}</textarea></label>
      <label class="form-field"><span class="form-label">Admin notes</span><textarea id="lvl-notes" rows="2">${esc(level.notes)}</textarea></label>
    </div>
    <div class="card">
      <h2>Stat floors</h2>
      <p class="muted-text">When a practitioner reaches this level, each stat is raised to the floor if it is lower. Empty leaves the stat alone. Protection still follows the level curve unless this floor is higher.</p>
      <div class="form-grid">
        ${cat.statKeys.map((key) => `<label class="form-field"><span class="form-label">${esc(key)}</span><input id="floor-${esc(key)}" type="number" step="1" value="${level.statFloors[key] ?? ''}" placeholder="—" /></label>`).join('')}
      </div>
    </div>
    <div class="card">
      <h2>Spirit range</h2>
      <p class="muted-text">Which spirits will interact with a practitioner of this grade.</p>
      <div class="form-grid">
        <label class="form-field"><span class="form-label">Band name</span><input id="spirit-label" value="${esc(level.spiritRange.label)}" /></label>
        <label class="form-field"><span class="form-label">Min power</span><input id="spirit-min" type="number" value="${level.spiritRange.minPower}" /></label>
        <label class="form-field"><span class="form-label">Max power</span><input id="spirit-max" type="number" value="${level.spiritRange.maxPower}" /></label>
      </div>
      <div class="checkbox-group">
        ${cat.traditions.map((tradition) => `<label class="checkbox-chip"><input type="checkbox" data-tradition="${esc(tradition)}" ${level.spiritRange.traditions.includes(tradition) ? 'checked' : ''} /> ${esc(tradition.replace(/_/g, ' '))}</label>`).join('')}
      </div>
      <label class="form-field mt"><span class="form-label">Spirit notes</span><textarea id="spirit-notes" rows="2">${esc(level.spiritRange.notes)}</textarea></label>
    </div>
    ${BUCKETS.map((bucket) => {
      const rows = cat[bucket.catalog] as { id: string; name: string; role?: string; species?: string }[];
      const ownedEarlier = earlier.flatMap((row) => row[bucket.key]);
      const earlierText = namesFor(bucket.key, ownedEarlier);
      return `<div class="card"><h2>${esc(bucket.label)}</h2><p class="muted-text">${esc(bucket.hint)}</p>
        ${earlierText ? `<p class="muted-text">Already unlocked earlier: ${esc(earlierText)}</p>` : ''}
        <div class="unlock-grid">
          ${rows.map((row) => {
            const elsewhere = levelsDoc.levels.find((other) => other.level !== level.level && other[bucket.key].includes(row.id));
            const checked = level[bucket.key].includes(row.id);
            const extra = row.role || row.species ? ` · ${row.role || row.species}` : '';
            const tag = elsewhere && !checked ? ` <span class="badge">L${elsewhere.level}</span>` : '';
            return `<label class="checkbox-chip"><input type="checkbox" data-bucket="${bucket.key}" data-id="${esc(row.id)}" ${checked ? 'checked' : ''} /> ${esc(row.name)}${esc(extra)}${tag}</label>`;
          }).join('')}
        </div></div>`;
    }).join('')}
    <div class="card flex">
      <button class="btn" id="lvl-save" type="button">Save all levels</button>
      <span id="lvl-status" class="muted-text"></span>
    </div>`;

  document.getElementById('lvl-max')!.addEventListener('change', () => {
    const levelRow = currentLevel();
    if (levelRow) scrape(levelRow);
    const max = Math.max(1, Math.min(50, Number((document.getElementById('lvl-max') as HTMLInputElement).value) || 1));
    resizeLevels(max);
    paint(el);
  });
  document.getElementById('lvl-xp')!.addEventListener('change', () => {
    if (!doc) return;
    doc.xpPerLevel = Math.max(1, Number((document.getElementById('lvl-xp') as HTMLInputElement).value) || 100);
  });
  document.querySelectorAll<HTMLButtonElement>('#level-tabs button').forEach((button) => {
    button.addEventListener('click', () => {
      const levelRow = currentLevel();
      if (levelRow) scrape(levelRow);
      selected = Number(button.dataset.level);
      paint(el);
    });
  });
  document.getElementById('lvl-save')!.onclick = async () => {
    const status = document.getElementById('lvl-status')!;
    const levelRow = currentLevel();
    if (!doc || !levelRow) return;
    scrape(levelRow);
    doc.xpPerLevel = Math.max(1, Number((document.getElementById('lvl-xp') as HTMLInputElement).value) || doc.xpPerLevel);
    status.textContent = 'Saving…';
    try {
      const saved = await api<{ document: LevelDocument; catalog: Catalog }>('/content/levels', {
        method: 'PUT',
        body: JSON.stringify({ document: doc }),
      });
      doc = saved.document;
      catalog = saved.catalog;
      status.textContent = 'Saved. Live gates updated.';
      paint(el);
      const again = document.getElementById('lvl-status');
      if (again) again.textContent = 'Saved. Live gates updated.';
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : String(err);
    }
  };
}
