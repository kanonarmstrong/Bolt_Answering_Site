/* ============================================================
   Footer "Subscribe" — wires the pre-footer email form to the
   Bolt backend (AFMBP-1887): POST /api/public/subscribe, which
   adds the address to a Resend audience, sends a welcome email,
   and signals subscriber enrichment. Progressive enhancement:
   the form keeps its onsubmit="return false" no-JS guard, and
   this listener does the real work when JS is available.
   ============================================================ */
(function () {
  'use strict';
  var API = 'https://bolt-staging.fly.dev';
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function wire(form) {
    if (form.__subWired) return;
    form.__subWired = true;
    var input = form.querySelector('input[type="email"]') || form.querySelector('input');
    var btn = form.querySelector('button[type="submit"], .subscribe__btn');
    if (!input) return;

    // Status line inserted right after the form (inside the .subscribe section).
    var msg = document.createElement('p');
    msg.className = 'subscribe__msg';
    msg.setAttribute('role', 'status');
    msg.setAttribute('aria-live', 'polite');
    msg.style.display = 'none';
    if (form.parentNode) form.parentNode.insertBefore(msg, form.nextSibling);

    function show(text, ok) {
      msg.textContent = text;
      msg.className = 'subscribe__msg ' + (ok ? 'is-ok' : 'is-err');
      msg.style.display = 'block';
      input.setAttribute('aria-invalid', ok ? 'false' : 'true');
    }
    function clearMsg() {
      msg.style.display = 'none';
      msg.textContent = '';
      input.removeAttribute('aria-invalid');
    }
    input.addEventListener('input', clearMsg);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = (input.value || '').trim();
      if (!EMAIL_RE.test(email)) {
        show('Enter a valid email address.', false);
        input.focus();
        return;
      }
      if (btn) btn.disabled = true;
      fetch(API + '/api/public/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, source: location.pathname })
      })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (d) {
            return { status: r.status, ok: r.ok, data: d };
          });
        })
        .then(function (res) {
          if (btn) btn.disabled = false;
          if (res.ok) {
            show('Thanks — you’re subscribed!', true);
            input.value = '';
          } else if (res.status === 429) {
            show('Please wait a moment and try again.', false);
          } else if (res.status === 400) {
            show((res.data && res.data.message) || 'Enter a valid email address.', false);
          } else {
            show('Something went wrong. Please try again.', false);
          }
        })
        .catch(function () {
          if (btn) btn.disabled = false;
          show('Network error. Please try again.', false);
        });
    });
  }

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll('.subscribe__form'), wire);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
