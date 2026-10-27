import type {
  ContentNpc,
  NpcPlace,
  NpcScheduleEntry,
  NpcScheduleInteraction,
  NpcScheduleMovement,
  NpcScheduleOverride,
} from '../types/index.js';

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
const INTERACTIONS = new Set<NpcScheduleInteraction>(['open', 'busy', 'away']);
const MOVEMENTS = new Set<NpcScheduleMovement>(['still', 'pace']);

/** Milliseconds spent crossing one tile. One walk is published, not every frame. */
export const NPC_WALK_MS_PER_TILE = 400;

export interface NpcTile {
  x: number;
  y: number;
}

/** Public presence. Relationship, gift, and reputation fields are never included. */
export interface NpcPublicPresence {
  npcId: string;
  scene: string;
  tile: NpcTile | null;
  location: string;
  activity?: string;
  interaction: NpcScheduleInteraction;
  visible: boolean;
  indoors: boolean;
  held: boolean;
  moving: boolean;
  from?: NpcTile;
  to?: NpcTile;
  moveStart?: number;
  moveEnd?: number;
  interactableId?: string;
  dialogueNodeId?: string;
  notice?: string;
}

export interface NpcMapBounds {
  sceneId: string;
  width: number;
  height: number;
}

export interface NpcResolveInput {
  npc: Pick<ContentNpc, 'id' | 'name' | 'schedule'> & { scheduleOverride?: NpcScheduleOverride };
  places: readonly NpcPlace[];
  maps: readonly NpcMapBounds[];
  hour: number;
  weekday: number;
  nowMs: number;
  previous?: NpcPublicPresence | null;
  /** Absent while the world has no season. A named season then never matches. */
  season?: string | null;
  /** Keys are `${sceneId}:${x},${y}` for tiles the caller reports as blocked. */
  blocked?: ReadonlySet<string>;
}

export interface NpcPostRef {
  id: string;
  type: string;
  x: number;
  y: number;
  npcId?: string;
}

type ScheduleParse =
  | { ok: true; schedule: NpcScheduleEntry[]; scheduleOverride?: NpcScheduleOverride }
  | { ok: false; error: string };

export function parseNpcSchedule(
  scheduleValue: unknown,
  overrideValue: unknown,
  placeIds?: readonly string[]
): ScheduleParse {
  if (!Array.isArray(scheduleValue)) return { ok: false, error: 'Schedule must be a list.' };
  const known = placeIds ? new Set(placeIds) : null;
  const schedule: NpcScheduleEntry[] = [];
  for (const entry of scheduleValue) {
    const parsed = parseEntry(entry, known);
    if (!parsed.ok) return parsed;
    schedule.push(parsed.entry);
  }
  const overlap = overlappingWindowError(schedule);
  if (overlap) return { ok: false, error: overlap };
  if (overrideValue == null) return { ok: true, schedule };
  const override = parseOverride(overrideValue, known);
  if (!override.ok) return override;
  return { ok: true, schedule, scheduleOverride: override.override };
}

export function resolveNpcPresence(input: NpcResolveInput): NpcPublicPresence {
  const activity = selectActivity(input.npc, input.hour, input.weekday, input.season);
  if (!activity) return absentPresence(input.npc.id);
  const place = input.places.find((entry) => entry.id === activity.locationId) ?? null;
  const problem = destinationProblem(place, input.maps, input.blocked);
  if (problem || !place) return heldPresence(input, activity.locationId, place);
  if (place.indoors || place.x == null || place.y == null) {
    return finishPresence(input.npc, activity, place, null, false);
  }
  const destination = { x: place.x, y: place.y };
  const previous = input.previous ?? null;
  if (previous && continuingWalk(previous, place, destination)) {
    if (input.nowMs >= (previous.moveEnd as number)) {
      return finishPresence(input.npc, activity, place, destination, false);
    }
    return movingPresence(input.npc, activity, place, previous, input.nowMs);
  }
  if (previous && canWalk(previous, place) && previous.tile && !sameTile(previous.tile, destination)) {
    const from = { x: previous.tile.x, y: previous.tile.y };
    const duration = walkDurationMs(from, destination);
    const started: NpcPublicPresence = {
      npcId: input.npc.id,
      scene: place.sceneId,
      tile: from,
      location: place.id,
      interaction: 'away',
      visible: true,
      indoors: false,
      held: false,
      moving: true,
      from,
      to: destination,
      moveStart: input.nowMs,
      moveEnd: input.nowMs + duration,
      ...(activity.activity ? { activity: activity.activity } : {}),
      ...(place.interactableId ? { interactableId: place.interactableId } : {}),
      ...(activity.dialogueNodeId ? { dialogueNodeId: activity.dialogueNodeId } : {}),
    };
    return movingPresence(input.npc, activity, place, started, input.nowMs);
  }
  return finishPresence(input.npc, activity, place, destination, false);
}

