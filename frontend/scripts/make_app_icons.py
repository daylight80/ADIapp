"""Builds the app's icon files from the master artwork: a square image that runs edge to edge
(assets/images/app-icon-master.jpg, 2000x2000). Run from frontend/:

    python scripts/make_app_icons.py assets/images/app-icon-master.jpg [assets/images/app-icon-mono-master.jpg]

The second file is the black-and-white version of the artwork, used for the silhouettes.

Writes into assets/images/:
  icon.png                 1024  the artwork, edge to edge (iOS and Android round or mask it themselves)
  adaptive-icon.png        1024  Android adaptive foreground: the artwork inside the launcher's safe zone
  adaptive-monochrome.png  1024  Android 13 themed icon: a white silhouette
  splash-icon.png          1024  the artwork with rounded corners, shown on the black splash screen
  adi-pro-logo.png          512  the logo on the sign-in screen
  favicon.png               256  browser tab icon
  notification-icon.png     256  Android status-bar icon: white on transparent (Android tints it)

app.json's adaptiveIcon.backgroundColor should match the artwork's edge colour (#0A2147).
"""
import sys

import numpy as np
from PIL import Image, ImageDraw

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

# 3b. The logo on the sign-in screen
art.resize((512, 512), Image.LANCZOS).save(OUT + 'adi-pro-logo.png', optimize=True)

# 4. Favicon
art.resize((256, 256), Image.LANCZOS).save(OUT + 'favicon.png', optimize=True)

# 5. Silhouettes (Android 13 themed icon and the status-bar notification icon) from the
#    black-and-white master: white shape on a dark background. White becomes opaque white, the dark
#    becomes transparent, so the wheel, the pin and the lettering come out as cut-outs.
MONO = sys.argv[2] if len(sys.argv) > 2 else 'assets/images/app-icon-mono-master.jpg'
gray = np.asarray(Image.open(MONO).convert('L')).astype(float)
alpha = np.clip((gray - 70.0) / (200.0 - 70.0), 0.0, 1.0)  # soft edge between the dark and white
sil = np.zeros(gray.shape + (4,), dtype=np.uint8)
sil[..., :3] = 255
sil[..., 3] = (alpha * 255).astype(np.uint8)
sil_img = Image.fromarray(sil, 'RGBA')
sil_img = sil_img.crop(sil_img.getbbox())


def fit(img, size, fill_fraction):
    side = int(size * fill_fraction)
    scale = side / max(img.size)
    resized = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(resized, ((size - resized.width) // 2, (size - resized.height) // 2), resized)
    return canvas


fit(sil_img, 256, 0.86).save(OUT + 'notification-icon.png', optimize=True)
fit(sil_img, 1024, 0.62).save(OUT + 'adaptive-monochrome.png', optimize=True)
print('done', sil_img.size)
