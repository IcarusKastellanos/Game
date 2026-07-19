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

/** Scale an image to target size with nearest-neighbor sampling into hex pixel rows. */
export function imageElementToPixels(img: HTMLImageElement, widthPx: number, heightPx: number): string[] {
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, widthPx, heightPx);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, widthPx, heightPx);
  const data = ctx.getImageData(0, 0, widthPx, heightPx).data;
  const out: string[] = [];
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a < 24) out.push(MAP_TRANSPARENT_PIXEL);
    else out.push(rgbToHex(data[i]!, data[i + 1]!, data[i + 2]!));
  }
  return out;
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
      <p class="muted-text image-drop-hint">PNG, JPG, WebP, or GIF — scaled to fit with crisp pixels</p>
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
      const pixels = await readImageFileAsPixels(file, opts.widthPx(), opts.heightPx());
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
