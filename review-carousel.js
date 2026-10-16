/* AFMBP-2265 — the Reviews carousel starts when the section is on screen: its first frame is a
   stop with Gus's card, so that card is what a visitor arriving at the section sees, and each
   later card comes with the middle row's next stop. Until then everything waits at its first
   frame (review-carousel.css); once started it keeps running. */
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
