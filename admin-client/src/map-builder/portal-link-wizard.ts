import type { MapBuilderDocument, MapPortal, MapProjectMetadata } from '@witchcraft/shared';
import { mapBuilderApi } from './api.js';
import { showToast } from './toast.js';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

export function findMapBySceneOrId(maps: MapProjectMetadata[], sceneOrId: string): MapProjectMetadata | undefined {
  return maps.find((m) => m.sceneId === sceneOrId || m.id === sceneOrId);
}

export async function removeTwoWayLink(
  portal: MapPortal,
  allMaps: MapProjectMetadata[]
): Promise<void> {
  if (!portal.linkedPortalId) {
    portal.twoWay = false;
    return;
  }

  const targetMeta = findMapBySceneOrId(allMaps, portal.targetMapId);
  if (!targetMeta) {
    portal.twoWay = false;
    portal.linkedPortalId = undefined;
    return;
  }

  try {
    const pack = await mapBuilderApi.getMap(targetMeta.id);
    const linkedId = portal.linkedPortalId;
    const before = pack.document.portals.length;
    pack.document.portals = pack.document.portals.filter((p) => p.id !== linkedId);
    if (pack.document.portals.length !== before) {
      await mapBuilderApi.saveDraft(
        targetMeta.id,
        pack.metadata,
        pack.document,
        `Removed return portal for ${portal.name}`
      );
    }
  } catch (e) {
    showToast(`Could not update target map: ${e}`, 'error');
    throw e;
  }

  portal.twoWay = false;
  portal.linkedPortalId = undefined;
}

export async function applyTwoWayPortalLink(opts: {
  portal: MapPortal;
  currentMapMeta: MapProjectMetadata;
  currentDoc: MapBuilderDocument;
  allMaps: MapProjectMetadata[];
  targetMapId: string;
  targetSpawnId: string;
  returnSpawnId: string;
  returnPortalX: number;
  returnPortalY: number;
}): Promise<void> {
  const {
    portal,
    currentMapMeta,
    allMaps,
    targetMapId,
    targetSpawnId,
    returnSpawnId,
    returnPortalX,
    returnPortalY,
  } = opts;

  const targetMeta = findMapBySceneOrId(allMaps, targetMapId);
  if (!targetMeta) {
    throw new Error('Target map not found');
  }

  portal.targetMapId = targetMeta.sceneId;
  portal.targetSpawnId = targetSpawnId;
  portal.twoWay = true;

  const returnPortalId = portal.linkedPortalId ?? `portal_return_${portal.id}`;
  portal.linkedPortalId = returnPortalId;

  const targetPack = await mapBuilderApi.getMap(targetMeta.id);
  let returnPortal = targetPack.document.portals.find((p) => p.id === returnPortalId);

  if (!returnPortal) {
    returnPortal = {
      id: returnPortalId,
      name: `${portal.name} (return)`,
      sourceX: returnPortalX,
      sourceY: returnPortalY,
      targetMapId: currentMapMeta.sceneId,
      targetSpawnId: returnSpawnId,
      direction: oppositeDirection(portal.direction),
      twoWay: true,
      visible: portal.visible,
      linkedPortalId: portal.id,
    };
    targetPack.document.portals.push(returnPortal);
  } else {
    returnPortal.name = `${portal.name} (return)`;
    returnPortal.sourceX = returnPortalX;
    returnPortal.sourceY = returnPortalY;
    returnPortal.targetMapId = currentMapMeta.sceneId;
    returnPortal.targetSpawnId = returnSpawnId;
    returnPortal.direction = oppositeDirection(portal.direction);
    returnPortal.twoWay = true;
    returnPortal.visible = portal.visible;
    returnPortal.linkedPortalId = portal.id;
  }

  await mapBuilderApi.saveDraft(
    targetMeta.id,
    targetPack.metadata,
    targetPack.document,
    `Two-way return portal for ${portal.name}`
  );
}

function oppositeDirection(d: MapPortal['direction']): MapPortal['direction'] {
  return ({ up: 'down', down: 'up', left: 'right', right: 'left' } as const)[d];
}

