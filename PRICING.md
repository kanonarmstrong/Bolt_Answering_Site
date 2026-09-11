# Pricing — single source of truth

The price **and the free-trial length** on this site **flow automatically** from
the backend's single source (`kanonarmstrong/EZ-Answer` → `src/lib/plans.ts`,
exposed at `GET /api/public/pricing`). `pricing.js` fetches that feed on load and
rewrites every price + trial mention in the page — the visible price, the fine
print, the trial length (every `.js-td` hook: the CTAs and the chevron's "N-Day
Trial" label), and the aria accessibility text. The values baked into the HTML
are the **fallback**, so the page is correct with no JS and if the fetch fails.

The trial length is `trialDays` in `plans.ts` (`TRIAL_DAYS`), the same constant
that drives the real Stripe trial — so what the site advertises and what a
customer is actually charged on can never drift (a §17603 requirement).

The site serves on `www.boltanswering.com`, which the API allow-lists for CORS,
so the browser fetch is permitted. (An earlier note here wrongly said the API
refuses this origin — it does not.)

**The displayed price must equal what Stripe charges.** Change the numbers in
`plans.ts` and this site follows on the next page load — every surface, with no
hand-editing.

## Current pricing (Solo)

| Field | Value |
|---|---|
| Promo (intro) price | **$99/month** for the first **3 months** |
| Retail (standard) price | **$129/month** thereafter |
| Overage — minutes | **$0.12 / minute** |
| Overage — messages | **$0.01 / message** |
| Free trial | 30 days |

These are display values that mirror the feed; they never need hand-editing.

## The pricing chevron is one HTML element, reflowed by CSS

There is **no baked image** anywhere in the pricing UI — the old
`assets/pricing-chevron.png` desktop hero (which also had a stale `$0.05`
overage drawn into its pixels) has been removed. The chevron is a single HTML
block (`.chev-mobile.mchev`) that CSS reflows by breakpoint:

- **Desktop (≥769px):** a horizontal green→navy chevron (`@media (min-width:769px)`
  in `styles.css`), laid out with `clip-path` polygons.
- **Mobile (≤768px):** the vertical stacked card, using the `#mchevTop` /
  `#mchevBot` SVG clip-paths.

Because both widths render the **same** `.mchev__amt` (visible price) and
`.mchev__fine` (fine print) elements, `pricing.js` rewrites them on every
surface. Nothing is manual.

## How it flows

```
plans.ts (EZ-Answer)  →  GET /api/public/pricing  →  pricing.js  →  .mchev__amt   (visible price, desktop + mobile)
                                                                     .mchev__fine  (fine print)
                                                                     .chev-mobile  (aria-label)
```

## History

- 2026-09-11 — removed the desktop hero PNG; the chevron is now one HTML element
  reflowed by CSS (horizontal on desktop, vertical on mobile), so the visible
  desktop price flows from the feed too. Nothing baked remains.
- 2026-09-11 — added `pricing.js`: the price now auto-flows from the feed to all
  HTML text. Corrected the earlier (wrong) claim that CORS blocked the fetch —
  `www.boltanswering.com` is allow-listed.
- 2026-09-10 — corrected the message-overage rate from **$0.05** to **$0.01** to
  match the app + the legal ARL disclosure (owner-confirmed $0.01 is correct).
