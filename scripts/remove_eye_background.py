"""Key out the baked light-gray checkerboard background from the intuition eye.

Edge-seeded flood fill: only background connected to the image border becomes
transparent, so light details enclosed by the artwork are preserved. Pure PIL
(no numpy/scipy dependency).
"""
from collections import deque

from PIL import Image

SRC = 'client/src/assets/hud/sprites/intuition_eye.png'


def is_background(px):
    r, g, b = px[0], px[1], px[2]
    mx = max(r, g, b)
    mn = min(r, g, b)
    return mn > 232 and (mx - mn) < 16


def main():
    im = Image.open(SRC).convert('RGBA')
    w, h = im.size
    data = list(im.getdata())
    n = w * h

    bg = bytearray(n)
    for i in range(n):
        if is_background(data[i]):
            bg[i] = 1

    visited = bytearray(n)
    dq = deque()

    def seed(i):
        if bg[i] and not visited[i]:
            visited[i] = 1
            dq.append(i)

    for x in range(w):
        seed(x)                 # top row
        seed((h - 1) * w + x)   # bottom row
    for y in range(h):
        seed(y * w)             # left col
        seed(y * w + (w - 1))   # right col

    while dq:
        i = dq.popleft()
        x = i % w
        y = i // w
        if x > 0:
            seed(i - 1)
        if x < w - 1:
            seed(i + 1)
        if y > 0:
            seed(i - w)
        if y < h - 1:
            seed(i + w)

    removed = 0
    for i in range(n):
        if visited[i]:
            r, g, b, _ = data[i]
            data[i] = (r, g, b, 0)
            removed += 1

    im.putdata(data)
    im.save(SRC)
    print(f'removed {removed} background px of {n}')


if __name__ == '__main__':
    main()
