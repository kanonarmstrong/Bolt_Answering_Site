// AFMBP-2567 — the card-only ad landing pages (/start/<trade>.html, Figma 2142:11370).
// For each page, in headless Chrome at the node's phone size (402 wide) with an Android in-app UA:
//   - the card, the wordmark and the close sit where the node puts them;
//   - AFMBP-2714, the email card (Figma 2955:2387 / 2957:3273, contract v1 in AFMBP-2712): the pitch,
//     the trial line and the terms line say the node's words; the field and Continue sit where the
//     node puts them; Continue is grey and disabled until something is typed, then blue; a tap logs
//     trial_link_clicked {placement: signup_offer, form: email} and goes to the app's sign-up page
//     with entry=card_email, the visitor id and the ad tags attribution.js adds, and the address in
//     the fragment, never the query; signup_offer_email_typed once; no event carries the address;
//   - AFMBP-2724: the eyebrow over the field is the node's "Secured" drawing (2962:977) beside the
//     lock (2955:3252), where and as big as the node draws them, hidden from screen readers;
//   - the page logs what the trade pages' card logs, so the ad funnel reads it the same way:
//     site_landed, signup_offer_opened (trigger quick_landing) once, trial_link_clicked as above, and
//     Meta's StartTrialClick from that tap (the ad sets' optimization event, "Landing page: Start
//     now tap");
//   - the close goes to the home page and logs demo_closed {step: signup_offer};
//   - the page is noindex and is not in the sitemap;
//   - at 320 and 300 wide both cards (the sign-up card and the landing A/B's demo card) zoom and
//     the iOS-only rule that turns iPad Safari's text autosizing off reaches them; at 337 neither
//     (AFMBP-2602).
//   - AFMBP-2657: the demo card loads the demo's minified copies (tools/demo-min.mjs) at the versions
//     the trade pages load the sources; each copy names its source as it is now; and demo.min.css is,
//     to Chrome, the same style sheet as demo.css, rule for rule.
// The ingest and the pixel are stubbed in the page; nothing reaches production. Nothing leaves the
// machine either: Chrome resolves no host but 127.0.0.1, so the page's requests to other hosts, its
// preconnects and prefetches, and Chrome's own background requests all fail to resolve.
// Run: node tools/quick-landing-check.mjs [siteRoot]
//      NC=<name> node tools/quick-landing-check.mjs   — one negative control (see MUTATE); each must FAIL.
// The warm-up is checked against a stubbed preload list with good and bad entries.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { staleCopies } from './demo-min.mjs';

const ROOT = resolve(process.argv[2] || '.');
const NC = process.env.NC || '';
const PAGES = ['start/handyman.html', 'start/plumbing.html', 'start/general-contractor.html'];
// The trade each page's card events carry, as demo.js's TRADE names it on the trade pages.
const TRADE = { 'start/handyman.html': 'handyman', 'start/plumbing.html': 'plumbing', 'start/general-contractor.html': 'general_contracting' };
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const UA = 'Mozilla/5.0 (Linux; Android 14; SM-A146U; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/490.0.0.49.79;]';

