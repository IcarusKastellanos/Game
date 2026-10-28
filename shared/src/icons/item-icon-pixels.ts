/** 32×32 procedural item icons — shared by game client and admin editor.
 * Drawers author against a logical 16×16 grid; each logical pixel is 2×2 on the sheet.
 */

export const ICON_PIXEL_SIZE = 32;
export const ICON_PIXEL_COUNT = ICON_PIXEL_SIZE * ICON_PIXEL_SIZE;
/** Logical art grid used by drawer helpers (scaled ×2 onto ICON_PIXEL_SIZE). */
const LOGICAL_ICON_SIZE = 16;
const ICON_ART_SCALE = ICON_PIXEL_SIZE / LOGICAL_ICON_SIZE;

const C = {
  bg: '#1a1025',
  out: '#3d3654',
  green: '#3a8a3a',
  greenD: '#2a6a2a',
  greenL: '#7bc96f',
  white: '#e8e0f0',
  paper: '#e8dcc8',
  paperD: '#c4a574',
  black: '#1a1018',
  grey: '#888899',
  greyD: '#606070',
  iron: '#9090a8',
  ironD: '#707080',
  rust: '#8b5a3c',
  red: '#cc4444',
  redD: '#882222',
  blue: '#4488cc',
  eye: '#88ccff',
  yellow: '#ffeeaa',
  orange: '#ff8844',
  brown: '#5c4033',
  brownL: '#8b6914',
  tan: '#b49070',
  purple: '#7b5ea7',
  glow: '#aaff88',
  pink: '#cc8866',
  gold: '#c9a227',
  cream: '#f5eedd',
} as const satisfies Record<string, string>;

type Px = string[];
type Drawer = (p: Px, id: string, category: string, name: string) => void;

function canvas(): Px {
  return Array(ICON_PIXEL_COUNT).fill(C.bg);
}

function px(p: Px, x: number, y: number, color: string): void {
  if (x < 0 || x >= LOGICAL_ICON_SIZE || y < 0 || y >= LOGICAL_ICON_SIZE) return;
  const sx = Math.floor(x) * ICON_ART_SCALE;
  const sy = Math.floor(y) * ICON_ART_SCALE;
  for (let dy = 0; dy < ICON_ART_SCALE; dy++) {
    for (let dx = 0; dx < ICON_ART_SCALE; dx++) {
      p[(sy + dy) * ICON_PIXEL_SIZE + (sx + dx)] = color;
    }
  }
}

function rect(p: Px, x: number, y: number, w: number, h: number, color: string): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) px(p, x + dx, y + dy, color);
  }
}

function outlineRect(p: Px, x: number, y: number, w: number, h: number, fill: string, edge: string = C.out): void {
  rect(p, x, y, w, h, fill);
  for (let i = 0; i < w; i++) {
    px(p, x + i, y, edge);
    px(p, x + i, y + h - 1, edge);
  }
  for (let i = 0; i < h; i++) {
    px(p, x, y + i, edge);
    px(p, x + w - 1, y + i, edge);
  }
}

function drawHerbSprig(p: Px, leafColor: string, stemColor: string): void {
  rect(p, 7, 12, 2, 3, stemColor);
  rect(p, 5, 10, 2, 2, leafColor);
  rect(p, 9, 9, 2, 2, leafColor);
  rect(p, 6, 7, 2, 2, leafColor);
  rect(p, 8, 6, 2, 2, leafColor);
  rect(p, 7, 4, 2, 2, leafColor);
  px(p, 7, 3, leafColor);
}

function drawCandle(p: Px, body: string, flame: string, wick: string = C.black): void {
  outlineRect(p, 6, 5, 4, 9, body);
  px(p, 7, 4, wick);
  px(p, 8, 4, wick);
  px(p, 7, 3, flame);
  px(p, 8, 3, flame);
  px(p, 7, 2, C.yellow);
  px(p, 8, 2, C.orange);
}

