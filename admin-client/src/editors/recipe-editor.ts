import { api } from '../api.js';
import { esc, textInput, numberInput, textarea, selectInput } from '../helpers/form-html.js';

type CraftRecipe = {
  id: string;
  name: string;
  stationType: string;
  inputs: { itemId: string; quantity: number }[];
  output?: { itemId: string; quantity: number };
  effect?: string;
  spellId?: string;
  enchantIntent?: string;
  meCost?: number;
  discoverOnCraft?: boolean;
  description?: string;
};

type HexRecipe = {
  id: string;
  name: string;
  category: string;
  description: string;
  declarationTemplates: string[];
  difficulty: number;
  meCost: number;
  powerTier: number;
  preparedUses: number;
  activationMethod: string;
  durationLabel?: string;
  effect: string;
  spellId?: string;
  enchantIntent?: string;
  output?: { itemId: string; quantity: number };
  visualTheme: string;
  stationType: string;
  discoverOnCraft?: boolean;
  sockets: { socket: string; itemIds?: string[]; categories?: string[]; label?: string }[];
  augmentations?: { itemId: string; power?: number; stability?: number; backlash?: number; duration?: number; potency?: number }[];
};

type EditorKind = 'craft' | 'hexagram';
type EditorTarget = { kind: EditorKind; id: string | '__new__' } | null;

const STATION_TYPES = ['potion_shelf', 'mirror', 'enchanting_table'];
const CRAFT_EFFECTS = ['item', 'pocket_spell', 'enchant_knot'];
const HEX_CATEGORIES = ['pocket_spell', 'familiar_knot', 'charm', 'talisman', 'binding', 'other'];
const HEX_EFFECTS = ['pocket_spell', 'enchant_knot', 'item'];
const HEX_THEMES = ['protection', 'binding', 'spirit', 'healing', 'baneful', 'dream', 'neutral'];
const SOCKET_IDS = ['power', 'protection', 'communication', 'binding', 'influence', 'offering', 'core'];

let editorTarget: EditorTarget = null;

function isNew(id: string | null | undefined): boolean {
  return !id || id === '__new__';
}

export async function renderRecipeManager(el: HTMLElement): Promise<void> {
  if (editorTarget) {
    return renderRecipeEditor(el, editorTarget, () => {
      editorTarget = null;
      void renderRecipeManager(el);
    });
  }

  const [crafts, hexagram] = await Promise.all([
    api<CraftRecipe[]>('/content/recipes').catch(() => []),
    api<HexRecipe[]>('/content/hexagram-recipes').catch(() => []),
  ]);

  el.innerHTML = `
    <div class="card">
      <h2>Recipe Manager</h2>
      <p>Potions, crafts, mirror recipes, and hexagram enchantments — edit definitions stored in content JSON.</p>
      <div class="mt" style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="new-craft">+ Craft / Potion Recipe</button>
        <button class="btn" id="new-hex">+ Hexagram Enchantment</button>
        <button class="btn secondary" id="recipe-reload">Reload Content from Disk</button>
      </div>
    </div>
    <div class="card mt">
      <h3>Crafts &amp; Potions <span style="color:#888;font-weight:normal">(${crafts.length})</span></h3>
      <table><thead><tr><th>ID</th><th>Name</th><th>Station</th><th>Effect</th><th>ME</th><th></th></tr></thead>
      <tbody>${crafts.map((r) => rowCraft(r)).join('')}</tbody></table>
    </div>
    <div class="card mt">
      <h3>Hexagram Enchantments <span style="color:#888;font-weight:normal">(${hexagram.length})</span></h3>
      <table><thead><tr><th>ID</th><th>Name</th><th>Category</th><th>Effect</th><th>Diff</th><th></th></tr></thead>
      <tbody>${hexagram.map((r) => rowHex(r)).join('')}</tbody></table>
    </div>`;

  document.getElementById('new-craft')!.onclick = () => {
    editorTarget = { kind: 'craft', id: '__new__' };
    void renderRecipeManager(el);
  };
  document.getElementById('new-hex')!.onclick = () => {
    editorTarget = { kind: 'hexagram', id: '__new__' };
    void renderRecipeManager(el);
  };
  document.getElementById('recipe-reload')!.onclick = async () => {
    await api('/content/reload', { method: 'POST', body: '{}' });
    alert('Reloaded');
    void renderRecipeManager(el);
  };

  bindEditLinks(el, 'craft');
  bindEditLinks(el, 'hexagram');
  bindDelete(el, 'craft');
  bindDelete(el, 'hexagram');
}

function rowCraft(r: CraftRecipe): string {
  return `<tr>
    <td><a href="#" class="recipe-edit" data-kind="craft" data-id="${esc(r.id)}" style="color:#fc8">${esc(r.id)}</a></td>
    <td>${esc(r.name)}</td><td>${esc(r.stationType)}</td><td>${esc(r.effect ?? 'item')}</td><td>${r.meCost ?? 0}</td>
    <td><button class="btn danger secondary" data-del-kind="craft" data-id="${esc(r.id)}">Delete</button></td></tr>`;
}

