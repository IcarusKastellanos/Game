import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const path =
  'C:/Users/gjern/OneDrive/Desktop/Game/client/public/assets/ui/aura-screen/aura-screen-static-background.png';
const buf = readFileSync(path);
let off = 8;
let w = 0;
let h = 0;
let color = 0;
const idats = [];
while (off < buf.length) {
  const len = buf.readUInt32BE(off);
  const type = buf.toString('ascii', off + 4, off + 8);
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === 'IHDR') {
    w = data.readUInt32BE(0);
    h = data.readUInt32BE(4);
    color = data[9];
  } else if (type === 'IDAT') idats.push(Buffer.from(data));
  else if (type === 'IEND') break;
  off += 12 + len;
}
const bpp = color === 2 ? 3 : 4;
const inflated = inflateSync(Buffer.concat(idats));
const stride = w * bpp + 1;
const rgba = new Uint8Array(w * h * 4);
let prev = new Uint8Array(w * bpp);
for (let y = 0; y < h; y++) {
  const rowStart = y * stride;
  const filter = inflated[rowStart];
  const raw = inflated.subarray(rowStart + 1, rowStart + stride);
  const cur = new Uint8Array(w * bpp);
  for (let i = 0; i < raw.length; i++) {
    let v = raw[i];
    if (filter === 1) v = (v + (i >= bpp ? cur[i - bpp] : 0)) & 255;
    else if (filter === 2) v = (v + prev[i]) & 255;
    else if (filter === 3) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      v = (v + Math.floor((a + prev[i]) / 2)) & 255;
    } else if (filter === 4) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      v = (v + pr) & 255;
    }
    cur[i] = v;
  }
  for (let x = 0; x < w; x++) {
    const si = x * bpp;
    const di = (y * w + x) * 4;
    rgba[di] = cur[si];
    rgba[di + 1] = cur[si + 1];
    rgba[di + 2] = cur[si + 2];
    rgba[di + 3] = 255;
  }
  prev = cur;
}

function pix(x, y) {
  const i = (y * w + x) * 4;
  return [rgba[i], rgba[i + 1], rgba[i + 2]];
}
function lum(x, y) {
  const [r, g, b] = pix(x, y);
  return 0.3 * r + 0.59 * g + 0.11 * b;
}
function isBright(x, y) {
  if (x < 0 || y < 0 || x >= w || y >= h) return false;
  const [r, g, b] = pix(x, y);
  return r + g + b > 240;
}
function isGold(x, y) {
  if (x < 0 || y < 0 || x >= w || y >= h) return false;
  const [r, g, b] = pix(x, y);
  return r > 100 && r > b + 25 && r + g > 170;
}

// Score candidate squares by: gold ring + dark interior + bright X diagonals
let best = { score: -1, x: 0, y: 0, s: 0 };
for (let s = 28; s <= 44; s++) {
  for (let y = 4; y <= 40; y++) {
    for (let x = 900; x <= w - s - 4; x++) {
      let border = 0;
      let borderN = 0;
      let interiorDark = 0;
      let interiorN = 0;
      let diag = 0;
      // border samples
      for (let i = 0; i < s; i++) {
        borderN += 4;
        if (isGold(x + i, y)) border++;
        if (isGold(x + i, y + s - 1)) border++;
        if (isGold(x, y + i)) border++;
        if (isGold(x + s - 1, y + i)) border++;
      }
      const pad = 5;
      for (let yy = y + pad; yy < y + s - pad; yy++) {
        for (let xx = x + pad; xx < x + s - pad; xx++) {
          interiorN++;
          if (lum(xx, yy) < 40) interiorDark++;
        }
      }
      // diagonals of X
      for (let i = pad; i < s - pad; i++) {
        if (isBright(x + i, y + i)) diag++;
        if (isBright(x + s - 1 - i, y + i)) diag++;
      }
      const borderRatio = border / borderN;
      const darkRatio = interiorDark / Math.max(1, interiorN);
      if (borderRatio < 0.25 || darkRatio < 0.35 || diag < 4) continue;
      const score = borderRatio * 40 + darkRatio * 30 + diag * 3;
      if (score > best.score) best = { score, x, y, s, borderRatio, darkRatio, diag };
    }
  }
}

console.log('best square', JSON.stringify(best));

// Print map of best
if (best.score >= 0) {
  const lines = [];
  for (let yy = best.y - 1; yy < best.y + best.s + 1; yy++) {
    let line = String(yy).padStart(3) + ' ';
    for (let xx = best.x - 1; xx < best.x + best.s + 1; xx++) {
      if (isBright(xx, yy)) line += '#';
      else if (isGold(xx, yy)) line += '+';
      else line += '.';
    }
    lines.push(line);
  }
  writeFileSync(
    'C:/Users/gjern/OneDrive/Desktop/Game/scripts/_close-map.txt',
    lines.join('\n')
  );
  const result = {
    x: best.x,
    y: best.y,
    width: best.s,
    height: best.s,
    score: best.score,
  };
  writeFileSync(
    'C:/Users/gjern/OneDrive/Desktop/Game/scripts/_close-bbox.json',
    JSON.stringify(result, null, 2)
  );
  console.log(JSON.stringify(result));
} else {
  console.log('no square found');
}
