/*
 * AFMBP-1786 — flow the price from the backend's single source to the marketing
 * site. Fetches GET /api/public/pricing (served from EZ-Answer: the published
 * version in the Pricing Control Center, else src/lib/plans.ts) and rewrites
 * every price in the page. The values baked into the HTML are the FALLBACK, so
 * the page is correct with no JS and if the fetch fails; the feed overrides
 * them when it loads.
 *
 * The pricing chevron is one HTML element (.mchev) reflowed by CSS — horizontal
 * on desktop, vertical on mobile — so every visible price flows from the feed on
 * both. There is no baked image left to regenerate. See PRICING.md.
 *
 * AFMBP-1903 — the promo LENGTH (.js-pm), the included allowances and the trial
 * length on every page that shows it follow the feed too, so a change made in
 * the control center reaches everything this site shows about the offer.
 *
 * Browser -> runs on load ; Node -> module.exports (pricing.test.mjs).
 */
(function (factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (typeof document !== 'undefined') api.run(document);
})(function () {
  'use strict';

  var FEED = 'https://bolt-staging.fly.dev/api/public/pricing';
  // AFMBP-1899 — plan prices are a $0 PLACEHOLDER while the real price is being
  // set; the backend feed serves 0 too, so fallback and feed agree. Usage rates
  // and allowances are NOT zeroed (they are the Stripe metered-price tiers).
  var FALLBACK = {
    promoPriceUsd: 0,
    retailPriceUsd: 0,
    promoMonths: 3,
    trialDays: 30,
    perMinuteUsd: 0.12,
    perMessageUsd: 0.01,
    minutesIncluded: 400,
    messagesIncluded: 750
  };

  function money(n) {
    return n === Math.round(n) ? '$' + n : '$' + n.toFixed(2);
  }

  // A number from the feed, else the fallback. 0 is a real value (a 0-day
  // trial is not a 30-day one), so this is not `||`.
  function num(v, d) {
    return typeof v === 'number' && isFinite(v) ? v : d;
  }

  function each(doc, sel, fn) {
    var list = doc.querySelectorAll(sel);
    for (var i = 0; i < list.length; i++) fn(list[i]);
  }

  function apply(doc, p) {
    var promo = money(num(p.promoPriceUsd, FALLBACK.promoPriceUsd));
    var retail = money(num(p.retailPriceUsd, FALLBACK.retailPriceUsd));
    var perMin = money(num(p.perMinuteUsd, FALLBACK.perMinuteUsd));
    var perMsg = money(num(p.perMessageUsd, FALLBACK.perMessageUsd));
    var months = num(p.promoMonths, FALLBACK.promoMonths);
    var days = num(p.trialDays, FALLBACK.trialDays);
    var minutes = num(p.minutesIncluded, FALLBACK.minutesIncluded);
    var messages = num(p.messagesIncluded, FALLBACK.messagesIncluded);

    // Visible mobile price.
    each(doc, '.mchev__amt', function (el) {
      el.textContent = promo;
    });

    // Visible promo length — the chevron's "for first N months" (a bare number
    // in a <span>, like the trial label below).
    each(doc, '.js-pm', function (el) {
      el.textContent = months;
    });

    // Visible trial length — the chevron's "N-Day Trial" label (a bare number in
    // a <p>, so a partial span is safe here).
    each(doc, '.js-td', function (el) {
      el.textContent = days;
    });

    // CTA buttons are inline-flex, which trims whitespace around child flex
    // items — so a partial span would drop the space ("free21-day"). Wrap the
    // WHOLE label in one span and rewrite it from a template instead.
    each(doc, '.js-cta-trial', function (el) {
      el.textContent = 'Start my free ' + days + '-day trial';
    });

    // Mobile fine print (two lines).
    each(doc, '.mchev__fine', function (ul) {
      var li = ul.querySelectorAll('li');
      if (li[0]) {
        li[0].textContent = 'After promo period, price increases to ' + retail + ' / month';
      }
      if (li[1]) {
        li[1].textContent = 'Includes ' + messages + ' messages and ' + minutes + ' minutes per cycle, and only ' +
          perMin + ' / minute and ' + perMsg + '/message beyond budget';
      }
    });

    // Accessibility text: the chevron card's aria-label.
    var prefix = 'First ' + days + '-Day Trial FREE — Blocks spam calls, Flags urgent calls, ' +
      'Keeps customer info organized, Manages your schedule, Captures leads, ' +
      'Sends confirmations, Drafts quick text replies. New Bolt Pro Pricing: ';
    var priced = promo + ' per month for first ' + months + ' months, then ' + retail + '/month; ';
    var aria = prefix + priced + messages + ' messages and ' + minutes + ' minutes per cycle; ' +
      perMin + '/minute and ' + perMsg + '/message beyond budget.';
    each(doc, '.chev-mobile', function (el) {
      el.setAttribute('aria-label', aria);
    });
  }

  function run(doc, fetchImpl) {
    var get = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    function go() {
      apply(doc, FALLBACK); // keep the page correct immediately (idempotent with the HTML)
      if (!get) return Promise.resolve();
      return get(FEED)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j && j.plans && j.plans.solo) apply(doc, j.plans.solo); })
        .catch(function () { /* fallback already applied */ });
    }
    if (doc.readyState === 'loading') {
      doc.addEventListener('DOMContentLoaded', go);
      return Promise.resolve();
    }
    return go();
  }

  return { FEED: FEED, FALLBACK: FALLBACK, money: money, apply: apply, run: run };
});
