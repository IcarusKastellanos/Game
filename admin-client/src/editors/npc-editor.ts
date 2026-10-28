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

type ScheduleInteraction = 'open' | 'busy' | 'away';

type ScheduleRow = {
  hour: number;
  endHour?: number;
  locationId: string;
  activity?: string;
  days?: number[];
  interaction?: ScheduleInteraction;
  season?: string;
  movement?: 'still' | 'pace';
  dialogueNodeId?: string;
  label?: string;
};

type ScheduleOverride = {
  id: string;
  active: boolean;
  locationId: string;
  activity?: string;
  interaction?: ScheduleInteraction;
  dialogueNodeId?: string;
  priority?: number;
};

type NpcPlaceOption = { id: string; label?: string };

type Personality = Partial<Record<
  | 'friendliness'
  | 'caution'
  | 'honesty'
  | 'generosity'
  | 'curiosity'
  | 'ambition'
  | 'pride'
  | 'suspicion'
  | 'humor'
  | 'socialOpenness',
  number
>>;

const PERSONALITY_TRAITS: (keyof Personality)[] = [
  'friendliness',
  'caution',
  'honesty',
  'generosity',
  'curiosity',
  'ambition',
  'pride',
  'suspicion',
  'humor',
  'socialOpenness',
];

type NpcCapability = {
  action: string;
  label?: string;
  nodeId?: string;
  shopId?: string;
};

type UiFeedback = {
  showStage?: boolean;
  showRegard?: boolean;
  showDemeanor?: boolean;
  showMilestones?: boolean;
  showGiftSummary?: boolean;
  showServices?: boolean;
  showSchedule?: boolean;
};

type NpcRecord = {
  id: string;
  name: string;
  role: string;
  locationId: string;
  dialogueTreeId: string;
  schedule: ScheduleRow[];
  scheduleOverride?: ScheduleOverride;
  relationshipLevel: number;
  magicalKnowledge: number;
  shopId?: string;
  faction?: string;
  secrets?: string[];
  spritePixels?: string[];
  personality?: Personality;
  conversationPolicy?: string;
  biography?: string;
  capabilities?: NpcCapability[];
  revision?: number;
};

const CAPABILITY_ACTIONS = [
  'talk',
  'trade',
  'quests',
  'gift',
  'favor',
  'train',
  'rumors',
  'goodbye',
] as const;

const UI_FEEDBACK_FLAGS: { key: keyof UiFeedback; label: string }[] = [
  { key: 'showStage', label: 'Show relationship stage' },
  { key: 'showRegard', label: 'Show regard lines' },
  { key: 'showDemeanor', label: 'Show demeanor / body language' },
  { key: 'showMilestones', label: 'Show milestones' },
  { key: 'showGiftSummary', label: 'Show gift window summary' },
  { key: 'showServices', label: 'Show services summary' },
  { key: 'showSchedule', label: 'Show usual schedule on People page' },
];

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const INTERACTION_OPTIONS = [
  { value: '', label: 'default' },
  { value: 'open', label: 'open' },
  { value: 'busy', label: 'busy' },
  { value: 'away', label: 'away' },
];

function interactionOrUndefined(value: string): ScheduleInteraction | undefined {
  if (value === 'open' || value === 'busy' || value === 'away') return value;
  return undefined;
}

function routineRowHtml(
  row: ScheduleRow,
  index: number,
  places: { value: string; label: string }[]
): string {
  const options = row.locationId && !places.some((place) => place.value === row.locationId)
    ? [{ value: row.locationId, label: row.locationId }, ...places]
    : places;
  const days = new Set(row.days ?? [0, 1, 2, 3, 4, 5, 6]);
  const dayBoxes = WEEKDAY_LABELS.map(
    (label, day) =>
      `<label class="muted-text"><input type="checkbox" id="routine-day-${index}-${day}" ${days.has(day) ? 'checked' : ''}/> ${label}</label>`
  ).join(' ');
  return `<div class="card mt">
    <div class="form-grid">
      ${field('Start hour', numberInput(`routine-hour-${index}`, row.hour))}
      ${field('End hour', `<input id="routine-end-${index}" type="number" step="1" value="${row.endHour ?? ''}" />`)}
      ${field('Place', selectInput(`routine-place-${index}`, options, row.locationId))}
      ${field('Activity', textInput(`routine-activity-${index}`, row.activity ?? ''))}
      ${field('Interaction', selectInput(`routine-interaction-${index}`, INTERACTION_OPTIONS, row.interaction ?? ''))}
    </div>
    <div class="mt">${dayBoxes}</div>
    <button type="button" class="btn secondary mt" data-remove-routine="${index}">Remove row</button>
  </div>`;
}

