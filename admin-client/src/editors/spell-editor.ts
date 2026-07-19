import { api } from '../api.js';
import {
  esc, field, textInput, numberInput, textarea, selectInput, checkboxGroup,
  readCheckboxGroup, MAGIC_TRADITIONS, SPELL_CATEGORIES, SPELL_TARGETS, TAGLOCK_TYPES,
} from '../helpers/form-html.js';
import {
  SPELL_EFFECT_KEYS, slugifyId, parseEffectValue, effectValueToString,
} from '../helpers/spell-content.js';

type SpellRecord = Record<string, unknown>;
type IngredientRow = { itemId: string; quantity: number };
type EffectRow = { key: string; value: string; valueType: 'number' | 'boolean' | 'string' };
type ToolRow = { itemId: string };

function isNewId(id: string | null): boolean {
  return !id || id === '__new__';
}

export async function renderSpellList(el: HTMLElement, onEdit: (id: string | '__new__') => void): Promise<void> {
  const spells = await api<unknown[]>('/content/spells');
  el.innerHTML = `<div class="card"><h2>Spells (${(spells as unknown[]).length})</h2>
    <button class="btn" id="new-spell">+ New Spell</button>
    <table class="mt"><thead><tr><th>ID</th><th>Name</th><th>Tradition</th><th>ME</th><th>Diff</th><th></th></tr></thead>
    <tbody>${(spells as { id: string; name: string; tradition: string; difficulty: number; maintenanceCost: number }[]).map((s) =>
      `<tr><td><a href="#" class="spell-link" data-id="${esc(s.id)}" style="color:#fc8">${esc(s.id)}</a></td><td>${esc(s.name)}</td><td>${esc(s.tradition)}</td><td>${s.maintenanceCost}</td><td>${s.difficulty}</td>
      <td><button class="btn danger secondary" data-del="${esc(s.id)}">Delete</button></td></tr>`
    ).join('')}</tbody></table>
    <button class="btn mt secondary" id="reload">Reload Content from Disk</button></div>`;
  document.getElementById('new-spell')!.onclick = () => onEdit('__new__');
  document.getElementById('reload')!.onclick = async () => {
    await api('/content/reload', { method: 'POST', body: '{}' });
    alert('Reloaded');
  };
  document.querySelectorAll('.spell-link').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      onEdit((a as HTMLElement).dataset.id!);
    });
  });
  document.querySelectorAll('[data-del]').forEach((b) => {
    b.addEventListener('click', async () => {
      const id = (b as HTMLElement).dataset.del!;
      if (!confirm(`Delete spell ${id}?`)) return;
      await api(`/content/spells/${id}`, { method: 'DELETE' });
      void renderSpellList(el, onEdit);
    });
  });
}