const ITEM_DRAWERS: Record<string, Drawer> = {
  rosemary: (p) => {
    drawHerbSprig(p, C.greenL, C.greenD);
    px(p, 5, 9, C.green);
    px(p, 9, 8, C.green);
  },
  sage: (p) => {
    rect(p, 5, 8, 6, 5, C.greenD);
    rect(p, 6, 5, 4, 4, C.grey);
    px(p, 6, 4, C.greenL);
    px(p, 9, 4, C.greenL);
  },
  bay_leaf: (p) => {
    rect(p, 7, 11, 2, 3, C.greenD);
    for (let i = 0; i < 7; i++) {
      px(p, 5 + (i % 2), 10 - i, C.green);
      px(p, 6 + (i % 2), 10 - i, C.greenL);
    }
  },
  black_candle: (p) => drawCandle(p, C.black, C.purple, C.grey),
  white_candle: (p) => drawCandle(p, C.white, C.yellow),
  red_candle: (p) => drawCandle(p, C.red, C.orange),
  frankincense: (p) => {
    outlineRect(p, 4, 10, 8, 4, C.tan);
    px(p, 5, 9, C.cream);
    px(p, 8, 8, C.cream);
    px(p, 10, 9, C.tan);
    px(p, 6, 7, C.cream);
    px(p, 9, 6, C.paper);
  },
  myrrh: (p) => {
    outlineRect(p, 4, 10, 8, 4, C.brown);
    rect(p, 5, 7, 3, 3, C.rust);
    rect(p, 9, 8, 3, 2, C.brownL);
    px(p, 7, 6, C.rust);
  },
  iron_nail: (p) => {
    rect(p, 7, 3, 2, 10, C.iron);
    rect(p, 6, 11, 4, 2, C.ironD);
    px(p, 7, 2, C.grey);
    px(p, 8, 2, C.grey);
  },
  salt: (p) => {
    outlineRect(p, 3, 9, 10, 5, C.greyD);
    for (let i = 0; i < 12; i++) {
      px(p, 4 + (i % 4) * 2, 10 + Math.floor(i / 4), C.white);
    }
  },
  poppet_cloth: (p) => {
    rect(p, 6, 4, 4, 3, C.paper);
    rect(p, 5, 7, 6, 5, C.paper);
    rect(p, 4, 12, 2, 3, C.paperD);
    rect(p, 10, 12, 2, 3, C.paperD);
    px(p, 7, 5, C.pink);
    px(p, 8, 5, C.pink);
  },
  written_petition: (p) => {
    outlineRect(p, 4, 3, 8, 11, C.paper);
    for (let i = 0; i < 4; i++) rect(p, 5, 5 + i * 2, 6, 1, C.paperD);
  },
  evil_eye_bead: (p) => {
    px(p, 7, 7, C.blue);
    px(p, 8, 7, C.blue);
    px(p, 6, 8, C.blue);
    px(p, 9, 8, C.blue);
    rect(p, 7, 8, 2, 2, C.white);
    px(p, 7, 9, C.black);
    px(p, 8, 8, C.eye);
  },
  horseshoe: (p) => {
    rect(p, 4, 6, 2, 6, C.iron);
    rect(p, 10, 6, 2, 6, C.iron);
    rect(p, 5, 5, 6, 2, C.rust);
    rect(p, 6, 11, 4, 1, C.rust);
  },
  bread: (p) => {
    outlineRect(p, 3, 8, 10, 5, C.brownL);
    rect(p, 4, 7, 8, 2, C.brownL);
    px(p, 5, 7, C.cream);
    px(p, 8, 7, C.cream);
  },
  herbal_tea: (p) => {
    outlineRect(p, 4, 9, 8, 5, C.white);
    rect(p, 5, 8, 6, 2, C.greenL);
    px(p, 6, 5, C.grey);
    px(p, 8, 4, C.grey);
    px(p, 7, 3, C.grey);
  },
  book_folk_magic: (p) => {
    outlineRect(p, 4, 4, 8, 10, C.brown);
    rect(p, 5, 5, 6, 8, C.paper);
    rect(p, 5, 6, 5, 1, C.purple);
    rect(p, 5, 8, 4, 1, C.gold);
  },
  grimoire_manuscript: (p) => {
    outlineRect(p, 3, 3, 10, 11, C.brown);
    rect(p, 4, 4, 8, 9, C.paper);
    rect(p, 5, 6, 6, 1, C.purple);
    rect(p, 5, 8, 5, 1, C.grey);
    rect(p, 5, 10, 4, 1, C.grey);
    px(p, 11, 5, C.gold);
  },
  familiar_food: (p) => {
    outlineRect(p, 3, 9, 10, 5, C.brownL);
    rect(p, 5, 7, 6, 3, C.red);
    px(p, 6, 6, C.redD);
    px(p, 8, 6, C.redD);
  },
  familiar_knot: (p) => {
    rect(p, 4, 7, 8, 2, C.red);
    rect(p, 6, 5, 2, 6, C.redD);
    rect(p, 8, 6, 2, 4, C.red);
    px(p, 7, 8, C.redD);
  },
  cat_food: (p) => {
    outlineRect(p, 4, 6, 8, 8, C.greyD);
    rect(p, 5, 7, 6, 5, C.brownL);
    rect(p, 6, 4, 4, 2, C.grey);
    px(p, 7, 8, C.orange);
  },
  taglock_hair: (p) => {
    px(p, 7, 3, C.pink);
    px(p, 8, 4, C.pink);
    px(p, 6, 5, C.pink);
    px(p, 9, 6, C.pink);
    px(p, 7, 7, C.pink);
    px(p, 8, 9, C.pink);
    px(p, 6, 11, C.pink);
    px(p, 9, 12, C.pink);
  },
  taglock_written_name: (p) => {
    outlineRect(p, 4, 4, 8, 10, C.paper);
    rect(p, 5, 6, 6, 1, C.redD);
    rect(p, 5, 8, 6, 1, C.redD);
    rect(p, 5, 10, 4, 1, C.redD);
  },
  taglock_personal_item: (p) => {
    outlineRect(p, 6, 5, 4, 6, C.gold);
    rect(p, 7, 10, 2, 3, C.gold);
    px(p, 7, 6, C.yellow);
  },
  taglock_blood: (p) => {
    outlineRect(p, 6, 4, 4, 10, C.grey);
    rect(p, 7, 7, 2, 5, C.red);
    px(p, 7, 5, C.redD);
    rect(p, 7, 12, 2, 1, C.ironD);
  },
  rusty_nail: (p) => {
    rect(p, 7, 3, 2, 10, C.rust);
    rect(p, 6, 11, 4, 2, C.brown);
    px(p, 7, 2, C.rust);
    px(p, 8, 4, C.brownL);
  },
  glass_shard: (p) => {
    px(p, 8, 3, C.eye);
    px(p, 7, 4, C.blue);
    px(p, 8, 5, C.grey);
    px(p, 9, 6, C.eye);
    px(p, 8, 7, C.blue);
    px(p, 7, 8, C.grey);
    px(p, 6, 9, C.white);
    px(p, 8, 10, C.grey);
  },
  everweed: (p) => {
    drawHerbSprig(p, C.glow, C.greenD);
    px(p, 7, 2, C.yellow);
    px(p, 6, 3, C.glow);
    px(p, 8, 3, C.glow);
  },
};

