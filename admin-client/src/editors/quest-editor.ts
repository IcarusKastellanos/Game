import { api } from '../api.js';
import { esc, field, numberInput, selectInput, textInput, textarea } from '../helpers/form-html.js';

type Objective = {
  id: string;
  type: string;
  text?: string;
  npcId?: string;
  itemId?: string;
  spellId?: string;
  locationId?: string;
  licenseId?: string;
  choiceId?: string;
  eventId?: string;
  interactableId?: string;
  stage?: string;
  questId?: string;
  hour?: number;
  count?: number;
  quantity?: number;
  optional?: boolean;
  afterChoiceId?: string;
};

type Decision = {
  id: string;
  choiceId: string;
  setFlags?: string[];
  waiveObjectives?: string[];
  followUpQuestIds?: string[];
  rewards?: { reputation?: number };
};

type Node = { id: string; text: string; objective?: string; next?: string; complete?: boolean };

type QuestRecord = {
  id: string;
  version?: number;
  revision?: number;
  name: string;
  description: string;
  scope?: string;
  offer?: string;
  npcId?: string;
  minStage?: string;
  repeat?: string;
  expiresHours?: number;
  startStage: string;
  nodes: Node[];
  objectives?: Objective[];
  optionalObjectives?: Objective[];
  prerequisites?: {
    questsCompleted?: string[];
    licenses?: string[];
    vows?: string[];
    coins?: number;
    storyFlags?: string[];
    noStoryFlags?: string[];
    publicReputation?: number;
    spiritualReputation?: number;
    bond?: { stage?: string; grudge?: string; noGrudge?: string; affinityMin?: number };
  };
  decisions?: Decision[];
  followUpQuestIds?: string[];
  failure?: { eventId?: string };
  party?: { contribution: string; requiredContributors?: number; reward: string };
  world?: { reward: string };
  rewards?: {
    items?: { itemId: string; quantity: number }[];
    reputation?: number;
    spiritualReputation?: number;
    stats?: Record<string, number>;
    licenses?: string[];
  };
  minLevel?: number;
};

const OBJECTIVE_TYPES = [
  'talk', 'deliver', 'collect', 'defeat', 'discover', 'license', 'bond', 'interact',
  'quest', 'schedule', 'dialogue', 'help_player', 'public_event', 'cast_spell',
];

const SCOPES = [
  { value: 'personal', label: 'Personal — each player' },
  { value: 'party', label: 'Party — shared by a party id' },
  { value: 'world', label: 'World — one shared outcome' },
];

const OFFERS = [
  { value: 'on_talk', label: 'When they speak with the NPC' },
  { value: 'follow_up', label: 'After another quest' },
  { value: 'event', label: 'When the matching event happens' },
];

function blankQuest(): QuestRecord {
  return {
    id: 'quest_new',
    version: 1,
    revision: 0,
    name: 'New quest',
    description: '',
    scope: 'personal',
    offer: 'on_talk',
    startStage: 'intro',
    nodes: [
      { id: 'intro', text: '', objective: '', next: 'complete' },
      { id: 'complete', text: '', complete: true },
    ],
    objectives: [{ id: 'step', type: 'talk', text: '', npcId: '', count: 1 }],
    rewards: { reputation: 1 },
    minLevel: 1,
  };
}

function list(value: string[] | undefined): string {
  return (value ?? []).join(', ');
}

