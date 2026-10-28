import { MAP_TYPE_OPTIONS } from '@witchcraft/shared';
import { mapBuilderApi } from './api.js';
import { showToast } from './toast.js';
import type { MapProjectMetadata } from '@witchcraft/shared';

export async function renderMapManager(
  el: HTMLElement,
  perms: Set<string>,
  onOpenEditor: (id: string) => void
): Promise<void> {
  let showArchived = false;
  const canEdit = perms.has('content.map.edit');
  const canPublish = perms.has('content.map.publish');

  const render = async () => {
    const maps = await mapBuilderApi.listMaps(showArchived);
    el.innerHTML = `
      <div class="mb-toolbar">
        <div class="flex">
          ${canEdit ? '<button class="btn" id="mb-new-map">+ New Map</button>' : ''}
          ${canPublish ? '<button class="btn secondary" id="mb-push-live" title="Reload published maps on the server and force all online players to refresh">Push maps to all players</button>' : ''}
          <label class="checkbox-chip"><input type="checkbox" id="mb-show-archived" ${showArchived ? 'checked' : ''} /> Show archived</label>
        </div>
        <input id="mb-map-search" placeholder="Search maps..." class="mb-search" />
      </div>
      ${canPublish ? '<p class="muted-text mb-push-hint">Save draft → <strong>Publish</strong> in the editor → then <strong>Push maps to all players</strong>. Draft-only changes are not visible in-game.</p>' : ''}
      <table class="mt mb-table">
        <thead><tr>
          <th>Name</th><th>Type</th><th>Scene</th><th>Size</th><th>Status</th><th>Version</th><th></th>
        </tr></thead>
        <tbody id="mb-map-rows">${mapRows(maps)}</tbody>
      </table>`;

    document.getElementById('mb-show-archived')!.onchange = (e) => {
      showArchived = (e.target as HTMLInputElement).checked;
      void render();
    };
    document.getElementById('mb-map-search')!.oninput = (e) => filterRows((e.target as HTMLInputElement).value);

    if (canEdit) {
      document.getElementById('mb-new-map')!.onclick = () => void createMapDialog(onOpenEditor);
    }
    if (canPublish) {
      document.getElementById('mb-push-live')!.onclick = () => void pushLiveMapsToPlayers();
    }
    bindRowActions(el, perms, onOpenEditor, render);
  };

  await render();
}

async function pushLiveMapsToPlayers(): Promise<void> {
  if (!confirm('Push all published maps to the live server and force every online player to reload them? Players will snap to their spawn point on the current scene.')) {
    return;
  }
  try {
    const result = await mapBuilderApi.pushLive({ resnapSpawns: true });
    if (result.warnings?.length) {
      showToast(`${result.warnings.join(' ')}`, 'info');
    }
    showToast(
      `Pushed map revision ${result.revision} to ${result.clientsNotified} online client(s) (${result.merged} published map(s) merged).`,
      'success'
    );
  } catch (e) {
    showToast(String(e), 'error');
  }
}

function mapRows(maps: MapProjectMetadata[]): string {
  return maps.map((m) => `
    <tr data-name="${m.displayName.toLowerCase()} ${m.internalName.toLowerCase()}">
      <td><strong>${esc(m.displayName)}</strong><div class="muted-text">${esc(m.internalName)} · ${esc(m.id)}</div></td>
      <td><span class="badge">${esc(m.mapType)}</span></td>
      <td>${esc(m.sceneId)}</td>
      <td>${m.width}×${m.height}</td>
      <td><span class="badge status-${m.status}">${m.status}</span></td>
      <td>v${m.version}</td>
      <td class="mb-actions">${actionButtons(m)}</td>
    </tr>`).join('');
}

function actionButtons(m: MapProjectMetadata): string {
  return `
    <button class="btn secondary mb-open" data-id="${m.id}">Edit</button>
    <button class="btn secondary mb-dup" data-id="${m.id}">Duplicate</button>
    ${m.status === 'archived'
      ? `<button class="btn secondary mb-restore" data-id="${m.id}">Restore</button>`
      : `<button class="btn secondary mb-archive" data-id="${m.id}">Archive</button>`}
    ${m.status === 'draft' ? `<button class="btn danger mb-delete" data-id="${m.id}">Delete</button>` : ''}`;
}