// Negative controls: break the served copy one way each; the run must then fail.
const MUTATE = {
  placement: (p, s) => s.replace("{ placement: 'signup_offer', form: 'email', trade: TRADE }", "{ form: 'email', trade: TRADE }"),
  // AFMBP-2714: the address in the query string, Continue on while the field is empty, the typing
  // event on every keystroke, the app not told where the visitor came from.
  query_email: (p, s) => s.replace("href += '#email=' + encodeURIComponent(v);", "href += '&email=' + encodeURIComponent(v);"),
  empty_on: (p, s) => s.replace('go.disabled = !v;', 'go.disabled = false;'),
  typed_every: (p, s) => s.replace('if (byHand && v && !typed) {', 'if (byHand && v) {'),
  entry: (p, s) => s.replace("href = 'https://app.boltanswering.com/signup?entry=card_email';", "href = 'https://app.boltanswering.com/signup';"),
  // AFMBP-2724: the eyebrow back to the old "Security" drawing; "Secured" where "Security" sat.
  eyebrow_old: (p, s) => s.replace("url('/assets/demo-so-secured.svg') 11.6px 1.645px/32.528px 6.466px", "url('/assets/demo-so-security.svg') 10.85px 1.39px/38.524px 9.682px"),
  eyebrow_off: (p, s) => s.replace("url('/assets/demo-so-secured.svg') 11.6px 1.645px/", "url('/assets/demo-so-secured.svg') 10.85px 1.39px/"),
  close: (p, s) => s.replace('<a class="ql-close" href="/"', '<a class="ql-close" href="/handyman.html"'),
  opened: (p, s) => s.replace("A.track(T ? 'demo_card_opened' : 'signup_offer_opened'", "A.track(T ? 'demo_card_opened' : 'signup_offer_seen'"),
  trade: (p, s) => s.replace("{ trigger: 'quick_landing', trade: TRADE }", "{ trigger: 'quick_landing' }"),
  noindex: (p, s) => s.replace('<meta name="robots" content="noindex" />', ''),
  prefetch: (p, s) => s.replace("l.rel = 'prefetch'; l.href", "l.rel = 'prefetch'; l.crossOrigin = 'anonymous'; l.href"),
  position: (p, s) => s.replace('.ql{position:relative;display:flex;justify-content:center;align-items:flex-start;padding:70px 0 40px}', '.ql{position:relative;display:flex;justify-content:center;align-items:flex-start;padding:90px 0 40px}'),
  // AFMBP-2602: iPad Safari's text autosizing left on in the zoomed card, or set to 100% (which does not fix it).
  ios_autosize: (p, s) => s.replace('.ql-card{-webkit-text-size-adjust:none;text-size-adjust:none}', '.ql-card{}'),
  ios_tsa_100: (p, s) => s.replace('.ql-card{-webkit-text-size-adjust:none;text-size-adjust:none}', '.ql-card{-webkit-text-size-adjust:100%;text-size-adjust:100%}'),
};
// AFMBP-2602: the text-size-adjust of every iOS-only rule (inside @supports (-webkit-touch-callout:none))
// that reaches an element here, each @media evaluated against this window and each selector against
// the element. Chrome never applies those rules, so they are read from the style sheets.
const IOS_TSA = `function iosTsa(el){var hit=[];
  function walk(list, ios){for(var i=0;i<list.length;i++){var r=list[i];
    if(r instanceof CSSSupportsRule) walk(r.cssRules, ios||/-webkit-touch-callout\\s*:\\s*none/.test(r.conditionText));
    else if(r instanceof CSSMediaRule){if(matchMedia(r.media.mediaText).matches) walk(r.cssRules, ios);}
    else if(ios && r instanceof CSSStyleRule && el.matches(r.selectorText)) hit.push(r.style.getPropertyValue('text-size-adjust'));}}
  for(var s=0;s<document.styleSheets.length;s++){try{walk(document.styleSheets[s].cssRules,false);}catch(e){}}
  return hit;}`;
