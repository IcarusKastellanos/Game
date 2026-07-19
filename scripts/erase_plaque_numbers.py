from PIL import Image

SPRITES = ['resource_coin.png', 'resource_essence.png', 'resource_favor.png']
DIR = 'client/src/assets/hud/sprites/'


def lum(r, g, b):
    return 0.299 * r + 0.587 * g + 0.114 * b


def erase(name):
    im = Image.open(DIR + name).convert('RGBA')
    W, H = im.size
    px = im.load()

    # Recessed panel interior (kept clear of the gold frame border).
    x0, x1 = 116, W - 16
    y0, y1 = 11, H - 11
    # Full number recess to flat-fill so no ghost of the baked "00" remains.
    xd0, xd1 = 120, W - 18

    for y in range(y0, y1):
        # Median of the dark background pixels in this row -> panel base color.
        darks = sorted(
            (lum(*px[x, y][:3]), px[x, y][:3])
            for x in range(x0, x1)
            if px[x, y][3] > 40
        )
        if darks:
            # take darkest ~55% as background reference
            k = max(1, int(len(darks) * 0.55))
            sample = [c for _, c in darks[:k]]
            mr = sum(c[0] for c in sample) // len(sample)
            mg = sum(c[1] for c in sample) // len(sample)
            mb = sum(c[2] for c in sample) // len(sample)
        else:
            mr, mg, mb = 12, 9, 7

        for x in range(xd0, xd1):
            r, g, b, a = px[x, y]
            if a <= 40:
                continue
            px[x, y] = (mr, mg, mb, a)

    im.save(DIR + name)
    print('erased', name, im.size)


for n in SPRITES:
    erase(n)