export async function renderSpellEditor(
  el: HTMLElement,
  id: string | null,
  onBack: () => void
): Promise<void> {
  const creating = isNewId(id);
  const items = await api<{ id: string; name: string; category: string }[]>('/content/items').catch(() => []);
  const spell = (!creating ? await api<SpellRecord>(`/content/spells/${id}`) : {
    id: '', name: '', tradition: 'traditional_european', category: 'protection', targetType: 'self',
    ingredients: [], requiredTools: [], difficulty: 10, basePotency: 10, maintenanceCost: 2,
    moralEffect: 0, castingTime: 30, duration: 3600, counterspellTags: [], gameplayEffect: {}, description: '',
  }) as SpellRecord;

  const itemOpts = items.map((i) => ({ value: i.id, label: `${i.name} (${i.id})` }));
  const toolOpts = items.filter((i) => i.category === 'tools').map((i) => ({ value: i.id, label: i.name }));
  const effectKeyOpts = [
    { value: '', label: 'Select effect…' },
    ...SPELL_EFFECT_KEYS.map((k) => ({ value: k.value, label: k.label })),
    { value: '__custom__', label: 'Custom key…' },
  ];

  let ingredients: IngredientRow[] = [...((spell.ingredients as IngredientRow[]) ?? [])];
  let tools: ToolRow[] = ((spell.requiredTools as string[]) ?? []).map((itemId) => ({ itemId }));
  let effects: EffectRow[] = Object.entries((spell.gameplayEffect as Record<string, unknown>) ?? {}).map(
    ([key, value]) => {
      const meta = SPELL_EFFECT_KEYS.find((k) => k.value === key);
      return {
        key,
        value: effectValueToString(value),
        valueType: meta?.valueType ?? (typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string'),
      };
    }
  );
  if (!effects.length) effects = [{ key: 'protectionBonus', value: '10', valueType: 'number' }];

  el.innerHTML = `
    <button class="btn secondary" id="back-spell">← Back to list</button>
    <div class="editor-split mt">
      <div class="editor-form card">
        <h2>${creating ? 'New Spell' : 'Edit Spell'}</h2>
        <h3 class="section-head">Identity</h3>
        <div class="form-grid">
          ${field('Spell ID', textInput('sp-id', String(spell.id ?? ''), 'snake_case id'))}
          ${field('Display Name', textInput('sp-name', String(spell.name ?? '')))}
          ${field('Tradition', selectInput('sp-tradition', [...MAGIC_TRADITIONS], String(spell.tradition ?? 'traditional_european')))}
          ${field('Category', selectInput('sp-category', SPELL_CATEGORIES.map((c) => ({ value: c, label: c.replace(/_/g, ' ') })), String(spell.category ?? 'protection')))}
          ${field('Target', selectInput('sp-target', SPELL_TARGETS.map((t) => ({ value: t, label: t.replace(/_/g, ' ') })), String(spell.targetType ?? 'self')))}
        </div>
        ${field('Description', textarea('sp-desc', String(spell.description ?? ''), 3))}

        <h3 class="section-head mt">Casting</h3>
        <div class="form-grid">
          ${field('Difficulty', numberInput('sp-difficulty', Number(spell.difficulty ?? 10)))}
          ${field('Base Potency', numberInput('sp-potency', Number(spell.basePotency ?? 10)))}
          ${field('ME Cost', numberInput('sp-me', Number(spell.maintenanceCost ?? 2)))}
          ${field('Moral Effect', numberInput('sp-moral', Number(spell.moralEffect ?? 0)))}
          ${field('Cast Time (s)', numberInput('sp-cast', Number(spell.castingTime ?? 30)))}
          ${field('Duration (s)', numberInput('sp-duration', Number(spell.duration ?? 3600)))}
        </div>

        <h3 class="section-head mt">Ingredients</h3>
        <div id="sp-ing-list"></div>
        <button type="button" class="btn secondary mt" id="sp-add-ing">+ Add Ingredient</button>

        <h3 class="section-head mt">Required Tools</h3>
        <div id="sp-tool-list"></div>
        <button type="button" class="btn secondary mt" id="sp-add-tool">+ Add Tool</button>

        <h3 class="section-head mt">Gameplay Effects</h3>
        <div id="sp-fx-list"></div>
        <button type="button" class="btn secondary mt" id="sp-add-fx">+ Add Effect</button>

        <h3 class="section-head mt">Taglock Requirements</h3>
        ${checkboxGroup('sp-tag', TAGLOCK_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, ' ') })), (spell.taglockRequirement as string[]) ?? [])}

        <h3 class="section-head mt">Counterspell Tags</h3>
        ${checkboxGroup('sp-counter', SPELL_CATEGORIES.map((c) => ({ value: c, label: c })), (spell.counterspellTags as string[]) ?? [])}

        <div class="flex mt" style="gap:8px;flex-wrap:wrap;">
          <button class="btn" id="save-spell">Save Spell</button>
          <button class="btn secondary" id="preview-spell">Preview Cast</button>
        </div>
      </div>
      <div class="card editor-preview">
        <h2>Summary</h2>
        <div id="sp-preview" class="preview-box"></div>
      </div>
    </div>`;

  document.getElementById('back-spell')!.onclick = onBack;

  const renderIngredients = () => {
    const host = document.getElementById('sp-ing-list')!;
    if (!ingredients.length) {
      host.innerHTML = '<p class="muted-text">No ingredients yet.</p>';
    } else {
      host.innerHTML = ingredients.map((row, i) => `
        <div class="list-row flex">
          ${selectInput(`sp-ing-${i}`, [{ value: '', label: 'Select item…' }, ...itemOpts], row.itemId)}
          ${field('Qty', numberInput(`sp-ing-qty-${i}`, row.quantity, 1), 'inline-field')}
          <button type="button" class="btn danger secondary" data-rm-ing="${i}">×</button>
        </div>`).join('');
    }
    host.querySelectorAll('[data-rm-ing]').forEach((btn) => {
      btn.addEventListener('click', () => {
        ingredients.splice(Number((btn as HTMLElement).dataset.rmIng), 1);
        renderIngredients();
      });
    });
  };

  const renderTools = () => {
    const host = document.getElementById('sp-tool-list')!;
    if (!tools.length) {
      host.innerHTML = '<p class="muted-text">No tools required.</p>';
    } else {
      host.innerHTML = tools.map((row, i) => `
        <div class="list-row flex">
          ${selectInput(`sp-tool-${i}`, [{ value: '', label: 'Select tool…' }, ...toolOpts], row.itemId)}
          <button type="button" class="btn danger secondary" data-rm-tool="${i}">×</button>
        </div>`).join('');
    }
    host.querySelectorAll('[data-rm-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        tools.splice(Number((btn as HTMLElement).dataset.rmTool), 1);
        renderTools();
      });
    });
  };

  const renderEffects = () => {
    const host = document.getElementById('sp-fx-list')!;
    host.innerHTML = effects.map((row, i) => {
      const meta = SPELL_EFFECT_KEYS.find((k) => k.value === row.key);
      const valueField = row.valueType === 'boolean'
        ? selectInput(`sp-fx-val-${i}`, [{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }], row.value)
        : textInput(`sp-fx-val-${i}`, row.value);
      return `<div class="list-row flex" style="align-items:flex-end;">
        ${field('Effect', selectInput(`sp-fx-key-${i}`, effectKeyOpts, meta ? row.key : '__custom__'), 'inline-field')}
        ${row.key === '__custom__' || !meta ? field('Custom Key', textInput(`sp-fx-custom-${i}`, row.key), 'inline-field') : ''}
        ${field('Value', valueField, 'inline-field')}
        <button type="button" class="btn danger secondary" data-rm-fx="${i}">×</button>
      </div>`;
    }).join('');
    host.querySelectorAll('[data-rm-fx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        effects.splice(Number((btn as HTMLElement).dataset.rmFx), 1);
        renderEffects();
        refreshPreview();
      });
    });
    effects.forEach((_, i) => {
      document.getElementById(`sp-fx-key-${i}`)?.addEventListener('change', () => {
        const sel = (document.getElementById(`sp-fx-key-${i}`) as HTMLSelectElement).value;
        const meta = SPELL_EFFECT_KEYS.find((k) => k.value === sel);
        effects[i].key = sel === '__custom__' ? '' : sel;
        effects[i].valueType = meta?.valueType ?? 'string';
        if (meta?.valueType === 'boolean') effects[i].value = 'true';
        renderEffects();
      });
    });
  };

  function readIngredients(): IngredientRow[] {
    return ingredients.map((row, i) => ({
      itemId: (document.getElementById(`sp-ing-${i}`) as HTMLSelectElement | null)?.value || row.itemId,
      quantity: Number((document.getElementById(`sp-ing-qty-${i}`) as HTMLInputElement | null)?.value) || row.quantity,
    })).filter((r) => r.itemId);
  }

  function readTools(): string[] {
    return tools
      .map((row, i) => (document.getElementById(`sp-tool-${i}`) as HTMLSelectElement | null)?.value || row.itemId)
      .filter(Boolean);
  }

  function readEffects(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    effects.forEach((row, i) => {
      const sel = (document.getElementById(`sp-fx-key-${i}`) as HTMLSelectElement | null)?.value ?? row.key;
      const key = sel === '__custom__'
        ? ((document.getElementById(`sp-fx-custom-${i}`) as HTMLInputElement | null)?.value.trim() || row.key)
        : sel;
      if (!key) return;
      const meta = SPELL_EFFECT_KEYS.find((k) => k.value === key);
      const valRaw = (document.getElementById(`sp-fx-val-${i}`) as HTMLInputElement | HTMLSelectElement | null)?.value ?? row.value;
      out[key] = parseEffectValue(valRaw, meta?.valueType ?? row.valueType);
    });
    return out;
  }

  function collectSpell(): SpellRecord {
    const name = (document.getElementById('sp-name') as HTMLInputElement).value.trim();
    let spellId = (document.getElementById('sp-id') as HTMLInputElement).value.trim();
    if (creating && !spellId && name) spellId = slugifyId(name);
    return {
      id: spellId,
      name,
      tradition: (document.getElementById('sp-tradition') as HTMLSelectElement).value,
      category: (document.getElementById('sp-category') as HTMLSelectElement).value,
      targetType: (document.getElementById('sp-target') as HTMLSelectElement).value,
      difficulty: Number((document.getElementById('sp-difficulty') as HTMLInputElement).value),
      basePotency: Number((document.getElementById('sp-potency') as HTMLInputElement).value),
      maintenanceCost: Number((document.getElementById('sp-me') as HTMLInputElement).value),
      moralEffect: Number((document.getElementById('sp-moral') as HTMLInputElement).value),
      castingTime: Number((document.getElementById('sp-cast') as HTMLInputElement).value),
      duration: Number((document.getElementById('sp-duration') as HTMLInputElement).value),
      description: (document.getElementById('sp-desc') as HTMLTextAreaElement).value,
      ingredients: readIngredients(),
      requiredTools: readTools(),
      taglockRequirement: readCheckboxGroup('sp-tag', TAGLOCK_TYPES.map((t) => ({ value: t }))),
      counterspellTags: readCheckboxGroup('sp-counter', SPELL_CATEGORIES.map((c) => ({ value: c }))),
      gameplayEffect: readEffects(),
    };
  }

  function refreshPreview(): void {
    const data = collectSpell();
    const ingLines = (data.ingredients as IngredientRow[]).map((r) => {
      const label = items.find((i) => i.id === r.itemId)?.name ?? r.itemId;
      return `${label} ×${r.quantity}`;
    });
    const fxLines = Object.entries(data.gameplayEffect as Record<string, unknown>).map(([k, v]) => `${k}: ${v}`);
    (document.getElementById('sp-preview')!).innerHTML = `
      <p><strong>${esc(data.name || '(unnamed)')}</strong> <span class="badge">${esc(data.id || 'no-id')}</span></p>
      <p class="muted-text">${esc(data.tradition)} · ${esc(data.category)} · targets ${esc(data.targetType)}</p>
      <p class="muted-text">ME ${data.maintenanceCost} · diff ${data.difficulty} · ${data.castingTime}s cast · ${data.duration}s duration</p>
      <h4>Ingredients</h4><ul>${ingLines.map((l) => `<li>${esc(l)}</li>`).join('') || '<li class="muted-text">None</li>'}</ul>
      <h4>Effects</h4><ul>${fxLines.map((l) => `<li>${esc(l)}</li>`).join('') || '<li class="muted-text">None</li>'}</ul>`;
  }

  document.getElementById('sp-add-ing')!.onclick = () => {
    ingredients.push({ itemId: itemOpts[0]?.value ?? '', quantity: 1 });
    renderIngredients();
  };
  document.getElementById('sp-add-tool')!.onclick = () => {
    tools.push({ itemId: toolOpts[0]?.value ?? '' });
    renderTools();
  };
  document.getElementById('sp-add-fx')!.onclick = () => {
    effects.push({ key: 'protectionBonus', value: '10', valueType: 'number' });
    renderEffects();
  };

  document.getElementById('sp-name')!.addEventListener('input', () => {
    if (creating) {
      const name = (document.getElementById('sp-name') as HTMLInputElement).value;
      const idEl = document.getElementById('sp-id') as HTMLInputElement;
      if (!idEl.dataset.manual) idEl.value = slugifyId(name);
    }
  });
  document.getElementById('sp-id')!.addEventListener('input', () => {
    (document.getElementById('sp-id') as HTMLInputElement).dataset.manual = '1';
  });

  document.getElementById('preview-spell')!.onclick = async () => {
    try {
      const payload = collectSpell();
      if (!payload.id) { alert('Spell ID required'); return; }
      const result = await api<unknown>('/content/spells/preview', {
        method: 'POST',
        body: JSON.stringify({ ...payload, id: payload.id }),
      });
      alert(JSON.stringify(result, null, 2));
    } catch (e) {
      alert(String(e));
    }
  };

  document.getElementById('save-spell')!.onclick = async () => {
    try {
      const data = collectSpell();
      if (!data.id) { alert('Spell ID required — enter an id or name to auto-generate one'); return; }
      if (!data.name) { alert('Spell name required'); return; }
      if (creating) {
        await api('/content/spells', { method: 'POST', body: JSON.stringify(data) });
      } else {
        await api(`/content/spells/${id}`, { method: 'PUT', body: JSON.stringify(data) });
      }
      alert('Saved');
      onBack();
    } catch (e) {
      alert(String(e));
    }
  };

  renderIngredients();
  renderTools();
  renderEffects();
  refreshPreview();

  el.addEventListener('input', (e) => {
    if ((e.target as HTMLElement).closest('.editor-form')) refreshPreview();
  });
  el.addEventListener('change', (e) => {
    if ((e.target as HTMLElement).closest('.editor-form')) refreshPreview();
  });
}