function rowHex(r: HexRecipe): string {
  return `<tr>
    <td><a href="#" class="recipe-edit" data-kind="hexagram" data-id="${esc(r.id)}" style="color:#fc8">${esc(r.id)}</a></td>
    <td>${esc(r.name)}</td><td>${esc(r.category)}</td><td>${esc(r.effect)}</td><td>${r.difficulty}</td>
    <td><button class="btn danger secondary" data-del-kind="hexagram" data-id="${esc(r.id)}">Delete</button></td></tr>`;
}

function bindEditLinks(el: HTMLElement, kind: EditorKind): void {
  el.querySelectorAll(`.recipe-edit[data-kind="${kind}"]`).forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      editorTarget = { kind, id: (a as HTMLElement).dataset.id! };
      void renderRecipeManager(el);
    });
  });
}

function bindDelete(el: HTMLElement, kind: EditorKind): void {
  el.querySelectorAll(`[data-del-kind="${kind}"]`).forEach((b) => {
    b.addEventListener('click', async () => {
      const id = (b as HTMLElement).dataset.id!;
      if (!confirm(`Delete ${kind} recipe ${id}?`)) return;
      const path = kind === 'craft' ? `/content/recipes/${id}` : `/content/hexagram-recipes/${id}`;
      await api(path, { method: 'DELETE' });
      void renderRecipeManager(el);
    });
  });
}

