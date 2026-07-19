/** Exact PNG filenames for the layered Aura visualization. */

export const AURA_ASSET_BASE = '/assets/ui/aura/';

export const AURA_ASSETS = {
  arcaneStarburst: `${AURA_ASSET_BASE}arcane_starburst.png`,
  auraBreachRing: `${AURA_ASSET_BASE}aura_breach_ring.png`,
  authorityCrownNode: `${AURA_ASSET_BASE}authority_crown_node.png`,
  blessingStarburst: `${AURA_ASSET_BASE}blessing_starburst.png`,
  blueAuraBurst: `${AURA_ASSET_BASE}blue_aura_burst.png`,
  blueMagicalMotes: `${AURA_ASSET_BASE}blue_magical_motes.png`,
  chestSoulGlow: `${AURA_ASSET_BASE}chest_soul_glow.png`,
  circularRuneFragments: `${AURA_ASSET_BASE}circular_rune_fragments.png`,
  darkCorruptionCloud: `${AURA_ASSET_BASE}dark_corruption_cloud.png`,
  emptyProtectionNode: `${AURA_ASSET_BASE}empty_protection_node.png`,
  energeticDamageCrack: `${AURA_ASSET_BASE}energetic_damage_crack.png`,
  familiarLinkNode: `${AURA_ASSET_BASE}familiar_link_node.png`,
  floatingRuneCrystal: `${AURA_ASSET_BASE}floating_rune_crystal.png`,
  goldNodeDivider: `${AURA_ASSET_BASE}gold_node_divider.png`,
  hexPatternCloud: `${AURA_ASSET_BASE}hex_pattern_cloud.png`,
  innerAuraRing: `${AURA_ASSET_BASE}inner_aura_ring.png`,
  occultCircleBase: `${AURA_ASSET_BASE}occult_circle_base.png`,
  ornateGoldDivider: `${AURA_ASSET_BASE}ornate_gold_divider.png`,
  outerPerimeterRing: `${AURA_ASSET_BASE}outer_perimeter_ring.png`,
  playerAuraSilhouette: `${AURA_ASSET_BASE}player_aura_silhouette.png`,
  protectionShieldNode: `${AURA_ASSET_BASE}protection_shield_node.png`,
  purpleAuraBurst: `${AURA_ASSET_BASE}purple_aura_burst.png`,
  smallGoldenGlint: `${AURA_ASSET_BASE}small_golden_glint.png`,
  spiritBindingSigil: `${AURA_ASSET_BASE}spirit_binding_sigil.png`,
  spiritualVortex: `${AURA_ASSET_BASE}spiritual_vortex.png`,
  verticalRuneFragment: `${AURA_ASSET_BASE}vertical_rune_fragment.png`,
  wardRingWithSigilNodes: `${AURA_ASSET_BASE}ward_ring_with_sigil_nodes.png`,
  wardRitualSealNode: `${AURA_ASSET_BASE}ward_ritual_seal_node.png`,
  wardSigilA: `${AURA_ASSET_BASE}ward_sigil_a.png`,
  wardSigilB: `${AURA_ASSET_BASE}ward_sigil_b.png`,
  wardSigilC: `${AURA_ASSET_BASE}ward_sigil_c.png`,
} as const;

export const AURA_Z_INDEX = {
  occultBase: 10,
  backgroundAura: 20,
  perimeter: 30,
  wards: 40,
  innerAura: 50,
  geometry: 60,
  player: 70,
  soulGlow: 80,
  nodes: 90,
  sigils: 100,
  statusEffects: 110,
  damage: 120,
  foregroundParticles: 130,
  glints: 140,
  hitboxes: 150,
} as const;

/** Positions relative to the centered aura composition square (0–1). */
export const NODE_POSITIONS = {
  authority: { x: 0.5, y: 0.12 },
  protection: { x: 0.17, y: 0.5 },
  wardSeal: { x: 0.83, y: 0.5 },
  familiar: { x: 0.5, y: 0.86 },
} as const;

export const SIGIL_POSITIONS = {
  upperLeft: { x: 0.29, y: 0.25 },
  upperRight: { x: 0.71, y: 0.25 },
  lowerLeft: { x: 0.3, y: 0.72 },
  lowerRight: { x: 0.7, y: 0.72 },
} as const;
