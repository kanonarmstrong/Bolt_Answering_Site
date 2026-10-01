/* ============================================================
   Funnel attribution + events — AFMBP-1968 (part of AFMBP-1966)
   Loaded on every page. It:
   - keeps an anonymous visitor id and the latest ad touch (utm_* and
     any ad click id) in localStorage;
   - logs `site_landed` once per browser session;
   - hands both to the app on every signup link (?bvid=…&utm_*=…), so a
     person's demo and signup join up in Bolt's analytics;
   - exposes window.boltAttr.track() for the demo flow (demo.js).
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
      var touch = getTouch();
      if (touch) data.attr = touch;
      if (isQa()) data.qa = true;
      // JSON + keepalive (not sendBeacon: the ingest parses JSON only), so an
      // event fired just before a navigation still leaves.
      window.fetch(API + '/api/public/analytics/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          events: [{ event_type: event, session_id: visitorId(), source: 'site', event_data: data }]
        })
      }).catch(function () {});
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
      talk_link: /[?&]talk(=|&|$)/.test(window.location.search)
    });
  }

  function init() { decorateAll(); landed(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.boltAttr = { track: track, visitorId: visitorId, touch: getTouch, decorate: decorate };
})();
