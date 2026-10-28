/**
 * Offline NPC configuration compare for designers.
 * Read-only — never mutates live content or player state.
 */

import type { ContentNpc } from '../types/index.js';
import { validateNpcAuthoring, type AuthoringDiagnostic } from './authoring.js';
import { diagnoseNpcRuntime, previewNpcSchedule, type NpcRuntimeDiagnosis } from './diagnostics.js';
import type { NpcPublicPresence } from './schedule.js';

export interface NpcConfigCompareResult {
  npcId: string;
  current: {
    authoring: AuthoringDiagnostic[];
    scheduleHoursOpen: number;
    services: string[];
  };
  candidate: {
    authoring: AuthoringDiagnostic[];
    scheduleHoursOpen: number;
    services: string[];
  };
  deltas: string[];
  /** Full privileged diagnoses for drill-down. */
  currentDiagnosis: NpcRuntimeDiagnosis;
  candidateDiagnosis: NpcRuntimeDiagnosis;
  synthetic: true;
}

function openHours(npc: ContentNpc): number {
  return previewNpcSchedule(npc, 0).filter((row) => row.interaction !== 'away').length;
}

function serviceLabels(npc: ContentNpc): string[] {
  if (npc.capabilities?.length) return npc.capabilities.map((row) => row.action);
  const out = ['talk'];
  if (npc.shopId) out.push('trade');
  return out;
}

export function compareNpcConfigurations(input: {
  current: ContentNpc;
  candidate: ContentNpc;
  placeIds?: readonly string[];
  shopIds?: ReadonlySet<string>;
  dialogueTreeIds?: ReadonlySet<string>;
  hour?: number;
  presence?: NpcPublicPresence | null;
}): NpcConfigCompareResult {
  const hour = input.hour ?? 12;
  const ctx = {
    placeIds: input.placeIds,
    shopIds: input.shopIds,
    dialogueTreeIds: input.dialogueTreeIds,
  };
  const currentAuth = validateNpcAuthoring(input.current, input.current.id, ctx);
  const candidateAuth = validateNpcAuthoring(input.candidate, input.candidate.id || input.current.id, ctx);
  const currentDiagnosis = diagnoseNpcRuntime({
    npc: input.current,
    ...ctx,
    hour,
    presence: input.presence,
    distanceOk: true,
  });
  const candidateDiagnosis = diagnoseNpcRuntime({
    npc: { ...input.candidate, id: input.candidate.id || input.current.id },
    ...ctx,
    hour,
    presence: input.presence,
    distanceOk: true,
  });

  const deltas: string[] = [];
  if (input.current.locationId !== input.candidate.locationId) {
    deltas.push(`Home place: ${input.current.locationId} → ${input.candidate.locationId}`);
  }
  if ((input.current.shopId ?? '') !== (input.candidate.shopId ?? '')) {
    deltas.push(`Shop: ${input.current.shopId ?? '—'} → ${input.candidate.shopId ?? '—'}`);
  }
  if ((input.current.conversationPolicy ?? '') !== (input.candidate.conversationPolicy ?? '')) {
    deltas.push(
      `Conversation policy: ${input.current.conversationPolicy ?? 'default'} → ${input.candidate.conversationPolicy ?? 'default'}`
    );
  }
  const curOpen = openHours(input.current);
  const candOpen = openHours(input.candidate);
  if (curOpen !== candOpen) deltas.push(`Schedule open windows: ${curOpen} → ${candOpen}`);
  const curSvc = serviceLabels(input.current).join(',');
  const candSvc = serviceLabels(input.candidate).join(',');
  if (curSvc !== candSvc) deltas.push(`Services: ${curSvc || '—'} → ${candSvc || '—'}`);
  if (candidateAuth.diagnostics.some((row) => row.level === 'error')) {
    deltas.push('Candidate has authoring errors — do not publish.');
  }
  if (!deltas.length) deltas.push('No meaningful configuration deltas detected.');

  return {
    npcId: input.current.id,
    current: {
      authoring: currentAuth.diagnostics,
      scheduleHoursOpen: curOpen,
      services: serviceLabels(input.current),
    },
    candidate: {
      authoring: candidateAuth.diagnostics,
      scheduleHoursOpen: candOpen,
      services: serviceLabels(input.candidate),
    },
    deltas,
    currentDiagnosis,
    candidateDiagnosis,
    synthetic: true,
  };
}
