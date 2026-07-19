import type { InventorySlot } from '../types/index.js';
import { INVENTORY_MAX_SLOTS, MAX_ITEM_STACK } from '../constants/index.js';

export const TAGLOCK_ITEM_IDS = [
  'taglock_hair',
  'taglock_blood',
  'taglock_written_name',
  'taglock_personal_item',
] as const;

export type TaglockItemId = (typeof TAGLOCK_ITEM_IDS)[number];

export const MAX_TAGLOCKS_PER_TARGET = 3;

export const EMPTY_INVENTORY_SLOT: InventorySlot = { itemId: '', quantity: 0 };

export function isTaglockItemId(itemId: string): itemId is TaglockItemId {
  return (TAGLOCK_ITEM_IDS as readonly string[]).includes(itemId);
}

export function isEmptyInventorySlot(slot: InventorySlot | null | undefined): boolean {
  const coerced = coerceInventorySlot(slot);
  return !coerced.itemId || coerced.quantity <= 0;
}

function readNumeric(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function readSlotIndex(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : -1;
  }
  return -1;
}

export function sanitizeInventoryMetadata(
  metadata: Record<string, unknown> | null | undefined
): InventorySlot['metadata'] | undefined {
  if (!metadata) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined) continue;
    if (typeof value === 'bigint') out[key] = Number(value);
    else out[key] = value;
  }
  return Object.keys(out).length ? (out as InventorySlot['metadata']) : undefined;
}

/** Coerce unknown / DB / Colyseus values into a safe inventory slot shape. */
export function coerceInventorySlot(slot: InventorySlot | null | undefined): InventorySlot {
  if (!slot) return { ...EMPTY_INVENTORY_SLOT };
  const itemId = typeof slot.itemId === 'string' ? slot.itemId : '';
  const quantity = readNumeric(slot.quantity);
  const metadata = sanitizeInventoryMetadata(slot.metadata as Record<string, unknown> | undefined);
  if (!itemId || quantity <= 0) return { ...EMPTY_INVENTORY_SLOT };
  return { itemId, quantity, metadata };
}

/** JSON-safe inventory for Colyseus schema storage (strips BigInt, normalizes layout). */
export function serializeInventoryForSchema(slots: InventorySlot[] | null | undefined): InventorySlot[] {
  return normalizeInventoryLayout(slots).map((slot) => {
    const coerced = coerceInventorySlot(slot);
    if (isEmptyInventorySlot(coerced)) return { ...EMPTY_INVENTORY_SLOT };
    return coerced;
  });
}

function hasMergeBlockingMetadata(slot: InventorySlot): boolean {
  if (isTaglockItemId(slot.itemId)) return true;
  const meta = slot.metadata;
  if (!meta) return false;
  return Object.keys(meta).some((key) => key !== 'slotIndex');
}

function isInventoryGrid(items: InventorySlot[]): boolean {
  if (items.length !== INVENTORY_MAX_SLOTS) return false;
  return items.every((slot) => slot != null && typeof slot.itemId === 'string');
}

/** Merge duplicate non-taglock stacks (fixes legacy duplicate DB rows). */
export function coalesceInventoryStacks(slots: InventorySlot[]): InventorySlot[] {
  const normalized = normalizeInventoryLayout(slots).map(coerceInventorySlot);
  const result = normalizeInventoryLayout([]);

  for (const slot of normalized) {
    if (isEmptyInventorySlot(slot)) continue;

    if (hasMergeBlockingMetadata(slot)) {
      const emptyIdx = findFirstEmptySlotIndex(result);
      if (emptyIdx < 0) break;
      result[emptyIdx] = { ...slot };
      continue;
    }

    let remaining = slot.quantity;
    for (const existing of result) {
      if (remaining <= 0) break;
      if (canMergeInventorySlots(existing, { itemId: slot.itemId, quantity: 1 })) {
        const add = Math.min(MAX_ITEM_STACK - existing.quantity, remaining);
        existing.quantity += add;
        remaining -= add;
      }
    }

    while (remaining > 0) {
      const emptyIdx = findFirstEmptySlotIndex(result);
      if (emptyIdx < 0) break;
      const add = Math.min(MAX_ITEM_STACK, remaining);
      result[emptyIdx] = { itemId: slot.itemId, quantity: add };
      remaining -= add;
    }
  }

  return result;
}

