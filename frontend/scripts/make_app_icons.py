"""Builds the app's icon files from the master artwork (a 2000x2000 image of the icon tile on a
dark surround). Run from frontend/:

    python scripts/make_app_icons.py path/to/master.jpg

Writes into assets/images/:
  icon.png                 1024  full-bleed square (iOS and Android round or mask it themselves)
  adaptive-icon.png        1024  Android adaptive foreground: the art inside the safe zone
  adaptive-monochrome.png  1024  Android 13 themed icon: a white silhouette
  splash-icon.png          1024  the tile with rounded corners, shown on the black splash screen
  favicon.png               256  browser tab icon
  notification-icon.png     256  Android status-bar icon: white on transparent (Android tints it)
"""
import sys

import numpy as np
from PIL import Image, ImageDraw

SRC = sys.argv[1]
OUT = 'assets/images/'
TILE = (150, 150, 1850, 1850)  # the rounded tile inside the master image
EDGE = (20, 30, 55)            # the tile's outer navy, used to fill the corners
RADIUS = 365                   # the tile's corner radius in the master image

master = Image.open(SRC).convert('RGB')
tile = master.crop(TILE)  # 1700 x 1700
w = tile.width

# Rounded-corner mask for the tile
mask = Image.new('L', (w * 2, w * 2), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, w * 2 - 1, w * 2 - 1), radius=RADIUS * 2, fill=255)
mask = mask.resize((w, w), Image.LANCZOS)

# 1. Full-bleed square: corners filled with the tile's edge colour
square = Image.new('RGB', (w, w), EDGE)
square.paste(tile, (0, 0), mask)
square.resize((1024, 1024), Image.LANCZOS).save(OUT + 'icon.png', optimize=True)

# 2. Adaptive foreground: the full-bleed square at 740 px, centred on a transparent 1024 canvas.
#    The launcher shows roughly the middle 676-740 px, so the wheel (about 91% of the tile) fits
#    and the tile's own edge is never visible. backgroundColor in app.json matches the tile.
fg = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
inner = square.resize((740, 740), Image.LANCZOS).convert('RGBA')
fg.paste(inner, ((1024 - 740) // 2, (1024 - 740) // 2))
fg.save(OUT + 'adaptive-icon.png', optimize=True)

# 3. Splash: the rounded tile on transparent
rounded = tile.convert('RGBA')
rounded.putalpha(mask)
rounded.resize((1024, 1024), Image.LANCZOS).save(OUT + 'splash-icon.png', optimize=True)

# 4. Favicon
square.resize((256, 256), Image.LANCZOS).save(OUT + 'favicon.png', optimize=True)

# 5. Silhouettes from the orange parts (the pin and the wheel's base)
arr = np.asarray(tile).astype(int)
r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
orange = (r > 190) & (g > 70) & (g < 190) & (b < 90)
sil = np.zeros((w, w, 4), dtype=np.uint8)
sil[orange] = (255, 255, 255, 255)
sil_img = Image.fromarray(sil, 'RGBA')
box = sil_img.getbbox()
sil_img = sil_img.crop(box)


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
