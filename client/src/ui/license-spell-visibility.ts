import {
  licenseUnlocksSpell,
  meetsSpellLicenseGate,
  type PlayerProgression,
} from '@witchcraft/shared';

/** Licensure workings stay out of menus until the player holds that credential. */
export function isLicenseSpellHidden(
  spell: { id: string; requiresLicense?: string; requiresAnyLicense?: string[] } | null | undefined,
  progression: PlayerProgression
): boolean {
  if (!spell) return false;
  const credentialed = Boolean(spell.requiresLicense || spell.requiresAnyLicense?.length);
  if (credentialed && !meetsSpellLicenseGate(spell, progression)) return true;
  return !licenseUnlocksSpell(spell.id, progression);
}
