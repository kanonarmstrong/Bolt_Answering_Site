/* ============================================================
   JavaScript error reports (Sentry) — AFMBP-2130. ON: SENTRY_SITE_ENABLED below.
   The privacy decision (AFMBP-1698: hosted Sentry, US) allowed it once the
   privacy policy named Sentry; that update is live as of 2026-10-12. To turn
   Sentry off everywhere, set the switch to false (a one-line change). While it
   is false this file does nothing else: the Sentry script is never requested
   and nothing is sent.
   When it is on, a visit reports to Sentry only on the live site
   (www.boltanswering.com: local copies and the headless checks in tools/ never
   load it) and only with the Meta pixel's gates, read from the same helpers
   (privacy-choices.js and attribution.js decide; nothing is re-implemented):
     - not a browser sending Global Privacy Control, and not one that opted out
       ("Your Privacy Choices", ?bolt_optout=1)
     - not our own test traffic (?bolt_qa=1, ?demoqa=1)
     - not an automated browser (navigator.webdriver)
   What it sends: JavaScript errors only. Never tracing, never session replay:
   it loads Sentry's pinned errors-only bundle with Subresource Integrity, not
   the Loader Script, whose features can be switched on from Sentry's website.
   No sessions and no client reports either: Sentry's servers hear from a
   browser only when an error is sent (the bundle itself comes from Sentry's
   CDN, once per page view). Before an error leaves, every URL loses its query
   string and fragment (they carry ad click ids), phone numbers and email
   addresses are replaced, the Referer header is dropped and no user is set.
   The SDK asks Sentry not to add the visitor's IP address (infer_ip "never");
   the project's "Prevent Storing of IP Addresses" setting is the server half.
   Demo failures that used to report nothing (demo.js) arrive here as
   bolt:track events from attribution.js and go to Sentry as messages tagged
   demo_failure. Their first-party analytics events are sent either way.
   window.boltSentry says whether it is on in this browser, and if not, why
   ('not_loaded': the bundle was blocked, often by an ad blocker, or refused).
   ============================================================ */
