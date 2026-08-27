// Bolt marketing site — interactions

// Mobile nav toggle
(function () {
  var toggle = document.getElementById('navToggle');
  var menu = document.getElementById('navMenu');
  if (!toggle || !menu) return;

  toggle.addEventListener('click', function () {
    var open = menu.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  // Close menu when a real link is tapped (ignore the Trades dropdown trigger).
  // Also collapse the Trades submenu so tapping any other link (Home, Support…)
  // doesn't leave it expanded.
  menu.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () {
      if (a.classList.contains('nav__dropdown-trigger')) return;
      menu.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      var dd = menu.querySelector('.nav__dropdown.open');
      if (dd) dd.classList.remove('open');
    });
  });
})();

// Mobile Trades accordion — tap to expand/collapse (desktop keeps hover)
(function () {
  var trigger = document.querySelector('.nav__dropdown-trigger');
  if (!trigger) return;
  var dropdown = trigger.closest('.nav__dropdown');
  trigger.addEventListener('click', function (e) {
    if (window.matchMedia('(max-width: 768px)').matches) {
      e.preventDefault();
      dropdown.classList.toggle('open');
    }
  });
  // collapse it whenever the hamburger menu closes
  var toggle = document.getElementById('navToggle');
  if (toggle) toggle.addEventListener('click', function () {
    if (!document.getElementById('navMenu').classList.contains('open')) {
      dropdown.classList.remove('open');
    }
  });
})();

// Floating CTA (mobile): starts just below the header, falls to its
// bottom-right resting spot once the user scrolls.
(function () {
  var cta = document.querySelector('.floating-cta');
  if (!cta) return;
  var THRESHOLD = 24; // px scrolled before it drops
  var down = null;
  var update = function () {
    var d = (window.scrollY || window.pageYOffset) > THRESHOLD;
    if (d !== down) {
      down = d;
      cta.classList.toggle('cta-down', d);
    }
  };
  update();
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
})();

// Hero confetti video — nudge muted autoplay (some browsers/panes don't auto-start)
(function () {
  var v = document.querySelector('video.hero__video');
  if (!v) return;
  v.muted = true;
  var play = function () { var p = v.play(); if (p && p.catch) p.catch(function () {}); };
  if (document.readyState === 'complete') play();
  else window.addEventListener('load', play);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) play(); });
    }).observe(v);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) play(); });
})();

// Tapping a link to the page you're already on scrolls to the top
// (instead of a no-op or a reload).
(function () {
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#') return; // pure-hash links: let the browser handle
    var url;
    try { url = new URL(a.href, location.href); } catch (err) { return; }
    if (url.host !== location.host || url.pathname !== location.pathname) return; // different page
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (history.replaceState) history.replaceState(null, '', url.pathname); // drop any stale #hash
    var menu = document.getElementById('navMenu');
    var toggle = document.getElementById('navToggle');
    if (menu) menu.classList.remove('open');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
    var dd = document.querySelector('.nav__dropdown.open');
    if (dd) dd.classList.remove('open');
  });
})();
