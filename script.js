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

// Same-page navigation. Tapping a link that points at the current page —
// an in-page anchor (#top, #how, #pricing) OR a full path to the page you're
// already on — smooth-scrolls there instead of a no-op/reload. In-page anchors
// are offset by the sticky header height so the target sits BELOW the menu bar
// (not hidden behind it). Also closes the mobile menu + Trades submenu.
// Handling anchors in JS (not native) also fixes the "tap Home again after
// scrolling does nothing" bug — a repeat #top does nothing natively because the
// URL hash is unchanged, but here we always scroll.
(function () {
  var GAP = 12; // breathing room below the sticky bar
  function headerH() {
    var h = document.querySelector('.nav');
    return h ? Math.round(h.getBoundingClientRect().height) : 76;
  }
  function norm(p) { return p.replace(/\/index\.html$/, '/').replace(/(.)\/+$/, '$1'); }
  function closeMenu() {
    var menu = document.getElementById('navMenu');
    var toggle = document.getElementById('navToggle');
    if (menu) menu.classList.remove('open');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
    var dd = document.querySelector('.nav__dropdown.open');
    if (dd) dd.classList.remove('open');
  }
  function toTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function toEl(el) {
    var y = el.getBoundingClientRect().top +
      (window.pageYOffset || document.documentElement.scrollTop) - headerH() - GAP;
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href) return;

    // In-page anchor (#top, #how, #pricing …)
    if (href.charAt(0) === '#') {
      var id = href.slice(1);
      if (!id) return; // bare "#": placeholder / Trades trigger — leave to its own handler
      e.preventDefault();
      if (id === 'top') { toTop(); }
      else { var el = document.getElementById(id); el ? toEl(el) : toTop(); }
      if (history.replaceState) history.replaceState(null, '', id === 'top' ? location.pathname : '#' + id);
      closeMenu();
      return;
    }

    // Full-path link to the page we're already on
    var url;
    try { url = new URL(a.href, location.href); } catch (err) { return; }
    if (url.host !== location.host || norm(url.pathname) !== norm(location.pathname)) return; // different page
    e.preventDefault();
    toTop();
    if (history.replaceState) history.replaceState(null, '', url.pathname); // drop any stale #hash
    closeMenu();
  });
})();