(function () {
  'use strict';

  // The switch. false: Sentry is off everywhere, and nothing below runs.
  var SENTRY_SITE_ENABLED = true;

  // Public by design: a browser DSN only lets a page send events to this project.
  var DSN = 'https://6e434e3e49cc9c440b54368249da1d96@o4512245349875712.ingest.us.sentry.io/4512245491761152';
  // Sentry's errors-only CDN bundle at a pinned version, with the Subresource
  // Integrity hash Sentry publishes for it (tools/sentry-check.mjs also checks it
  // against the file). A version bump changes both lines.
  var BUNDLE = 'https://browser.sentry-cdn.com/10.76.2/bundle.min.js';
  var INTEGRITY = 'sha384-UxIR36IcGoGUfLoGUusrMIf62txfGSt8+2nzkKL3PMw3TFPWZ9JRczoq8o2AfY0e';
  var HOSTS = ['www.boltanswering.com', 'boltanswering.com'];

  function blockedBy() {
    if (!SENTRY_SITE_ENABLED) return 'off';
    if (HOSTS.indexOf(window.location.hostname) < 0) return 'host';
    var attr = window.boltAttr, choices = window.boltPrivacyChoices;
    if (!attr || !choices) return 'no_gates'; // the gates can't be read: stay off
    try {
      if (!choices.allowed()) return 'privacy'; // Global Privacy Control, or opted out
      if (attr.isAutomated()) return 'automated';
      if (attr.isQa()) return 'qa';
    } catch (e) { return 'no_gates'; }
    return null;
  }

  var blocked = blockedBy();
  window.boltSentry = { enabled: blocked === null, blockedBy: blocked };
  if (blocked) return;

  // ---------- scrubbing: every breadcrumb, and every event before it is sent ----------
  var ABS_URL = /(\b[a-z][a-z0-9+.\-]*:\/\/[^\s?#"'<>()\[\]{}]*)[?#][^\s"'<>()\[\]{}]*/gi;
  var REL_URL = /(^|[\s"'(=,])(\/[^\s?#"'<>()\[\]{}]*)[?#][^\s"'<>()\[\]{}]*/g;
  var CLICK_ID = /\b(fbclid|gclid|gbraid|wbraid|ttclid|rdt_cid|msclkid|dclid|twclid|igshid|utm_[a-z]+)=[^&\s"'<>#]*/gi;
  var EMAIL = /[a-z0-9._%+\-]+(?:@|%40)[a-z0-9\-]+(?:\.[a-z0-9\-]+)*\.[a-z]{2,}/gi;
  // No lookbehind (older Safari can't parse it): the character before a number is
  // captured and put back. A number inside a longer run of letters and digits, like
  // an event id, is left alone.
  var E164 = /(^|[^\w+])\+[1-9]\d{6,14}(?!\w)/g;
  var US_PHONE = /(^|[^\w+])(?:\+?1[\s.\-]?)?(?:\(\d{3}\)|\d{3})[\s.\-]?\d{3}[\s.\-]?\d{4}(?!\w)/g;
  function scrubText(s) {
    return s.replace(ABS_URL, '$1').replace(REL_URL, '$1$2').replace(CLICK_ID, '$1=[filtered]')
      .replace(EMAIL, '[email]').replace(E164, '$1[phone]').replace(US_PHONE, '$1[phone]');
  }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isPlain(v) {
    var p = Object.getPrototypeOf(v);
    return Array.isArray(v) || p === Object.prototype || p === null;
  }
  // Ids and the SDK's own fields are left as they are; sdkProcessingMetadata holds the
  // SDK's live objects and is never sent.
  var KEEP = { event_id: 1, sdk: 1, release: 1, environment: 1, platform: 1, level: 1, timestamp: 1, start_timestamp: 1, trace_id: 1, span_id: 1, parent_span_id: 1, debug_meta: 1, sdkProcessingMetadata: 1 };
  // Every string in the event, at any depth. Only plain objects and arrays are walked
  // (beforeSend gets the SDK's normalized copy); anything nested too deep is dropped.
  function scrub(v, depth) {
    if (typeof v === 'string') return scrubText(v);
    if (!v || typeof v !== 'object' || !isPlain(v)) return v;
    if (depth > 12) return null;
    for (var k in v) if (has(v, k) && !has(KEEP, k)) v[k] = scrub(v[k], depth + 1);
    return v;
  }
  function beforeSend(event) {
    if (blockedBy() !== null) return null; // e.g. switched off in Your Privacy Choices since the page loaded
    delete event.user;
    var req = event.request;
    if (req) {
      if (req.headers) ['Referer', 'referer', 'Cookie', 'cookie'].forEach(function (h) { delete req.headers[h]; });
      delete req.cookies; delete req.query_string; delete req.data;
    }
    return scrub(event, 0);
  }
  // A breadcrumb can hold the page's own objects (a console call's arguments), so it is
  // copied, never changed in place; the arguments are dropped (the message has them).
  function beforeBreadcrumb(b) {
    if (!b || typeof b !== 'object') return b;
    var out = {}, k;
    for (k in b) if (has(b, k)) out[k] = b[k];
    if (typeof out.message === 'string') out.message = scrubText(out.message);
    if (out.data && typeof out.data === 'object') {
      var d = {};
      for (k in out.data) if (has(out.data, k) && k !== 'arguments') d[k] = typeof out.data[k] === 'string' ? scrubText(out.data[k]) : out.data[k];
      out.data = d;
    }
    return out;
  }

  // Not the site's errors: browser extensions, and code that in-app browsers (Facebook,
  // Instagram) put into pages. Sentry already leaves out "Script error.", ResizeObserver
  // notices and several known in-app browser errors on its own.
  var DENY_URLS = [/^(?:chrome|moz|safari|safari-web|ms-browser)-extension:\/\//i, /^chrome:\/\//i, /^resource:\/\//i, /^webkit-masked-url:/i];
  var IGNORE_ERRORS = ['ResizeObserver loop limit exceeded', 'instantSearchSDKJSBridgeClearHighlight', 'webkit.messageHandlers'];

  // The deploy this page came from, e.g. bolt-site@20261012T185205Z. There is no build
  // step to stamp a commit on the page; GitHub Pages gives every file of a deploy the
  // same Last-Modified time, and each merge to main is one deploy (its commit:
  // gh api repos/kanonarmstrong/Bolt_Answering_Site/pages/builds). Without that header
  // the browser reports the current time instead: then it is 'unknown'.
  function release() {
    var t = Date.parse(document.lastModified);
    if (!(t > 0) || Math.abs(Date.now() - t) < 5000) return 'bolt-site@unknown';
    return 'bolt-site@' + new Date(t).toISOString().slice(0, 19).replace(/[-:]/g, '') + 'Z';
  }

  // ---------- demo failures (demo.js → attribution.js → bolt:track) ----------
  var DEMO_FAILURES = {
    demo_recap_poll_failed: 'recap_poll_network',
    demo_call_id_missing: 'no_call_id',
    demo_closed_while_polling: 'closed_while_polling'
  };
  var MESSAGES = {
    recap_poll_network: 'Demo: the recap checks kept failing on the network, so the page stopped following the call',
    no_call_id: 'Demo: the call was placed but the API returned no call id, so the page had nothing to follow',
    closed_while_polling: 'Demo: the dialog was closed while the page was still following a call'
  };
  var TRADES = ['hvac', 'plumbing', 'electrical', 'handyman', 'general_contracting'];
  var ready = false, queue = [], early = [];
  // Before the bundle has loaded, errors wait here (a few) and are sent once it has.
  function send(fn) {
    if (ready) { try { fn(window.Sentry); } catch (e) {} } else if (queue.length < 20) queue.push(fn);
  }
  function onTrack(e) {
    var d = e && e.detail;
    if (!d || !has(DEMO_FAILURES, d.event)) return;
    var kind = DEMO_FAILURES[d.event], data = d.data || {};
    var tags = {
      demo_failure: kind,
      trade: TRADES.indexOf(String(data.trade)) > -1 ? String(data.trade) : 'other',
      demo_mode: data.mode === 'inbound' ? 'inbound' : 'outbound'
    };
    send(function (S) {
      S.captureMessage(MESSAGES[kind], { level: kind === 'closed_while_polling' ? 'warning' : 'error', tags: tags, fingerprint: ['demo-failure', kind] });
    });
  }
  window.addEventListener('bolt:track', onTrack);

  // Errors thrown while the bundle is still loading (the demo opens on ad links as the
  // page loads) are kept and sent once it is ready.
  function onEarlyError(e) { if (e && e.error && early.length < 10) early.push(e.error); }
  function onEarlyRejection(e) { if (e && e.reason != null && early.length < 10) early.push(e.reason); }
  window.addEventListener('error', onEarlyError);
  window.addEventListener('unhandledrejection', onEarlyRejection);
  function stopEarly() {
    window.removeEventListener('error', onEarlyError);
    window.removeEventListener('unhandledrejection', onEarlyRejection);
  }
  // Blocked (ad blockers often block Sentry) or refused by the integrity check: stay off.
  function giveUp() {
    stopEarly(); early = []; queue = [];
    window.removeEventListener('bolt:track', onTrack);
    window.boltSentry = { enabled: false, blockedBy: 'not_loaded' };
  }

  function start() {
    var S = window.Sentry;
    if (!S || typeof S.init !== 'function') return giveUp();
    stopEarly();
    try {
      S.init({
        dsn: DSN,
        environment: 'production',
        release: release(),
        // Pinned SDK is v10 (owner, 2026-10-12, same major as the web app): there,
        // sendDefaultPii is the setting that applies. v11 ignores it and reads
        // dataCollection instead (and collects everything when that is left out),
        // so dataCollection stays set too, ready for the v11 move (AFMBP-2152).
        sendDefaultPii: false,
        dataCollection: {
          userInfo: false, // no user and no IP address: the SDK sends infer_ip "never"
          cookies: false,
          httpHeaders: { allow: ['user-agent'] }, // the browser line only
          httpBodies: [],
          urlQueryParams: false
        },
        sendClientReports: false,
        // No sessions (a request on every page view) and no locale or time zone.
        integrations: function (defaults) {
          return defaults.filter(function (i) { return i.name !== 'BrowserSession' && i.name !== 'CultureContext'; });
        },
        maxBreadcrumbs: 50,
        beforeBreadcrumb: beforeBreadcrumb,
        beforeSend: beforeSend,
        denyUrls: DENY_URLS,
        ignoreErrors: IGNORE_ERRORS
      });
    } catch (e) { return giveUp(); }
    ready = true;
    early.splice(0).forEach(function (err) { try { S.captureException(err); } catch (e) {} });
    queue.splice(0).forEach(function (fn) { try { fn(S); } catch (e) {} });
  }

  // Loaded once the page is seen, like the pixel: a preloaded page nobody looks at
  // does not fetch it. Low priority: the page's own pictures go first (errors wait above).
  function load() {
    var s = document.createElement('script');
    s.src = BUNDLE;
    s.setAttribute('integrity', INTEGRITY);
    s.setAttribute('crossorigin', 'anonymous');
    s.setAttribute('fetchpriority', 'low');
    s.async = true;
    s.onload = start;
    s.onerror = giveUp;
    (document.head || document.documentElement).appendChild(s);
  }
  if (window.boltAttr.whenVisible) window.boltAttr.whenVisible(load);
  else load();
})();
