# Pricing — single source of truth

The marketing site is static HTML on GitHub Pages, and the hero price is baked
into an **image** (`assets/pricing-chevron.png`). It cannot fetch the app's live
pricing feed (the API rejects this origin — CORS). So the site can't
auto-waterfall like the app does; instead, **this file is the authoritative
pricing, and a price change is a checklist against it.**

Keep these in lockstep with the backend source of truth
(`kanonarmstrong/EZ-Answer` → `src/lib/plans.ts`, exposed at
`GET /api/public/pricing`). The displayed price must equal what Stripe charges.

## Current pricing (Solo)

| Field | Value |
|---|---|
| Promo (intro) price | **$99/month** for the first **3 months** |
| Retail (standard) price | **$129/month** thereafter |
| Overage — minutes | **$0.12 / minute** |
| Overage — messages | **$0.01 / message** |
| Free trial | 14 days |

## Everywhere the price appears (update ALL on a change)

Per trade page — `index.html`, `hvac.html`, `plumbing.html`, `handyman.html`,
`electrical.html`, `general-contractor.html`:

1. **Hero image** — `assets/pricing-chevron.png` (desktop). The price is drawn
   INTO the image, so it must be **regenerated** on a price change; editing HTML
   does not touch it.
2. **Hero `alt` text** — `<img class="chev-web" alt="… $99 … $129 … $0.12/minute
   and $0.01/message …">` (accessibility mirror of the image).
3. **Mobile `aria-label`** — `<div class="chev-mobile mchev" aria-label="… $99 …
   $129 … $0.12/minute and $0.01/message …">`.
4. **Mobile visible price** — `<span class="mchev__amt">$99</span> / mo. for
   first 3 months`.
5. **Mobile fine print** — `<li>After promo period, price increases to $129 /
   month</li>` and `<li>… $0.12 / minute and $0.01/message beyond budget</li>`.

## History

- 2026-09-10 — corrected the message-overage rate from **$0.05** to **$0.01** to
  match the app + the legal ARL disclosure (owner-confirmed $0.01 is correct).
