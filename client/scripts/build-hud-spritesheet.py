#!/usr/bin/env python3
"""Extract practitioner HUD reference into a spaced transparent PNG sprite sheet + manifest."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
REF = ROOT / "src/assets/hud/practitioner-hud-reference.png"
OUT_DIR = ROOT / "src/assets/hud"
SHEET_PATH = OUT_DIR / "practitioner-hud-spritesheet.png"
MANIFEST_PATH = OUT_DIR / "spritesheet-manifest.json"
INDIVIDUAL_DIR = OUT_DIR / "sprites"

PADDING = 20
BLACK_THRESH = 14

# Uniform outer sizes (pixels) — normalized from reference measurements
NAV_W, NAV_H = 120, 191
SLOT_W, SLOT_H = 84, 84
RESOURCE_W, RESOURCE_H = 290, 58


@dataclass
class Asset:
    id: str
    image: Image.Image
    category: str
    notes: str = ""


def load_ref() -> Image.Image:
    return Image.open(REF).convert("RGBA")


def px_alpha(r: int, g: int, b: int, a: int = 255) -> tuple[int, int, int, int]:
    return (r, g, b, a)


def is_near_black(r: int, g: int, b: int) -> bool:
    return r <= BLACK_THRESH and g <= BLACK_THRESH and b <= BLACK_THRESH


def is_bar_fill(r: int, g: int, b: int) -> bool:
    return (
        (r > 40 and g < 35 and b < 35)
        or (b > 60 and r < 80 and g < 100)
        or (g > 50 and r < 60 and b < 60)
    )


def is_bright_text(r: int, g: int, b: int) -> bool:
    return (r > 150 and g > 130) or (b > 140 and r > 100)


def black_to_transparent(img: Image.Image) -> Image.Image:
    out = img.copy()
    px = out.load()
    w, h = out.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if is_near_black(r, g, b):
                px[x, y] = (0, 0, 0, 0)
    return out


def crop(img: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    return img.crop(box)


def clear_box(img: Image.Image, box: tuple[int, int, int, int], pred: Callable[[int, int, int], bool]) -> None:
    px = img.load()
    x0, y0, x1, y1 = box
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b, a = px[x, y]
            if pred(r, g, b):
                px[x, y] = (0, 0, 0, 0)


def clear_non_black_box(img: Image.Image, box: tuple[int, int, int, int]) -> None:
    clear_box(img, box, lambda r, g, b: not is_near_black(r, g, b))


def clear_bar_fills(img: Image.Image, box: tuple[int, int, int, int]) -> None:
    clear_box(img, box, lambda r, g, b: is_bar_fill(r, g, b) or is_bright_text(r, g, b))


def normalize_canvas(img: Image.Image, tw: int, th: int) -> Image.Image:
    canvas = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
    iw, ih = img.size
    ox = (tw - iw) // 2
    oy = (th - ih) // 2
    canvas.paste(img, (ox, oy), img)
    return canvas


def extract_bar_track(bar_img: Image.Image) -> Image.Image:
    track = bar_img.copy()
    w, h = track.size
    # Clear icon column + inner fill, keep gold frame pixels only
    clear_box(track, (0, 0, w, h), lambda r, g, b: is_bar_fill(r, g, b) or is_bright_text(r, g, b))
    clear_box(track, (0, 0, min(42, w), h), lambda r, g, b: not is_near_black(r, g, b))
    inner = (44, 4, max(45, w - 8), max(5, h - 4))
    clear_box(track, inner, lambda r, g, b: not is_near_black(r, g, b))
    return track


def extract_icon(bar_img: Image.Image, icon_w: int = 36) -> Image.Image:
    icon = crop(bar_img, (0, 0, min(icon_w, bar_img.width), bar_img.height))
    return black_to_transparent(icon)


def strip_nav_labels(btn: Image.Image) -> Image.Image:
    out = btn.copy()
    w, h = out.size
    # Label + shortcut live in lower ~45px
    clear_non_black_box(out, (0, int(h * 0.62), w, h))
    return out


def strip_nav_to_template(btn: Image.Image) -> Image.Image:
    out = btn.copy()
    w, h = out.size
    clear_non_black_box(out, (8, 8, w - 8, int(h * 0.62)))
    return out


def strip_resource_value(counter: Image.Image) -> Image.Image:
    out = counter.copy()
    w, h = out.size
    clear_non_black_box(out, (int(w * 0.35), 0, w, h))
    return out


def remove_cardinals(meter: Image.Image) -> Image.Image:
    out = meter.copy()
    w, h = out.size
    # Approximate letter zones on this reference crop
    clear_non_black_box(out, (0, int(h * 0.25), int(w * 0.12), int(h * 0.75)))  # W
    clear_non_black_box(out, (int(w * 0.42), 0, int(w * 0.58), int(h * 0.28)))  # N
    clear_non_black_box(out, (int(w * 0.88), int(h * 0.25), w, int(h * 0.75)))  # E
    return out


def extract_gem(meter: Image.Image) -> Image.Image:
    w, h = meter.size
    gem = crop(meter, (int(w * 0.42), int(h * 0.18), int(w * 0.58), int(h * 0.82)))
    return black_to_transparent(gem)


def extract_tick_track(meter: Image.Image) -> Image.Image:
    w, h = meter.size
    x0, y0, x1, y1 = int(w * 0.08), int(h * 0.38), int(w * 0.92), int(h * 0.62)
    track = crop(meter, (x0, y0, x1, y1))
    tw, th = track.size
    gx0, gy0, gx1, gy1 = int(tw * 0.34), int(th * 0.05), int(tw * 0.66), int(th * 0.95)
    clear_box(track, (gx0, gy0, gx1, gy1), lambda r, g, b: not is_near_black(r, g, b))
    return track


def make_glow_layer(gem: Image.Image, radius: int, alpha: int, tint: tuple[int, int, int]) -> Image.Image:
    """Pixel glow ring — no blur, nearest-neighbor only."""
    w, h = gem.size
    layer = Image.new("RGBA", (w + radius * 4, h + radius * 4), (0, 0, 0, 0))
    cx = layer.width // 2
    cy = layer.height // 2
    px = layer.load()
    tr, tg, tb = tint
    for y in range(layer.height):
        for x in range(layer.width):
            dx = x - cx
            dy = y - cy
            dist = int((dx * dx + dy * dy) ** 0.5)
            if dist <= radius:
                falloff = max(0, 255 - dist * (255 // max(1, radius)))
                a = min(255, int(alpha * falloff / 255))
                if a > 8:
                    px[x, y] = (tr, tg, tb, a)
    # Stamp gem center
    gx = (layer.width - w) // 2
    gy = (layer.height - h) // 2
    layer.paste(gem, (gx, gy), gem)
    return layer


def make_pulse_ring(size: int) -> Image.Image:
    ring = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = ring.load()
    cx = cy = size // 2
    for y in range(size):
        for x in range(size):
            d = int(((x - cx) ** 2 + (y - cy) ** 2) ** 0.5)
            if 18 <= d <= 22:
                px[x, y] = (180, 120, 220, 180)
    return ring


def make_rune_particles(size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = canvas.load()
    points = [(12, 8), (size - 14, 10), (8, size - 12), (size - 10, size - 14), (size // 2, 6)]
    for x, y in points:
        px[x, y] = (220, 180, 255, 220)
        if x + 1 < size:
            px[x + 1, y] = (180, 120, 220, 160)
    return canvas


def split_hotbar(hotbar: Image.Image, slots: int = 5) -> tuple[Image.Image, list[Image.Image]]:
    w, h = hotbar.size
    slot_w = w // slots
    frames = []
    icons = []
    for i in range(slots):
        slot = crop(hotbar, (i * slot_w, 0, (i + 1) * slot_w if i < slots - 1 else w, h))
        frame = slot.copy()
        clear_non_black_box(frame, (6, 6, frame.width - 6, frame.height - 22))
        icons.append(black_to_transparent(slot))
        frames.append(frame)
    return hotbar, frames


def build_assets(ref: Image.Image) -> list[Asset]:
    assets: list[Asset] = []

    # --- Player panel ---
    portrait = black_to_transparent(crop(ref, (5, 6, 180, 216)))
    info = black_to_transparent(crop(ref, (130, 19, 386, 201)))
    info_chrome = info.copy()
    # Blank name / rank / reputation zones
    clear_non_black_box(info_chrome, (int(info.width * 0.02), 0, info.width - 2, int(info.height * 0.28)))
    # Remove baked bars + icons — engine layers bar tracks + symbols separately
    for y0, y1 in ((55, 98), (90, 128), (125, 168)):
        clear_non_black_box(info_chrome, (4, y0, info.width - 4, y1))

    bar1 = crop(ref, (130, 80, 380, 120))
    bar2 = crop(ref, (130, 115, 380, 150))
    bar3 = crop(ref, (130, 150, 380, 190))

    assets += [
        Asset("portrait_frame", portrait, "player", "Hooded portrait + banner; replace inner portrait dynamically."),
        Asset("player_info_panel", info_chrome, "player", "Empty framed panel — no name/rank/reputation/values."),
        Asset("symbol_health", extract_icon(black_to_transparent(bar1)), "symbols"),
        Asset("symbol_magnetic_energy", extract_icon(black_to_transparent(bar2)), "symbols"),
        Asset("symbol_experience", extract_icon(black_to_transparent(bar3)), "symbols"),
        Asset("bar_track_health", extract_bar_track(black_to_transparent(bar1)), "bars"),
        Asset("bar_track_magical_energy", extract_bar_track(black_to_transparent(bar2)), "bars"),
        Asset("bar_track_experience", extract_bar_track(black_to_transparent(bar3)), "bars"),
    ]

    # --- Intuition meter ---
    meter_raw = black_to_transparent(crop(ref, (280, 15, 750, 175)))
    meter = remove_cardinals(meter_raw)
    gem = extract_gem(meter_raw)
    ticks = extract_tick_track(meter_raw)
    frame_only = meter.copy()
    clear_non_black_box(
        frame_only,
        (int(frame_only.width * 0.08), int(frame_only.height * 0.15), int(frame_only.width * 0.92), int(frame_only.height * 0.85)),
    )
    # Remove residual center marker / cardinal remnants
    clear_non_black_box(frame_only, (int(frame_only.width * 0.44), 0, int(frame_only.width * 0.56), int(frame_only.height * 0.35)))

    assets += [
        Asset("intuition_meter_frame", frame_only, "intuition", "No cardinal letters."),
        Asset("intuition_gem", gem, "intuition"),
        Asset("intuition_tick_track", black_to_transparent(ticks), "intuition"),
        Asset("intuition_glow_dormant", gem.copy(), "intuition"),
        Asset("intuition_glow_faint", make_glow_layer(gem, 6, 70, (90, 50, 120)), "intuition"),
        Asset("intuition_glow_aware", make_glow_layer(gem, 12, 120, (130, 70, 170)), "intuition"),
        Asset("intuition_glow_strong", make_glow_layer(gem, 20, 170, (170, 100, 210)), "intuition"),
        Asset("intuition_glow_overwhelming", make_glow_layer(gem, 30, 220, (230, 200, 255)), "intuition"),
        Asset("intuition_rune_particles", make_rune_particles(64), "intuition"),
        Asset("intuition_pulse_ring", make_pulse_ring(64), "intuition"),
    ]

    # --- Resource counters (reference has 3; provide template for 4th) ---
    res_boxes = [(700, 41, 999, 95), (700, 96, 999, 155), (700, 156, 999, 215)]
    res_ids = ["coin_counter", "essence_counter", "favor_counter"]
    counters = []
    for box, rid in zip(res_boxes, res_ids):
        c = black_to_transparent(crop(ref, box))
        counters.append(strip_resource_value(c))
        assets.append(Asset(rid, normalize_canvas(counters[-1], RESOURCE_W, RESOURCE_H), "resources"))
    template = counters[0].copy()
    clear_non_black_box(template, (int(template.width * 0.08), int(template.height * 0.15), int(template.width * 0.32), int(template.height * 0.85)))
    assets.append(Asset("reputation_counter", normalize_canvas(template, RESOURCE_W, RESOURCE_H), "resources", "Template frame; icon area blank."))
    assets.append(Asset("resource_counter_template", normalize_canvas(template, RESOURCE_W, RESOURCE_H), "resources"))

    # --- Navigation buttons ---
    nav_boxes = [
        ("nav_bag", (21, 250, 133, 441)),
        ("nav_grimoire", (162, 250, 277, 441)),
        ("nav_spells", (306, 250, 413, 441)),
        ("nav_social", (444, 250, 556, 441)),
        ("nav_coven", (587, 250, 706, 441)),
        ("nav_teleport", (738, 250, 855, 441)),
        ("nav_map", (884, 250, 998, 441)),
    ]
    first_template = None
    for aid, box in nav_boxes:
        btn = black_to_transparent(crop(ref, box))
        btn_norm = normalize_canvas(btn, NAV_W, NAV_H)
        assets.append(Asset(aid, btn_norm, "navigation"))
        if first_template is None:
            first_template = strip_nav_to_template(btn_norm)
    assets.append(Asset("nav_button_template", first_template or Image.new("RGBA", (NAV_W, NAV_H), (0, 0, 0, 0)), "navigation"))

    # Settings from bottom utility cluster
    settings = black_to_transparent(crop(ref, (887, 486, 1004, 637)))
    assets.append(Asset("nav_settings", normalize_canvas(settings, NAV_W, NAV_H), "navigation", "From bottom gear; normalized to nav size."))

    # --- Hotbar + items ---
    hotbar = black_to_transparent(crop(ref, (14, 486, 450, 630)))
    _, slot_frames = split_hotbar(hotbar)
    assets.append(Asset("hotbar_frame", hotbar, "inventory"))
    for i, sf in enumerate(slot_frames):
        assets.append(Asset(f"inventory_slot_empty_{i + 1}", normalize_canvas(sf, SLOT_W, SLOT_H), "inventory", f"Slot frame {i + 1}."))

    item_boxes = [
        ("icon_potion", (30, 500, 115, 620)),
        ("icon_herb_bundle", (115, 500, 200, 620)),
        ("icon_purple_crystal", (200, 500, 285, 620)),
        ("icon_candle", (285, 500, 370, 620)),
    ]
    for iid, box in item_boxes:
        assets.append(Asset(iid, black_to_transparent(crop(ref, box)), "icons"))

    scroll = black_to_transparent(crop(ref, (602, 486, 736, 637)))
    assets.append(Asset("icon_scroll", scroll, "icons"))

    # Notification / moon — not present on this reference; ship empty framed panel from info style
    notif = info.copy()
    clear_non_black_box(notif, (0, 0, notif.width, notif.height))
    # rebuild minimal empty notification frame from info top border
    info_border = crop(ref, (130, 19, 386, 45))
    notif_panel = Image.new("RGBA", (420, 90), (0, 0, 0, 0))
    notif_panel.paste(black_to_transparent(info_border), (0, 0))
    assets.append(
        Asset(
            "notification_panel_empty",
            notif_panel,
            "misc",
            "Not in reference layout; frame sampled from player panel divider style.",
        )
    )
    assets.append(
        Asset(
            "moon_time_location_panel",
            Image.new("RGBA", (320, 120), (0, 0, 0, 0)),
            "misc",
            "NOT PRESENT in attached reference — placeholder slot only (0×0 usable art).",
        )
    )

    # Decorative corner sample from nav button
    corner = crop(black_to_transparent(crop(ref, nav_boxes[0][1])), (0, 0, 24, 24))
    assets.append(Asset("decor_corner_gold", black_to_transparent(corner), "decor"))
    jewel = crop(ref, (90, 20, 110, 40))
    assets.append(Asset("decor_jewel_purple", black_to_transparent(jewel), "decor"))

    return assets


def pack_sheet(assets: list[Asset]) -> tuple[Image.Image, dict]:
    # Sort for stable layout: tall items first, grouped by category
    order = ["player", "intuition", "resources", "navigation", "inventory", "symbols", "bars", "icons", "decor", "misc"]
    assets_sorted = sorted(assets, key=lambda a: (order.index(a.category) if a.category in order else 99, a.id))

    cols = 8
    rows: list[list[Asset]] = []
    row: list[Asset] = []
    row_h = 0
    for a in assets_sorted:
        _, h = a.image.size
        if len(row) >= cols:
            rows.append(row)
            row = []
            row_h = 0
        row.append(a)
        row_h = max(row_h, h)
    if row:
        rows.append(row)

    row_heights = []
    for row in rows:
        row_heights.append(max(img.image.size[1] for img in row) + PADDING)

    col_widths: list[int] = []
    for c in range(cols):
        mx = 0
        for row in rows:
            if c < len(row):
                mx = max(mx, row[c].image.size[0])
        col_widths.append(mx + PADDING)

    sheet_w = sum(col_widths) + PADDING
    sheet_h = sum(row_heights) + PADDING
    sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))

    manifest: dict = {
        "source": str(REF.relative_to(ROOT)).replace("\\", "/"),
        "sheet": str(SHEET_PATH.relative_to(ROOT)).replace("\\", "/"),
        "padding": PADDING,
        "sizes": {
            "navigation_button": {"w": NAV_W, "h": NAV_H},
            "inventory_slot": {"w": SLOT_W, "h": SLOT_H},
            "resource_counter": {"w": RESOURCE_W, "h": RESOURCE_H},
        },
        "assets": {},
    }

    y = PADDING
    for ri, row in enumerate(rows):
        x = PADDING
        rh = row_heights[ri]
        for ci, asset in enumerate(row):
            cw = col_widths[ci]
            img = asset.image
            iw, ih = img.size
            ox = x + (cw - PADDING - iw) // 2
            oy = y + (rh - PADDING - ih) // 2
            sheet.paste(img, (ox, oy), img)
            manifest["assets"][asset.id] = {
                "x": ox,
                "y": oy,
                "w": iw,
                "h": ih,
                "category": asset.category,
                "notes": asset.notes,
            }
            x += cw
        y += rh

    return sheet, manifest


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    INDIVIDUAL_DIR.mkdir(parents=True, exist_ok=True)

    ref = load_ref()
    assets = build_assets(ref)

    for a in assets:
        out = INDIVIDUAL_DIR / f"{a.id}.png"
        a.image.save(out, "PNG")

    sheet, manifest = pack_sheet(assets)
    sheet.save(SHEET_PATH, "PNG")
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"Wrote {SHEET_PATH} ({sheet.width}x{sheet.height})")
    print(f"Wrote {MANIFEST_PATH} ({len(manifest['assets'])} assets)")
    print(f"Individual PNGs in {INDIVIDUAL_DIR}")


if __name__ == "__main__":
    main()