function bindRowActions(
  el: HTMLElement,
  perms: Set<string>,
  onOpenEditor: (id: string) => void,
  refresh: () => Promise<void>
): void {
  const canEdit = perms.has('content.map.edit');
  const canPublish = perms.has('content.map.publish');

  el.querySelectorAll('.mb-open').forEach((b) => {
    b.addEventListener('click', () => onOpenEditor(String((b as HTMLElement).dataset.id)));
  });

  if (!canEdit) return;

  el.querySelectorAll('.mb-dup').forEach((b) => {
    b.addEventListener('click', async () => {
      const id = String((b as HTMLElement).dataset.id);
      try {
        const dup = await mapBuilderApi.duplicate(id);
        showToast(`Duplicated as ${dup.metadata.displayName}`, 'success');
        await refresh();
      } catch (e) {
        showToast(String(e), 'error');
      }
    });
  });

  el.querySelectorAll('.mb-archive').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('Archive this map? It will be removed from the live game.')) return;
      try {
        await mapBuilderApi.archive(String((b as HTMLElement).dataset.id));
        showToast('Map archived', 'success');
        await refresh();
      } catch (e) {
        showToast(String(e), 'error');
      }
    });
  });

  el.querySelectorAll('.mb-restore').forEach((b) => {
    b.addEventListener('click', async () => {
      try {
        await mapBuilderApi.restore(String((b as HTMLElement).dataset.id));
        showToast('Map restored to draft', 'success');
        await refresh();
      } catch (e) {
        showToast(String(e), 'error');
      }
    });
  });

  el.querySelectorAll('.mb-delete').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('Permanently delete this draft map?')) return;
      try {
        await mapBuilderApi.deleteDraft(String((b as HTMLElement).dataset.id));
        showToast('Draft deleted', 'success');
        await refresh();
      } catch (e) {
        showToast(String(e), 'error');
      }
    });
  });

  if (canPublish) {
    // publish/unpublish handled in editor; manager stays lean
  }
}

function filterRows(q: string): void {
  const needle = q.trim().toLowerCase();
  document.querySelectorAll('#mb-map-rows tr').forEach((tr) => {
    const name = (tr as HTMLElement).dataset.name ?? '';
    (tr as HTMLElement).style.display = !needle || name.includes(needle) ? '' : 'none';
  });
}

async function createMapDialog(onOpen: (id: string) => void): Promise<void> {
  const overlay = document.createElement('div');
  overlay.className = 'mb-modal-overlay';
  overlay.innerHTML = `
    <div class="mb-modal card">
      <h2>Create Map</h2>
      <label class="form-field"><span class="form-label">Display name</span><input id="cm-name" value="New Map" /></label>
      <label class="form-field"><span class="form-label">Internal name</span><input id="cm-internal" value="new_map" /></label>
      <label class="form-field"><span class="form-label">Scene ID</span><input id="cm-scene" value="town" /></label>
      <label class="form-field"><span class="form-label">Map type</span>
        <select id="cm-type">${MAP_TYPE_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join('')}</select>
      </label>
      <div class="form-grid">
        <label class="form-field"><span class="form-label">Width</span><input id="cm-w" type="number" value="16" min="4" /></label>
        <label class="form-field"><span class="form-label">Height</span><input id="cm-h" type="number" value="24" min="4" /></label>
        <label class="form-field"><span class="form-label">Tile size</span><input id="cm-ts" type="number" value="32" min="8" /></label>
      </div>
      <div class="flex mt">
        <button class="btn" id="cm-create">Create</button>
        <button class="btn secondary" id="cm-cancel">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#cm-cancel')!.addEventListener('click', () => overlay.remove());
  overlay.querySelector('#cm-create')!.addEventListener('click', async () => {
    try {
      const created = await mapBuilderApi.createMap({
        displayName: (document.getElementById('cm-name') as HTMLInputElement).value,
        internalName: (document.getElementById('cm-internal') as HTMLInputElement).value,
        sceneId: (document.getElementById('cm-scene') as HTMLInputElement).value,
        mapType: (document.getElementById('cm-type') as HTMLSelectElement).value as MapProjectMetadata['mapType'],
        width: Number((document.getElementById('cm-w') as HTMLInputElement).value),
        height: Number((document.getElementById('cm-h') as HTMLInputElement).value),
        tileSize: Number((document.getElementById('cm-ts') as HTMLInputElement).value),
      });
      overlay.remove();
      showToast('Map created', 'success');
      onOpen(created.metadata.id);
    } catch (e) {
      showToast(String(e), 'error');
    }
  });
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}
