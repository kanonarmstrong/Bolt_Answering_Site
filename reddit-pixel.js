/* ============================================================
   Reddit pixel — AFMBP-2639. Built the same way as meta-pixel.js
   (AFMBP-2021). Tells Reddit which ad led to the steps that matter, so Reddit
   Ads can show results per ad and optimize delivery for them:
     PageVisit  once the page is actually seen (never a preload or prerender —
                the same rule as site_landed, AFMBP-2010)
     Lead       a "start free trial" link was tapped (the same funnel step
                meta-pixel.js sends as StartTrialClick), once per page: the
                start of sign-up, the most frequent real step on the site
   It never loads, and sends nothing, for:
     - a browser sending Global Privacy Control (navigator.globalPrivacyControl)
     - a browser that opted out: ?bolt_optout=1, until ?bolt_optout=0, or the
       "Your Privacy Choices" switch (privacy-choices.js, AFMBP-2019). The
       switch's choice is read again before every event, so switching off
       mid-page stops the Lead on that page too.
     - our own test traffic (?bolt_qa=1, see attribution.js; ?demoqa=1) — add
       ?bolt_pixel_debug=1 to load it anyway for one browser session, to check
       events in Reddit Events Manager's "Test events" tab
     - an automated browser (navigator.webdriver)
   No personal data goes to Reddit from the page: rdt('init') carries the pixel
   ID and nothing else. Reddit's "advanced matching" (email, phone number,
   external id, device ids) is deliberately not used, and nothing typed on the
   site is passed to any event.
   window.boltReddit = { enabled, blockedBy } says whether it runs here.
   ============================================================ */
(function () {
  'use strict';

  // Reddit Ads → Events Manager → the pixel ID. Not a secret: it is visible in
  // the page either way. Empty = the pixel is off.
  // OFF since 2026-11-19 (AFMBP-2654): Reddit had automatic advanced matching on
  // for this pixel, so Reddit's own script hashed phone numbers and emails typed
  // on the page and sent them to Reddit. Put 'a2_k1ltn5n0w25j' back only with
  // that ticket's re-enable change: matching off in Reddit, the _rdt_pn/_rdt_em
  // cookie cleanup, and the real-script check.
  var PIXEL_ID = '';

  function store(kind) {
    try { return kind === 'session' ? window.sessionStorage : window.localStorage; } catch (e) { return null; }
  }
  function get(key, kind) { try { var s = store(kind); return s ? s.getItem(key) : null; } catch (e) { return null; } }
  function set(key, value, kind) { try { var s = store(kind); if (s) s.setItem(key, value); } catch (e) {} }
  function remove(key) { try { var s = store(); if (s) s.removeItem(key); } catch (e) {} }

  var params;
  try { params = new URLSearchParams(window.location.search); } catch (e) { params = { get: function () { return null; } }; }
  if (params.get('bolt_optout') === '1') set('bolt_optout', '1');
  else if (params.get('bolt_optout') === '0') remove('bolt_optout');
  if (params.get('bolt_pixel_debug') === '1') set('bolt_pixel_debug', '1', 'session');

  function blockedBy() {
    if (!/^[A-Za-z0-9_]{4,40}$/.test(PIXEL_ID)) return 'no_pixel_id';
    try { if (window.navigator.globalPrivacyControl === true) return 'gpc'; } catch (e) {}
    if (get('bolt_optout') === '1') return 'opted_out';
    try { if (window.navigator.webdriver === true) return 'automated'; } catch (e) {}
    var qa = get('bolt_qa') === '1' || /[?&]demoqa=1(&|$)/.test(window.location.search);
    if (qa && get('bolt_pixel_debug', 'session') !== '1') return 'qa';
    return null;
  }

  var blocked = blockedBy();
  window.boltReddit = { enabled: blocked === null, blockedBy: blocked };
  if (blocked) return;

  // Reddit's base code, written out: a queue that pixel.js drains once loaded.
  function loadPixel() {
    if (window.rdt) return;
    var p = window.rdt = function () {
      if (p.sendEvent) p.sendEvent.apply(p, arguments); else p.callQueue.push(arguments);
    };
    p.callQueue = [];
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.redditstatic.com/ads/pixel.js?pixel_id=' + PIXEL_ID;
    (document.head || document.documentElement).appendChild(s);
    window.rdt('init', PIXEL_ID); // the ID only: no advanced matching
    window.rdt('track', 'PageVisit');
  }

  // Funnel steps arrive from attribution.js as `bolt:track` events. Anything
  // before the page is seen is ignored: the pixel isn't loaded yet.
  var leadSent = false;
  function onTrack(e) {
    var d = e && e.detail; if (!d || typeof window.rdt !== 'function') return;
    // Switched off since the page loaded (privacy-choices.js writes the same
    // key): send nothing more.
    if (blockedBy() !== null) { window.boltReddit.enabled = false; return; }
    if (d.event === 'trial_link_clicked' || d.event === 'demo_trial_clicked') {
      if (leadSent) return;
      leadSent = true;
      window.rdt('track', 'Lead');
    }
  }
  window.addEventListener('bolt:track', onTrack);

  var whenVisible = window.boltAttr && window.boltAttr.whenVisible;
  if (whenVisible) whenVisible(loadPixel);
  else if (!document.visibilityState || document.visibilityState === 'visible') loadPixel();
})();
