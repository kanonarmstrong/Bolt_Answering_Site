/* ============================================================
   Meta pixel — AFMBP-2021. OFF until PIXEL_ID below is set.
   Tells Meta which ad led to the steps that matter, so Ads Manager can show
   results per ad next to spend:
     PageView         once the page is actually seen (never a preload or
                      prerender — same rule as site_landed, AFMBP-2010)
     ViewContent      the demo opened (content_category: button / ad_link)
     Lead             the demo phone was verified; its event_id is shared with
                      the server's copy (Conversions API) so Meta counts it once
     StartTrialClick  (custom) a "start free trial" link was tapped
   It never loads, and sends nothing, for:
     - a browser sending Global Privacy Control (navigator.globalPrivacyControl)
     - a browser that opted out: ?bolt_optout=1, until ?bolt_optout=0
     - our own test traffic (?bolt_qa=1, see attribution.js) — add
       ?bolt_pixel_debug=1 to load it anyway for one browser session, to check
       events in Meta's "Test events" tab
     - an automated browser (navigator.webdriver)
   No personal data goes to Meta from the page: no phone, email or name, and
   Meta's automatic button and page scraping is switched off.
   window.boltMeta.enabled tells demo.js whether the server may send its copy.
   ============================================================ */
(function () {
  'use strict';

  // Meta Events Manager → Data sources → the dataset (pixel) ID. Not a secret:
  // it is visible in the page either way. Empty = the pixel is off.
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
    if (!/^[0-9]{6,20}$/.test(PIXEL_ID)) return 'no_pixel_id';
    try { if (window.navigator.globalPrivacyControl === true) return 'gpc'; } catch (e) {}
    if (get('bolt_optout') === '1') return 'opted_out';
    try { if (window.navigator.webdriver === true) return 'automated'; } catch (e) {}
    var qa = get('bolt_qa') === '1' || /[?&]demoqa=1(&|$)/.test(window.location.search);
    if (qa && get('bolt_pixel_debug', 'session') !== '1') return 'qa';
    return null;
  }

  var blocked = blockedBy();
  function newEventId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }
  window.boltMeta = { enabled: blocked === null, blockedBy: blocked, newEventId: newEventId };
  if (blocked) return;

  // Meta's base code, written out: a queue that fbevents.js drains once loaded.
  function loadPixel() {
    if (window.fbq) return;
    var q = window.fbq = function () {
      if (q.callMethod) q.callMethod.apply(q, arguments); else q.queue.push(arguments);
    };
    if (!window._fbq) window._fbq = q;
    q.push = q; q.loaded = true; q.version = '2.0'; q.queue = [];
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://connect.facebook.net/en_US/fbevents.js';
    (document.head || document.documentElement).appendChild(s);
    window.fbq('set', 'autoConfig', false, PIXEL_ID); // no automatic button / page scraping
    window.fbq('init', PIXEL_ID);
    window.fbq('track', 'PageView');
  }

  // Funnel steps arrive from attribution.js as `bolt:track` events. Anything
  // before the page is seen is ignored: the pixel isn't loaded yet.
  function onTrack(e) {
    var d = e && e.detail; if (!d || !window.fbq) return;
    var data = d.data || {};
    if (d.event === 'demo_opened') {
      window.fbq('track', 'ViewContent', { content_name: 'demo', content_category: String(data.trigger || 'button') });
    } else if (d.event === 'demo_code_verified') {
      if (data.event_id) window.fbq('track', 'Lead', { content_name: 'demo' }, { eventID: String(data.event_id) });
      else window.fbq('track', 'Lead', { content_name: 'demo' });
    } else if (d.event === 'trial_link_clicked' || d.event === 'demo_trial_clicked') {
      window.fbq('trackCustom', 'StartTrialClick', { from: String(data.from || data.placement || 'site') });
    }
  }
  window.addEventListener('bolt:track', onTrack);

  var whenVisible = window.boltAttr && window.boltAttr.whenVisible;
  if (whenVisible) whenVisible(loadPixel);
  else if (!document.visibilityState || document.visibilityState === 'visible') loadPixel();
})();
