/* Bolt blog: mobile menu, categories dropdown, and search. Replaces the template's
   jQuery script. Pages work fully without this file; it only adds convenience. */
(function () {
  'use strict';
  var html = document.documentElement;

  /* Mobile menu */
  var navBtn = document.querySelector('.button-nav');
  var nav = document.querySelector('.header_nav');
  var overlay = document.querySelector('.navoverlay');
  function setNav(open) {
    if (!nav || !navBtn) return;
    nav.classList.toggle('opened', open);
    navBtn.classList.toggle('active', open);
    if (overlay) overlay.classList.toggle('active', open);
    html.classList.toggle('noscroll-tablet', open);
    navBtn.setAttribute('aria-expanded', String(open));
    navBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }
  if (navBtn) navBtn.addEventListener('click', function () { setNav(!nav.classList.contains('opened')); });
  if (overlay) overlay.addEventListener('click', function () { setNav(false); });

  /* Categories dropdown */
  var catBtn = document.querySelector('.header_categ_opener');
  var catDrop = document.querySelector('.header_categ_drop');
  function setCat(open) {
    if (!catBtn || !catDrop) return;
    catDrop.classList.toggle('opened', open);
    catBtn.classList.toggle('active', open);
    catBtn.setAttribute('aria-expanded', String(open));
  }
  if (catBtn) catBtn.addEventListener('click', function (e) { e.stopPropagation(); setCat(!catDrop.classList.contains('opened')); });
  document.addEventListener('click', function (e) { if (catDrop && !e.target.closest('.header_categ')) setCat(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { setNav(false); setCat(false); } });

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
