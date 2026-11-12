// AFMBP-2567 — builds the card-only ad landing pages, start/<trade>.html, from one template.
// The pages are the trade pages' sign-up card (demo.css, AFMBP-2273) on a page of its own, laid out
// per Figma 2142:11370. Edit the template here, then run from the site root:
//   node tools/quick-landing-build.mjs && node tools/quick-landing-check.mjs
// The Google tag block is copied from handyman.html, so a change there reaches these pages on the
// next build.
import { readFileSync, writeFileSync } from 'node:fs';
const src = readFileSync('handyman.html', 'utf8');
const g0 = src.indexOf('  <!-- Google tag (gtag.js)');
const g1 = src.indexOf('</script>', g0) + '</script>'.length;
const GTAG = src.slice(g0, g1);
if (g0 < 0 || !GTAG.includes('G-8C8SFMCRYH')) throw new Error('gtag block not found');
// The deferred site scripts, at the versions the trade pages load now (a version bump there
// reaches these pages on the next build).
const tag = (name) => {
  const m = src.match(new RegExp(`<script defer src="/${name}\\.js\\?v=\\d+"></script>`));
  if (!m) throw new Error(`${name}.js tag not found in handyman.html`);
  return m[0];
};
const SCRIPTS = { attribution: tag('attribution'), pixel: tag('meta-pixel'), privacy: tag('privacy-choices'), sentry: tag('sentry-init') };
const TRADES = [
  { slug: 'handyman', trade: 'handyman', title: 'Bolt Answering for Handymen — Never miss a job again' },
  { slug: 'plumbing', trade: 'plumbing', title: 'Bolt Answering for Plumbers — Never miss a job again' },
  { slug: 'general-contractor', trade: 'general_contracting', title: 'Bolt Answering for General Contractors — Never miss a job again' },
];
const page = ({ slug, trade, title }) => `<!DOCTYPE html>
<html lang="en">
<head>
${GTAG}
  <!-- Funnel attribution + events, Bolt's own analytics (AFMBP-1968) -->
  ${SCRIPTS.attribution}
  ${SCRIPTS.pixel}
  ${SCRIPTS.privacy}
  <!-- JavaScript error reports (Sentry), behind one switch in sentry-init.js (AFMBP-2130) -->
  ${SCRIPTS.sentry}
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <!-- AFMBP-2567: an ad landing page (the sign-up card on its own, Figma 2142:11370), not a page for search. -->
  <meta name="robots" content="noindex" />
  <link rel="canonical" href="https://www.boltanswering.com/start/${slug}.html" />
  <meta name="application-name" content="Bolt Answering" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Bolt Answering" />
  <meta property="og:title" content="${title}" />
  <meta property="og:url" content="https://www.boltanswering.com/start/${slug}.html" />
  <meta property="og:image" content="https://www.boltanswering.com/assets/logo.png" />
  <meta property="og:image:width" content="1024" />
  <meta property="og:image:height" content="1024" />
  <meta property="og:image:alt" content="Bolt Answering logo" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${title}" />
  <!-- The app's sign-up page is the next stop: open its connections now (AFMBP-2564). The plain one
       serves the tap's navigation and the prefetches; the crossorigin one the preload list's fetch. -->
  <link rel="preconnect" href="https://app.boltanswering.com" />
  <link rel="preconnect" href="https://app.boltanswering.com" crossorigin />
  <!-- The card's art carries the headline, so it is the page's largest paint. -->
  <link rel="preload" as="image" href="/assets/demo-so-card.webp" fetchpriority="high" />
  <link rel="preload" as="font" type="font/woff2" href="/assets/fonts/inter.woff2" crossorigin />
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png" />
  <link rel="icon" type="image/png" href="/assets/favicon.png" />
  <style>
    /* AFMBP-2567 — the card-only ad landing page (Figma 2142:11370, "Quick landing page").
       The sign-up offer card of demo.css (AFMBP-2273, "New jobs are calling") on a page of its
       own: no trade page behind it, no demo.js, every style inline so the card paints with the
       first bytes. The card's numbers are demo.css's (matched to the card's node there); the
       page around it is the node's: #f8fbfe under a 30% black screen shade (2142:11453), the
       navy bolt wordmark (2142:11451, 70.667x29.333) 10px below the top and 26.3px from the
       left, and the card 70px below the top, 1.5px left of centre. */
    @font-face{
      font-family:'Inter';font-style:normal;font-weight:100 900;font-display:swap;
      src:url('/assets/fonts/inter.woff2') format('woff2');
      unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;
    }
    /* Times New Roman as the node sets it; phones without it (Android) get Tinos, the same widths. */
    @font-face{
      font-family:'Tinos';font-style:normal;font-weight:400;font-display:swap;
      src:url('/assets/fonts/tinos-400.woff2') format('woff2');
      unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;
    }
    @font-face{
      font-family:'Tinos';font-style:normal;font-weight:700;font-display:swap;
      src:url('/assets/fonts/tinos-700.woff2') format('woff2');
      unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;
    }
    :root{--blue:#2b7ffd;--navy:#180a53}
    html,body{margin:0;padding:0}
    body{
      min-height:100vh;
      background:linear-gradient(rgba(0,0,0,.3),rgba(0,0,0,.3)) fixed,#f8fbfe;
      font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
      -webkit-text-size-adjust:100%;text-size-adjust:100%;
    }
    .ql{position:relative;display:flex;justify-content:center;align-items:flex-start;padding:70px 0 40px}
    .ql-logo{position:absolute;left:26.333px;top:10px;width:70.667px;height:29.333px;display:block}
    .ql-card{
      position:relative;left:-1.5px;flex:none;width:337px;height:629px;
      background:#f0e0d5 url('/assets/demo-so-card.webp') center/cover no-repeat;
      border-radius:10.796px;box-shadow:inset 0 0 0 .6px rgba(0,0,0,.18);
      overflow:hidden;overflow:clip;
    }
    @media (max-width:336px){ .ql-card{zoom:.94;left:0} }
    @media (max-width:316px){ .ql-card{zoom:.83} }
    .ql-body{position:relative;z-index:1;left:.6px;top:.6px;width:337px;height:629px}
    /* The close: the node's 13px cross in a 44px tap target. It goes to the home page (owner, 11-12). */
    .ql-close{
      position:absolute;z-index:2;left:283.496px;top:9.497px;width:44px;height:44px;
      display:flex;align-items:center;justify-content:center;
    }
    .ql-close::before{
      content:"";width:12.992px;height:12.993px;pointer-events:none;
      background:url('/assets/demo-m-close.svg') center/100% 100% no-repeat;
    }
    .ql-close:focus-visible,.ql-cta:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
    /* The headline is in the art, and the wordmark is drawn; their words are for screen readers. */
    .ql-vh{
      position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;
      overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;
    }
    .ql-sub,.ql-free{
      position:absolute;margin:0;font-family:'Times New Roman',Tinos,serif;font-size:19.032px;font-weight:400;
      line-height:22px;color:#000;
    }
    .ql-sub{left:28.4px;top:220.11px;width:273px;text-align:left}
    .ql-big{font-size:20.03px;line-height:23px}
    .ql-bolt{display:inline-block;width:80.886px;height:0;vertical-align:baseline}
    .ql-sub::before{
      content:"";position:absolute;left:2.4px;top:-9.81px;width:73.5px;height:30.7px;pointer-events:none;
      background:url('/assets/demo-so-bolt.svg') 0 0/100% 100% no-repeat;
    }
    .ql-free{left:31.4px;top:340.465px;width:266px;text-align:center}
    .ql-free b{font-weight:700}
    .ql-cm::after{
      content:"";position:absolute;left:27.4px;top:334.4px;width:274px;height:59px;box-sizing:border-box;
      border:2px solid #000;pointer-events:none;
    }
    /* The button sits where 2142:11370 puts it (2142:11445): centred under the FREE box, 38.4/411.4 on
       the body. The trade pages' card has it 5px right and 1px lower (the older node 2718:3350). */
    .ql-cta{
      position:absolute;left:38.4px;top:411.4px;width:252px;height:49px;margin:0;padding:1.33px 0 0;box-sizing:border-box;
      border-radius:6px;background:var(--blue);color:#fff;
      box-shadow:0 1px 2px 0 rgba(0,0,0,.3),0 2px 6px 0 rgba(0,0,0,.15);
      display:flex;align-items:center;justify-content:center;
      font-family:inherit;font-size:22px;font-weight:700;line-height:21px;text-decoration:none;
      transition:background .15s;
    }
    .ql-cta:hover{background:#1f6fe6}
    /* The rating sits 1px left of the trade pages' card, where 2142:11419 puts it. */
    .ql-cr{
      position:absolute;left:30.4px;top:478.343px;width:278.886px;height:114.825px;
      transform:rotate(3.168deg);transform-origin:0 0;
    }
    .ql-bubble{
      position:absolute;left:-7.538px;top:-5.649px;width:293.961px;height:129.9px;pointer-events:none;
      background:url('/assets/demo-so-bubble-v5.svg') 0 0/100% 100% no-repeat;
    }
    .ql-who{
      position:absolute;left:22.331px;top:13.72px;width:108.495px;height:13.288px;margin:0;
      font-size:11.306px;font-weight:400;line-height:13.288px;color:var(--navy);text-align:left;white-space:nowrap;
    }
    .ql-who b{font-size:13.399px;font-weight:700}
    .ql-stars,.ql-score{transform:rotate(-.148deg);transform-origin:0 0}
    .ql-stars{position:absolute;left:139.03px;top:10.476px;display:flex}
    .ql-stars span{
      width:16.972px;height:17.898px;background:url('/assets/demo-m-star-lg.svg') .416px 0/16.141px 16.189px no-repeat;
    }
    .ql-score{
      position:absolute;left:225.201px;top:14.084px;width:35.437px;height:13.288px;margin:0;
      font-size:13.399px;font-weight:700;line-height:13.288px;color:var(--navy);text-align:center;white-space:nowrap;
    }
    .ql-quote{
      position:absolute;left:14.113px;top:34.3px;width:250.62px;margin:0;
      font-size:12.248px;font-style:italic;font-weight:400;line-height:15px;color:var(--navy);text-align:center;
    }
  </style>
</head>
<body>
  <!-- The section's first class is the tap's placement (attribution.js placement()): "signup_offer",
       as the card logs it on the trade pages, so Meta's StartTrialClick reads the same. -->
  <main class="ql">
    <img class="ql-logo" src="/assets/bolt-logo-small.svg" width="71" height="29" alt="Bolt Answering" />
    <section class="signup_offer ql-card" aria-labelledby="ql-h">
      <a class="ql-close" href="/" aria-label="Close"></a>
      <div class="ql-body">
        <div class="ql-cm">
          <h1 class="ql-vh" id="ql-h">New jobs are calling</h1>
          <p class="ql-sub"><span class="ql-bolt"><span class="ql-vh">Bolt </span></span>is your 24/7 receptionist that <span class="ql-big">answers calls and books customers so you never miss a job again.</span></p>
          <p class="ql-free">It’s <b>FREE </b>to set up an assistant. Get started <b>today.</b></p>
        </div>
        <a class="ql-cta" href="https://app.boltanswering.com/signup">Start your free trial</a>
        <div class="ql-cr">
          <span class="ql-bubble" aria-hidden="true"></span>
          <p class="ql-who"><b>Brent B. </b>Indiana</p>
          <span class="ql-stars" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></span>
          <p class="ql-score">4.9/5</p>
          <p class="ql-quote">“I was losing jobs to voicemail and even paid $250 a week for someone to answer my phone. Bolt booked a job and paid for itself in a day.”</p>
        </div>
      </div>
    </section>
  </main>
  <script>
    // AFMBP-2567: the card's own events, as the trade pages' card logs them (demo.js), so the
    // ad funnel reads this page like the card: seen once the page is looked at, closed by the x.
    // The button needs nothing here: attribution.js decorates it and logs trial_link_clicked
    // with placement "signup_offer" (the section's first class), and meta-pixel.js turns that
    // into StartTrialClick. attribution.js is deferred, so it is ready at DOMContentLoaded.
    (function () {
      // The trade, as demo.js's TRADE names it for the card on the trade pages: the board's
      // "The sign-up offer, by ad" reads it off signup_offer_opened.
      var TRADE = '${trade}';
      function withAttr(fn) {
        var go = function () { if (window.boltAttr) fn(window.boltAttr); };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
      }
      withAttr(function (A) {
        A.whenVisible(function () { A.track('signup_offer_opened', { trigger: 'quick_landing', trade: TRADE }); });
      });
      var x = document.querySelector('.ql-close');
      if (x) x.addEventListener('click', function () {
        if (window.boltAttr) window.boltAttr.track('demo_closed', { step: 'signup_offer', trade: TRADE });
      });
      // Warm the app's sign-up page while the card is read (AFMBP-2564): the app lists the files
      // its sign-up page needs at a stable address; prefetch them once this page has loaded.
      // Until the app serves that list (or if anything fails) this does nothing.
      function warm() {
        try {
          window.fetch('https://app.boltanswering.com/signup-preload.json', { mode: 'cors', credentials: 'omit' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
              var files = j && Array.isArray(j.files) ? j.files : [];
              files.forEach(function (p) {
                if (typeof p !== 'string' || p.charAt(0) !== '/' || p.charAt(1) === '/') return;
                var l = document.createElement('link');
                // A plain prefetch, as site PR #140's: the app's files carry no Access-Control-Allow-Origin, so a
                // crossorigin prefetch would be refused, while the app's own load reuses a plain one.
                l.rel = 'prefetch'; l.href = 'https://app.boltanswering.com' + p;
                document.head.appendChild(l);
              });
            })
            .catch(function () {});
        } catch (e) {}
      }
      if (document.readyState === 'complete') setTimeout(warm, 0);
      else window.addEventListener('load', function () { setTimeout(warm, 0); });
    })();
  </script>
</body>
</html>
`;
for (const t of TRADES) writeFileSync(`start/${t.slug}.html`, page(t));
console.log('wrote', TRADES.map((t) => `start/${t.slug}.html`).join(', '));
