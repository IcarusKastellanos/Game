import { api } from '../api.js';
import {
  esc, field, textInput, numberInput, textarea, selectInput, checkboxGroup,
  readCheckboxGroup, MAGIC_TRADITIONS, ITEM_CATEGORIES, ITEM_RARITIES, SPELL_CATEGORIES,
} from '../helpers/form-html.js';
import { slugifyId } from '../helpers/spell-content.js';
import { categoryFillColor, mountPixelIconEditor, pixelsToDataUrl } from '../components/pixel-icon-editor.js';
import { mountImageDropImport, spriteArtDivider } from '../components/image-import.js';
import { generateItemIconPixels, resolveItemIconPixels } from '@witchcraft/shared';

type ItemRecord = Record<string, unknown>;

function isNewId(id: string | null): boolean {
  return !id || id === '__new__';
}

function resolveEditorPixels(item: ItemRecord): string[] {
  const id = String(item.id ?? '');
  const category = String(item.category ?? 'herbs');
  const name = String(item.name ?? '');
  if (id) {
    return resolveItemIconPixels({
      id,
      category,
      name,
      iconPixels: item.iconPixels as string[] | undefined,
    });
  }
  return generateItemIconPixels('new_item', category, name || 'new');
}

export async function renderItemList(el: HTMLElement, onEdit: (id: string | '__new__') => void): Promise<void> {
  const items = await api<unknown[]>('/content/items');
  el.innerHTML = `<div class="card"><h2>Items (${(items as unknown[]).length})</h2>
    <button class="btn" id="new-item">+ New Item</button>
    <table class="mt"><thead><tr><th>ID</th><th>Name</th><th>Category</th><th>Rarity</th><th>Potency</th><th></th></tr></thead>
    <tbody>${(items as { id: string; name: string; category: string; rarity: string; basePotency: number }[]).map((i) =>
      `<tr><td><a href="#" class="item-link" data-id="${esc(i.id)}" style="color:#fc8">${esc(i.id)}</a></td><td>${esc(i.name)}</td><td>${esc(i.category)}</td><td>${esc(i.rarity)}</td><td>${i.basePotency}</td>
      <td><button class="btn danger secondary" data-del="${esc(i.id)}">Delete</button></td></tr>`
    ).join('')}</tbody></table>`;
  document.getElementById('new-item')!.onclick = () => onEdit('__new__');
  document.querySelectorAll('.item-link').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      onEdit((a as HTMLElement).dataset.id!);
    });
  });
  document.querySelectorAll('[data-del]').forEach((b) => {
    b.addEventListener('click', async () => {
      const itemId = (b as HTMLElement).dataset.del!;
      if (!confirm(`Delete item ${itemId}?`)) return;
      await api(`/content/items/${itemId}`, { method: 'DELETE' });
      void renderItemList(el, onEdit);
    });
  });
}

