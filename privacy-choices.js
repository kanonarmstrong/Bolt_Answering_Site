/* ============================================================
   Your Privacy Choices — AFMBP-2019 (owner's option A: a footer link and a
   small panel, no banner). US opt-out model.

   One switch covers the advertising and analytics tags: the Meta Pixel
   (meta-pixel.js, AFMBP-2021) and Google Analytics + Google Ads (the loader in
   each page's <head>).
     - On by default.
     - Off for a browser sending Global Privacy Control; it can't be switched
       on here.
     - Off once the visitor switches it off: localStorage `bolt_optout` = '1',
       the same key meta-pixel.js and the Google loader read (also set by
       ?bolt_optout=1, cleared by ?bolt_optout=0).
   Bolt's own anonymous funnel events (attribution.js) keep running either
   way: they are first-party and never go to an ad platform.

   Openers: any element with [data-privacy-choices] (the footer link and the
   privacy policy's button). Without JS the footer link goes to the policy
   section instead.

   The wording below is a DRAFT for the owner's approval (legal copy).
   ============================================================ */
(function () {
  'use strict';

  var COPY = {
    title: 'Your Privacy Choices',
    body: 'We use cookies and similar tools from Meta and Google to measure our ads and to show our ads to people who have visited this site. You can turn them off for this browser.',
    first: 'Our own anonymous site analytics keep running either way. They are never shared with advertising platforms.',
    toggle: 'Allow advertising and analytics cookies',
    gpc: 'Your browser is sending a Global Privacy Control signal, so these stay off.',
    savedOff: 'Saved. Advertising and analytics cookies are off for this browser.',
    save: 'Save',
    policy: 'Privacy Policy',
    close: 'Close'
  };
  var KEY = 'bolt_optout';

  function readOptOut() { try { return window.localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
  function writeAllowed(on) {
    try { if (on) window.localStorage.removeItem(KEY); else window.localStorage.setItem(KEY, '1'); } catch (e) {}
  }
  function gpc() { try { return window.navigator.globalPrivacyControl === true; } catch (e) { return false; } }
  function allowed() { return !gpc() && !readOptOut(); }

  // Switched off: stop what is already running on this page. The next page
  // load doesn't start Meta or Google at all.
  function stopNow() {
    try { if (typeof window.fbq === 'function') window.fbq('consent', 'revoke'); } catch (e) {}
    try { if (window.boltMeta) window.boltMeta.enabled = false; } catch (e) {}
    try { window['ga-disable-G-8C8SFMCRYH'] = true; } catch (e) {}
    try {
      if (typeof window.gtag === 'function') {
        window.gtag('consent', 'update', { ad_storage: 'denied', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
      }
    } catch (e) {}
  }

  var CSS =
    '.pc-backdrop{position:fixed;inset:0;z-index:2147483000;background:rgba(12,12,13,.45);display:flex;align-items:center;justify-content:center;padding:16px}' +
    '.pc-card{position:relative;box-sizing:border-box;width:100%;max-width:420px;max-height:calc(100vh - 32px);overflow:auto;background:#fff;border-radius:16px;padding:28px 24px 22px;box-shadow:0 10px 30px rgba(0,0,0,.25);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#180a53;text-align:left}' +
    '.pc-title{margin:0 32px 12px 0;font-size:20px;line-height:1.3;font-weight:700;color:#180a53}' +
    '.pc-text{margin:0 0 10px;font-size:15px;line-height:1.5;color:#3d3d4e}' +
    '.pc-row{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:18px 0 6px;padding:14px 0;border-top:1px solid #e6e6ec;border-bottom:1px solid #e6e6ec}' +
    '.pc-label{font-size:15px;font-weight:600;color:#180a53}' +
    '.pc-switch{flex:none;position:relative;width:48px;height:28px;border:0;border-radius:14px;background:#c4c4cc;cursor:pointer;padding:0;transition:background .15s}' +
    '.pc-switch[aria-checked="true"]{background:#2b7ffd}' +
    '.pc-switch::after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .15s}' +
    '.pc-switch[aria-checked="true"]::after{transform:translateX(20px)}' +
    '.pc-switch:disabled{cursor:not-allowed;opacity:.55}' +
    '.pc-switch:focus-visible,.pc-save:focus-visible,.pc-close:focus-visible{outline:2px solid #2b7ffd;outline-offset:2px}' +
    '.pc-note{margin:8px 0 0;font-size:14px;line-height:1.45;color:#3d3d4e}' +
    '.pc-status{min-height:20px;margin:10px 0 0;font-size:14px;line-height:1.45;color:#0a7a3a}' +
    '.pc-actions{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:16px}' +
    '.pc-save{border:0;border-radius:8px;background:#2b7ffd;color:#fff;font:600 16px/1 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;padding:12px 28px;cursor:pointer}' +
    '.pc-policy{font-size:15px;color:#2b7ffd;text-decoration:underline}' +
    '.pc-close{position:absolute;top:14px;right:14px;width:32px;height:32px;border:0;background:none;color:#180a53;font-size:24px;line-height:1;cursor:pointer;border-radius:8px}' +
    '@media (prefers-reduced-motion:reduce){.pc-switch,.pc-switch::after{transition:none}}';

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') el.textContent = attrs[k];
      else if (k === 'class') el.className = attrs[k];
      else el.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }

  var backdrop = null, opener = null, prevOverflow = '';

  function close() {
    if (!backdrop) return;
    backdrop.remove(); backdrop = null;
    document.documentElement.style.overflow = prevOverflow;
    document.removeEventListener('keydown', onKey, true);
    if (opener && typeof opener.focus === 'function') { try { opener.focus(); } catch (e) {} }
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab' || !backdrop) return;
    // Keep keyboard focus inside the panel while it is open.
    var f = Array.prototype.filter.call(backdrop.querySelectorAll('button,a[href]'), function (el) { return !el.disabled; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function open(from) {
    if (backdrop) return;
    opener = from || document.activeElement;
    if (!document.getElementById('pc-style')) document.head.appendChild(h('style', { id: 'pc-style', text: CSS }));

    var isGpc = gpc();
    var start = allowed();
    var sw = h('button', { type: 'button', class: 'pc-switch', role: 'switch', 'aria-checked': String(start), 'aria-labelledby': 'pc-label', id: 'pc-switch' });
    if (isGpc) sw.disabled = true;
    sw.addEventListener('click', function () { sw.setAttribute('aria-checked', String(sw.getAttribute('aria-checked') !== 'true')); });

    var status = h('p', { class: 'pc-status', role: 'status', 'aria-live': 'polite' });
    var save = h('button', { type: 'button', class: 'pc-save', text: COPY.save });
    save.addEventListener('click', function () {
      var on = sw.getAttribute('aria-checked') === 'true';
      if (isGpc || on === start) { close(); return; }
      writeAllowed(on);
      if (on) { window.location.reload(); return; } // Meta and Google start fresh on the reload
      stopNow();
      start = false;
      status.textContent = COPY.savedOff;
    });

    var closeBtn = h('button', { type: 'button', class: 'pc-close', 'aria-label': COPY.close, text: '×' });
    closeBtn.addEventListener('click', close);

    var card = h('div', { class: 'pc-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pc-title' }, [
      closeBtn,
      h('h2', { class: 'pc-title', id: 'pc-title', text: COPY.title }),
      h('p', { class: 'pc-text', text: COPY.body }),
      h('p', { class: 'pc-text', text: COPY.first }),
      h('div', { class: 'pc-row' }, [h('span', { class: 'pc-label', id: 'pc-label', text: COPY.toggle }), sw]),
      isGpc ? h('p', { class: 'pc-note', text: COPY.gpc }) : null,
      status,
      h('div', { class: 'pc-actions' }, [save, h('a', { class: 'pc-policy', href: '/privacy/#your-privacy-choices', text: COPY.policy })])
    ].filter(Boolean));

    backdrop = h('div', { class: 'pc-backdrop', 'data-pc': '' }, [card]);
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
    prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.appendChild(backdrop);
    document.addEventListener('keydown', onKey, true);
    try { (isGpc ? save : sw).focus(); } catch (e) {}
  }

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-privacy-choices]') : null;
    if (!t) return;
    e.preventDefault();
    open(t);
  });

  window.boltPrivacyChoices = { open: open, allowed: allowed };
})();
