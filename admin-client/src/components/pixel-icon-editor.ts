/** 16×16 pixel icon editor for admin item manager */
import { isTransparentPixel, MAP_TRANSPARENT_PIXEL } from '@witchcraft/shared';
import { mountPixelColorTools } from './pixel-color-tools.js';

const ICON_SIZE = 16;
const PALETTE = [
  '#000000', '#1a1025', '#3d3654', '#9a8fb0',
  '#c9a227', '#7b5ea7', '#4a8a55', '#3a7d44',
  '#8b6914', '#5c4033', '#cc4444', '#ff8844',
  '#ffeeaa', '#88ccff', '#ffffff', '#e8e0f0',
];

export function mountPixelIconEditor(
  host: HTMLElement,
  initial: string[] | undefined,
  onChange: (pixels: string[]) => void
): { getPixels: () => string[]; setPixels: (pixels: string[]) => void } {
  let pixels = normalizePixels(initial);
  let brush = PALETTE[5];
  let drawing = false;

  host.innerHTML = `
    <div class="pixel-editor">
      <canvas id="px-canvas" width="${ICON_SIZE * 12}" height="${ICON_SIZE * 12}" style="image-rendering:pixelated;border:1px solid #3d3654;border-radius:4px;cursor:crosshair;background:repeating-conic-gradient(#2a2a3a 0% 25%, #1a1a28 0% 50%) 50% / 16px 16px;"></canvas>
      <div class="pixel-palette" id="px-palette"></div>
      <div class="pixel-tools flex mt">
        <button type="button" class="btn secondary" id="px-clear">Clear</button>
        <button type="button" class="btn secondary" id="px-erase">Eraser</button>
        <button type="button" class="btn secondary" id="px-fill">Fill Category Color</button>
      </div>
    </div>`;

  const canvas = host.querySelector('#px-canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const scale = 12;

  const paletteEl = host.querySelector('#px-palette')!;
  paletteEl.innerHTML = PALETTE.map(
    (c, i) =>
      `<button type="button" class="palette-swatch${i === 5 ? ' active' : ''}" data-color="${c}" style="background:${c}" title="${c}"></button>`
  ).join('');

  const redraw = (): void => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < ICON_SIZE; y++) {
      for (let x = 0; x < ICON_SIZE; x++) {
        const color = pixels[y * ICON_SIZE + x] ?? MAP_TRANSPARENT_PIXEL;
        if (isTransparentPixel(color)) continue;
        ctx.fillStyle = color;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    ctx.strokeStyle = '#3d3654';
    ctx.lineWidth = 1;
    for (let i = 0; i <= ICON_SIZE; i++) {
      ctx.beginPath();
      ctx.moveTo(i * scale, 0);
      ctx.lineTo(i * scale, ICON_SIZE * scale);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * scale);
      ctx.lineTo(ICON_SIZE * scale, i * scale);
      ctx.stroke();
    }
  };

  const paint = (ev: MouseEvent): void => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((ev.clientX - rect.left) / scale);
    const y = Math.floor((ev.clientY - rect.top) / scale);
    if (x < 0 || y < 0 || x >= ICON_SIZE || y >= ICON_SIZE) return;
    if (colorTools.isEyedropperActive()) {
      colorTools.sampleAt(x, y);
      return;
    }
    pixels[y * ICON_SIZE + x] = brush;
    redraw();
    onChange([...pixels]);
  };

  canvas.addEventListener('mousedown', (ev) => {
    drawing = true;
    paint(ev);
  });
  canvas.addEventListener('mousemove', (ev) => {
    if (drawing) paint(ev);
  });
  window.addEventListener('mouseup', () => { drawing = false; });

  paletteEl.querySelectorAll('.palette-swatch').forEach((btn) => {
    btn.addEventListener('click', () => {
      brush = (btn as HTMLElement).dataset.color!;
      paletteEl.querySelectorAll('.palette-swatch').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  host.querySelector('#px-fill')!.addEventListener('click', () => {
    host.dispatchEvent(new CustomEvent('pixel-fill-category'));
  });

  host.querySelector('#px-clear')!.addEventListener('click', () => {
    pixels = Array(ICON_SIZE * ICON_SIZE).fill(MAP_TRANSPARENT_PIXEL);
    redraw();
    onChange([...pixels]);
  });

  host.querySelector('#px-erase')!.addEventListener('click', () => {
    brush = MAP_TRANSPARENT_PIXEL;
    paletteEl.querySelectorAll('.palette-swatch').forEach((b) => b.classList.remove('active'));
  });

  const toolsEl = host.querySelector('.pixel-tools') as HTMLElement;
  const colorTools = mountPixelColorTools(toolsEl, {
    idPrefix: 'px',
    getDimensions: () => ({ widthPx: ICON_SIZE, heightPx: ICON_SIZE }),
    getPixels: () => pixels,
    applyPixels: (next) => {
      pixels = [...next];
      redraw();
      onChange([...pixels]);
    },
  });

  redraw();

  return {
    getPixels: () => [...pixels],
    setPixels: (next) => {
      pixels = normalizePixels(next);
      redraw();
      onChange([...pixels]);
    },
  };
}

function normalizePixels(input: string[] | undefined): string[] {
  const out = Array(ICON_SIZE * ICON_SIZE).fill(MAP_TRANSPARENT_PIXEL);
  if (!input?.length) return out;
  for (let i = 0; i < Math.min(input.length, out.length); i++) {
    out[i] = input[i] ?? MAP_TRANSPARENT_PIXEL;
  }
  return out;
}

export function pixelsToDataUrl(pixels: string[]): string {
  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
  for (let y = 0; y < ICON_SIZE; y++) {
    for (let x = 0; x < ICON_SIZE; x++) {
      const color = pixels[y * ICON_SIZE + x] ?? MAP_TRANSPARENT_PIXEL;
      if (isTransparentPixel(color)) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas.toDataURL('image/png');
}

export function categoryFillColor(category: string): string {
  const map: Record<string, string> = {
    herbs: '#3a8a3a', candles: '#ffeeaa', incense: '#b49070', tools: '#786050',
    minerals: '#9090a8', offerings: '#b45454', default: '#7b5ea7',
  };
  return map[category] ?? map.default;
}
