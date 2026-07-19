import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const srcDir =
  'C:/Users/gjern/.cursor/projects/c-Users-gjern-OneDrive-Desktop-Game/assets';
const dstDir = 'C:/Users/gjern/OneDrive/Desktop/Game/client/public/assets/ui/aura';

const names = [
  'arcane_starburst.png',
  'aura_breach_ring.png',
  'authority_crown_node.png',
  'blessing_starburst.png',
  'blue_aura_burst.png',
  'blue_magical_motes.png',
  'chest_soul_glow.png',
  'circular_rune_fragments.png',
  'dark_corruption_cloud.png',
  'empty_protection_node.png',
  'energetic_damage_crack.png',
  'familiar_link_node.png',
  'floating_rune_crystal.png',
  'gold_node_divider.png',
  'hex_pattern_cloud.png',
  'inner_aura_ring.png',
  'occult_circle_base.png',
  'ornate_gold_divider.png',
  'outer_perimeter_ring.png',
  'player_aura_silhouette.png',
  'protection_shield_node.png',
  'purple_aura_burst.png',
  'small_golden_glint.png',
  'spirit_binding_sigil.png',
  'spiritual_vortex.png',
  'vertical_rune_fragment.png',
  'ward_ring_with_sigil_nodes.png',
  'ward_ritual_seal_node.png',
  'ward_sigil_a.png',
  'ward_sigil_b.png',
  'ward_sigil_c.png',
];

mkdirSync(dstDir, { recursive: true });
const files = readdirSync(srcDir);
const missing = [];
const copied = [];

for (const name of names) {
  const stem = name.replace(/\.png$/, '');
  const src = files.find(
    (f) =>
      f.includes(`empty-window_images_${stem}-`) ||
      f.includes(`empty-window_images_${stem}.`)
  );
  if (!src) {
    missing.push(name);
    continue;
  }
  const dst = join(dstDir, name);
  copyFileSync(join(srcDir, src), dst);
  copied.push({ from: basename(src), to: name });
}

writeFileSync(
  join(dstDir, 'manifest.json'),
  JSON.stringify({ copied: copied.length, missing, files: copied }, null, 2)
);
console.log(JSON.stringify({ copied: copied.length, missing }, null, 2));
