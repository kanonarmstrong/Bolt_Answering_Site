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
import { staleCopies } from './demo-min.mjs';
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
// has painted). AFMBP-2657: their minified copies (tools/demo-min.mjs), at the sources' versions;
// no build while a copy is older than its source.
const stale = staleCopies();
if (stale.length) throw new Error(`older than their sources: ${stale.join(', ')}. Run node tools/demo-min.mjs first`);
const ver = (re, what) => { const m = src.match(re); if (!m) throw new Error(`${what} not found in handyman.html`); return m[1]; };
const DEMO = {
  css: `/demo.min.css?v=${ver(/href="\/?demo\.css\?v=(\d+)"/, 'demo.css')}`,
  format: `/demo-format.min.js?v=${ver(/src="\/?demo-format\.js\?v=(\d+)"/, 'demo-format.js')}`,
  js: `/demo.min.js?v=${ver(/src="\/?demo\.js\?v=(\d+)"/, 'demo.js')}`,
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
    /* The sign-up card's pitch and trial line are Times New Roman, as the node sets them (AFMBP-2714).
       A phone that has it (iPhone, Mac, Windows) draws it from its own copy and downloads nothing.
       Android has none and answers the name with its own serif (Noto Serif: wider letters, taller
       lines; AFMBP-2686), so the name comes first through local(), which only an installed Times New
       Roman answers. Everywhere else it is Tinos, which has Times New Roman's widths, so every line
       breaks where the node breaks it. Block: no line is drawn in another serif first. */
    @font-face{
      font-family:'Bolt Times';font-style:normal;font-weight:400;font-display:block;
      src:local('Times New Roman'),local('TimesNewRomanPSMT'),url('/assets/fonts/tinos-400.woff2') format('woff2');
    }
    @font-face{
      font-family:'Bolt Times';font-style:normal;font-weight:700;font-display:block;
      src:local('Times New Roman Bold'),local('TimesNewRomanPS-BoldMT'),url('/assets/fonts/tinos-700.woff2') format('woff2');
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
    /* iPad Safari's text autosizing ignores that zoom (every word drew at its unzoomed size):
       off on the card, iOS WebKit only, as in demo.css (AFMBP-2602). The body's 100% does not fix it. */
    @supports (-webkit-touch-callout:none){ @media (max-width:336px){ .ql-card{-webkit-text-size-adjust:none;text-size-adjust:none} } }
    .ql-body{position:relative;z-index:1;left:.6px;top:.6px;width:337px;height:629px}
    /* The close: the node's 13px cross (black since AFMBP-2714) in a 44px tap target. It goes to the
       home page (owner, 11-12). */
    .ql-close{
      position:absolute;z-index:2;left:283.496px;top:9.497px;width:44px;height:44px;
      display:flex;align-items:center;justify-content:center;
    }
    .ql-close::before{
      content:"";width:12.992px;height:12.993px;pointer-events:none;
      background:url('/assets/demo-so-close.svg') center/100% 100% no-repeat;
    }
    .ql-close:focus-visible,.ql-go:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
    /* The headline is in the art, the wordmark and the rating are drawn: their words (and the field's
       label) are for screen readers. */
    .ql-vh{
      position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;
      overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;
    }
    /* AFMBP-2714 — the sign-up card is the owner's email card of 2026-11-27 (Figma 2955:2387 empty,
       2957:3273 typed), every number as in demo.css: the pitch (live text, 19.032px then 20.03px
       from "answers", on the node's baselines 237.4–306.4) with the wordmark in its first line's
       room; the trial line, "FREE" bold; "Security" and its lock; the field; Continue, grey and
       disabled while the field is empty, blue once anything is typed; the terms line; the rating,
       one drawing. */
    .ql-sub,.ql-free{
      position:absolute;left:28.1px;width:268px;margin:0;font-family:'Bolt Times',serif;font-size:19.032px;font-weight:400;
      line-height:22px;color:#000;text-align:left;
    }
    .ql-sub{top:220.4px}
    .ql-big{font-size:20.03px;line-height:23px}
    .ql-bolt{display:inline-block;width:80.886px;height:0;vertical-align:baseline}
    .ql-sub::before{
      content:"";position:absolute;left:2.7px;top:-10.1px;width:73.5px;height:30.7px;pointer-events:none;
      background:url('/assets/demo-so-bolt.svg') 0 0/100% 100% no-repeat;
    }
    .ql-free{top:321.41px}
    .ql-free b{font-weight:700}
    .ql-secure{
      position:absolute;left:251.4px;top:373.4px;width:49.374px;height:11.072px;pointer-events:none;
      background:url('/assets/demo-so-lock.svg') 0 0/8.571px 10px no-repeat,url('/assets/demo-so-security.svg') 10.85px 1.39px/38.524px 9.682px no-repeat;
    }
    .ql-email{
      position:absolute;left:30.4px;top:387.4px;width:275px;height:48px;margin:0;padding:0 11.67px 1.9px;box-sizing:border-box;
      border:0;border-radius:12.667px;background:#fdfdff;opacity:.82;
      box-shadow:inset 0 0 0 .333px #e6e6ed,0 1px 2px rgba(12,12,13,.05);
      font-family:inherit;font-size:16px;font-weight:400;line-height:normal;color:#000;
      -webkit-appearance:none;appearance:none;outline:none;
    }
    .ql-email::placeholder{color:#787888;opacity:1}
    .ql-go{
      position:absolute;left:30.4px;top:446.4px;width:275px;height:48px;margin:0;padding:1.794px 4.92px 0 0;box-sizing:border-box;
      border:0;border-radius:12.667px;background:var(--blue);color:#fff;
      box-shadow:0 1px 4px rgba(12,12,13,.1),0 1px 4px rgba(12,12,13,.05);
      display:flex;align-items:center;justify-content:center;
      font-family:inherit;font-size:16.8px;font-weight:700;line-height:20px;
      cursor:pointer;-webkit-appearance:none;appearance:none;-webkit-tap-highlight-color:transparent;
    }
    .ql-go:disabled{background:#cbcbcb;cursor:not-allowed}
    .ql-terms{
      position:absolute;left:45.4px;top:503.4px;width:245px;margin:0;
      font-size:10.143px;font-weight:400;line-height:12.283px;color:#787888;text-align:center;
    }
    .ql-terms a{color:var(--blue);text-decoration:none}
    .ql-terms a:focus-visible{outline:2px solid var(--blue);outline-offset:1px;border-radius:2px}
    .ql-quote{
      position:absolute;left:55.4px;top:539.4px;width:226px;height:74.146px;pointer-events:none;
      background:url('/assets/demo-so-quote.svg') 0 0/100% 100% no-repeat;
    }
    /* AFMBP-2612 — the treatment card: Figma 2169:14533 (in frame 2169:14513, "Quick landing page,
       demo"), shown in place of the sign-up card when the decide step picks "treatment" (html.xp-t).
       AFMBP-2685 (owner, 11-21): the node's redesign for phones. The card is 375x702.151 now (was
       337x631) with a .667px border, its line "Two ways to talk to Sierra now" is a vector (on Android
       the words ran over the card's right edge), the words above it are new, and the rating is larger.
       Same art as the sign-up card: 392.98x698.57 at -9.678,0 inside the border. The node puts the
       card 0.5px right of centre and 32px below the top (the frame's 54px phone header taken off).
       AFMBP-2686 (owner, 11-22): the node again. The receptionist line has new words, centred; the
       "Available" dot and word sit under the vector; the buttons, the vector and the smaller rating
       moved; the wait line between the buttons is gone. Plus two animations (see the end): the dot
       blinks, and the card's content is uncovered top to bottom while its art stays still.
       Then (owner, 11-22, after the Pixel 10a, where Android's own serif grew the words into the
       "Two ways" box): every word on the card is a drawing. The receptionist line, "Available", both
       buttons and the rating (bubble, name, stars, score and quote) are the node's vectors, so no
       phone's fonts or text size can move or rewrap them; their words are there for screen readers.
       The buttons are smaller (41px tall, lighter labels) and lower, "Available" is 10px lower, and
       the cross is black.
       Then (owner, 11-22, the node again): the "Two ways" box grew into a frame, 295x191, that holds
       "Available" (top right), the "Two ways" line and both buttons; the buttons moved up into it and
       the rating 5px down.
       Every number below is the node's, on the card's top left inside the border (.qlt-body), except
       the close, which sits on the card itself. */
    .ql-card--t{display:none;left:.5px;width:375px;height:702.151px;border-radius:12.013px;box-shadow:inset 0 0 0 .667px rgba(0,0,0,.18);background-position:-9.011px .667px;background-size:392.98px 698.57px}
    html.xp-t .ql{padding-top:32px}
    html.xp-t .ql-card--c{display:none}
    html.xp-t .ql-card--t{display:block}
    /* Narrower than the node's 402px frame, the card scales down whole (zoom), so every word and the
       vector stay inside it and it keeps about 13px or more on each side. */
    @media (max-width:399px){ .ql-card--t{zoom:.96} }
    @media (max-width:389px){ .ql-card--t{zoom:.92} }
    @media (max-width:374px){ .ql-card--t{zoom:.88} }
    @media (max-width:359px){ .ql-card--t{zoom:.82} }
    @media (max-width:335px){ .ql-card--t{zoom:.76} }
    @media (max-width:315px){ .ql-card--t{zoom:.7} }
    /* iPad Safari's text autosizing ignores that zoom (AFMBP-2602): off on the zoomed card, iOS WebKit only. */
    @supports (-webkit-touch-callout:none){ @media (max-width:399px){ .ql-card--t{-webkit-text-size-adjust:none;text-size-adjust:none} } }
    .qlt-body{position:relative;z-index:1;left:.667px;top:.667px;width:373.666px;height:700.817px}
    /* The cross (2169:14554): 14.457x14.458 at 342.73,28.932 on the card's outer edge, in a 44px
       target. The node's own file: black since its 11-22 edit (the sign-up card's cross is navy). */
    .qlt-close{left:327.958px;top:14.16px}
    .qlt-close::before{width:14.457px;height:14.458px;background-image:url('/assets/xp-ld-close.svg')}
    /* The receptionist line (2281:21114): the node's vector, its four centred lines in one drawing,
       333.721x91.048 at 22.707,230.231 on the card's outer edge. */
    .qlt-sub{position:absolute;left:22.04px;top:229.564px;width:333.721px;height:91.048px;margin:0;background:url('/assets/xp-ld-meet-sierra.svg') 0 0/100% 100% no-repeat}
    /* "Two ways to talk to Sierra now" (2269:21112): the node's vector, the frame and the line in one,
       295x191 at 39,339.25 (the node's 40,340 is on the card's outer edge, so drawn 1px up and left
       here, as the old box was, where it matches the node's render). "Available" and both buttons sit
       on top of it. Its words are there for screen readers. */
    .qlt-ways{position:absolute;left:39px;top:339.25px;width:295px;height:191px;margin:0;background:url('/assets/xp-ld-two-ways-box.svg') 0 0/100% 100% no-repeat}
    /* "Available" (2171:14614), inside the frame's top right: the green dot, 8.327px at the node's
       255,354 (on the card's outer edge; its own element, as it blinks), and the word, the node's vector
       (2281:21124), 44.051x8.169 at 268.339,353.968. */
    .qlt-dot{position:absolute;left:254.333px;top:353.333px;width:8.327px;height:8.327px;background:url('/assets/xp-ld-dot.svg') 0 0/100% 100% no-repeat}
    .qlt-live{position:absolute;left:267.673px;top:353.301px;width:44.051px;height:8.169px;margin:0;background:url('/assets/xp-ld-available.svg') 0 0/100% 100% no-repeat}
    /* The two ways in (2171:14604 / 2171:14606): the node's buttons, each one drawing (fill, 11.128
       radius and label), 209x41 at 83,410 and 210x41 at 83,466 on the card's outer edge. Nothing
       between them since AFMBP-2686 (the node dropped the wait line). While "You call her" waits for
       its code (a tap before one is ready), demo.js puts its spinner in the button: here it sits
       left of the drawn label, not on it. */
    .qlt-btn{
      position:absolute;height:41px;margin:0;padding:0;border:0;border-radius:11.128px;box-sizing:border-box;
      display:block;cursor:pointer;-webkit-appearance:none;appearance:none;-webkit-tap-highlight-color:transparent;
    }
    .qlt-call{left:82.333px;top:409.333px;width:209px;background:url('/assets/xp-ld-you-call-her.svg') 0 0/100% 100% no-repeat}
    .qlt-get{left:82.333px;top:465.333px;width:210px;background:url('/assets/xp-ld-she-calls-you.svg') 0 0/100% 100% no-repeat}
    .qlt-call .demo-spinner{position:absolute;left:27px;top:0;bottom:0;margin:auto 0}
    .qlt-btn:focus-visible,.qlt-close:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
    /* The rating (2169:14534, "Group 355"): the node's vector, its bubble, name, stars, score and quote
       in one drawing, 309.729x112.627, turned 3.17deg about its centre as the node turns it (5px lower
       since the node's frame edit). */
    .qlt-bubble{position:absolute;left:32.875px;top:557.8715px;width:309.729px;height:112.627px;margin:0;transform:rotate(3.17deg);transform-origin:50% 50%;pointer-events:none;background:url('/assets/xp-ld-rating.svg') 0 0/100% 100% no-repeat}
    /* AFMBP-2686 (owner, 11-22): "the green dot next to 'Available' needs to blink", and "all of the
       content needs to appear via a vertically swipe from top to bottom ... the background image does
       not need to swipe". The node has no motion, so the timings are ours.
       - The wipe-in, once, as the card first shows: everything on it but the art (the drawn words,
         "Available", the buttons, the rating, the cross) is uncovered from the top edge down in 1.4s
         (owner, 11-22: "2x slower" than the first 0.7s), fast at first so the words come early,
         slowing to the bottom. A cover in the card's own
         art (the same file at the same place and size, so the art never moves) sits over the lot
         and is cut away from the top down. It takes no taps and is gone after the wipe; without
         clip-path there is no cover at all.
       - The blink: the dot fades out and back every 1.2s while the card shows.
       A phone set to reduce motion gets neither: the card is all there at once and the dot is steady. */
    @media (prefers-reduced-motion:no-preference){
      @supports (clip-path:inset(0 0 0 0)) or (-webkit-clip-path:inset(0 0 0 0)){
        .ql-card--t::after{
          content:"";position:absolute;top:0;right:0;bottom:0;left:0;z-index:3;pointer-events:none;
          background:inherit;border-radius:inherit;box-shadow:inherit;
          -webkit-clip-path:inset(100% 0 0 0);clip-path:inset(100% 0 0 0);
          animation:qlt-wipe 1.4s cubic-bezier(.25,.46,.45,.94) both;
        }
      }
      .qlt-dot{animation:qlt-blink 1.2s ease-in-out infinite}
    }
    @keyframes qlt-wipe{
      from{-webkit-clip-path:inset(0 0 0 0);clip-path:inset(0 0 0 0)}
      to{-webkit-clip-path:inset(100% 0 0 0);clip-path:inset(100% 0 0 0)}
    }
    @keyframes qlt-blink{0%,100%{opacity:1}50%{opacity:.15}}
  </style>
</head>
<body>
  <!-- The section's first class names the card ("signup_offer", as the card on the trade pages is
       logged). AFMBP-2714: Continue logs its own tap with that placement (the script below). -->
  <main class="ql">
    <img class="ql-logo" src="/assets/bolt-logo-small.svg" width="71" height="29" alt="Bolt Answering" />
    <section class="signup_offer ql-card ql-card--c" aria-labelledby="ql-h">
      <a class="ql-close" href="/" aria-label="Close"></a>
      <div class="ql-body">
        <div class="ql-cm">
          <h1 class="ql-vh" id="ql-h">New jobs are calling</h1>
          <p class="ql-sub"><span class="ql-bolt"><span class="ql-vh">Bolt </span></span>is your professional, 24/7 receptionist that <span class="ql-big">answers calls, books customers and more for less than $3 a day.</span></p>
          <p class="ql-free">Create an account to start your <b>FREE</b> 30-day trial now.</p>
        </div>
        <span class="ql-secure" aria-hidden="true"></span>
        <label class="ql-vh" for="ql-email">Email</label>
        <input class="ql-email" id="ql-email" type="email" name="email" inputmode="email" autocomplete="email" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" maxlength="254" placeholder="Email" />
        <button class="ql-go" type="button" disabled>Continue</button>
        <p class="ql-terms">By tapping “Continue”, you agree to our<br /><a href="/privacy/" target="_blank" rel="noopener">Privacy Policy</a> and <a href="/terms/" target="_blank" rel="noopener">Terms</a>.</p>
        <div class="ql-quote"><p class="ql-vh">Brent B., Indiana</p><p class="ql-vh">4.9/5</p><p class="ql-vh">“Bolt booked a job and paid for itself in a day.”</p></div>
      </div>
    </section>
    <!-- AFMBP-2612: the landing A/B's treatment card (Figma 2169:14513), the owner's words verbatim:
         drawn as the node's vectors, and the same words in hidden text for screen readers (the quote
         closes with ” as on the sign-up card). Its two buttons open today's demo
         (demo.js, loaded once the card has painted): "You call her" calls the demo line, "She calls
         you" opens the "We call you" form. -->
    <section class="demo_landing ql-card ql-card--t" aria-labelledby="qlt-h">
      <a class="ql-close qlt-close" href="/" aria-label="Close"></a>
      <div class="qlt-body">
        <h1 class="ql-vh" id="qlt-h">New jobs are calling</h1>
        <p class="qlt-sub"><span class="ql-vh">Meet Sierra, your new personal receptionist. She answers calls, takes messages, and books customers when you can’t for less than $4/day.</span></p>
        <p class="qlt-ways"><span class="ql-vh">Two ways to talk to Sierra now</span></p>
        <span class="qlt-dot" aria-hidden="true"></span>
        <p class="qlt-live"><span class="ql-vh">Available</span></p>
        <a class="qlt-btn qlt-call" href="#" data-demo-landing="call"><span class="ql-vh">You call her</span></a>
        <button class="qlt-btn qlt-get" type="button" data-demo-landing="form"><span class="ql-vh">She calls you</span></button>
        <div class="qlt-bubble"><p class="ql-vh">Brent B. Indiana</p><p class="ql-vh">4.9/5</p><p class="ql-vh">“Bolt booked a job and paid for itself in a day.”</p></div>
      </div>
    </section>
  </main>
  <script>
    // AFMBP-2567: the card's own events, as the trade pages' card logs them (demo.js), so the
    // ad funnel reads this page like the card: seen once the page is looked at, closed by the x.
    // AFMBP-2714: Continue is wired below (the email card, as demo.js runs it on the trade pages).
    // meta-pixel.js turns its trial_link_clicked into StartTrialClick. attribution.js is deferred,
    // so it is ready at DOMContentLoaded.
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
      // AFMBP-2714: the email field and Continue (handoff contract v1, AFMBP-2712), as demo.js runs
      // them on the trade pages' card. Continue follows the field: disabled while it is empty,
      // enabled once anything is typed (no address check: the app's screen shows an invalid one).
      // It logs trial_link_clicked {placement: signup_offer, form: email}, holds the page until that
      // has gone out (at most 0.3 s, AFMBP-2344), then goes to the app's email sign-up screen with
      // the address in the URL's fragment, after the visitor id, ad tags and QA flag
      // attribution.js adds. The address never goes in the query string, a cookie, storage or an
      // event. signup_offer_email_typed goes once, on the first character typed. The keyboard's Go
      // key is Continue. Back from the app (the page restored as it was), Continue works again.
      var field = document.getElementById('ql-email'), go = document.querySelector('.ql-go');
      if (field && go) {
        var typed = false, leaving = false;
        var sync = function (byHand) {
          var v = field.value.trim();
          go.disabled = !v;
          if (byHand && v && !typed) {
            typed = true;
            if (window.boltAttr) window.boltAttr.track('signup_offer_email_typed', { trade: TRADE });
          }
        };
        var submit = function () {
          var v = field.value.trim();
          if (!v || leaving) return;
          leaving = true;
          var A = window.boltAttr, sent = null, href = 'https://app.boltanswering.com/signup?entry=card_email';
          try {
            if (A) {
              sent = A.track('trial_link_clicked', { placement: 'signup_offer', form: 'email', trade: TRADE });
              href = A.decorate(href);
            }
          } catch (e) {}
          href += '#email=' + encodeURIComponent(v);
          var gone = false;
          var leave = function () { if (!gone) { gone = true; window.location.href = href; } };
          setTimeout(leave, 300);
          if (sent && sent.then) sent.then(leave, leave);
        };
        field.addEventListener('input', function () { sync(true); });
        field.addEventListener('change', function () { sync(true); });
        field.addEventListener('keydown', function (e) {
          if (e.key !== 'Enter' || e.isComposing) return;
          e.preventDefault();
          submit();
        });
        go.addEventListener('click', submit);
        window.addEventListener('pageshow', function (e) { if (e.persisted) leaving = false; sync(false); });
        sync(false);
      }
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