function cleanRoutineRows(rows: ScheduleRow[]): ScheduleRow[] {
  return rows.map((row) => {
    const next: ScheduleRow = { hour: row.hour, locationId: row.locationId };
    if (typeof row.endHour === 'number' && Number.isFinite(row.endHour)) next.endHour = row.endHour;
    if (row.activity) next.activity = row.activity;
    if (row.days && row.days.length < 7) next.days = [...row.days];
    if (row.interaction) next.interaction = row.interaction;
    if (row.season) next.season = row.season;
    if (row.movement) next.movement = row.movement;
    if (row.dialogueNodeId) next.dialogueNodeId = row.dialogueNodeId;
    if (row.label) next.label = row.label;
    return next;
  });
}

function cleanOverride(override: ScheduleOverride): ScheduleOverride | undefined {
  const hasBody = override.active || !!override.locationId || !!override.activity || !!override.dialogueNodeId || !!override.interaction;
  if (!hasBody) return undefined;
  return {
    id: override.id || 'override',
    active: override.active,
    locationId: override.locationId,
    ...(override.activity ? { activity: override.activity } : {}),
    ...(override.interaction ? { interaction: override.interaction } : {}),
    ...(override.dialogueNodeId ? { dialogueNodeId: override.dialogueNodeId } : {}),
    ...(typeof override.priority === 'number' ? { priority: override.priority } : {}),
  };
}