export function getTaglockTargetName(slot: InventorySlot): string | undefined {
  const meta = slot.metadata;
  if (!meta) return undefined;
  const name = meta.targetName ?? meta.sourceName;
  if (typeof name !== 'string') return undefined;
  const trimmed = name.trim();
  return trimmed || undefined;
}

export function slotIdentityKey(slot: InventorySlot): string {
  if (isEmptyInventorySlot(slot)) return '';
  const target = getTaglockTargetName(slot);
  if (target) return `${slot.itemId}::${target.toLowerCase()}`;
  return slot.metadata ? `${slot.itemId}::${JSON.stringify(slot.metadata)}` : slot.itemId;
}

export function canMergeInventorySlots(a: InventorySlot, b: InventorySlot): boolean {
  if (isEmptyInventorySlot(a) || isEmptyInventorySlot(b)) return false;
  if (a.itemId !== b.itemId) return false;
  if (isTaglockItemId(a.itemId)) {
    const ta = getTaglockTargetName(a);
    const tb = getTaglockTargetName(b);
    if (!ta || !tb) return false;
    return ta.toLowerCase() === tb.toLowerCase();
  }
  if (a.metadata || b.metadata) return slotIdentityKey(a) === slotIdentityKey(b);
  return true;
}

export function countTaglocksForTarget(slots: InventorySlot[], targetName: string): number {
  const key = targetName.trim().toLowerCase();
  if (!key) return 0;
  return slots.filter((s) => !isEmptyInventorySlot(s) && isTaglockItemId(s.itemId) && getTaglockTargetName(s)?.toLowerCase() === key)
    .reduce((n, s) => n + s.quantity, 0);
}

export function totalItemQuantity(slots: InventorySlot[], itemId: string): number {
  return slots
    .filter((s) => !isEmptyInventorySlot(s) && s.itemId === itemId)
    .reduce((n, s) => n + s.quantity, 0);
}

export function normalizeInventoryLayout(slots: InventorySlot[] | null | undefined): InventorySlot[] {
  const input = slots ?? [];
  if (input.length === INVENTORY_MAX_SLOTS) {
    return input.map((slot) => {
      const coerced = coerceInventorySlot(slot);
      if (isEmptyInventorySlot(coerced)) return { ...EMPTY_INVENTORY_SLOT };
      return coerced;
    });
  }

  const grid: InventorySlot[] = [];
  for (const slot of input) {
    if (grid.length >= INVENTORY_MAX_SLOTS) break;
    const coerced = coerceInventorySlot(slot);
    if (isEmptyInventorySlot(coerced)) {
      grid.push({ ...EMPTY_INVENTORY_SLOT });
    } else {
      grid.push(coerced);
    }
  }
  while (grid.length < INVENTORY_MAX_SLOTS) {
    grid.push({ ...EMPTY_INVENTORY_SLOT });
  }
  return grid;
}

/** Convert legacy stacked list into a fixed slot grid (preserves order). */
export function migrateInventoryToGrid(items: InventorySlot[]): InventorySlot[] {
  const coerced = items.map(coerceInventorySlot);
  if (isInventoryGrid(coerced)) {
    return coalesceInventoryStacks(coerced);
  }

  const grid = normalizeInventoryLayout([]);
  let write = 0;

  for (const item of coerced) {
    if (isEmptyInventorySlot(item)) continue;

    if (isTaglockItemId(item.itemId)) {
      const meta = item.metadata ? { ...item.metadata } : undefined;
      const copies = Math.max(1, item.quantity);
      for (let i = 0; i < copies; i++) {
        if (write >= INVENTORY_MAX_SLOTS) return coalesceInventoryStacks(grid);
        grid[write++] = { itemId: item.itemId, quantity: 1, metadata: meta ? { ...meta } : undefined };
      }
      continue;
    }

    let remaining = item.quantity;
    while (remaining > 0 && write < INVENTORY_MAX_SLOTS) {
      const add = Math.min(MAX_ITEM_STACK, remaining);
      grid[write++] = {
        itemId: item.itemId,
        quantity: add,
        metadata: item.metadata ? { ...item.metadata } : undefined,
      };
      remaining -= add;
    }
  }

  return coalesceInventoryStacks(grid);
}

