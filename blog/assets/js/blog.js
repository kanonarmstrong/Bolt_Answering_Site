/* Bolt blog search (live results under the masthead search field, and /blog/search/), plus
   keeping the site's floating "Get started now" button (phones) off the search field. The
   header menu is the site's own script.js. Pages work fully without this file. */
(function () {
  'use strict';
  /* Search over /blog/search-index.json */
  var indexPromise = null;
  function loadIndex() {
    if (!indexPromise) indexPromise = fetch('/blog/search-index.json').then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; });
    return indexPromise;
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function terms(q) { return q.toLowerCase().split(/\s+/).filter(function (t) { return t.length > 1; }); }
  function search(index, q) {
    var ts = terms(q);
    if (!ts.length) return [];
    return index.map(function (p) {
      var t = p.t.toLowerCase(), d = (p.d || '').toLowerCase(), c = (p.c || '').toLowerCase(), x = (p.x || '').toLowerCase();
      var score = 0;
      for (var i = 0; i < ts.length; i++) {
        var w = ts[i], s = 0;
        if (t.indexOf(w) > -1) s += 5;
        if (d.indexOf(w) > -1) s += 3;
        if (c.indexOf(w) > -1) s += 2;
        if (x.indexOf(w) > -1) s += 1;
        if (!s) return null; // every word must appear somewhere
        score += s;
      }
      return { p: p, score: score };
    }).filter(Boolean).sort(function (a, b) { return b.score - a.score; }).map(function (r) { return r.p; });
  }
  function render(list, q, limit) {
    if (!list.length) return '<p>No posts match “' + esc(q) + '”.</p>';
    return '<ul>' + list.slice(0, limit).map(function (p) {
      return '<li><a href="' + esc(p.u) + '">' + esc(p.t) + '</a><p>' + esc(p.d || '') + '</p></li>';
    }).join('') + '</ul>';
  }

  var form = document.querySelector('.js-search');
  var input = form && form.querySelector('input[name="q"]');
  var live = document.querySelector('.search_results');
  var pageResults = document.querySelector('.search_page_results');
  var timer;
  if (input && live && !pageResults) {
    input.addEventListener('input', function () {
      clearTimeout(timer);
      var q = input.value.trim();
      timer = setTimeout(function () {
        if (q.length < 2) { live.hidden = true; live.innerHTML = ''; return; }
        loadIndex().then(function (index) { live.innerHTML = render(search(index, q), q, 5); live.hidden = false; });
      }, 150);
    });
  }
  if (pageResults) {
    var q = new URLSearchParams(location.search).get('q') || '';
    if (input) input.value = q;
    var empty = document.querySelector('.js-search-empty');
    if (q.trim()) {
      if (empty) empty.hidden = true;
      loadIndex().then(function (index) {
        var res = search(index, q);
        pageResults.innerHTML = '<p>' + res.length + ' result' + (res.length === 1 ? '' : 's') + ' for “' + esc(q) + '”</p>' + render(res, q, 50);
      });
    }
  }
})();

/* Phones: the floating "Get started now" button (site script.js) is fixed to the viewport, the
   search field scrolls with the page. Hide the button whenever the two would overlap, and while
   the field is being typed in, so it never sits on the search. Uses the site's .cta-hide. */
(function () {
  'use strict';
  var cta = document.querySelector('.floating-cta');
  var field = document.querySelector('.msearch');
  if (!cta || !field) return;
  var focused = false;
  function overlaps(a, b) { return a.width && b.width && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; }
  function update() {
    var hide = focused || overlaps(cta.getBoundingClientRect(), field.getBoundingClientRect());
    cta.classList.toggle('cta-hide', hide);
  }
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', update);
  cta.addEventListener('transitionend', update);
  field.addEventListener('focusin', function () { focused = true; update(); });
  field.addEventListener('focusout', function () { focused = false; update(); });
  update();
})();
