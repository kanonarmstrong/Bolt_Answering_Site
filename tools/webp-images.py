#!/usr/bin/env python3
"""AFMBP-2566 — the trade pages' images (and the home page's word switcher) as WebP.

Phones on the Meta ad links (/handyman.html, /plumbing.html, /general-contractor.html ?signup=1) took a
median 7.1 s to paint the handyman page's largest image: each trade page downloaded 2.2-4.7 MB of PNG/JPG.
This rebuilds every WebP in IMAGES from its original PNG/JPG, read from git at SOURCE_COMMIT (the
originals left assets/ in the same change), so anyone can regenerate them. Needs Python 3 and Pillow
(pip install Pillow), nothing else.

Encoding (each image's own line below says which):
  art  PNG art exported from Figma (the baked phone hero / feature images, the phone renders, the app
       screen, the animated calls phone): lossy, quality 90, method 6; transparency kept lossless
       (alpha_quality 100); the app screen keeps its sRGB ICC profile.
  jpg  JPEG photos, already lossy (q82-85, 4:2:0): lossy, quality 85.
  bg   the capes background photos: quality 80. On a computer each sits under the section's 50% black
       overlay; phones never show it (the baked capes image covers the section).
  ll   lossless, where that is smaller than the lossy option: the palette PNGs with transparency (hero
       dashboards, the handyman feature phone), the flat electrical hero background, and the word
       switcher (text on a transparent band, where lossy is both larger and inexact).
Every WebP keeps its source's width and height. Animations: each APNG frame is composited here from the
APNG spec (dispose and blend ops), as browsers do: Pillow's own APNG reader gets "blend over" frames wrong
(it applies the frame's alpha twice), which showed as lighter anti-aliasing in a few frames. Identical
consecutive frames then merge into one WebP frame lasting the whole run; frame boundaries are rounded on the
cumulative timeline, so a 4,000 ms loop stays 4,000 ms (the authored 1/12 s frames; Chrome used to truncate
each APNG frame to 83 ms, 3,984 ms a loop); the loop count is kept (0 = forever).
Known, accepted: in the lossy calls animations libwebp blends a few semi-transparent rim pixels over the
previous frame, so in one of 23 frames ~8 edge pixels are more opaque (up to +58/255) for 84 ms. Encoding
every frame whole avoids it but adds ~350 KB per file.

Run (from anywhere in the repo):
  python3 tools/webp-images.py                 rebuild every WebP into assets/
  python3 tools/webp-images.py --check         rebuild in memory and compare with assets/: same size and
                                               timeline, and the same bytes when Pillow/libwebp match
                                               BUILT_WITH (otherwise the pixel difference is reported)
  python3 tools/webp-images.py NAME.webp ...   only these
  --src DIR                                    read sources from DIR (e.g. a new Figma export) instead of git
"""
import argparse, hashlib, io, os, struct, subprocess, sys, zlib

from PIL import Image, ImageChops, ImageStat, features

SOURCE_COMMIT = '08edfd9e247ed204877345799a99f8c60bc66caf'   # main before AFMBP-2566: the originals' last home
BUILT_WITH = ('12.2.0', '1.6.0')                              # Pillow, libwebp

