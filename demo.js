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

  // Disclosure — must be sent EXACTLY as rendered (server sha256's it).
  // Built from one source so render == send by construction.
  // “ ” = curly double quotes, ’ = curly apostrophe (match Figma 2370:8697).
  var CONSENT_A = 'By providing your phone number and/or email address and tapping “Continue”, ' +
    'you agree to (1) receive text messages and emails from Bolt Answering for (a) security verification ' +
    'and (b) marketing purposes and (2) automated phone calls from Bolt Answering’s virtual assistant ' +
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

  // ---------- phone helpers ----------
  function digits(s) { return (s || '').replace(/\D/g, ''); }
  function validPhone(s) { var d = digits(s); return d.length === 10 || (d.length === 11 && d.charAt(0) === '1'); }
  function e164(s) {
    var d = digits(s);
    if (d.length === 11 && d.charAt(0) === '1') return '+' + d;
    if (d.length === 10) return '+1' + d;
    return '+' + d;
  }
  function fmtPhone(s) {
    var d = digits(s); if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
    var a = d.slice(0, 3), b = d.slice(3, 6), c = d.slice(6, 10);
    if (d.length > 6) return '(' + a + ') ' + b + '-' + c;
    if (d.length > 3) return '(' + a + ') ' + b;
    if (d.length > 0) return '(' + a;
    return '';
  }

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
  var body, backdrop, card;
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
  function openModal() {
    if (!backdrop) build();
    renderPhone();
    backdrop.classList.add('open');
    document.body.classList.add('demo-lock');
  }
  function closeModal() {
    clearResend();
    stopRecap();
    backdrop.classList.remove('open');
    document.body.classList.remove('demo-lock');
  }
  function setBody(nodes) { body.innerHTML = ''; nodes.forEach(function (n) { if (n) body.appendChild(n); }); }
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
  function field(label, id, ph, type, val) {
    var input = h('input', { class: 'demo-input', id: id, type: type || 'text', placeholder: ph, value: val || '', autocomplete: id === 'demo-phone' ? 'tel' : (id === 'demo-email' ? 'email' : 'off') });
    var err = h('div', { class: 'demo-error', id: id + '-err', style: 'display:none' });
    return { wrap: h('div', { class: 'demo-field' }, [h('label', { class: 'demo-label', for: id, text: label }), input, err]), input: input, err: err };
  }
  function renderPhone(opts) {
    opts = opts || {};
    var phone = field('Phone number', 'demo-phone', '(555) 555-1212', 'tel', state.display);
    var biz = field('Business name', 'demo-business', 'John’s HVAC', 'text', state.business);
    var email = field('Email (optional)', 'demo-email', 'yourname@example.com', 'email', state.email);

    phone.input.addEventListener('input', function () {
      var pos = this.selectionStart, before = this.value;
      this.value = fmtPhone(this.value);
      if (before === state.display) {} // no-op keep
    });

    var disclosure = h('p', { class: 'demo-disclosure' }, [
      CONSENT_A,
      h('a', { href: '/privacy/', target: '_blank', rel: 'noopener' }, [CONSENT_LINK]),
      CONSENT_B
    ]);
    var btn = h('button', { class: 'demo-btn', type: 'button', text: 'Continue' });

    function showErr(f, msg) { f.err.textContent = msg; f.err.style.display = 'block'; f.input.setAttribute('aria-invalid', 'true'); }
    function clearErr(f) { f.err.style.display = 'none'; f.input.removeAttribute('aria-invalid'); }

    btn.addEventListener('click', function () {
      [phone, biz, email].forEach(clearErr);
      var ok = true;
      if (!validPhone(phone.input.value)) { showErr(phone, 'Enter a valid US phone number.'); ok = false; }
      if (!biz.input.value.trim()) { showErr(biz, 'Enter your business name.'); ok = false; }
      if (!ok) return;

      state.display = fmtPhone(phone.input.value);
      state.phone = e164(phone.input.value);
      state.business = biz.input.value.trim();
      state.email = email.input.value.trim();

      busy(btn, 'Sending…');
      apiPost('/api/demo/otp/send', {
        phone: state.phone, email: state.email,
        businessName: state.business, consentText: CONSENT_TEXT
      }).then(function (r) {
        if (r.ok) return renderCode();
        unbusy(btn, 'Continue');
        if (r.error === 'invalid_phone') showErr(phone, r.message || 'Enter a valid US phone number.');
        else if (r.error === 'demo_limit_reached') renderLimit();
        else if (r.error === 'rate_limited') showErr(phone, waitMsg(r) );
        else renderError();
      });
    });

    var limitMsg = opts.limit ? h('p', { class: 'demo-limitmsg' }, [
      'You’ve reached your demo limit. ',
      h('a', { class: 'demo-limitmsg__link', href: 'https://app.boltanswering.com/signup' }, ['Start a free trial today'])
    ]) : null;

    setBody([
      headingIcon('Have my assistant call me'),
      sub('We’ll send you a 6-digit one-time passcode before placing the call'),
      phone.wrap, biz.wrap, email.wrap,
      limitMsg,
      btn, disclosure, helpLine()
    ]);
    setTimeout(function () { phone.input.focus(); }, 30);
  }

  function waitMsg(r) {
    var s = r.data && (r.data.retryAfter || r.data.seconds || r.data.retry_after);
    return 'Please wait ' + (s ? s + ' seconds' : 'a moment') + ' and try again.';
  }

  // ---------- screen: code entry ----------
  function renderCode(opts) {
    opts = opts || {};
    var boxes = [];
    var codeWrap = h('div', { class: 'demo-code' + (opts.error ? ' err' : '') });
    for (var i = 0; i < 6; i++) {
      var inp = h('input', { type: 'text', inputmode: 'numeric', maxlength: '1', 'aria-label': 'Digit ' + (i + 1) });
      if (opts.locked) inp.disabled = true;
      boxes.push(inp); codeWrap.appendChild(inp);
    }
    function code() { return boxes.map(function (b) { return b.value; }).join(''); }
    function focusFirstEmpty() { for (var j = 0; j < 6; j++) { if (!boxes[j].value) { boxes[j].focus(); return; } } boxes[5].focus(); }

    boxes.forEach(function (b, idx) {
      b.addEventListener('input', function () {
        this.value = this.value.replace(/\D/g, '').slice(0, 1);
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
        if (r.ok) return placeCall();
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
    apiPost('/api/demo/otp/send', {
      phone: state.phone, email: state.email,
      businessName: state.business, consentText: CONSENT_TEXT
    }).then(function (r) {
      if (r.ok) return renderCode({ resendSecs: 60 });
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
  function placeCall() {
    setBody([
      h('div', { class: 'demo-ring' }, [svg('<path d="M5 4h4l2 5-3 2a11 11 0 005 5l2-3 5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>')]),
      heading('Placing your call…'),
      sub('Hang tight — your phone should ring in a few seconds.')
    ]);
    apiPost('/api/demo/token', {
      phone: state.phone, trade: TRADE, voice: VOICE,
      businessName: state.business, locale: 'en', source: 'marketing'
    }).then(function (r) {
      if (!r.ok) {
        if (r.error === 'phone_not_verified') return renderCode({ error: 'That code has expired. Request a new code.', locked: true });
        if (r.error === 'demo_limit_reached') return renderLimit();
        return renderCallFailed();
      }
      return apiPost('/api/demo/call', { token: r.data.token }).then(function (c) {
        if (c.ok) {
          renderInCall();
          var callId = c.data && c.data.callId;
          if (callId) pollRecap(callId);
          return;
        }
        if (c.error === 'demo_limit_reached') return renderLimit();
        return renderCallFailed();
      });
    });
  }

  // ---------- screen: in-call (call placed, ringing) — Figma 2370:8769 ----------
  function renderInCall() {
    clearResend();
    setBody([
      h('div', { class: 'demo-incall' }, [
        h('div', { class: 'demo-incall__head' }, [
          assistIcon(),
          h('p', { class: 'demo-incall__title', text: 'That worked! Calling you now...' })
        ]),
        h('p', { class: 'demo-incall__expect', text: 'What to expect:' }),
        h('ol', { class: 'demo-incall__list' }, [
          h('li', {}, ['The assistant will introduce herself']),
          h('li', {}, ['You describe any job. Make something up.']),
          h('li', {}, ['The assistant will try to find you an opening or just flag your urgent request to the tech.']),
          h('li', {}, ['Easy'])
        ])
      ])
    ]);
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
    var started = Date.now();
    var url = API + '/api/demo/recap/' + encodeURIComponent(callId);
    (function tick() {
      fetch(url, { headers: { 'Accept': 'application/json' } })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (d) {
          // Bail if the user closed the modal or moved to another screen.
          if (!backdrop || !backdrop.classList.contains('open')) { stopRecap(); return; }
          if (d && d.status === 'failed') { stopRecap(); return renderCallFailed(); }
          if (d && d.status === 'completed') {
            if (normTurns(d.transcript).length > 0) { stopRecap(); return renderRecap(d); }
            // Completed, but the transcript isn't back yet (the server is still
            // pulling it from Telnyx). Switch to the recap now, keep polling.
            if (!recapShown) { recapShown = true; renderRecap(d); }
            if (Date.now() - started > 240000) { stopRecap(); return renderRecap(d, { transcriptUnavailable: true }); }
            recapTimer = setTimeout(tick, 3000);
            return;
          }
          // pending / in_call — keep waiting for the call to end.
          if (Date.now() - started > 240000) { stopRecap(); return; } // give up quietly, leave the in-call screen up
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
    opts = opts || {};
    var turns = normTurns(d && d.transcript);

    var box = h('div', { class: 'demo-transcript' });
    if (!turns.length) {
      box.appendChild(h('p', { class: 'demo-transcript__empty', text: opts.transcriptUnavailable ? 'Transcript unavailable.' : 'Your call transcript will appear here in a moment.' }));
    } else {
      turns.forEach(function (t) {
        box.appendChild(h('div', { class: 'demo-turn' + (t.assistant ? '' : ' demo-turn--caller') }, [
          h('span', { class: 'demo-turn__icon' }, [
            h('img', { src: t.assistant ? 'assets/demo-icon-assistant.svg' : 'assets/demo-icon-caller.svg', alt: '' })
          ]),
          h('div', { class: 'demo-turn__text' }, [
            h('b', { text: t.label }),
            document.createTextNode(': ' + t.text)
          ])
        ]));
      });
    }

    var cta = h('a', {
      class: 'demo-btn demo-btn--yellow',
      href: 'https://app.boltanswering.com/signup',
      style: 'display:flex;align-items:center;justify-content:center;text-decoration:none;max-width:280px;margin:0 auto'
    }, ['Start my free trial now']);

    setBody([
      h('div', { class: 'demo-recap' }, [
        h('h2', { class: 'demo-recap-title', text: 'NEVER MISS A JOB AGAIN' }),
        h('p', { class: 'demo-recap-sub' }, [
          'Your assistant will always catch every detail to make sure you never miss a beat. ',
          h('span', { class: 'hl', text: 'Here’s the transcript:' })
        ]),
        box,
        h('div', { class: 'demo-nomore' }, [
          h('div', { class: 'demo-nomore__list' }, [
            h('p', {}, [h('span', { class: 'demo-nomore__more', text: 'No more' }), h('span', { class: 'hl', text: 'missed jobs' })]),
            h('p', {}, [h('span', { class: 'demo-nomore__more', text: 'No more' }), h('span', { class: 'hl', text: 'missed leads' })]),
            h('p', {}, [h('span', { class: 'demo-nomore__more', text: 'No more' }), h('span', { class: 'hl', text: 'hassle when you can’t answer' })])
          ]),
          h('img', { class: 'demo-nomore__money', src: 'assets/demo-money.svg', alt: '' })
        ]),
        h('p', { class: 'demo-recap-value' }, [
          'You’ll start Bolt for FREE today, but remember a receptionist this good ',
          h('span', { class: 'hl', text: 'costs thousands' }),
          ' and our 24/7 assistants do more for ',
          h('span', { class: 'hl', text: 'less than $4 a day.' })
        ]),
        h('div', { class: 'demo-recap-cta' }, [
          h('span', { class: 'demo-recap-cta__arrows demo-recap-cta__arrows--l' }, [
            h('img', { src: 'assets/demo-arrow2.svg', alt: '' }),
            h('img', { src: 'assets/demo-arrow3.svg', alt: '' })
          ]),
          cta,
          h('span', { class: 'demo-recap-cta__arrows demo-recap-cta__arrows--r' }, [
            h('img', { src: 'assets/demo-arrow1.svg', alt: '' }),
            h('img', { src: 'assets/demo-arrow4.svg', alt: '' })
          ])
        ]),
        helpLine()
      ])
    ]);
  }

  // ---------- screen: call didn't complete ----------
  function renderCallFailed() {
    var btn = h('button', { class: 'demo-btn', type: 'button', text: 'Call me again' });
    btn.addEventListener('click', function () { placeCall(); });
    setBody([
      heading('Didn’t catch you that time. Let’s try again.'),
      sub('Make sure your phone isn’t blocking calls.'),
      btn
    ]);
  }

  // ---------- demo limit reached — inline on the phone form (Figma 2370:8877) ----------
  function renderLimit() {
    clearResend();
    renderPhone({ limit: true });
  }

  // ---------- screen: something went wrong ----------
  function renderError() {
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
        b.addEventListener('click', function (e) { e.preventDefault(); openModal(); });
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
