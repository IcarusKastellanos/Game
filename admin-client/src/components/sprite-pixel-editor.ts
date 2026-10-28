/** Variable-size pixel sprite editor for map builder assets. */

import { isTransparentPixel, MAP_TRANSPARENT_PIXEL } from '@witchcraft/shared';
import { mountPixelColorTools } from './pixel-color-tools.js';

const TILE_PX = 32;
const DEFAULT_BG = MAP_TRANSPARENT_PIXEL;

const PALETTE = [
  '#000000', '#1a1025', '#3d3654', '#9a8fb0',
  '#c9a227', '#7b5ea7', '#4a8a55', '#3a7d44',
  '#8b6914', '#5c4033', '#cc4444', '#ff8844',
  '#ffeeaa', '#88ccff', '#ffffff', '#e8e0f0',
];

export interface SpritePixelEditorHandle {
  getPixels: () => string[];
  setPixels: (pixels: string[]) => void;
  resize: (widthPx: number, heightPx: number) => void;
}

export function mountSpritePixelEditor(
  host: HTMLElement,
  opts: {
    widthPx?: number;
    heightPx?: number;
    initial?: string[];
    onChange: (pixels: string[]) => void;
  }
): SpritePixelEditorHandle {
  let widthPx = Math.max(TILE_PX, opts.widthPx ?? TILE_PX);
  let heightPx = Math.max(TILE_PX, opts.heightPx ?? TILE_PX);
  let pixels = normalizePixels(opts.initial, widthPx, heightPx);
  let brush = PALETTE[5];
  let drawing = false;

  host.innerHTML = `
    <div class="pixel-editor">
      <canvas id="spx-canvas" style="image-rendering:pixelated;border:1px solid #3d3654;border-radius:4px;cursor:crosshair;max-width:100%;"></canvas>
      <div class="pixel-palette" id="spx-palette"></div>
      <div class="pixel-tools flex mt">
        <button type="button" class="btn secondary" id="spx-clear">Clear</button>
        <button type="button" class="btn secondary" id="spx-erase">Eraser</button>
        <button type="button" class="btn secondary" id="spx-fill">Fill Category Color</button>
        <button type="button" class="btn secondary" id="spx-builtin">Load Builtin Template</button>
      </div>
    </div>`;

  const canvas = host.querySelector('#spx-canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const paletteEl = host.querySelector('#spx-palette')!;

  const scaleFor = (): number => {
    const maxDim = Math.max(widthPx, heightPx);
    if (maxDim <= 16) return 12;
    if (maxDim <= 32) return 8;
    if (maxDim <= 64) return 4;
    return 2;
  };

  let scale = scaleFor();

  const syncCanvasSize = (): void => {
    scale = scaleFor();
    canvas.width = widthPx * scale;
    canvas.height = heightPx * scale;
  };

  const renderPalette = (): void => {
    paletteEl.innerHTML = PALETTE.map(
      (c, i) =>
        `<button type="button" class="palette-swatch${brush === c || (i === 5 && brush === PALETTE[5]) ? ' active' : ''}" data-color="${c}" style="background:${c}" title="${c}"></button>`
    ).join('');
    paletteEl.querySelectorAll('.palette-swatch').forEach((btn) => {
      btn.addEventListener('click', () => {
        brush = (btn as HTMLElement).dataset.color!;
        paletteEl.querySelectorAll('.palette-swatch').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  };

  const redraw = (): void => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < heightPx; y++) {
      for (let x = 0; x < widthPx; x++) {
        const color = pixels[y * widthPx + x] ?? DEFAULT_BG;
        if (isTransparentPixel(color)) continue;
        ctx.fillStyle = color;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    ctx.strokeStyle = '#3d3654';
    ctx.lineWidth = 1;
    for (let i = 0; i <= widthPx; i++) {
      ctx.beginPath();
      ctx.moveTo(i * scale, 0);
      ctx.lineTo(i * scale, heightPx * scale);
      ctx.stroke();
    }
    for (let i = 0; i <= heightPx; i++) {
      ctx.beginPath();
      ctx.moveTo(0, i * scale);
      ctx.lineTo(widthPx * scale, i * scale);
      ctx.stroke();
    }
  };

  const paint = (ev: MouseEvent): void => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((ev.clientX - rect.left) / scale);
    const y = Math.floor((ev.clientY - rect.top) / scale);
    if (x < 0 || y < 0 || x >= widthPx || y >= heightPx) return;
    if (colorTools.isEyedropperActive()) {
      colorTools.sampleAt(x, y);
      return;
    }
    pixels[y * widthPx + x] = brush;
    redraw();
    opts.onChange([...pixels]);
  };

  syncCanvasSize();
  renderPalette();
  redraw();

  const toolsEl = host.querySelector('.pixel-tools') as HTMLElement;
  const colorTools = mountPixelColorTools(toolsEl, {
    idPrefix: 'spx',
    getDimensions: () => ({ widthPx, heightPx }),
    getPixels: () => pixels,
    applyPixels: (next) => {
      pixels = [...next];
      redraw();
      opts.onChange([...pixels]);
    },
  });

  canvas.addEventListener('mousedown', (ev) => {
    drawing = true;
    paint(ev);
  });
  canvas.addEventListener('mousemove', (ev) => {
    if (drawing) paint(ev);
  });
  window.addEventListener('mouseup', () => { drawing = false; });

  host.querySelector('#spx-clear')!.addEventListener('click', () => {
    pixels = Array(widthPx * heightPx).fill(DEFAULT_BG);
    redraw();
    opts.onChange([...pixels]);
  });

  host.querySelector('#spx-erase')!.addEventListener('click', () => {
    brush = MAP_TRANSPARENT_PIXEL;
    paletteEl.querySelectorAll('.palette-swatch').forEach((b) => b.classList.remove('active'));
  });

  host.querySelector('#spx-fill')!.addEventListener('click', () => {
    host.dispatchEvent(new CustomEvent('sprite-fill-category'));
  });

  host.querySelector('#spx-builtin')!.addEventListener('click', () => {
    host.dispatchEvent(new CustomEvent('sprite-load-builtin'));
  });

  return {
    getPixels: () => [...pixels],
    setPixels: (next) => {
      pixels = normalizePixels(next, widthPx, heightPx);
      redraw();
      opts.onChange([...pixels]);
    },
    resize: (w, h) => {
      const prevW = widthPx;
      const prevH = heightPx;
      widthPx = Math.max(TILE_PX, w);
      heightPx = Math.max(TILE_PX, h);
      pixels = remapPixels(pixels, prevW, prevH, widthPx, heightPx);
      syncCanvasSize();
      redraw();
      opts.onChange([...pixels]);
    },
  };
}

function normalizePixels(input: string[] | undefined, widthPx: number, heightPx: number): string[] {
  const out = Array(widthPx * heightPx).fill(MAP_TRANSPARENT_PIXEL);
  if (!input?.length) return out;

  let oldW: number;
  let oldH: number;
  if (input.length === widthPx * heightPx) {
    oldW = widthPx;
    oldH = heightPx;
  } else {
    const side = Math.round(Math.sqrt(input.length));
    if (side * side === input.length) {
      oldW = side;
      oldH = side;
    } else {
      oldW = widthPx;
      oldH = Math.max(1, Math.ceil(input.length / oldW));
    }
  }

  for (let y = 0; y < Math.min(heightPx, oldH); y++) {
    for (let x = 0; x < Math.min(widthPx, oldW); x++) {
      out[y * widthPx + x] = input[y * oldW + x] ?? MAP_TRANSPARENT_PIXEL;
    }
  }
  return out;
}

function remapPixels(
  input: string[],
  fromW: number,
  fromH: number,
  toW: number,
  toH: number
): string[] {
  const out = Array(toW * toH).fill(MAP_TRANSPARENT_PIXEL);
  for (let y = 0; y < Math.min(fromH, toH); y++) {
    for (let x = 0; x < Math.min(fromW, toW); x++) {
      out[y * toW + x] = input[y * fromW + x] ?? MAP_TRANSPARENT_PIXEL;
    }
  }
  return out;
}

export function spritePixelsToDataUrl(pixels: string[], widthPx: number, heightPx: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, widthPx, heightPx);
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < widthPx; x++) {
      const color = pixels[y * widthPx + x] ?? MAP_TRANSPARENT_PIXEL;
      if (isTransparentPixel(color)) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas.toDataURL('image/png');
}

export { TILE_PX as SPRITE_TILE_PX };
