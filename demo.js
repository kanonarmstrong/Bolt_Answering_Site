/* ============================================================
   Demo call flow — "Talk to your new assistant"
   Front end for AFMBP-1661. Server (AFMBP-1655/1656) is live.
   Self-contained: builds an overlay modal, wires every
   "Talk to your new assistant" button, runs the OTP -> call
   state machine against the live API.
   ============================================================ */
(function () {
  'use strict';

  var API = 'https://bolt-staging.fly.dev';
  // EXACT — DB CHECK is strict (voice IN ('Sofía','Daniel')). í = í.
  var VOICE = 'Sofía';

  // Caller ID the demo call comes from — shown on the "calling you" screen
  // (Figma 2442:1191 / 2370:8769). The BACKEND is the source of truth for which
  // number actually dials: the in-call screen renders whatever `/api/demo/call`
  // hands back as `callerId` (E.164), formatted by fmtDemoNumber() to match the
  // node. This constant is only a fallback for when the response omits it (the
  // field is not shipped today), so the screen is never blank. That wiring is
  // what lets us move to a per-region demo caller-id later with no site change.
  var DEMO_CALL_NUMBER_FALLBACK = '(925) 725-7959';

  // Format a US number (E.164 "+19257257959" or 10/11 digits) as "(925) 725-7959"
  // to match the node. Empty -> the fallback constant; anything that isn't a
  // plain US number passes through untouched so we never render a mangled string.
  function fmtDemoNumber(raw) {
    if (!raw) return DEMO_CALL_NUMBER_FALLBACK;
    var d = String(raw).replace(/\D/g, '');
    if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
    if (d.length !== 10) return String(raw);
    return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
  }

  // Disclosure — must be sent EXACTLY as rendered (server sha256's it).
  // The consent the form shows and sends: the form asks for the phone number only,
  // so it leaves out email and marketing (Figma 2657:1639, the owner's 2026-11-12
  // update, AFMBP-2596; every device since AFMBP-2600). Word for word as the node
  // sets it (its straight apostrophe in "Answering's" too), built from one source so
  // render == send by construction. Changing it changes the consent hash stored with
  // every new lead, by design. STOP/HELP stay for OTP/TCPA compliance.
  var CONSENT_LINK = 'Privacy Policy';
  var CONSENT_B = ', we will not share mobile information with third parties for promotional or marketing purposes.';
  var CONSENT_A = 'By providing your phone number and tapping “Continue”, you agree to (1) receive text ' +
    'messages from Bolt Answering for (a) security verification and (2) automated phone calls from ' +
    'Bolt Answering\'s virtual assistant at the number provided. Message frequency may vary. Standard ' +
    'Message, Voice, and Data Rates may apply. Reply STOP to opt out. Reply HELP for help. In accordance with our ';
  var CONSENT_TEXT = CONSENT_A + CONSENT_LINK + CONSENT_B;
  // With no business field, the call answers as the demo line does (EZ's
  // DEMO_INBOUND_BUSINESS_NAME default): the server needs a business name to place
  // a call until AFMBP-2598 ships (demo token: "businessName required").
  var PHONE_BUSINESS = 'Bolt Services';

  // Trade is derived from the page (homepage -> general_contracting per owner decision).
  var TRADE = (function () {
    var p = location.pathname.toLowerCase();
    if (p.indexOf('plumbing') > -1) return 'plumbing';
    if (p.indexOf('electrical') > -1) return 'electrical';
    if (p.indexOf('hvac') > -1) return 'hvac';
    if (p.indexOf('handyman') > -1) return 'handyman';
    if (p.indexOf('general-contractor') > -1) return 'general_contracting';
    return 'general_contracting';
  })();

  var state = { phone: '', display: '', name: '', business: '', email: '' };
  var resendTimer = null;

  // ---------- funnel events (AFMBP-1968) ----------
  // Every stage goes to Bolt's own analytics through attribution.js (loaded on
  // every page). Only the stage, the trade and what the API said went wrong —
  // never the phone, email or business typed above.
  var step = '';       // the screen showing now, for demo_closed
  var finishedFor = null;
  function track(event, props) {
    try {
      if (!window.boltAttr) return;
      var p = { trade: TRADE };
      if (props) Object.keys(props).forEach(function (k) { p[k] = props[k]; });
      return window.boltAttr.track(event, p);
    } catch (e) {}
  }
  // Read a first-party cookie set on this site (Meta's _fbp / _fbc), or null.
  function cookie(name) {
    try {
      var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) { return null; }
  }
  // Ids for Meta's Conversions API (AFMBP-2021), only when the pixel is allowed
  // to run in this browser (meta-pixel.js decides: GPC, opt-out, QA, automation);
  // null otherwise. event_id is shared by the browser's Lead and the server's
  // copy, so Meta counts the lead once; _fbp / _fbc let Meta match the server
  // copy to the ad.
  function metaIds() {
    var m = window.boltMeta;
    if (!m || !m.enabled) return null;
    var ids = { event_id: m.newEventId() };
    var fbp = cookie('_fbp'), fbc = cookie('_fbc');
    if (fbp) ids.fbp = fbp;
    if (fbc) ids.fbc = fbc;
    return ids;
  }
  // /api/demo/otp/verify body: the phone and code, the visitor id (AFMBP-2020:
  // a later signup with the same phone carries this visit's ad), and `meta`
  // when the pixel is allowed. The server ignores what it doesn't use.
  function verifyBody(c, meta) {
    var b = { phone: state.phone, code: c };
    try { if (window.boltAttr && window.boltAttr.visitorId) b.sessionId = window.boltAttr.visitorId(); } catch (e) {}
    if (meta) b.meta = meta;
    return b;
  }
  function reasonOf(r) { return (r && (r.error || (r.status ? 'http_' + r.status : 'network'))) || 'unknown'; }

  // ---------- tiny DOM helpers ----------
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'html') el.innerHTML = attrs[k];
      else if (k === 'text') el.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else if (attrs[k] != null) el.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function svg(paths, vb) {
    var s = '<svg viewBox="' + (vb || '0 0 24 24') + '" fill="none" xmlns="http://www.w3.org/2000/svg">' + paths + '</svg>';
    var wrap = document.createElement('span'); wrap.innerHTML = s; return wrap.firstChild;
  }

  // ---------- phone/validation helpers ----------
  // Canonical layer lives in demo-format.js (also unit-tested); alias it here.
  var DF = (typeof window !== 'undefined' && window.DemoFormat) || {};
  var digits = DF.digits, e164 = DF.e164, fmtPhone = DF.fmtPhone;

  // ---------- API ----------
  function apiPost(path, body) {
    return fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        return { status: r.status, ok: r.ok, error: data.error, message: data.message, data: data };
      });
    }).catch(function () {
      return { status: 0, ok: false, error: 'network', message: 'Network error' };
    });
  }

  // ---------- modal shell ----------
  var body, backdrop, card, confetti = null;
  var recapConfettiDone = false;
  function isMobile() { return window.matchMedia('(max-width:768px)').matches; }
  function mk(t) { return h('span', { class: 'demo-mk', text: t }); }
  // Transcript meta icon ('assistant' | 'caller'): the success node's own icons
  // (Figma 2441:811) at every width since AFMBP-2600 (one responsive demo).
  function chatIcon(who) {
    return h('picture', { class: 'demo-chatmeta__pic' }, [
      h('img', { class: 'demo-chatmeta__icon', src: 'assets/demo-m-chat-' + who + '.svg', alt: '' })
    ]);
  }
  // Confetti webp behind the card — MOBILE ONLY, plays on load of the in-call +
  // recap screens (Figma mobile nodes 2442:1191 / 2441:811).
  // Confetti reverted (owner) — backdrop is the plain shaded overlay. Stubs kept
  // as no-ops so existing call sites stay valid.
  function playConfetti() {}
  function stopConfetti() {}
  function build() {
    body = h('div', { class: 'demo-body' });
    var close = h('button', { class: 'demo-close', 'aria-label': 'Close', onClick: closeModal }, [
      svg('<path d="M4 4l16 16M20 4L4 20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>')
    ]);
    var logo = h('img', { class: 'demo-logo', src: 'assets/logo-wordmark.png', alt: 'Bolt' });
    // tabindex -1: the dialog itself can take focus (as it opens), but Tab never stops on it.
    card = h('div', { class: 'demo-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Talk to your new assistant', tabindex: '-1' }, [close, logo, body]);
    backdrop = h('div', { class: 'demo-backdrop', onClick: function (e) { if (e.target === backdrop) closeModal(e); } }, [card]);
    document.body.appendChild(backdrop);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && backdrop.classList.contains('open')) closeModal(e); });
    document.addEventListener('keydown', keepTab, true);
    document.addEventListener('focusin', keepFocus, true);
  }
  // Warm the cards' art (the close, the dot, the review's bubble and stars, the
  // success brush, the OS lockups, the chat icons) when the modal opens, so every
  // later screen paints complete instead of popping the art in on a slow
  // connection (AFMBP-2150). Every width since AFMBP-2600: one responsive demo.
  var MOBILE_ART = ['demo-m-close.svg', 'demo-m-dot.svg', 'demo-m-bubble.svg', 'demo-m-stars4.svg',
    'demo-m-star5.svg', 'demo-m-ul-success.svg', 'demo-m-star-lg.svg', 'demo-m-chat-assistant.svg',
    'demo-m-chat-caller.svg', 'demo-m-lockup-iphone.svg', 'demo-m-lockup-android.svg'];
  var artWarmed = false;
  function warmMobileArt() {
    if (artWarmed) return;
    artWarmed = true;
    MOBILE_ART.forEach(function (n) { var i = new Image(); i.src = 'assets/' + n; });
  }
  // AFMBP-2564 — warm the app's sign-up page while the sign-up offer is up, so its one button
  // opens a page whose code is already in the browser. The app publishes the files that page
  // needs first at /signup-preload.json, readable from any site: {"files": ["/assets/….js",
  // "/assets/….css"]}. The offer asks for it once per page and has the browser prefetch each
  // file (lowest priority, once the page itself has finished loading, so nothing of this page
  // waits on it). Each page's <head> also opens the connection early (preconnect). Silent by
  // design: no file yet, offline, blocked, not JSON, or a file on another site adds nothing,
  // and nothing waits on it. QA visits warm it too; nothing goes to analytics.
  // The prefetch is a plain one, without crossorigin: the app's files carry no
  // Access-Control-Allow-Origin, and a crossorigin prefetch of them is refused by CORS, so the
  // sign-up page downloads them a second time. Plain, Chrome keeps them for the sign-up page's
  // own `crossorigin` loads with or without that header (headless Chrome 157, two same-site
  // origins, 2026-11-12: JS and CSS each fetched once).
  var APP_ORIGIN = 'https://app.boltanswering.com';
  var appWarmed = false;
  function prefetchAppFiles(files) {
    var have = {}, links = document.querySelectorAll('link[rel="prefetch"]');
    for (var i = 0; i < links.length; i++) have[links[i].href] = true;
    // A sign-up page needs a few files; a list far longer than that is a mistake, not a plan.
    for (var j = 0; j < files.length && j < 20; j++) {
      var p = files[j], u;
      if (typeof p !== 'string' || p.charAt(0) !== '/') continue;
      try { u = new URL(p, APP_ORIGIN); } catch (e) { continue; }
      if (u.origin !== APP_ORIGIN || have[u.href]) continue;   // "//host/…" or "/\host/…" leave the app
      have[u.href] = true;
      var l = document.createElement('link');
      l.rel = 'prefetch';
      l.href = u.href;
      document.head.appendChild(l);
    }
  }
  function warmApp() {
    if (appWarmed) return;
    appWarmed = true;
    try {
      window.fetch(APP_ORIGIN + '/signup-preload.json', { mode: 'cors', credentials: 'omit', priority: 'low' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          var files = d && Array.isArray(d.files) ? d.files : [];
          if (!files.length) return;
          var go = function () { try { prefetchAppFiles(files); } catch (e) {} };
          if (document.readyState === 'complete') go();
          else window.addEventListener('load', go);
        })
        .catch(function () {});
    } catch (e) {}
  }
  // The modal opens on the choice between the two demos (AFMBP-2083); `entry`
  // 'form' skips it for the "We'll call you" form (/?talk=form). A call this tab
  // started on the demo line takes precedence: the page follows it instead.
  // `from`: the button that opened it, which gets focus back when the demo is closed
  // from the keyboard.
  function openModal(trigger, entry, from) {
    warmMobileArt();
    if (!backdrop) build();
    if (!isOpen()) opener = from || document.activeElement;
    stopConfetti();
    recapConfettiDone = false;
    var s = resumableInbound();
    if (s) resumeInbound(s);
    else if (entry === 'form') renderPhone();
    else if (entry === 'signup') renderSignupOffer();
    else renderChoice();
    backdrop.classList.add('open');
    document.body.classList.add('demo-lock');
    // Keyboard focus moves into the dialog. A screen with a field (the form, the
    // code) moves it on to that field a moment later.
    focusDialog();
    // A reload in the middle of a demo-line call is not a new open.
    // The sign-up offer is not a demo: its own event keeps the demo funnel clean.
    if (trigger !== 'resume') track(entry === 'signup' && !s ? 'signup_offer_opened' : 'demo_opened', { trigger: trigger || 'button' });
    if (entry === 'signup' && !s) warmApp();
  }
  function closeModal(e) {
    if (backdrop && backdrop.classList.contains('open')) track('demo_closed', { step: step });
    clearResend();
    reportClosedWhileFollowing();   // before stopRecap() forgets the call
    stopRecap();
    stopInbound();
    if (inbound) { inbound.open = false; inboundSave(); }
    stopConfetti();
    backdrop.classList.remove('open');
    document.body.classList.remove('demo-lock');
    returnFocus(!!e && (e.type === 'keydown' || e.detail === 0));
  }
  function isOpen() { return !!backdrop && backdrop.classList.contains('open'); }

  // ---------- keyboard focus (AFMBP-2097) ----------
  // The dialog is modal: it takes keyboard focus as it opens, Tab and Shift+Tab stay
  // inside it while it is open, and closing it from the keyboard gives focus back to
  // the button that opened it.
  // Focus goes to the dialog itself, not to the first way in ("You call us" on a
  // phone, "Call now" on a computer): iOS Safari draws a focus ring on whatever a
  // script focuses as the page loads (an ad link opens the demo then), and the
  // dialog has no ring of its own (demo.css).
  var opener = null;   // what had focus when the demo opened
  var tabDir = 0;      // the Tab press the browser is carrying out: 1, or -1 for Shift+Tab
  function focusDialog() { try { card.focus({ preventScroll: true }); } catch (e) {} }
  // Closed from the keyboard (Escape, or Enter / Space on ×, whose click has detail 0):
  // focus goes back to the button that opened the demo. After a tap or a click no
  // focus is moved: iOS Safari rings a button a script focuses after a tap on the
  // shade (seen in the simulator).
  function returnFocus(fromKeys) {
    var el = opener;
    opener = null;
    if (fromKeys && el && el !== document.body && el.isConnected && el.focus) {
      try { el.focus({ preventScroll: true }); } catch (e) {}
    }
  }
  // Where Tab stops in the dialog now, in page order: the links, buttons and fields
  // that are showing and enabled, and the transcript while it scrolls (Chrome stops
  // there, so the keyboard can scroll it).
  function tabStops() {
    return Array.prototype.filter.call(card.querySelectorAll('a[href],button,input,select,textarea,[tabindex],.demo-chat'), function (el) {
      var stop = el.classList.contains('demo-chat') ? el.scrollHeight > el.clientHeight : el.tabIndex >= 0 && !el.disabled;
      return stop && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    });
  }
  // Focus stop i, or the next one on in the same direction that takes focus (a browser
  // may not focus the transcript); the dialog itself if none does.
  function focusStop(f, i, dir) {
    for (var n = 0; n < f.length; n++, i = (i + dir + f.length) % f.length) {
      f[i].focus();
      if (document.activeElement === f[i]) return;
    }
    focusDialog();
  }
  // Tab from the last stop goes round to the first, and Shift+Tab from the first to
  // the last. From the dialog itself, or with focus outside it (a screen change drops
  // focus), Tab goes to the first stop and Shift+Tab to the last. Anywhere else the
  // browser moves focus as usual.
  function keepTab(e) {
    if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || !isOpen()) return;
    var dir = e.shiftKey ? -1 : 1, f = tabStops(), a = document.activeElement, end = f.length - 1;
    if (!f.length) { e.preventDefault(); focusDialog(); return; }   // nothing to stop on (phone: calling you)
    if (a === card || !card.contains(a) || f.indexOf(a) === (dir > 0 ? end : 0)) {
      e.preventDefault();
      focusStop(f, dir > 0 ? 0 : end, dir);
      return;
    }
    tabDir = dir;
    setTimeout(function () { tabDir = 0; }, 0);
  }
  // Focus that lands behind the dialog while it is open (a browser whose Tab skips
  // some stops, a phone keyboard's previous / next buttons, a script) comes back:
  // to the end a Shift+Tab was heading for, else the first stop.
  function keepFocus(e) {
    if (!isOpen() || card.contains(e.target)) return;
    var f = tabStops();
    if (!f.length) focusDialog();
    else if (tabDir < 0) focusStop(f, f.length - 1, -1);
    else focusStop(f, 0, 1);
  }
  // `screen` tags the backdrop (data-screen) so CSS can apply the pixel-matched
  // mobile layouts (Figma 2657:1639 / 2442:1191 / 2441:811 / 2511:1027) to just
  // those screens; every other screen renders with the attribute empty.
  function setBody(nodes, screen) {
    body.innerHTML = '';
    nodes.forEach(function (n) { if (n) body.appendChild(n); });
    if (backdrop) backdrop.setAttribute('data-screen', screen || '');
    fitCard();
  }
  // AFMBP-2600 — on a computer the card is the phone card, bigger (owner, 2026-11-13:
  // "bigger on desktop"): up to 125% of its design size, as far as the screen's height
  // allows with the shade's 16px above and below, and never smaller than its design
  // size. CSS scales the node screens' card by it (--demo-zoom, a transform) on screens
  // wider than 768px.
  function fitCard() {
    if (!backdrop) return;
    var z = 1;
    if (!isMobile()) {
      var hDesign = parseFloat(getComputedStyle(backdrop).getPropertyValue('--demo-h'));
      if (hDesign > 0) z = Math.max(1, Math.min(1.25, (window.innerHeight - 32) / hDesign));
    }
    backdrop.style.setProperty('--demo-zoom', String(Math.round(z * 1000) / 1000));
  }
  window.addEventListener('resize', fitCard);
  function heading(t) { return h('h2', { class: 'demo-h', text: t }); }
  function sub(t) { return h('p', { class: 'demo-sub', text: t }); }
  // Assistant mascot icon (Figma 2434:586 / 2434:631) — two stacked SVG layers.
  function assistIcon() {
    return h('span', { class: 'demo-assist' }, [
      h('img', { class: 'demo-assist__g', src: 'assets/demo-assist-group.svg', alt: '' }),
      h('img', { class: 'demo-assist__l', src: 'assets/demo-assist-layer.svg', alt: '' })
    ]);
  }
  // Heading with the mascot icon to its right (phone entry 2387:9076).
  function headingIcon(t) {
    return h('div', { class: 'demo-h demo-h--icon' }, [
      h('span', { class: 'demo-h__txt', text: t }),
      assistIcon()
    ]);
  }
  function helpLine() {
    return h('p', { class: 'demo-help' }, [
      'Need help? ',
      h('a', { href: 'mailto:support@boltanswering.com' }, ['Contact support.'])
    ]);
  }
  function busy(btn, label) { btn.disabled = true; btn.innerHTML = ''; btn.appendChild(h('span', { class: 'demo-spinner' })); btn.appendChild(document.createTextNode(label)); }
  function unbusy(btn, label) { btn.disabled = false; btn.textContent = label; }

  // ---------- one responsive demo (AFMBP-2600) ----------
  // Every screen is the phone node's card at every width (owner, 2026-11-13:
  // "make the demo experience responsive so we only change it in one place").
  // A computer shows the same card, scaled up as far as its screen's height
  // allows (fitCard). Only behaviour differs by device: a phone's keyboard (Done
  // closes it; the field is kept in view), a computer's Enter (submits), and the
  // You call us number (a tap-to-dial link where a dialer exists).

  // ---------- screen: two ways to try it — Figma 2670:952 ----------
  // "You call us" = the visitor calls Bolt's demo line (AFMBP-2083); "We call
  // you" = the outbound demo. No consent line here (owner): calling us sends
  // nothing to the visitor's phone, and the form keeps its own disclosure.
  function callLabel() { return [h('span', { text: 'You call us' })]; }
  function renderChoice() {
    clearResend();
    stopRecap();
    stopInbound();
    inboundFlow = null;
    step = 'choice';
    // A real link from the first paint: iOS hands a tel: link to the dialer only
    // from the tap itself, so the code is fetched now, before anyone taps.
    var call = h('a', { class: 'demo-btn demo-choice__btn demo-choice__call', href: '#' }, callLabel());
    var get = h('button', { class: 'demo-btn demo-choice__btn demo-choice__get', type: 'button' }, [h('span', { text: 'We call you' })]);
    var waiting = false;
    call.addEventListener('click', function (e) {
      var s = inboundUsable(inbound) ? inbound : null;
      var auto = !!s && canDial();
      if (!auto) e.preventDefault();
      if (waiting) return;
      track('demo_mode_selected', { mode: 'inbound', dial: auto ? 'auto' : 'manual' });
      if (s) {
        if (auto) track('demo_inbound_call_tapped', { mode: 'inbound', from: 'choice' });
        // Swap screens after the browser has acted on the tap, with the link
        // still in the page.
        setTimeout(function () { startInbound(s, !auto); }, 0);
        return;
      }
      // No code yet (slow network, or it failed): get one, then show it with
      // the number to call.
      waiting = true;
      call.innerHTML = '';
      call.appendChild(h('span', { class: 'demo-spinner' }));
      callLabel().forEach(function (n) { call.appendChild(n); });
      ensureInbound().then(function (s2) {
        waiting = false;
        if (!isOpen() || step !== 'choice') return;
        if (!s2) return renderInboundFailed('session');
        startInbound(s2, true);
      });
    });
    get.addEventListener('click', function () {
      track('demo_mode_selected', { mode: 'outbound' });
      renderPhone();
    });
    setBody([
      // "Available now" (its dot is drawn and hidden from screen readers; the words
      // say it), then the question.
      h('div', { class: 'demo-cm' }, [
        h('p', { class: 'demo-cm__live', text: 'Available now' }),
        h('h2', { class: 'demo-cm__h', text: 'How would you like to start the call?' })
      ]),
      h('div', { class: 'demo-choice__btns' }, [
        call,
        // The wait under "You call us".
        h('p', { class: 'demo-choice__when' }, ['Avg. wait time: ', h('b', { text: '3 seconds' })]),
        get
      ]),
      // The review in its bubble (2670:952 as updated 2026-11-13, AFMBP-2597), under
      // the two ways in. The stars are drawn and hidden from screen readers; "4.9/5"
      // says it.
      h('div', { class: 'demo-cr' }, [
        h('p', { class: 'demo-cr__who' }, [h('b', { text: 'Gus C.' }), ' ', h('span', { text: 'Massachusetts' })]),
        h('span', { class: 'demo-cr__stars', 'aria-hidden': 'true' }),
        h('p', { class: 'demo-cm__score', text: '4.9/5' }),
        h('p', { class: 'demo-cm__quote', text: '“Sounds like a real receptionist!”' })
      ]),
      helpLine()
    ], 'choice');
    ensureInbound().then(function (s) { if (s) call.setAttribute('href', s.telUri); });
  }
  // AFMBP-2273 — the sign-up offer (Figma 2718:3312; the "New jobs are calling"
  // design of 2026-11-02, AFMBP-2495): the card's art (paper, with the headline
  // drawn in it), the close, the pitch with the bolt wordmark set into its first
  // line, the boxed "It's FREE" line, one blue "Start your free trial" into the sign-up flow,
  // and the rating with a testimonial in a speech bubble, tilted (no help line).
  // The same card at every width (no desktop node yet). attribution.js decorates
  // the link as it is tapped (visitor id, ad tags, QA flag); a tap inside the
  // dialog is logged here, as the demo's own trial links are.
  function renderSignupOffer() {
    clearResend();
    stopRecap();
    stopInbound();
    inboundFlow = null;
    step = 'signup_offer';
    // AFMBP-2344: the tap's event must leave before the page does. When the next page starts
    // loading at once, some browsers drop it (live: 3 of 6 sign-up arrivals since 10-17 had no
    // logged tap). So the button holds the page until the event has gone out, at most 0.3 s,
    // then follows its link, which attribution.js decorated in the capture phase. A new tab or
    // window keeps the browser's own behaviour: this page stays.
    var cta = h('a', { class: 'demo-btn demo-so__cta', href: 'https://app.boltanswering.com/signup', onClick: function (e) {
      var sent = track('trial_link_clicked', { placement: 'signup_offer' });
      if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      var href = e.currentTarget.href, gone = false;
      var go = function () { if (!gone) { gone = true; window.location.href = href; } };
      setTimeout(go, 300);
      if (sent && sent.then) sent.then(go, go);
    } }, ['Start your free trial']);
    setBody([
      h('div', { class: 'demo-cm' }, [
        // The headline is drawn in the card's art; this is its text, for screen readers.
        h('h2', { class: 'demo-cm__h', text: 'New jobs are calling' }),
        // The wordmark stands in for "Bolt": drawn in the room the node leaves for it at the
        // start of the line, and read out as the word.
        h('p', { class: 'demo-cm__sub' }, [
          h('span', { class: 'demo-so__bolt' }, [h('span', { class: 'demo-so__vh', text: 'Bolt ' })]),
          'is your 24/7 receptionist that ',
          h('span', { class: 'demo-so__big', text: 'answers calls and books customers so you never miss a job again.' })
        ]),
        h('p', { class: 'demo-so__free' }, ['It’s ', h('b', { text: 'FREE ' }), 'to set up an assistant. Get started ', h('b', { text: 'today.' })])
      ]),
      cta,
      // The bubble and stars are drawn and hidden from screen readers; "4.9/5" says it.
      h('div', { class: 'demo-cr' }, [
        h('span', { class: 'demo-so__bubble', 'aria-hidden': 'true' }),
        h('p', { class: 'demo-so__who' }, [h('b', { text: 'Brent B. ' }), 'Indiana']),
        h('span', { class: 'demo-cm__stars', 'aria-hidden': 'true' }, [h('span'), h('span'), h('span'), h('span'), h('span')]),
        h('p', { class: 'demo-cm__score', text: '4.9/5' }),
        h('p', { class: 'demo-cm__quote', text: '“I was losing jobs to voicemail and even paid $250 a week for someone to answer my phone. Bolt booked a job and paid for itself in a day.”' })
      ])
    ], 'signup');
  }

  // ---------- "You call us" — the demo line (AFMBP-2083) ----------
  // POST /api/demo/inbound/session gives this browser a one-time 4-digit code
  // (10 minutes, single use) and the line's tel: link, which dials, pauses, then
  // sends the code as keypad tones (tel:+18554973151,,1234; no trailing #, which
  // Verizon breaks on). The line links the call to whichever session owns the
  // code, so the page follows THAT call (GET /api/demo/inbound/session/:id) and
  // never "the latest call". Once linked, it hands the call id to the recap the
  // outbound demo uses. The code is also on screen, for a phone that does not
  // send it: the line asks for it.
  var INBOUND_KEY = 'bolt_demo_inbound';
  var inbound = null;      // this tab's session: {sessionId, code, telUri, numberDisplay, expiresAt (ms), tappedAt, open, callId}
  var inboundReq = null;   // the create request in flight
  var inboundTimer = null;
  var inboundFlow = null;  // the call the card follows: {session, manual, hidden, back, callId}

  // Kept in sessionStorage so a phone that unloads the tab while the visitor is
  // on the call can pick the same call back up when they return.
  function inboundLoad() {
    try {
      var s = JSON.parse(window.sessionStorage.getItem(INBOUND_KEY) || 'null');
      return s && s.sessionId && s.code && s.telUri ? s : null;
    } catch (e) { return null; }
  }
  function inboundSave() {
    try {
      if (inbound) window.sessionStorage.setItem(INBOUND_KEY, JSON.stringify(inbound));
      else window.sessionStorage.removeItem(INBOUND_KEY);
    } catch (e) {}
  }
  // A code is offered for a new call only with time left to dial and type it,
  // and only on a page of the trade it was fetched for: the line runs the call
  // with the code's trade (AFMBP-2096), so another trade page gets its own code.
  // A call already started still resumes on any page (resumableInbound).
  function inboundUsable(s) { return !!s && s.trade === TRADE && s.expiresAt - Date.now() > 120000; }
  // A call this tab started that has not reached its recap or failure screen.
  function resumableInbound() {
    if (!inbound) inbound = inboundLoad();
    var s = inbound;
    return s && s.tappedAt && Date.now() - s.tappedAt < 30 * 60000 ? s : null;
  }
  // The flow reached its end (recap, failure, limit): the next "Call now" gets
  // a new code, and reopening the demo starts over.
  function inboundFinish() {
    inbound = null;
    inboundFlow = null;
    inboundSave();
  }
  function ensureInbound() {
    if (inboundUsable(inbound)) return Promise.resolve(inbound);
    if (inboundReq) return inboundReq;
    // The visitor id lets reporting tie the call to this visit (and its ad)
    // even if the page never sees the call end (AFMBP-2109), as the outbound
    // demo's verify body does (AFMBP-2020). A random id; nothing typed.
    var body = { trade: TRADE, voice: VOICE, locale: 'en' };
    try { if (window.boltAttr && window.boltAttr.visitorId) body.sessionId = window.boltAttr.visitorId(); } catch (e) {}
    inboundReq = apiPost('/api/demo/inbound/session', body).then(function (r) {
      inboundReq = null;
      var d = r.data || {};
      if (r.ok && d.sessionId && /^\d{4}$/.test(String(d.code)) && /^tel:/.test(String(d.telUri))) {
        inbound = {
          sessionId: String(d.sessionId), code: String(d.code), telUri: String(d.telUri), trade: TRADE,
          numberDisplay: d.numberDisplay || fmtDemoNumber(d.number),
          expiresAt: Date.parse(d.expiresAt) || Date.now() + 9 * 60000
        };
        inboundSave();
        track('demo_inbound_session_created', { mode: 'inbound' });
        return inbound;
      }
      track('demo_inbound_session_failed', { mode: 'inbound', reason: reasonOf(r) });
      return null;
    });
    return inboundReq;
  }
  // A phone hands a tel: link to its dialer. A computer with a mouse would only
  // offer FaceTime or an app picker, so there the card shows the number instead.
  function canDial() {
    try { return !window.matchMedia('(hover:hover) and (pointer:fine)').matches; } catch (e) { return true; }
  }

  // `manual`: no dialer took the tap (a computer). The card shows the number to call
  // either way (a phone's as its first step since AFMBP-2597).
  function startInbound(s, manual) {
    s.tappedAt = Date.now();
    s.open = true;
    inboundSave();
    inboundFlow = { session: s, manual: !!manual, hidden: false, back: false, callId: null };
    renderInboundCall(s);
    pollInbound(s);
  }
  // Reopened (or reloaded) while a call this tab started may be live: let the
  // server say where it is. Not connected yet -> back to the choice.
  function resumeInbound(s) {
    inbound = s;
    s.open = true;
    inboundSave();
    inboundFlow = { session: s, manual: true, hidden: false, back: true, callId: null };
    renderInboundCall(s);
    pollInbound(s, { resume: true });
  }

  // ---------- screen: You call us, call in progress — Figma 2891:1090 ----------
  // How to call, as two numbered steps, then the help line (the owner's 2026-11-13
  // update, AFMBP-2597). Where there is a dialer the number is a tap-to-dial link
  // (the link enters the code by itself; the second step covers a phone that
  // doesn't). A computer has none, so there it is plain text (AFMBP-2600).
  function renderInboundCall(s) {
    clearResend();
    step = 'inbound_call';
    var number;
    if (canDial()) {
      number = h('a', { class: 'demo-ihow__tel', href: s.telUri, text: s.numberDisplay });
      number.addEventListener('click', function () { track('demo_inbound_call_tapped', { mode: 'inbound', from: 'card' }); });
    } else {
      number = h('b', { class: 'demo-ihow__tel', text: s.numberDisplay });
    }
    setBody([
      h('div', { class: 'demo-incall' }, [
        h('div', { class: 'demo-ihow' }, [
          h('p', { class: 'demo-ihow__h', text: 'Here’s how to call your assistant:' }),
          h('ol', { class: 'demo-ihow__list' }, [
            h('li', {}, ['Dial ', number]),
            h('li', {}, ['Tap in this code: ', h('b', { class: 'demo-ihow__code', text: s.code })])
          ])
        ]),
        helpLine()
      ])
    ], 'inbound-call');
  }

  // ---------- inbound polling ----------
  // waiting -> connected (call id) -> completed, or limit / expired / failed.
  // Polls every 3s while the card is up. A phone suspends the page during the
  // call, so coming back to it checks at once (visibilitychange, below).
  // Each run of checks has a generation: stopping or restarting them drops an
  // answer still on its way. Coming back to the page could otherwise land two
  // checks at once (the timer that slept through the call, and the check on
  // return) and follow the call twice, counting the recap twice (AFMBP-2099).
  var inboundGen = 0;
  function clearInboundTimer() { if (inboundTimer) { clearTimeout(inboundTimer); inboundTimer = null; } }
  function stopInbound() { inboundGen++; clearInboundTimer(); }
  function pollInbound(s, opts) {
    opts = opts || {};
    stopInbound();
    var gen = inboundGen;
    var url = API + '/api/demo/inbound/session/' + encodeURIComponent(s.sessionId);
    var first = true;
    function again(ms) { clearInboundTimer(); inboundTimer = setTimeout(tick, ms); }
    function tick() {
      inboundTimer = null;
      fetch(url, { headers: { 'Accept': 'application/json' } })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, d: d || {} }; }); })
        .then(function (res) {
          if (gen !== inboundGen) return;   // superseded while it was out
          var f = inboundFlow;
          // Closed, or another flow took over while this request was out.
          if (!isOpen() || !f || f.session !== s || step !== 'inbound_call') return;
          var resume = opts.resume && first;
          first = false;
          var st = res.status === 404 ? 'expired' : res.d.state;
          if ((st === 'connected' || st === 'completed') && res.d.callId) return followCall(f, String(res.d.callId));
          if (st === 'waiting') {
            if (resume) return renderChoice();   // never got through: choose again, same code
            return again(3000);
          }
          if (st === 'limit') {
            inboundFinish();
            return renderLimit();
          }
          if (st === 'expired' || st === 'failed') {
            if (resume) { inboundFinish(); return renderChoice(); }
            return renderInboundFailed(st);
          }
          again(res.status === 429 ? 10000 : 5000);   // rate limited / server error: back off
        })
        .catch(function () { if (gen === inboundGen) again(5000); });
    }
    tick();
  }
  // The call reached the line with this session's code: from here it is the
  // same call record the outbound demo follows to its recap.
  function followCall(f, callId) {
    f.callId = callId;
    // Counted once per call, also across a reload that picked the call back up.
    if (f.session.callId !== callId) {
      f.session.callId = callId;
      inboundSave();
      track('demo_inbound_call_connected', { mode: 'inbound', call_id: callId });
    }
    stopInbound();
    pollRecap(callId, inboundRecapOpts());
  }
  function inboundRecapOpts() {
    return {
      mode: 'inbound',
      // The visitor sets the call's length: wait up to 20 minutes for it to end,
      // and time the transcript wait from the end of the call.
      inCallLimitMs: 20 * 60000,
      transcriptFromEnd: true,
      onSettled: inboundFinish,
      onFailed: function () { renderInboundFailed('call_failed'); }
    };
  }
  document.addEventListener('visibilitychange', function () {
    var f = inboundFlow;
    if (!f || !isOpen()) return;
    if (document.visibilityState === 'hidden') { f.hidden = true; return; }
    if (step !== 'inbound_call') return;
    f.back = true;
    // Timers may have slept through the call: check now, and restart the
    // recap wait from here.
    if (f.callId) pollRecap(f.callId, inboundRecapOpts());
    else pollInbound(f.session);
  });

  // ---------- screen: You call us didn't connect — Figma 2670:1124 ----------
  // Continue -> back to the choice, with a new code.
  function renderInboundFailed(reason) {
    stopInbound();
    stopRecap();
    clearResend();
    track('demo_inbound_failed', { mode: 'inbound', reason: reason || 'unknown' });
    inboundFinish();
    step = 'inbound_failed';
    var btn = h('button', { class: 'demo-btn demo-ifail__btn', type: 'button', text: 'Continue' });
    btn.addEventListener('click', function () { renderChoice(); });
    setBody([
      h('div', { class: 'demo-ifail' }, [
        h('p', { class: 'demo-ifail__title demo-mk', text: 'OOPs!' }),
        h('p', { class: 'demo-ifail__body', text: 'Something’s wrong on our end. Try your call again later.' }),
        btn
      ])
    ], 'inbound-fail');
  }

  // ---------- phones: keep the field being typed in above the keyboard ----------
  // The demo is a fixed overlay that scrolls on its own (.demo-backdrop). iOS
  // Safari pans the page to show a focused field but never scrolls an inner
  // scroller, so a field low on a tall card, or the error message tied to it,
  // could sit behind the keyboard. Once the keyboard has settled (on focus, and
  // whenever the visible area changes while the field has focus) the overlay
  // scrolls just enough to show the field and its message (aria-describedby).
  // The app's rule (AFMBP-2098), on the site's demo form (AFMBP-2150).
  var kvTimer = null;
  function keepVisible(el) {
    if (!backdrop || !isMobile()) return;
    clearTimeout(kvTimer);
    kvTimer = setTimeout(function () {
      if (document.activeElement !== el || !isOpen()) return;
      var vv = window.visualViewport;
      var top = vv ? vv.offsetTop : 0;
      var bottom = top + (vv ? vv.height : window.innerHeight);
      var r = el.getBoundingClientRect(), lo = r.top, hi = r.bottom;
      var id = el.getAttribute('aria-describedby'), msg = id && document.getElementById(id);
      if (msg && msg.offsetParent) { var m = msg.getBoundingClientRect(); lo = Math.min(lo, m.top); hi = Math.max(hi, m.bottom); }
      var pad = 12;
      if (hi + pad > bottom) backdrop.scrollTop += Math.max(0, Math.min(hi + pad - bottom, lo - pad - top));
      else if (lo - pad < top) backdrop.scrollTop -= top + pad - lo;
    }, 200);
  }
  if (window.visualViewport) window.visualViewport.addEventListener('resize', function () {
    var a = document.activeElement;
    if (a && a.classList && a.classList.contains('demo-input')) keepVisible(a);
  });

  // ---------- screen: phone entry ----------
  // `label` is text or a list of nodes; `required` marks the field required to
  // the browser and to assistive tech. The form has one field since AFMBP-2600.
  function field(label, id, ph, type, val, required) {
    var input = h('input', {
      class: 'demo-input', id: id, type: type || 'text', placeholder: ph, value: val || '',
      required: required ? '' : null, 'aria-required': required ? 'true' : null,
      autocomplete: id === 'demo-phone' ? 'tel' : (id === 'demo-email' ? 'email' : 'organization'),
      inputmode: id === 'demo-phone' ? 'tel' : null,
      // Phones: the keyboard's key reads "done" and closes it (see renderPhone).
      // Set before focus, as iOS reads it only when focus begins.
      enterkeyhint: isMobile() ? 'done' : null
    });
    input.addEventListener('focus', function () { keepVisible(input); });
    // demo-field--phone: the wrapper is addressable in CSS.
    var key = id.replace('demo-', '');
    return { wrap: h('div', { class: 'demo-field demo-field--' + key }, [h('label', { class: 'demo-label', for: id }, typeof label === 'string' ? [label] : label), input]), input: input };
  }
  function renderPhone(opts) {
    opts = opts || {};
    step = opts.limit ? 'limit' : 'details';
    // The number only, labelled "Phone number" (2657:1639, as updated 2026-11-12,
    // AFMBP-2596), on every device since AFMBP-2600 (owner, 2026-11-13: "phone
    // number only"). No business name and no email: the call answers as Bolt
    // Services, and no marketing email is collected.
    var phone = field('Phone number', 'demo-phone', '(555) 555-1212', 'tel', state.display, true);

    // Single form-level error message shown above the button, with the offending
    // field(s) turned red/pink (Figma error states 2548:3438/3480/3522/3561).
    var formErr = h('p', { class: 'demo-formerr', id: 'demo-formerr', role: 'alert', style: 'display:none' });
    function markErr(f) {
      f.input.classList.add('err');
      f.input.setAttribute('aria-invalid', 'true');
      f.input.setAttribute('aria-describedby', 'demo-formerr');
    }
    function hideFormErr() { formErr.style.display = 'none'; formErr.textContent = ''; }
    // The two form errors read as their nodes word them, with no full stop
    // (2894:1135 "Please complete the form to continue", 2894:1108 "Please enter a
    // valid US phone number"); any other message reads as the server sends it.
    function formMsg(msg) {
      if (/^Please complete the form/.test(msg)) return 'Please complete the form to continue';
      if (/^Invalid phone number/.test(msg)) return 'Please enter a valid US phone number';
      return msg;
    }
    function showFormErr(msg) {
      markErr(phone);
      formErr.textContent = formMsg(msg);
      formErr.style.display = 'block';
    }
    function clearFieldErr() {
      phone.input.classList.remove('err');
      phone.input.removeAttribute('aria-invalid');
      phone.input.removeAttribute('aria-describedby');
      hideFormErr();
    }

    // Live, cursor-preserving phone formatting -> "(123) 456-7890" on every input.
    // The caret is kept at the same digit boundary so mid-string edits, backspace,
    // and paste stay usable (no cursor jumping).
    phone.input.addEventListener('input', function () {
      var el = this;
      var caret = el.selectionStart == null ? el.value.length : el.selectionStart;
      var digitsBefore = digits(el.value.slice(0, caret)).length;
      var formatted = fmtPhone(el.value);
      el.value = formatted;
      var pos = 0, seen = 0;
      while (pos < formatted.length && seen < digitsBefore) { if (/\d/.test(formatted.charAt(pos))) seen++; pos++; }
      try { el.setSelectionRange(pos, pos); } catch (e) {}
      clearFieldErr();
    });

    // The rules live in demo-format.js (unit-tested): Continue greys out until
    // the phone is a whole US number (AFMBP-2150); a tap then checks it. Only the
    // number is asked, so the business is the placeholder and no email is given.
    function vals() { return { phone: phone.input.value, business: PHONE_BUSINESS, email: '' }; }
    function validateForm() { return DF.checkForm(vals()); }

    // The consent shown is the one sent (AFMBP-2596).
    var disclosure = h('p', { class: 'demo-disclosure' }, [
      CONSENT_A, h('a', { href: '/privacy/', target: '_blank', rel: 'noopener' }, [CONSENT_LINK]), CONSENT_B
    ]);
    var btn = h('button', { class: 'demo-btn', type: 'button', text: 'Continue' });
    // Grey until the form can go (Figma 2657:1639 grey / 2670:1317 blue). It
    // stays tappable: a tap on the grey button shows "Please complete the form
    // to continue." with the empty fields flagged (2676:1272), so it is
    // aria-disabled, never `disabled` (which would swallow the tap).
    function syncBtn() {
      var on = DF.formComplete(vals());
      btn.classList.toggle('demo-btn--off', !on);
      if (on) btn.removeAttribute('aria-disabled'); else btn.setAttribute('aria-disabled', 'true');
    }
    phone.input.addEventListener('input', syncBtn);
    syncBtn();

    btn.addEventListener('click', function () {
      var bad = validateForm();
      if (bad) { showFormErr(bad.msg); phone.input.focus(); return; }  // no call fires for an invalid form
      hideFormErr();

      state.display = fmtPhone(phone.input.value);
      state.phone = e164(phone.input.value);            // normalized E.164 to the API
      // The number only: the call answers as Bolt Services, no email is sent, and
      // the consent sent is the one the form showed (AFMBP-2596 / AFMBP-2600).
      state.business = PHONE_BUSINESS;
      state.email = '';
      state.consent = CONSENT_TEXT;

      busy(btn, 'Sending…');
      // has_email: whether an address was given, never the address itself.
      track('demo_details_submitted', { has_email: !!state.email });
      apiPost('/api/demo/otp/send', otpBody()).then(function (r) {
        if (r.ok) { track('demo_code_sent'); return renderCode(); }
        track('demo_code_send_failed', { reason: reasonOf(r) });
        unbusy(btn, 'Continue');
        if (r.error === 'invalid_phone') showFormErr(r.message || 'Invalid phone number. Please try again.');
        else if (r.error === 'demo_limit_reached') renderLimit();
        else if (r.error === 'rate_limited') showFormErr(waitMsg(r));
        else renderError();
      });
    });

    // Enter in the field: on a phone it only finishes typing (the keyboard's
    // "done" closes it; Continue sends), the app's rule (AFMBP-2098 / 2150). A
    // computer's keyboard keeps Enter = Continue.
    phone.input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      if (isMobile()) phone.input.blur(); else btn.click();
    });

    var limitMsg = opts.limit ? h('p', { class: 'demo-limitmsg' }, [
      'You’ve reached your demo limit. ',
      h('a', { class: 'demo-limitmsg__link', href: 'https://app.boltanswering.com/signup', onClick: function () { track('demo_trial_clicked', { from: 'limit' }); } }, ['Start a free trial today'])
    ]) : null;

    setBody([
      // The question and the sub (2657:1639, as updated 2026-11-12, AFMBP-2596).
      h('h2', { class: 'demo-h demo-h--form', text: 'What number would you like the assistant to call?' }),
      h('p', { class: 'demo-sub', text: 'We’ll send a one-time passcode before we make the call.' }),
      phone.wrap,
      limitMsg,
      formErr,
      btn, h('div', { class: 'demo-disclosure-wrap' }, [disclosure]), helpLine()
    ], 'phone');
    setTimeout(function () { phone.input.focus(); }, 30);
  }

  // /api/demo/otp/send body, for the first send and every resend. No email ->
  // no email key (the server then just skips the marketing-lead write). The
  // consent is the one the form showed when Continue was tapped (AFMBP-2596).
  function otpBody() {
    return DF.otpSendBody({ phone: state.phone, business: state.business, email: state.email }, state.consent || CONSENT_TEXT);
  }

  function waitMsg(r) {
    var s = r.data && (r.data.retryAfter || r.data.seconds || r.data.retry_after);
    return 'Please wait ' + (s ? s + ' seconds' : 'a moment') + ' and try again.';
  }

  // ---------- screen: code entry ----------
  // 2670:1394 and its error states (2895:1339 wrong code, 2895:1370 expired, 2895:1401
  // system error; the owner's 2026-11-12 update, AFMBP-2596), on every device since
  // AFMBP-2600: "Enter the code", the six boxes and Back. An error is one line over the
  // boxes, ending in a link that sends a new code where the node draws one. No Continue (the
  // sixth digit checks the code) and no resend line: the links and Back are the ways to a
  // new code. opts.kind names the line: 'incorrect' | 'expired' | 'locked' | 'system' |
  // 'wait' (opts.waitSecs: the server's wait, when it gave one); opts.locked keeps the
  // boxes shut.
  function renderCode(opts) {
    opts = opts || {};
    step = 'code';
    var boxes = [];
    var codeWrap = h('div', { class: 'demo-code' + (opts.kind ? ' demo-code--err' : '') });
    for (var i = 0; i < 6; i++) {
      // Every box carries autocomplete="one-time-code" (not just the first) so
      // iOS QuickType and Android SMS autofill offer/distribute the code no
      // matter which box has focus; the input/paste handlers below spread a
      // full code that lands in any single box across all six.
      var inp = h('input', { type: 'text', inputmode: 'numeric', maxlength: '6', autocomplete: 'one-time-code', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Digit ' + (i + 1) });
      if (opts.locked) inp.disabled = true;
      boxes.push(inp); codeWrap.appendChild(inp);
    }
    function code() { return boxes.map(function (b) { return b.value; }).join(''); }
    function focusFirstEmpty() { for (var j = 0; j < 6; j++) { if (!boxes[j].value) { boxes[j].focus(); return; } } boxes[5].focus(); }

    boxes.forEach(function (b, idx) {
      b.addEventListener('input', function () {
        var d = this.value.replace(/\D/g, '');
        if (d.length > 1) {
          // A paste or OS one-time-code autofill dumped several digits into one
          // box (mobile Safari/Chrome routinely bypass the `paste` event, and a
          // maxlength of 1 would otherwise truncate it). Spread the digits across
          // the boxes from the start instead of dropping all but the first.
          for (var k = 0; k < 6; k++) boxes[k].value = d[k] || '';
          if (d.length >= 6) { submit(); } else { focusFirstEmpty(); }
          return;
        }
        this.value = d.slice(0, 1);
        if (this.value && idx < 5) boxes[idx + 1].focus();
        if (code().length === 6) submit();
      });
      b.addEventListener('keydown', function (e) {
        if (e.key === 'Backspace' && !this.value && idx > 0) { boxes[idx - 1].focus(); boxes[idx - 1].value = ''; e.preventDefault(); }
        if (e.key === 'Enter') submit();
      });
      b.addEventListener('paste', function (e) {
        e.preventDefault();
        var d = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
        for (var k = 0; k < 6; k++) boxes[k].value = d[k] || '';
        if (d.length === 6) submit(); else focusFirstEmpty();
      });
    });

    // AFMBP-2575 — one code check at a time, and none once the code is accepted. A phone can
    // fire two of the ways in above for one code: on 2026-11-12 an iPhone's code autofill
    // checked the same code twice, 36 ms apart. The first check passed and the call went out;
    // the second found the code spent and put "That code has expired" over the Calling card.
    // `checking` stays set after a pass: this screen's work is done.
    var checking = false;
    // Whether this screen still stands: the dialog is open and no other screen has taken its
    // place. An answer that comes back after that is dropped, not drawn over what is there now.
    function shown() { return isOpen() && codeWrap.isConnected; }

    // The error line, over the boxes (2895:1339 / 2895:1370 / 2895:1401): the red words
    // first, then grey, then the blue link that sends a new code. While a code check is out,
    // its answer decides what comes next: a tap on the link does nothing then, and a new
    // code's answer that lands while a check is out is dropped (AFMBP-2575). "Too many
    // tries" and the wait have no node; they keep their words and take the expired line's look.
    var errLine = null;
    if (opts.kind) {
      var red = function (t) { return h('span', { class: 'demo-codeerr__red', text: t }); };
      var link = function (t) {
        var a = h('button', { class: 'demo-codeerr__link', type: 'button', text: t });
        a.addEventListener('click', function () {
          if (!checking && !a.disabled) doResend(a, function () { return shown() && !checking; });
        });
        return a;
      };
      var wait = 'Please wait ' + (opts.waitSecs ? opts.waitSecs + ' seconds' : 'a moment') + ' and try again';
      errLine = h('p', { class: 'demo-codeerr', role: 'alert' }, {
        incorrect: [red('Wrong code. '), 'Please try again or ', link('request another code.')],
        expired: [red('Code expired. '), link('Request new code')],
        locked: [red('Too many tries. '), link('Request a new code')],
        system: [red('Something went wrong on our side. '), 'Please try again'],
        wait: [red(wait)]
      }[opts.kind]);
    }
    // Back to the form, its number still in the field.
    var back = h('button', { class: 'demo-back', type: 'button', text: 'Back' });
    back.addEventListener('click', function () { clearResend(); renderPhone(); });

    function submit() {
      if (opts.locked || checking) return;
      var c = code();
      if (c.length !== 6) return;
      checking = true;
      var meta = metaIds();
      apiPost('/api/demo/otp/verify', verifyBody(c, meta)).then(function (r) {
        // The events record what the server said either way; a screen that has moved on is
        // left as it is (AFMBP-2575).
        var live = shown();
        if (r.ok) { track('demo_code_verified', meta ? { event_id: meta.event_id } : null); if (live) placeCall(); return; }
        track('demo_code_failed', { reason: reasonOf(r) });
        if (!live) return;
        checking = false;
        if (r.error === 'incorrect') renderCode({ kind: 'incorrect' });
        else if (r.error === 'locked_out') renderCode({ locked: true, kind: 'locked' });
        else if (r.error === 'no_active_code') renderCode({ locked: true, kind: 'expired' });
        else if (r.error === 'rate_limited') renderCode({ kind: 'wait', waitSecs: serverWait(r) });
        else codeSystemError();
      });
    }

    // "Enter the code", the error line, the six boxes and Back (2670:1394, AFMBP-2596): no
    // Continue (the sixth digit checks the code), no resend line, no help line.
    setBody([
      h('h2', { class: 'demo-h', text: 'Enter the code' }),
      errLine,
      codeWrap,
      back
    ], 'code');
    setTimeout(focusFirstEmpty, 30);
  }

  // The wait the server gave, in seconds, or null when it gave none.
  function serverWait(r) { return (r.data && (r.data.retryAfter || r.data.seconds || r.data.retry_after)) || null; }
  // Something went wrong on our side while on the code screen: the code screen stays and
  // says so over the boxes (2895:1401, AFMBP-2596).
  function codeSystemError() {
    track('demo_error', { at: step });
    renderCode({ kind: 'system' });
  }

  // A new code, from the error line's link (`linkEl`: grey and disabled while it is out).
  // `current` says whether the code screen that asked still stands (AFMBP-2575). When it no
  // longer does, the answer is still counted but nothing is drawn.
  function doResend(linkEl, current) {
    linkEl.disabled = true;
    linkEl.classList.add('busy');
    apiPost('/api/demo/otp/send', otpBody()).then(function (r) {
      var live = !current || current();
      if (r.ok) { track('demo_code_resent'); if (live) renderCode(); return; }
      track('demo_code_send_failed', { reason: reasonOf(r), resend: true });
      if (!live) return;
      if (r.error === 'rate_limited') return renderCode({ kind: 'wait', waitSecs: serverWait(r) });
      if (r.error === 'demo_limit_reached') return renderLimit();
      codeSystemError();
    });
  }

  function clearResend() { if (resendTimer) { clearInterval(resendTimer); resendTimer = null; } }

  // ---------- token + call ----------
  // The code is accepted: the canonical Calling You card goes up right away and
  // stays up while the token + call requests run and through the call itself.
  // It is never re-rendered, so there is no second "calling" screen and no
  // flash between two (AFMBP-1982). Logical steps are unchanged for analytics:
  // 'placing' until the call is placed, then 'in_call'.
  function placeCall() {
    stopConfetti();
    step = 'placing';
    var numberEl = renderCalling();
    apiPost('/api/demo/token', {
      phone: state.phone, trade: TRADE, voice: VOICE,
      businessName: state.business, locale: 'en', source: 'marketing'
    }).then(function (r) {
      if (!r.ok) {
        track('demo_call_failed', { stage: 'token', reason: reasonOf(r) });
        if (r.error === 'phone_not_verified') return renderCode({ locked: true, kind: 'expired' });
        if (r.error === 'demo_limit_reached') return renderLimit();
        return renderCallFailed();
      }
      return apiPost('/api/demo/call', { token: r.data.token }).then(function (c) {
        if (c.ok) {
          step = 'in_call';
          // callerId is the number that will actually ring the user. Absent today
          // (the card already shows the fmtDemoNumber fallback); updated in place
          // once the backend returns it.
          if (c.data && c.data.callerId) numberEl.textContent = fmtDemoNumber(c.data.callerId);
          playConfetti();
          var callId = c.data && c.data.callId;
          // call_id = the server's demo_calls row: the funnel report reads the
          // call's real outcome there, even if a browser event never arrives.
          track('demo_call_placed', { call_id: callId || null });
          if (callId) pollRecap(callId);
          // AFMBP-2130: placed, but with nothing to follow the in-call screen waits
          // forever. This used to report nothing.
          else track('demo_call_id_missing', { stage: 'call', reason: 'no_call_id' });
          return;
        }
        track('demo_call_failed', { stage: 'call', reason: reasonOf(c) });
        if (c.error === 'demo_limit_reached') return renderLimit();
        return renderCallFailed();
      });
    });
  }

  // ---------- screen: Calling You — Figma 2891:1072 ----------
  // Shown from the moment the code is accepted until the call resolves: "Your
  // assistant is calling from: <number>" over the help line (the owner's
  // 2026-11-12 update, AFMBP-2596). Returns what placeCall() sets to swap in the
  // backend's caller id.
  function renderCalling(fromNumber) {
    clearResend();
    var numberEl = h('span', { text: fmtDemoNumber(fromNumber) });
    setBody([
      h('div', { class: 'demo-callcard' }, [
        h('p', { class: 'demo-callcard__m' }, ['Your assistant is calling from: ', numberEl]),
        helpLine()
      ])
    ], 'calling');
    return { set textContent(t) { numberEl.textContent = t; } };
  }

  // ---------- recap polling ----------
  // Backend records call completion via Telnyx webhooks (/webhooks/telnyx-demo);
  // GET /api/demo/recap/:callId returns the live row. Poll it so the modal
  // advances from the in-call screen to the recap screen when the call ends.
  var recapTimer = null;
  var recapShown = false;
  // 'inbound' while the recap follows a demo-line call (AFMBP-2083), else null.
  // Events from the inbound branch carry mode: 'inbound'; the outbound demo's
  // events are sent exactly as before (no mode = outbound).
  var recapMode = null;
  function modeProps(p) { if (recapMode) p.mode = recapMode; return p; }
  // Same generation guard as the status checks (AFMBP-2099): a recap answer from
  // a superseded run is neither tracked nor rendered.
  var recapGen = 0;
  // The call a recap run is following, while it runs: {callId, since, phase:
  // 'call_end' | 'transcript', failedChecks: checks in a row that failed on the
  // network}. Every way a run ends goes through stopRecap(), so null means nothing
  // is being followed (AFMBP-2130: closing the dialog reports it).
  var recapWatch = null;
  function stopRecap() { recapGen++; recapWatch = null; if (recapTimer) { clearTimeout(recapTimer); recapTimer = null; } }
  // Closing the dialog stops the recap checks. While they were still following a
  // call (waiting for it to end, or for its transcript), the page never learns how
  // it went; demo_closed alone did not say so. Closing before a demo-line call
  // connects is not reported: there is no call to follow yet, and reopening picks
  // the same code (and its call) back up.
  function reportClosedWhileFollowing() {
    var w = recapWatch;
    if (!w || !isOpen()) return;
    track('demo_closed_while_polling', modeProps({ at: step, waiting_for: w.phase, call_id: w.callId, waited_s: Math.round((Date.now() - w.since) / 1000), failed_checks: w.failedChecks }));
  }
  // opts (the inbound branch; the outbound demo passes none): mode, onFailed
  // (its failure screen), inCallLimitMs (how long to wait for the call to end),
  // transcriptFromEnd (time the transcript wait from the end of the call, not
  // from the first poll), onSettled (the call ended, completed or failed).
  function pollRecap(callId, opts) {
    opts = opts || {};
    var prev = recapWatch;
    stopRecap();
    var gen = recapGen;
    recapShown = false;
    recapConfettiDone = false;
    recapMode = opts.mode || null;
    var onFailed = opts.onFailed || renderCallFailed;
    var inCallLimit = opts.inCallLimitMs || 240000;
    var started = Date.now();
    var endedAt = 0;
    // A restart for the same call (coming back to the page) keeps when it began.
    var watch = recapWatch = { callId: callId, since: prev && prev.callId === callId ? prev.since : started, phase: 'call_end', failedChecks: 0 };
    function settled() { if (opts.onSettled) { var fn = opts.onSettled; opts.onSettled = null; fn(); } }
    var url = API + '/api/demo/recap/' + encodeURIComponent(callId);
    (function tick() {
      fetch(url, { headers: { 'Accept': 'application/json' } })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (d) {
          if (gen !== recapGen) return;   // superseded while it was out
          watch.failedChecks = 0;
          // Bail if the user closed the modal or moved to another screen.
          if (!backdrop || !backdrop.classList.contains('open')) { stopRecap(); return; }
          if (d && d.status === 'failed') { stopRecap(); track('demo_call_failed', modeProps({ stage: 'call_status', call_id: callId })); settled(); return onFailed(); }
          if (d && d.status === 'completed') {
            if (!endedAt) endedAt = Date.now();
            watch.phase = 'transcript';
            settled();
            if (finishedFor !== callId) {
              finishedFor = callId;
              // The call has ended (answered or not). The transcript usually lands a
              // few polls later; demo_transcript_shown marks a real conversation.
              track('demo_call_finished', modeProps({ call_id: callId }));
            }
            if (normTurns(d.transcript).length > 0) { stopRecap(); track('demo_transcript_shown', modeProps({ call_id: callId })); return renderRecap(d); }
            // Completed, but the transcript isn't back yet (the server is still
            // pulling it from Telnyx). Switch to the recap now, keep polling.
            if (!recapShown) { recapShown = true; renderRecap(d); }
            if (Date.now() - (opts.transcriptFromEnd ? endedAt : started) > 240000) { stopRecap(); track('demo_transcript_unavailable', modeProps({ call_id: callId })); return renderRecap(d, { transcriptUnavailable: true }); }
            recapTimer = setTimeout(tick, 3000);
            return;
          }
          // pending / in_call — keep waiting for the call to end.
          if (Date.now() - started > inCallLimit) { stopRecap(); track('demo_call_timeout', modeProps({ call_id: callId })); return; } // give up quietly, leave the in-call screen up
          recapTimer = setTimeout(tick, 3000);
        })
        .catch(function () {
          if (gen !== recapGen) return;
          watch.failedChecks++;
          if (Date.now() - started > inCallLimit) {
            // AFMBP-2130: this used to stop without a word, leaving the visitor waiting
            // (on the in-call screen, or on a recap with no transcript) and the funnel
            // with no failure.
            stopRecap();
            track('demo_recap_poll_failed', modeProps({ stage: 'recap_poll', reason: 'network', call_id: callId, waiting_for: watch.phase, failed_checks: watch.failedChecks }));
            return;
          }
          recapTimer = setTimeout(tick, 4000); // tolerate transient network/CORS blips
        });
    })();
  }

  // Transcript arrives raw from Telnyx (unnormalized): array of {speaker,text},
  // or {role,content} (AI-assistant messages), or a plain string. Parse tolerantly.
  function isAssistant(sp) { return /assist|agent|\bbot\b|\bai\b|bolt/i.test(String(sp || '')); }
  function normTurns(transcript) {
    if (!transcript) return [];
    if (typeof transcript === 'string') {
      var s = transcript.trim();
      return s ? [{ assistant: true, label: 'Assistant', text: s }] : [];
    }
    if (!Array.isArray(transcript)) return [];
    return transcript.map(function (t) {
      if (t == null) return null;
      if (typeof t === 'string') return { assistant: true, label: 'Assistant', text: t };
      var sp = t.speaker != null ? t.speaker : (t.role != null ? t.role : (t.from != null ? t.from : t.actor));
      var tx = t.text != null ? t.text : (t.content != null ? t.content : (t.message != null ? t.message : ''));
      if (typeof tx !== 'string') tx = tx == null ? '' : String(tx);
      tx = tx.trim();
      if (!tx) return null;
      var a = isAssistant(sp);
      return { assistant: a, label: a ? 'Assistant' : 'Caller', text: tx };
    }).filter(Boolean);
  }

  // ---------- screen: recap (call completed) — Figma 2370:8784 ----------
  function renderRecap(d, opts) {
    clearResend();
    step = 'recap';
    opts = opts || {};
    if (!recapConfettiDone) { recapConfettiDone = true; playConfetti(); }
    var turns = normTurns(d && d.transcript);

    // Transcript as a chat (Figma 2370:8784 / 2441:811): assistant bubbles on the
    // left, caller bubbles on the right, each with an icon + label underneath.
    var box = h('div', { class: 'demo-chat' });
    // The node's thin scroll bar (mobile). Drawn only while the transcript can
    // scroll: iOS shows no bar of its own until you touch it.
    var bar = h('div', { class: 'demo-chat__bar', 'aria-hidden': 'true' });
    if (!turns.length) {
      box.appendChild(h('p', { class: 'demo-chat__empty', text: opts.transcriptUnavailable ? 'Transcript unavailable.' : 'Your call transcript will appear here in a moment.' }));
    } else {
      turns.forEach(function (t) {
        var meta = t.assistant
          ? [chatIcon('assistant'), h('span', { class: 'demo-chatmeta__label', text: 'Assistant' })]
          : [h('span', { class: 'demo-chatmeta__label', text: 'Caller' }), chatIcon('caller')];
        box.appendChild(h('div', { class: 'demo-chatrow ' + (t.assistant ? 'demo-chatrow--assistant' : 'demo-chatrow--caller') }, [
          h('div', { class: 'demo-bubble', text: t.text }),
          h('div', { class: 'demo-chatmeta' }, meta)
        ]));
      });
    }

    setBody([
      h('div', { class: 'demo-success' }, [
        // The title as 2441:811 draws it since the 2026-11-13 update (AFMBP-2597):
        // black "NEVER" turned, the node's brush under it, "miss a job again"
        // beside it (demo.css).
        h('h2', { class: 'demo-success-title' }, [
          h('span', { class: 'demo-mk demo-success-never', text: 'NEVER' }),
          document.createTextNode(' '),
          h('span', { class: 'demo-success-rest', text: 'miss a job again' })
        ]),
        h('p', { class: 'demo-success-sub', text: 'For less than $4 per day, skip the cost of a receptionist without missing a single lead.' }),
        // The node's label is " Transcript" (its leading space is drawn by CSS).
        h('p', { class: 'demo-success-tlabel', text: 'Transcript' }),
        h('div', { class: 'demo-chatwrap' }, [box, bar]),
        // The node's blue "Start free 30-day trial" (2441:811, AFMBP-2596).
        h('a', { class: 'demo-btn demo-success-cta', href: 'https://app.boltanswering.com/signup', onClick: function () { track('demo_trial_clicked', modeProps({ from: 'recap', call_id: finishedFor })); } }, ['Start free 30-day trial'])
      ])
    ], 'recap');
    chatBar(box, bar);
  }

  // Size + place the transcript scroll bar from the chat's scroll position; hide
  // it when everything fits. Re-run on scroll and on resize.
  var chatBarFns = [];
  function chatBar(box, bar) {
    function upd() {
      var sh = box.scrollHeight, ch = box.clientHeight;
      if (!bar.isConnected || sh <= ch + 1) { bar.style.display = 'none'; return; }
      var track = bar.parentNode.clientHeight - 2 * 10;   // 10px clear of each end
      var len = Math.max(24, track * ch / sh);
      var top = 10 + (track - len) * (box.scrollTop / (sh - ch));
      bar.style.display = 'block';
      bar.style.height = len.toFixed(2) + 'px';
      bar.style.transform = 'translateY(' + top.toFixed(2) + 'px)';
    }
    chatBarFns = [upd];
    box.addEventListener('scroll', upd, { passive: true });
    if (window.requestAnimationFrame) requestAnimationFrame(upd); else upd();
  }
  window.addEventListener('resize', function () { chatBarFns.forEach(function (f) { f(); }); });

  // ---------- screen: call didn't complete ----------
  function renderCallFailed() {
    stopConfetti();
    step = 'call_failed';
    // Call didn't happen (Figma 2676:1163). Most no-shows are the caller's spam
    // blocker eating the call, so point them at the fix pages. "Continue" places
    // the call again, to the number already verified -> back to Calling.
    var btn = h('button', { class: 'demo-btn demo-failcard__btn', type: 'button', text: 'Continue' });
    btn.addEventListener('click', function () { placeCall(); });
    // Each link carries the platform lockup (Apple / Android logo) the node
    // shows beside it. The help articles are the support center's own (the same
    // URLs the node carries); a tap is counted by platform (demo_help_clicked,
    // AFMBP-2150).
    function osLink(href, name, logo, os) {
      var a = h('a', { class: 'demo-failcard__link', href: href, target: '_blank', rel: 'noopener',
        'aria-label': name + ': how to turn off spam blockers (opens in a new tab)' }, [
        h('span', { class: 'demo-failcard__osname', text: name }),
        h('img', { class: 'demo-failcard__os', src: logo, alt: '', 'aria-hidden': 'true' })
      ]);
      a.addEventListener('click', function () { track('demo_help_clicked', { os: os }); });
      return a;
    }
    setBody([
      h('div', { class: 'demo-failcard' }, [
        // The node's "OOPs!" (2676:1163 as updated 2026-11-12, AFMBP-2596).
        h('p', { class: 'demo-failcard__head' }, [
          h('span', { class: 'demo-mk demo-failcard__title2', text: 'OOPs!' })
        ]),
        h('div', { class: 'demo-failcard__body2' }, [
          h('p', {}, [h('b', { text: 'Sometimes Bolt calls get spam blocked' }), '. ']),
          h('p', {}, ['Here’s how to temporarily turn off spam blockers before you try again:'])
        ]),
        h('div', { class: 'demo-failcard__links' }, [
          osLink('/support/hca/disable-ios-spam-blockers', 'iPhones', 'assets/demo-m-lockup-iphone.svg', 'ios'),
          osLink('/support/hca/disable-android-spam-blockers', 'Androids', 'assets/demo-m-lockup-android.svg', 'android')
        ]),
        btn
      ])
    ], 'fail');
  }

  // ---------- demo limit reached — inline on the phone form (Figma 2370:8877) ----------
  function renderLimit() {
    clearResend();
    track('demo_limit_reached', { at: step });
    renderPhone({ limit: true });
  }

  // ---------- screen: something went wrong ----------
  function renderError() {
    track('demo_error', { at: step });
    step = 'error';
    var btn = h('button', { class: 'demo-btn', type: 'button', text: 'Try again' });
    btn.addEventListener('click', function () { renderPhone(); });
    setBody([
      heading('Something went wrong'),
      sub('Something went wrong on our side. Please try again.'),
      btn,
      helpLine()
    ]);
  }

  // ---------- wire triggers ----------
  function wire() {
    var btns = document.querySelectorAll('a.btn--blue, button.btn--blue, [data-demo-open]');
    Array.prototype.forEach.call(btns, function (b) {
      if (b.hasAttribute('data-demo-open') || /talk to your new assistant/i.test(b.textContent)) {
        b.addEventListener('click', function (e) { e.preventDefault(); openModal('button', null, b); });
      }
    });
  }
  // QA-only hook (needs ?demoqa=1) to render each modal state deterministically for
  // screenshot verification, without walking the live OTP/call API. No effect otherwise.
  if (typeof window !== 'undefined' && /[?&]demoqa=1/.test(window.location.search)) {
    // AFMBP-2083: choice, You call us card (code, manual = number shown) and its
    // failure card, with a stand-in session so nothing is created on the server.
    var qaSession = function (code) {
      return { sessionId: 'qa', code: code || '1234', telUri: 'tel:+18554973151,,' + (code || '1234'), numberDisplay: '(855) 497-3151', expiresAt: Date.now() + 9 * 60000 };
    };
    window.__demoQA = {
      open: function () { openModal('qa'); }, phone: renderPhone, code: renderCode, inCall: renderCalling,
      recap: renderRecap, fail: renderCallFailed, limit: renderLimit, error: renderError,
      choice: renderChoice,
      inbound: function (code) { renderInboundCall(qaSession(code)); },
      inboundFail: renderInboundFailed,
      state: state
    };
  }

  // Ad links land straight in the flow (AFMBP-1960): a page with the flow opens
  // it on arrival when its URL carries `talk` (/?talk=1, /hvac.html?talk=1,
  // alongside any utm_* / click-id params). Closing it leaves the visitor on
  // the page; the trade still comes from the page path, as with the buttons.
  // It opens on the choice of the two demos; `talk=form` goes straight to the
  // "We'll call you" form (AFMBP-2083).
  function autoOpen() {
    var q = window.location.search;
    // AFMBP-2273: ?signup=1 (the sign-up test's ad links) opens the sign-up offer
    // instead of the demo; it wins over ?talk on the same link.
    var entry = /[?&]signup=1(&|$)/.test(q) ? 'signup' : (/[?&]talk=form(&|$)/.test(q) ? 'form' : null);
    if (entry !== 'signup' && !/[?&]talk(=|&|$)/.test(q)) return;
    // AFMBP-2010: open (and log `demo_opened`) only once someone is looking at
    // the page. A preloaded or prerendered ad landing is not a demo opened.
    var whenVisible = window.boltAttr && window.boltAttr.whenVisible;
    if (whenVisible) whenVisible(function () { openModal('ad_link', entry); });
    else openModal('ad_link', entry);
  }
  function init() {
    wire();
    // The phone unloaded this tab while the visitor was on a demo-line call
    // started here: reopen and follow that call to its recap.
    var s = resumableInbound();
    if (s && s.open) {
      var whenVisible = window.boltAttr && window.boltAttr.whenVisible;
      if (whenVisible) whenVisible(function () { openModal('resume'); });
      else openModal('resume');
      return;
    }
    autoOpen();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