# output in assets/        source in assets/ at SOURCE_COMMIT   encoding
IMAGES = [
    ('handy-hero-mobile.webp', 'handy-hero-mobile.png', 'art'),
    ('handy-feat-mobile.webp', 'handy-feat-mobile.png', 'art'),
    ('handy-capes-phone.webp', 'handy-capes-phone.png', 'art'),
    ('handy-capes-mobile.webp', 'handy-capes-mobile.jpg', 'jpg'),
    ('handy-capes-bg.webp', 'handy-capes-bg.jpg', 'bg'),
    ('handy-hero-bg.webp', 'handy-hero-bg.jpg', 'jpg'),
    ('handy-hero-dash.webp', 'handy-hero-dash.png', 'll'),
    ('handy-feat-phone.webp', 'handy-feat-phone.png', 'll'),
    ('plumb-hero-mobile.webp', 'plumb-hero-mobile.png', 'art'),
    ('plumb-feat-mobile.webp', 'plumb-feat-mobile.png', 'art'),
    ('plumb-feat-screen.webp', 'plumb-feat-screen.png', 'art'),
    ('plumb-capes-phone.webp', 'plumb-capes-phone.png', 'art'),
    ('plumb-capes-mobile.webp', 'plumb-capes-mobile.jpg', 'jpg'),
    ('plumb-capes-bg.webp', 'plumb-capes-bg.jpg', 'bg'),
    ('plumb-hero-dash.webp', 'plumb-hero-dash.png', 'll'),
    ('gc-hero-mobile.webp', 'gc-hero-mobile.png', 'art'),
    ('gc-calls.webp', 'gc-calls.png', 'art'),
    ('gc-capes-phone.webp', 'gc-capes-phone.png', 'art'),
    ('gc-capes-mobile.webp', 'gc-capes-mobile.jpg', 'jpg'),
    ('gc-capes-bg.webp', 'gc-capes-bg.jpg', 'bg'),
    ('gc-hero-confetti.webp', 'gc-hero-confetti.jpg', 'jpg'),
    ('gc-hero-dash.webp', 'gc-hero-dash.png', 'll'),
    ('hvac-hero-mobile.webp', 'hvac-hero-mobile.png', 'art'),
    ('hvac-calls.webp', 'hvac-calls.png', 'art'),
    ('hvac-capes-phone.webp', 'hvac-capes-phone.png', 'art'),
    ('hvac-capes-mobile.webp', 'hvac-capes-mobile.jpg', 'jpg'),
    ('hvac-capes-bg.webp', 'hvac-capes-bg.jpg', 'bg'),
    ('hvac-hero-bg.webp', 'hvac-hero-bg.jpg', 'jpg'),
    ('hvac-hero-dash.webp', 'hvac-hero-dash.png', 'll'),
    ('elec-hero-mobile.webp', 'elec-hero-mobile.png', 'art'),
    ('elec-calls.webp', 'elec-calls.png', 'art'),
    ('elec-capes-phone.webp', 'elec-capes-phone.png', 'art'),
    ('elec-capes-mobile.webp', 'elec-capes-mobile.jpg', 'jpg'),
    ('elec-capes-bg.webp', 'elec-capes-bg.jpg', 'bg'),
    ('elec-hero-bg.webp', 'elec-hero-bg.jpg', 'll'),
    ('elec-hero-dash.webp', 'elec-hero-dash.png', 'll'),
    ('switcher.webp', 'switcher.png', 'll'),
]
QUALITY = {'art': 90, 'jpg': 85, 'bg': 80}

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def source_bytes(name, src_dir):
    if src_dir:
        with open(os.path.join(src_dir, name), 'rb') as f:
            return f.read()
    return subprocess.run(['git', '-C', ROOT, 'show', f'{SOURCE_COMMIT}:assets/{name}'], check=True, capture_output=True).stdout


def has_alpha(im):
    return im.mode in ('RGBA', 'LA', 'PA') or (im.mode == 'P' and 'transparency' in im.info)


def png_chunks(b):
    o = 8
    while o < len(b):
        n = struct.unpack('>I', b[o:o + 4])[0]
        yield b[o + 4:o + 8], b[o + 8:o + 8 + n]
        o += 12 + n


def apng_frames(b):
    """(width, height, loop count, [(RGBA canvas, delay ms)]) composited the way browsers do, from the APNG spec.
    Pillow only decodes each frame's own pixels here: its APNG reader blends APNG_BLEND_OP_OVER frames with the
    frame's alpha applied twice (alpha 201 over transparent comes out 158), which Chrome and Safari don't do."""
    ihdr, extra, frames, cur, loop = None, [], [], None, 0
    for t, d in png_chunks(b):
        if t == b'IHDR':
            ihdr = d
        elif t == b'acTL':
            loop = struct.unpack('>II', d)[1]
        elif t in (b'PLTE', b'tRNS', b'sRGB', b'gAMA', b'cHRM', b'iCCP'):
            extra.append((t, d))
        elif t == b'fcTL':
            _, w, h, x, y, dn, dd, dispose, blend = struct.unpack('>IIIIIHHBB', d)
            cur = dict(w=w, h=h, x=x, y=y, delay=dn * 1000 / (dd or 100), dispose=dispose, blend=blend, data=[])
            frames.append(cur)
        elif t == b'IDAT' and cur is not None:   # the default image is the first frame
            cur['data'].append(d)
        elif t == b'fdAT':
            cur['data'].append(d[4:])

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)

    def pixels(fr):   # the frame's own sub-image, as a standalone PNG
        png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>II', fr['w'], fr['h']) + ihdr[8:])
        png += b''.join(chunk(t, d) for t, d in extra) + chunk(b'IDAT', b''.join(fr['data'])) + chunk(b'IEND', b'')
        return Image.open(io.BytesIO(png)).convert('RGBA')

    W, H = struct.unpack('>II', ihdr[:8])
    canvas, out = Image.new('RGBA', (W, H), (0, 0, 0, 0)), []
    for i, fr in enumerate(frames):
        box = (fr['x'], fr['y'], fr['x'] + fr['w'], fr['y'] + fr['h'])
        before = canvas.copy() if fr['dispose'] == 2 and i else None
        sub = pixels(fr)
        if fr['blend'] == 0:
            canvas.paste(sub, box[:2])                   # APNG_BLEND_OP_SOURCE: replace, alpha included
        else:
            canvas.alpha_composite(sub, dest=box[:2])    # APNG_BLEND_OP_OVER
        out.append((canvas.copy(), fr['delay']))
        if fr['dispose'] == 1 or (fr['dispose'] == 2 and before is None):
            canvas.paste((0, 0, 0, 0), box)              # APNG_DISPOSE_OP_BACKGROUND (PREVIOUS on frame 0 too)
        elif fr['dispose'] == 2:
            canvas = before                              # APNG_DISPOSE_OP_PREVIOUS
    return W, H, loop, out


