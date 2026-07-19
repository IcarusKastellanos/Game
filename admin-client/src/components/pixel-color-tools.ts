/** Replace or delete connected pixel colors in sprite / icon editors. */

import { isTransparentPixel, MAP_TRANSPARENT_PIXEL } from '@witchcraft/shared';

export interface PixelColorToolHandle {
  isEyedropperActive: () => boolean;
  /** Sample canvas tile (x, y) into the source color field. */
  sampleAt: (x: number, y: number) => void;
}

export interface MountPixelColorToolsOptions {
  idPrefix: string;
  getDimensions: () => { widthPx: number; heightPx: number };
  getPixels: () => string[];
  applyPixels: (pixels: string[]) => void;
}

/** Tight match for background — only catches compression noise, not sprite colors. */
const BACKGROUND_TOLERANCE = 10;

export function normalizeEditorColor(color: string | undefined): string {
  if (!color || isTransparentPixel(color)) return MAP_TRANSPARENT_PIXEL;
  let c = color.trim().toLowerCase();
  if (c.startsWith('#') && c.length === 4) {
    c = `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
  }
  return c;
}

export function editorColorsMatch(a: string | undefined, b: string | undefined): boolean {
  return normalizeEditorColor(a) === normalizeEditorColor(b);
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): Rgb | null {
  const c = normalizeEditorColor(hex);
  if (isTransparentPixel(c)) return null;
  if (!c.startsWith('#')) return null;
  const h = c.slice(1);
  if (h.length !== 6) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function colorDistance(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function collectEdgeIndices(widthPx: number, heightPx: number): number[] {
  const edge: number[] = [];
  for (let x = 0; x < widthPx; x++) {
    edge.push(x);
    edge.push((heightPx - 1) * widthPx + x);
  }
  for (let y = 1; y < heightPx - 1; y++) {
    edge.push(y * widthPx);
    edge.push(y * widthPx + widthPx - 1);
  }
  return edge;
}

function cornerIndices(widthPx: number, heightPx: number): number[] {
  return [0, widthPx - 1, (heightPx - 1) * widthPx, (heightPx - 1) * widthPx + widthPx - 1];
}

function rgbNear(a: Rgb, b: Rgb, tolerance: number): boolean {
  return colorDistance(a, b) <= tolerance;
}

/**
 * Guess background from the four corners (typical import padding).
 * Falls back to the most common opaque perimeter color if corners disagree.
 */
export function detectBackgroundColor(
  pixels: string[],
  widthPx: number,
  heightPx: number
): Rgb | null {
  const corners = cornerIndices(widthPx, heightPx)
    .map((i) => hexToRgb(pixels[i] ?? MAP_TRANSPARENT_PIXEL))
    .filter((c): c is Rgb => c !== null);

  if (corners.length >= 2) {
    let bestCluster: Rgb[] = [];
    for (const seed of corners) {
      const cluster = corners.filter((c) => rgbNear(c, seed, BACKGROUND_TOLERANCE));
      if (cluster.length > bestCluster.length) bestCluster = cluster;
    }
    if (bestCluster.length >= 2) {
      return {
        r: Math.round(bestCluster.reduce((s, c) => s + c.r, 0) / bestCluster.length),
        g: Math.round(bestCluster.reduce((s, c) => s + c.g, 0) / bestCluster.length),
        b: Math.round(bestCluster.reduce((s, c) => s + c.b, 0) / bestCluster.length),
      };
    }
    if (corners.length === 1) return corners[0]!;
  }

  const dominant = detectDominantEdgeColor(pixels, widthPx, heightPx);
  return dominant ? hexToRgb(dominant) : null;
}

function pixelSimilarToRef(color: string, ref: Rgb, tolerance: number): boolean {
  const rgb = hexToRgb(color);
  if (!rgb) return false;
  return rgbNear(rgb, ref, tolerance);
}

/**
 * Remove edge-connected pixels similar to `ref` (exact + small tolerance only).
 * Does not touch other colors — preserves sprite art that shares no path of similar pixels to the border.
 */
export function replaceEdgeConnectedSimilarColor(
  pixels: string[],
  widthPx: number,
  heightPx: number,
  ref: Rgb,
  toColor: string,
  tolerance = BACKGROUND_TOLERANCE
): string[] {
  const out = [...pixels];
  const total = widthPx * heightPx;
  const visited = new Uint8Array(total);
  const queue: number[] = [];

  const matches = (index: number): boolean =>
    pixelSimilarToRef(out[index] ?? MAP_TRANSPARENT_PIXEL, ref, tolerance);

  const pushIfMatch = (index: number): void => {
    if (index < 0 || index >= total || visited[index] || !matches(index)) return;
    visited[index] = 1;
    queue.push(index);
  };

  for (const i of collectEdgeIndices(widthPx, heightPx)) pushIfMatch(i);

  while (queue.length) {
    const i = queue.pop()!;
    out[i] = toColor;
    const x = i % widthPx;
    const y = Math.floor(i / widthPx);
    if (x > 0) pushIfMatch(i - 1);
    if (x < widthPx - 1) pushIfMatch(i + 1);
    if (y > 0) pushIfMatch(i - widthPx);
    if (y < heightPx - 1) pushIfMatch(i + widthPx);
  }

  return out;
}

/** Replace every pixel matching `fromColor` with `toColor`. */
export function replaceAllPixelColor(
  pixels: string[],
  fromColor: string,
  toColor: string
): string[] {
  return pixels.map((p) => (editorColorsMatch(p, fromColor) ? toColor : p));
}

/**
 * Remove/replace pixels of `fromColor` that touch the canvas edge (4-connected).
 * Ideal for deleting imported backgrounds while preserving interior islands of the same color.
 */
export function replaceEdgeConnectedPixelColor(
  pixels: string[],
  widthPx: number,
  heightPx: number,
  fromColor: string,
  toColor: string
): string[] {
  const ref = hexToRgb(fromColor);
  if (!ref) return [...pixels];
  return replaceEdgeConnectedSimilarColor(pixels, widthPx, heightPx, ref, toColor, 0);
}

/** Most common opaque color on the canvas perimeter. */
export function detectDominantEdgeColor(
  pixels: string[],
  widthPx: number,
  heightPx: number
): string | null {
  const counts = new Map<string, number>();
  const add = (index: number): void => {
    const c = normalizeEditorColor(pixels[index]);
    if (isTransparentPixel(c)) return;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  };

  for (const i of collectEdgeIndices(widthPx, heightPx)) add(i);

  let best: string | null = null;
  let bestCount = 0;
  for (const [color, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = color;
    }
  }
  return best;
}

/** One-click background removal — corner-detected color, tight tolerance, edge-connected only. */
export function deleteImageBackground(
  pixels: string[],
  widthPx: number,
  heightPx: number
): string[] {
  const ref = detectBackgroundColor(pixels, widthPx, heightPx);
  if (!ref) return [...pixels];

  let out = replaceEdgeConnectedSimilarColor(
    pixels,
    widthPx,
    heightPx,
    ref,
    MAP_TRANSPARENT_PIXEL,
    BACKGROUND_TOLERANCE
  );

  // Second pass for leftover border pixels of the same background (exact corner ref)
  out = replaceEdgeConnectedSimilarColor(
    out,
    widthPx,
    heightPx,
    ref,
    MAP_TRANSPARENT_PIXEL,
    BACKGROUND_TOLERANCE
  );

  return out;
}

export function mountPixelColorTools(
  toolsEl: HTMLElement,
  opts: MountPixelColorToolsOptions
): PixelColorToolHandle {
  const { idPrefix: p } = opts;
  let pickMode = false;
  let sourceColor = '#ffffff';
  let targetColor = MAP_TRANSPARENT_PIXEL;
  let deleteMode = true;
  let panelOpen = false;

  const panelId = `${p}-color-panel`;
  if (!toolsEl.querySelector(`#${p}-color-tool`)) {
    toolsEl.insertAdjacentHTML(
      'beforeend',
      `<button type="button" class="btn secondary" id="${p}-delete-bg" title="Remove edge-connected background (detects corner color, tight match)">Delete Background</button>
      <button type="button" class="btn secondary" id="${p}-color-tool">Replace / Delete Color</button>
      <div class="pixel-color-panel hidden" id="${panelId}">
        <div class="pixel-color-row">
          <label class="pixel-color-label">Source
            <input type="color" id="${p}-src-color" value="#ffffff" />
          </label>
          <button type="button" class="btn secondary btn-sm" id="${p}-pick-src" title="Pick source color from canvas">Eyedropper</button>
        </div>
        <div class="pixel-color-row">
          <label class="pixel-color-label">
            <input type="checkbox" id="${p}-delete-mode" checked /> Delete (transparent)
          </label>
          <label class="pixel-color-label pixel-color-target">Target
            <input type="color" id="${p}-dst-color" value="#7b5ea7" disabled />
          </label>
        </div>
        <div class="pixel-color-row">
          <label class="pixel-color-label">Mode
            <select id="${p}-color-mode">
              <option value="all">Replace all matching pixels</option>
              <option value="connected" selected>Connected from edges only (background)</option>
            </select>
          </label>
        </div>
        <div class="pixel-color-row">
          <button type="button" class="btn primary btn-sm" id="${p}-apply-color">Apply</button>
          <button type="button" class="btn secondary btn-sm" id="${p}-close-color">Close</button>
        </div>
        <p class="muted-text pixel-color-hint">Use <em>Connected from edges</em> with the eyedropper to remove a specific background color without touching interior pixels of that color.</p>
      </div>`
    );
  }

  const panel = toolsEl.querySelector(`#${panelId}`) as HTMLElement;
  const srcInput = toolsEl.querySelector(`#${p}-src-color`) as HTMLInputElement;
  const dstInput = toolsEl.querySelector(`#${p}-dst-color`) as HTMLInputElement;
  const deleteCheckbox = toolsEl.querySelector(`#${p}-delete-mode`) as HTMLInputElement;
  const modeSelect = toolsEl.querySelector(`#${p}-color-mode`) as HTMLSelectElement;
  const pickBtn = toolsEl.querySelector(`#${p}-pick-src`) as HTMLButtonElement;

  const syncTargetEnabled = (): void => {
    deleteMode = deleteCheckbox.checked;
    dstInput.disabled = deleteMode;
    targetColor = deleteMode ? MAP_TRANSPARENT_PIXEL : dstInput.value;
  };

  const togglePanel = (open?: boolean): void => {
    panelOpen = open ?? !panelOpen;
    panel.classList.toggle('hidden', !panelOpen);
    if (!panelOpen) {
      pickMode = false;
      pickBtn.classList.remove('active');
    }
  };

  toolsEl.querySelector(`#${p}-color-tool`)!.addEventListener('click', () => togglePanel());

  toolsEl.querySelector(`#${p}-delete-bg`)!.addEventListener('click', () => {
    const { widthPx, heightPx } = opts.getDimensions();
    const next = deleteImageBackground(opts.getPixels(), widthPx, heightPx);
    opts.applyPixels(next);
  });

  toolsEl.querySelector(`#${p}-close-color`)!.addEventListener('click', () => togglePanel(false));

  srcInput.addEventListener('input', () => {
    sourceColor = srcInput.value;
  });

  dstInput.addEventListener('input', () => {
    if (!deleteMode) targetColor = dstInput.value;
  });

  deleteCheckbox.addEventListener('change', syncTargetEnabled);

  pickBtn.addEventListener('click', () => {
    pickMode = !pickMode;
    pickBtn.classList.toggle('active', pickMode);
    if (pickMode) togglePanel(true);
  });

  toolsEl.querySelector(`#${p}-apply-color`)!.addEventListener('click', () => {
    const { widthPx, heightPx } = opts.getDimensions();
    const from = normalizeEditorColor(sourceColor);
    const to = deleteMode ? MAP_TRANSPARENT_PIXEL : normalizeEditorColor(targetColor);
    const current = opts.getPixels();
    const mode = modeSelect.value;

    const next =
      mode === 'connected'
        ? replaceEdgeConnectedPixelColor(current, widthPx, heightPx, from, to)
        : replaceAllPixelColor(current, from, to);

    opts.applyPixels(next);
  });

  syncTargetEnabled();

  return {
    isEyedropperActive: () => pickMode,
    sampleAt: (x, y) => {
      const { widthPx, heightPx } = opts.getDimensions();
      if (x < 0 || y < 0 || x >= widthPx || y >= heightPx) return;
      const px = opts.getPixels()[y * widthPx + x] ?? MAP_TRANSPARENT_PIXEL;
      if (isTransparentPixel(px)) {
        sourceColor = MAP_TRANSPARENT_PIXEL;
        srcInput.value = '#000000';
        srcInput.title = 'Transparent';
      } else {
        sourceColor = normalizeEditorColor(px);
        srcInput.value = sourceColor.length === 9 ? sourceColor.slice(0, 7) : sourceColor;
        srcInput.title = sourceColor;
      }
      pickMode = false;
      pickBtn.classList.remove('active');
    },
  };
}
