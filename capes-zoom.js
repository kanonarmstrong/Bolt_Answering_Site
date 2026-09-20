/* ============================================================
   TPCapes scroll-zoom — subtly scales ONLY the capes background
   image (a clipped .tpcapes__bg::before layer) from 1.0 to 1.2 as
   each section scrolls through the viewport. Scroll-position driven
   (reverses on scroll up, stops when scrolling stops). Compositor-
   friendly (transform: scale on a pseudo-element, no layout).
   Desktop/laptop/tablet only — mobile (<=768px) shows a baked image.
   Respects prefers-reduced-motion. Each section is independent.
   Browser -> window.CapesZoom + auto-init ; Node -> module.exports.
   ============================================================ */
(function (factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { window.CapesZoom = api; api.init(); }
})(function () {
  'use strict';

  var MAX = 0.2; // maximum 20% zoom -> scale(1.2)

  // Section scroll progress 0..1: 0 as the section top enters at the viewport
  // bottom, 1 as its bottom leaves the viewport top. Pure + unit-tested.
  function clampProgress(top, height, vh) {
    var denom = vh + height;
    if (denom <= 0) return 0;
    var p = (vh - top) / denom;
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }
  // Scale for a given progress, clamped so it never exceeds 1 + MAX (1.2).
  function scaleFor(progress) {
    var p = progress < 0 ? 0 : progress > 1 ? 1 : progress;
    return 1 + MAX * p;
  }

  function init() {
    if (typeof document === 'undefined') return;
    function ready(fn) {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
      else fn();
    }
    ready(function () {
      var sections = [].slice.call(document.querySelectorAll('.tpcapes'));
      if (!sections.length) return;

      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;
      var desktop = window.matchMedia && window.matchMedia('(min-width:769px)');

      function setScale(sec, s) { sec.style.setProperty('--cz', s.toFixed(4)); }
      function reset(sec) { sec.style.removeProperty('--cz'); } // -> default 1

      var active = [];      // sections currently near the viewport
      var raf = 0;
      function apply() {
        raf = 0;
        var vh = window.innerHeight || document.documentElement.clientHeight;
        for (var i = 0; i < active.length; i++) {
          var sec = active[i];
          var r = sec.getBoundingClientRect();
          setScale(sec, scaleFor(clampProgress(r.top, r.height, vh)));
        }
      }
      function schedule() { if (!raf) raf = requestAnimationFrame(apply); }

      var io = null, scrolling = false;
      function enable() {
        if (scrolling) return;
        scrolling = true;
        if ('IntersectionObserver' in window) {
          io = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
              var idx = active.indexOf(e.target);
              if (e.isIntersecting && idx === -1) active.push(e.target);
              else if (!e.isIntersecting && idx > -1) active.splice(idx, 1);
            });
            schedule();
          }, { rootMargin: '150px 0px 150px 0px' });
          sections.forEach(function (s) { io.observe(s); });
        } else {
          active = sections.slice();
        }
        window.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule, { passive: true });
        schedule(); // initial state (deep-link / refresh mid-page)
      }
      function disable() {
        if (!scrolling) return;
        scrolling = false;
        if (io) { io.disconnect(); io = null; }
        window.removeEventListener('scroll', schedule);
        window.removeEventListener('resize', schedule);
        active = [];
        sections.forEach(reset); // back to scale 1 (mobile / reduced motion)
      }

      // Off for reduced motion (CSS also forces transform:none) and on mobile,
      // where the section shows a baked composite image instead of this layer.
      function evaluate() {
        if (reduce || (desktop && !desktop.matches)) disable();
        else enable();
      }
      evaluate();
      if (desktop) {
        var onChange = evaluate;
        if (desktop.addEventListener) desktop.addEventListener('change', onChange);
        else if (desktop.addListener) desktop.addListener(onChange); // Safari <14
      }
    });
  }

  return { MAX: MAX, clampProgress: clampProgress, scaleFor: scaleFor, init: init };
});