/** Tile at `nowMs`. Clients interpolate from the published from/to timestamps. */
export function npcPresenceTile(presence: NpcPublicPresence, nowMs: number): NpcTile | null {
  if (
    presence.moving &&
    presence.from &&
    presence.to &&
    typeof presence.moveStart === 'number' &&
    typeof presence.moveEnd === 'number'
  ) {
    const span = presence.moveEnd - presence.moveStart;
    const t = span <= 0 ? 1 : Math.min(1, Math.max(0, (nowMs - presence.moveStart) / span));
    return {
      x: presence.from.x + (presence.to.x - presence.from.x) * t,
      y: presence.from.y + (presence.to.y - presence.from.y) * t,
    };
  }
  return presence.tile ? { x: presence.tile.x, y: presence.tile.y } : null;
}

/** NPC posts hide when that NPC is not standing on the interactable. Shops are not posts. */
export function hiddenNpcPostIds(
  presences: readonly NpcPublicPresence[],
  posts: readonly NpcPostRef[]
): string[] {
  const byNpc = new Map(presences.map((presence) => [presence.npcId, presence]));
  const hidden: string[] = [];
  for (const post of posts) {
    if (post.type !== 'npc' || !post.npcId) continue;
    const presence = byNpc.get(post.npcId);
    if (!presence || !standingOnPost(presence, post)) hidden.push(post.id);
  }
  return hidden;
}

interface SelectedActivity {
  locationId: string;
  activity?: string;
  interaction?: NpcScheduleInteraction;
  dialogueNodeId?: string;
  label?: string;
}

function selectActivity(
  npc: NpcResolveInput['npc'],
  hour: number,
  weekday: number,
  season: string | null | undefined
): SelectedActivity | null {
  const override = npc.scheduleOverride;
  if (override?.active) {
    return {
      locationId: override.locationId,
      ...(override.activity ? { activity: override.activity } : {}),
      ...(override.interaction ? { interaction: override.interaction } : {}),
      ...(override.dialogueNodeId ? { dialogueNodeId: override.dialogueNodeId } : {}),
    };
  }
  const timeline = timelineEntries(npc.schedule ?? [], season);
  for (let index = 0; index < timeline.length; index += 1) {
    const entry = timeline[index];
    const window = effectiveWindow(entry, index, timeline);
    if (!windowCovers(entry, window, hour, weekday)) continue;
    return {
      locationId: entry.locationId,
      ...(entry.activity ? { activity: entry.activity } : {}),
      ...(entry.interaction ? { interaction: entry.interaction } : {}),
      ...(entry.dialogueNodeId ? { dialogueNodeId: entry.dialogueNodeId } : {}),
      ...(entry.label ? { label: entry.label } : {}),
    };
  }
  return null;
}

function finishPresence(
  npc: NpcResolveInput['npc'],
  activity: SelectedActivity,
  place: NpcPlace,
  tile: NpcTile | null,
  moving: boolean
): NpcPublicPresence {
  const indoors = place.indoors === true || tile == null;
  const interaction = indoors || moving ? 'away' : activity.interaction ?? 'open';
  return {
    npcId: npc.id,
    scene: place.sceneId,
    tile: indoors ? null : tile,
    location: place.id,
    interaction,
    visible: !indoors && !moving ? true : !indoors,
    indoors,
    held: false,
    moving,
    ...(activity.activity ? { activity: activity.activity } : {}),
    ...(interaction === 'busy' ? { notice: activityNotice(npc.name, activity) } : {}),
    ...(place.interactableId ? { interactableId: place.interactableId } : {}),
    ...(activity.dialogueNodeId ? { dialogueNodeId: activity.dialogueNodeId } : {}),
  };
}

