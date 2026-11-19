// AFMBP-2567 — builds the card-only ad landing pages, start/<trade>.html, from one template.
// The pages are the trade pages' sign-up card (demo.css, AFMBP-2273) on a page of its own, laid out
// per Figma 2142:11370. Edit the template here, then run from the site root:
//   node tools/quick-landing-build.mjs && node tools/quick-landing-check.mjs
// The Google tag block is copied from handyman.html, so a change there reaches these pages on the
// next build.
// AFMBP-2612 — the landing A/B on the experiment platform ("landing_demo_buttons"). Each page also
// carries the treatment card, the demo card of Figma 2169:14513 ("You call her" / "She calls you",
// which open today's demo), and an inline script in <head> that picks the visitor's card before
// anything paints, from bolt_vid and the definition baked in tools/xp/landing_demo_buttons.json,
// with the platform's own assignment (tools/xp/bolt-assign-es5.js). See tools/xp-landing-check.mjs.
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
const SCRIPTS = { attribution: tag('attribution'), pixel: tag('meta-pixel'), reddit: tag('reddit-pixel'), privacy: tag('privacy-choices'), sentry: tag('sentry-init') };
// The demo's files at the versions the trade pages load (the treatment card loads them after it
// has painted).
const ver = (re, what) => { const m = src.match(re); if (!m) throw new Error(`${what} not found in handyman.html`); return m[1]; };
const DEMO = {
  css: `/demo.css?v=${ver(/href="\/?demo\.css\?v=(\d+)"/, 'demo.css')}`,
  format: `/demo-format.js?v=${ver(/src="\/?demo-format\.js\?v=(\d+)"/, 'demo-format.js')}`,
  js: `/demo.js?v=${ver(/src="\/?demo\.js\?v=(\d+)"/, 'demo.js')}`,
};

// AFMBP-2612: the baked definition and the platform's assignment, inlined in <head>.
const XP = JSON.parse(readFileSync('tools/xp/landing_demo_buttons.json', 'utf8'));
for (const k of ['key', 'seed', 'trafficPercentage', 'variants', 'configVersion']) if (XP[k] === undefined) throw new Error(`landing_demo_buttons.json: no ${k}`);
if (typeof XP.baked !== 'boolean') throw new Error('landing_demo_buttons.json: baked must be true or false');
const XP_DEF = JSON.stringify({ key: XP.key, seed: XP.seed, trafficPercentage: XP.trafficPercentage, variants: XP.variants.map((v) => ({ key: v.key, allocation: v.allocation })), configVersion: XP.configVersion, baked: XP.baked });
const ASSIGN_SRC = readFileSync('tools/xp/bolt-assign-es5.js', 'utf8');
// The functions as the platform wrote them, without the Node export line at the end.
const ASSIGN = ASSIGN_SRC.replace(/\nif \(typeof module !== 'undefined'\) module\.exports = [^\n]*\n?$/, '\n').trimEnd();
if (ASSIGN === ASSIGN_SRC.trimEnd() || !ASSIGN.includes('function boltAssign(')) throw new Error('bolt-assign-es5.js: unexpected shape');
const DECIDE = `  <!-- AFMBP-2612: the landing A/B's decide step. It must run before anything paints. -->
  <script>
    /* The landing A/B ("landing_demo_buttons" on the experiment platform; SPEC "Landing Demo AB
       Metrics"). This visitor's card, decided before anything paints, from bolt_vid and the
       definition baked below (tools/xp/landing_demo_buttons.json), with no network call. The
       assignment is the platform's own (tools/xp/bolt-assign-es5.js, held to its vectors), so the
       platform checks every exposure against the same answer. "treatment" shows the demo card
       (html.xp-t); anything else shows the sign-up card. Until the definition is baked (the owner
       Starts the test first), every visitor sees the sign-up card and nothing is sent. Our own test
       browsers (bolt_qa) can force a card with ?bolt_xp=<variation>, kept for their browser
       session only and taken out of the address before any tag reads it. Opted-out and GPC
       browsers are decided like everyone else (owner, 2026-11-17). attribution.js reports the
       exposure once the page is seen. */
    (function () {
      var XP = ${XP_DEF};
${ASSIGN.split('\n').map((l) => (l ? '      ' + l : l)).join('\n')}
      var w = window, q = w.location.search, ls = null, ss = null;
      try { ls = w.localStorage; } catch (e) {}
      try { ss = w.sessionStorage; } catch (e) {}
      function get(s, k) { try { return s ? s.getItem(k) : null; } catch (e) { return null; } }
      function put(s, k, v) { try { if (s) s.setItem(k, v); } catch (e) {} }
      function param(n) {
        var m = new RegExp('[?&]' + n + '=([^&#]*)').exec(q);
        if (!m) return null;
        try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
      }
      // The visitor id attribution.js keeps (same key, same rule), made here on a first visit.
      var vid = get(ls, 'bolt_vid');
      if (!vid || !/^[A-Za-z0-9-]{8,64}$/.test(vid)) {
        vid = w.crypto && typeof w.crypto.randomUUID === 'function' ? w.crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
        put(ls, 'bolt_vid', vid);
      }
      // Our own test browser, read as attribution.js reads it (that script runs later).
      var qa = param('bolt_qa') === '1' || (get(ls, 'bolt_qa') === '1' && param('bolt_qa') !== '0') || param('demoqa') === '1';
      function variant(v) {
        for (var i = 0; i < XP.variants.length; i++) if (XP.variants[i].key === v) return v;
        return null;
      }
      var forced = null, f = param('bolt_xp');
      if (f !== null) {
        if (qa) {
          forced = variant(f);
          if (forced) put(ss, 'bolt_xp_force', forced);
          else try { if (ss) ss.removeItem('bolt_xp_force'); } catch (e) {}
        }
        try {
          w.history.replaceState(w.history.state, '', w.location.pathname +
            q.replace(/([?&])bolt_xp=[^&#]*(&|$)/, function (m, a, b) { return b ? a : ''; }) + w.location.hash);
        } catch (e) {}
      } else if (qa) forced = variant(get(ss, 'bolt_xp_force'));
      var v = forced || (XP.baked ? boltAssign(vid, XP) : null);
      w.boltXp = { key: XP.key, configVersion: XP.configVersion, variation: v, forced: !!forced, vid: vid };
      if (v === 'treatment') document.documentElement.className += ' xp-t';
    })();
  </script>`;

