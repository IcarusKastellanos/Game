import { mountSpritePixelEditor, spritePixelsToDataUrl, SPRITE_TILE_PX } from '../components/sprite-pixel-editor.js';

import { mountImageDropImport, spriteArtDivider } from '../components/image-import.js';

import { showToast } from './toast.js';

import { rasterizeBuiltinSprite, registerCustomSprite } from './tile-renderer.js';



export interface MapSpritePanelOptions {

  initialPixels?: string[];

  widthTiles?: () => number;

  heightTiles?: () => number;

  spriteRef: () => string;

  fillColor: () => string;

  onPixelsChange?: (pixels: string[]) => void;

}



export interface MapSpritePanelHandle {

  getPixels: () => string[];

  setPixels: (pixels: string[]) => void;

  syncDimensions: () => void;

  loadBuiltin: () => void;

  updatePreview: () => void;

}



export function spriteEditorPanelHtml(previewId = 'asset-sprite-preview'): string {

  return `

    <div class="card editor-preview mb-sprite-panel">

      <h2 class="mb-sprite-size-title">16×16 Sprite</h2>

      <p class="muted-text">Drop an image to import, or paint pixels in the editor below.</p>

      <div id="asset-sprite-drop"></div>

      ${spriteArtDivider('or paint pixels')}

      <div id="asset-sprite-editor"></div>

      <img id="${previewId}" class="icon-preview-img mt" alt="sprite preview" />

    </div>`;

}



export function mountMapSpritePanel(

  overlay: HTMLElement,

  opts: MapSpritePanelOptions

): MapSpritePanelHandle {

  const dropHost = overlay.querySelector('#asset-sprite-drop') as HTMLElement;

  const host = overlay.querySelector('#asset-sprite-editor') as HTMLElement;

  const preview = overlay.querySelector('#asset-sprite-preview') as HTMLImageElement;

  const titleEl = overlay.querySelector('.mb-sprite-size-title');

  const widthTiles = () => Math.max(1, opts.widthTiles?.() ?? 1);

  const heightTiles = () => Math.max(1, opts.heightTiles?.() ?? 1);

  const widthPx = () => widthTiles() * SPRITE_TILE_PX;

  const heightPx = () => heightTiles() * SPRITE_TILE_PX;



  const syncTitle = (): void => {

    if (titleEl) titleEl.textContent = `${widthPx()}×${heightPx()} Sprite`;

  };



  let currentPixels = opts.initialPixels ?? [];



  const applyPixels = (px: string[]): void => {

    currentPixels = px;

    editor.setPixels(px);

    updatePreview();

    registerCustomSprite(opts.spriteRef(), px, widthPx(), heightPx());

    opts.onPixelsChange?.(px);

  };



  const updatePreview = (): void => {

    preview.src = spritePixelsToDataUrl(currentPixels, widthPx(), heightPx());

  };



  const editor = mountSpritePixelEditor(host, {

    widthPx: widthPx(),

    heightPx: heightPx(),

    initial: currentPixels,

    onChange: (px) => {

      currentPixels = px;

      updatePreview();

      registerCustomSprite(opts.spriteRef(), px, widthPx(), heightPx());

      opts.onPixelsChange?.(px);

    },

  });



  const dropImport = mountImageDropImport(dropHost, {

    idPrefix: 'asset-sprite',

    widthPx,

    heightPx,

    onImport: applyPixels,

    onError: (msg) => showToast(msg, 'error'),

  });



  if (!currentPixels.length) {

    const builtin = rasterizeBuiltinSprite(opts.spriteRef(), widthTiles(), heightTiles());

    if (builtin) applyPixels(builtin);

  } else {

    registerCustomSprite(opts.spriteRef(), currentPixels, widthPx(), heightPx());

    updatePreview();

  }

  syncTitle();



  host.addEventListener('sprite-fill-category', () => {

    const fill = opts.fillColor();

    const px = Array(widthPx() * heightPx()).fill(fill);

    applyPixels(px);

  });



  host.addEventListener('sprite-load-builtin', () => {

    const ref = opts.spriteRef().trim();

    if (!ref) return;

    const builtin = rasterizeBuiltinSprite(ref, widthTiles(), heightTiles());

    if (builtin) applyPixels(builtin);

  });



  overlay.addEventListener('remove', () => dropImport.destroy());



  return {

    getPixels: () => editor.getPixels(),

    setPixels: (px) => applyPixels(px),

    syncDimensions: () => {

      editor.resize(widthPx(), heightPx());

      syncTitle();

      updatePreview();

    },

    loadBuiltin: () => {

      const ref = opts.spriteRef().trim();

      if (!ref) return;

      const builtin = rasterizeBuiltinSprite(ref, widthTiles(), heightTiles());

      if (builtin) applyPixels(builtin);

    },

    updatePreview,

  };

}



export function assetModalBody(formHtml: string): string {

  return `

    <div class="editor-split mb-asset-modal">

      <div class="editor-form">${formHtml}</div>

      ${spriteEditorPanelHtml()}

    </div>`;

}



export function readProperties(raw: unknown): Record<string, unknown> {

  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { ...(raw as Record<string, unknown>) };

  return {};

}



export function readData(raw: unknown): Record<string, unknown> {

  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { ...(raw as Record<string, unknown>) };

  return {};

}



export function spriteThumbHtml(spriteRef: string, pixels?: string[], widthTiles = 1, heightTiles = 1): string {

  const w = widthTiles * SPRITE_TILE_PX;

  const h = heightTiles * SPRITE_TILE_PX;

  let src: string;

  if (pixels?.length) {

    src = spritePixelsToDataUrl(pixels, w, h);

  } else {

    const builtin = rasterizeBuiltinSprite(spriteRef, widthTiles, heightTiles);

    src = builtin ? spritePixelsToDataUrl(builtin, w, h) : '';

  }

  if (!src) return '<span class="muted-text">—</span>';

  return `<img src="${src}" class="mb-sprite-thumb" alt="" width="${Math.min(w, 32)}" height="${Math.min(h, 32)}" />`;

}


