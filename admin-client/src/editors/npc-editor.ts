import { api } from '../api.js';
import {
  esc, field, textInput, numberInput, textarea, selectInput, MAP_LOCATIONS,
} from '../helpers/form-html.js';
import {
  NodeGraph, dialogueToGraph, graphToDialogue, type GraphEdge, type GraphNode,
} from '../components/node-graph.js';
import { mountImageDropImport, spriteArtDivider } from '../components/image-import.js';
import { mountSpritePixelEditor, spritePixelsToDataUrl } from '../components/sprite-pixel-editor.js';

const NPC_SPRITE_PX = 16;

type NpcRecord = {
  id: string;
  name: string;
  role: string;
  locationId: string;
  dialogueTreeId: string;
  schedule: { hour: number; locationId: string }[];
  relationshipLevel: number;
  magicalKnowledge: number;
  shopId?: string;
  faction?: string;
  secrets?: string[];
  spritePixels?: string[];
};

type EdgeMeta = { relationshipDelta?: number; grantItem?: string; statBoost?: Record<string, number> };
type AnnotatedEdge = GraphEdge & { meta?: EdgeMeta };

export async function renderNpcList(el: HTMLElement, onEdit: (id: string) => void): Promise<void> {
  const npcs = await api<NpcRecord[]>('/content/npcs');
  el.innerHTML = `<div class="card"><h2>NPC Builder</h2>
    <table><thead><tr><th>ID</th><th>Name</th><th>Role</th><th>Location</th><th>Dialogue</th><th></th></tr></thead>
    <tbody>${npcs.map((n) =>
      `<tr><td><a href="#" class="npc-link" data-id="${esc(n.id)}" style="color:#fc8">${esc(n.id)}</a></td><td>${esc(n.name)}</td><td>${esc(n.role)}</td><td>${esc(n.locationId)}</td><td>${esc(n.dialogueTreeId)}</td>
      <td><button class="btn secondary npc-edit-btn" data-id="${esc(n.id)}">Edit</button></td></tr>`
    ).join('')}</tbody></table></div>`;
  document.querySelectorAll('.npc-link, .npc-edit-btn').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      onEdit((a as HTMLElement).dataset.id!);
    });
  });
}