export function inventorySlotCount(slots: InventorySlot[]): number {
  return slots.filter((s) => !isEmptyInventorySlot(s)).length;
}

export function findFirstEmptySlotIndex(slots: InventorySlot[]): number {
  return slots.findIndex(isEmptyInventorySlot);
}

export function inventoryContentsFingerprint(slots: InventorySlot[]): string {
  return normalizeInventoryLayout(slots)
    .filter((s) => !isEmptyInventorySlot(s))
    .map((s) => `${slotIdentityKey(s)}x${s.quantity}`)
    .sort()
    .join('|');
}

export function isInventoryReorderValid(before: InventorySlot[], after: InventorySlot[]): boolean {
  return inventoryContentsFingerprint(before) === inventoryContentsFingerprint(after);
}

export function addItemToInventory(
  inventory: InventorySlot[],
  itemId: string,
  quantity: number,
  metadata?: InventorySlot['metadata']
): InventorySlot[] {
  const grid = normalizeInventoryLayout(inventory);
  if (quantity <= 0) return grid;

  if (isTaglockItemId(itemId)) {
    const target = getTaglockTargetName({ itemId, quantity: 1, metadata });
    if (target && countTaglocksForTarget(grid, target) >= MAX_TAGLOCKS_PER_TARGET) {
      return grid;
    }
    let remaining = quantity;
    while (remaining > 0) {
      const emptyIdx = findFirstEmptySlotIndex(grid);
      if (emptyIdx < 0) break;
      grid[emptyIdx] = {
        itemId,
        quantity: 1,
        metadata: metadata ? { ...metadata } : undefined,
      };
      remaining -= 1;
    }
    return grid;
  }

  let remaining = quantity;
  if (metadata) {
    while (remaining > 0) {
      const emptyIdx = findFirstEmptySlotIndex(grid);
      if (emptyIdx < 0) break;
      const add = Math.min(MAX_ITEM_STACK, remaining);
      grid[emptyIdx] = { itemId, quantity: add, metadata: { ...metadata } };
      remaining -= add;
    }
    return grid;
  }

  for (const slot of grid) {
    if (remaining <= 0) break;
    if (canMergeInventorySlots(slot, { itemId, quantity: 1 }) && !slot.metadata) {
      const space = MAX_ITEM_STACK - slot.quantity;
      const add = Math.min(space, remaining);
      slot.quantity += add;
      remaining -= add;
    }
  }

  while (remaining > 0) {
    const emptyIdx = findFirstEmptySlotIndex(grid);
    if (emptyIdx < 0) break;
    const add = Math.min(MAX_ITEM_STACK, remaining);
    grid[emptyIdx] = { itemId, quantity: add };
    remaining -= add;
  }

  return grid;
}

export function removeItemFromInventory(
  inventory: InventorySlot[],
  itemId: string,
  quantity: number
): { inventory: InventorySlot[]; ok: boolean } {
  const grid = normalizeInventoryLayout(inventory);
  let remaining = quantity;
  let available = totalItemQuantity(grid, itemId);
  if (available < quantity) return { inventory: grid, ok: false };

  for (let i = grid.length - 1; i >= 0 && remaining > 0; i--) {
    const slot = grid[i];
    if (isEmptyInventorySlot(slot) || slot.itemId !== itemId) continue;
    const take = Math.min(slot.quantity, remaining);
    slot.quantity -= take;
    remaining -= take;
    if (slot.quantity <= 0) grid[i] = { ...EMPTY_INVENTORY_SLOT };
  }

  return { inventory: grid, ok: true };
}

