/* ============================================================
   Funnel attribution + events — AFMBP-1968 (part of AFMBP-1966)
   Loaded on every page. It:
   - keeps an anonymous visitor id and the latest ad touch (utm_* and
     any ad click id) in localStorage;
   - logs `site_landed` once per browser session, once the page is actually
     seen (AFMBP-2010: a preloaded, prerendered or background page logs
     nothing);
   - logs, once the page is seen, the visitor's first tap, key or scroll
     (`site_engaged`) and, when the page is first hidden or left, how long it
     was on screen and how far down it was read (`site_exit`) (AFMBP-2565),
     with how fast it answered taps and how much it jumped (AFMBP-2657);
   - names the browser on every event (`browser`), by the web app's sign-up
     page's rules (AFMBP-2565);
   - hands both to the app on every signup link (?bvid=…&utm_*=…), so a
     person's demo and signup join up in Bolt's analytics, plus the visitor's
     "Your Privacy Choices" opt-out (?bolt_optout=1, AFMBP-2480) so the app's
     pixel stays off for them too;
   - exposes window.boltAttr.track() for the demo flow (demo.js), and
     announces each event as a `bolt:track` window event (meta-pixel.js).
   Events go to Bolt's own ingest with source 'site'. No personal data,
   ever: never a phone number, email, name or business name.
   Storage can be unavailable (private mode, blocked site data); then
   the site works the same and only the join is lost.
   ============================================================ */