function movingPresence(
  npc: NpcResolveInput['npc'],
  activity: SelectedActivity,
  place: NpcPlace,
  walk: NpcPublicPresence,
  nowMs: number
): NpcPublicPresence {
  const tile = npcPresenceTile(walk, nowMs) ?? walk.from ?? null;
  return {
    npcId: npc.id,
    scene: place.sceneId,
    tile,
    location: place.id,
    interaction: 'away',
    visible: true,
    indoors: false,
    held: false,
    moving: true,
    from: walk.from,
    to: walk.to,
    moveStart: walk.moveStart,
    moveEnd: walk.moveEnd,
    ...(activity.activity ? { activity: activity.activity } : {}),
    ...(place.interactableId ? { interactableId: place.interactableId } : {}),
    ...(activity.dialogueNodeId ? { dialogueNodeId: activity.dialogueNodeId } : {}),
  };
}

function heldPresence(
  input: NpcResolveInput,
  locationId: string,
  place: NpcPlace | null
): NpcPublicPresence {
  const previous = input.previous;
  const stay =
    previous?.tile && previous.visible && !previous.indoors
      ? { scene: previous.scene, tile: { x: previous.tile.x, y: previous.tile.y } }
      : null;
  return {
    npcId: input.npc.id,
    scene: stay?.scene ?? place?.sceneId ?? '',
    tile: stay?.tile ?? null,
    location: stay ? previous?.location || locationId : locationId,
    interaction: 'away',
    visible: !!stay,
    indoors: false,
    held: true,
    moving: false,
    ...(place?.interactableId && !stay ? { interactableId: place.interactableId } : {}),
    notice: stay ? `${input.npc.name} is stopped here.` : `${input.npc.name} is away.`,
  };
}

function absentPresence(npcId: string): NpcPublicPresence {
  return {
    npcId,
    scene: '',
    tile: null,
    location: '',
    interaction: 'away',
    visible: false,
    indoors: false,
    held: false,
    moving: false,
  };
}

function activityNotice(name: string, activity: SelectedActivity): string {
  if (activity.label) return activity.label;
  if (activity.activity) return `${name} is ${activity.activity}.`;
  return `${name} is busy.`;
}

function continuingWalk(previous: NpcPublicPresence, place: NpcPlace, destination: NpcTile): boolean {
  return !!(
    previous.moving &&
    previous.from &&
    previous.to &&
    typeof previous.moveStart === 'number' &&
    typeof previous.moveEnd === 'number' &&
    previous.scene === place.sceneId &&
    previous.location === place.id &&
    sameTile(previous.to, destination)
  );
}

function canWalk(previous: NpcPublicPresence, place: NpcPlace): boolean {
  return !!(previous.tile && previous.visible && !previous.indoors && previous.scene === place.sceneId && !place.indoors);
}

function destinationProblem(
  place: NpcPlace | null,
  maps: readonly NpcMapBounds[],
  blocked: ReadonlySet<string> | undefined
): 'missing' | 'bounds' | 'blocked' | null {
  if (!place) return 'missing';
  if (place.indoors) return null;
  if (place.x == null || place.y == null || !Number.isInteger(place.x) || !Number.isInteger(place.y)) {
    return 'missing';
  }
  const map = maps.find((entry) => entry.sceneId === place.sceneId);
  if (!map || place.x < 0 || place.y < 0 || place.x >= map.width || place.y >= map.height) return 'bounds';
  if (blocked?.has(`${place.sceneId}:${place.x},${place.y}`)) return 'blocked';
  return null;
}

function standingOnPost(presence: NpcPublicPresence, post: NpcPostRef): boolean {
  if (!presence.visible || presence.indoors || presence.moving || presence.held || !presence.tile) return false;
  if (presence.interactableId !== post.id) return false;
  return Math.abs(presence.tile.x - post.x) < 0.51 && Math.abs(presence.tile.y - post.y) < 0.51;
}

function sameTile(a: NpcTile, b: NpcTile): boolean {
  return Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001;
}

function walkDurationMs(from: NpcTile, to: NpcTile): number {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  if (distance < 0.001) return 0;
  return Math.max(NPC_WALK_MS_PER_TILE, Math.round(distance * NPC_WALK_MS_PER_TILE));
}