// AFMBP-2657: controls on the demo's minified copies, served broken.
const MUTATE_FILE = {
  min_css: ['demo.min.css', (s) => s.replace('overflow:hidden;overflow:clip', 'overflow:hidden')],
  min_load: ['start/handyman.html', (s) => s.replace("'/demo.min.js?v=", "'/demo.js?v=")],
};
if (NC && MUTATE_FILE[NC]) MUTATE[NC] = null;
if (NC && MUTATE[NC] === undefined) { console.error(`unknown NC=${NC}; one of ${Object.keys(MUTATE).join(', ')}`); process.exit(2); }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.xml': 'application/xml' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, path.endsWith('/') ? `${path}index.html` : path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end(); }
  let body = readFileSync(file);
  const rel = file.slice(ROOT.length + 1);
  if (NC && MUTATE_FILE[NC] && MUTATE_FILE[NC][0] === rel) {
    const s = body.toString('utf8'); const t = MUTATE_FILE[NC][1](s);
    if (t === s) { console.error(`NC=${NC}: the mutation did not land in ${rel}`); process.exit(2); }
    body = Buffer.from(t);
  } else if (NC && MUTATE[NC] && PAGES.includes(rel)) {
    const s = body.toString('utf8'); const t = MUTATE[NC](rel, s);
    if (t === s) { console.error(`NC=${NC}: the mutation did not land in ${rel}`); process.exit(2); }
    body = Buffer.from(t);
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// In-page stubs, before any script: the ingest records events, the pixel records its calls,
// and app.boltanswering.com (the button and the warm-up) is answered here instead.
const STUB = `(() => {
  window.__events = []; window.__fbq = [];
  window.fbq = function () { window.__fbq.push([].slice.call(arguments)); };
  const real = window.fetch.bind(window);
  window.fetch = (url, opts) => {
    const u = String(url && url.url || url);
    if (u.includes('/api/public/analytics/events')) {
      try { const b = JSON.parse(opts && opts.body || '{}'); for (const e of (b.events || [b])) window.__events.push({ type: e.event_type, data: e.event_data || {} }); } catch (e) {}
      return Promise.resolve(new Response('{}', { status: 200 }));
    }
    if (u === 'https://app.boltanswering.com/signup-preload.json') return Promise.resolve(new Response(JSON.stringify({ files: ['/assets/index-AAA.js', '//elsewhere.example/x.js', 'https://elsewhere.example/y.js', '/assets/index-BBB.css', 42] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    if (u.startsWith('https://app.boltanswering.com/')) return Promise.resolve(new Response('', { status: 404 }));
    return real(url, opts);
  };
})()`;

const results = [];
const check = (name, ok, info) => { results.push({ name, ok: !!ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok || info === undefined ? '' : ' ' + JSON.stringify(info)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

const prof = mkdtempSync(join(tmpdir(), 'ql-check-'));
const port = 9600 + Math.floor(Math.random() * 300);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--no-first-run', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
let ws;
try {
  let wsUrl;
  for (let i = 0; i < 100 && !wsUrl; i++) { try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch {} if (!wsUrl) await sleep(100); }
  ws = new WebSocket(wsUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.value;
  // The app's sign-up page is not loaded (the tab stays on the card): Continue's departure is kept,
  // with its fragment (a browser sends none: the request carries it apart).
  const navs = [];
  ws.addEventListener('message', (m) => { const msg = JSON.parse(m.data); if (msg.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = msg.params; navs.push(request.url + (request.urlFragment || ''));
    send('Fetch.failRequest', { requestId, errorReason: 'Aborted' }).catch(() => {}); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: 'https://app.boltanswering.com/*', resourceType: 'Document' }] });
  await send('Network.setUserAgentOverride', { userAgent: UA });
  await send('Emulation.setDeviceMetricsOverride', { width: 402, height: 749, deviceScaleFactor: 1, mobile: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
  const load = async (url) => { await send('Page.navigate', { url }); for (let i = 0; i < 100; i++) { if (await ev(`document.readyState === 'complete'`).catch(() => false)) break; await sleep(100); } await sleep(700); };
  const sitemap = readFileSync(join(ROOT, 'sitemap.xml'), 'utf8');

  for (const page of PAGES) {
    console.log(`[${page}]`);
    const url = `${BASE}/${page}?utm_source=fb&utm_medium=paid&utm_campaign=signup_offer&fbclid=QLCHECK1`;
    // Each page is a new visitor: site_landed is logged once per browser session (attribution.js).
    await send('Storage.clearDataForOrigin', { origin: BASE, storageTypes: 'all' });
    await load(url);
    const g = await ev(`(() => { const r = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().toJSON() : null; };
      const go = document.querySelector('.ql-go'), f = document.querySelector('.ql-email'), x = document.querySelector('.ql-close');
      const words = (s) => { const e = document.querySelector(s); return e ? e.innerText.replace(/\\s+/g, ' ').trim() : null; };
      const sec = document.querySelector('.ql-secure'), ss = sec && getComputedStyle(sec);
      return { card: r('.ql-card'), logo: r('.ql-logo'), close: r('.ql-close'), goBox: r('.ql-go'), fieldBox: r('.ql-email'),
        secure: r('.ql-secure'), sec: sec && { img: ss.backgroundImage, pos: ss.backgroundPosition, size: ss.backgroundSize, hidden: sec.getAttribute('aria-hidden') },
        goText: go && go.textContent.trim(), goOff: go && go.disabled, goBg: go && getComputedStyle(go).backgroundColor,
        field: f && [f.type, f.getAttribute('autocomplete'), f.getAttribute('enterkeyhint'), f.placeholder, f.labels.length && f.labels[0].textContent, f.value].join('|'),
        pitch: words('.ql-sub'), trial: words('.ql-free'), terms: words('.ql-terms'),
        links: [...document.querySelectorAll('.ql-terms a')].map((a) => [a.getAttribute('href'), a.target, a.rel].join('|')),
        quote: [...document.querySelectorAll('.ql-quote .ql-vh')].map((p) => p.textContent),
        oldCta: !!document.querySelector('.ql-cta'), closeHref: x && x.getAttribute('href'),
        robots: (document.querySelector('meta[name=robots]') || {}).content || null,
        events: window.__events.map((e) => e.type) }; })()`);
    check('card at 31,70, 337x629 (node 2142:11418)', g.card && near(g.card.left, 31) && near(g.card.top, 70) && near(g.card.width, 337) && near(g.card.height, 629), g.card);
    check('wordmark at 26.3,10, 70.7x29.3 (node 2142:11451)', g.logo && near(g.logo.left, 26.33) && near(g.logo.top, 10) && near(g.logo.width, 70.67), g.logo);
    check('close: a 44px target centred on the node\'s cross (336.5, 101.5)', g.close && near(g.close.left + 22, 336.5) && near(g.close.top + 22, 101.5) && g.close.width === 44, g.close);
    // AFMBP-2714: the email card's pieces, where the node (2955:2387) puts them on the card.
    check('the pitch, the trial line and the terms line: the node\'s words', g.pitch === 'Bolt is your professional, 24/7 receptionist that answers calls, books customers and more for less than $4 a day.' && g.trial === 'Create an account to start your FREE 30-day trial now.' && g.terms === 'By tapping “Continue”, you agree to our Privacy Policy and Terms.', [g.pitch, g.trial, g.terms]);
    check('the terms links: /privacy/ and /terms/, in a new tab', JSON.stringify(g.links) === JSON.stringify(['/privacy/|_blank|noopener', '/terms/|_blank|noopener']), g.links);
    check('the rating: its words for screen readers', JSON.stringify(g.quote) === JSON.stringify(['Brent B., Indiana', '4.9/5', '“Bolt booked a job and paid for itself in a day.”']), g.quote);
    check('the old card is gone (no "Start your free trial" link)', g.oldCta === false);
    check('field at 62,458, 275x48 (node 2955:3249)', g.fieldBox && near(g.fieldBox.left, 62, 0.05) && near(g.fieldBox.top, 458, 0.05) && near(g.fieldBox.width, 275, 0.05) && near(g.fieldBox.height, 48, 0.05), g.fieldBox);
    check('the field: an email field labelled "Email", empty, the Go key', g.field === 'email|email|go|Email|Email|', g.field);
    // AFMBP-2724: the eyebrow, "Secured" (2962:977) beside its lock (2955:3252).
    const secArt = g.sec ? (g.sec.img.match(/demo-so-[a-z]+\.svg/g) || []).join(',') : null;
    check('the eyebrow at 283,444, 44.128x10: the lock and "Secured", hidden from screen readers (nodes 2955:3252, 2962:977)', g.secure && near(g.secure.left, 283, 0.05) && near(g.secure.top, 444, 0.05) && near(g.secure.width, 44.128, 0.05) && near(g.secure.height, 10, 0.05) && secArt === 'demo-so-lock.svg,demo-so-secured.svg' && g.sec.hidden === 'true', [g.secure, g.sec]);
    check('"Secured" 11.6/1.645 in from the lock, 32.528x6.466, as the node draws it', g.sec && g.sec.pos === '0px 0px, 11.6px 1.645px' && g.sec.size === '8.571px 10px, 32.528px 6.466px', g.sec);
    check('the "Secured" drawing loads', (await ev(`new Promise((r) => { const i = new Image(); i.onload = () => r(i.naturalWidth > 0); i.onerror = () => r(false); i.src = '/assets/demo-so-secured.svg'; })`)) === true);
    check('Continue at 62,517, 275x48 (node 2956:3261)', g.goBox && near(g.goBox.left, 62, 0.05) && near(g.goBox.top, 517, 0.05) && near(g.goBox.width, 275, 0.05) && near(g.goBox.height, 48, 0.05), g.goBox);
    check('Continue reads "Continue", grey and disabled while the field is empty', g.goText === 'Continue' && g.goOff === true && g.goBg === 'rgb(203, 203, 203)', [g.goText, g.goOff, g.goBg]);
    check('close goes to the home page', g.closeHref === '/', g.closeHref);
    check('noindex', g.robots === 'noindex', g.robots);
    check('not in the sitemap', !sitemap.includes(`/${page}`));
    const pf = await ev(`[...document.querySelectorAll('link[rel=prefetch]')].map((l) => ({ href: l.href, co: l.getAttribute('crossorigin') }))`);
    check('warm-up: plain prefetches of the listed app files only (AFMBP-2564 list)', JSON.stringify(pf) === JSON.stringify([{ href: 'https://app.boltanswering.com/assets/index-AAA.js', co: null }, { href: 'https://app.boltanswering.com/assets/index-BBB.css', co: null }]), pf);
    const pc = await ev(`[...document.querySelectorAll('link[rel=preconnect]')].map((l) => l.href + (l.hasAttribute('crossorigin') ? ' crossorigin' : ''))`);
    check('preconnects: app.boltanswering.com plain and crossorigin', JSON.stringify(pc) === JSON.stringify(['https://app.boltanswering.com/', 'https://app.boltanswering.com/ crossorigin']), pc);
    check('site_landed, then signup_offer_opened once', g.events.includes('site_landed') && g.events.filter((t) => t === 'signup_offer_opened').length === 1, g.events);
    const opened = await ev(`(window.__events.find((e) => e.type === 'signup_offer_opened') || {}).data`);
    check('signup_offer_opened: trigger quick_landing, on this page', opened && opened.trigger === 'quick_landing' && opened.page === `/${page}`, opened);
    check(`signup_offer_opened carries the card's trade (${TRADE[page]})`, opened && opened.trade === TRADE[page], opened && opened.trade);

    // AFMBP-2714: an address typed, then Continue: trial_link_clicked with the card's placement and the
    // form, Meta's StartTrialClick from it, and the app's sign-up page with the address in the fragment.
    navs.length = 0;
    await ev(`document.querySelector('.ql-email').focus(), 1`);
    await send('Input.insertText', { text: ' qa-land' });
    await send('Input.insertText', { text: 'ing@example.com ' });
    await sleep(200);
    const on = await ev(`(() => { const b = document.querySelector('.ql-go'); return [b.disabled, getComputedStyle(b).backgroundColor]; })()`);
    check('typed: Continue turns blue and enabled', on[0] === false && on[1] === 'rgb(43, 127, 253)', on);
    const typedEv = await ev(`window.__events.filter((e) => e.type === 'signup_offer_email_typed').map((e) => e.data)`);
    check(`typed: signup_offer_email_typed once, with the card's trade (${TRADE[page]})`, typedEv.length === 1 && typedEv[0].trade === TRADE[page], typedEv);
    const vid = await ev(`window.boltAttr.visitorId()`);
    await ev(`document.querySelector('.ql-go').click(), 1`);
    for (let i = 0; i < 20 && !navs.length; i++) await sleep(100);
    const tap = await ev(`({ e: window.__events.filter((e) => e.type === 'trial_link_clicked').map((e) => e.data), f: window.__fbq.filter((c) => c[1] === 'StartTrialClick') })`);
    check('Continue: one trial_link_clicked, placement "signup_offer", form "email", the card\'s trade', tap.e.length === 1 && tap.e[0].placement === 'signup_offer' && tap.e[0].form === 'email' && tap.e[0].trade === TRADE[page], tap.e);
    check('Continue: Meta StartTrialClick from "signup_offer"', tap.f.length === 1 && tap.f[0][2] && tap.f[0][2].from === 'signup_offer', tap.f);
    let nav = null; try { nav = new URL(navs[0]); } catch {}
    check('Continue goes to the app\'s sign-up page: entry=card_email, the visitor id and the ad tags, the trimmed address in the fragment', !!nav && nav.origin + nav.pathname === 'https://app.boltanswering.com/signup' && nav.searchParams.get('entry') === 'card_email' && nav.searchParams.get('bvid') === vid && nav.searchParams.get('utm_campaign') === 'signup_offer' && nav.searchParams.get('fbclid') === 'QLCHECK1' && nav.hash === '#email=qa-landing%40example.com', navs);
    check('privacy: the address is not in the query string', !!nav && !/qa-landing/.test(nav.search) && !nav.searchParams.has('email'), nav && nav.search);
    const sent = await ev(`JSON.stringify(window.__events)`);
    check('privacy: no event carries the address', !/qa-landing/.test(sent));

    // The close: demo_closed for the card, then the home page.
    await ev(`(() => { const a = document.querySelector('.ql-close'); a.addEventListener('click', (e) => e.preventDefault()); a.click(); })()`);
    await sleep(300);
    const closed = await ev(`window.__events.filter((e) => e.type === 'demo_closed').map((e) => e.data)`);
    check(`close tap: demo_closed {step: signup_offer, trade: ${TRADE[page]}}`, closed.length === 1 && closed[0].step === 'signup_offer' && closed[0].trade === TRADE[page], closed);
  }

  // AFMBP-2602: under 337px the sign-up card zooms (.94, then .83 under 317px), and iPad Safari's text
  // autosizing must be off on it, or every word draws at its unzoomed size. At 337px it doesn't zoom and no
  // iOS text rule reaches it. AFMBP-2685: the landing A/B's demo card is 375px wide (its node's 402px frame),
  // so it zooms in its own steps under 400px, with the same iOS rule, and at every step each of its parts
  // (the vector line included) stays inside it and the card stays on the screen. It is measured shown
  // (?bolt_qa=1&bolt_xp=treatment).
  const T_STEPS = [[402, 1], [400, 1], [399, 0.96], [390, 0.96], [389, 0.92], [375, 0.92], [374, 0.88], [360, 0.88], [359, 0.82], [336, 0.82], [335, 0.76], [316, 0.76], [315, 0.7], [300, 0.7]];
  for (const page of PAGES) {
    console.log(`[${page}, narrow phones]`);
    for (const [w, zWant] of [[337, 1], [320, 0.94], [300, 0.83]]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 640, deviceScaleFactor: 1, mobile: true });
      await load(`${BASE}/${page}`);
      const t = await ev(`(() => { ${IOS_TSA} const k = document.querySelector('.ql-card--c'); return k ? { zoom: parseFloat(getComputedStyle(k).zoom), ios: iosTsa(k) } : null; })()`);
      const good = !!t && Math.abs(t.zoom - zWant) < 1e-6 && (zWant < 1 ? t.ios.join() === 'none' : t.ios.length === 0);
      check(`${w}px: the sign-up card ${zWant < 1 ? `zooms to ${zWant} and iOS turns text autosizing off on it` : 'does not zoom and no iOS text rule reaches it'}`, good, t);
    }
    for (const [w, zWant] of T_STEPS) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 640, deviceScaleFactor: 1, mobile: true });
      await load(`${BASE}/${page}?bolt_qa=1&bolt_xp=treatment`);
      const t = await ev(`(() => { ${IOS_TSA} const k = document.querySelector('.ql-card--t'); if (!k) return null; const c = k.getBoundingClientRect(), out = [];
        [].forEach.call(k.querySelectorAll('.qlt-body > *:not(.ql-vh), .qlt-close'), (e) => { const r = e.getBoundingClientRect();
          if (r.left < c.left - 0.5 || r.right > c.right + 0.5 || r.top < c.top - 0.5 || r.bottom > c.bottom + 0.5) out.push(e.className); });
        return { shown: getComputedStyle(k).display !== 'none', zoom: parseFloat(getComputedStyle(k).zoom), ios: iosTsa(k), left: c.left, right: c.right, vw: innerWidth, out }; })()`);
      // Under 337px the sign-up card's iOS rule (.ql-card) reaches this card too: every rule must say none.
      const good = !!t && t.shown && Math.abs(t.zoom - zWant) < 1e-6 && (zWant < 1 ? t.ios.length > 0 && t.ios.every((v) => v === 'none') : t.ios.length === 0) && t.left >= 0 && t.right <= t.vw && t.out.length === 0;
      check(`${w}px: the demo card ${zWant < 1 ? `zooms to ${zWant} and iOS turns text autosizing off on it` : 'does not zoom and no iOS text rule reaches it'}; on the screen, every part inside it`, good, t);
    }
    await ev(`(() => { localStorage.clear(); sessionStorage.clear(); return true; })()`);
  }

  // AFMBP-2657: the demo's minified copies.
  console.log('[the demo\'s minified copies]');
  const stale = staleCopies(ROOT);
  check('demo.min.css, demo-format.min.js and demo.min.js each name their source as it is now', stale.length === 0, stale);
  const trade = readFileSync(join(ROOT, 'handyman.html'), 'utf8');
  const v = (re) => (trade.match(re) || [])[1];
  const want = [`'/demo.min.css?v=${v(/href="\/?demo\.css\?v=(\d+)"/)}'`, `'/demo-format.min.js?v=${v(/src="\/?demo-format\.js\?v=(\d+)"/)}'`, `'/demo.min.js?v=${v(/src="\/?demo\.js\?v=(\d+)"/)}'`];
  for (const page of PAGES) {
    const html = await (await fetch(`${BASE}/${page}`)).text();
    check(`${page}: the demo card loads the copies at the trade pages' versions (${want.join(', ')}), none of the sources`, want.every((w) => html.includes(w)) && !/'\/demo(-format)?\.(js|css)\?/.test(html), html.match(/'\/demo[^']*'/g));
  }
  await load(`${BASE}/start/handyman.html`);
  const rules = await ev(`Promise.all(['/demo.css', '/demo.min.css'].map((f) => fetch(f, { cache: 'no-store' }).then((r) => r.text()).then((t) => { const k = new CSSStyleSheet(); k.replaceSync(t); return [].map.call(k.cssRules, (r) => r.cssText); })))`);
  const same = Array.isArray(rules) && rules[0].length > 50 && JSON.stringify(rules[0]) === JSON.stringify(rules[1]);
  const at = same || !Array.isArray(rules) ? -1 : rules[0].findIndex((r, i) => r !== rules[1][i]);
  check(`demo.min.css is the same style sheet as demo.css to Chrome (${Array.isArray(rules) ? rules[0].length : 0} rules, each the same)`, same, at < 0 ? rules : { rule: at, css: rules[0][at], min: rules[1][at] });
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill('SIGKILL'); server.close();
  await sleep(300); try { rmSync(prof, { recursive: true, force: true }); } catch {}
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length} checks, ${failed} failed${NC ? ` (NC=${NC}: expected to FAIL)` : ''}`);
process.exit(failed ? 1 : 0);