(function () {
  'use strict';

  var API = 'https://bolt-staging.fly.dev';
  var SIGNUP = 'https://app.boltanswering.com/signup';
  var UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  // Meta, TikTok, Reddit, Google (incl. the iOS app variants).
  var CLICK_IDS = ['fbclid', 'ttclid', 'rdt_cid', 'gclid', 'wbraid', 'gbraid'];
  var ID_RE = /^[A-Za-z0-9-]{8,64}$/;

  function store(kind) {
    try { return kind === 'session' ? window.sessionStorage : window.localStorage; } catch (e) { return null; }
  }
  function get(key, kind) {
    try { var s = store(kind); return s ? s.getItem(key) : null; } catch (e) { return null; }
  }
  function set(key, value, kind) {
    try { var s = store(kind); if (s) s.setItem(key, value); } catch (e) {}
  }
  function remove(key) {
    try { var s = store(); if (s) s.removeItem(key); } catch (e) {}
  }

  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }
  var memoryVid = null;
  function visitorId() {
    var v = get('bolt_vid');
    if (v && ID_RE.test(v)) return v;
    // AFMBP-2612: a /start/ page decides the visitor's arm before this script runs, from the id it
    // read or made (window.boltXp.vid). With storage blocked, this page load keeps that same id, so
    // the platform hears from the subject the arm was decided for.
    if (!memoryVid) {
      var x = window.boltXp;
      memoryVid = x && typeof x.vid === 'string' && ID_RE.test(x.vid) ? x.vid : newId();
    }
    set('bolt_vid', memoryVid);
    return memoryVid;
  }

  var params;
  try { params = new URLSearchParams(window.location.search); } catch (e) { params = { get: function () { return null; } }; }

  // Our own test traffic: ?bolt_qa=1 tags this browser's events (qa: true) until
  // ?bolt_qa=0, so funnel reports can leave it out. ?demoqa=1 counts too.
  if (params.get('bolt_qa') === '1') set('bolt_qa', '1');
  else if (params.get('bolt_qa') === '0') remove('bolt_qa');
  function isQa() { return get('bolt_qa') === '1' || /[?&]demoqa=1(&|$)/.test(window.location.search); }

  // ---------- experiments: the landing A/B (AFMBP-2612, the experiment platform) ----------
  // The /start/ pages decide the visitor's arm before they paint (an inline script, from bolt_vid
  // and a baked definition) and leave it in window.boltXp. Once the page is seen, the page calls
  // xpExpose(), which reports the exposure twice, from one call with one arm: to the platform
  // through EZ's gateway (as the platform's own web SDK sends it), and to Bolt's own funnel as
  // `xp_exposed`. It also keeps the arm, so every sign-up link on any page carries it to the app
  // (xp=<key>.<variation>.<configVersion>, next to bvid), and a trial tap goes to the platform as
  // `start_trial_clicked`. Our own test browsers (bolt_qa) send nothing to the platform; a QA
  // browser's forced arm (?bolt_xp=<variation>) is kept for its browser session only. Opted-out
  // and GPC browsers count like everyone else (owner, 2026-11-17): nothing here reads bolt_optout
  // or Global Privacy Control, and none of these events is one meta-pixel.js forwards.
  var XP_KEYS = ['landing_demo_buttons'];
  // The SPEC's format: keys and variations match [a-z][a-z0-9_]*, so dots separate them.
  var XP_RE = /^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)\.([1-9][0-9]*)$/;
  var XP_GATEWAY = API + '/api/public/experiments/v1/events';
  function xpParse(s) {
    var m = XP_RE.exec(String(s || ''));
    if (!m || XP_KEYS.indexOf(m[1]) < 0) return null;
    return { experimentKey: m[1], variation: m[2], configVersion: parseInt(m[3], 10) };
  }
  function xpString(c) { return c.experimentKey + '.' + c.variation + '.' + c.configVersion; }
  // The arm this page shows, from the /start/ pages' inline decide; null on other pages and for a
  // visitor outside the test.
  function xpPage() {
    var x = window.boltXp;
    return x && x.variation ? xpParse(x.key + '.' + x.variation + '.' + x.configVersion) : null;
  }
  // The arm a sign-up link carries: a QA browser's forced arm (this browser session), else the
  // arm this page shows, else the one kept from the visitor's exposure.
  function xpContext() {
    if (isQa()) { var f = xpParse(get('bolt_xp', 'session')); if (f) return f; }
    return xpPage() || xpParse(get('bolt_xp'));
  }
  // A version 4 UUID: the platform's events require one as eventId.
  function uuid4() {
    try { if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID(); } catch (e) {}
    var b = [], i;
    try { var r = new Uint8Array(16); window.crypto.getRandomValues(r); for (i = 0; i < 16; i++) b.push(r[i]); }
    catch (e) { for (i = 0; i < 16; i++) b.push(Math.floor(Math.random() * 256)); }
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var hex = '';
    for (i = 0; i < 16; i++) hex += (b[i] + 0x100).toString(16).slice(1);
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }
  // The platform's per-tab session id (any 1-200 characters).
  var xpSid = null;
  function xpSession() {
    if (xpSid) return xpSid;
    xpSid = get('bolt_xp_sid', 'session');
    if (!xpSid || !ID_RE.test(xpSid)) { xpSid = uuid4(); set('bolt_xp_sid', xpSid, 'session'); }
    return xpSid;
  }
  // One event to the platform through EZ's gateway: JSON + keepalive (EZ parses JSON only), fire
  // and forget. EZ adds its ingest key; the browser holds none. Never for our own test browsers.
  function xpSend(name, type, ctx, props) {
    if (isQa()) return;
    try {
      window.fetch(XP_GATEWAY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          eventId: uuid4(), eventName: name, eventType: type, platform: 'web',
          anonymousId: visitorId(), sessionId: xpSession(),
          url: window.location.origin + window.location.pathname,
          sdkVersion: 'bolt-site-1', timestamp: new Date().toISOString(),
          experiments: [ctx], properties: props || {}
        })
      }).catch(function () {});
    } catch (e) {}
  }
  // The /start/ pages call this once the page is seen (whenVisible, as site_landed). Once per
  // browser tab session per visitor and arm, as the platform's own web SDK sends exposures (a new
  // visitor id in the same tab, its storage cleared or blocked, is a new subject and is reported).
  function xpExpose() {
    var c = xpPage();
    if (!c) return null;
    var s = xpString(c), forced = !!window.boltXp.forced, mark = visitorId() + ' ' + s;
    if (forced) set('bolt_xp', s, 'session'); else set('bolt_xp', s);
    if (get('bolt_xp_sent', 'session') === mark) return c;
    set('bolt_xp_sent', mark, 'session');
    xpSend('experiment_exposed', 'exposure', c, {});
    var p = { experiment_key: c.experimentKey, variation: c.variation, config_version: c.configVersion };
    if (forced) p.forced = true;
    track('xp_exposed', p);
    return c;
  }

  // ---------- count only a page someone sees (AFMBP-2010) ----------
  // A page can run without anyone looking at it: browsers prerender likely next
  // pages, apps preload links in the background, and automated browsers (ad
  // review, link scanners) load landing pages. Counting those inflated
  // "landed" (and, on ?talk ad links, "opened the demo") past the ad platforms'
  // click counts. Anything that should count a real view waits for whenVisible.
  function isVisible() {
    var vs = document.visibilityState;
    return (!vs || vs === 'visible') && !document.prerendering;
  }
  var visibleAtLoad = isVisible();
  var loadedAt = Date.now();
  function whenVisible(fn) {
    var done = false;
    function check() {
      if (done || !isVisible()) return;
      done = true;
      document.removeEventListener('visibilitychange', check);
      document.removeEventListener('prerenderingchange', check);
      fn();
    }
    document.addEventListener('visibilitychange', check);
    document.addEventListener('prerenderingchange', check);
    check();
  }
  // An automated browser (ad review, link scanners, test rigs) announces itself
  // here; every event says so, so reporting can leave the whole visitor out.
  function isAutomated() {
    try { return window.navigator.webdriver === true; } catch (e) { return false; }
  }

  // ---------- the browser, named as the app's sign-up page names it (AFMBP-2565) ----------
  // The server's own reading of the browser (ua_class, from the request's User-Agent) calls
  // Facebook's in-app browser a normal one, so every event also says what the page itself
  // sees. Same rules and values as bolt-web's sign-up page, which logs it as `browser` on
  // signup_methods_viewed (src/app/onboarding/SignupEntryStep.tsx lines 112, 120, 127):
  // bolt-web src/lib/social-signin-availability.ts (AFMBP-2543, commit 87e1a63, unchanged
  // at origin/main 960044a): IN_APP_TOKENS lines 52-62, ANDROID_WEBVIEW line 65,
  // signupOsOf 67-73, signupBrowserOf 75-82, browserClassOf 126-129, currentSignupBrowser
  // 132-135. Change one, change the other. Values: "<os>_<kind>", os ios | android | desktop,
  // kind browser | webview (an Android WebView with no app token) | the app's name, e.g.
  // ios_browser, android_webview, android_facebook, ios_instagram, desktop_browser.
  var IN_APP_TOKENS = [
    // Instagram before Facebook: Meta has shipped shared tokens before.
    ['instagram', /\bInstagram\b/],
    ['facebook', /FBAN\/|FBAV\/|FB_IAB|FBIOS|FB4A|\[FB/],
    ['tiktok', /musical_ly|BytedanceWebview|\bTikTok\b|trill_/i],
    ['snapchat', /Snapchat/],
    ['linkedin', /LinkedInApp/],
    ['line', /\bLine\//],
    ['pinterest', /Pinterest/],
    ['x', /Twitter|TwitterAndroid/],
    ['wechat', /MicroMessenger/]
  ];
  var ANDROID_WEBVIEW = /; wv\)/;
  function signupOsOf(ua, maxTouchPoints) {
    if (/iPhone|iPod|iPad/.test(ua)) return 'ios';
    // iPadOS Safari reports a Mac; a Mac has no touch screen.
    if (/Macintosh/.test(ua) && maxTouchPoints > 1) return 'ios';
    if (/Android/.test(ua)) return 'android';
    return 'desktop';
  }
  function signupBrowserOf(ua, maxTouchPoints) {
    var os = signupOsOf(ua, maxTouchPoints || 0);
    for (var i = 0; i < IN_APP_TOKENS.length; i++) {
      if (IN_APP_TOKENS[i][1].test(ua)) return { os: os, inApp: IN_APP_TOKENS[i][0] };
    }
    if (os === 'android' && ANDROID_WEBVIEW.test(ua)) return { os: os, inApp: 'other' };
    return { os: os, inApp: null };
  }
  function browserClassOf(b) {
    if (b.inApp === 'other') return b.os + '_webview';
    return b.os + '_' + (b.inApp || 'browser');
  }
  // This page's browser, read once.
  var BROWSER = (function () {
    try {
      var n = window.navigator;
      return browserClassOf(signupBrowserOf(String((n && n.userAgent) || ''), (n && n.maxTouchPoints) || 0));
    } catch (e) { return 'desktop_browser'; }
  })();

  // The latest ad touch wins; a visit with no touch keeps the stored one.
  (function captureTouch() {
    var touch = {}, any = false;
    UTM.forEach(function (k) {
      var v = params.get(k);
      if (v) { touch[k] = String(v).slice(0, 100); any = true; }
    });
    for (var i = 0; i < CLICK_IDS.length; i++) {
      var id = params.get(CLICK_IDS[i]);
      if (id) { touch.click_id_type = CLICK_IDS[i]; touch.click_id = String(id).slice(0, 256); any = true; break; }
    }
    if (!any) return;
    touch.landing = window.location.pathname;
    touch.captured_at = new Date().toISOString();
    set('bolt_attr', JSON.stringify(touch));
  })();

  function getTouch() {
    try {
      var raw = get('bolt_attr');
      var t = raw ? JSON.parse(raw) : null;
      return t && typeof t === 'object' && !Array.isArray(t) ? t : null;
    } catch (e) { return null; }
  }

  function track(event, props) {
    try {
      var data = {};
      if (props) Object.keys(props).forEach(function (k) { data[k] = props[k]; });
      data.page = window.location.pathname;
      data.browser = BROWSER;
      var touch = getTouch();
      if (touch) data.attr = touch;
      if (isQa()) data.qa = true;
      if (isAutomated()) data.automated = true;
      // JSON + keepalive (not sendBeacon: the ingest parses JSON only), so an
      // event fired just before a navigation still leaves. Returned (AFMBP-2344) so a
      // caller about to leave the page can wait for it to go out.
      var sent = window.fetch(API + '/api/public/analytics/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          events: [{ event_type: event, session_id: visitorId(), source: 'site', event_data: data }]
        })
      }).catch(function () {});
      // Other first-party scripts follow the funnel through this event rather
      // than hooking track(): meta-pixel.js (AFMBP-2021) maps a few steps to Meta.
      try { window.dispatchEvent(new CustomEvent('bolt:track', { detail: { event: event, data: data } })); } catch (e) {}
      // AFMBP-2612: a trial tap by a visitor in the landing A/B also goes to the platform, on any
      // page (the SPEC's fallback primary, `start_trial_clicked`).
      if (event === 'trial_link_clicked' || event === 'demo_trial_clicked') {
        var xc = xpContext();
        if (xc) xpSend('start_trial_clicked', 'track', xc, { from: String(data.from || data.placement || 'site') });
      }
      return sent;
    } catch (e) {}
  }

  // ---------- signup links carry the visitor + touch to the app ----------
  function isSignup(href) {
    try {
      var u = new URL(href, window.location.href);
      return u.origin + u.pathname === SIGNUP;
    } catch (e) { return false; }
  }
  function decorate(href) {
    try {
      var u = new URL(href, window.location.href);
      if (u.origin + u.pathname !== SIGNUP) return href;
      u.searchParams.set('bvid', visitorId());
      var touch = getTouch();
      if (touch) {
        UTM.forEach(function (k) { if (touch[k]) u.searchParams.set(k, touch[k]); });
        if (touch.click_id_type && touch.click_id) u.searchParams.set(touch.click_id_type, touch.click_id);
      }
      // Our own test browsers stay test browsers in the app (AFMBP-2021: the app's
      // pixel and analytics leave QA out the same way the site does).
      if (isQa()) u.searchParams.set('bolt_qa', '1');
      // Opted out under "Your Privacy Choices": the app keeps it for its own origin.
      if (get('bolt_optout') === '1') u.searchParams.set('bolt_optout', '1');
      else u.searchParams.delete('bolt_optout');
      // AFMBP-2612: the visitor's arm in the landing A/B, for the app's sign-up page event.
      var xc = xpContext();
      if (xc) u.searchParams.set('xp', xpString(xc));
      else u.searchParams.delete('xp');
      return u.toString();
    } catch (e) { return href; }
  }
  function decorateAll() {
    var links = document.querySelectorAll('a[href^="' + SIGNUP + '"]');
    for (var i = 0; i < links.length; i++) links[i].setAttribute('href', decorate(links[i].getAttribute('href')));
  }
  function placement(a) {
    if (a.closest('.floating-cta')) return 'floating';
    if (a.closest('header, .nav, nav')) return 'nav';
    if (a.closest('footer')) return 'footer';
    var section = a.closest('section[class]');
    return section ? String(section.className).split(/\s+/)[0] : 'page';
  }
  // Capture phase: runs before the link navigates, and also catches links built
  // later (the demo's own trial links). Demo links are logged by demo.js.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || !isSignup(a.getAttribute('href'))) return;
    a.setAttribute('href', decorate(a.getAttribute('href')));
    if (!a.closest('.demo-backdrop')) track('trial_link_clicked', { placement: placement(a) });
  }, true);

  // ---------- landing: once per browser session ----------
  function landed() {
    if (get('bolt_landed', 'session')) return;
    set('bolt_landed', '1', 'session');
    var ref = null;
    try {
      // The referring site's origin only — never its full URL.
      if (document.referrer) {
        var o = new URL(document.referrer).origin;
        if (o !== window.location.origin) ref = o;
      }
    } catch (e) {}
    var mobile = !!(window.matchMedia && window.matchMedia('(max-width:768px)').matches);
    track('site_landed', {
      referrer: ref,
      device: mobile ? 'mobile' : 'desktop',
      talk_link: /[?&]talk(=|&|$)/.test(window.location.search),
      // Diagnostics: was the page visible when it loaded, and if not, how long
      // it waited before someone saw it.
      visible_at_load: visibleAtLoad,
      hidden_ms: visibleAtLoad ? 0 : Math.max(0, Date.now() - loadedAt)
    });
  }

  // ---------- first touch, time on screen and exit (AFMBP-2565) ----------
  // Most ad visitors leave without a tap, and nothing said how long they stayed, how far
  // they read, or whether anyone was there at all (an app can load an ad's page before the
  // ad is tapped). Both events start counting once the page is seen (whenVisible, as
  // site_landed) and go out through track(): the same flags, the same keepalive send.
  //   site_engaged {ms}: the visitor's first tap, key or scroll of the page, once per page
  //     load; ms since the navigation started.
  //   site_exit {visible_ms, scroll_pct, engaged, lcp_ms, inp_ms, cls}: when the page is first hidden
  //     (another tab or app, the screen off) or left, whichever comes first; once per view.
  //     A page brought back from the back/forward cache is a new view.
  //       visible_ms  how long this view was on screen (a page seen as it loaded counts
  //                   from the navigation's start)
  //       scroll_pct  the deepest the bottom of the screen got, as a percent of the page's
  //                   height (0-100; the first screen counts, so a page never scrolled says
  //                   how much of it that screen showed)
  //       engaged     whether site_engaged was sent
  //       lcp_ms      Largest Contentful Paint, ms since the navigation started, or null
  //                   where the browser doesn't report it
  //     AFMBP-2657, the landing A/B's speed guardrail (SPEC G1: LCP and INP at +20% p75; CLS is
  //     only looked at):
  //       inp_ms      Interaction to Next Paint: this view's slowest tap, click or key press,
  //                   from the input to the next frame drawn, in ms (past 50 of them, one
  //                   slowest per 50 is set aside, as Chrome counts it). null where the browser
  //                   doesn't report it, or when nobody tapped, clicked or typed
  //       cls         Cumulative Layout Shift: this view's largest burst of layout shifts nobody
  //                   caused (shifts under 1 s apart, at most 5 s in all; a shift right after
  //                   an input doesn't count), to 4 decimals; 0 when nothing moved, null where
  //                   the browser doesn't report it (Safari and Firefox don't)
  function sinceStart() {
    try { if (window.performance && typeof window.performance.now === 'function') return window.performance.now(); } catch (e) {}
    return Date.now() - loadedAt;
  }
  var lcpMs = null, lcpObserver = null;
  function onLcp(entries) {
    for (var i = 0; i < entries.length; i++) lcpMs = Math.round(entries[i].startTime);
  }
  try {
    var entryTypes = window.PerformanceObserver && window.PerformanceObserver.supportedEntryTypes;
    if (entryTypes && entryTypes.indexOf('largest-contentful-paint') > -1) {
      lcpObserver = new window.PerformanceObserver(function (list) { onLcp(list.getEntries()); });
      lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
    }
  } catch (e) { lcpObserver = null; }

  // INP: the 10 slowest interactions so far, each at its slowest event. An event the browser
  // took under 16 ms isn't reported, but the first interaction always is (first-input).
  var inp, inpObservers = [];
  function interactionCount() {
    try { if (typeof window.performance.interactionCount === 'number') return window.performance.interactionCount; } catch (e) {}
    return inp.seen;
  }
  function resetInp() { inp = { slowest: [], ids: {}, seen: 0 }; inp.base = interactionCount(); }
  resetInp();
  function onEvents(entries) {
    for (var i = 0; i < entries.length; i++) {
      var id = entries[i].interactionId, ms = Math.round(entries[i].duration), j;
      if (!id) continue;   // a scroll, a hover: not an interaction
      if (!inp.ids[id]) { inp.ids[id] = true; inp.seen++; }
      for (j = 0; j < inp.slowest.length && inp.slowest[j].id !== id; j++) {}
      if (j < inp.slowest.length) inp.slowest[j].ms = Math.max(inp.slowest[j].ms, ms);
      else inp.slowest.push({ id: id, ms: ms });
      inp.slowest.sort(function (a, b) { return b.ms - a.ms; });
      if (inp.slowest.length > 10) inp.slowest.length = 10;
    }
  }
  function inpMs() {
    if (!inpObservers.length || !inp.slowest.length) return null;
    var n = Math.max(0, interactionCount() - inp.base);
    return inp.slowest[Math.min(inp.slowest.length - 1, Math.floor(n / 50))].ms;
  }
  // CLS: shifts under 1 s apart (at most 5 s in all) add up; the largest such burst counts.
  var cls = null, clsObserver = null, burst = { sum: 0, first: 0, last: 0 };
  function onShifts(entries) {
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.hadRecentInput) continue;
      if (burst.sum && e.startTime - burst.last < 1000 && e.startTime - burst.first < 5000) burst.sum += e.value;
      else burst = { sum: e.value, first: e.startTime, last: e.startTime };
      burst.last = e.startTime;
      if (burst.sum > cls) cls = burst.sum;
    }
  }
  try {
    var perfTypes = (window.PerformanceObserver && window.PerformanceObserver.supportedEntryTypes) || [];
    if (perfTypes.indexOf('event') > -1 && window.PerformanceEventTiming && 'interactionId' in window.PerformanceEventTiming.prototype) {
      var events = new window.PerformanceObserver(function (list) { onEvents(list.getEntries()); });
      events.observe({ type: 'event', buffered: true, durationThreshold: 16 });
      inpObservers.push(events);
      if (perfTypes.indexOf('first-input') > -1) {
        var first = new window.PerformanceObserver(function (list) { onEvents(list.getEntries()); });
        first.observe({ type: 'first-input', buffered: true });
        inpObservers.push(first);
      }
    }
  } catch (e) { inpObservers = []; }
  try {
    if (perfTypes.indexOf('layout-shift') > -1) {
      clsObserver = new window.PerformanceObserver(function (list) { onShifts(list.getEntries()); });
      clsObserver.observe({ type: 'layout-shift', buffered: true });
      cls = 0;
    }
  } catch (e) { clsObserver = null; cls = null; }

  var engaged = false;
  var ENGAGE = ['pointerdown', 'touchstart', 'keydown'];
  function onEngage(e) {
    // A script's own dispatched event is not a person; nor is anything while the page is hidden.
    if (engaged || (e && e.isTrusted === false) || !isVisible()) return;
    engaged = true;
    for (var i = 0; i < ENGAGE.length; i++) window.removeEventListener(ENGAGE[i], onEngage, true);
    track('site_engaged', { ms: Math.round(sinceStart()) });
  }

  var view = null;   // the page view being timed: { since, visibleMs, bottom, done }
  function screenBottom() {
    var de = document.documentElement;
    return (window.pageYOffset || (de && de.scrollTop) || 0) + (window.innerHeight || (de && de.clientHeight) || 0);
  }
  function onScroll(e) {
    if (view && !view.done) view.bottom = Math.max(view.bottom, screenBottom());
    onEngage(e);
  }
  var armed = false;
  function startView(since) {
    if (view && !view.done) return;   // this view is already being timed
    if (!armed) {
      armed = true;
      for (var i = 0; i < ENGAGE.length; i++) window.addEventListener(ENGAGE[i], onEngage, { capture: true, passive: true });
      // The page's own scroll only (it bubbles to window); a box scrolling inside the page
      // can be the page's own doing (the demo keeps a field in view), and a finger on one
      // has already touched the screen.
      window.addEventListener('scroll', onScroll, { passive: true });
    }
    view = { since: isVisible() ? since : null, visibleMs: 0, bottom: screenBottom(), done: false };
  }
  function exitView() {
    if (!view || view.done) return;
    view.done = true;
    if (view.since !== null) view.visibleMs += Math.max(0, sinceStart() - view.since);
    view.bottom = Math.max(view.bottom, screenBottom());
    // The latest LCP may not have reached the observer's callback yet.
    try { if (lcpObserver) onLcp(lcpObserver.takeRecords()); } catch (e) {}
    for (var o = 0; o < inpObservers.length; o++) { try { onEvents(inpObservers[o].takeRecords()); } catch (e) {} }
    try { if (clsObserver) onShifts(clsObserver.takeRecords()); } catch (e) {}
    var de = document.documentElement, b = document.body;
    var height = Math.max((de && de.scrollHeight) || 0, (b && b.scrollHeight) || 0);
    track('site_exit', {
      visible_ms: Math.round(view.visibleMs),
      scroll_pct: height > 0 ? Math.max(0, Math.min(100, Math.round(view.bottom / height * 100))) : 0,
      engaged: engaged,
      lcp_ms: lcpMs,
      inp_ms: inpMs(),
      cls: cls === null ? null : Math.round(cls * 10000) / 10000
    });
  }
  // A prerendered page counts from when it was shown, not from when it was made.
  function navigationStart() {
    try {
      var nav = window.performance.getEntriesByType('navigation')[0];
      return (nav && nav.activationStart) || 0;
    } catch (e) { return 0; }
  }
  function firstView() { startView(visibleAtLoad ? navigationStart() : sinceStart()); }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') exitView();
  });
  window.addEventListener('pagehide', exitView);
  window.addEventListener('pageshow', function (e) {
    // A new view: its own taps and shifts only.
    if (e && e.persisted) {
      resetInp();
      if (cls !== null) { cls = 0; burst = { sum: 0, first: 0, last: 0 }; }
      whenVisible(function () { startView(sinceStart()); });
    }
  });

  function init() { decorateAll(); whenVisible(landed); whenVisible(firstView); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // ---------- what a visitor actually sees and taps (AFMBP-2667) ----------
  // section_viewed: once per top-level <section> per page load, after it has been on screen for at
  //   least 1 s (half of the section, or half of the screen for a section taller than that) while
  //   the page is visible and the demo isn't covering it. Sent when that look ends (scrolled away,
  //   page hidden or left), with the time it lasted: { placement: the section's first class (the
  //   same rule as a trial tap's placement), visible_ms }.
  // cta_clicked: a tap on a link or button outside the demo that isn't a sign-up link (those send
  //   trial_link_clicked): { placement: nav / footer / floating / the section, from: where it goes:
  //   'page:<path>', 'anchor:<id>', 'out:<host>', 'demo', 'email', 'phone' or 'button:<id or class>' }.
  //   Never a link's text, a query string, an address, a number or anything typed.
  var SEEN_MS = 1000;
  var looks = [];   // one per top-level section: { el, name, on, since, ms, sent }
  function covered() { return !!(document.body && document.body.classList.contains('demo-lock')); }
  function lookStart(l) { if (l.on && !l.sent && l.since === null && isVisible() && !covered()) l.since = sinceStart(); }
  function lookStop(l) { if (l.since !== null) { l.ms += Math.max(0, sinceStart() - l.since); l.since = null; } }
  function lookSend(l) {
    lookStop(l);
    if (l.sent || l.ms < SEEN_MS) return;
    l.sent = true;
    track('section_viewed', { placement: l.name, visible_ms: Math.round(l.ms) });
  }
  function onSection(entries) {
    var vh = window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 0;
    for (var i = 0; i < entries.length; i++) {
      var en = entries[i], l = null;
      for (var j = 0; j < looks.length; j++) if (looks[j].el === en.target) { l = looks[j]; break; }
      if (!l || l.sent) continue;
      var h = en.boundingClientRect.height, seen = en.intersectionRect.height;
      var on = !!(en.isIntersecting && h > 0 && vh > 0 && (seen / h >= 0.5 || seen / vh >= 0.5));
      if (on === l.on) continue;
      l.on = on;
      if (on) lookStart(l); else lookSend(l);
    }
  }
  function watchSections() {
    if (looks.length || !window.IntersectionObserver) return;
    var all = document.querySelectorAll('section[class]');
    for (var i = 0; i < all.length; i++) {
      var up = all[i].parentElement;
      if ((up && up.closest && up.closest('section')) || all[i].closest('.demo-backdrop')) continue;   // top level only
      looks.push({ el: all[i], name: String(all[i].className).split(/\s+/)[0], on: false, since: null, ms: 0, sent: false });
    }
    if (!looks.length) return;
    var steps = [];
    for (var s = 0; s <= 20; s++) steps.push(s / 20);
    var io = new window.IntersectionObserver(onSection, { threshold: steps });
    for (var k = 0; k < looks.length; k++) io.observe(looks[k].el);
    // While the demo covers the page, the time is the demo's, not the sections'.
    if (window.MutationObserver && document.body) {
      new window.MutationObserver(function () {
        for (var m = 0; m < looks.length; m++) { if (covered()) lookStop(looks[m]); else lookStart(looks[m]); }
      }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
  }
  document.addEventListener('visibilitychange', function () {
    for (var i = 0; i < looks.length; i++) { if (document.visibilityState === 'hidden') lookSend(looks[i]); else lookStart(looks[i]); }
  });
  window.addEventListener('pagehide', function () { for (var i = 0; i < looks.length; i++) lookSend(looks[i]); });
  function ctaTarget(el, href) {
    if (el.hasAttribute('data-demo-open')) return 'demo';
    if (!href) return 'button:' + (el.id || String(el.className || '').split(/\s+/)[0] || 'button');
    if (href.charAt(0) === '#') return 'anchor:' + (href.slice(1) || 'top');
    try {
      var u = new URL(href, window.location.href);
      if (u.protocol === 'mailto:') return 'email';
      if (u.protocol === 'tel:') return 'phone';
      if (u.origin !== window.location.origin) return 'out:' + u.hostname;
      if (u.pathname === window.location.pathname && u.hash) return 'anchor:' + u.hash.slice(1);
      return 'page:' + u.pathname;
    } catch (e) { return 'link'; }
  }
  document.addEventListener('click', function (e) {
    if (!e || e.isTrusted === false || !isVisible()) return;
    var t = e.target && e.target.closest ? e.target.closest('a[href], button, [data-demo-open]') : null;
    if (!t || t.closest('.demo-backdrop')) return;   // inside the demo, demo.js logs its own steps
    var href = t.getAttribute('href');
    if (href && isSignup(href)) return;             // sign-up links send trial_link_clicked
    // The footer's menu is a <nav> too: name it the footer before placement()'s nav rule does.
    track('cta_clicked', { placement: t.closest('footer') ? 'footer' : placement(t), from: ctaTarget(t, href) });
  }, true);
  function sectionsInit() { whenVisible(watchSections); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sectionsInit);
  else sectionsInit();

  window.boltAttr = {
    track: track, visitorId: visitorId, touch: getTouch, decorate: decorate, whenVisible: whenVisible, isQa: isQa, isAutomated: isAutomated,
    // AFMBP-2612: the landing A/B's exposure (called by the /start/ pages) and the arm links carry.
    xpExpose: xpExpose, xp: xpContext,
    // AFMBP-2565: this page's browser, and the rule itself (tools/engagement-exit-check.mjs
    // holds it to bolt-web's own user-agent table).
    browser: BROWSER,
    browserClassOf: function (ua, maxTouchPoints) { return browserClassOf(signupBrowserOf(String(ua || ''), maxTouchPoints || 0)); }
  };
})();
