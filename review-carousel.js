/* AFMBP-2265 / 2310 — the Reviews cards start when the section is on screen: the first one is
   Gus's, so his card is what a visitor arriving at the section sees. Until then every card waits
   at its first frame (review-carousel.css); once started they keep running. */
(function () {
  var sec = document.getElementById('reviews');
  if (!sec) return;
  var start = function () { sec.classList.add('reviews--on'); };
  if (!('IntersectionObserver' in window)) { start(); return; }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { start(); io.disconnect(); }
    });
  }, { threshold: 0.5 });
  io.observe(sec);
})();