def merge_runs(frames):
    """[(RGBA frame, duration ms)] with identical consecutive frames merged, boundaries rounded on the timeline."""
    runs, sha_prev = [], None
    for frame, d in frames:
        sha = hashlib.sha256(frame.tobytes()).digest()
        if sha == sha_prev:
            runs[-1][1] += d
        else:
            runs.append([frame, d]); sha_prev = sha
    out, start = [], 0.0
    for frame, d in runs:
        out.append((frame, int(round(start + d)) - int(round(start))))
        start += d
    return out


def encode(src, kind):
    im = Image.open(io.BytesIO(src))
    im.load()
    lossless = kind == 'll'
    opts = dict(method=6, lossless=lossless, quality=100 if lossless else QUALITY[kind])
    if not lossless:
        opts['alpha_quality'] = 100
    icc = im.info.get('icc_profile')
    if icc:
        opts['icc_profile'] = icc
    buf = io.BytesIO()
    if getattr(im, 'n_frames', 1) > 1:
        _, _, loop, frames = apng_frames(src)
        frames = merge_runs(frames)
        frames[0][0].save(buf, 'WEBP', save_all=True, append_images=[f for f, _ in frames[1:]], duration=[d for _, d in frames],
                          loop=loop, minimize_size=True, **opts)
    else:
        im.convert('RGBA' if has_alpha(im) else 'RGB').save(buf, 'WEBP', **opts)
    return buf.getvalue()


def timeline(im):
    if getattr(im, 'n_frames', 1) == 1:
        return None
    out = []
    for i in range(im.n_frames):
        im.seek(i); im.load(); out.append(im.info.get('duration', 0))
    return out


def pixel_diff(a, b):
    """max and mean |difference| over RGBA of the first frames"""
    a = Image.open(io.BytesIO(a)).convert('RGBA'); b = Image.open(io.BytesIO(b)).convert('RGBA')
    d = ImageChops.difference(a, b)
    return max(hi for lo, hi in d.getextrema()), sum(ImageStat.Stat(d).mean) / 4


def main():
    ap = argparse.ArgumentParser(description='Rebuild the WebP images from their PNG/JPG originals.')
    ap.add_argument('names', nargs='*', help='output names (default: all)')
    ap.add_argument('--check', action='store_true', help='compare a fresh build with assets/ instead of writing')
    ap.add_argument('--src', help='read sources from this directory instead of git')
    a = ap.parse_args()
    if not features.check('webp'):
        sys.exit('This Pillow has no WebP support.')
    versions = (Image.__version__, features.version('webp'))
    same_build = versions == BUILT_WITH
    print(f"Pillow {versions[0]}, libwebp {versions[1]}" + ('' if same_build else f" (the committed files were built with Pillow {BUILT_WITH[0]}, libwebp {BUILT_WITH[1]})"))
    todo = [x for x in IMAGES if not a.names or x[0] in a.names]
    unknown = set(a.names) - {x[0] for x in IMAGES}
    if unknown:
        sys.exit(f"unknown: {', '.join(sorted(unknown))}")
    bad = 0
    tot_old = tot_new = 0
    for out, src_name, kind in todo:
        src = source_bytes(src_name, a.src)
        data = encode(src, kind)
        s_im = Image.open(io.BytesIO(src)); w_im = Image.open(io.BytesIO(data))
        size_ok = s_im.size == w_im.size
        dest = os.path.join(ROOT, 'assets', out)
        tot_old += len(src); tot_new += len(data)
        label = f"{src_name:24s} {len(src) / 1024:8.1f} KB -> {out:24s} {len(data) / 1024:7.1f} KB  {w_im.size[0]}x{w_im.size[1]}  {kind}"
        if not a.check:
            with open(dest, 'wb') as f:
                f.write(data)
            print(label + ('' if size_ok else '  SIZE CHANGED'))
            bad += not size_ok
            continue
        if not os.path.exists(dest):
            print(f"FAIL {out}: missing from assets/"); bad += 1; continue
        with open(dest, 'rb') as f:
            have = f.read()
        h_im = Image.open(io.BytesIO(have))
        problems = []
        if h_im.size != s_im.size:
            problems.append(f"size {h_im.size} != source {s_im.size}")
        if timeline(h_im) != timeline(w_im):
            problems.append('frame timeline differs from a fresh build')
        if same_build and have != data:
            problems.append('bytes differ from a fresh build with the same Pillow/libwebp')
        note = '' if have == data else ' (pixels vs fresh build: max %d, mean %.3f)' % pixel_diff(have, data)
        print(('FAIL ' if problems else 'ok   ') + label + note + (': ' + '; '.join(problems) if problems else ''))
        bad += bool(problems)
    print(f"total {tot_old / 1024:.0f} KB -> {tot_new / 1024:.0f} KB ({(1 - tot_new / tot_old) * 100:.0f}% smaller)")
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
