/** Granular admin permissions — assign to roles, never hard-code role checks */
export const PERMISSIONS = {
  // Dashboard
  'dashboard.view': 'View admin dashboard and server stats',

  // Players
  'player.view': 'View player profiles',
  'player.edit': 'Edit player stats and inventory',
  'player.teleport': 'Teleport players',
  'player.heal': 'Heal or revive players',
  'player.kill': 'Kill players (development)',
  'player.moderate': 'Warn, mute, suspend, ban',
  'player.rollback': 'Rollback inventory or apartment',
  'player.hidden': 'View hidden data (true names, etc.)',

  // Content
  'content.spell.view': 'View spells',
  'content.spell.edit': 'Create and edit spells',
  'content.spell.publish': 'Publish spells to live game',
  'content.item.view': 'View items/ingredients',
  'content.item.edit': 'Edit items',
  'content.npc.view': 'View NPCs',
  'content.npc.edit': 'Edit NPCs and dialogue',
  'content.map.view': 'View maps',
  'content.map.edit': 'Edit maps and environment',
  'content.map.publish': 'Publish and unpublish maps',
  'content.map.preview': 'Invite players to preview draft maps',
  'content.map.ward.unbreakable': 'Create unbreakable admin wards on maps',
  'content.hud.view': 'View player HUD layouts',
  'content.hud.edit': 'Edit player HUD layouts',
  'content.hud.publish': 'Publish player HUD layouts to the live game',
  'content.shop.edit': 'Edit shops',
  'content.ritual.edit': 'Edit rituals',
  'content.spirit.edit': 'Edit spirits',
  'content.familiar.edit': 'Edit familiar templates',
  'content.quest.edit': 'Edit quests',
  'content.event.edit': 'Manage live events',

  // Wards & aura
  'ward.view': 'View all wards',
  'ward.edit': 'Modify or remove wards',
  'aura.view': 'View player auras',
  'aura.edit': 'Modify auras',

  // Economy
  'economy.view': 'View economy data',
  'economy.edit': 'Adjust prices and drop rates',

  // System
  'system.reload': 'Hot-reload content registries',
  'system.debug': 'Use debug overlays and dev commands',
  'system.ingame': 'Use in-game admin console',

  // Audit
  'audit.view': 'View audit logs',
  'audit.export': 'Export audit logs',

  // Admin users
  'admin.user.view': 'View admin accounts',
  'admin.user.edit': 'Manage admin accounts and roles',
} as const;

export type PermissionSlug = keyof typeof PERMISSIONS;

export const ADMIN_ROLES = {
  super_admin: {
    name: 'Super Administrator',
    description: 'Full access to all systems',
    permissions: Object.keys(PERMISSIONS) as PermissionSlug[],
  },
  developer: {
    name: 'Developer',
    description: 'Development tools and content',
    permissions: [
      'dashboard.view', 'player.view', 'player.edit', 'player.heal', 'player.kill',
      'content.spell.view', 'content.spell.edit', 'content.spell.publish',
      'content.item.view', 'content.item.edit', 'content.npc.view', 'content.npc.edit',
      'content.map.view', 'content.map.edit', 'content.map.publish', 'content.map.preview', 'content.map.ward.unbreakable',
      'content.hud.view', 'content.hud.edit', 'content.hud.publish',
      'content.shop.edit', 'content.ritual.edit',
      'content.spirit.edit', 'content.familiar.edit', 'content.quest.edit',
      'ward.view', 'ward.edit', 'aura.view', 'aura.edit',
      'system.reload', 'system.debug', 'system.ingame', 'audit.view',
    ] as PermissionSlug[],
  },
  game_master: {
    name: 'Game Master',
    description: 'Player management and live events',
    permissions: [
      'dashboard.view', 'player.view', 'player.edit', 'player.teleport', 'player.heal',
      'player.moderate', 'player.hidden', 'aura.view', 'aura.edit', 'ward.view', 'ward.edit',
      'content.event.edit', 'system.ingame', 'audit.view',
    ] as PermissionSlug[],
  },
  moderator: {
    name: 'Moderator',
    description: 'Player moderation',
    permissions: [
      'dashboard.view', 'player.view', 'player.moderate', 'audit.view',
    ] as PermissionSlug[],
  },
  content_designer: {
    name: 'Content Designer',
    description: 'Spells, items, NPCs',
    permissions: [
      'dashboard.view', 'content.spell.view', 'content.spell.edit',
      'content.item.view', 'content.item.edit', 'content.npc.view', 'content.npc.edit',
      'content.quest.edit', 'audit.view',
    ] as PermissionSlug[],
  },
  world_builder: {
    name: 'World Builder',
    description: 'Maps and environment',
    permissions: [
      'dashboard.view', 'content.map.view', 'content.map.edit', 'content.map.publish', 'content.map.preview',
      'content.map.ward.unbreakable', 'content.hud.view', 'content.hud.edit', 'content.hud.publish',
      'content.shop.edit', 'audit.view',
    ] as PermissionSlug[],
  },
  economy_manager: {
    name: 'Economy Manager',
    description: 'Prices and economy',
    permissions: ['dashboard.view', 'economy.view', 'economy.edit', 'content.shop.edit', 'audit.view'] as PermissionSlug[],
  },
  event_manager: {
    name: 'Event Manager',
    description: 'Live server events',
    permissions: ['dashboard.view', 'content.event.edit', 'audit.view'] as PermissionSlug[],
  },
  auditor: {
    name: 'Read-Only Auditor',
    description: 'View-only access',
    permissions: [
      'dashboard.view', 'player.view', 'audit.view', 'audit.export',
      'content.spell.view', 'content.item.view', 'ward.view', 'aura.view',
    ] as PermissionSlug[],
  },
} as const;

export interface AdminSession {
  userId: string;
  username: string;
  displayName: string;
  permissions: PermissionSlug[];
  roles: string[];
}

export interface AuditLogEntry {
  action: string;
  objectType: string;
  objectId?: string;
  previousValue?: unknown;
  newValue?: unknown;
  reason?: string;
}

export interface AdminCommandResult {
  success: boolean;
  message: string;
  data?: unknown;
}