async function renderRecipeEditor(
  el: HTMLElement,
  target: Exclude<EditorTarget, null>,
  onBack: () => void
): Promise<void> {
  const creating = isNew(target.id);

  if (target.kind === 'craft') {
    const recipe = (!creating
      ? await api<CraftRecipe>(`/content/recipes/${target.id}`)
      : {
          id: '',
          name: '',
          stationType: 'potion_shelf',
          inputs: [{ itemId: 'bay_leaf', quantity: 1 }],
          effect: 'item',
          meCost: 0,
          description: '',
        }) as CraftRecipe;

    el.innerHTML = `
      <div class="card">
        <button class="btn secondary" id="back">← Back</button>
        <h2>${creating ? 'New Craft Recipe' : `Edit ${esc(recipe.id)}`}</h2>
        <form id="craft-form" class="mt">
          ${field('ID', textInput('id', recipe.id))}
          ${field('Name', textInput('name', recipe.name))}
          ${field('Station', selectInput('stationType', recipe.stationType, STATION_TYPES))}
          ${field('Effect', selectInput('effect', recipe.effect ?? 'item', CRAFT_EFFECTS))}
          ${field('ME Cost', numberInput('meCost', recipe.meCost ?? 0))}
          ${field('Spell ID (pocket)', textInput('spellId', recipe.spellId ?? ''))}
          ${field('Enchant Intent', textInput('enchantIntent', recipe.enchantIntent ?? ''))}
          ${field('Output Item', textInput('outputItemId', recipe.output?.itemId ?? ''))}
          ${field('Output Qty', numberInput('outputQty', recipe.output?.quantity ?? 1))}
          ${field('Description', textarea('description', recipe.description ?? ''))}
          <h3>Inputs (JSON)</h3>
          <textarea name="inputsJson" rows="6" style="width:100%;font-family:monospace">${esc(JSON.stringify(recipe.inputs, null, 2))}</textarea>
          <button type="submit" class="btn mt">Save</button>
        </form>
      </div>`;

    document.getElementById('back')!.onclick = onBack;
    document.getElementById('craft-form')!.onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target as HTMLFormElement;
      const fd = new FormData(f);
      const outputItemId = String(fd.get('outputItemId') ?? '').trim();
      const body: CraftRecipe = {
        id: String(fd.get('id')),
        name: String(fd.get('name')),
        stationType: String(fd.get('stationType')),
        effect: String(fd.get('effect')),
        meCost: Number(fd.get('meCost')),
        spellId: String(fd.get('spellId') || '') || undefined,
        enchantIntent: String(fd.get('enchantIntent') || '') || undefined,
        description: String(fd.get('description') || '') || undefined,
        inputs: JSON.parse(String(fd.get('inputsJson'))) as CraftRecipe['inputs'],
        output: outputItemId ? { itemId: outputItemId, quantity: Number(fd.get('outputQty')) || 1 } : undefined,
      };
      if (creating) await api('/content/recipes', { method: 'POST', body: JSON.stringify(body) });
      else await api(`/content/recipes/${body.id}`, { method: 'PUT', body: JSON.stringify(body) });
      onBack();
    };
    return;
  }

  const recipe = (!creating
    ? await api<HexRecipe>(`/content/hexagram-recipes/${target.id}`)
    : {
        id: '',
        name: '',
        category: 'charm',
        description: '',
        declarationTemplates: ['I prepare this working with clear intent.'],
        difficulty: 10,
        meCost: 6,
        powerTier: 2,
        preparedUses: 1,
        activationMethod: 'Carried — passive',
        effect: 'item',
        visualTheme: 'neutral',
        stationType: 'enchanting_table',
        sockets: [{ socket: 'core', itemIds: ['bay_leaf'], categories: ['herbs'] }],
        augmentations: [],
      }) as HexRecipe;

  el.innerHTML = `
    <div class="card">
      <button class="btn secondary" id="back">← Back</button>
      <h2>${creating ? 'New Hexagram Enchantment' : `Edit ${esc(recipe.id)}`}</h2>
      <form id="hex-form" class="mt">
        ${field('ID', textInput('id', recipe.id))}
        ${field('Name', textInput('name', recipe.name))}
        ${field('Category', selectInput('category', recipe.category, HEX_CATEGORIES))}
        ${field('Effect', selectInput('effect', recipe.effect, HEX_EFFECTS))}
        ${field('Visual Theme', selectInput('visualTheme', recipe.visualTheme, HEX_THEMES))}
        ${field('Difficulty', numberInput('difficulty', recipe.difficulty))}
        ${field('ME Cost', numberInput('meCost', recipe.meCost))}
        ${field('Power Tier', numberInput('powerTier', recipe.powerTier))}
        ${field('Prepared Uses', numberInput('preparedUses', recipe.preparedUses))}
        ${field('Activation', textInput('activationMethod', recipe.activationMethod))}
        ${field('Duration Label', textInput('durationLabel', recipe.durationLabel ?? ''))}
        ${field('Spell ID', textInput('spellId', recipe.spellId ?? ''))}
        ${field('Enchant Intent', textInput('enchantIntent', recipe.enchantIntent ?? ''))}
        ${field('Output Item', textInput('outputItemId', recipe.output?.itemId ?? ''))}
        ${field('Output Qty', numberInput('outputQty', recipe.output?.quantity ?? 1))}
        ${field('Description', textarea('description', recipe.description))}
        <h3>Declaration Templates (one per line)</h3>
        <textarea name="declarations" rows="4" style="width:100%">${esc(recipe.declarationTemplates.join('\n'))}</textarea>
        <h3>Sockets (JSON)</h3>
        <p style="color:#888;font-size:12px">Socket ids: ${SOCKET_IDS.join(', ')}</p>
        <textarea name="socketsJson" rows="8" style="width:100%;font-family:monospace">${esc(JSON.stringify(recipe.sockets, null, 2))}</textarea>
        <h3>Augmentations (JSON)</h3>
        <textarea name="augsJson" rows="6" style="width:100%;font-family:monospace">${esc(JSON.stringify(recipe.augmentations ?? [], null, 2))}</textarea>
        <button type="submit" class="btn mt">Save</button>
      </form>
    </div>`;

  document.getElementById('back')!.onclick = onBack;
  document.getElementById('hex-form')!.onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    const fd = new FormData(f);
    const outputItemId = String(fd.get('outputItemId') ?? '').trim();
    const body: HexRecipe = {
      id: String(fd.get('id')),
      name: String(fd.get('name')),
      category: String(fd.get('category')),
      description: String(fd.get('description')),
      declarationTemplates: String(fd.get('declarations')).split('\n').map((s) => s.trim()).filter(Boolean),
      difficulty: Number(fd.get('difficulty')),
      meCost: Number(fd.get('meCost')),
      powerTier: Number(fd.get('powerTier')),
      preparedUses: Number(fd.get('preparedUses')),
      activationMethod: String(fd.get('activationMethod')),
      durationLabel: String(fd.get('durationLabel') || '') || undefined,
      effect: String(fd.get('effect')),
      spellId: String(fd.get('spellId') || '') || undefined,
      enchantIntent: String(fd.get('enchantIntent') || '') || undefined,
      visualTheme: String(fd.get('visualTheme')),
      stationType: 'enchanting_table',
      sockets: JSON.parse(String(fd.get('socketsJson'))) as HexRecipe['sockets'],
      augmentations: JSON.parse(String(fd.get('augsJson'))) as HexRecipe['augmentations'],
      output: outputItemId ? { itemId: outputItemId, quantity: Number(fd.get('outputQty')) || 1 } : undefined,
    };
    if (creating) await api('/content/hexagram-recipes', { method: 'POST', body: JSON.stringify(body) });
    else await api(`/content/hexagram-recipes/${body.id}`, { method: 'PUT', body: JSON.stringify(body) });
    onBack();
  };
}

function field(label: string, input: string): string {
  return `<label style="display:block;margin:8px 0 4px">${esc(label)}</label>${input}`;
}
