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

// Ensure the "Why ___ pros trust Bolt" word-switcher video autoplays on load
(function () {
  var v = document.querySelector('.switcher-video');
  if (!v) return;
  v.muted = true;               // required for programmatic autoplay
  var tryPlay = function () {
    var p = v.play();
    if (p && p.catch) p.catch(function () {});
  };
  if (document.readyState === 'complete') tryPlay();
  else window.addEventListener('load', tryPlay);
  // retry once the element is actually on screen (helps Safari/iOS)
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) tryPlay(); });
    });
    io.observe(v);
  }
})();

// Hero background confetti video — autoplay on load, loop restarting at the 1s mark
(function () {
  var v = document.querySelector('.hero__video');
  if (!v) return;
  var LOOP_START = 1; // seconds
  v.muted = true;
  v.removeAttribute('loop'); // we loop manually from LOOP_START

  var play = function () {
    var p = v.play();
    if (p && p.catch) p.catch(function () {});
  };
  var seekStart = function () {
    try { if (v.currentTime < LOOP_START) v.currentTime = LOOP_START; } catch (e) {}
    play();
  };

  if (v.readyState >= 1) seekStart();
  else v.addEventListener('loadedmetadata', seekStart);
  window.addEventListener('load', play);

  // loop back to the 1s mark instead of 0
  v.addEventListener('ended', function () {
    try { v.currentTime = LOOP_START; } catch (e) {}
    play();
  });
  // loop well before the true end so it never wraps to 0
  v.addEventListener('timeupdate', function () {
    if (v.duration && v.currentTime >= v.duration - 0.2) {
      try { v.currentTime = LOOP_START; } catch (e) {}
      play();
    }
  });
})();