type EdgeMeta = {
  relationshipDelta?: number;
  grantItem?: string;
  statBoost?: Record<string, number>;
  socialEvent?: string;
  requiresBond?: Record<string, unknown>;
  actionsJson?: string;
};
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

  let npcRevision = npc.revision ?? 0;
  let dialogueRevision = 0;
  let dialogue: { id: string; npcId: string; nodes: { id: string; text: string; choices: unknown[] }[]; revision?: number };
  try {
    dialogue = await api(`/content/dialogues/${npc.dialogueTreeId}`);
    dialogueRevision = dialogue.revision ?? 0;
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

  let places: NpcPlaceOption[] = [];
  try {
    places = await api<NpcPlaceOption[]>('/content/npc-places');
  } catch {
    places = [];
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
      socialEvent?: string;
      requiresBond?: Record<string, unknown>;
      actions?: unknown[];
    }[]).forEach((choice, ci) => {
      edgeMeta.set(`${node.id}:${ci}`, {
        relationshipDelta: choice.relationshipDelta,
        grantItem: choice.grantItem,
        statBoost: choice.statBoost,
        socialEvent: choice.socialEvent,
        requiresBond: choice.requiresBond,
        actionsJson: choice.actions ? JSON.stringify(choice.actions) : undefined,
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
        ${field('Biography', textarea('npc-bio', npc.biography ?? ''))}
        ${field('Secrets (comma ids)', textInput('npc-secrets', (npc.secrets ?? []).join(', ')))}
        ${field('Conversation policy', selectInput('npc-convo', [
          { value: 'concurrent_personal', label: 'concurrent personal' },
          { value: 'exclusive', label: 'exclusive' },
          { value: 'shared_public', label: 'shared public' },
        ], npc.conversationPolicy ?? 'concurrent_personal'))}
        <h3 class="section-head mt">Personality (0–100)</h3>
        <p class="muted-text">Traits color reactions and gift warmth. They never bypass quest, bond, or economy rules. Personality stays server-only and is stripped from client exports.</p>
        <div class="form-grid">
          ${PERSONALITY_TRAITS.map((trait) =>
            field(trait, numberInput(`npc-trait-${trait}`, npc.personality?.[trait] ?? 50))
          ).join('')}
        </div>
        <h3 class="section-head mt">Services (capabilities)</h3>
        <p class="muted-text">Leave empty to derive talk/trade/quests from dialogue, shop, and quests. Explicit rows override the defaults.</p>
        <div id="npc-capabilities"></div>
        <button type="button" class="btn secondary mt" id="add-capability">+ Capability</button>
        <h3 class="section-head mt">Relationship feedback (player-facing)</h3>
        <p class="muted-text">Stored on the social profile for this NPC. Affinity numbers stay hidden; these toggles only control visible signals.</p>
        <div id="npc-ui-feedback" class="form-grid"></div>
        <div id="npc-routine"></div>
        <h3 class="section-head mt">Portrait (16×16)</h3>
        <p class="muted-text">People / encounter portrait only. Overworld walk and idle use procedural 16×24 8-direction sheets (authored sheet overrides come later).</p>
        <div id="npc-sprite-drop"></div>
        ${spriteArtDivider('or paint pixels')}
        <div id="npc-sprite-editor"></div>
        <img id="npc-sprite-preview" class="icon-preview-img mt" alt="NPC sprite preview" width="64" height="64" />
        <div id="node-inspector" class="inspector mt"></div>
        <div id="edge-inspector" class="inspector mt hidden"></div>
        <button class="btn mt" id="save-npc">Save NPC & Dialogue</button>
        <button class="btn secondary mt" id="diagnose-npc">Diagnose runtime</button>
        <button class="btn secondary mt" id="compare-npc">Compare draft (offline)</button>
        <button class="btn secondary mt" id="add-choice">+ Choice from Selected Node</button>
        <pre id="npc-diagnose-out" class="muted-text mt" style="white-space:pre-wrap;max-height:220px;overflow:auto"></pre>
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

  let capabilityRows: NpcCapability[] = (npc.capabilities ?? []).map((row) => ({ ...row }));
  let uiFeedback: UiFeedback = {
    showStage: true,
    showRegard: true,
    showDemeanor: true,
    showMilestones: true,
    showGiftSummary: true,
    showServices: true,
    showSchedule: true,
  };
  let socialRevision = 0;
  let socialDocument: { npcs?: Record<string, Record<string, unknown>>; revision?: number } = { npcs: {} };

  const renderCapabilities = (): void => {
    const host = document.getElementById('npc-capabilities');
    if (!host) return;
    if (!capabilityRows.length) {
      host.innerHTML = `<p class="muted-text">No explicit capabilities — services are derived at runtime.</p>`;
      return;
    }
    host.innerHTML = capabilityRows
      .map(
        (row, index) => `<div class="card mt">
        <div class="form-grid">
          ${field('Action', selectInput(`cap-action-${index}`, CAPABILITY_ACTIONS.map((action) => ({ value: action, label: action })), row.action))}
          ${field('Label', textInput(`cap-label-${index}`, row.label ?? ''))}
          ${field('Node id', textInput(`cap-node-${index}`, row.nodeId ?? ''))}
          ${field('Shop id', textInput(`cap-shop-${index}`, row.shopId ?? ''))}
        </div>
        <button type="button" class="btn secondary mt" data-remove-cap="${index}">Remove</button>
      </div>`
      )
      .join('');
    host.querySelectorAll<HTMLButtonElement>('[data-remove-cap]').forEach((button) => {
      button.onclick = () => {
        readCapabilitiesFromDom();
        capabilityRows.splice(Number(button.dataset.removeCap), 1);
        renderCapabilities();
      };
    });
  };

  const readCapabilitiesFromDom = (): void => {
    capabilityRows = capabilityRows.map((_, index) => {
      const action = (document.getElementById(`cap-action-${index}`) as HTMLSelectElement | null)?.value || 'talk';
      const label = (document.getElementById(`cap-label-${index}`) as HTMLInputElement | null)?.value.trim();
      const nodeId = (document.getElementById(`cap-node-${index}`) as HTMLInputElement | null)?.value.trim();
      const shopId = (document.getElementById(`cap-shop-${index}`) as HTMLInputElement | null)?.value.trim();
      return {
        action,
        ...(label ? { label } : {}),
        ...(nodeId ? { nodeId } : {}),
        ...(shopId ? { shopId } : {}),
      };
    });
  };

  const renderUiFeedback = (): void => {
    const host = document.getElementById('npc-ui-feedback');
    if (!host) return;
    host.innerHTML = UI_FEEDBACK_FLAGS.map(
      ({ key, label }) =>
        `<label class="muted-text"><input type="checkbox" id="ui-feedback-${key}" ${uiFeedback[key] !== false ? 'checked' : ''}/> ${esc(label)}</label>`
    ).join('');
  };

  const readUiFeedbackFromDom = (): UiFeedback => {
    const next: UiFeedback = {};
    for (const { key } of UI_FEEDBACK_FLAGS) {
      const box = document.getElementById(`ui-feedback-${key}`) as HTMLInputElement | null;
      next[key] = box ? box.checked : true;
    }
    return next;
  };

  document.getElementById('add-capability')!.onclick = () => {
    readCapabilitiesFromDom();
    capabilityRows.push({ action: 'talk' });
    renderCapabilities();
  };
  renderCapabilities();
  renderUiFeedback();

  void api<{ npcs?: Record<string, Record<string, unknown>>; revision?: number }>('/content/social')
    .then((social) => {
      socialDocument = social ?? { npcs: {} };
      socialRevision = social?.revision ?? 0;
      const profile = social?.npcs?.[npcId] as { uiFeedback?: UiFeedback } | undefined;
      if (profile?.uiFeedback) uiFeedback = { ...uiFeedback, ...profile.uiFeedback };
      renderUiFeedback();
    })
    .catch(() => {
      /* Social doc optional while editing identity. */
    });

  let routineRows: ScheduleRow[] = (npc.schedule ?? []).map((row) => ({ ...row }));
  let routineOverride: ScheduleOverride = {
    id: npc.scheduleOverride?.id || 'override',
    active: npc.scheduleOverride?.active === true,
    locationId: npc.scheduleOverride?.locationId ?? '',
    activity: npc.scheduleOverride?.activity,
    interaction: npc.scheduleOverride?.interaction,
    dialogueNodeId: npc.scheduleOverride?.dialogueNodeId,
    priority: npc.scheduleOverride?.priority,
  };
  const routineHost = document.getElementById('npc-routine')!;
  const placeChoices = places.map((place) => ({
    value: place.id,
    label: place.label ? `${place.id} — ${place.label}` : place.id,
  }));

  const renderRoutine = (): void => {
    const placeNote = places.length
      ? places.map((place) => place.id).join(', ')
      : 'No places loaded.';
    routineHost.innerHTML = `
      <h3 class="section-head mt">Daily routine</h3>
      <p class="muted-text">Known places: ${esc(placeNote)}. Start hour is inclusive and end hour is exclusive. Leave the end blank to run until the next row.</p>
      <div id="npc-routine-rows">
        ${routineRows.map((row, index) => routineRowHtml(row, index, placeChoices)).join('')}
      </div>
      <button type="button" class="btn secondary mt" id="npc-add-routine">Add row</button>
      <h3 class="section-head mt">Schedule override</h3>
      <p class="muted-text">An active override replaces the daily routine until it is turned off.</p>
      <label class="muted-text"><input type="checkbox" id="npc-override-active" ${routineOverride.active ? 'checked' : ''}/> Active</label>
      <div class="form-grid">
        ${field('Override place', selectInput('npc-override-place', [{ value: '', label: '—' }, ...placeChoices], routineOverride.locationId))}
        ${field('Override activity', textInput('npc-override-activity', routineOverride.activity ?? ''))}
        ${field('Override interaction', selectInput('npc-override-interaction', [
          { value: '', label: 'default' },
          { value: 'open', label: 'open' },
          { value: 'busy', label: 'busy' },
          { value: 'away', label: 'away' },
        ], routineOverride.interaction ?? ''))}
      </div>`;
    routineHost.querySelectorAll<HTMLButtonElement>('[data-remove-routine]').forEach((button) => {
      button.onclick = () => {
        readRoutineFromDom();
        routineRows.splice(Number(button.dataset.removeRoutine), 1);
        renderRoutine();
      };
    });
    document.getElementById('npc-add-routine')!.onclick = () => {
      readRoutineFromDom();
      routineRows.push({
        hour: 9,
        endHour: 17,
        locationId: places[0]?.id ?? '',
        activity: '',
        interaction: 'open',
      });
      renderRoutine();
    };
  };

  const readRoutineFromDom = (): void => {
    routineRows = routineRows.map((row, index) => {
      const hour = Number((document.getElementById(`routine-hour-${index}`) as HTMLInputElement | null)?.value);
      const endRaw = (document.getElementById(`routine-end-${index}`) as HTMLInputElement | null)?.value ?? '';
      const locationId = (document.getElementById(`routine-place-${index}`) as HTMLSelectElement | null)?.value ?? row.locationId;
      const activity = (document.getElementById(`routine-activity-${index}`) as HTMLInputElement | null)?.value?.trim() ?? '';
      const interaction = (document.getElementById(`routine-interaction-${index}`) as HTMLSelectElement | null)?.value ?? '';
      const days = WEEKDAY_LABELS.map((_, day) => day).filter((day) => {
        return (document.getElementById(`routine-day-${index}-${day}`) as HTMLInputElement | null)?.checked;
      });
      return {
        ...row,
        hour: Number.isInteger(hour) ? hour : row.hour,
        ...(endRaw === '' ? { endHour: undefined } : { endHour: Number(endRaw) }),
        locationId,
        ...(activity ? { activity } : { activity: undefined }),
        ...(interaction === 'open' || interaction === 'busy' || interaction === 'away'
          ? { interaction }
          : { interaction: undefined }),
        ...(days.length === 7 ? { days: undefined } : { days }),
      };
    });
    routineOverride = {
      ...routineOverride,
      active: (document.getElementById('npc-override-active') as HTMLInputElement | null)?.checked === true,
      locationId: (document.getElementById('npc-override-place') as HTMLSelectElement | null)?.value ?? '',
      activity: (document.getElementById('npc-override-activity') as HTMLInputElement | null)?.value?.trim() || undefined,
      interaction: interactionOrUndefined(
        (document.getElementById('npc-override-interaction') as HTMLSelectElement | null)?.value ?? ''
      ),
    };
  };

  renderRoutine();

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
        ${field('Social Event', textInput('ei-social', meta.socialEvent ?? ''))}
      </div>
      ${field('Stat Boost (JSON)', textInput('ei-stat', JSON.stringify(meta.statBoost ?? {})))}
      ${field('Bond Gate (JSON)', textInput('ei-bond', JSON.stringify(meta.requiresBond ?? {})))}
      ${field('Actions (JSON array)', textarea('ei-actions', meta.actionsJson ?? '[]'))}
      <button type="button" class="btn secondary" id="ei-apply">Apply Choice</button>`;
    document.getElementById('ei-apply')!.onclick = () => {
      const label = (document.getElementById('ei-label') as HTMLInputElement).value.trim();
      const next = (document.getElementById('ei-next') as HTMLSelectElement).value;
      const rel = Number((document.getElementById('ei-rel') as HTMLInputElement).value);
      const grant = (document.getElementById('ei-grant') as HTMLInputElement).value.trim();
      const socialEvent = (document.getElementById('ei-social') as HTMLInputElement).value.trim();
      let statBoost: Record<string, number> | undefined;
      let requiresBond: Record<string, unknown> | undefined;
      let actionsJson: string | undefined;
      try {
        const parsed = JSON.parse((document.getElementById('ei-stat') as HTMLInputElement).value || '{}');
        if (Object.keys(parsed).length) statBoost = parsed;
      } catch { /* ignore invalid JSON */ }
      try {
        const parsed = JSON.parse((document.getElementById('ei-bond') as HTMLInputElement).value || '{}');
        if (Object.keys(parsed).length) requiresBond = parsed;
      } catch { /* ignore */ }
      try {
        const raw = (document.getElementById('ei-actions') as HTMLTextAreaElement).value || '[]';
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) actionsJson = JSON.stringify(parsed);
      } catch { /* ignore */ }

      const edgeList = graph!.getEdges();
      const e = edgeList.find((x) => x.id === edge!.id);
      if (!e) return;
      e.label = label;
      e.to = next;
      edgeMeta.set(e.id, {
        relationshipDelta: rel || undefined,
        grantItem: grant || undefined,
        statBoost,
        socialEvent: socialEvent || undefined,
        requiresBond,
        actionsJson,
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

  document.getElementById('diagnose-npc')!.onclick = async () => {
    const out = document.getElementById('npc-diagnose-out');
    try {
      const diagnosis = await api<{
        availability?: { available?: boolean; reasons?: string[] };
        authoring?: { level: string; path: string; message: string }[];
        schedulePreview?: { hour: number; locationId: string; activeNow?: boolean }[];
        presence?: Record<string, unknown>;
      }>(`/content/npcs/${npcId}/diagnose`, { method: 'POST', body: '{}' });
      const lines = [
        `Available: ${diagnosis.availability?.available ? 'yes' : 'no'}`,
        ...(diagnosis.availability?.reasons ?? []).map((r) => `· ${r}`),
        '',
        'Schedule preview:',
        ...(diagnosis.schedulePreview ?? []).map(
          (row) => `  ${row.activeNow ? '*' : ' '} h${row.hour} @ ${row.locationId}`
        ),
        '',
        'Authoring:',
        ...((diagnosis.authoring ?? []).length
          ? diagnosis.authoring!.map((row) => `  [${row.level}] ${row.path}: ${row.message}`)
          : ['  (none)']),
        '',
        diagnosis.presence ? `Presence: ${JSON.stringify(diagnosis.presence)}` : 'Presence: (none)',
      ];
      if (out) out.textContent = lines.join('\n');
    } catch (e) {
      if (out) out.textContent = String(e);
      else alert(String(e));
    }
  };

  document.getElementById('compare-npc')!.onclick = async () => {
    const out = document.getElementById('npc-diagnose-out');
    try {
      readRoutineFromDom();
      readCapabilitiesFromDom();
      const candidate = {
        ...npc,
        id: (document.getElementById('npc-id') as HTMLInputElement).value.trim() || npcId,
        name: (document.getElementById('npc-name') as HTMLInputElement).value.trim(),
        role: (document.getElementById('npc-role') as HTMLInputElement).value.trim(),
        locationId: (document.getElementById('npc-loc') as HTMLSelectElement).value,
        shopId: (document.getElementById('npc-shop') as HTMLInputElement).value.trim() || undefined,
        conversationPolicy: (document.getElementById('npc-convo') as HTMLSelectElement).value || undefined,
        capabilities: capabilityRows.length ? capabilityRows : undefined,
        schedule: cleanRoutineRows(routineRows),
        scheduleOverride: cleanOverride(routineOverride),
      };
      const result = await api<{
        deltas?: string[];
        candidate?: { authoring?: { level: string; message: string }[]; scheduleHoursOpen?: number };
        current?: { scheduleHoursOpen?: number };
      }>(`/content/npcs/${npcId}/compare`, {
        method: 'POST',
        body: JSON.stringify({ candidate }),
      });
      const lines = [
        'Offline draft compare (not saved):',
        ...(result.deltas ?? []).map((d) => `· ${d}`),
        '',
        `Current open windows: ${result.current?.scheduleHoursOpen ?? '?'}`,
        `Candidate open windows: ${result.candidate?.scheduleHoursOpen ?? '?'}`,
        ...(result.candidate?.authoring ?? [])
          .filter((row) => row.level === 'error')
          .map((row) => `ERROR: ${row.message}`),
      ];
      if (out) out.textContent = lines.join('\n');
    } catch (e) {
      if (out) out.textContent = String(e);
      else alert(String(e));
    }
  };

  document.getElementById('save-npc')!.onclick = async () => {
    try {
      readRoutineFromDom();
      readCapabilitiesFromDom();
      const feedback = readUiFeedbackFromDom();
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
        biography: (document.getElementById('npc-bio') as HTMLTextAreaElement).value.trim() || undefined,
        secrets: (document.getElementById('npc-secrets') as HTMLInputElement).value
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean),
        conversationPolicy: (document.getElementById('npc-convo') as HTMLSelectElement).value || undefined,
        personality: Object.fromEntries(
          PERSONALITY_TRAITS.map((trait) => {
            const raw = Number((document.getElementById(`npc-trait-${trait}`) as HTMLInputElement).value);
            return [trait, Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : 50];
          })
        ),
        capabilities: capabilityRows.length ? capabilityRows : undefined,
        schedule: cleanRoutineRows(routineRows),
        scheduleOverride: cleanOverride(routineOverride),
        spritePixels: npcSpritePixels.length === NPC_SPRITE_PX * NPC_SPRITE_PX ? npcSpritePixels : undefined,
      };

      const edges = graph!.getEdges();
      const dlgData = graphToDialogue(npcData.dialogueTreeId, npcData.id, graph!.getNodes(), edges);
      dlgData.nodes = dlgData.nodes.map((node) => ({
        ...node,
        choices: (node.choices as { label: string; next: string; id?: string }[]).map((choice, ci) => {
          const edge = edges.filter((e) => e.from === node.id)[ci];
          const meta = edge ? edgeMeta.get(edge.id) : undefined;
          let actions: unknown[] | undefined;
          if (meta?.actionsJson) {
            try {
              const parsed = JSON.parse(meta.actionsJson);
              if (Array.isArray(parsed) && parsed.length) actions = parsed;
            } catch { /* ignore */ }
          }
          return {
            ...choice,
            ...(meta?.relationshipDelta != null ? { relationshipDelta: meta.relationshipDelta } : {}),
            ...(meta?.grantItem ? { grantItem: meta.grantItem } : {}),
            ...(meta?.statBoost ? { statBoost: meta.statBoost } : {}),
            ...(meta?.socialEvent ? { socialEvent: meta.socialEvent } : {}),
            ...(meta?.requiresBond ? { requiresBond: meta.requiresBond } : {}),
            ...(actions ? { actions } : {}),
          };
        }),
      }));

      const savedNpc = await api<{
        revision: number;
        diagnostics?: { level: string; path: string; message: string }[];
      }>(`/content/npcs/${npcId}`, {
        method: 'PUT',
        body: JSON.stringify({ ...npcData, revision: npcRevision }),
      });
      npcRevision = savedNpc.revision ?? npcRevision;
      const warnLines = (savedNpc.diagnostics ?? [])
        .filter((row) => row.level === 'warn')
        .map((row) => row.message);
      const savedDialogue = await api<{ revision: number }>(`/content/dialogues/${dlgData.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...dlgData, revision: dialogueRevision }),
      });
      dialogueRevision = savedDialogue.revision ?? dialogueRevision;
      try {
        const latestSocial = await api<{
          npcs?: Record<string, Record<string, unknown>>;
          revision?: number;
          [key: string]: unknown;
        }>('/content/social');
        const npcs = { ...(latestSocial.npcs ?? {}) };
        const prior = { ...(npcs[npcData.id] ?? {}) };
        npcs[npcData.id] = { ...prior, uiFeedback: feedback };
        const { revision: _drop, ...socialBody } = latestSocial;
        const savedSocial = await api<{ revision: number }>('/content/social', {
          method: 'PUT',
          body: JSON.stringify({ ...socialBody, npcs, revision: latestSocial.revision ?? socialRevision }),
        });
        socialRevision = savedSocial.revision ?? socialRevision;
      } catch (socialError) {
        console.warn('NPC saved, but relationship feedback could not be stored.', socialError);
      }
      await api('/content/reload', { method: 'POST', body: '{}' });
      alert(warnLines.length ? `Saved & reloaded\n\nNotes:\n- ${warnLines.join('\n- ')}` : 'Saved & reloaded');
      onBack();
    } catch (e) {
      alert(String(e));
    }
  };

  void unbind;
}
