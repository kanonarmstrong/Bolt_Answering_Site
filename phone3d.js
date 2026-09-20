/* Interactive 3D phone (plumber feature section). Vanilla port of a Framer
   code component:
     - yaw (Y-axis rotation) is mapped to the section's scroll progress
       (offset start-end -> end-start, i.e. -maxYaw at entry to +maxYaw at exit,
       facing forward when the section is centered),
     - drag left/right adds a yaw offset that springs back on release,
     - a rAF lerp smooths both (stands in for the framer-motion springs),
     - prefers-reduced-motion clamps to a tiny tilt and disables dragging.
   Desktop feature only; the loop is gated to when the section is near view. */
(function () {
  var el = document.querySelector('.phone3d');
  if (!el) return;
  var device = el.querySelector('.phone3d__device');
  var section = el.closest('.tpfeat') || el;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;

  var MAXYAW = 48, PITCH = 0, SENS = 0.25, LERP = 0.12;
  var dragYaw = 0, curYaw = 0, pid = -1, startX = 0, startY = 0, intent = false;

  function scrollYaw() {
    var r = section.getBoundingClientRect();
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var p = (vh - r.top) / (vh + r.height);      // 0 at entry, 1 at exit
    p = p < 0 ? 0 : p > 1 ? 1 : p;
    return (p * 2 - 1) * MAXYAW;                  // -MAXYAW .. +MAXYAW
  }
  function targetYaw() {
    var s = scrollYaw();
    if (reduce) return Math.max(-6, Math.min(s * 0.15, 6));
    var t = s + dragYaw;
    return t < -MAXYAW ? -MAXYAW : t > MAXYAW ? MAXYAW : t;
  }

  var running = false, raf = 0;
  function tick() {
    var t = targetYaw();
    curYaw += (t - curYaw) * LERP;
    if (Math.abs(t - curYaw) < 0.02) curYaw = t;
    device.style.transform = 'rotateY(' + curYaw.toFixed(2) + 'deg) rotateX(' + PITCH + 'deg)';
    raf = requestAnimationFrame(tick);
  }
  function start() { if (!running) { running = true; raf = requestAnimationFrame(tick); } }
  function stop() { if (running) { running = false; cancelAnimationFrame(raf); } }

  // Only spin the rAF loop while the section is near the viewport.
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      entries[0].isIntersecting ? start() : stop();
    }, { rootMargin: '25% 0px 25% 0px' }).observe(section);
  } else {
    start();
  }

  if (!reduce) {
    device.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pid = e.pointerId; startX = e.clientX; startY = e.clientY; intent = false;
    });
    device.addEventListener('pointermove', function (e) {
      if (e.pointerId !== pid) return;
      var dx = e.clientX - startX, dy = e.clientY - startY;
      if (!intent) {
        // Require a clear horizontal drag before capturing (lets vertical scroll through).
        if (!(Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2)) return;
        intent = true;
        el.classList.add('is-dragging');
        try { device.setPointerCapture(pid); } catch (x) {}
        start();
      }
      if (e.cancelable) e.preventDefault();
      var s = scrollYaw();
      var next = dx * SENS;
      dragYaw = Math.max(-MAXYAW - s, Math.min(next, MAXYAW - s));
    });
    var end = function (e) {
      if (e && e.pointerId !== pid) return;
      intent = false; pid = -1;
      el.classList.remove('is-dragging');
      dragYaw = 0;   // lerp springs the phone back to its scroll-mapped angle
      start();
    };
    device.addEventListener('pointerup', end);
    device.addEventListener('pointercancel', end);
    device.addEventListener('lostpointercapture', end);
  }
})();