export function showPortalLinkWizard(opts: {
  portal: MapPortal;
  currentMapMeta: MapProjectMetadata;
  currentDoc: MapBuilderDocument;
  allMaps: MapProjectMetadata[];
  onApplied: () => void;
}): void {
  const { portal, currentMapMeta, currentDoc, allMaps, onApplied } = opts;
  const otherMaps = allMaps.filter((m) => m.id !== currentMapMeta.id && m.status !== 'archived');

  const overlay = document.createElement('div');
  overlay.className = 'mb-modal-overlay';
  overlay.innerHTML = `
    <div class="mb-modal card">
      <h2>Portal link wizard</h2>
      <p class="muted-text">Connect this portal to another map and optionally create a matching return portal.</p>
      <label class="form-field"><span class="form-label">Target map</span>
        <select id="pl-target-map">
          <option value="">Select map…</option>
          ${otherMaps.map((m) =>
            `<option value="${esc(m.id)}" ${m.sceneId === portal.targetMapId || m.id === portal.targetMapId ? 'selected' : ''}>${esc(m.displayName)} (${esc(m.sceneId)})</option>`
          ).join('')}
        </select>
      </label>
      <label class="form-field"><span class="form-label">Arrive at spawn (target map)</span>
        <select id="pl-target-spawn"><option value="">Load a map first…</option></select>
      </label>
      <label class="form-field"><span class="form-label">Return spawn (this map)</span>
        <select id="pl-return-spawn">
          ${currentDoc.spawnpoints.filter((s) => s.enabled).map((s) =>
            `<option value="${esc(s.id)}" ${s.id === 'default' || s.type === 'default_player' ? 'selected' : ''}>${esc(s.name)} (${s.x},${s.y})</option>`
          ).join('')}
        </select>
      </label>
      <div class="form-grid">
        <label class="form-field"><span class="form-label">Return portal X</span><input type="number" id="pl-ret-x" min="0" value="${portal.sourceX}" /></label>
        <label class="form-field"><span class="form-label">Return portal Y</span><input type="number" id="pl-ret-y" min="0" value="${portal.sourceY}" /></label>
      </div>
      <p class="muted-text">Return portal tile is on the <strong>target</strong> map where players walk back through.</p>
      <label class="checkbox-chip mt"><input type="checkbox" id="pl-two-way" ${portal.twoWay ? 'checked' : ''} /> Create / update two-way return portal</label>
      <div class="flex mt">
        <button class="btn" id="pl-apply">Apply link</button>
        <button class="btn secondary" id="pl-cancel">Cancel</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const targetMapSel = overlay.querySelector('#pl-target-map') as HTMLSelectElement;
  const targetSpawnSel = overlay.querySelector('#pl-target-spawn') as HTMLSelectElement;
  const returnSpawnSel = overlay.querySelector('#pl-return-spawn') as HTMLSelectElement;
  const retX = overlay.querySelector('#pl-ret-x') as HTMLInputElement;
  const retY = overlay.querySelector('#pl-ret-y') as HTMLInputElement;
  const twoWayCb = overlay.querySelector('#pl-two-way') as HTMLInputElement;

  async function loadTargetSpawns(mapProjectId: string): Promise<void> {
    targetSpawnSel.innerHTML = '<option value="">Loading…</option>';
    try {
      const pack = await mapBuilderApi.getMap(mapProjectId);
      const spawns = pack.document.spawnpoints.filter((s) => s.enabled);
      targetSpawnSel.innerHTML = spawns.length
        ? spawns.map((s) =>
            `<option value="${esc(s.id)}" ${s.id === portal.targetSpawnId ? 'selected' : ''}>${esc(s.name)} (${s.x},${s.y})</option>`
          ).join('')
        : '<option value="default">default (0,0)</option>';
      const doorSpawn = spawns.find((s) => s.type === 'room_entrance' || s.id === 'door');
      if (doorSpawn) {
        retX.value = String(doorSpawn.x);
        retY.value = String(doorSpawn.y);
      }
    } catch (e) {
      targetSpawnSel.innerHTML = `<option value="">Error: ${esc(String(e))}</option>`;
    }
  }

  targetMapSel.addEventListener('change', () => {
    if (targetMapSel.value) void loadTargetSpawns(targetMapSel.value);
  });

  if (targetMapSel.value) void loadTargetSpawns(targetMapSel.value);
  else {
    const pre = findMapBySceneOrId(otherMaps, portal.targetMapId);
    if (pre) {
      targetMapSel.value = pre.id;
      void loadTargetSpawns(pre.id);
    }
  }

  overlay.querySelector('#pl-cancel')!.addEventListener('click', () => overlay.remove());

  overlay.querySelector('#pl-apply')!.addEventListener('click', async () => {
    const targetMapProjectId = targetMapSel.value;
    const targetSpawnId = targetSpawnSel.value;
    if (!targetMapProjectId || !targetSpawnId) {
      showToast('Select target map and spawn', 'info');
      return;
    }
    const targetMeta = allMaps.find((m) => m.id === targetMapProjectId);
    if (!targetMeta) return;

    const btn = overlay.querySelector('#pl-apply') as HTMLButtonElement;
    btn.disabled = true;
    try {
      portal.targetMapId = targetMeta.sceneId;
      portal.targetSpawnId = targetSpawnId;

      if (twoWayCb.checked) {
        await applyTwoWayPortalLink({
          portal,
          currentMapMeta,
          currentDoc,
          allMaps,
          targetMapId: targetMeta.sceneId,
          targetSpawnId,
          returnSpawnId: returnSpawnSel.value || 'default',
          returnPortalX: Number(retX.value),
          returnPortalY: Number(retY.value),
        });
        showToast('Two-way portal link saved (target map draft updated)', 'success');
      } else {
        if (portal.linkedPortalId) {
          await removeTwoWayLink(portal, allMaps);
        } else {
          portal.twoWay = false;
        }
        showToast('One-way portal link applied', 'success');
      }

      overlay.remove();
      onApplied();
    } catch (e) {
      showToast(String(e), 'error');
      btn.disabled = false;
    }
  });
}