export async function renderNpcEditor(
  el: HTMLElement,
  npcId: string,
  onBack: () => void
): Promise<void> {
  const npcs = await api<NpcRecord[]>('/content/npcs');
  const npc = npcs.find((n) => n.id === npcId);
  if (!npc) { el.textContent = 'NPC not found'; return; }

  let dialogue: { id: string; npcId: string; nodes: { id: string; text: string; choices: unknown[] }[] };
  try {
    dialogue = await api(`/content/dialogues/${npc.dialogueTreeId}`);
  } catch {
    dialogue = {
      id: npc.dialogueTreeId,
      npcId,
      nodes: [
        { id: 'start', text: '', choices: [{ label: 'Goodbye.', next: 'end' }] },
        { id: 'end', text: '', choices: [] },
      ],
    };
  }

  const graphData = dialogueToGraph({
    nodes: dialogue.nodes as { id: string; text: string; choices: { label: string; next: string }[] }[],
  });
  const edgeMeta = new Map<string, EdgeMeta>();
  for (const node of dialogue.nodes) {
    (node.choices as {
      label: string;
      next: string;
      relationshipDelta?: number;
      grantItem?: string;
      statBoost?: Record<string, number>;
    }[]).forEach((choice, ci) => {
      edgeMeta.set(`${node.id}:${ci}`, {
        relationshipDelta: choice.relationshipDelta,
        grantItem: choice.grantItem,
        statBoost: choice.statBoost,
      });
    });
  }

  let selectedNode: GraphNode | null = null;
  let selectedEdge: AnnotatedEdge | null = null;
  let graph: NodeGraph | null = null;

  el.innerHTML = `
    <button class="btn secondary" id="back-npc">← Back</button>
    <div class="editor-split mt">
      <div class="editor-form card">
        <h2>NPC: ${esc(npc.name)}</h2>
        <div class="form-grid">
          ${field('ID', textInput('npc-id', npc.id))}
          ${field('Name', textInput('npc-name', npc.name))}
          ${field('Role', textInput('npc-role', npc.role))}
          ${field('Location', selectInput('npc-loc', MAP_LOCATIONS.map((l) => ({ value: l, label: l })), npc.locationId))}
          ${field('Dialogue Tree ID', textInput('npc-dlg-id', npc.dialogueTreeId))}
          ${field('Shop ID', textInput('npc-shop', npc.shopId ?? ''))}
          ${field('Relationship Level', numberInput('npc-rel', npc.relationshipLevel ?? 0))}
          ${field('Magical Knowledge', numberInput('npc-mk', npc.magicalKnowledge ?? 0))}
        </div>
        ${field('Faction', textInput('npc-faction', npc.faction ?? ''))}
        <h3 class="section-head mt">Overworld Sprite (16×16)</h3>
        <p class="muted-text">Drop an image to import, or paint pixels below. Used on maps when this NPC is placed.</p>
        <div id="npc-sprite-drop"></div>
        ${spriteArtDivider('or paint pixels')}
        <div id="npc-sprite-editor"></div>
        <img id="npc-sprite-preview" class="icon-preview-img mt" alt="NPC sprite preview" width="64" height="64" />
        <div id="node-inspector" class="inspector mt"></div>
        <div id="edge-inspector" class="inspector mt hidden"></div>
        <button class="btn mt" id="save-npc">Save NPC & Dialogue</button>
        <button class="btn secondary mt" id="add-choice">+ Choice from Selected Node</button>
      </div>
      <div class="editor-graph card">
        <h2>Dialogue Graph</h2>
        <p class="muted-text">Drag nodes, connect choices as edges. Select a node to edit its line; select an edge to edit the choice label and effects.</p>
        <div id="dlg-graph"></div>
      </div>
    </div>`;

  document.getElementById('back-npc')!.onclick = onBack;

  let npcSpritePixels = npc.spritePixels?.length === NPC_SPRITE_PX * NPC_SPRITE_PX ? [...npc.spritePixels] : [];
  const spritePreview = document.getElementById('npc-sprite-preview') as HTMLImageElement;
  const updateNpcSpritePreview = (): void => {
    spritePreview.src = spritePixelsToDataUrl(npcSpritePixels, NPC_SPRITE_PX, NPC_SPRITE_PX);
  };
  const npcSpriteEditor = mountSpritePixelEditor(document.getElementById('npc-sprite-editor')!, {
    widthPx: NPC_SPRITE_PX,
    heightPx: NPC_SPRITE_PX,
    initial: npcSpritePixels,
    onChange: (px) => {
      npcSpritePixels = px;
      updateNpcSpritePreview();
    },
  });
  mountImageDropImport(document.getElementById('npc-sprite-drop')!, {
    idPrefix: 'npc-sprite',
    widthPx: () => NPC_SPRITE_PX,
    heightPx: () => NPC_SPRITE_PX,
    onImport: (px) => {
      npcSpriteEditor.setPixels(px);
      updateNpcSpritePreview();
    },
    onError: (msg) => alert(msg),
  });
  updateNpcSpritePreview();

  const graphHost = document.getElementById('dlg-graph')!;
  graph = new NodeGraph(graphHost, {
    nodes: graphData.nodes,
    edges: graphData.edges,
    newNodeTitle: 'Dialogue Node',
    onNodeSelect: (node) => {
      selectedNode = node;
      selectedEdge = null;
      renderNodeInspector(node);
      document.getElementById('edge-inspector')!.classList.add('hidden');
    },
    onEdgeSelect: (edge) => {
      selectedEdge = edge;
      selectedNode = null;
      renderEdgeInspector(edge);
      document.getElementById('node-inspector')!.innerHTML = '';
    },
  });
  const unbind = graph.bindPointerHandlers();

  function renderNodeInspector(node: GraphNode | null): void {
    const panel = document.getElementById('node-inspector')!;
    if (!node) {
      panel.innerHTML = '<p class="muted-text">Select a dialogue node in the graph.</p>';
      return;
    }
    const raw = (node.data ?? {}) as { text?: string; choices?: unknown[] };
    panel.innerHTML = `
      <h3>Node: ${esc(node.id)}</h3>
      ${field('Node ID', textInput('ni-id', node.id))}
      ${field('Dialogue Text', textarea('ni-text', raw.text ?? '', 4))}
      <button type="button" class="btn secondary" id="ni-apply">Apply Node</button>`;
    document.getElementById('ni-apply')!.onclick = () => {
      const newId = (document.getElementById('ni-id') as HTMLInputElement).value.trim();
      const text = (document.getElementById('ni-text') as HTMLTextAreaElement).value;
      const nodes = graph!.getNodes();
      const edges = graph!.getEdges();
      const oldId = node.id;
      if (newId !== oldId) {
        for (const e of edges) {
          if (e.from === oldId) e.from = newId;
          if (e.to === oldId) e.to = newId;
        }
        node.id = newId;
      }
      node.title = newId;
      node.subtitle = text.slice(0, 48) + (text.length > 48 ? '…' : '');
      node.data = { id: newId, text, choices: raw.choices ?? [] };
      graph!.setData(nodes, edges);
      selectedNode = node;
    };
  }

  function renderEdgeInspector(edge: GraphEdge | null): void {
    const panel = document.getElementById('edge-inspector')!;
    if (!edge) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');
    const meta = edgeMeta.get(edge.id) ?? {};
    const targetOpts = graph!.getNodes().map((n) => ({ value: n.id, label: n.id }));
    panel.innerHTML = `
      <h3>Choice Edge</h3>
      <div class="form-grid">
        ${field('Choice Label', textInput('ei-label', edge.label ?? ''))}
        ${field('Next Node', selectInput('ei-next', targetOpts, edge.to))}
        ${field('Relationship Δ', numberInput('ei-rel', meta.relationshipDelta ?? 0))}
        ${field('Grant Item', textInput('ei-grant', meta.grantItem ?? ''))}
      </div>
      ${field('Stat Boost (JSON)', textInput('ei-stat', JSON.stringify(meta.statBoost ?? {})))}
      <button type="button" class="btn secondary" id="ei-apply">Apply Choice</button>`;
    document.getElementById('ei-apply')!.onclick = () => {
      const label = (document.getElementById('ei-label') as HTMLInputElement).value.trim();
      const next = (document.getElementById('ei-next') as HTMLSelectElement).value;
      const rel = Number((document.getElementById('ei-rel') as HTMLInputElement).value);
      const grant = (document.getElementById('ei-grant') as HTMLInputElement).value.trim();
      let statBoost: Record<string, number> | undefined;
      try {
        const parsed = JSON.parse((document.getElementById('ei-stat') as HTMLInputElement).value || '{}');
        if (Object.keys(parsed).length) statBoost = parsed;
      } catch { /* ignore invalid JSON */ }

      const edgeList = graph!.getEdges();
      const e = edgeList.find((x) => x.id === edge!.id);
      if (!e) return;
      e.label = label;
      e.to = next;
      edgeMeta.set(e.id, {
        relationshipDelta: rel || undefined,
        grantItem: grant || undefined,
        statBoost,
      });
      graph!.setData(graph!.getNodes(), edgeList);
      renderEdgeInspector(e);
    };
  }

  document.getElementById('add-choice')!.onclick = () => {
    if (!selectedNode) {
      alert('Select a source node first');
      return;
    }
    const nodes = graph!.getNodes();
    const endNode = nodes.find((n) => n.id === 'end') ?? nodes[nodes.length - 1];
    const edgeList = graph!.getEdges();
    const edgeId = `${selectedNode.id}:${edgeList.filter((e) => e.from === selectedNode!.id).length}`;
    edgeList.push({
      id: edgeId,
      from: selectedNode.id,
      to: endNode?.id ?? selectedNode.id,
      label: 'New choice',
    });
    edgeMeta.set(edgeId, {});
    graph!.setData(nodes, edgeList);
  };

  document.getElementById('save-npc')!.onclick = async () => {
    try {
      const npcData: NpcRecord = {
        ...npc,
        id: (document.getElementById('npc-id') as HTMLInputElement).value.trim(),
        name: (document.getElementById('npc-name') as HTMLInputElement).value.trim(),
        role: (document.getElementById('npc-role') as HTMLInputElement).value.trim(),
        locationId: (document.getElementById('npc-loc') as HTMLSelectElement).value,
        dialogueTreeId: (document.getElementById('npc-dlg-id') as HTMLInputElement).value.trim(),
        shopId: (document.getElementById('npc-shop') as HTMLInputElement).value.trim() || undefined,
        relationshipLevel: Number((document.getElementById('npc-rel') as HTMLInputElement).value),
        magicalKnowledge: Number((document.getElementById('npc-mk') as HTMLInputElement).value),
        faction: (document.getElementById('npc-faction') as HTMLInputElement).value.trim() || undefined,
        schedule: npc.schedule ?? [],
        spritePixels: npcSpritePixels.length === NPC_SPRITE_PX * NPC_SPRITE_PX ? npcSpritePixels : undefined,
      };

      const edges = graph!.getEdges();
      const dlgData = graphToDialogue(npcData.dialogueTreeId, npcData.id, graph!.getNodes(), edges);
      dlgData.nodes = dlgData.nodes.map((node) => ({
        ...node,
        choices: (node.choices as { label: string; next: string }[]).map((choice, ci) => {
          const edge = edges.find((e) => e.from === node.id && e.to === choice.next && e.label === choice.label)
            ?? edges.filter((e) => e.from === node.id)[ci];
          const meta = edge ? edgeMeta.get(edge.id) : undefined;
          return {
            ...choice,
            ...(meta?.relationshipDelta != null ? { relationshipDelta: meta.relationshipDelta } : {}),
            ...(meta?.grantItem ? { grantItem: meta.grantItem } : {}),
            ...(meta?.statBoost ? { statBoost: meta.statBoost } : {}),
          };
        }),
      }));

      await api(`/content/npcs/${npcId}`, { method: 'PUT', body: JSON.stringify(npcData) });
      await api(`/content/dialogues/${dlgData.id}`, { method: 'PUT', body: JSON.stringify(dlgData) });
      await api('/content/reload', { method: 'POST', body: '{}' });
      alert('Saved & reloaded');
      onBack();
    } catch (e) {
      alert(String(e));
    }
  };

  void unbind;
}
