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
  // Built from one source so render == send by construction.
  // “ ” = curly double quotes, ’ = curly apostrophe (match Figma 2370:8697).
  // "marketing purposes, and (2)": the comma is the form node's (2657:1639),
  // adopted with the owner's OK (AFMBP-2000). Changing this text changes the
  // consent hash stored with every new lead, by design.
  var CONSENT_A = 'By providing your phone number and/or email address and tapping “Continue”, ' +
    'you agree to (1) receive text messages and emails from Bolt Answering for (a) security verification ' +
    'and (b) marketing purposes, and (2) automated phone calls from Bolt Answering’s virtual assistant ' +
    'at the number provided. Message frequency may vary. Standard Message, Voice, and Data Rates may apply. ' +
    // STOP/HELP kept for OTP/TCPA compliance — intentionally diverges from Figma
    // node 2354:7460 (which omits it). Do NOT remove to match the design.
    'Reply STOP to opt out. Reply HELP for help. ' +
    'In accordance with our ';
  var CONSENT_LINK = 'Privacy Policy';
  var CONSENT_B = ', we will not share mobile information with third parties for promotional or marketing purposes.';
  var CONSENT_TEXT = CONSENT_A + CONSENT_LINK + CONSENT_B;

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
      window.boltAttr.track(event, p);
    } catch (e) {}
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
  // Transcript meta icon ('assistant' | 'caller'): desktop keeps its artwork;
  // mobile (<=768px) gets the mobile node's icons (Figma 2633:919) through a
  // standard <picture> source, so the browser picks + paints it reliably.
  function chatIcon(who) {
    return h('picture', { class: 'demo-chatmeta__pic' }, [
      h('source', { media: '(max-width:768px)', srcset: 'assets/demo-m-icon-' + who + '.svg' }),
      h('img', { class: 'demo-chatmeta__icon', src: 'assets/demo-icon-' + who + '.svg', alt: '' })
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
    card = h('div', { class: 'demo-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Talk to your new assistant' }, [close, logo, body]);
    backdrop = h('div', { class: 'demo-backdrop', onClick: function (e) { if (e.target === backdrop) closeModal(); } }, [card]);
    document.body.appendChild(backdrop);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && backdrop.classList.contains('open')) closeModal(); });
  }
  // Warm the mobile node art (brush underlines, OS lockups, watermark,
  // chat icons) when the modal opens, so the calling / recap / failure screens
  // later paint complete instead of popping the strokes in on a slow connection.
  var MOBILE_ART = ['demo-m-ul-rightnow', 'demo-m-ul-allset', 'demo-m-ul-done', 'demo-m-ul-never',
    'demo-m-ul-30days', 'demo-m-ul-fail', 'demo-m-checker', 'demo-os-iphone', 'demo-os-android',
    'demo-m-icon-assistant', 'demo-m-icon-caller'];
  var artWarmed = false;
  function warmMobileArt() {
    if (artWarmed || !isMobile()) return;
    artWarmed = true;
    MOBILE_ART.forEach(function (n) { var i = new Image(); i.src = 'assets/' + n + '.svg'; });
  }
  function openModal(trigger) {
    warmMobileArt();
    if (!backdrop) build();
    stopConfetti();
    recapConfettiDone = false;
    renderPhone();
    backdrop.classList.add('open');
    document.body.classList.add('demo-lock');
    track('demo_opened', { trigger: trigger || 'button' });
  }
  function closeModal() {
    if (backdrop && backdrop.classList.contains('open')) track('demo_closed', { step: step });
    clearResend();
    stopRecap();
    stopConfetti();
    backdrop.classList.remove('open');
    document.body.classList.remove('demo-lock');
  }
  // `screen` tags the backdrop (data-screen) so CSS can apply the pixel-matched
  // mobile layouts (Figma 2657:1639 / 2442:1191 / 2441:811 / 2511:1027) to just
  // those screens; every other screen renders with the attribute empty.
  function setBody(nodes, screen) {
    body.innerHTML = '';
    nodes.forEach(function (n) { if (n) body.appendChild(n); });
    if (backdrop) backdrop.setAttribute('data-screen', screen || '');
  }
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

  // ---------- screen: phone entry ----------
  // `label` is text or a list of nodes; `required` marks the field required to
  // the browser and to assistive tech (email is optional: neither, AFMBP-2000).
  function field(label, id, ph, type, val, required) {
    var input = h('input', {
      class: 'demo-input', id: id, type: type || 'text', placeholder: ph, value: val || '',
      required: required ? '' : null, 'aria-required': required ? 'true' : null,
      autocomplete: id === 'demo-phone' ? 'tel' : (id === 'demo-email' ? 'email' : 'organization'),
      inputmode: id === 'demo-phone' ? 'tel' : null
    });
    // demo-field--{phone,business,email}: the nodes space the three fields
    // unevenly, so each wrapper is addressable in CSS.
    var key = id.replace('demo-', '');
    return { wrap: h('div', { class: 'demo-field demo-field--' + key }, [h('label', { class: 'demo-label', for: id }, typeof label === 'string' ? [label] : label), input]), input: input };
  }
  function renderPhone(opts) {
    opts = opts || {};
    step = opts.limit ? 'limit' : 'details';
    // Labels = Figma 2657:1639 on both breakpoints, except the business label
    // ("What’s your business called?", owner, AFMBP-2003). Phone + business name
    // are required; email is optional (AFMBP-2000). The business placeholder is
    // the owner's "Business name" (AFMBP-2003; node 2664:800), on every page.
    var phone = field('What’s your phone number?', 'demo-phone', '(555) 555-1212', 'tel', state.display, true);
    var biz = field('What’s your business called?', 'demo-business', 'Business name', 'text', state.business, true);
    var email = field(['What’s your email? ', h('span', { class: 'demo-label__opt', text: '(optional)' })],
      'demo-email', 'yourname@example.com', 'email', state.email, false);
    var byKey = { phone: phone, business: biz, email: email };

    // Single form-level error message shown above the button, with the offending
    // field(s) turned red/pink (Figma error states 2548:3438/3480/3522/3561).
    var formErr = h('p', { class: 'demo-formerr', id: 'demo-formerr', role: 'alert', style: 'display:none' });
    function markErr(f) {
      f.input.classList.add('err');
      f.input.setAttribute('aria-invalid', 'true');
      f.input.setAttribute('aria-describedby', 'demo-formerr');
    }
    function clearAllErr() {
      [phone, biz, email].forEach(function (f) {
        f.input.classList.remove('err');
        f.input.removeAttribute('aria-invalid');
        f.input.removeAttribute('aria-describedby');
      });
    }
    function hideFormErr() { formErr.style.display = 'none'; formErr.textContent = ''; }
    function showFormErr(fields, msg) { clearAllErr(); fields.forEach(markErr); formErr.textContent = msg; formErr.style.display = 'block'; }
    function clearFieldErr(f) {
      f.input.classList.remove('err');
      f.input.removeAttribute('aria-invalid');
      f.input.removeAttribute('aria-describedby');
      if (![phone, biz, email].some(function (x) { return x.input.classList.contains('err'); })) hideFormErr();
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
      clearFieldErr(phone);
    });
    biz.input.addEventListener('input', function () { clearFieldErr(biz); });
    email.input.addEventListener('input', function () { clearFieldErr(email); });

    // The rules live in demo-format.js (unit-tested): Continue greys out until
    // phone + business name are filled; a tap then checks missing required ->
    // phone -> business -> email (blank email is fine, a typed one must be valid).
    function vals() { return { phone: phone.input.value, business: biz.input.value, email: email.input.value }; }
    function validateForm() {
      var bad = DF.checkForm(vals());
      return bad && { fields: bad.fields.map(function (k) { return byKey[k]; }), msg: bad.msg };
    }

    var disclosure = h('p', { class: 'demo-disclosure' }, [
      CONSENT_A,
      h('a', { href: '/privacy/', target: '_blank', rel: 'noopener' }, [CONSENT_LINK]),
      CONSENT_B
    ]);
    var btn = h('button', { class: 'demo-btn', type: 'button', text: 'Continue' });
    // Grey until phone + business name are filled (Figma 2664:800). It stays
    // tappable: a tap on the grey button shows "Please complete the form to
    // continue." with the empty fields flagged, so it is aria-disabled, never
    // `disabled` (which would swallow the tap).
    function syncBtn() {
      var on = DF.formComplete(vals());
      btn.classList.toggle('demo-btn--off', !on);
      if (on) btn.removeAttribute('aria-disabled'); else btn.setAttribute('aria-disabled', 'true');
    }
    [phone, biz, email].forEach(function (f) { f.input.addEventListener('input', syncBtn); });
    syncBtn();

    btn.addEventListener('click', function () {
      var bad = validateForm();
      if (bad) { showFormErr(bad.fields, bad.msg); bad.fields[0].input.focus(); return; }  // no call fires for an invalid form
      hideFormErr();

      state.display = fmtPhone(phone.input.value);
      state.phone = e164(phone.input.value);            // normalized E.164 to the API
      state.business = biz.input.value.trim();
      state.email = DF.normEmail(email.input.value);    // '' = no email given

      busy(btn, 'Sending…');
      // has_email: whether an address was given, never the address itself.
      track('demo_details_submitted', { has_email: !!state.email });
      apiPost('/api/demo/otp/send', otpBody()).then(function (r) {
        if (r.ok) { track('demo_code_sent'); return renderCode(); }
        track('demo_code_send_failed', { reason: reasonOf(r) });
        unbusy(btn, 'Continue');
        if (r.error === 'invalid_phone') showFormErr([phone], r.message || 'Invalid phone number. Please try again.');
        else if (r.error === 'demo_limit_reached') renderLimit();
        else if (r.error === 'rate_limited') showFormErr([phone], waitMsg(r));
        else renderError();
      });
    });

    // Keyboard submission from any field.
    [phone, biz, email].forEach(function (f) {
      f.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); btn.click(); } });
    });

    var limitMsg = opts.limit ? h('p', { class: 'demo-limitmsg' }, [
      'You’ve reached your demo limit. ',
      h('a', { class: 'demo-limitmsg__link', href: 'https://app.boltanswering.com/signup', onClick: function () { track('demo_trial_clicked', { from: 'limit' }); } }, ['Start a free trial today'])
    ]) : null;

    setBody([
      // Figma desktop 2387:9076 / mobile 2657:1639: one-line marker title (the
      // mobile node draws its yellow brush under "right now") + the sub, the
      // node's copy on both breakpoints.
      h('h2', { class: 'demo-h demo-h--form' }, [
        'We’ll call you ', h('span', { class: 'demo-h__ul', text: 'right now' })
      ]),
      h('p', { class: 'demo-sub', text: 'Get a one-time passcode' }),
      phone.wrap, biz.wrap, email.wrap,
      limitMsg,
      formErr,
      btn, h('div', { class: 'demo-disclosure-wrap' }, [disclosure]), helpLine()
    ], 'phone');
    setTimeout(function () { phone.input.focus(); }, 30);
  }

  // /api/demo/otp/send body, for the first send and every resend. No email ->
  // no email key (the server then just skips the marketing-lead write).
  function otpBody() {
    return DF.otpSendBody({ phone: state.phone, business: state.business, email: state.email }, CONSENT_TEXT);
  }

  function waitMsg(r) {
    var s = r.data && (r.data.retryAfter || r.data.seconds || r.data.retry_after);
    return 'Please wait ' + (s ? s + ' seconds' : 'a moment') + ' and try again.';
  }

  // ---------- screen: code entry ----------
  function renderCode(opts) {
    opts = opts || {};
    step = 'code';
    var boxes = [];
    var codeWrap = h('div', { class: 'demo-code' + (opts.error ? ' err' : '') });
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

    var btn = h('button', { class: 'demo-btn', type: 'button', text: 'Continue' });
    var errEl = opts.error ? h('div', { class: 'demo-error', text: opts.error }) : null;

    // Resend control
    var resendWrap = h('div', { class: 'demo-resend' });
    var resendBtn = h('button', { type: 'button', text: 'Request a new code' });
    resendWrap.appendChild(document.createTextNode("Didn’t get it? "));
    resendWrap.appendChild(resendBtn);
    resendBtn.addEventListener('click', function () { doResend(resendBtn); });
    if (opts.resendSecs) startResend(resendBtn, opts.resendSecs);

    function submit() {
      if (opts.locked) return;
      var c = code();
      if (c.length !== 6) return;
      busy(btn, 'Verifying…');
      apiPost('/api/demo/otp/verify', { phone: state.phone, code: c }).then(function (r) {
        if (r.ok) { track('demo_code_verified'); return placeCall(); }
        track('demo_code_failed', { reason: reasonOf(r) });
        unbusy(btn, 'Continue');
        if (r.error === 'incorrect') renderCode({ error: 'Wrong code. Please try again or request another code.' });
        else if (r.error === 'locked_out') renderCode({ error: 'Too many tries. Request a new code.', locked: true });
        else if (r.error === 'no_active_code') renderCode({ error: 'That code has expired. Request a new code.', locked: true });
        else if (r.error === 'rate_limited') renderCode({ error: null, resendSecs: retryAfter(r) });
        else renderError();
      });
    }
    btn.addEventListener('click', submit);

    setBody([
      heading('One-time passcode'),
      sub('We sent you a 6-digit one-time passcode to the number you provided.'),
      h('label', { class: 'demo-label', style: 'margin-bottom:2px', text: 'Enter your passcode' }),
      codeWrap,
      errEl,
      btn,
      resendWrap,
      helpLine()
    ]);
    setTimeout(focusFirstEmpty, 30);
  }

  function retryAfter(r) { return (r.data && (r.data.retryAfter || r.data.seconds || r.data.retry_after)) || 60; }

  function doResend(btnEl) {
    busy(btnEl, 'Sending…'); btnEl.classList.add('busy');
    apiPost('/api/demo/otp/send', otpBody()).then(function (r) {
      if (r.ok) { track('demo_code_resent'); return renderCode({ resendSecs: 60 }); }
      track('demo_code_send_failed', { reason: reasonOf(r), resend: true });
      if (r.error === 'rate_limited') return renderCode({ resendSecs: retryAfter(r) });
      if (r.error === 'demo_limit_reached') return renderLimit();
      renderError();
    });
  }

  function startResend(btnEl, secs) {
    clearResend();
    var left = secs;
    btnEl.disabled = true;
    var base = btnEl.textContent;
    function tick() {
      if (left <= 0) { clearResend(); btnEl.disabled = false; btnEl.textContent = 'Request a new code'; return; }
      btnEl.textContent = 'Request a new code in ' + left + 's';
      left--;
    }
    tick();
    resendTimer = setInterval(tick, 1000);
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
        if (r.error === 'phone_not_verified') return renderCode({ error: 'That code has expired. Request a new code.', locked: true });
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
          return;
        }
        track('demo_call_failed', { stage: 'call', reason: reasonOf(c) });
        if (c.error === 'demo_limit_reached') return renderLimit();
        return renderCallFailed();
      });
    });
  }

  // ---------- screen: Calling You — Figma desktop 2370:8769 / mobile 2442:1191 ----------
  // Shown from the moment the code is accepted until the call resolves. Returns
  // the number element so placeCall() can swap in the backend's caller-id.
  // Copy is the mobile node's on both breakpoints (AFMBP-2000). Marker copy is mixed case
  // (Permanent Marker renders lowercase as small caps); desktop CSS uppercases
  // it. Title + "Calling you now from" are separate spans: inline on desktop,
  // placed on one line at the node's offsets on mobile.
  function renderCalling(fromNumber) {
    clearResend();
    var numberEl = h('b', { text: fmtDemoNumber(fromNumber) });
    setBody([
      h('div', { class: 'demo-callcard' }, [
        h('p', { class: 'demo-callcard__head' }, [
          h('span', { class: 'demo-mk demo-ul demo-callcard__title', text: 'All set!' }),
          h('span', { class: 'demo-callcard__from' }, [' Calling you now from ', numberEl])
        ]),
        h('p', { class: 'demo-callcard__expect demo-mk', text: 'What to expect:' }),
        h('ol', { class: 'demo-callcard__list' }, [
          h('li', {}, ['She’ll act like your receptionist']),
          h('li', {}, ['Describe an issue or potential project']),
          h('li', {}, ['Share fake details to schedule']),
          // A zero-width space keeps the "4." line when mobile lifts DONE! onto it.
          h('li', {}, ['\u200B', h('span', { class: 'demo-mk demo-ul demo-callcard__done', text: 'DONE!' })])
        ])
      ])
    ], 'calling');
    return numberEl;
  }

  // ---------- recap polling ----------
  // Backend records call completion via Telnyx webhooks (/webhooks/telnyx-demo);
  // GET /api/demo/recap/:callId returns the live row. Poll it so the modal
  // advances from the in-call screen to the recap screen when the call ends.
  var recapTimer = null;
  var recapShown = false;
  function stopRecap() { if (recapTimer) { clearTimeout(recapTimer); recapTimer = null; } }
  function pollRecap(callId) {
    stopRecap();
    recapShown = false;
    recapConfettiDone = false;
    var started = Date.now();
    var url = API + '/api/demo/recap/' + encodeURIComponent(callId);
    (function tick() {
      fetch(url, { headers: { 'Accept': 'application/json' } })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (d) {
          // Bail if the user closed the modal or moved to another screen.
          if (!backdrop || !backdrop.classList.contains('open')) { stopRecap(); return; }
          if (d && d.status === 'failed') { stopRecap(); track('demo_call_failed', { stage: 'call_status', call_id: callId }); return renderCallFailed(); }
          if (d && d.status === 'completed') {
            if (finishedFor !== callId) {
              finishedFor = callId;
              // The call has ended (answered or not). The transcript usually lands a
              // few polls later; demo_transcript_shown marks a real conversation.
              track('demo_call_finished', { call_id: callId });
            }
            if (normTurns(d.transcript).length > 0) { stopRecap(); track('demo_transcript_shown', { call_id: callId }); return renderRecap(d); }
            // Completed, but the transcript isn't back yet (the server is still
            // pulling it from Telnyx). Switch to the recap now, keep polling.
            if (!recapShown) { recapShown = true; renderRecap(d); }
            if (Date.now() - started > 240000) { stopRecap(); track('demo_transcript_unavailable', { call_id: callId }); return renderRecap(d, { transcriptUnavailable: true }); }
            recapTimer = setTimeout(tick, 3000);
            return;
          }
          // pending / in_call — keep waiting for the call to end.
          if (Date.now() - started > 240000) { stopRecap(); track('demo_call_timeout', { call_id: callId }); return; } // give up quietly, leave the in-call screen up
          recapTimer = setTimeout(tick, 3000);
        })
        .catch(function () {
          if (Date.now() - started > 240000) { stopRecap(); return; }
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
        // Copy = Figma 2441:811 on both breakpoints (AFMBP-2000).
        h('h2', { class: 'demo-success-title' }, [
          h('span', { class: 'demo-mk demo-ul demo-success-never', text: 'NEVER' }),
          document.createTextNode(' '),
          h('span', { class: 'demo-success-rest', text: 'miss a job again' })
        ]),
        h('p', { class: 'demo-success-sub', text: 'Bolt handles bookings, qualifies leads, takes messages, and more so you can focus on making money!' }),
        h('p', { class: 'demo-success-tlabel', text: 'Here’s your transcript:' }),
        h('div', { class: 'demo-chatwrap' }, [box, bar]),
        // The spaces are their own spans: the node sets them at 19.3px, between
        // the 15.5px words and the 28.6px "30 days".
        h('p', { class: 'demo-success-trial demo-mk' }, [
          h('span', { class: 'demo-success-trial__sm', text: 'First' }),
          h('span', { class: 'demo-success-trial__gap', text: ' ' }),
          h('span', { class: 'demo-success-trial__big demo-ul', text: '30 days' }),
          h('span', { class: 'demo-success-trial__gap', text: ' ' }),
          h('span', { class: 'demo-success-trial__sm', text: 'are on us!' })
        ]),
        h('a', { class: 'demo-btn demo-btn--yellow demo-success-cta', href: 'https://app.boltanswering.com/signup', onClick: function () { track('demo_trial_clicked', { from: 'recap', call_id: finishedFor }); } }, ['Start my free trial now'])
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
    // Call didn't happen (Figma 2511:1027 / 2370:8833). Most no-shows are the
    // caller's spam blocker eating the call, so point them at the fix pages.
    // The button re-places the call -> back to the "calling you" screen.
    // Copy = Figma 2511:1027 on both breakpoints (AFMBP-2000): "Try again" (blue
    // on mobile per the node; desktop keeps its yellow button).
    var btn = h('button', { class: 'demo-btn demo-btn--yellow demo-failcard__btn', type: 'button', text: 'Try again' });
    btn.addEventListener('click', function () { placeCall(); });
    // Marker copy is lowercase per the nodes (renders as uniform small caps);
    // desktop CSS re-uppercases it. On mobile each link also carries the
    // platform lockup (Apple / Android logo) the mobile node shows beside it.
    function osLink(href, name, logo) {
      return h('a', { class: 'demo-failcard__link', href: href, target: '_blank', rel: 'noopener' }, [
        h('span', { class: 'demo-failcard__osname', text: name }),
        h('img', { class: 'demo-failcard__os', src: logo, alt: '', 'aria-hidden': 'true' })
      ]);
    }
    setBody([
      h('div', { class: 'demo-failcard' }, [
        h('p', { class: 'demo-failcard__head' }, [
          h('span', { class: 'demo-mk demo-failcard__title' }, ['that didn’t work ', h('span', { class: 'demo-failcard__sad', text: ':(' })])
        ]),
        h('div', { class: 'demo-failcard__body' }, [
          h('p', {}, [h('b', { text: 'Sometimes Bolt calls get spam blocked.' }), ' Here’s how to temporarily turn off spam blockers.']),
          h('p', {}, [h('b', { text: 'Follow these instructions' }), ', then try again.'])
        ]),
        h('div', { class: 'demo-failcard__links' }, [
          osLink('/support/hca/disable-ios-spam-blockers', 'iPhones', 'assets/demo-os-iphone.svg'),
          osLink('/support/hca/disable-android-spam-blockers', 'Androids', 'assets/demo-os-android.svg')
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
        b.addEventListener('click', function (e) { e.preventDefault(); openModal('button'); });
      }
    });
  }
  // QA-only hook (needs ?demoqa=1) to render each modal state deterministically for
  // screenshot verification, without walking the live OTP/call API. No effect otherwise.
  if (typeof window !== 'undefined' && /[?&]demoqa=1/.test(window.location.search)) {
    window.__demoQA = {
      open: function () { openModal('qa'); }, phone: renderPhone, code: renderCode, inCall: renderCalling,
      recap: renderRecap, fail: renderCallFailed, limit: renderLimit, error: renderError,
      state: state
    };
  }

  // Ad links land straight in the flow (AFMBP-1960): a page with the flow opens
  // it on arrival when its URL carries `talk` (/?talk=1, /hvac.html?talk=1,
  // alongside any utm_* / click-id params). Closing it leaves the visitor on
  // the page; the trade still comes from the page path, as with the buttons.
  function autoOpen() {
    if (!/[?&]talk(=|&|$)/.test(window.location.search)) return;
    // AFMBP-2010: open (and log `demo_opened`) only once someone is looking at
    // the page. A preloaded or prerendered ad landing is not a demo opened.
    var whenVisible = window.boltAttr && window.boltAttr.whenVisible;
    if (whenVisible) whenVisible(function () { openModal('ad_link'); });
    else openModal('ad_link');
  }
  function init() {
    wire();
    autoOpen();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