export function hasItemInInventory(inventory: InventorySlot[], itemId: string, quantity: number): boolean {
  return totalItemQuantity(normalizeInventoryLayout(inventory), itemId) >= quantity;
}

export function inscribeWrittenTaglock(
  inventory: InventorySlot[],
  slotIndex: number,
  targetName: string
): { inventory: InventorySlot[]; ok: boolean; error?: string } {
  const grid = normalizeInventoryLayout(inventory);
  if (slotIndex < 0 || slotIndex >= INVENTORY_MAX_SLOTS) {
    return { inventory: grid, ok: false, error: 'Invalid slot.' };
  }

  const slot = grid[slotIndex];
  if (isEmptyInventorySlot(slot) || slot.itemId !== 'taglock_written_name') {
    return { inventory: grid, ok: false, error: 'Not a written name taglock.' };
  }

  if (getTaglockTargetName(slot)) {
    return { inventory: grid, ok: false, error: 'This taglock is already inscribed and cannot be changed.' };
  }

  const name = targetName.trim();
  if (!name) return { inventory: grid, ok: false, error: 'Enter a target name.' };
  if (countTaglocksForTarget(grid, name) >= MAX_TAGLOCKS_PER_TARGET) {
    return { inventory: grid, ok: false, error: `You already have ${MAX_TAGLOCKS_PER_TARGET} taglocks for ${name}.` };
  }

  grid[slotIndex] = {
    ...slot,
    quantity: 1,
    metadata: { ...(slot.metadata ?? {}), targetName: name, inscribedAt: Date.now() },
  };

  return { inventory: grid, ok: true };
}

export function stripSlotIndexMetadata(slots: InventorySlot[]): InventorySlot[] {
  return slots.map((slot) => {
    if (isEmptyInventorySlot(slot) || !slot.metadata?.slotIndex) return slot;
    const { slotIndex: _removed, ...rest } = slot.metadata as Record<string, unknown> & { slotIndex?: number };
    const metadata = Object.keys(rest).length ? (rest as InventorySlot['metadata']) : undefined;
    return { ...slot, metadata };
  });
}

export function applySlotIndicesForSave(slots: InventorySlot[]): InventorySlot[] {
  return normalizeInventoryLayout(slots).map((slot, slotIndex) => {
    if (isEmptyInventorySlot(slot)) return slot;
    return {
      ...slot,
      metadata: { ...(slot.metadata ?? {}), slotIndex },
    };
  });
}

export function loadInventoryFromDbRows(
  rows: { itemId: string; quantity: number; metadata?: Record<string, unknown> | null }[]
): InventorySlot[] {
  const sorted = [...rows].sort((a, b) => {
    const ai = readSlotIndex(a.metadata?.slotIndex);
    const bi = readSlotIndex(b.metadata?.slotIndex);
    return (ai >= 0 ? ai : 9999) - (bi >= 0 ? bi : 9999);
  });

  const grid = normalizeInventoryLayout([]);
  let fallback = 0;

  for (const row of sorted) {
    let idx = readSlotIndex(row.metadata?.slotIndex);
    if (idx < 0 || idx >= INVENTORY_MAX_SLOTS || !isEmptyInventorySlot(grid[idx])) {
      while (fallback < INVENTORY_MAX_SLOTS && !isEmptyInventorySlot(grid[fallback])) fallback++;
      idx = fallback;
    }
    if (idx >= INVENTORY_MAX_SLOTS) break;

    const meta = sanitizeInventoryMetadata(row.metadata ?? undefined);
    if (meta && 'slotIndex' in meta) delete (meta as Record<string, unknown>).slotIndex;

    grid[idx] = coerceInventorySlot({
      itemId: row.itemId,
      quantity: row.quantity,
      metadata: meta,
    });
    fallback = idx + 1;
  }

  return coalesceInventoryStacks(grid);
}
