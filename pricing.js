/*
 * AFMBP-1786 — flow the price from the backend's single source to the marketing
 * site. Fetches GET /api/public/pricing (served from EZ-Answer src/lib/plans.ts)
 * and rewrites every price in the page. The values baked into the HTML are the
 * FALLBACK, so the page is correct with no JS and if the fetch fails; the feed
 * overrides them when it loads.
 *
 * The pricing chevron is one HTML element (.mchev) reflowed by CSS — horizontal
 * on desktop, vertical on mobile — so every visible price flows from the feed on
 * both. There is no baked image left to regenerate. See PRICING.md.
 */
(function () {
  'use strict';

  var FEED = 'https://bolt-staging.fly.dev/api/public/pricing';
  var FALLBACK = {
    promoPriceUsd: 99,
    retailPriceUsd: 129,
    promoMonths: 3,
    perMinuteUsd: 0.12,
    perMessageUsd: 0.01
  };

  function money(n) {
    return n === Math.round(n) ? '$' + n : '$' + n.toFixed(2);
  }

  function apply(p) {
    var promo = money(p.promoPriceUsd);
    var retail = money(p.retailPriceUsd);
    var perMin = money(p.perMinuteUsd);
    var perMsg = money(p.perMessageUsd);
    var months = p.promoMonths;

    // Visible mobile price.
    document.querySelectorAll('.mchev__amt').forEach(function (el) {
      el.textContent = promo;
    });

    // Mobile fine print (two lines).
    document.querySelectorAll('.mchev__fine').forEach(function (ul) {
      var li = ul.querySelectorAll('li');
      if (li[0]) {
        li[0].textContent = 'After promo period, price increases to ' + retail + ' / month';
      }
      if (li[1]) {
        li[1].textContent = 'Includes 750 messages and 400 minutes per cycle, and only ' +
          perMin + ' / minute and ' + perMsg + '/message beyond budget';
      }
    });

    // Accessibility text: the chevron card's aria-label.
    var prefix = 'First 30-Day Trial FREE — Blocks spam calls, Flags urgent calls, ' +
      'Keeps customer info organized, Manages your schedule, Captures leads, ' +
      'Sends confirmations, Drafts quick text replies. New Partner Pricing: ';
    var priced = promo + ' per month for first ' + months + ' months, then ' + retail + '/month; ';
    var aria = prefix + priced + '750 messages and 400 minutes per cycle; ' +
      perMin + '/minute and ' + perMsg + '/message beyond budget.';
    document.querySelectorAll('.chev-mobile').forEach(function (el) {
      el.setAttribute('aria-label', aria);
    });
  }

  function run() {
    apply(FALLBACK); // keep the page correct immediately (idempotent with the HTML)
    fetch(FEED)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.plans && j.plans.solo) apply(j.plans.solo); })
      .catch(function () { /* fallback already applied */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