function timelineEntries(schedule: readonly NpcScheduleEntry[], season: string | null | undefined): NpcScheduleEntry[] {
  return schedule
    .filter((entry) => entryInSeason(entry, season))
    .slice()
    .sort((a, b) => a.hour - b.hour);
}

function entryInSeason(entry: NpcScheduleEntry, season: string | null | undefined): boolean {
  if (!entry.season) return true;
  if (!season) return false;
  return entry.season === season;
}

interface HourWindow {
  end: number;
  fullDay: boolean;
}

function effectiveWindow(entry: NpcScheduleEntry, index: number, ordered: readonly NpcScheduleEntry[]): HourWindow {
  if (typeof entry.endHour === 'number') return { end: entry.endHour, fullDay: false };
  if (ordered.length <= 1) return { end: entry.hour, fullDay: true };
  return { end: ordered[(index + 1) % ordered.length].hour, fullDay: false };
}

function windowCovers(entry: NpcScheduleEntry, window: HourWindow, hour: number, weekday: number): boolean {
  const days = new Set(entry.days ?? WEEKDAYS);
  if (window.fullDay) return days.has(weekday);
  if (window.end > entry.hour) return days.has(weekday) && hour >= entry.hour && hour < window.end;
  if (window.end === entry.hour) return false;
  if (hour >= entry.hour && days.has(weekday)) return true;
  return hour < window.end && days.has((weekday + 6) % 7);
}

function overlappingWindowError(schedule: readonly NpcScheduleEntry[]): string | null {
  const timeline = timelineEntries(schedule, null);
  const spans: { day: number; start: number; end: number; index: number }[] = [];
  for (let index = 0; index < timeline.length; index += 1) {
    const entry = timeline[index];
    const window = effectiveWindow(entry, index, timeline);
    spans.push(...spansFor(entry, window, index));
  }
  for (let i = 0; i < spans.length; i += 1) {
    for (let j = i + 1; j < spans.length; j += 1) {
      const a = spans[i];
      const b = spans[j];
      if (a.index === b.index || a.day !== b.day) continue;
      if (a.start < b.end && b.start < a.end) return 'Schedule windows overlap.';
    }
  }
  return null;
}

function spansFor(
  entry: NpcScheduleEntry,
  window: HourWindow,
  index: number
): { day: number; start: number; end: number; index: number }[] {
  const days = entry.days ?? [...WEEKDAYS];
  const spans: { day: number; start: number; end: number; index: number }[] = [];
  if (window.fullDay) {
    for (const day of days) spans.push({ day, start: 0, end: 24, index });
    return spans;
  }
  if (window.end > entry.hour) {
    for (const day of days) spans.push({ day, start: entry.hour, end: window.end, index });
    return spans;
  }
  if (window.end === entry.hour) return spans;
  for (const day of days) {
    spans.push({ day, start: entry.hour, end: 24, index });
    if (window.end > 0) spans.push({ day: (day + 1) % 7, start: 0, end: window.end, index });
  }
  return spans;
}

