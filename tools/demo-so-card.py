#!/usr/bin/env python3
"""AFMBP-2657 — assets/demo-so-card.webp, the sign-up card's art (paper, with "NEW JOBS ARE CALLING"
drawn in it), at twice the size the cards draw it.

Both /start/ cards and the trade pages' ?signup=1 card draw the art at 354.42 x 628.98 CSS px: cover
on the 337 x 629 card (the A/B's demo card sets that size outright). Twice that is 709 x 1258. The file
was 941 x 1670 (127 KB); the cards never showed it bigger than 1.13x on a 3x phone.

Source: the image fill of Figma file j7orsmOZX6BF5SrzkIasSw, node 2718:3324 ("Background+Border" in
the sign-up landing node 2718:3312). It is a 941 x 1670 PNG; its SHA-1 is Figma's image hash, below.
Download that node's raw image from Figma, then run from the site root:
  python3 tools/demo-so-card.py SOURCE.png           write assets/demo-so-card.webp
  python3 tools/demo-so-card.py SOURCE.png --check   compare a fresh encode with assets/
Encoding: Lanczos down to 709 x 1258, then lossy WebP quality 80, method 6. At quality 80 the art looks
the same as quality 84 on a 3x phone, at 54 KB instead of 74. Needs Python 3 and Pillow.
"""
import argparse, hashlib, io, sys

from PIL import Image, ImageChops, ImageStat, features

IMAGE_HASH = '0c99517bd7858e90edd6ee2e89718ba6eed4b4cc'   # Figma's hash of the node's image fill (SHA-1)
SIZE = (709, 1258)
QUALITY, METHOD = 80, 6
OUT = 'assets/demo-so-card.webp'
BUILT_WITH = ('12.2.0', '1.6.0')                           # Pillow, libwebp


def encode(src_bytes):
    if hashlib.sha1(src_bytes).hexdigest() != IMAGE_HASH:
        sys.exit('that is not the Figma image fill (SHA-1 %s): download node 2718:3324\'s raw image' % IMAGE_HASH)
    im = Image.open(io.BytesIO(src_bytes)).convert('RGB').resize(SIZE, Image.LANCZOS)
    b = io.BytesIO()
    im.save(b, 'WEBP', quality=QUALITY, method=METHOD)
    return b.getvalue()


def main():
    ap = argparse.ArgumentParser(description='Rebuild assets/demo-so-card.webp from its Figma source.')
    ap.add_argument('source', help="node 2718:3324's raw image (PNG) from Figma")
    ap.add_argument('--check', action='store_true', help='compare a fresh encode with assets/ instead of writing')
    a = ap.parse_args()
    data = encode(open(a.source, 'rb').read())
    if not a.check:
        open(OUT, 'wb').write(data)
        print('%s: %dx%d, %.1f KB' % (OUT, SIZE[0], SIZE[1], len(data) / 1024))
        return
    have = open(OUT, 'rb').read()
    if have == data:
        print('%s: the same bytes' % OUT)
        return
    built = (Image.__version__, features.version('webp'))
    diff = ImageStat.Stat(ImageChops.difference(Image.open(io.BytesIO(have)).convert('RGB'), Image.open(io.BytesIO(data)).convert('RGB')))
    print('%s differs (Pillow/libwebp %s, built with %s): mean pixel difference %s' % (OUT, built, BUILT_WITH, [round(x, 2) for x in diff.mean]))
    sys.exit(0 if built != BUILT_WITH and max(diff.mean) < 1 else 1)


if __name__ == '__main__':
    main()