function splitList(value: string): string[] {
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

function read(id: string): string {
  return (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null)?.value?.trim() ?? '';
}

function readNumber(id: string): number | undefined {
  const raw = read(id);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export async function renderQuestEditor(el: HTMLElement): Promise<void> {
  let quests: QuestRecord[] = [];
  try {
    quests = await api<QuestRecord[]>('/content/quests');
  } catch (error) {
    el.innerHTML = `<p class="error">${esc(error)}</p>`;
    return;
  }
  let draft: QuestRecord = quests[0] ? await api<QuestRecord>(`/content/quests/${quests[0].id}`) : blankQuest();
  paint();

  function paint(): void {
    const objectives = [...(draft.objectives ?? []), ...(draft.optionalObjectives ?? [])];
    el.innerHTML = `
      <div class="editor-split">
        <div class="card">
          <h2>Quests</h2>
          <button class="btn mt" id="quest-new">New quest</button>
          <div class="mt" id="quest-index">
            ${quests.map((quest) => `<button class="btn secondary mt" data-quest="${esc(quest.id)}">${esc(quest.name)}</button>`).join('')}
          </div>
        </div>
        <div class="card editor-form">
          <h2>${esc(draft.name || 'Quest')}</h2>
          <p class="muted-text">Version ${esc(draft.version ?? 1)}. Saving publishes the next version. People already on this quest keep finished steps that still exist. Removed steps drop away. A finished quest stays finished, and rewards already given stay given. Abandoning, failing, or replaying a repeatable quest starts a fresh instance. A quest set to once cannot be accepted again after it is finished.</p>
          <div id="quest-error" class="error"></div>
          <div class="form-grid">
            ${field('Id', textInput('q-id', draft.id))}
            ${field('Name', textInput('q-name', draft.name))}
            ${field('Scope', selectInput('q-scope', SCOPES, draft.scope ?? 'personal'))}
            ${field('Offer', selectInput('q-offer', OFFERS, draft.offer ?? 'on_talk'))}
            ${field('NPC', textInput('q-npc', draft.npcId ?? '', 'npc_mara'))}
            ${field('Minimum stage', textInput('q-stage', draft.minStage ?? '', 'familiar'))}
            ${field('Repeat', selectInput('q-repeat', [{ value: 'once', label: 'Once' }, { value: 'always', label: 'Can be replayed' }], draft.repeat ?? 'once'))}
            ${field('Expires after hours', numberInput('q-expires', draft.expiresHours ?? 0))}
          </div>
          ${field('Description', textarea('q-desc', draft.description ?? '', 3))}
          <h3 class="section-head mt">Prerequisites</h3>
          <div class="form-grid">
            ${field('Quests finished', textInput('q-pre-quests', list(draft.prerequisites?.questsCompleted)))}
            ${field('Licenses', textInput('q-pre-licenses', list(draft.prerequisites?.licenses)))}
            ${field('Vows', textInput('q-pre-vows', list(draft.prerequisites?.vows)))}
            ${field('Coins', numberInput('q-pre-coins', draft.prerequisites?.coins ?? 0))}
            ${field('Story flags', textInput('q-pre-flags', list(draft.prerequisites?.storyFlags)))}
            ${field('Closed flags', textInput('q-pre-no-flags', list(draft.prerequisites?.noStoryFlags)))}
            ${field('Bond stage', textInput('q-bond-stage', draft.prerequisites?.bond?.stage ?? ''))}
            ${field('Grudge', textInput('q-bond-grudge', draft.prerequisites?.bond?.grudge ?? ''))}
            ${field('No grudge', textInput('q-bond-nogrudge', draft.prerequisites?.bond?.noGrudge ?? ''))}
            ${field('Minimum fondness', numberInput('q-bond-affinity', draft.prerequisites?.bond?.affinityMin ?? 0))}
            ${field('Public standing', numberInput('q-pre-public', draft.prerequisites?.publicReputation ?? 0))}
            ${field('Spiritual standing', numberInput('q-pre-spirit', draft.prerequisites?.spiritualReputation ?? 0))}
          </div>
          <h3 class="section-head mt">Objectives</h3>
          <div id="q-objectives">
            ${objectives.map((row, index) => objectiveRow(row, index)).join('')}
          </div>
          <button class="btn secondary mt" id="q-add-objective">Add objective</button>
          <h3 class="section-head mt">Dialogue lines</h3>
          <div id="q-nodes">
            ${(draft.nodes ?? []).map((node, index) => nodeRow(node, index)).join('')}
          </div>
          <button class="btn secondary mt" id="q-add-node">Add line</button>
          <h3 class="section-head mt">Decisions</h3>
          <p class="muted-text">A dialogue choice can set a story flag, waive a step, change the reward, and open a follow-up.</p>
          <div id="q-decisions">
            ${(draft.decisions ?? []).map((row, index) => decisionRow(row, index)).join('')}
          </div>
          <button class="btn secondary mt" id="q-add-decision">Add decision</button>
          <h3 class="section-head mt">Rewards and scope rules</h3>
          <div class="form-grid">
            ${field('Reward item', textInput('q-reward-item', draft.rewards?.items?.[0]?.itemId ?? ''))}
            ${field('Reward quantity', numberInput('q-reward-qty', draft.rewards?.items?.[0]?.quantity ?? 1))}
            ${field('Public regard', numberInput('q-reward-rep', draft.rewards?.reputation ?? 0))}
            ${field('Spiritual regard', numberInput('q-reward-spirit', draft.rewards?.spiritualReputation ?? 0))}
            ${field('Ritual skill', numberInput('q-reward-skill', draft.rewards?.stats?.ritualSkill ?? 0))}
            ${field('Licenses granted', textInput('q-reward-licenses', list(draft.rewards?.licenses)))}
            ${field('Follow-up quests', textInput('q-follow', list(draft.followUpQuestIds)))}
            ${field('Failure event', textInput('q-fail', draft.failure?.eventId ?? ''))}
            ${field('Party contribution', selectInput('q-party-contrib', [{ value: 'any', label: 'Any member' }, { value: 'all', label: 'Every required member' }], draft.party?.contribution ?? 'any'))}
            ${field('Party members required', numberInput('q-party-count', draft.party?.requiredContributors ?? 2))}
            ${field('Party reward', selectInput('q-party-reward', [{ value: 'each', label: 'Each contributor' }, { value: 'leader', label: 'First contributor' }], draft.party?.reward ?? 'each'))}
          </div>
          <button class="btn mt" id="q-save">Save quest</button>
        </div>
      </div>`;

    el.querySelectorAll<HTMLButtonElement>('[data-quest]').forEach((button) => {
      button.onclick = () => {
        void api<QuestRecord>(`/content/quests/${button.dataset.quest}`).then((quest) => {
          draft = quest;
          paint();
        }).catch((error) => {
          const box = document.getElementById('quest-error');
          if (box) box.textContent = String(error);
        });
      };
    });
    document.getElementById('quest-new')!.onclick = () => {
      draft = blankQuest();
      paint();
    };
    document.getElementById('q-add-objective')!.onclick = () => {
      draft = readDraft();
      draft.objectives = [...(draft.objectives ?? []), { id: `step_${(draft.objectives?.length ?? 0) + 1}`, type: 'talk', text: '' }];
      paint();
    };
    document.getElementById('q-add-node')!.onclick = () => {
      draft = readDraft();
      draft.nodes = [...(draft.nodes ?? []), { id: `line_${draft.nodes.length + 1}`, text: '' }];
      paint();
    };
    document.getElementById('q-add-decision')!.onclick = () => {
      draft = readDraft();
      draft.decisions = [...(draft.decisions ?? []), { id: `choice_${(draft.decisions?.length ?? 0) + 1}`, choiceId: '' }];
      paint();
    };
    document.getElementById('q-save')!.onclick = () => {
      void save();
    };
  }

  function readDraft(): QuestRecord {
    const previousObjectives = [...(draft.objectives ?? []), ...(draft.optionalObjectives ?? [])];
    const objectiveNodes = [...document.querySelectorAll<HTMLElement>('[data-objective]')];
    const objectives: Objective[] = [];
    const optionalObjectives: Objective[] = [];
    for (const row of objectiveNodes) {
      const index = row.dataset.objective ?? '0';
      const optional = (document.getElementById(`qo-optional-${index}`) as HTMLInputElement).checked;
      const prior = previousObjectives[Number(index)] ?? {};
      const objective: Objective = {
        ...prior,
        id: read(`qo-id-${index}`),
        type: read(`qo-type-${index}`),
        text: read(`qo-text-${index}`),
        npcId: read(`qo-npc-${index}`) || undefined,
        itemId: read(`qo-item-${index}`) || undefined,
        spellId: read(`qo-spell-${index}`) || undefined,
        count: readNumber(`qo-count-${index}`),
        optional: optional || undefined,
      };
      if (optional) optionalObjectives.push(objective);
      else objectives.push(objective);
    }
    const nodes: Node[] = [...document.querySelectorAll<HTMLElement>('[data-node]')].map((row) => {
      const index = row.dataset.node ?? '0';
      return {
        id: read(`qn-id-${index}`),
        text: read(`qn-text-${index}`),
        objective: read(`qn-obj-${index}`) || undefined,
        complete: (document.getElementById(`qn-complete-${index}`) as HTMLInputElement).checked || undefined,
      };
    });
    for (let i = 0; i < nodes.length - 1; i += 1) nodes[i]!.next = nodes[i + 1]?.id;
    const decisions = [...document.querySelectorAll<HTMLElement>('[data-decision]')].map((row) => {
      const index = row.dataset.decision ?? '0';
      const reputation = readNumber(`qd-rep-${index}`);
      return {
        id: read(`qd-id-${index}`),
        choiceId: read(`qd-choice-${index}`),
        setFlags: splitList(read(`qd-flags-${index}`)),
        waiveObjectives: splitList(read(`qd-waive-${index}`)),
        followUpQuestIds: splitList(read(`qd-follow-${index}`)),
        ...(reputation ? { rewards: { reputation } } : {}),
      };
    }).filter((row) => row.choiceId);
    const bond = {
      stage: read('q-bond-stage') || undefined,
      grudge: read('q-bond-grudge') || undefined,
      noGrudge: read('q-bond-nogrudge') || undefined,
      affinityMin: readNumber('q-bond-affinity') || undefined,
    };
    const scope = read('q-scope');
    const rewardItem = read('q-reward-item');
    const rewardReputation = readNumber('q-reward-rep');
    const rewardSpirit = readNumber('q-reward-spirit');
    const rewardSkill = readNumber('q-reward-skill');
    const next: QuestRecord = {
      ...draft,
      id: read('q-id'),
      name: read('q-name'),
      description: read('q-desc'),
      scope,
      offer: read('q-offer'),
      npcId: read('q-npc') || undefined,
      minStage: read('q-stage') || undefined,
      repeat: read('q-repeat') === 'always' ? 'always' : 'once',
      expiresHours: readNumber('q-expires') || undefined,
      startStage: nodes[0]?.id || 'intro',
      nodes,
      objectives,
      optionalObjectives,
      prerequisites: {
        questsCompleted: splitList(read('q-pre-quests')),
        licenses: splitList(read('q-pre-licenses')),
        vows: splitList(read('q-pre-vows')),
        coins: readNumber('q-pre-coins') || undefined,
        storyFlags: splitList(read('q-pre-flags')),
        noStoryFlags: splitList(read('q-pre-no-flags')),
        publicReputation: readNumber('q-pre-public') || undefined,
        spiritualReputation: readNumber('q-pre-spirit') || undefined,
        ...(bond.stage || bond.grudge || bond.noGrudge || bond.affinityMin ? { bond } : {}),
      },
      decisions,
      followUpQuestIds: splitList(read('q-follow')),
      failure: read('q-fail') ? { eventId: read('q-fail') } : undefined,
      rewards: {
        ...(rewardItem ? { items: [{ itemId: rewardItem, quantity: readNumber('q-reward-qty') || 1 }] } : {}),
        ...(rewardReputation ? { reputation: rewardReputation } : {}),
        ...(rewardSpirit ? { spiritualReputation: rewardSpirit } : {}),
        ...(rewardSkill ? { stats: { ritualSkill: rewardSkill } } : {}),
        ...(splitList(read('q-reward-licenses')).length ? { licenses: splitList(read('q-reward-licenses')) } : {}),
      },
      minLevel: draft.minLevel ?? 1,
    };
    if (scope === 'party') {
      next.party = {
        contribution: read('q-party-contrib') === 'all' ? 'all' : 'any',
        requiredContributors: readNumber('q-party-count') || 2,
        reward: read('q-party-reward') === 'leader' ? 'leader' : 'each',
      };
      delete next.world;
    } else if (scope === 'world') {
      next.world = { reward: 'each_contributor' };
      delete next.party;
    } else {
      delete next.party;
      delete next.world;
    }
    return next;
  }

  async function save(): Promise<void> {
    const error = document.getElementById('quest-error');
    if (error) error.textContent = '';
    const body = readDraft();
    try {
      const saved = await api<QuestRecord>(`/content/quests/${encodeURIComponent(body.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ ...body, revision: draft.revision ?? 0 }),
      });
      draft = saved;
      quests = await api<QuestRecord[]>('/content/quests');
      paint();
      const box = document.getElementById('quest-error');
      if (box) box.textContent = `Saved ${saved.name} as version ${saved.version ?? 1}.`;
    } catch (err) {
      if (error) error.textContent = err instanceof Error ? err.message : String(err);
    }
  }
}

function objectiveRow(row: Objective, index: number): string {
  return `<div class="form-grid mt" data-objective="${index}">
    ${field('Step id', textInput(`qo-id-${index}`, row.id))}
    ${field('Type', selectInput(`qo-type-${index}`, OBJECTIVE_TYPES.map((type) => ({ value: type, label: type })), row.type))}
    ${field('Text', textInput(`qo-text-${index}`, row.text ?? ''))}
    ${field('NPC', textInput(`qo-npc-${index}`, row.npcId ?? ''))}
    ${field('Item', textInput(`qo-item-${index}`, row.itemId ?? ''))}
    ${field('Spell', textInput(`qo-spell-${index}`, row.spellId ?? ''))}
    ${field('Count', numberInput(`qo-count-${index}`, row.count ?? row.quantity ?? 1))}
    <label class="checkbox-chip">Optional <input id="qo-optional-${index}" type="checkbox"${row.optional ? ' checked' : ''} /></label>
  </div>`;
}

function nodeRow(node: Node, index: number): string {
  return `<div class="form-grid mt" data-node="${index}">
    ${field('Line id', textInput(`qn-id-${index}`, node.id))}
    ${field('Line', textInput(`qn-text-${index}`, node.text))}
    ${field('Objective sentence', textInput(`qn-obj-${index}`, node.objective ?? ''))}
    <label class="checkbox-chip">Closing line <input id="qn-complete-${index}" type="checkbox"${node.complete ? ' checked' : ''} /></label>
  </div>`;
}

function decisionRow(row: Decision, index: number): string {
  return `<div class="form-grid mt" data-decision="${index}">
    ${field('Decision id', textInput(`qd-id-${index}`, row.id))}
    ${field('Dialogue choice id', textInput(`qd-choice-${index}`, row.choiceId))}
    ${field('Flags set', textInput(`qd-flags-${index}`, list(row.setFlags)))}
    ${field('Steps waived', textInput(`qd-waive-${index}`, list(row.waiveObjectives)))}
    ${field('Follow-ups', textInput(`qd-follow-${index}`, list(row.followUpQuestIds)))}
    ${field('Alternate regard', numberInput(`qd-rep-${index}`, row.rewards?.reputation ?? 0))}
  </div>`;
}
