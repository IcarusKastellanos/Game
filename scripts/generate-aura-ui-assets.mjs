/**
 * Generates pixel-art PNG assets for the Aura & Wards screen.
 * Recreated in the reference style (not extracted/baked text). Re-run after palette tweaks.
 *
 * Usage: node scripts/generate-aura-ui-assets.mjs
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '../client/public/assets/ui/aura-screen');

const PAL = {
  gold: [217, 178, 94],
  goldHi: [242, 216, 145],
  goldLo: [138, 109, 51],
  navy: [10, 7, 20],
  panel: [20, 14, 36],
  purple: [185, 140, 255],
  purpleLo: [107, 74, 158],
  blue: [127, 182, 255],
  cyan: [100, 200, 255],
  green: [126, 224, 166],
  greenLo: [100, 180, 150],
  red: [255, 100, 120],
  white: [232, 220, 255],
  violet: [140, 100, 220],
};

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function encodePng(w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      raw[row + 1 + x * 4] = px[i];
      raw[row + 2 + x * 4] = px[i + 1];
      raw[row + 3 + x * 4] = px[i + 2];
      raw[row + 4 + x * 4] = px[i + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function rgba(w, h, fill = [0, 0, 0, 0]) {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = fill[0];
    px[i * 4 + 1] = fill[1];
    px[i * 4 + 2] = fill[2];
    px[i * 4 + 3] = fill[3] ?? 255;
  }
  return px;
}

function set(px, w, x, y, c, a = 255) {
  if (x < 0 || y < 0 || x >= w) return;
  const h = px.length / (w * 4);
  if (y >= h) return;
  const i = (y * w + x) * 4;
  if (a >= 255) {
    px[i] = c[0];
    px[i + 1] = c[1];
    px[i + 2] = c[2];
    px[i + 3] = 255;
    return;
  }
  const ia = a / 255;
  px[i] = Math.round(px[i] * (1 - ia) + c[0] * ia);
  px[i + 1] = Math.round(px[i + 1] * (1 - ia) + c[1] * ia);
  px[i + 2] = Math.round(px[i + 2] * (1 - ia) + c[2] * ia);
  px[i + 3] = Math.min(255, Math.round(px[i + 3] * (1 - ia) + a));
}

function line(px, w, x0, y0, x1, y1, c, a = 255) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    set(px, w, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), c, a);
  }
}

function circle(px, w, cx, cy, r, c, a = 255, thick = 1) {
  for (let t = 0; t < thick; t++) {
    const rr = r - t;
    for (let deg = 0; deg < 360; deg++) {
      const rad = (deg * Math.PI) / 180;
      const x = Math.round(cx + Math.cos(rad) * rr);
      const y = Math.round(cy + Math.sin(rad) * rr);
      set(px, w, x, y, c, a);
    }
  }
}

function rect(px, w, x0, y0, x1, y1, c, a = 255) {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) set(px, w, x, y, c, a);
}

function save(rel, w, h, px) {
  const path = join(OUT, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(w, h, px));
}

function nineSlice(name, size = 64, border = 16) {
  const px = rgba(size, size, [...PAL.panel, 255]);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const edge = x < border || y < border || x >= size - border || y >= size - border;
      const inner = x === border || y === border || x === size - border - 1 || y === size - border - 1;
      if (edge) set(px, size, x, y, PAL.goldLo, 255);
      if (inner) set(px, size, x, y, PAL.purpleLo, 180);
      if ((x < 4 && y < 4) || (x >= size - 4 && y < 4) || (x < 4 && y >= size - 4) || (x >= size - 4 && y >= size - 4)) {
        set(px, size, x, y, PAL.gold, 255);
      }
    }
  }
  save(name, size, size, px);
}

function ringAsset(name, r, c, a, thick = 2, dashed = false) {
  const s = r * 2 + 8;
  const px = rgba(s, s);
  const cx = (s / 2) | 0;
  const cy = (s / 2) | 0;
  if (!dashed) {
    circle(px, s, cx, cy, r, c, a, thick);
  } else {
    for (let deg = 0; deg < 360; deg += 6) {
      if ((deg / 6) % 2) continue;
      const rad = (deg * Math.PI) / 180;
      const x = cx + Math.round(Math.cos(rad) * r);
      const y = cy + Math.round(Math.sin(rad) * r);
      set(px, s, x, y, c, a);
      set(px, s, x + 1, y, c, a);
    }
  }
  save(name, s, s, px);
}

function occultBackground() {
  const s = 256;
  const px = rgba(s, s, [...PAL.navy, 255]);
  const cx = s / 2;
  const cy = s / 2;
  circle(px, s, cx, cy, 118, PAL.purpleLo, 40, 1);
  circle(px, s, cx, cy, 100, PAL.violet, 25, 1);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    line(px, s, cx, cy, cx + Math.cos(a) * 115, cy + Math.sin(a) * 115, PAL.goldLo, 60);
  }
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const x = cx + Math.cos(a) * 108;
    const y = cy + Math.sin(a) * 108;
    set(px, s, x | 0, y | 0, PAL.purple, 120);
  }
  for (let i = 0; i < 80; i++) {
    const x = (Math.sin(i * 12.7) * 0.5 + 0.5) * (s - 4) + 2;
    const y = (Math.cos(i * 8.3) * 0.5 + 0.5) * (s - 4) + 2;
    set(px, s, x | 0, y | 0, PAL.white, 40 + (i % 3) * 20);
  }
  save('occult-circle-background.png', s, s, px);
}

function silhouette() {
  const w = 64;
  const h = 96;
  const px = rgba(w, h);
  const cx = w / 2;
  const draw = (c, a) => {
    circle(px, w, cx, 18, 10, c, a, 2);
    rect(px, w, cx - 6, 28, cx + 5, 58, c, a);
    line(px, w, cx, 34, cx - 18, 44, c, a);
    line(px, w, cx, 34, cx + 18, 44, c, a);
    line(px, w, cx, 58, cx - 12, 82, c, a);
    line(px, w, cx, 58, cx + 12, 82, c, a);
    set(px, w, cx, 42, PAL.cyan, 220);
  };
  draw(PAL.blue, 80);
  draw(PAL.cyan, 200);
  draw(PAL.white, 255);
  save('player-aura-silhouette.png', w, h, px);
}

function nodeIcon(name, drawFn) {
  const s = 32;
  const px = rgba(s, s);
  circle(px, s, 16, 16, 14, PAL.goldLo, 200, 1);
  drawFn(px, s);
  save(name, s, s, px);
}

function statIcon(name, drawFn) {
  const s = 24;
  const px = rgba(s, s);
  drawFn(px, s);
  save(`icons/${name}.png`, s, s, px);
}

function effectBlob(name, c, a) {
  const s = 32;
  const px = rgba(s, s);
  circle(px, s, 16, 16, 10, c, a, 3);
  circle(px, s, 16, 16, 6, c, Math.min(255, a + 40), 2);
  save(`effects/${name}.png`, s, s, px);
}

function headerDecoration() {
  const w = 160;
  const h = 12;
  const px = rgba(w, h);
  for (let x = 0; x < w; x++) {
    const t = Math.abs(x - w / 2) / (w / 2);
    set(px, w, x, 5, PAL.gold, Math.round(180 * (1 - t * 0.5)));
    set(px, w, x, 6, PAL.goldLo, Math.round(120 * (1 - t * 0.6)));
  }
  set(px, w, 4, 5, PAL.purple, 255);
  set(px, w, w - 5, 5, PAL.purple, 255);
  save('aura-header-decoration.png', w, h, px);
}

function moonOrnament() {
  const s = 46;
  const px = rgba(s, s, [...PAL.navy, 255]);
  circle(px, s, 23, 23, 20, PAL.goldLo, 255, 2);
  circle(px, s, 28, 20, 16, PAL.navy, 255, 8);
  circle(px, s, 20, 24, 3, PAL.gold, 200, 1);
  save('bottom-moon-ornament.png', s, s, px);
}

function cornerFiligree() {
  const s = 26;
  const px = rgba(s, s);
  for (let i = 0; i < s; i++) {
    set(px, s, i, 0, PAL.gold, 220);
    set(px, s, 0, i, PAL.gold, 220);
    if (i < 8) set(px, s, i, i, PAL.goldHi, 200);
  }
  save('corner-filigree.png', s, s, px);
}

function closeFrame() {
  const s = 36;
  const px = rgba(s, s, [...PAL.panel, 255]);
  rect(px, s, 1, 1, s - 2, s - 2, PAL.goldLo, 255);
  rect(px, s, 3, 3, s - 4, s - 4, PAL.purpleLo, 120);
  line(px, s, 10, 10, s - 11, s - 11, PAL.goldHi, 255);
  line(px, s, s - 11, 10, 10, s - 11, PAL.goldHi, 255);
  save('aura-close-frame.png', s, s, px);
}

function panelDivider() {
  const w = 8;
  const h = 64;
  const px = rgba(w, h);
  line(px, w, 4, 2, 4, h - 3, PAL.goldLo, 200);
  set(px, w, 4, h / 2, PAL.gold, 255);
  set(px, w, 3, (h / 2) | 0, PAL.purple, 180);
  set(px, w, 5, (h / 2) | 0, PAL.purple, 180);
  save('panel-divider.png', w, h, px);
}

function pipTile(name, c, on) {
  const s = 14;
  const px = rgba(s, s, on ? [...c, 255] : [...PAL.navy, 255]);
  rect(px, s, 0, 0, s - 1, s - 1, PAL.goldLo, on ? 200 : 100);
  if (on) rect(px, s, 2, 2, s - 3, s - 3, c, 255);
  save(`pips/${name}.png`, s, s, px);
}

function writeManifest() {
  const manifest = {
    version: 1,
    baseUrl: '/assets/ui/aura-screen/',
    source: 'recreated',
    note:
      'Pixel-art assets programmatically recreated from the Aura & Wards reference palette and layout (not cropped/extracted). Regenerate via npm run assets:aura.',
    generatedAt: new Date().toISOString(),
    layers: [
      'aura-screen-frame',
      'panel backgrounds',
      'decorative borders',
      'occult-circle-background',
      'perimeter-ring',
      'ward-ring',
      'aura-ring',
      'player-aura-silhouette',
      'protection-node / familiar nodes',
      'effects (damage, blessing, hex)',
      'icons',
      'pip tiles',
      'live HTML text (not baked)',
    ],
    stateVariants: {
      wardRing: ['inactive', 'active', 'damaged', 'breached'],
      familiarNode: ['unlinked', 'linked', 'weakened', 'blocked'],
      pipTiles: ['off', 'health-on', 'hunger-on', 'stamina-on', 'magical-energy-on', 'critical-on'],
    },
  };
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

function main() {
  mkdirSync(join(OUT, 'icons'), { recursive: true });
  mkdirSync(join(OUT, 'effects'), { recursive: true });
  mkdirSync(join(OUT, 'pips'), { recursive: true });

  nineSlice('aura-screen-frame.png', 96, 20);
  nineSlice('attribute-panel.png', 48, 12);
  nineSlice('overview-panel.png', 48, 12);
  nineSlice('aura-visualization-frame.png', 64, 14);
  headerDecoration();
  closeFrame();
  moonOrnament();
  cornerFiligree();
  panelDivider();
  occultBackground();
  silhouette();

  ringAsset('aura-ring.png', 72, PAL.cyan, 220, 2);
  ringAsset('perimeter-ring.png', 88, PAL.greenLo, 140, 1, true);
  ringAsset('ward-ring-inactive.png', 80, PAL.goldLo, 60, 1);
  ringAsset('ward-ring-active.png', 80, PAL.gold, 230, 2);
  ringAsset('ward-ring-damaged.png', 80, PAL.red, 180, 2);
  ringAsset('ward-ring-breached.png', 80, PAL.red, 255, 1, true);

  nodeIcon('protection-node.png', (px, s) => {
    rect(px, s, 14, 10, 18, 22, PAL.cyan, 255);
    line(px, s, 12, 12, 16, 8, PAL.gold, 255);
    line(px, s, 20, 12, 16, 8, PAL.gold, 255);
    line(px, s, 12, 12, 16, 22, PAL.gold, 255);
    line(px, s, 20, 12, 16, 22, PAL.gold, 255);
  });

  const familiar = (name, c, a) =>
    nodeIcon(name, (px, w) => {
      circle(px, w, 16, 14, 5, c, a, 1);
      circle(px, w, 20, 13, 2, c, a, 1);
      circle(px, w, 12, 13, 2, c, a, 1);
      line(px, w, 14, 18, 12, 22, c, a);
      line(px, w, 18, 18, 20, 22, c, a);
    });

  familiar('familiar-unlinked.png', PAL.goldLo, 100);
  familiar('familiar-linked.png', PAL.green, 255);
  familiar('familiar-weakened.png', PAL.gold, 180);
  familiar('familiar-blocked.png', PAL.red, 200);

  effectBlob('aura-particle', PAL.white, 100);
  effectBlob('ward-glow', PAL.gold, 80);
  effectBlob('blessing-glow', PAL.green, 90);
  effectBlob('hex-distortion', PAL.red, 90);
  effectBlob('damage-distortion', PAL.red, 120);

  const icons = {
    health: (px, s) => {
      circle(px, s, 12, 11, 6, PAL.purple, 255, 1);
      set(px, s, 10, 14, PAL.purple, 255);
      set(px, s, 14, 14, PAL.purple, 255);
    },
    hunger: (px, s) => {
      circle(px, s, 12, 10, 5, [224, 162, 74], 255, 1);
      line(px, s, 12, 5, 12, 8, [224, 162, 74], 255);
    },
    stamina: (px, s) => {
      set(px, s, 14, 4, [74, 208, 122], 255);
      line(px, s, 6, 12, 14, 4, [74, 208, 122], 255);
      line(px, s, 14, 4, 10, 20, [74, 208, 122], 255);
    },
    'magical-energy': (px, s) => {
      set(px, s, 12, 4, PAL.cyan, 255);
      set(px, s, 10, 8, PAL.cyan, 255);
      set(px, s, 14, 8, PAL.cyan, 255);
      set(px, s, 8, 12, PAL.cyan, 255);
      set(px, s, 16, 12, PAL.cyan, 255);
      set(px, s, 12, 16, PAL.cyan, 255);
    },
    intuition: (px, s) => circle(px, s, 12, 12, 5, PAL.purple, 255, 1),
    awareness: (px, s) => {
      circle(px, s, 12, 12, 4, PAL.cyan, 255, 1);
      line(px, s, 12, 4, 12, 7, PAL.cyan, 255);
      line(px, s, 12, 17, 12, 20, PAL.cyan, 255);
    },
    willpower: (px, s) => {
      rect(px, s, 9, 8, 15, 18, PAL.goldLo, 255);
      set(px, s, 12, 12, PAL.gold, 255);
    },
    memory: (px, s) => {
      rect(px, s, 8, 6, 16, 18, PAL.goldLo, 255);
      line(px, s, 11, 6, 11, 18, PAL.gold, 255);
    },
    presence: (px, s) => {
      circle(px, s, 12, 8, 3, PAL.white, 255, 1);
      line(px, s, 8, 18, 16, 18, PAL.white, 255);
    },
    authority: (px, s) => {
      set(px, s, 8, 14, PAL.gold, 255);
      set(px, s, 16, 14, PAL.gold, 255);
      set(px, s, 12, 10, PAL.goldHi, 255);
    },
    mediumship: (px, s) => {
      circle(px, s, 10, 12, 2, PAL.cyan, 255, 1);
      circle(px, s, 14, 12, 2, PAL.cyan, 255, 1);
      circle(px, s, 12, 8, 5, PAL.purpleLo, 180, 1);
    },
    'ritual-skill': (px, s) => {
      circle(px, s, 12, 12, 8, PAL.goldLo, 200, 1);
      line(px, s, 12, 6, 12, 18, PAL.gold, 255);
      line(px, s, 6, 12, 18, 12, PAL.gold, 255);
    },
    protection: (px, s) => {
      set(px, s, 12, 6, PAL.cyan, 255);
      line(px, s, 8, 10, 12, 6, PAL.cyan, 255);
      line(px, s, 16, 10, 12, 6, PAL.cyan, 255);
      rect(px, s, 9, 10, 15, 18, PAL.cyan, 200);
    },
    'hex-work': (px, s) => {
      set(px, s, 12, 5, PAL.red, 255);
      line(px, s, 8, 10, 16, 10, PAL.red, 255);
      line(px, s, 10, 18, 14, 12, PAL.red, 255);
    },
    healing: (px, s) => {
      line(px, s, 12, 6, 12, 18, PAL.green, 255);
      line(px, s, 6, 12, 18, 12, PAL.green, 255);
    },
    herbalism: (px, s) => {
      set(px, s, 12, 18, PAL.green, 255);
      line(px, s, 8, 14, 12, 8, PAL.green, 255);
      line(px, s, 16, 14, 12, 8, PAL.green, 255);
    },
    divination: (px, s) => {
      circle(px, s, 10, 10, 6, PAL.purple, 200, 1);
      line(px, s, 14, 14, 18, 18, PAL.gold, 255);
    },
    'potion-making': (px, s) => {
      rect(px, s, 10, 8, 14, 18, PAL.cyan, 200);
      rect(px, s, 9, 6, 15, 8, PAL.goldLo, 255);
    },
    'spirit-negotiation': (px, s) => {
      line(px, s, 6, 12, 10, 12, PAL.gold, 255);
      line(px, s, 14, 12, 18, 12, PAL.gold, 255);
      set(px, s, 12, 8, PAL.purple, 255);
    },
  };

  for (const [name, draw] of Object.entries(icons)) statIcon(name, draw);

  pipTile('pip-off', PAL.navy, false);
  pipTile('pip-health-on', PAL.purple, true);
  pipTile('pip-hunger-on', [224, 162, 74], true);
  pipTile('pip-stamina-on', [74, 208, 122], true);
  pipTile('pip-magical-energy-on', PAL.cyan, true);
  pipTile('pip-critical-on', PAL.red, true);

  writeManifest();
  console.log(`[aura-assets] Wrote assets to ${OUT}`);
}

main();
