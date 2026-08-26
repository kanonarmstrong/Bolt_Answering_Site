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

  // Close menu when a real link is tapped (ignore the Trades dropdown trigger)
  menu.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () {
      if (a.classList.contains('nav__dropdown-trigger')) return;
      menu.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
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
