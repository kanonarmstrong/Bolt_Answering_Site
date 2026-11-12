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
     was on screen and how far down it was read (`site_exit`) (AFMBP-2565);
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
    if (!memoryVid) memoryVid = newId();
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
  //   site_exit {visible_ms, scroll_pct, engaged, lcp_ms}: when the page is first hidden
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
    var de = document.documentElement, b = document.body;
    var height = Math.max((de && de.scrollHeight) || 0, (b && b.scrollHeight) || 0);
    track('site_exit', {
      visible_ms: Math.round(view.visibleMs),
      scroll_pct: height > 0 ? Math.max(0, Math.min(100, Math.round(view.bottom / height * 100))) : 0,
      engaged: engaged,
      lcp_ms: lcpMs
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
    if (e && e.persisted) whenVisible(function () { startView(sinceStart()); });
  });

  function init() { decorateAll(); whenVisible(landed); whenVisible(firstView); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.boltAttr = {
    track: track, visitorId: visitorId, touch: getTouch, decorate: decorate, whenVisible: whenVisible, isQa: isQa, isAutomated: isAutomated,
    // AFMBP-2565: this page's browser, and the rule itself (tools/engagement-exit-check.mjs
    // holds it to bolt-web's own user-agent table).
    browser: BROWSER,
    browserClassOf: function (ua, maxTouchPoints) { return browserClassOf(signupBrowserOf(String(ua || ''), maxTouchPoints || 0)); }
  };
})();
