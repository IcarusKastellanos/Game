/** Drag-and-drop / file-picker image import → pixel arrays for sprite editors. */

import { MAP_TRANSPARENT_PIXEL } from '@witchcraft/shared';

function rgbToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image file'));
    img.src = src;
  });
}

function canvasToHexPixels(canvas: HTMLCanvasElement): string[] {
  const ctx = canvas.getContext('2d')!;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const out: string[] = [];
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a < 24) out.push(MAP_TRANSPARENT_PIXEL);
    else out.push(rgbToHex(data[i]!, data[i + 1]!, data[i + 2]!));
  }
  return out;
}

/** Nearest-neighbor resample of a flat pixel buffer into a new size. */
export function nearestNeighborResizePixels(
  pixels: string[],
  fromW: number,
  fromH: number,
  toW: number,
  toH: number
): string[] {
  const out = Array(toW * toH).fill(MAP_TRANSPARENT_PIXEL) as string[];
  if (fromW <= 0 || fromH <= 0 || toW <= 0 || toH <= 0) return out;
  for (let y = 0; y < toH; y++) {
    const sy = Math.min(fromH - 1, Math.floor(((y + 0.5) * fromH) / toH));
    for (let x = 0; x < toW; x++) {
      const sx = Math.min(fromW - 1, Math.floor(((x + 0.5) * fromW) / toW));
      out[y * toW + x] = pixels[sy * fromW + sx] ?? MAP_TRANSPARENT_PIXEL;
    }
  }
  return out;
}

/**
 * Sample an image into a hex pixel grid.
 * Exact-size imports stay 1:1 (no canvas stretch). Otherwise nearest-neighbor resize.
 */
export function imageElementToPixels(img: HTMLImageElement, widthPx: number, heightPx: number): string[] {
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (srcW <= 0 || srcH <= 0) {
    throw new Error('Image has no pixel dimensions');
  }

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const srcCtx = srcCanvas.getContext('2d')!;
  srcCtx.imageSmoothingEnabled = false;
  srcCtx.clearRect(0, 0, srcW, srcH);
  srcCtx.drawImage(img, 0, 0);
  const native = canvasToHexPixels(srcCanvas);

  if (srcW === widthPx && srcH === heightPx) return native;
  return nearestNeighborResizePixels(native, srcW, srcH, widthPx, heightPx);
}

export async function readImageFileAsPixels(
  file: File,
  widthPx: number,
  heightPx: number
): Promise<string[]> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please drop an image file (PNG, JPG, WebP, GIF)');
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(url);
    return imageElementToPixels(img, widthPx, heightPx);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function imageDropZoneHtml(idPrefix = 'img-drop'): string {
  return `
    <div class="image-drop-zone" id="${idPrefix}-zone" tabindex="0" role="button" aria-label="Drop image to import">
      <input type="file" id="${idPrefix}-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden />
      <p class="image-drop-title">Drop image here</p>
      <p class="muted-text image-drop-hint">PNG, JPG, WebP, or GIF — keeps exact size when it matches; otherwise crisp nearest-neighbor scale</p>
      <button type="button" class="btn secondary image-drop-browse" id="${idPrefix}-browse">Browse image…</button>
    </div>`;
}

export function spriteArtDivider(label = 'or paint pixels'): string {
  return `<div class="sprite-art-divider"><span>${label}</span></div>`;
}

export interface ImageDropImportOptions {
  idPrefix?: string;
  widthPx: () => number;
  heightPx: () => number;
  onImport: (pixels: string[]) => void;
  onError?: (message: string) => void;
}

/** Wire drag/drop + browse on a drop zone; returns cleanup. */
export function mountImageDropImport(
  container: HTMLElement,
  opts: ImageDropImportOptions
): { destroy: () => void } {
  const prefix = opts.idPrefix ?? 'img-drop';
  container.innerHTML = imageDropZoneHtml(prefix);
  const zone = container.querySelector(`#${prefix}-zone`) as HTMLElement;
  const fileInput = container.querySelector(`#${prefix}-file`) as HTMLInputElement;
  const browseBtn = container.querySelector(`#${prefix}-browse`) as HTMLButtonElement;

  const fail = (message: string): void => {
    opts.onError?.(message);
  };

  const importFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      const widthPx = opts.widthPx();
      const heightPx = opts.heightPx();
      if (!(widthPx > 0) || !(heightPx > 0)) {
        throw new Error('Sprite import size is invalid');
      }
      const pixels = await readImageFileAsPixels(file, widthPx, heightPx);
      if (pixels.length !== widthPx * heightPx) {
        throw new Error(`Import produced ${pixels.length} pixels; expected ${widthPx * heightPx}`);
      }
      opts.onImport(pixels);
    } catch (e) {
      fail(String(e));
    }
  };

  const onBrowse = (): void => fileInput.click();
  const onFileChange = (): void => {
    void importFile(fileInput.files?.[0]);
    fileInput.value = '';
  };

  const onDragOver = (e: DragEvent): void => {
    e.preventDefault();
    zone.classList.add('drag-over');
  };
  const onDragLeave = (): void => zone.classList.remove('drag-over');
  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    void importFile(file);
  };

  browseBtn.addEventListener('click', onBrowse);
  fileInput.addEventListener('change', onFileChange);
  zone.addEventListener('dragover', onDragOver);
  zone.addEventListener('dragleave', onDragLeave);
  zone.addEventListener('drop', onDrop);
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onBrowse();
    }
  });

  return {
    destroy: () => {
      browseBtn.removeEventListener('click', onBrowse);
      fileInput.removeEventListener('change', onFileChange);
      zone.removeEventListener('dragover', onDragOver);
      zone.removeEventListener('dragleave', onDragLeave);
      zone.removeEventListener('drop', onDrop);
    },
  };
}
