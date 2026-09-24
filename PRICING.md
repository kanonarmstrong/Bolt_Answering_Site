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

## Where the numbers come from now

The feed serves the version published in the **Pricing Control Center**
(`/admin/pricing` in the web app, AFMBP-1892). Until the first publish it serves
the code constants in `plans.ts`. **Today those are the AFMBP-1899 `$0`
placeholder**, while Stripe still charges new customers $49.99 → $59.99. The
first publish from the control center closes that gap (AFMBP-1900).

These hooks in the page follow the feed:

| Hook | Shows |
|---|---|
| `.mchev__amt` | promo price |
| `.js-pm` | promo length ("for first **N** months") |
| `.js-td` | trial length (chevron label) |
| `.js-cta-trial` | "Start my free N-day trial" (every page, support pages included) |
| `.mchev__fine li` | standard price; included messages/minutes; overage rates |
| `.chev-mobile[aria-label]` | the whole offer, for screen readers |

`pricing.test.mjs` pins these hooks and reads every page. A new page that shows
the offer without a hook, or with a baked number, fails it.

**Not yet data-driven:** the support FAQ's "Your first month is free. The next
three months are discounted." is baked copy. It needs owner-approved wording
before it can follow the feed (AFMBP-1903).

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
surface. The promo length, trial length and allowances follow the feed too
(AFMBP-1903); the support FAQ sentence above is the one known exception.

## How it flows

```
plans.ts (EZ-Answer)  →  GET /api/public/pricing  →  pricing.js  →  .mchev__amt   (visible price, desktop + mobile)
                                                                     .mchev__fine  (fine print)
                                                                     .chev-mobile  (aria-label)
```

## History
- 2026-09-23 — AFMBP-1903: the promo length (`.js-pm`), the included
  allowances and the support pages' trial CTA follow the feed. Previously the
  visible "for first 3 months" was baked, so a promo-length change reached only
  the aria-label. The aria-label now says "New Bolt Pro Pricing", matching the
  visible chevron (it still said the retired "New Partner Pricing").

- 2026-09-11 — removed the desktop hero PNG; the chevron is now one HTML element
  reflowed by CSS (horizontal on desktop, vertical on mobile), so the visible
  desktop price flows from the feed too. Nothing baked remains.
- 2026-09-11 — added `pricing.js`: the price now auto-flows from the feed to all
  HTML text. Corrected the earlier (wrong) claim that CORS blocked the fetch —
  `www.boltanswering.com` is allow-listed.
- 2026-09-10 — corrected the message-overage rate from **$0.05** to **$0.01** to
  match the app + the legal ARL disclosure (owner-confirmed $0.01 is correct).
