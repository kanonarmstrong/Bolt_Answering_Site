# Pricing — single source of truth

The price on this site **flows automatically** from the backend's single source
(`kanonarmstrong/EZ-Answer` → `src/lib/plans.ts`, exposed at
`GET /api/public/pricing`). `pricing.js` fetches that feed on load and rewrites
every price in the HTML — the mobile price, the fine print, and the alt/aria
accessibility text. The values baked into the HTML are the **fallback**, so the
page is correct with no JS and if the fetch fails.

The site serves on `www.boltanswering.com`, which the API allow-lists for CORS,
so the browser fetch is permitted. (An earlier note here wrongly said the API
refuses this origin — it does not.)

**The displayed price must equal what Stripe charges.** Change the numbers in
`plans.ts` and this site follows on the next page load — with one exception below.

## Current pricing (Solo)

| Field | Value |
|---|---|
| Promo (intro) price | **$99/month** for the first **3 months** |
| Retail (standard) price | **$129/month** thereafter |
| Overage — minutes | **$0.12 / minute** |
| Overage — messages | **$0.01 / message** |
| Free trial | 14 days |

These are display values that mirror the feed; they never need hand-editing.

## The one manual step: the desktop hero image

The desktop hero (`.chev-web`) is a baked PNG, `assets/pricing-chevron.png`, with
the price **drawn into the image**. `pricing.js` updates its `alt` text, but it
cannot change the pixels. **On a price change, regenerate that PNG** — it is the
only place a price is not automatic.

> To remove this last manual step entirely, replace the desktop PNG with the same
> HTML chevron the mobile view already uses (`.chev-mobile` / `.mchev`), shown
> responsively on desktop. Then `pricing.js` covers every surface and nothing is
> baked. That is a hero design change, tracked separately.

## How it flows

```
plans.ts (EZ-Answer)  →  GET /api/public/pricing  →  pricing.js  →  all HTML text
                                                                    (mobile price,
                                                                     fine print,
                                                                     alt / aria)
assets/pricing-chevron.png  →  desktop hero  →  regenerate by hand on a change
```

## History

- 2026-09-11 — added `pricing.js`: the price now auto-flows from the feed to all
  HTML text. Corrected the earlier (wrong) claim that CORS blocked the fetch —
  `www.boltanswering.com` is allow-listed.
- 2026-09-10 — corrected the message-overage rate from **$0.05** to **$0.01** to
  match the app + the legal ARL disclosure (owner-confirmed $0.01 is correct).
