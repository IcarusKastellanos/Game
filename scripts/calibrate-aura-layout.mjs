/**
 * Sample the aura static background to help calibrate overlay zones.
 * Prints brightness map of key region centers and dark-panel bounding guesses.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const path = join(root, 'client/public/assets/ui/aura-screen/aura-screen-static-background.png');

function decodePng(buf) {
  if (buf[0] !== 0x89) throw new Error('not png');
  let offset = 8;
  let width = 0;
  let height = 0;
  /** @type {Buffer[]} */
  const idats = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === 'IDAT') {
      idats.push(Buffer.from(data));
    } else if (type === 'IEND') break;
    offset += 12 + len;
  }
  const inflated = inflateSync(Buffer.concat(idats));
  const bpp = 4; // assume RGBA
  const stride = width * bpp + 1;
  const rgba = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(width * bpp);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    const filter = inflated[rowStart];
    const raw = inflated.subarray(rowStart + 1, rowStart + stride);
    const cur = new Uint8Array(width * bpp);
    for (let i = 0; i < raw.length; i++) {
      let x = raw[i];
      if (filter === 1) x = (x + (i >= bpp ? cur[i - bpp] : 0)) & 255; // Sub
      else if (filter === 2) x = (x + prev[i]) & 255; // Up
      else if (filter === 3) {
        const a = i >= bpp ? cur[i - bpp] : 0;
        x = (x + Math.floor((a + prev[i]) / 2)) & 255; // Average
      } else if (filter === 4) {
        const a = i >= bpp ? cur[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        x = (x + pr) & 255; // Paeth
      }
      cur[i] = x;
    }
    rgba.set(cur, y * width * 4);
    prev = cur;
  }
  return { width, height, rgba };
}

function lum(rgba, w, x, y) {
  const i = (y * w + x) * 4;
  return (rgba[i] * 0.3 + rgba[i + 1] * 0.59 + rgba[i + 2] * 0.11);
}

const { width: W, height: H, rgba } = decodePng(readFileSync(path));
console.log('dims', W, H);

// Build a low-res brightness grid to find empty panels
const GX = 32;
const GY = 18;
const cellW = Math.floor(W / GX);
const cellH = Math.floor(H / GY);
const grid = [];
for (let gy = 0; gy < GY; gy++) {
  const row = [];
  for (let gx = 0; gx < GX; gx++) {
    let sum = 0;
    let n = 0;
    for (let dy = 2; dy < cellH - 2; dy += 2) {
      for (let dx = 2; dx < cellW - 2; dx += 2) {
        sum += lum(rgba, W, gx * cellW + dx, gy * cellH + dy);
        n++;
      }
    }
    row.push(Math.round(sum / n));
  }
  grid.push(row);
}

console.log('brightness grid (darker = emptier panels):');
for (let gy = 0; gy < GY; gy++) {
  console.log(
    String(gy * cellH).padStart(3) +
      ' ' +
      grid[gy].map((v) => (v < 25 ? '.' : v < 40 ? ':' : v < 70 ? '+' : '#')).join('')
  );
}

// Propose zones based on darkest contiguous regions
const dark = (gx, gy) => grid[gy][gx] < 35;

function findBox(x0, x1, y0, y1) {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let gy = y0; gy <= y1; gy++) {
    for (let gx = x0; gx <= x1; gx++) {
      if (!dark(gx, gy)) continue;
      minX = Math.min(minX, gx);
      maxX = Math.max(maxX, gx);
      minY = Math.min(minY, gy);
      maxY = Math.max(maxY, gy);
    }
  }
  if (maxX < 0) return null;
  return {
    x: minX * cellW,
    y: minY * cellH,
    width: (maxX - minX + 1) * cellW,
    height: (maxY - minY + 1) * cellH,
  };
}

const zones = {
  leftVizGuess: findBox(1, 13, 2, 12),
  rightTopGuess: findBox(14, 30, 2, 7),
  rightMidGuess: findBox(14, 30, 6, 9),
  coreGuess: findBox(14, 19, 9, 16),
  mentalGuess: findBox(19, 24, 9, 16),
  techGuess: findBox(24, 30, 9, 16),
};

console.log('zone guesses', JSON.stringify(zones, null, 2));

writeFileSync(
  join(root, 'content/ui/_aura-screen-calibration.json'),
  JSON.stringify({ width: W, height: H, cellW, cellH, zones, grid }, null, 2)
);
console.log('wrote calibration');