const TRADES = [
  { slug: 'handyman', trade: 'handyman', title: 'Bolt Answering for Handymen — Never miss a job again' },
  { slug: 'plumbing', trade: 'plumbing', title: 'Bolt Answering for Plumbers — Never miss a job again' },
  { slug: 'general-contractor', trade: 'general_contracting', title: 'Bolt Answering for General Contractors — Never miss a job again' },
];
const page = ({ slug, trade, title }) => `<!DOCTYPE html>
<html lang="en">
<head>
  <!-- First, so the browser reads the page as UTF-8 from its first bytes (the decide step and the
       Google tag block put it past the first 1024 bytes otherwise). -->
  <meta charset="UTF-8" />
${DECIDE}
${GTAG}
  <!-- Funnel attribution + events, Bolt's own analytics (AFMBP-1968) -->
  ${SCRIPTS.attribution}
  ${SCRIPTS.pixel}
  ${SCRIPTS.reddit}
  ${SCRIPTS.privacy}
  <!-- JavaScript error reports (Sentry), behind one switch in sentry-init.js (AFMBP-2130) -->
  ${SCRIPTS.sentry}
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
  <!-- The card's art carries the headline, so it is the page's largest paint (both cards: the same art). -->
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
    /* AFMBP-2612 — the treatment card: Figma 2169:14533 (in frame 2169:14513, "Quick landing page,
       demo"), shown in place of the sign-up card when the decide step picks "treatment" (html.xp-t).
       Same art and frame as the sign-up card; the node puts it 0.5px left of centre and 67px below
       the top (the frame's 54px phone header taken off), 337x631, the art 354.42x628.98 at -8.728,0.
       Every number below is the node's, on the card's own top left. */
    .ql-card--t{display:none;left:-.5px;height:631px;background-position:-8.728px 0;background-size:354.42px 628.98px}
    html.xp-t .ql{padding-top:67px}
    html.xp-t .ql-card--c{display:none}
    html.xp-t .ql-card--t{display:block}
    .qlt-body{position:relative;z-index:1;width:337px;height:631px}
    /* The cross (2169:14554) at 308.484,25.447, 13x13, in a 44px target: same cross file as the
       sign-up card's. */
    .qlt-close{left:293.008px;top:9.957px}
    .qlt-sub,.qlt-box{position:absolute;margin:0;font-family:'Times New Roman',Tinos,serif;font-weight:400;line-height:normal;color:#000}
    .qlt-sub b,.qlt-box b{font-weight:700}
    /* 2169:14553: 18px, three lines, left 17, top 200, 273 wide. */
    .qlt-sub{left:17px;top:200px;width:273px;font-size:18px;text-align:left}
    /* "Available now" (2171:14614): the green dot at 212,279 and the words centred on 264.07,284. */
    .qlt-dot{position:absolute;left:212px;top:279px;width:9.146px;height:9.146px;background:url('/assets/xp-ld-dot.svg') 0 0/100% 100% no-repeat}
    .qlt-live{
      position:absolute;left:264.07px;top:284px;margin:0;transform:translate(-50%,-50%);white-space:nowrap;
      font-size:11.763px;font-weight:400;line-height:9.609px;color:#707070;
    }
    /* The box (2169:14557, 2px black, 274x33 at 28,294) and its line (2169:14556, centred on 165, top 299). */
    .qlt-frame{position:absolute;left:28px;top:294px;width:274px;height:33px;box-sizing:border-box;border:2px solid #000;pointer-events:none}
    .qlt-box{left:165px;top:299px;width:266px;transform:translateX(-50%);font-size:19.032px;text-align:center;white-space:nowrap}
    /* The two ways in (2171:14604 / 2171:14606): 188x43 at 75, tops 354.53 and 440.4, radius 10,
       the node's labels 0.5px left of and 0.36px below centre. */
    .qlt-btn{
      position:absolute;left:75px;width:188px;height:43px;margin:0;border:0;border-radius:10px;box-sizing:border-box;
      display:flex;align-items:center;justify-content:center;cursor:pointer;
      font-family:inherit;font-size:19.427px;font-weight:700;line-height:18.544px;color:#fff;text-decoration:none;white-space:nowrap;
      -webkit-tap-highlight-color:transparent;
    }
    .qlt-call{top:354.53px;background:var(--blue);padding:.72px 1.02px 0 0}
    .qlt-get{top:440.4px;background:#83b5ff;padding:.72px 1.08px 0 0}
    .qlt-btn:focus-visible,.qlt-close:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
    /* The wait (2172:14618): centred on 166.5,412.4, 14px, "3 seconds" semibold. */
    .qlt-wait{
      position:absolute;left:166.5px;top:412.4px;margin:0;transform:translate(-50%,-50%);white-space:nowrap;
      font-size:14px;font-weight:400;line-height:11.836px;color:#707070;
    }
    .qlt-wait b{font-weight:600}
    /* The rating (2169:14534): the bubble, name and quote turned 3.17deg, the stars and score 3.02deg,
       each about its own centre, as the node turns them. */
    .qlt-bubble,.qlt-who,.qlt-star,.qlt-star5,.qlt-score,.qlt-quote{position:absolute;margin:0;transform-origin:50% 50%}
    .qlt-bubble{left:35.2675px;top:513.3045px;width:266.918px;height:91.6175px;transform:rotate(3.17deg);pointer-events:none;background:url('/assets/xp-ld-bubble.svg') 0 0/100% 100% no-repeat}
    .qlt-who{
      left:60.9475px;top:524.016px;width:94.453px;height:11.568px;transform:rotate(3.17deg);
      display:flex;align-items:center;white-space:nowrap;font-size:9.843px;font-weight:400;line-height:10.621px;color:var(--navy);
    }
    .qlt-who b{font-size:11.665px;font-weight:700;white-space:pre}
    .qlt-star{width:14.775px;height:15.582px;transform:rotate(3.02deg);background:url('/assets/xp-ld-star.svg') .362px 0/14.052px 14.094px no-repeat}
    .qlt-s1{left:182.481px;top:525.169px}
    .qlt-s2{left:197.231px;top:525.959px}
    .qlt-s3{left:211.981px;top:526.729px}
    .qlt-s4{left:226.741px;top:527.509px}
    .qlt-star5{left:241.415px;top:531.541px;width:14.775px;height:12.333px;transform:rotate(3.02deg);background:url('/assets/xp-ld-star5.svg') 0 0/100% 100% no-repeat}
    .qlt-score{
      left:257.3445px;top:532.016px;width:30.851px;height:11.568px;transform:rotate(3.02deg);
      display:flex;align-items:center;justify-content:center;white-space:nowrap;
      font-size:11.665px;font-weight:700;line-height:10.621px;color:var(--navy);
    }
    .qlt-quote{
      left:47.3715px;top:543.1px;width:242.597px;height:41.52px;transform:rotate(3.17deg);
      display:flex;align-items:center;justify-content:center;text-align:center;
      font-size:10.663px;font-style:italic;font-weight:400;line-height:13.006px;color:var(--navy);
    }
  </style>
</head>
<body>
  <!-- The section's first class is the tap's placement (attribution.js placement()): "signup_offer",
       as the card logs it on the trade pages, so Meta's StartTrialClick reads the same. -->
  <main class="ql">
    <img class="ql-logo" src="/assets/bolt-logo-small.svg" width="71" height="29" alt="Bolt Answering" />
    <section class="signup_offer ql-card ql-card--c" aria-labelledby="ql-h">
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
    <!-- AFMBP-2612: the landing A/B's treatment card (Figma 2169:14513), the owner's words verbatim
         (the quote closes with ” as on the sign-up card). Its two buttons open today's demo
         (demo.js, loaded once the card has painted): "You call her" calls the demo line, "She calls
         you" opens the "We call you" form. -->
    <section class="demo_landing ql-card ql-card--t" aria-labelledby="qlt-h">
      <a class="ql-close qlt-close" href="/" aria-label="Close"></a>
      <div class="qlt-body">
        <h1 class="ql-vh" id="qlt-h">New jobs are calling</h1>
        <p class="qlt-sub"><b>Sierra</b> is a receptionist from Bolt that answers calls, books customers, takes messages and more.</p>
        <span class="qlt-dot" aria-hidden="true"></span>
        <p class="qlt-live">Available now</p>
        <span class="qlt-frame" aria-hidden="true"></span>
        <p class="qlt-box">Two options to talk to <b>Sierra</b> now</p>
        <a class="qlt-btn qlt-call" href="#" data-demo-landing="call">You call her</a>
        <p class="qlt-wait">Avg. wait time: <b>3 seconds</b></p>
        <button class="qlt-btn qlt-get" type="button" data-demo-landing="form">She calls you</button>
        <span class="qlt-bubble" aria-hidden="true"></span>
        <p class="qlt-who"><b>Brent B. </b>Indiana</p>
        <span class="qlt-star qlt-s1" aria-hidden="true"></span><span class="qlt-star qlt-s2" aria-hidden="true"></span><span class="qlt-star qlt-s3" aria-hidden="true"></span><span class="qlt-star qlt-s4" aria-hidden="true"></span><span class="qlt-star5" aria-hidden="true"></span>
        <p class="qlt-score">4.9/5</p>
        <p class="qlt-quote">“I was losing jobs to voicemail and even paid $250 a week for a receptionist. Bolt booked a job and paid for itself.”</p>
      </div>
    </section>
  </main>
  <script>
    // AFMBP-2567: the card's own events, as the trade pages' card logs them (demo.js), so the
    // ad funnel reads this page like the card: seen once the page is looked at, closed by the x.
    // The button needs nothing here: attribution.js decorates it and logs trial_link_clicked
    // with placement "signup_offer" (the section's first class), and meta-pixel.js turns that
    // into StartTrialClick. attribution.js is deferred, so it is ready at DOMContentLoaded.
    // AFMBP-2612: the landing A/B. Once the page is seen, attribution.js reports the exposure (to
    // the platform and as xp_exposed) with the card the decide step picked, from the same callback
    // as the card's own event: signup_offer_opened for the sign-up card, demo_card_opened for the
    // demo card.
    (function () {
      // The trade, as demo.js's TRADE names it for the card on the trade pages: the board's
      // "The sign-up offer, by ad" reads it off signup_offer_opened.
      var TRADE = '${trade}';
      var T = !!(window.boltXp && window.boltXp.variation === 'treatment');
      function withAttr(fn) {
        var go = function () { if (window.boltAttr) fn(window.boltAttr); };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
      }
      withAttr(function (A) {
        A.whenVisible(function () {
          if (A.xpExpose) A.xpExpose();
          A.track(T ? 'demo_card_opened' : 'signup_offer_opened', { trigger: 'quick_landing', trade: TRADE });
        });
      });
      [].forEach.call(document.querySelectorAll('.ql-close'), function (x) {
        x.addEventListener('click', function () {
          if (window.boltAttr) window.boltAttr.track('demo_closed', { step: T ? 'demo_card' : 'signup_offer', trade: TRADE });
        });
      });
      // AFMBP-2612: the demo card's buttons run today's demo (demo.js with demo.css). They load
      // once the card has painted (the page's load event) or at the first touch, whichever comes
      // first, so the card paints as fast as the sign-up card. A tap that comes before demo.js is
      // kept for it (window.__boltDemoPending), and demo.js carries it out once it has loaded.
      if (T) {
        var loaded = false;
        var loadDemo = function () {
          if (loaded) return;
          loaded = true;
          var l = document.createElement('link');
          l.rel = 'stylesheet'; l.href = '${DEMO.css}';
          document.head.appendChild(l);
          ['${DEMO.format}', '${DEMO.js}'].forEach(function (s) {
            var e = document.createElement('script');
            e.src = s; e.async = false;
            document.body.appendChild(e);
          });
        };
        [].forEach.call(document.querySelectorAll('[data-demo-landing]'), function (b) {
          b.addEventListener('click', function (e) {
            if (window.boltDemo) return;   // demo.js has the button
            e.preventDefault();
            window.__boltDemoPending = b.getAttribute('data-demo-landing');
            loadDemo();
          });
        });
        if (document.readyState === 'complete') setTimeout(loadDemo, 0);
        else window.addEventListener('load', function () { setTimeout(loadDemo, 0); });
        ['pointerdown', 'touchstart', 'keydown'].forEach(function (t) { window.addEventListener(t, loadDemo, { capture: true, passive: true, once: true }); });
      }
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
// AFMBP-2612 (owner 2026-11-18, "trim then merge"): the pages ship without comments, indentation or
// blank lines, in both arms alike, so the second card costs the first as little as possible. The
// template above stays readable. The decide step is left byte for byte (tools/xp-assign-check.mjs
// and tools/xp/bake.mjs read it). Line breaks stay, so no script statement or HTML text joins up.
const isDecide = (body) => body.includes('/* The landing A/B ("landing_demo_buttons"');
const trimJs = (s) => {
  const out = []; let inBlock = false;
  for (const line of s.split('\n')) {
    const t = line.trim();
    if (inBlock) { if (t.includes('*/')) inBlock = false; continue; }
    if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; continue; }
    if (!t || t.startsWith('//')) continue;
    out.push(t);
  }
  return out.join('\n');
};
const trimCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.trim()).filter(Boolean)
  .reduce((acc, l) => (acc && !/[{};,]$/.test(acc) ? `${acc} ${l}` : acc + l), '');
const trimHtml = (s) => s.replace(/<!--[\s\S]*?-->/g, '').split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
const trim = (html) => {
  let out = '', last = 0;
  for (const m of html.matchAll(/<(script|style)>([\s\S]*?)<\/\1>/g)) {
    out += trimHtml(html.slice(last, m.index));
    const [, tagName, body] = m;
    if (tagName === 'script' && isDecide(body)) out += `\n${m[0]}`;
    else out += `\n<${tagName}>\n${tagName === 'style' ? trimCss(body) : trimJs(body)}\n</${tagName}>`;
    last = m.index + m[0].length;
  }
  return `${out}\n${trimHtml(html.slice(last))}\n`.replace(/^\n+/, '');
};
for (const t of TRADES) {
  const full = page(t), out = trim(full);
  if (!out.includes('<script>\n    /* The landing A/B ("landing_demo_buttons"')) throw new Error('the decide step did not survive the trim');
  writeFileSync(`start/${t.slug}.html`, out);
}
console.log('wrote', TRADES.map((t) => `start/${t.slug}.html`).join(', '), `(landing A/B ${XP.key}: ${XP.baked ? `BAKED, configVersion ${XP.configVersion}` : 'NOT BAKED, everyone sees the sign-up card'})`);