function parseEntry(
  value: unknown,
  known: Set<string> | null
): { ok: true; entry: NpcScheduleEntry } | { ok: false; error: string } {
  if (!value || typeof value !== 'object') return { ok: false, error: 'Each schedule entry must be an object.' };
  const row = value as Record<string, unknown>;
  if (!Number.isInteger(row.hour) || (row.hour as number) < 0 || (row.hour as number) > 23) {
    return { ok: false, error: 'Each schedule entry needs an hour from 0 through 23.' };
  }
  if (typeof row.locationId !== 'string' || !row.locationId.trim()) {
    return { ok: false, error: 'Each schedule entry needs a locationId.' };
  }
  const locationId = row.locationId.trim();
  if (known && !known.has(locationId)) return { ok: false, error: `Unknown place "${locationId}".` };
  const entry: NpcScheduleEntry = { hour: row.hour as number, locationId };
  if (row.endHour != null) {
    if (!Number.isInteger(row.endHour) || (row.endHour as number) < 0 || (row.endHour as number) > 24) {
      return { ok: false, error: 'Schedule endHour must be an hour from 0 through 24.' };
    }
    if (row.endHour === row.hour) return { ok: false, error: 'Schedule endHour must not equal the start hour.' };
    entry.endHour = row.endHour as number;
  }
  const activity = optionalText(row.activity);
  if (activity.error) return { ok: false, error: 'Schedule activity must be text.' };
  if (activity.value) entry.activity = activity.value;
  const label = optionalText(row.label);
  if (label.error) return { ok: false, error: 'Schedule label must be text.' };
  if (label.value) entry.label = label.value;
  const season = optionalText(row.season);
  if (season.error) return { ok: false, error: 'Schedule season must be text.' };
  if (season.value) entry.season = season.value;
  const dialogueNodeId = optionalText(row.dialogueNodeId);
  if (dialogueNodeId.error) return { ok: false, error: 'Schedule dialogueNodeId must be text.' };
  if (dialogueNodeId.value) entry.dialogueNodeId = dialogueNodeId.value;
  if (row.interaction != null) {
    if (typeof row.interaction !== 'string' || !INTERACTIONS.has(row.interaction as NpcScheduleInteraction)) {
      return { ok: false, error: 'Schedule interaction must be open, busy, or away.' };
    }
    entry.interaction = row.interaction as NpcScheduleInteraction;
  }
  if (row.movement != null) {
    if (typeof row.movement !== 'string' || !MOVEMENTS.has(row.movement as NpcScheduleMovement)) {
      return { ok: false, error: 'Schedule movement must be still or pace.' };
    }
    entry.movement = row.movement as NpcScheduleMovement;
  }
  if (row.days != null) {
    const days = parseDays(row.days);
    if (!days.ok) return days;
    entry.days = days.days;
  }
  return { ok: true, entry };
}

function parseOverride(
  value: unknown,
  known: Set<string> | null
): { ok: true; override: NpcScheduleOverride } | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'Schedule override must be an object.' };
  }
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || !row.id.trim()) return { ok: false, error: 'Schedule override needs an id.' };
  if (typeof row.active !== 'boolean') return { ok: false, error: 'Schedule override needs an active flag.' };
  if (typeof row.locationId !== 'string' || !row.locationId.trim()) {
    return { ok: false, error: 'Schedule override needs a locationId.' };
  }
  const locationId = row.locationId.trim();
  if (known && !known.has(locationId)) return { ok: false, error: `Unknown place "${locationId}".` };
  const override: NpcScheduleOverride = { id: row.id.trim(), active: row.active, locationId };
  const activity = optionalText(row.activity);
  if (activity.error) return { ok: false, error: 'Schedule override activity must be text.' };
  if (activity.value) override.activity = activity.value;
  const dialogueNodeId = optionalText(row.dialogueNodeId);
  if (dialogueNodeId.error) return { ok: false, error: 'Schedule override dialogueNodeId must be text.' };
  if (dialogueNodeId.value) override.dialogueNodeId = dialogueNodeId.value;
  if (row.interaction != null) {
    if (typeof row.interaction !== 'string' || !INTERACTIONS.has(row.interaction as NpcScheduleInteraction)) {
      return { ok: false, error: 'Schedule override interaction must be open, busy, or away.' };
    }
    override.interaction = row.interaction as NpcScheduleInteraction;
  }
  if (row.priority != null) {
    if (typeof row.priority !== 'number' || !Number.isFinite(row.priority)) {
      return { ok: false, error: 'Schedule override priority must be a number.' };
    }
    override.priority = row.priority;
  }
  return { ok: true, override };
}

function parseDays(value: unknown): { ok: true; days: number[] } | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: 'Schedule days must list weekdays from 0 (Sunday) through 6.' };
  }
  const days: number[] = [];
  for (const day of value) {
    if (!Number.isInteger(day) || day < 0 || day > 6 || days.includes(day)) {
      return { ok: false, error: 'Schedule days must list weekdays from 0 (Sunday) through 6.' };
    }
    days.push(day);
  }
  return { ok: true, days };
}

function optionalText(value: unknown): { error: true } | { error: false; value?: string } {
  if (value == null) return { error: false };
  if (typeof value !== 'string') return { error: true };
  const trimmed = value.trim();
  return { error: false, ...(trimmed ? { value: trimmed } : {}) };
}
