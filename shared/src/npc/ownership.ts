/**
 * NPC state ownership matrix.
 *
 * Authority: every field has one writer. Clients never invent durable NPC state.
 * Visibility: public / discoverable / relationship / private — see authoring tiers.
 */

export type NpcStateScope =
  | 'global_definition'
  | 'world_shared'
  | 'instance'
  | 'player_private'
  | 'transient_session'
  | 'derived';

export type NpcPersistence = 'content' | 'player_save' | 'world_file' | 'memory' | 'none';

export type NpcReplication = 'broadcast_room' | 'unicast_player' | 'admin_only' | 'never';

export interface NpcOwnershipRow {
  field: string;
  scope: NpcStateScope;
  persistence: NpcPersistence;
  replication: NpcReplication;
  notes: string;
}

/** Authoritative ownership for NPC simulation fields. Keep in sync with GameRoom + sync.ts. */
export const NPC_STATE_OWNERSHIP: readonly NpcOwnershipRow[] = [
  {
    field: 'npc definition (name, role, biography, schedule, capabilities)',
    scope: 'global_definition',
    persistence: 'content',
    replication: 'broadcast_room',
    notes: 'Public catalog via toClientNpc; secrets/personality never client-exported.',
  },
  {
    field: 'npcPresences / hiddenNpcIds / world hour',
    scope: 'world_shared',
    persistence: 'memory',
    replication: 'broadcast_room',
    notes: 'Reconstructed from schedule + clock each tick; seq on world_state.',
  },
  {
    field: 'scheduleOverride (quest appearance)',
    scope: 'world_shared',
    persistence: 'content',
    replication: 'never',
    notes: 'Server-only; affects presence derivation.',
  },
  {
    field: 'bonds, gifts, social receipts, discoveries, dialogue unlocks',
    scope: 'player_private',
    persistence: 'player_save',
    replication: 'unicast_player',
    notes: 'progression_update with seq; never in world_state.',
  },
  {
    field: 'world knowledge revelations',
    scope: 'world_shared',
    persistence: 'world_file',
    replication: 'never',
    notes: 'Shared knowledge store; personal copies still player_private.',
  },
  {
    field: 'conversationLocks / in-flight social ops',
    scope: 'transient_session',
    persistence: 'memory',
    replication: 'never',
    notes: 'Released on leave/TTL; exclusive policy only.',
  },
  {
    field: 'encounter open_ui / People dossier patches',
    scope: 'derived',
    persistence: 'none',
    replication: 'unicast_player',
    notes: 'Rebuilt from progression + definition; no affinity numbers.',
  },
  {
    field: 'shop stock (per-player restock)',
    scope: 'player_private',
    persistence: 'player_save',
    replication: 'unicast_player',
    notes: 'Existing shopSystem restock on progression.',
  },
] as const;

export function ownershipForField(field: string): NpcOwnershipRow | undefined {
  return NPC_STATE_OWNERSHIP.find((row) => row.field === field || row.field.includes(field));
}
