/* Text reveal animations for home + trade pages.
   - Hero: subtle opacity fade on load; per-element delays via data-rd.
   - Lower [data-reveal] sections: fade header -> subtitle -> body on scroll,
     staggered in DOM order (120ms steps). Fails open (never leaves text hidden). */
(function () {
  try {
    // Start reloads at the top so the on-scroll reveals actually play.
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;
    var revealAll = function () {
      document.querySelectorAll('.rv').forEach(function (el) { el.classList.add('rv--in'); });
    };
    if (reduce) { revealAll(); return; }

    // Hero — fade in on load.
    var heroItems = document.querySelectorAll('.hero .rv, .tphero .rv');
    heroItems.forEach(function (el) { el.style.transitionDelay = (el.dataset.rd || 0) + 'ms'; });
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        heroItems.forEach(function (el) { el.classList.add('rv--in'); });
      });
    });

    // Lower sections — reveal (header -> subtitle -> body) once the section's top
    // has scrolled into the lower part of the viewport. Uses a live rect check so
    // it's correct regardless of when images finish laying out.
    var pending = [].slice.call(document.querySelectorAll('[data-reveal]'));
    var revealSection = function (sec) {
      sec.querySelectorAll('.rv').forEach(function (el, i) {
        el.style.transitionDelay = (el.dataset.rd != null ? el.dataset.rd : i * 120) + 'ms';
        el.classList.add('rv--in');
      });
    };
    var check = function () {
      var trigger = window.innerHeight * 0.85;
      pending = pending.filter(function (sec) {
        if (sec.getBoundingClientRect().top < trigger) { revealSection(sec); return false; }
        return true;
      });
    };
    // Don't touch sections until the layout is final. Scroll/resize fire while
    // images are still loading and the page is momentarily short — running check()
    // then would see below-fold sections near the top and reveal them early. Wait
    // for 'load' (images done) + a double-rAF (layout flushed), THEN do the first
    // check and start listening for real scrolls.
    var arm = function () {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          check();
          window.addEventListener('scroll', check, { passive: true });
          window.addEventListener('resize', check);
        });
      });
    };
    if (document.readyState === 'complete') arm();
    else window.addEventListener('load', arm);

    // Safety net: reveal anything still hidden after 6s.
    setTimeout(revealAll, 6000);
  } catch (e) {
    document.querySelectorAll('.rv').forEach(function (el) { el.classList.add('rv--in'); });
  }
})();