const CATEGORY_DRAWERS: Record<string, Drawer> = {
  herbs: (p) => drawHerbSprig(p, C.green, C.greenD),
  candles: (p) => drawCandle(p, C.yellow, C.orange),
  incense: (p) => ITEM_DRAWERS.frankincense!(p, '', '', ''),
  minerals: (p) => ITEM_DRAWERS.salt!(p, '', '', ''),
  tools: (p) => {
    rect(p, 7, 3, 2, 10, C.brownL);
    rect(p, 5, 12, 6, 2, C.brown);
  },
  poppets: (p) => ITEM_DRAWERS.poppet_cloth!(p, '', '', ''),
  written_petitions: (p) => ITEM_DRAWERS.written_petition!(p, '', '', ''),
  familiar_care: (p) => ITEM_DRAWERS.familiar_food!(p, '', '', ''),
  offerings: (p) => {
    outlineRect(p, 4, 10, 8, 4, C.brownL);
    px(p, 7, 8, C.red);
  },
  charms: (p) => {
    px(p, 7, 7, C.gold);
    px(p, 8, 7, C.gold);
    rect(p, 6, 8, 4, 2, C.gold);
  },
  food: (p) => ITEM_DRAWERS.bread!(p, '', '', ''),
  medicine: (p) => ITEM_DRAWERS.herbal_tea!(p, '', '', ''),
  books: (p) => ITEM_DRAWERS.book_folk_magic!(p, '', '', ''),
  oils: (p) => {
    outlineRect(p, 6, 4, 4, 10, C.gold);
    rect(p, 7, 5, 2, 7, C.yellow);
  },
};

function drawGenericItem(p: Px, _id: string, category: string): void {
  const fill = category === 'herbs' ? C.green : category === 'candles' ? C.yellow : C.purple;
  outlineRect(p, 4, 4, 8, 8, fill);
}

/** Generate a 32×32 #rrggbb pixel array for an item */
export function generateItemIconPixels(itemId: string, category: string, name = itemId): string[] {
  const p = canvas();
  const drawer = ITEM_DRAWERS[itemId] ?? CATEGORY_DRAWERS[category] ?? drawGenericItem;
  drawer(p, itemId, category, name);
  return p;
}

/** Use stored pixels or generate the canonical default icon */
export function resolveItemIconPixels(item: {
  id: string;
  category: string;
  name?: string;
  iconPixels?: string[];
}): string[] {
  if (item.iconPixels?.length === ICON_PIXEL_COUNT) return item.iconPixels;
  return generateItemIconPixels(item.id, item.category, item.name ?? item.id);
}
