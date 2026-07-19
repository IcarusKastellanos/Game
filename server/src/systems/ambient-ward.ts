export {
  AMBIENT_WARD_SPELL_ID,
  AMBIENT_WARD_PROTECTION_ID,
  applyAmbientAuraProtection,
  applyAmbientFamiliarProtection,
  computeWardWebCrossLink,
} from '@witchcraft/shared';
import type { WardState } from '@witchcraft/shared';

/** Session id of the apartment whose perimeter wards apply (self when empty). */
export function resolveApartmentHostSessionId(
  occupantSessionId: string,
  apartmentHostSessionId?: string
): string {
  if (apartmentHostSessionId && apartmentHostSessionId !== occupantSessionId) {
    return apartmentHostSessionId;
  }
  return occupantSessionId;
}

/** Perimeter wards for anyone inside an apartment (owner, visitor, or familiar's witch). */
export function resolveAmbientApartmentWards(
  occupantSessionId: string,
  occupantScene: string,
  apartmentHostSessionId: string | undefined,
  activeWards: Map<string, WardState[]>
): WardState[] {
  if (occupantScene !== 'apartment') return [];
  const hostId = resolveApartmentHostSessionId(occupantSessionId, apartmentHostSessionId);
  return (activeWards.get(hostId) ?? []).filter((w) => w.strength > 0);
}
