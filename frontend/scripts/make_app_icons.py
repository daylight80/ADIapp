"""Builds the app's icon files from the master artwork: a square image that runs edge to edge
(assets/images/app-icon-master.jpg, 2000x2000). Run from frontend/:

    python scripts/make_app_icons.py assets/images/app-icon-master.jpg

Writes into assets/images/:
  icon.png                 1024  the artwork, edge to edge (iOS and Android round or mask it themselves)
  adaptive-icon.png        1024  Android adaptive foreground: the artwork inside the launcher's safe zone
  adaptive-monochrome.png  1024  Android 13 themed icon: a white silhouette
  splash-icon.png          1024  the artwork with rounded corners, shown on the black splash screen
  favicon.png               256  browser tab icon
  notification-icon.png     256  Android status-bar icon: white on transparent (Android tints it)

app.json's adaptiveIcon.backgroundColor should match the artwork's edge colour (#0A2147).
"""
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC = sys.argv[1]
OUT = 'assets/images/'

art = Image.open(SRC).convert('RGB')
W = art.width  # 2000
assert art.width == art.height, 'the master must be square'

# 1. The artwork, edge to edge
art.resize((1024, 1024), Image.LANCZOS).save(OUT + 'icon.png', optimize=True)

# 2. Adaptive foreground: the artwork at 840 px, centred on a transparent 1024 canvas. The launcher
#    shows roughly the middle 676-740 px; the wheel is about 80% of the artwork, so it fits, and the
#    artwork's own edge is never visible. backgroundColor in app.json continues the edge colour.
fg = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
inner = art.resize((840, 840), Image.LANCZOS).convert('RGBA')
fg.paste(inner, ((1024 - 840) // 2, (1024 - 840) // 2))
fg.save(OUT + 'adaptive-icon.png', optimize=True)

# 3. Splash: rounded corners on transparent
mask = Image.new('L', (W * 2, W * 2), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, W * 2 - 1, W * 2 - 1), radius=int(W * 0.18) * 2, fill=255)
mask = mask.resize((W, W), Image.LANCZOS)
rounded = art.convert('RGBA')
rounded.putalpha(mask)
rounded.resize((1024, 1024), Image.LANCZOS).save(OUT + 'splash-icon.png', optimize=True)

# 4. Favicon
art.resize((256, 256), Image.LANCZOS).save(OUT + 'favicon.png', optimize=True)

# 5. Silhouettes from the orange pin and the base of the wheel. Only the middle of the artwork is
#    used: the small orange dots in the background must not end up in the silhouette.
arr = np.asarray(art).astype(int)
r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
# Orange by hue, so the darker shaded parts of the pin and base count too (a plain brightness
# cut-off left holes in them).
orange = (r > 100) & (r - b > 70) & (r > g * 1.15)
keep = np.zeros_like(orange)
keep[int(W * 0.27):int(W * 0.9), int(W * 0.22):int(W * 0.78)] = True
mask_img = Image.fromarray(((orange & keep) * 255).astype(np.uint8), 'L')
# Close small gaps (the embossed "ADI" lettering, cracks in the shading) without filling the
# pin's hole: grow, then shrink by the same amount.
mask_img = mask_img.filter(ImageFilter.MaxFilter(15)).filter(ImageFilter.MinFilter(15))
solid = np.asarray(mask_img) > 127


def drop_specks(solid, min_fraction=0.05):
    """Keeps the big shapes (the pin and the base) and drops small stray bits, such as the
    background's orange dots that fall inside the cropped area. Labels on a half-size copy."""
    small = solid[::2, ::2]
    h, w = small.shape
    label = np.zeros((h, w), dtype=np.int32)
    sizes = {}
    next_label = 0
    for y0 in range(h):
        for x0 in range(w):
            if small[y0, x0] and not label[y0, x0]:
                next_label += 1
                stack = [(y0, x0)]
                label[y0, x0] = next_label
                n = 0
                while stack:
                    y, x = stack.pop()
                    n += 1
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        yy, xx = y + dy, x + dx
                        if 0 <= yy < h and 0 <= xx < w and small[yy, xx] and not label[yy, xx]:
                            label[yy, xx] = next_label
                            stack.append((yy, xx))
                sizes[next_label] = n
    biggest = max(sizes.values())
    keep_labels = [k for k, n in sizes.items() if n >= biggest * min_fraction]
    kept_small = np.isin(label, keep_labels)
    # back to full size
    return np.kron(kept_small, np.ones((2, 2), dtype=bool))[:solid.shape[0], :solid.shape[1]] & solid


solid = drop_specks(solid)
sil = np.zeros((W, W, 4), dtype=np.uint8)
sil[solid] = (255, 255, 255, 255)
sil_img = Image.fromarray(sil, 'RGBA')
sil_img = sil_img.crop(sil_img.getbbox())


def fit(img, size, fill_fraction):
    side = int(size * fill_fraction)
    scale = side / max(img.size)
    resized = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(resized, ((size - resized.width) // 2, (size - resized.height) // 2), resized)
    return canvas


fit(sil_img, 256, 0.78).save(OUT + 'notification-icon.png', optimize=True)
fit(sil_img, 1024, 0.50).save(OUT + 'adaptive-monochrome.png', optimize=True)
print('done', sil_img.size)
