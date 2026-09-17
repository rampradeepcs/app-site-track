"""
The two drawn assets Google Play asks for.

Both are built from the same path data the app's Brand component and the
marketing site's favicon already use, so the mark on the store page is the
same mark as everywhere else rather than a re-trace of it.

    python3 scripts/play/make-play-assets.py

Writes dist/play-assets/icon-512.png and dist/play-assets/feature-1024x500.png.
"""
import os
import re

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "dist", "play-assets")

# Verbatim from Mark.tsx: box 820x340 at (90,330).
PATHS = [
    "M103 345H192.521L286.537 507.232L317.224 453.285L357.685 523.651L281.846 654.805L103 345Z",
    "M281.846 345H371.367L461.279 499.805L506.039 422.598L461.279 345H896.178L852.004 422.598H595.56L460.693 654.805L281.846 345Z",
    "M640.32 499.218H814.084L768.737 577.011H685.08L640.515 655L595.364 577.207L640.32 499.218Z",
]
BOX_X, BOX_Y, BOX_W, BOX_H = 90, 330, 820, 340

INK = (10, 10, 10)        # #0a0a0a, the site's ground
PAPER = (255, 255, 255)
AMBER = (255, 159, 10)    # #ff9f0a, the one accent
SS = 8                    # supersample, then resolve down


def polygons(d):
    """Path data to point lists. Only M, H, L and Z occur in this mark."""
    out, cur, x, y = [], [], 0.0, 0.0
    for cmd, args in re.findall(r"([MHLZ])([^MHLZ]*)", d):
        nums = [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", args)]
        if cmd == "M":
            if cur:
                out.append(cur)
            x, y = nums[0], nums[1]
            cur = [(x, y)]
        elif cmd == "H":
            x = nums[0]
            cur.append((x, y))
        elif cmd == "L":
            for i in range(0, len(nums), 2):
                x, y = nums[i], nums[i + 1]
                cur.append((x, y))
        elif cmd == "Z":
            if cur:
                out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return out


def draw_mark(d, cx, cy, width, fill):
    """The mark, centred on (cx, cy) and `width` wide, in supersampled space."""
    scale = width / BOX_W
    ox = cx - (BOX_X + BOX_W / 2) * scale
    oy = cy - (BOX_Y + BOX_H / 2) * scale
    for path in PATHS:
        for poly in polygons(path):
            d.polygon([(px * scale + ox, py * scale + oy) for px, py in poly], fill=fill)


def icon(size=512):
    """
    Square, full-bleed, no transparency.

    Play draws its own rounded mask over whatever it is given, so a
    transparent or pre-rounded icon shows its corners cut twice. This is a
    flat black square with the mark sitting at 64% of the width — smaller
    than it wants to be, because Play's mask eats the edges.
    """
    S = size * SS
    im = Image.new("RGB", (S, S), INK)
    d = ImageDraw.Draw(im)
    draw_mark(d, S / 2, S / 2, S * 0.64, PAPER)
    return im.resize((size, size), Image.LANCZOS)


def feature(w=1024, h=500):
    """
    The banner above the listing.

    Play overlays the app icon and title on this at some sizes and crops it
    at others, so the middle is left alone and nothing that matters goes
    near an edge. One amber rule for the accent, and no words: text baked
    into a feature graphic cannot be translated and is usually covered.
    """
    W, H = w * SS, h * SS
    im = Image.new("RGB", (W, H), INK)
    d = ImageDraw.Draw(im)

    # A faint amber wash along the lower edge — the accent, kept quiet.
    for i in range(int(H * 0.22)):
        t = i / (H * 0.22)
        y = H - 1 - i
        shade = tuple(int(INK[c] + (AMBER[c] - INK[c]) * 0.10 * (1 - t)) for c in range(3))
        d.line([(0, y), (W, y)], fill=shade)

    # The rule itself, thin and full width.
    d.rectangle([0, H - int(H * 0.012), W, H], fill=AMBER)

    draw_mark(d, W / 2, H * 0.46, W * 0.34, PAPER)
    return im.resize((w, h), Image.LANCZOS)


os.makedirs(OUT, exist_ok=True)

p = os.path.join(OUT, "icon-512.png")
icon().save(p, optimize=True)
print(f"icon-512.png          512x512   {os.path.getsize(p) // 1024} KB")

p = os.path.join(OUT, "feature-1024x500.png")
feature().save(p, optimize=True)
print(f"feature-1024x500.png  1024x500  {os.path.getsize(p) // 1024} KB")