export async function renderItemEditor(
  el: HTMLElement,
  id: string | null,
  onBack: () => void
): Promise<void> {
  const creating = isNewId(id);
  const item = (!creating ? await api<ItemRecord>(`/content/items/${id}`) : {
    id: '', name: '', category: 'herbs', correspondences: [], description: '',
    rarity: 'common', basePotency: 0, traditions: ['traditional_european'],
  }) as ItemRecord;

  el.innerHTML = `
    <button class="btn secondary" id="back-item">← Back to list</button>
    <div class="editor-split mt">
      <div class="editor-form card">
        <h2>${creating ? 'New Item' : 'Edit Item'}</h2>
        <h3 class="section-head">Identity</h3>
        <div class="form-grid">
          ${field('Item ID', textInput('it-id', String(item.id ?? ''), 'snake_case id'))}
          ${field('Display Name', textInput('it-name', String(item.name ?? '')))}
          ${field('Category', selectInput('it-category', ITEM_CATEGORIES.map((c) => ({ value: c, label: c.replace(/_/g, ' ') })), String(item.category ?? 'herbs')))}
          ${field('Rarity', selectInput('it-rarity', ITEM_RARITIES.map((r) => ({ value: r, label: r })), String(item.rarity ?? 'common')))}
          ${field('Base Potency', numberInput('it-potency', Number(item.basePotency ?? 0)))}
        </div>
        ${field('Description', textarea('it-desc', String(item.description ?? ''), 4))}

        <h3 class="section-head mt">Magical Properties</h3>
        <p class="muted-text">Correspondences link this item to spell categories and ritual work.</p>
        ${checkboxGroup('it-corr', SPELL_CATEGORIES.map((c) => ({ value: c, label: c.replace(/_/g, ' ') })), (item.correspondences as string[]) ?? [])}

        <h3 class="section-head mt">Traditions</h3>
        ${checkboxGroup('it-trad', [...MAGIC_TRADITIONS], (item.traditions as string[]) ?? ['traditional_european'])}

        <div class="flex mt" style="gap:8px;">
          <button class="btn" id="save-item">Save Item</button>
        </div>
      </div>
      <div class="card editor-preview">
        <h2>16-bit Icon</h2>
        <p class="muted-text">Drop an image to import, or paint pixels in the editor below.</p>
        <div id="it-icon-drop"></div>
        ${spriteArtDivider('or paint pixels')}
        <div id="it-icon-editor"></div>
        <img id="it-icon-preview" class="icon-preview-img mt" alt="icon preview" />
        <h2 class="mt">Summary</h2>
        <div id="it-preview" class="preview-box"></div>
      </div>
    </div>`;

  document.getElementById('back-item')!.onclick = onBack;

  let iconPixels = resolveEditorPixels(item);
  const iconEditor = mountPixelIconEditor(
    document.getElementById('it-icon-editor')!,
    iconPixels,
    (px) => {
      iconPixels = px;
      updateIconPreview();
      refreshPreview();
    }
  );

  mountImageDropImport(document.getElementById('it-icon-drop')!, {
    idPrefix: 'it-icon',
    widthPx: () => 16,
    heightPx: () => 16,
    onImport: (px) => {
      iconEditor.setPixels(px);
      updateIconPreview();
      refreshPreview();
    },
    onError: (msg) => alert(msg),
  });

  document.getElementById('it-category')!.addEventListener('change', () => {
    /* preview only */
  });

  document.getElementById('it-icon-editor')!.addEventListener('pixel-fill-category', () => {
    const cat = (document.getElementById('it-category') as HTMLSelectElement).value;
    const color = categoryFillColor(cat);
    iconEditor.setPixels(Array(256).fill(color));
    updateIconPreview();
    refreshPreview();
  });

  function updateIconPreview(): void {
    const img = document.getElementById('it-icon-preview') as HTMLImageElement;
    img.src = pixelsToDataUrl(iconEditor.getPixels());
    img.width = 64;
    img.height = 64;
  }

  function collectItem(): ItemRecord {
    const name = (document.getElementById('it-name') as HTMLInputElement).value.trim();
    let itemId = (document.getElementById('it-id') as HTMLInputElement).value.trim();
    if (creating && !itemId && name) itemId = slugifyId(name);
    return {
      id: itemId,
      name,
      category: (document.getElementById('it-category') as HTMLSelectElement).value,
      rarity: (document.getElementById('it-rarity') as HTMLSelectElement).value,
      basePotency: Number((document.getElementById('it-potency') as HTMLInputElement).value),
      description: (document.getElementById('it-desc') as HTMLTextAreaElement).value,
      correspondences: readCheckboxGroup('it-corr', SPELL_CATEGORIES.map((c) => ({ value: c }))),
      traditions: readCheckboxGroup('it-trad', MAGIC_TRADITIONS.map((t) => ({ value: t.value }))),
      iconPixels: iconEditor.getPixels(),
    };
  }

  function refreshPreview(): void {
    const data = collectItem();
    const corrs = (data.correspondences as string[]) ?? [];
    const trads = (data.traditions as string[]) ?? [];
    (document.getElementById('it-preview')!).innerHTML = `
      <img src="${pixelsToDataUrl(data.iconPixels as string[])}" width="48" height="48" style="image-rendering:pixelated;border:1px solid #3d3654;" />
      <p><strong>${esc(data.name || '(unnamed)')}</strong> <span class="badge">${esc(data.id || 'no-id')}</span></p>
      <p class="muted-text">${esc(data.category)} · ${esc(data.rarity)} · potency ${data.basePotency}</p>
      <p>${esc(data.description || 'No description.')}</p>
      <h4>Correspondences</h4>
      <div class="checkbox-group">${corrs.map((c) => `<span class="checkbox-chip">${esc(c)}</span>`).join('') || '<span class="muted-text">None</span>'}</div>
      <h4 class="mt">Traditions</h4>
      <div class="checkbox-group">${trads.map((t) => `<span class="checkbox-chip">${esc(t.replace(/_/g, ' '))}</span>`).join('') || '<span class="muted-text">None</span>'}</div>`;
  }

  ['it-id', 'it-name', 'it-category', 'it-rarity', 'it-potency', 'it-desc'].forEach((fid) => {
    document.getElementById(fid)?.addEventListener('input', refreshPreview);
    document.getElementById(fid)?.addEventListener('change', refreshPreview);
  });
  document.querySelectorAll('[id^="it-corr-"], [id^="it-trad-"]').forEach((el) => {
    el.addEventListener('change', refreshPreview);
  });

  document.getElementById('it-name')!.addEventListener('input', () => {
    if (creating) {
      const name = (document.getElementById('it-name') as HTMLInputElement).value;
      const idEl = document.getElementById('it-id') as HTMLInputElement;
      if (!idEl.dataset.manual) idEl.value = slugifyId(name);
      iconEditor.setPixels(generateItemIconPixels(slugifyId(name) || 'new_item', (document.getElementById('it-category') as HTMLSelectElement).value, name));
      updateIconPreview();
      refreshPreview();
    }
  });
  document.getElementById('it-id')!.addEventListener('input', () => {
    (document.getElementById('it-id') as HTMLInputElement).dataset.manual = '1';
  });

  document.getElementById('save-item')!.onclick = async () => {
    try {
      const data = collectItem();
      if (!data.id) { alert('Item ID required — enter an id or name to auto-generate one'); return; }
      if (!data.name) { alert('Item name required'); return; }
      if (creating) {
        await api('/content/items', { method: 'POST', body: JSON.stringify(data) });
      } else {
        await api(`/content/items/${id}`, { method: 'PUT', body: JSON.stringify(data) });
      }
      alert('Saved');
      onBack();
    } catch (e) {
      alert(String(e));
    }
  };

  refreshPreview();
  updateIconPreview();
}
