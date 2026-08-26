# Bolt Marketing Site

Static, mobile-responsive marketing homepage built 1:1 from Figma node `2251:108`
(Bolt Marketing Site → *Home Page w/ Trades dropdown selected*).

## Run

```bash
cd bolt-marketing-site
python3 -m http.server 8087
# open http://localhost:8087
```

Or just open `index.html` directly in a browser (fonts load from Google Fonts, so stay online).

## Structure

```
bolt-marketing-site/
├── index.html      # all sections, semantic markup
├── styles.css      # design tokens + responsive layout (breakpoints 1024 / 768 / 480)
├── script.js       # mobile nav toggle + "Why ___ pros trust Bolt" word switcher
└── assets/
    ├── logo-wordmark.png      # bolt brand wordmark (cropped from AppStore icon, transparent)
    ├── hero-bg.png            # hero background (bolt-dot pattern + gradient)
    ├── hero-phone.png         # hero device shot
    ├── word-switcher.mp4      # "Why ___ pros trust Bolt" switcher (autoplays, loops)
    ├── reviews-bg.jpg         # construction-framing testimonial bg
    ├── blueprint-bg.png       # "sign up" section blueprint bg
    ├── num-1..4.png           # hand-drawn step numbers
    ├── ellipse-1..4.svg       # gold hand-drawn rings around each step mockup
    ├── line.svg               # (reference) dashed step divider — drawn in CSS
    ├── pricing-chevron.png    # real green→navy pricing chevron (source of truth)
    └── sketch-*.png           # hand-drawn step mockups (trade, warm/calm, jobs, schedule)
```

## Sections (top → bottom)

Nav (+ Trades dropdown) · Hero · Trust statement (3 cards) · Reviews · "More jobs. Less hassle." band ·
Sign-up 4-step (blueprint) · Pricing (chevron) · Subscribe / pre-footer · Footer.

## Design tokens

| token | value |
|-------|-------|
| navy | `#180a53` |
| blue (CTA) | `#2b7ffd` |
| yellow (CTA) | `#fcbd11` |
| body gray | `#839393` |
| off-white bg | `#f9fbff` |
| footer bg | `#e0e0e0` |
| fonts | Inter (body) · Permanent Marker (display) · Poppins (captions) |

## Notes

- Pricing chevron is the real Figma asset (per request). On desktop it renders full-width and crisp;
  on mobile it scales to fit so the whole FREE + $99 offer stays visible.
- Nav links, footer links, and the dropdown are real `<a>` elements (Figma exported them as flattened
  vectors); social + form icons are inline SVG.
