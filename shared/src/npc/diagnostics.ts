/**
 * Designer / developer NPC diagnostics.
 * Never ship these payloads on player-facing routes without admin permission.
 */

import type { ContentNpc, InventorySlot, PlayerStats } from '../types/index.js';
import {
  behaviorFromSchedule,
  canStartConversation,
  parseConversationPolicy,
  type NpcConversationLock,
  type NpcBehaviorState,
} from './behavior.js';
import { validateNpcAuthoring, type AuthoringDiagnostic } from './authoring.js';
import { NPC_STATE_OWNERSHIP } from './ownership.js';
import type { PlayerProgression, ContentQuest } from '../progression/index.js';
import { buildNpcEncounterView, type NpcEncounterView } from './encounter.js';
import type { DialogueTree } from '../dialogue/index.js';
import type { NpcPublicPresence } from './schedule.js';

export interface NpcAvailabilityExplain {
  available: boolean;
  reasons: string[];
  behavior: NpcBehaviorState;
  interaction?: string;
  distanceOk?: boolean;
  conversationOk?: boolean;
}

export interface NpcSchedulePreviewRow {
  hour: number;
  endHour?: number;
  locationId: string;
  activity?: string;
  interaction?: string;
  movement?: string;
  activeNow: boolean;
}

export interface NpcRuntimeDiagnosis {
  npcId: string;
  name: string;
  authoring: AuthoringDiagnostic[];
  schedulePreview: NpcSchedulePreviewRow[];
  presence?: Pick<
    NpcPublicPresence,
    | 'scene'
    | 'location'
    | 'activity'
    | 'interaction'
    | 'visible'
    | 'indoors'
    | 'held'
    | 'moving'
    | 'notice'
    | 'dialogueNodeId'
  >;
  availability: NpcAvailabilityExplain;
  encounter?: NpcEncounterView;
  ownership: typeof NPC_STATE_OWNERSHIP;
  /** True when this payload must stay admin-only. */
  privileged: true;
}

export function explainNpcAvailability(input: {
  presence?: NpcPublicPresence | null;
  locks?: readonly NpcConversationLock[];
  playerId?: string;
  policy?: string;
  distanceOk?: boolean;
}): NpcAvailabilityExplain {
  const presence = input.presence;
  const reasons: string[] = [];
  if (!presence) {
    return {
      available: false,
      reasons: ['No runtime presence — schedule may be empty or places unresolved.'],
      behavior: 'idle',
    };
  }
  const behavior = behaviorFromSchedule(presence.interaction, presence.moving ? 'pace' : 'still');
  if (!presence.visible) reasons.push('Presence is not visible (hidden / away / indoors post).');
  if (presence.indoors) reasons.push('NPC is indoors — walker interact uses presence tile only outdoors.');
  if (presence.held) reasons.push('NPC is held (missing/blocked destination).');
  if (presence.interaction === 'away') reasons.push('Schedule interaction is away.');
  if (presence.interaction === 'busy') reasons.push('Schedule interaction is busy.');
  if (presence.moving) reasons.push('NPC is mid-walk; wait until they settle.');
  if (input.distanceOk === false) reasons.push('Player is out of interact range.');

  const policy = parseConversationPolicy(input.policy);
  let conversationOk = true;
  if (input.playerId && input.locks) {
    const gate = canStartConversation(behavior, policy, input.locks, presence.npcId, input.playerId);
    conversationOk = gate.ok;
    if (!gate.ok) reasons.push(gate.reason);
  } else if (behavior === 'busy' || behavior === 'traveling' || behavior === 'resting') {
    conversationOk = false;
    if (!reasons.some((r) => /busy|away|walk/i.test(r))) {
      reasons.push('Behavior blocks conversation.');
    }
  }

  const available =
    presence.visible &&
    !presence.indoors &&
    !presence.held &&
    presence.interaction !== 'away' &&
    !presence.moving &&
    conversationOk &&
    input.distanceOk !== false;

  if (available && !reasons.length) reasons.push('Available for interaction.');
  return {
    available,
    reasons,
    behavior,
    interaction: presence.interaction,
    distanceOk: input.distanceOk,
    conversationOk,
  };
}

export function previewNpcSchedule(npc: ContentNpc, hour: number): NpcSchedulePreviewRow[] {
  return (npc.schedule ?? []).map((row) => {
    const end = row.endHour;
    let activeNow = false;
    if (typeof end === 'number') {
      if (row.hour === end) activeNow = hour === row.hour;
      else if (row.hour < end) activeNow = hour >= row.hour && hour < end;
      else activeNow = hour >= row.hour || hour < end;
    } else {
      activeNow = hour === row.hour;
    }
    return {
      hour: row.hour,
      ...(end != null ? { endHour: end } : {}),
      locationId: row.locationId,
      ...(row.activity ? { activity: row.activity } : {}),
      ...(row.interaction ? { interaction: row.interaction } : {}),
      ...(row.movement ? { movement: row.movement } : {}),
      activeNow,
    };
  });
}

export function diagnoseNpcRuntime(input: {
  npc: ContentNpc;
  placeIds?: readonly string[];
  shopIds?: ReadonlySet<string>;
  dialogueTreeIds?: ReadonlySet<string>;
  dialogueNodeIds?: ReadonlySet<string>;
  presence?: NpcPublicPresence | null;
  hour: number;
  locks?: readonly NpcConversationLock[];
  playerId?: string;
  distanceOk?: boolean;
  /** Optional player context for encounter dry-run (does not mutate). */
  encounterCtx?: {
    progression: PlayerProgression;
    stats: PlayerStats;
    inventory: InventorySlot[];
    coins: number;
    dialogue?: DialogueTree;
    quests?: ContentQuest[];
  };
}): NpcRuntimeDiagnosis {
  const authoring = validateNpcAuthoring(input.npc, input.npc.id, {
    placeIds: input.placeIds,
    shopIds: input.shopIds,
    dialogueTreeIds: input.dialogueTreeIds,
    dialogueNodeIds: input.dialogueNodeIds,
  }).diagnostics;

  const availability = explainNpcAvailability({
    presence: input.presence,
    locks: input.locks,
    playerId: input.playerId,
    policy: input.npc.conversationPolicy,
    distanceOk: input.distanceOk,
  });

  let encounter: NpcEncounterView | undefined;
  if (input.encounterCtx) {
    encounter = buildNpcEncounterView({
      npc: input.npc,
      dialogue: input.encounterCtx.dialogue,
      progression: input.encounterCtx.progression,
      stats: input.encounterCtx.stats,
      inventory: input.encounterCtx.inventory,
      coins: input.encounterCtx.coins,
      quests: input.encounterCtx.quests,
    });
  }

  const presence = input.presence
    ? {
        scene: input.presence.scene,
        location: input.presence.location,
        activity: input.presence.activity,
        interaction: input.presence.interaction,
        visible: input.presence.visible,
        indoors: input.presence.indoors,
        held: input.presence.held,
        moving: input.presence.moving,
        notice: input.presence.notice,
        dialogueNodeId: input.presence.dialogueNodeId,
      }
    : undefined;

  return {
    npcId: input.npc.id,
    name: input.npc.name,
    authoring,
    schedulePreview: previewNpcSchedule(input.npc, input.hour),
    presence,
    availability,
    encounter,
    ownership: NPC_STATE_OWNERSHIP,
    privileged: true,
  };
}
