// AFMBP-2273 — the sign-up offer: an ad link with ?signup=1 opens the demo card's frame with the
// offer, instead of the demo. AFMBP-2714: the offer is the owner's email card of 2026-11-27 (Figma
// 2955:2387 with the field empty, 2957:3273 typed; handoff contract v1 in AFMBP-2712). Drives the real
// page in headless Chrome against a fake Bolt API and checks:
//   - content and art: the card's art (the paper with the headline drawn in it) covers the card; the
//     headline's words are for screen readers only; the pitch, with the bolt wordmark drawn in the
//     room the node leaves for it, and the trial line, both live text; "Security" and its lock (the
//     node's drawings); the email field, labelled "Email"; Continue; the terms line with its two
//     links, which open in a new tab; the rating (one drawing, its words hidden text); the node's
//     black cross. Nothing of the old card: no "Start your free trial" link, no FREE box;
//   - type: the pitch and the trial line in "Bolt Times" (an installed Times New Roman through
//     local(), else Tinos; never the name "Times New Roman" first, which Android answers with its
//     own serif), 19.032 and 20.03px, black, "FREE" bold; the field Inter 16; Continue Inter Bold 16.8;
//     the terms line Inter 10.143 #787888 with #2b7ffd links;
//   - geometry: every piece where the node puts it (card-relative), the pitch's and the trial line's
//     baselines on the node's glyphs' (238/261/284/307 and 339/361), their line counts;
//   - the field and Continue: Continue grey and disabled while the field is empty or holds only
//     spaces, blue once anything is typed; no autofocus (focus starts on the dialog);
//     signup_offer_email_typed once per card open; the address in no event, cookie or storage;
//   - leaving (contract v1): Continue logs trial_link_clicked {placement: signup_offer, form: email}
//     once, holds the page until that has gone out (at most about 0.3 s, AFMBP-2344), then goes to
//     the app's sign-up page with entry=card_email, this visitor's id, the ad tags and the QA flag,
//     and the trimmed address in the fragment (#email=…), never in the query. The keyboard's Go key
//     (Enter) is Continue; a second tap does nothing more;
//   - analytics: signup_offer_opened once (never demo_opened), a close as demo_closed {step: signup_offer};
//   - closing and keyboard: the cross, Escape and the shade close it; Tab goes round the cross, the
//     field, Continue (once enabled) and the two links;
//   - the home page: /?signup=1 opens the same card (the Meta ads' landing) and Continue works there;
//   - regressions: ?talk=1 still opens the demo; a plain page opens nothing;
//   - sizes: phones 280-430, tablet 768, desktop 1024-1920 (the same card everywhere, no desktop node
//     yet): no horizontal overflow, every piece on screen and inside the card; where the card zooms
//     (under 337px), the iOS-only rule that turns iPad Safari's text autosizing off on it, and
//     nowhere else (AFMBP-2602).
// Run: node tools/signup-offer-check.mjs [siteRoot]
//      NC=<name> mutates the SERVED copy only; each must FAIL (see MUTATE).
// Nothing leaves the machine: Chrome resolves no host but 127.0.0.1, and every other request is
// answered here.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { PER_DAY_TEXT, perDayAt } from './pricing-sync.mjs';

// Absolute, so a relative root ('.') still matches the NC's '/<file>' suffix below and the mutation is served.
const ROOT = resolve(process.argv[2] ?? new URL('..', import.meta.url).pathname);
// AFMBP-2720: the per-day figure follows the standard price; tools/pricing-sync.mjs writes it and
// these checks expect what it would write for the served checkout's pricing.js.
const DAY = perDayAt(ROOT);
const NC = process.env.NC || '';
const PORT = 20000 + Math.floor(Math.random() * 10000), DBG = 30000 + Math.floor(Math.random() * 10000);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.webp': 'image/webp' };
const SIGNUP = 'https://app.boltanswering.com/signup';

const cut = (s, from, to) => { if (!s.includes(from)) throw new Error(`NC anchor missing: ${from}`); return s.split(from).join(to); };
const MUTATE = {
  // ?signup=1 is ignored: the ad link opens nothing.
  no_route: ['demo.js', (s) => cut(s, "var entry = /[?&]signup=1(&|$)/.test(q) ? 'signup' :", "var entry =")],
  // The offer is logged as a demo opened.
  demo_event: ['demo.js', (s) => cut(s, "entry === 'signup' && !s ? 'signup_offer_opened' : 'demo_opened'", "'demo_opened'")],
  // Continue is not logged.
  no_track: ['demo.js', (s) => cut(s, "var sent = track('trial_link_clicked', { placement: 'signup_offer', form: 'email' });", 'var sent = null;')],
  // Continue is logged without the form (the contract's form: 'email').
  no_form: ['demo.js', (s) => cut(s, "{ placement: 'signup_offer', form: 'email' }", "{ placement: 'signup_offer' }")],
  // The address goes in the query string (where Meta's pixel and the servers' logs would see it).
  query_email: ['demo.js', (s) => cut(s, "href += '#email=' + encodeURIComponent(v);", "href += '&email=' + encodeURIComponent(v);")],
  // The address is dropped: the app's screen would open empty.
  no_email: ['demo.js', (s) => cut(s, "href += '#email=' + encodeURIComponent(v);", '')],
  // attribution.js does not decorate the address: no visitor id, no ad tags.
  no_decorate: ['demo.js', (s) => cut(s, 'href = window.boltAttr.decorate(SO_SIGNUP);', 'href = SO_SIGNUP;')],
  // The app is not told the visitor came from the card's field.
  wrong_entry: ['demo.js', (s) => cut(s, "var SO_SIGNUP = 'https://app.boltanswering.com/signup?entry=card_email';", "var SO_SIGNUP = 'https://app.boltanswering.com/signup?entry=card';")],
  // The typing event carries the address.
  typed_leak: ['demo.js', (s) => cut(s, "if (v && !typed) { typed = true; track('signup_offer_email_typed'); }", "if (v && !typed) { typed = true; track('signup_offer_email_typed', { value: v }); }")],
  // The typing event goes on every keystroke.
  typed_every: ['demo.js', (s) => cut(s, "if (v && !typed) { typed = true; track('signup_offer_email_typed'); }", "if (v) { typed = true; track('signup_offer_email_typed'); }")],
  // Continue never turns off again (spaces enable it).
  always_on: ['demo.js', (s) => cut(s, '      go.disabled = !v;\n', '      go.disabled = false;\n')],
  // The keyboard's Go key does nothing.
  no_enter: ['demo.js', (s) => cut(s, "      if (e.key !== 'Enter' || e.isComposing) return;", '      return;')],
  // AFMBP-2344: Continue leaves at once, before its event has gone out.
  no_hold: ['demo.js', (s) => cut(s, '      setTimeout(leave, 300);\n      if (sent && sent.then) sent.then(leave, leave);', '      leave();')],
  // AFMBP-2344: Continue waits for its event however long the server takes.
  no_cap: ['demo.js', (s) => cut(s, '      setTimeout(leave, 300);\n', '')],
  // A second tap leaves (and logs) again.
  double_go: ['demo.js', (s) => cut(s, 'if (!v || soLeaving) return;', 'if (!v) return;')],
  // The field takes focus as the card opens (the owner's node: no autofocus).
  autofocus: ['demo.js', (s) => cut(s, "    ], 'signup');\n  }", "    ], 'signup');\n    setTimeout(function () { field.focus(); }, 0);\n  }")],
  // The pitch keeps the old card's words.
  old_pitch: ['demo.js', (s) => cut(s, "'is your professional, 24/7 receptionist that '", "'is your 24/7 receptionist that '")],
  // AFMBP-2720: the pitch keeps a per-day figure the standard price no longer gives.
  old_figure: ['demo.js', (s) => cut(s, `text: '${PER_DAY_TEXT.card(DAY)}'`, `text: '${PER_DAY_TEXT.card(DAY + 1)}'`)],
  // The terms links open in this tab (what was typed would be lost).
  same_tab: ['demo.js', (s) => cut(s, "h('a', { href: '/privacy/', target: '_blank', rel: 'noopener' }, ['Privacy Policy'])", "h('a', { href: '/privacy/' }, ['Privacy Policy'])")],
  // The card's art (the paper and the headline) is not drawn.
  no_art: ['demo.css', (s) => cut(s, "background:#f0e0d5 url('assets/demo-so-card.webp') center/cover no-repeat;", 'background:#fff;')],
  // The headline's screen-reader words show on top of the art.
  visible_headline: ['demo.css', (s) => cut(s, '.demo-backdrop[data-screen="signup"] :is(.demo-cm__h,.demo-so__vh){', '.demo-backdrop[data-screen="signup"] :is(.demo-so__vh){')],
  // The bolt wordmark is not drawn.
  no_wordmark: ['demo.css', (s) => cut(s, '.demo-backdrop[data-screen="signup"] .demo-cm__sub::before{\n  content:"";', '.demo-backdrop[data-screen="signup"] .demo-cm__sub::before{\n  content:none;')],
  // The pitch starts at the column's edge, under the wordmark.
  no_spacer: ['demo.css', (s) => cut(s, '.demo-so__bolt{display:inline-block;width:80.886px;', '.demo-so__bolt{display:inline-block;width:0;')],
  // The Times-first stack: Android answers "Times New Roman" with its own wider serif.
  times_first: ['demo.css', (s) => cut(s, "font-family:'Bolt Times',serif;", "font-family:'Times New Roman',Tinos,serif;")],
  // Every phone downloads Tinos, an iPhone included (its own Times New Roman never used).
  no_local: ['demo.css', (s) => cut(s, "src:local('Times New Roman'),local('TimesNewRomanPSMT'),url('/assets/fonts/tinos-400.woff2') format('woff2');", "src:url('/assets/fonts/tinos-400.woff2') format('woff2');")],
  // The pitch sits 1px off the node's baselines.
  off_baseline: ['demo.css', (s) => cut(s, '.demo-backdrop[data-screen="signup"] .demo-cm__sub{top:220.4px}', '.demo-backdrop[data-screen="signup"] .demo-cm__sub{top:221.4px}')],
  // "FREE" drops back to regular.
  regular_free: ['demo.css', (s) => cut(s, '.demo-backdrop[data-screen="signup"] .demo-so__free b{font-weight:700}', '.demo-backdrop[data-screen="signup"] .demo-so__free b{font-weight:400}')],
  // The field draws a focus ring the node does not have.
  field_ring: ['demo.css', (s) => cut(s, '  -webkit-appearance:none;appearance:none;outline:none;\n}', '  -webkit-appearance:none;appearance:none;\n}')],
  // The field loses the node's 82%.
  field_opaque: ['demo.css', (s) => cut(s, '  border:0;border-radius:12.667px;background:#fdfdff;opacity:.82;', '  border:0;border-radius:12.667px;background:#fdfdff;')],
  // The field's .333px line drawn as a border, which Chrome draws a whole 1px wide.
  field_border: ['demo.css', (s) => cut(s, 'box-shadow:inset 0 0 0 .333px #e6e6ed,0 1px 2px rgba(12,12,13,.05);', 'border:.333px solid #e6e6ed;box-shadow:0 1px 2px rgba(12,12,13,.05);')],
  // Continue stays grey once something is typed.
  grey_typed: ['demo.css', (s) => cut(s, '  border:0;border-radius:12.667px;background:#2b7ffd;color:#fff;', '  border:0;border-radius:12.667px;background:#cbcbcb;color:#fff;')],
  // Continue is blue while the field is empty.
  blue_empty: ['demo.css', (s) => cut(s, '.demo-so__go:disabled{background:#cbcbcb;', '.demo-so__go:disabled{background:#2b7ffd;')],
  // Continue moves off the node.
  off_node: ['demo.css', (s) => cut(s, 'position:absolute;left:30.4px;top:446.4px;width:275px;height:48px;', 'position:absolute;left:30.4px;top:450.4px;width:275px;height:48px;')],
  // "Security" and its lock are not drawn.
  no_secure: ['demo.css', (s) => cut(s, '.demo-backdrop[data-screen="signup"] .demo-so__secure{\n  position:absolute;', '.demo-backdrop[data-screen="signup"] .demo-so__secure{\n  display:none;position:absolute;')],
  // The rating is not drawn.
  no_quote: ['demo.css', (s) => cut(s, "background:url('assets/demo-so-quote.svg') 0 0/100% 100% no-repeat;", 'background:none;')],
  // The cross goes back to the old navy one.
  navy_close: ['demo.css', (s) => cut(s, "background:url('assets/demo-so-close.svg') center/100% 100% no-repeat;", "background:url('assets/demo-m-close.svg') center/100% 100% no-repeat;")],
  // The close button is hidden.
  close_hidden: ['demo.css', (s) => cut(s, '.demo-backdrop[data-screen="signup"] .demo-close{\n  display:flex;', '.demo-backdrop[data-screen="signup"] .demo-close{\n  display:none;')],
  // A narrow phone clips the card instead of scaling it down.
  no_zoom: ['demo.css', (s) => cut(s, '@media (max-width:336px){ .demo-backdrop[data-screen="signup"] .demo-card{zoom:.94;left:0} }', '@media (max-width:336px){ .demo-backdrop[data-screen="signup"] .demo-card{left:0} }')],
  // AFMBP-2602: iPad Safari's text autosizing left on in the zoomed card, or set to 100% (which does
  // not fix it).
  ios_autosize: ['demo.css', (s) => cut(s, '.demo-backdrop[data-screen="signup"] .demo-card{-webkit-text-size-adjust:none;text-size-adjust:none}', '.demo-backdrop[data-screen="signup"] .demo-card{}')],
  ios_tsa_100: ['demo.css', (s) => cut(s, '.demo-backdrop[data-screen="signup"] .demo-card{-webkit-text-size-adjust:none;text-size-adjust:none}', '.demo-backdrop[data-screen="signup"] .demo-card{-webkit-text-size-adjust:100%;text-size-adjust:100%}')],
};
if (NC && !MUTATE[NC]) throw new Error(`unknown NC "${NC}"; one of ${Object.keys(MUTATE).join(', ')}`);
const MUTS = !NC ? [] : [MUTATE[NC]];
for (const [file, fn] of MUTS) { const s = readFileSync(join(ROOT, file), 'utf8'); if (fn(s) === s) throw new Error(`NC ${NC} leaves ${file} unchanged`); }

const srv = createServer((req, res) => {
  try {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
    let f = join(ROOT, p);
    if (statSync(f).isDirectory()) f = join(f, 'index.html');
    let body = readFileSync(f);
    for (const [file, fn] of MUTS) if (f.endsWith('/' + file)) body = Buffer.from(fn(body.toString('utf8')));
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(PORT, '127.0.0.1');

// ---- the fake Bolt API: analytics recorded; the pricing feed configurable ----
const api = { events: [], raw: [], pricing: null, pricingDelay: 0, analyticsDelay: 0, navs: [], noTimes: false };
const reset = (pricing = null, delay = 0) => { api.events = []; api.raw = []; api.navs = []; api.pricing = pricing; api.pricingDelay = delay; api.analyticsDelay = 0; };
function apiRespond(method, url, postData) {
  const p = new URL(url).pathname;
  if (p === '/api/public/pricing') return [200, api.pricing ? { plans: { solo: api.pricing } } : {}, api.pricingDelay];
  if (p === '/api/demo/inbound/session' && method === 'POST') return [200, { sessionId: '00000000-0000-4000-8000-000000000001', code: '4321', number: '+18554973151', numberDisplay: '(855) 497-3151', telUri: 'tel:+18554973151,,4321', expiresAt: new Date(Date.now() + 600000).toISOString() }];
  if (p === '/api/public/analytics/events') {
    api.raw.push(postData || '');
    try { for (const e of JSON.parse(postData || '{}').events || []) api.events.push({ type: e.event_type, data: e.event_data || {}, at: Date.now() }); } catch {}
    return [200, { ok: true }, api.analyticsDelay];
  }
  return [200, {}];
}
const evs = (type, pred = () => true) => api.events.filter((e) => e.type === type && pred(e.data));
const AD = '/handyman.html?signup=1&utm_source=qa_src&utm_campaign=qa_camp&fbclid=qa_click';
const HOME = '/?signup=1&utm_source=qa_src&utm_campaign=qa_camp&fbclid=qa_click';
// What the checks type: an address in the reserved example.com domain, with spaces around it.
const EMAIL = 'qa-card+2714@example.com';
const TYPED = `  ${EMAIL} `;
// A page that loads unseen (a preload), until the test makes it visible.
const HIDDEN = `window.__vs = 'hidden';
Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: function(){ return window.__vs; } });
Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: function(){ return window.__vs !== 'visible'; } });`;

const PROFILE = mkdtempSync(join(tmpdir(), 'cdp-2714-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0, good = 0;
const ok = (c, m) => { if (c) good++; else { bad++; console.log(`  FAIL ${m}`); } };
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

// The node (2955:2387 / 2957:3273), card-relative CSS px: the node's own numbers plus the card's .6px
// stroke, which the body sits inside. Card 629 tall, top 65 on the node's 753 screen.
const NODE = {
  card: { w: 337, h: 629, y: 65 },
  close: { x: 283.496, y: 9.497, w: 44, h: 44 },
  // The wordmark (the node's four vectors), on the pitch's box: the same place as on the old card.
  wordmark: { x: 31.4, y: 210.9, w: 73.5, h: 30.7 },
  // The pitch's box, its words starting after the 17 spaces' room for the wordmark; the baselines of
  // its 4 lines and of the trial line's 2, on the node's outlined glyphs.
  pitch: { x: 28.7, y: 221, first: 109.586, lines: 4 },
  baselines: [238, 261, 284, 307, 339, 361],
  secure: { x: 252, y: 374, w: 49.374, h: 11.072 },
  field: { x: 31, y: 388, w: 275, h: 48 },
  go: { x: 31, y: 447, w: 275, h: 48 },
  terms: { x: 46, y: 504, w: 245 },
  quote: { x: 56, y: 540, w: 226, h: 74.146 },
};

try {
  let t = null;
  for (let i = 0; i < 100 && !t; i++) { try { t = (await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json()).find((x) => x.type === 'page'); } catch {} if (!t) await sleep(150); }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let nextId = 1; const pending = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  const CORS = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: '*' }];
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); return; }
    if (msg.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = msg.params;
    const quiet = (p) => p.catch(() => {});
    // A phone with no Times New Roman (Android): demo.css's local() names find nothing, so Tinos is drawn.
    if (api.noTimes && new URL(request.url).hostname === '127.0.0.1' && new URL(request.url).pathname === '/demo.css') {
      let css = readFileSync(join(ROOT, 'demo.css'), 'utf8');
      for (const [file, fn] of MUTS) if (file === 'demo.css') css = fn(css);
      css = css.split("local('Times New Roman'),local('TimesNewRomanPSMT')").join("local('QA No Such Font')").split("local('Times New Roman Bold'),local('TimesNewRomanPS-BoldMT')").join("local('QA No Such Font Bold')");
      return quiet(send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/css' }], body: Buffer.from(css).toString('base64') }));
    }
    if (new URL(request.url).hostname === '127.0.0.1') return quiet(send('Fetch.continueRequest', { requestId }));
    // The app's page load is stopped here (the tab stays on the offer), timed, and kept with its
    // fragment (the browser sends none: the request carries it apart, as urlFragment).
    if (new URL(request.url).hostname === 'app.boltanswering.com' && msg.params.resourceType === 'Document') {
      api.navs.push({ url: request.url + (request.urlFragment || ''), at: Date.now() });
      return quiet(send('Fetch.failRequest', { requestId, errorReason: 'Aborted' }));
    }
    if (request.method === 'OPTIONS') return quiet(send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: CORS }));
    const [code, body, delay] = /bolt-staging\.fly\.dev$/.test(new URL(request.url).hostname) ? apiRespond(request.method, request.url, request.postData) : [200, {}];
    const answer = () => quiet(send('Fetch.fulfillRequest', { requestId, responseCode: code, responseHeaders: [...CORS, { name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') }));
    return delay ? setTimeout(answer, delay) : answer();
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable'); await send('CSS.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  // A QA visit (no Meta / Google). A tap on a link is recorded with its href; the terms links'
  // new tabs are not opened (the tap is recorded, then dropped).
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: "try{localStorage.setItem('bolt_qa','1')}catch(e){}" +
      "window.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a');if(!a)return;var h=a.getAttribute('href')||'';window.__clicks=(window.__clicks||[]).concat([{href:h,target:a.getAttribute('target')||''}]);if(/^tel:/.test(h)||a.target==='_blank')e.preventDefault();});",
  });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : null; };
  const load = async (path, settle = 700) => {
    await ev('try{sessionStorage.clear();localStorage.removeItem("bolt_attr")}catch(e){}');
    await ev('window.__old = 1');
    await send('Page.navigate', { url: ORIGIN + path });
    for (let i = 0; i < 100; i++) { if ((await ev(`!window.__old && document.readyState === 'complete' && location.pathname + location.search === ${JSON.stringify(path)}`)) === true) break; await sleep(100); }
    await ev('document.fonts && document.fonts.ready.then(function(){return 1})');
    await sleep(settle);
  };
  const screen = () => ev("(document.querySelector('.demo-backdrop.open')||{getAttribute:function(){return null}}).getAttribute('data-screen')");
  const waitScreen = async (want, ms = 6000) => { for (let i = 0; i < ms / 100; i++) { if ((await screen()) === want) return true; await sleep(100); } return false; };
  const rect = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; var r=e.getBoundingClientRect(); return {x:r.left,y:r.top,w:r.width,h:r.height,cx:r.left+r.width/2,cy:r.top+r.height/2};})()`);
  const run = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; var w=document.createTreeWalker(e,NodeFilter.SHOW_TEXT), n, rs=[]; while((n=w.nextNode())){ if(!n.textContent.trim() || (n.parentElement && n.parentElement.closest('.demo-so__vh'))) continue; var g=document.createRange(); g.selectNodeContents(n); [].slice.call(g.getClientRects()).forEach(function(r){ if(r.width>0) rs.push(r); }); } if(!rs.length) return null; var x0=Math.min.apply(0,rs.map(function(r){return r.left})),x1=Math.max.apply(0,rs.map(function(r){return r.right})),y0=Math.min.apply(0,rs.map(function(r){return r.top})),y1=Math.max.apply(0,rs.map(function(r){return r.bottom})); var tops=rs.map(function(r){return r.top}).sort(function(a,b){return a-b}), lines=1; for(var i=1;i<tops.length;i++) if(tops[i]-tops[i-1]>6) lines++; return {x:x0,y:y0,w:x1-x0,h:y1-y0,cx:(x0+x1)/2,cy:(y0+y1)/2,lines:lines};})()`);
  const visible = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; var s=getComputedStyle(e); var r=e.getBoundingClientRect(); return s.display!=='none' && s.visibility!=='hidden' && r.width>0 && r.height>0;})()`);
  const text = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); return e ? e.innerText.replace(/\\s+/g,' ').trim() : null;})()`);
  let touch = false;
  const tapAt = async (x, y) => {
    if (touch) { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
    else { for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); }
    await sleep(300);
  };
  const tap = async (sel) => { const b = await rect(sel); if (!b) return false; await tapAt(b.cx, b.cy); return true; };
  const key = async (k, code, vk) => {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk });
    if (k === 'Enter') await send('Input.dispatchKeyEvent', { type: 'char', text: '\r', key: k, code, windowsVirtualKeyCode: vk });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
    await sleep(150);
  };
  // Typing as a person does: the field takes the tap (focus), then the keyboard's text.
  const typeIn = async (s) => { await ev("document.querySelector('.demo-backdrop.open .demo-so__email').focus(), 1"); await send('Input.insertText', { text: s }); await sleep(150); };
  const lastClick = () => ev('(window.__clicks||[]).slice(-1)[0]||null');
  const FOCUS = `(function(){var a=document.activeElement, k=document.querySelector('.demo-backdrop.open .demo-card'), s=a?getComputedStyle(a):null;
    return {on: !k ? 'closed' : a===k ? 'dialog' : k.contains(a) ? 'inside' : 'outside',
      desc: a ? a.tagName.toLowerCase()+(a.className?'.'+String(a.className).trim().split(/\\s+/)[0]:'')+' '+JSON.stringify((a.innerText||a.getAttribute('aria-label')||'').replace(/\\s+/g,' ').trim().slice(0,22)) : 'none',
      fv: !!a && a.matches(':focus-visible'), outline: s ? s.outlineStyle : 'none', ring: !!s && ((s.outlineStyle!=='none' && parseFloat(s.outlineWidth)>0) || s.boxShadow!=='none')};})()`;
  const tab = async (back = false) => {
    for (const type of ['rawKeyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: back ? 8 : 0 });
    await sleep(40);
    return ev(FOCUS);
  };
  const view = async (w, h, dpr, mobile) => {
    touch = mobile;
    await send('Emulation.setTouchEmulationEnabled', mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile });
  };
  const goState = () => ev("(function(){var b=document.querySelector('.demo-backdrop.open .demo-so__go'); if(!b) return null; var s=getComputedStyle(b); return {disabled:b.disabled, bg:s.backgroundColor, color:s.color, cursor:s.cursor};})()");
  // Where the browser puts each line's baseline: a zero-size marker at the start of each line (the
  // card is reloaded after, as the markers split its text).
  const baselines = () => ev(`(function(){var k=document.querySelector('.demo-backdrop.open .demo-card').getBoundingClientRect(), out=[];
    function at(sel, word, end){var root=document.querySelector('.demo-backdrop.open '+sel), m=document.createElement('span'); m.style.cssText='display:inline-block;width:0;height:0;vertical-align:baseline';
      if(end){(root.querySelector('.demo-so__big')||root).appendChild(m);} else {var w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT), n; while((n=w.nextNode())){ var i=n.textContent.indexOf(word); if(i<0||n.parentElement.closest('.demo-so__vh')) continue; var r=n.splitText(i); r.parentNode.insertBefore(m,r); break; } if(!m.parentNode) return out.push(null);}
      out.push(Math.round((m.getBoundingClientRect().top-k.top)*1000)/1000);}
    at('.demo-cm__sub','24/7'); at('.demo-cm__sub','calls,'); at('.demo-cm__sub','for less'); at('.demo-cm__sub',null,true); at('.demo-so__free','FREE'); at('.demo-so__free',null,true);
    return out;})()`);
  const isClose = (f) => /^button\.demo-close /.test(f.desc);
  const isField = (f) => /^input\.demo-so__email /.test(f.desc);
  const isGo = (f) => /^button\.demo-so__go "Continue"/.test(f.desc);
  const isLink = (name) => (f) => f.desc === `a ${JSON.stringify(name)}`;
  const HEAD = 'New jobs are calling';
  const PITCH = `Bolt is your professional, 24/7 receptionist that ${PER_DAY_TEXT.card(DAY)}`;
  const TRIAL = 'Create an account to start your FREE 30-day trial now.';
  const TERMS = 'By tapping “Continue”, you agree to our Privacy Policy and Terms.';
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  // The address, in every form it could leak in.
  const leaks = (s) => [EMAIL, encodeURIComponent(EMAIL), EMAIL.replace('@', '%40'), 'qa-card'].filter((n) => String(s).includes(n));

  // ================= phone, the node's own size =================
  await view(402, 753, 3, true);
  console.log('[phone 402x753] content, art, type, geometry');
  reset();
  await load(AD);
  ok(await waitScreen('signup'), 'phone: ?signup=1 opens the sign-up offer');
  await sleep(300);
  const card = (await rect('.demo-backdrop.open .demo-card')) || { x: 0, y: 0, w: 0, h: 0 };
  const rel = (b) => b && { x: b.x - card.x, y: b.y - card.y, w: b.w, h: b.h, cx: b.cx - card.x, cy: b.cy - card.y, lines: b.lines };
  const boxOk = (b, n, tol = 0.05) => !!b && near(b.x, n.x, tol) && near(b.y, n.y, tol) && (n.w == null || near(b.w, n.w, tol)) && (n.h == null || near(b.h, n.h, tol));
  ok(near(card.w, NODE.card.w, 0.01) && near(card.h, NODE.card.h, 0.01), `phone: card ${NODE.card.w}x${NODE.card.h} (${card.w}x${card.h})`);
  ok(near(card.y, NODE.card.y, 0.01), `phone: card where the node puts it, ${NODE.card.y}px from the top of a 753px screen (${card.y})`);
  // The art: the node's image, drawn (it loads) and covering the card.
  const art = (await ev("(function(){var s=getComputedStyle(document.querySelector('.demo-backdrop.open .demo-card'));return {img:s.backgroundImage,size:s.backgroundSize,pos:s.backgroundPosition,rep:s.backgroundRepeat};})()")) || {};
  ok(/assets\/demo-so-card\.webp/.test(art.img) && art.size === 'cover' && art.pos === '50% 50%' && art.rep === 'no-repeat', `phone: the card's art is the node's image, covering the card from its centre (${JSON.stringify(art)})`);
  const artW = await ev("new Promise(function(r){var i=new Image();i.onload=function(){r(i.naturalWidth+'x'+i.naturalHeight)};i.onerror=function(){r(null)};i.src='assets/demo-so-card.webp';})");
  // AFMBP-2657: the node's 941x1670 image at twice the size the card draws it (354x629, cover).
  ok(artW === '709x1258', `phone: the art loads, at 709x1258, twice the size the card draws it (${artW})`);
  // The headline is in the art: its words are the one heading, for screen readers only.
  const h2 = (await ev("(function(){var e=document.querySelectorAll('.demo-backdrop.open h2'); if(e.length!==1) return {n:e.length}; var s=getComputedStyle(e[0]), r=e[0].getBoundingClientRect(); return {n:1, t:e[0].textContent, clip:s.clipPath, w:r.width, h:r.height, display:s.display, vis:s.visibility};})()")) || {};
  ok(h2.n === 1 && h2.t === HEAD && h2.clip === 'inset(50%)' && h2.w <= 1 && h2.h <= 1 && h2.display !== 'none' && h2.vis === 'visible', `a11y: one heading, "${HEAD}", read out but not drawn over the art (${JSON.stringify(h2)})`);
  // The pitch and the trial line: live text, the node's words, "Bolt" read out from hidden text.
  ok((await text('.demo-cm__sub')) === PITCH, `phone: the pitch (${await text('.demo-cm__sub')})`);
  ok((await text('.demo-so__free')) === TRIAL, `phone: the trial line (${await text('.demo-so__free')})`);
  const wm = (await ev("(function(){var p=document.querySelector('.demo-backdrop.open .demo-cm__sub'), s=getComputedStyle(p,'::before'), r=p.getBoundingClientRect(), k=document.querySelector('.demo-backdrop.open .demo-card').getBoundingClientRect(); return {content:s.content, img:s.backgroundImage, x:r.left-k.left+parseFloat(s.left), y:r.top-k.top+parseFloat(s.top), w:parseFloat(s.width), h:parseFloat(s.height)};})()")) || {};
  ok(wm.content !== 'none' && wm.content !== 'normal' && /assets\/demo-so-bolt\.svg/.test(wm.img) && boxOk(wm, NODE.wordmark), `phone: the bolt wordmark is drawn where the node puts it (${JSON.stringify(wm)})`);
  const pr = rel(await rect('.demo-backdrop.open .demo-cm__sub')), pg = rel(await run('.demo-backdrop.open .demo-cm__sub')), tg = rel(await run('.demo-backdrop.open .demo-so__free'));
  const first = await ev("(function(){var p=document.querySelector('.demo-backdrop.open .demo-cm__sub'), k=document.querySelector('.demo-backdrop.open .demo-card').getBoundingClientRect(), w=document.createTreeWalker(p,NodeFilter.SHOW_TEXT), n; while((n=w.nextNode())){ if(n.parentElement.closest('.demo-so__vh')||!n.textContent.trim()) continue; var g=document.createRange(); g.setStart(n,0); g.setEnd(n,1); return g.getBoundingClientRect().left-k.left; } return null;})()");
  ok(pr && pg && near(pr.x, NODE.pitch.x, 0.05) && near(pr.y, NODE.pitch.y, 0.05) && pg.lines === NODE.pitch.lines && near(first, NODE.pitch.first, 0.1), `phone: the pitch at ${NODE.pitch.x},${NODE.pitch.y}, on ${NODE.pitch.lines} lines as the node wraps it, its words starting at ${NODE.pitch.first} after the wordmark (${pr && pg && [pr.x.toFixed(2), pr.y.toFixed(2), pg.lines, first && first.toFixed(2)]})`);
  ok(!!tg && tg.lines === 2, `phone: the trial line on 2 lines, as the node wraps it (${tg && tg.lines})`);
  // Type: "Bolt Times" (an installed Times New Roman, else Tinos), black; "FREE" bold.
  const type = (await ev("(function(){function f(sel){var e=document.querySelector('.demo-backdrop.open '+sel), s=getComputedStyle(e); return s.fontFamily+'|'+s.fontSize+'|'+s.fontWeight+'|'+s.color;} return {sub:f('.demo-cm__sub'), big:f('.demo-so__big'), free:f('.demo-so__free'), b:[].slice.call(document.querySelectorAll('.demo-backdrop.open .demo-so__free b')).map(function(b){return b.textContent+':'+getComputedStyle(b).fontWeight})};})()")) || {};
  ok(type.sub === '"Bolt Times", serif|19.032px|400|rgb(0, 0, 0)' && type.big === '"Bolt Times", serif|20.03px|400|rgb(0, 0, 0)' && type.free === '"Bolt Times", serif|19.032px|400|rgb(0, 0, 0)', `type: the pitch and the trial line in "Bolt Times", black, at the node's 19.032 and 20.03px (${JSON.stringify(type)})`);
  ok(JSON.stringify(type.b) === JSON.stringify(['FREE:700']), `type: "FREE" bold (${JSON.stringify(type.b)})`);
  // "Bolt Times": an installed Times New Roman first (local()), Tinos where there is none; never the
  // name "Times New Roman" in the stack, which Android answers with its own serif.
  const faces = await ev("(function(){var out=[]; for(var s=0;s<document.styleSheets.length;s++){var rs; try{rs=document.styleSheets[s].cssRules;}catch(e){continue;} for(var i=0;i<rs.length;i++){var r=rs[i]; if(r instanceof CSSFontFaceRule && /Bolt Times/.test(r.style.getPropertyValue('font-family'))) out.push(r.style.getPropertyValue('font-weight')+' '+r.style.getPropertyValue('src')+' '+r.style.getPropertyValue('font-display'));}} return out;})()");
  const faceOk = (w, local, file) => faces.some((f) => f.startsWith(`${w} local("${local}")`) && f.includes(`url("/assets/fonts/${file}")`) && / block$/.test(f));
  ok(faces.length === 2 && faceOk('400', 'Times New Roman', 'tinos-400.woff2') && faceOk('700', 'Times New Roman Bold', 'tinos-700.woff2'), `type: "Bolt Times" 400 and 700, each an installed Times New Roman first, then Tinos, font-display block (${JSON.stringify(faces)})`);
  // This Mac has Times New Roman: the pitch is drawn with it, through local(), nothing downloaded.
  const doc = await send('DOM.getDocument', { depth: -1 });
  const subNode = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '.demo-backdrop.open .demo-cm__sub' });
  const plat = subNode && subNode.nodeId ? (await send('CSS.getPlatformFontsForNode', { nodeId: subNode.nodeId })).fonts.map((f) => f.familyName) : [];
  ok(plat.length >= 1 && plat.every((n) => n === 'Times New Roman'), `type: the pitch is drawn in this machine's own Times New Roman (${JSON.stringify(plat)})`);
  const tinosLoaded = await ev("performance.getEntriesByType('resource').filter(function(e){return /tinos-/.test(e.name)}).length");
  ok(tinosLoaded === 0, `type: no Tinos downloaded where Times New Roman is installed (${tinosLoaded})`);
  // "Security", its lock and the rating: the node's drawings, hidden from screen readers.
  const sec = await ev("(function(){var e=document.querySelector('.demo-backdrop.open .demo-so__secure'); if(!e) return null; var s=getComputedStyle(e); return {img:s.backgroundImage, hidden:e.getAttribute('aria-hidden'), shown:s.display!=='none'&&s.visibility!=='hidden'};})()");
  ok(!!sec && sec.shown && /demo-so-lock\.svg.*demo-so-security\.svg/.test(sec.img) && sec.hidden === 'true', `phone: "Security" and its lock, the node's drawings, hidden from screen readers (${JSON.stringify(sec)})`);
  const q = await ev("(function(){var e=document.querySelector('.demo-backdrop.open .demo-so__quote'); if(!e) return null; var s=getComputedStyle(e); return {img:s.backgroundImage, shown:s.display!=='none'&&s.visibility!=='hidden', words:[].slice.call(e.querySelectorAll('.demo-so__vh')).map(function(p){return p.textContent})};})()");
  ok(!!q && q.shown && /demo-so-quote\.svg/.test(q.img) && JSON.stringify(q.words) === JSON.stringify(['Brent B., Indiana', '4.9/5', '“Bolt booked a job and paid for itself in a day.”']), `phone: the rating, the node's one drawing, its words for screen readers (${JSON.stringify(q)})`);
  for (const f of ['demo-so-lock.svg', 'demo-so-security.svg', 'demo-so-quote.svg', 'demo-so-close.svg']) {
    const sz = await ev(`new Promise(function(r){var i=new Image();i.onload=function(){r(i.naturalWidth>0)};i.onerror=function(){r(false)};i.src='assets/${f}';})`);
    ok(sz === true, `phone: assets/${f} loads`);
  }
  // The field: an email field labelled "Email", the node's look, no autofocus.
  const fd = (await ev("(function(){var e=document.querySelector('.demo-backdrop.open .demo-so__email'); if(!e) return null; var s=getComputedStyle(e); var a={}; ['type','name','inputmode','autocomplete','autocapitalize','spellcheck','enterkeyhint','maxlength','placeholder'].forEach(function(k){a[k]=e.getAttribute(k)}); return {a:a, label:e.labels&&e.labels.length===1?e.labels[0].textContent:null, autofocus:e.autofocus, font:s.fontFamily.split(',')[0].replace(/[\"']/g,'')+'|'+s.fontSize+'|'+s.fontWeight+'|'+s.color, ph:getComputedStyle(e,'::placeholder').color, bg:s.backgroundColor, radius:s.borderTopLeftRadius, pad:s.paddingLeft, opacity:s.opacity, shadow:s.boxShadow, value:e.value};})()")) || {};
  ok(JSON.stringify(fd.a) === JSON.stringify({ type: 'email', name: 'email', inputmode: 'email', autocomplete: 'email', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'go', maxlength: '254', placeholder: 'Email' }) && fd.label === 'Email' && fd.autofocus === false && fd.value === '', `phone: the field is an email field, labelled "Email", empty, placeholder "Email", the keyboard's Go key (${JSON.stringify(fd)})`);
  ok(fd.font === 'Inter|16px|400|rgb(0, 0, 0)' && fd.ph === 'rgb(120, 120, 136)' && fd.bg === 'rgb(253, 253, 255)' && fd.radius === '12.667px' && fd.pad === '11.67px' && fd.opacity === '0.82' && fd.shadow === 'rgb(230, 230, 237) 0px 0px 0px 0.333px inset, rgba(12, 12, 13, 0.05) 0px 1px 2px 0px', `phone: the field is the node's: Inter 16, #787888 placeholder, #fdfdff in a .333px #e6e6ed line, 12.667px corners, 82%, its 1px shadow, the words 11.67px in (${JSON.stringify(fd)})`);
  // Continue: grey and disabled while the field is empty; Inter Bold 16.8, white.
  const g0 = await goState();
  ok(!!g0 && g0.disabled === true && g0.bg === 'rgb(203, 203, 203)' && g0.color === 'rgb(255, 255, 255)', `phone: Continue is grey and disabled while the field is empty (${JSON.stringify(g0)})`);
  ok((await text('.demo-so__go')) === 'Continue', `phone: the button reads "Continue" (${await text('.demo-so__go')})`);
  const gf = (await ev("(function(){var s=getComputedStyle(document.querySelector('.demo-so__go')); return {font:s.fontFamily.split(',')[0].replace(/[\"']/g,'')+'|'+s.fontSize+'|'+s.fontWeight, radius:s.borderTopLeftRadius, shadow:s.boxShadow, bold:document.fonts.check('700 16.8px Inter')};})()")) || {};
  ok(gf.font === 'Inter|16.8px|700' && gf.bold === true && gf.radius === '12.667px' && gf.shadow === 'rgba(12, 12, 13, 0.1) 0px 1px 4px 0px, rgba(12, 12, 13, 0.05) 0px 1px 4px 0px', `phone: Continue is Inter Bold 16.8, 12.667px corners, the node's two shadows (${JSON.stringify(gf)})`);
  // The terms line and its links.
  ok((await text('.demo-so__terms')) === TERMS && (await run('.demo-backdrop.open .demo-so__terms')).lines === 2, `phone: the terms line, on 2 lines, broken after "our" (${await text('.demo-so__terms')})`);
  const tl = (await ev("(function(){var p=document.querySelector('.demo-backdrop.open .demo-so__terms'), s=getComputedStyle(p); return {font:s.fontFamily.split(',')[0].replace(/[\"']/g,'')+'|'+s.fontSize+'|'+s.fontWeight+'|'+s.color+'|'+s.textAlign, links:[].slice.call(p.querySelectorAll('a')).map(function(a){var c=getComputedStyle(a); return [a.textContent, a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('rel'), c.color, c.textDecorationLine].join('|')})};})()")) || {};
  ok(tl.font === 'Inter|10.143px|400|rgb(120, 120, 136)|center' && JSON.stringify(tl.links) === JSON.stringify(['Privacy Policy|/privacy/|_blank|noopener|rgb(43, 127, 253)|none', 'Terms|/terms/|_blank|noopener|rgb(43, 127, 253)|none']), `phone: the terms line Inter 10.143 #787888, centred; "Privacy Policy" and "Terms" #2b7ffd, opening in a new tab (${JSON.stringify(tl)})`);
  for (const p of ['/privacy/', '/terms/']) {
    const st = await ev(`fetch(${JSON.stringify(p)}).then(function(r){return r.status})`);
    ok(st === 200, `phone: ${p} is a page of this site (${st})`);
  }
  // What the old card had, and what the offer never shows.
  ok(!(await ev("!!document.querySelector('.demo-backdrop.open .demo-so__cta, .demo-backdrop.open .demo-cr, .demo-backdrop.open .demo-so__bubble')")) && (await ev("document.querySelector('.demo-backdrop.open .demo-card').innerText.indexOf('Start your free trial') < 0")), 'phone: no "Start your free trial" link, no tilted rating (the old card)');
  ok((await ev("getComputedStyle(document.querySelector('.demo-backdrop.open .demo-cm'),'::after').content")) === 'none', 'phone: no FREE box (the old card)');
  ok(!(await ev("!!document.querySelector('.demo-backdrop.open .demo-help')")) && (await ev("document.querySelector('.demo-backdrop.open .demo-card').innerText.indexOf('Need help') < 0")), 'phone: no help line (the node has none)');
  ok(!(await ev("!!document.querySelector('.demo-backdrop.open .demo-choice__call, .demo-backdrop.open .demo-choice__get, .demo-backdrop.open .demo-choice__when, .demo-backdrop.open .demo-c__live')")), 'phone: none of the demo\'s ways in, no "Available"');
  ok((await visible('.demo-close')) && /demo-so-close\.svg/.test(await ev("getComputedStyle(document.querySelector('.demo-close'),'::before').backgroundImage")), 'phone: the close button shows, drawn with the node\'s own (black) cross');
  // Geometry: every piece where the node puts it.
  for (const [k, sel] of [['close', '.demo-close'], ['secure', '.demo-backdrop.open .demo-so__secure'], ['field', '.demo-backdrop.open .demo-so__email'], ['go', '.demo-backdrop.open .demo-so__go'], ['quote', '.demo-backdrop.open .demo-so__quote']]) {
    const b = rel(await rect(sel)), n = NODE[k];
    ok(boxOk(b, n), `phone: ${k} where the node puts it (${JSON.stringify(b)} vs ${JSON.stringify(n)})`);
  }
  const tb = rel(await rect('.demo-backdrop.open .demo-so__terms'));
  ok(!!tb && near(tb.x, NODE.terms.x, 0.05) && near(tb.y, NODE.terms.y, 0.05) && near(tb.w, NODE.terms.w, 0.05), `phone: the terms line's box where the node puts it (${JSON.stringify(tb)})`);
  ok((await ev("(function(){var b=document.querySelector('.demo-close'), r=b.getBoundingClientRect(); return document.elementFromPoint(r.left+r.width/2, r.top+r.height/2) === b;})()")) === true, 'phone: the close button takes a tap at its centre (nothing on top of it)');
  for (const sel of ['.demo-so__email', '.demo-so__go']) {
    ok((await ev(`(function(){var b=document.querySelector('.demo-backdrop.open ${sel}'), r=b.getBoundingClientRect(); return document.elementFromPoint(r.left+r.width/2, r.top+r.height/2) === b;})()`)) === true, `phone: ${sel} takes a tap at its centre`);
  }
  const bl = await baselines();
  ok(Array.isArray(bl) && bl.length === 6 && bl.every((v, i) => v !== null && near(v, NODE.baselines[i], 0.1)), `phone: the pitch's and the trial line's baselines on the node's (${JSON.stringify(bl)} vs ${JSON.stringify(NODE.baselines)})`);

  console.log('[phone] a phone without Times New Roman (Android): Tinos, the same lines');
  api.noTimes = true;
  reset();
  await load(AD, 1200);
  ok(await waitScreen('signup'), 'no Times: offer open');
  await ev('document.fonts.ready.then(function(){return 1})');
  const doc2 = await send('DOM.getDocument', { depth: -1 });
  const plat2 = [];
  for (const sel of ['.demo-backdrop.open .demo-cm__sub', '.demo-backdrop.open .demo-so__free b']) {
    const n = await send('DOM.querySelector', { nodeId: doc2.root.nodeId, selector: sel });
    if (n && n.nodeId) plat2.push(...(await send('CSS.getPlatformFontsForNode', { nodeId: n.nodeId })).fonts.map((f) => f.familyName));
  }
  ok(plat2.length >= 2 && plat2.every((n) => n === 'Tinos'), `no Times: the pitch and "FREE" are drawn in Tinos, never another serif (${JSON.stringify(plat2)})`);
  const lines2 = [await run('.demo-backdrop.open .demo-cm__sub'), await run('.demo-backdrop.open .demo-so__free')].map((g) => g && g.lines);
  ok(JSON.stringify(lines2) === '[4,2]', `no Times: the same lines, 4 and 2 (${JSON.stringify(lines2)})`);
  const bl2 = await baselines();
  ok(Array.isArray(bl2) && bl2.every((v, i) => v !== null && near(v, NODE.baselines[i], 0.1)), `no Times: the same baselines (${JSON.stringify(bl2)})`);
  api.noTimes = false;

  console.log('[phone] the field and Continue');
  reset();
  await load(AD);
  ok(await waitScreen('signup'), 'field: offer open');
  const f0 = await ev(FOCUS);
  ok(f0.on === 'dialog', `field: focus starts on the dialog, not the field (no autofocus) (${f0.on} ${f0.desc})`);
  await tap('.demo-backdrop.open .demo-so__go');
  await sleep(500);
  ok(evs('trial_link_clicked').length === 0 && api.navs.length === 0, `field: a tap on the grey Continue does nothing (${evs('trial_link_clicked').length} events, ${api.navs.length} departures)`);
  await typeIn(TYPED.slice(0, 2));
  await key('Enter', 'Enter', 13);
  await sleep(400);
  const gs = await goState();
  ok(gs.disabled === true && gs.bg === 'rgb(203, 203, 203)' && api.navs.length === 0 && evs('trial_link_clicked').length === 0, `field: spaces alone keep Continue grey and disabled, and the Go key does nothing (${JSON.stringify(gs)})`);
  ok(evs('signup_offer_email_typed').length === 0, `field: spaces alone are not typing (${evs('signup_offer_email_typed').length})`);
  await typeIn(TYPED.slice(2, 8));
  const g1 = await goState();
  ok(g1.disabled === false && g1.bg === 'rgb(43, 127, 253)' && g1.color === 'rgb(255, 255, 255)' && g1.cursor === 'pointer', `field: Continue turns blue and enabled once anything is typed (${JSON.stringify(g1)})`);
  await typeIn(TYPED.slice(8));
  await sleep(300);
  ok(evs('signup_offer_email_typed').length === 1, `field: signup_offer_email_typed once for the whole address (${evs('signup_offer_email_typed').length})`);
  ok((await ev("document.querySelector('.demo-so__email').value")) === EMAIL, 'field: it holds the address (an email field drops the spaces typed around it)');
  const ring = await ev("(function(){var e=document.querySelector('.demo-so__email'); var s=getComputedStyle(e); return document.activeElement===e ? s.outlineStyle+' '+s.outlineWidth : 'not focused';})()");
  ok(/^none /.test(ring), `field: no focus ring while typing, as the node draws it (${ring})`);
  const stored = await ev("(function(){var s=[]; try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i); s.push(k+'='+localStorage.getItem(k));}}catch(e){} try{for(var j=0;j<sessionStorage.length;j++){var k2=sessionStorage.key(j); s.push(k2+'='+sessionStorage.getItem(k2));}}catch(e){} return s.join('\\n')+'\\n'+document.cookie;})()");
  ok(leaks(stored).length === 0, `privacy: the address is in no cookie or storage (${leaks(stored).join(',')})`);
  const vid = await ev('window.boltAttr && window.boltAttr.visitorId()');
  const t0 = Date.now();
  await tap('.demo-backdrop.open .demo-so__go');
  for (let i = 0; i < 30 && !api.navs.length; i++) await sleep(100);
  await tap('.demo-backdrop.open .demo-so__go');
  await sleep(800);
  const tcs = evs('trial_link_clicked');
  ok(tcs.length === 1 && tcs[0].data.placement === 'signup_offer' && tcs[0].data.form === 'email' && tcs[0].data.trade === 'handyman', `leaving: Continue logs trial_link_clicked {placement: signup_offer, form: email} once, a second tap nothing more (${JSON.stringify(tcs.map((e) => e.data))})`);
  ok(api.navs.length === 1, `leaving: one departure for two taps (${api.navs.length})`);
  let u = null; try { u = new URL(api.navs[0].url); } catch {}
  ok(!!u && u.origin + u.pathname === SIGNUP && u.searchParams.get('entry') === 'card_email' && u.searchParams.get('bvid') === vid && u.searchParams.get('utm_source') === 'qa_src' && u.searchParams.get('utm_campaign') === 'qa_camp' && u.searchParams.get('fbclid') === 'qa_click' && u.searchParams.get('bolt_qa') === '1', `leaving: to the app's sign-up page with entry=card_email, this visitor's id, the ad tags and the QA flag (${u && u.origin + u.pathname + u.search})`);
  ok(!!u && u.hash === '#email=' + encodeURIComponent(EMAIL), `leaving: the trimmed address in the fragment, encoded (${u && u.hash})`);
  ok(!!u && leaks(u.origin + u.pathname + u.search).length === 0 && !u.searchParams.has('email'), `privacy: the address is not in the query string (${u && u.search})`);
  ok(api.navs.length === 1 && api.navs[0].at - t0 < 1500, 'leaving: the page leaves promptly');
  const sentAll = api.raw.join('\n');
  ok(leaks(sentAll).length === 0, `privacy: no event carries the address (${leaks(sentAll).join(',')})`);
  ok(evs('demo_opened').length === 0 && evs('signup_offer_opened').length === 1, `events: signup_offer_opened once, no demo_opened (${evs('signup_offer_opened').length}/${evs('demo_opened').length})`);
  ok(evs('signup_offer_opened', (d) => d.trigger === 'ad_link' && d.attr && d.attr.utm_source === 'qa_src' && d.attr.click_id === 'qa_click').length === 1, 'attribution: signup_offer_opened from the ad link, with the ad tags');

  console.log('[phone] the keyboard\'s Go key is Continue');
  reset();
  await load(AD);
  ok(await waitScreen('signup'), 'go key: offer open');
  await typeIn(EMAIL);
  await key('Enter', 'Enter', 13);
  for (let i = 0; i < 30 && !api.navs.length; i++) await sleep(100);
  let u2 = null; try { u2 = new URL(api.navs[0].url); } catch {}
  ok(evs('trial_link_clicked', (d) => d.placement === 'signup_offer' && d.form === 'email').length === 1 && !!u2 && u2.hash === '#email=' + encodeURIComponent(EMAIL) && u2.searchParams.get('entry') === 'card_email', `go key: Enter in the field leaves as Continue does, logged once (${api.navs[0] && api.navs[0].url})`);

  console.log('[phone] leaving: Continue waits for its event, never long (AFMBP-2344)');
  const tapTimed = async (delay) => {
    reset(); await load(AD); await waitScreen('signup'); await sleep(300);
    await typeIn(EMAIL);
    api.analyticsDelay = delay;
    const t1 = Date.now();
    await tap('.demo-backdrop.open .demo-so__go');
    for (let i = 0; i < 50 && !api.navs.length; i++) await sleep(100);
    const e = evs('trial_link_clicked', (d) => d.placement === 'signup_offer')[0], n = api.navs[0];
    api.analyticsDelay = 0;
    return { event: e ? e.at - t1 : null, leave: n ? n.at - t1 : null, url: n ? n.url : null };
  };
  const held = await tapTimed(150);
  ok(held.event !== null && held.leave !== null && held.leave >= held.event + 140 && /[?&]bvid=/.test(held.url) && held.url.indexOf(SIGNUP) === 0,
    `Continue holds the page until its event has gone out (server answers in 150 ms), then leaves for the sign-up page (${JSON.stringify({ event: held.event, leave: held.leave })})`);
  const capped = await tapTimed(3000);
  ok(capped.event !== null && capped.leave !== null && capped.leave <= 450,
    `Continue never waits past about 0.3 s when the server hangs (${JSON.stringify({ event: capped.event, leave: capped.leave })})`);

  console.log('[phone] a preloaded page builds the card only once it is seen (AFMBP-2010)');
  // An in-app browser preloads the ad page HIDDEN; the card is only built when someone looks.
  const hidden = await send('Page.addScriptToEvaluateOnNewDocument', { source: HIDDEN });
  reset();
  await load(AD, 1500);
  ok((await screen()) === null && (await ev('document.visibilityState')) === 'hidden', 'preload: a hidden page builds no card yet');
  await ev("window.__vs = 'visible'; document.dispatchEvent(new Event('visibilitychange')); 1");
  ok(await waitScreen('signup'), 'preload: the card opens once the page is seen');
  for (let i = 0; i < 30 && !evs('signup_offer_opened').length; i++) await sleep(100);
  ok(evs('signup_offer_opened').length === 1, `preload: signup_offer_opened once, when it is seen (${evs('signup_offer_opened').length})`);
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: hidden.identifier });

  console.log('[phone] closing');
  reset();
  await load(AD);
  ok(await waitScreen('signup'), 'close: offer open');
  const xb = await rect('.demo-close');
  if (xb) await tapAt(xb.cx, xb.cy);
  ok(!!xb && (await screen()) === null, 'close: a tap on the cross closes the offer');
  ok(evs('demo_closed', (d) => d.step === 'signup_offer').length === 1 && evs('demo_closed').length === 1, `close: demo_closed once, step signup_offer (${JSON.stringify(evs('demo_closed').map((e) => e.data.step))})`);
  const xr = await ev("(function(){var v=document.querySelector(':focus-visible'); return v ? v.tagName.toLowerCase()+'.'+String(v.className).split(' ')[0] : null;})()");
  ok(!xr, `close: after the tap no ring shows anywhere (${xr})`);
  reset();
  await load(AD);
  ok(await waitScreen('signup'), 'close: offer open again');
  const sp = await ev("(function(){var b=document.querySelector('.demo-backdrop.open'), p=[[6,innerHeight-6],[6,innerHeight/2],[innerWidth-6,innerHeight-6],[innerWidth/2,innerHeight-6]]; for(var i=0;i<p.length;i++){ if(document.elementFromPoint(p[i][0],p[i][1])===b) return {x:p[i][0],y:p[i][1]}; } return null;})()");
  if (sp) await tapAt(sp.x, sp.y);
  ok(!!sp && (await screen()) === null, 'close: a tap on the shade closes it');

  console.log('[phone] keyboard: focus starts on the dialog; Tab goes round the cross, the field, Continue and the links');
  reset();
  await load(AD);
  ok(await waitScreen('signup'), 'keyboard: offer open');
  const k0 = await ev(FOCUS);
  // The card's hairline is a painted inset shadow, not a ring: the dialog's outline is what must stay off.
  ok(k0.on === 'dialog' && k0.outline === 'none', `keyboard: focus is on the dialog as it opens, and it draws no ring (${k0.on} ${k0.outline})`);
  const fwd = [await tab(), await tab(), await tab(), await tab(), await tab()];
  ok(isClose(fwd[0]) && isField(fwd[1]) && isLink('Privacy Policy')(fwd[2]) && isLink('Terms')(fwd[3]) && isClose(fwd[4]), `keyboard: with the field empty, Tab goes the cross, the field, the two links, then round (Continue is off) (${fwd.map((f) => f.desc).join(' > ')})`);
  ok(fwd.every((f) => f.on === 'inside'), 'keyboard: Tab never leaves the dialog');
  await tab();
  await send('Input.insertText', { text: EMAIL });
  await sleep(150);
  const fwd2 = [await tab(), await tab(), await tab(), await tab()];
  ok(isGo(fwd2[0]) && isLink('Privacy Policy')(fwd2[1]) && isLink('Terms')(fwd2[2]) && isClose(fwd2[3]), `keyboard: once something is typed, Tab stops on Continue after the field (${fwd2.map((f) => f.desc).join(' > ')})`);
  const bwd = [await tab(true), await tab(true), await tab(true)];
  ok(isLink('Terms')(bwd[0]) && isLink('Privacy Policy')(bwd[1]) && isGo(bwd[2]) && bwd.every((f) => f.on === 'inside'), `keyboard: Shift+Tab goes back round (${bwd.map((f) => f.desc).join(' > ')})`);
  await key('Enter', 'Enter', 13);
  for (let i = 0; i < 30 && !api.navs.length; i++) await sleep(100);
  ok(api.navs.length === 1 && evs('trial_link_clicked', (d) => d.form === 'email').length === 1, 'keyboard: Enter on Continue leaves, logged once');
  reset();
  await load(AD);
  ok(await waitScreen('signup'), 'keyboard: offer open, for the links');
  await tab(); await tab(); await tab();
  await key('Enter', 'Enter', 13);
  const lk = await lastClick();
  ok(!!lk && lk.href === '/privacy/' && lk.target === '_blank' && (await screen()) === 'signup', `keyboard: Enter on "Privacy Policy" opens it in a new tab, the card stays (${JSON.stringify(lk)})`);
  reset();
  await load(AD);
  ok(await waitScreen('signup'), 'keyboard: offer open, to close it');
  await key('Escape', 'Escape', 27);
  ok((await screen()) === null && evs('demo_closed', (d) => d.step === 'signup_offer').length === 1, 'keyboard: Escape closes it (demo_closed, step signup_offer)');

  console.log('[phone] the home page: /?signup=1 (the Meta ads\' landing)');
  reset();
  await load(HOME);
  ok(await waitScreen('signup'), 'home: /?signup=1 opens the sign-up offer');
  ok((await text('.demo-cm__sub')) === PITCH && (await goState()).disabled === true, 'home: the same card, Continue grey');
  ok(evs('signup_offer_opened', (d) => d.page === '/' && d.trigger === 'ad_link').length === 1 && evs('demo_opened').length === 0, `home: signup_offer_opened once, on "/", from the ad link (${JSON.stringify(evs('signup_offer_opened').map((e) => e.data.page))})`);
  const hb = rel(await rect('.demo-backdrop.open .demo-so__go'));
  ok(boxOk({ ...hb, x: hb.x, y: hb.y }, NODE.go), `home: Continue where the node puts it (${JSON.stringify(hb)})`);
  await typeIn(EMAIL);
  const hvid = await ev('window.boltAttr && window.boltAttr.visitorId()');
  await tap('.demo-backdrop.open .demo-so__go');
  for (let i = 0; i < 30 && !api.navs.length; i++) await sleep(100);
  let u3 = null; try { u3 = new URL(api.navs[0].url); } catch {}
  ok(!!u3 && u3.origin + u3.pathname === SIGNUP && u3.searchParams.get('entry') === 'card_email' && u3.searchParams.get('bvid') === hvid && u3.searchParams.get('fbclid') === 'qa_click' && u3.hash === '#email=' + encodeURIComponent(EMAIL), `home: Continue leaves for the sign-up page, decorated, the address in the fragment (${api.navs[0] && api.navs[0].url})`);
  ok(evs('trial_link_clicked', (d) => d.placement === 'signup_offer' && d.form === 'email' && d.page === '/').length === 1 && leaks(api.raw.join('\n')).length === 0, 'home: trial_link_clicked {signup_offer, email} on "/", and no event carries the address');

  console.log('[phone] the demo and plain pages are unchanged');
  reset();
  await load('/handyman.html?talk=1');
  ok(await waitScreen('choice'), '?talk=1 still opens the demo\'s choice');
  ok(evs('demo_opened').length === 1 && evs('signup_offer_opened').length === 0, `?talk=1: demo_opened once, no signup_offer_opened (${evs('demo_opened').length}/${evs('signup_offer_opened').length})`);
  reset();
  await load('/handyman.html?signup=1&talk=1');
  ok(await waitScreen('signup'), '?signup=1 wins over ?talk on the same link');
  reset();
  await load('/handyman.html', 1200);
  ok((await screen()) === null && evs('signup_offer_opened').length === 0 && evs('demo_opened').length === 0, 'a plain page opens nothing');
  reset();
  await load('/handyman.html?signup=0', 1200);
  ok((await screen()) === null, '?signup=0 opens nothing');

  // ================= sizes =================
  const SIZES = [[280, 653, 2, true], [320, 568, 2, true], [360, 740, 3, true], [375, 667, 2, true], [390, 844, 3, true], [412, 915, 2.625, true], [430, 932, 3, true], [768, 1024, 2, true], [1024, 768, 1, false], [1280, 800, 1, false], [1920, 1200, 1, false]];
  for (const [w, h, dpr, mobile] of SIZES) {
    await view(w, h, dpr, mobile);
    reset();
    await load('/handyman.html');
    const pageOver = await ev('document.documentElement.scrollWidth - innerWidth');
    await load(AD);
    ok(await waitScreen('signup'), `${w}x${h}: offer`);
    await sleep(300);
    const o = await ev("(function(){var b=document.querySelector('.demo-backdrop.open'); return {doc:document.documentElement.scrollWidth-innerWidth, bd:b?b.scrollWidth-b.clientWidth:1};})()");
    ok(o.doc <= Math.max(0, pageOver) && o.bd <= 0, `${w}x${h}: the offer adds no horizontal overflow (${JSON.stringify(o)}; the page alone ${pageOver})`);
    const c = (await rect('.demo-backdrop.open .demo-card')) || { x: -1, y: 0, w: 0, h: 0 };
    ok(c.x >= 0 && c.x + c.w <= w, `${w}x${h}: the card inside the viewport (${c.x.toFixed(1)}..${(c.x + c.w).toFixed(1)})`);
    ok(w >= 337 ? Math.abs(c.w - 337) < 0.01 : c.w < w && c.w > w - 40, `${w}x${h}: the card is ${w >= 337 ? "the node's 337px" : 'scaled to fit'} (${c.w.toFixed(2)})`);
    // The field and Continue: inside the card and on screen (the page scrolls the card if needed).
    for (const [name, sel] of [['the field', '.demo-so__email'], ['Continue', '.demo-so__go'], ['"Security"', '.demo-so__secure'], ['the terms line', '.demo-so__terms'], ['the rating', '.demo-so__quote']]) {
      const pb = await rect(`.demo-backdrop.open ${sel}`);
      ok(!!pb && pb.x >= c.x && pb.x + pb.w <= c.x + c.w && pb.y >= c.y && pb.y + pb.h <= c.y + c.h + 0.5 && pb.w > 0, `${w}x${h}: ${name} inside the card (${pb && [pb.x.toFixed(1), (pb.x + pb.w).toFixed(1), pb.y.toFixed(1), (pb.y + pb.h).toFixed(1), (c.y + c.h).toFixed(1)]})`);
    }
    const x = await rect('.demo-close');
    ok(!!x && (await visible('.demo-close')) && x.x >= c.x && x.x + x.w <= c.x + c.w && x.y >= 0 && x.w >= 36, `${w}x${h}: the close button inside the card and on screen, at least 36px`);
    for (const [sel, want] of [['.demo-cm__sub', 4], ['.demo-so__free', 2], ['.demo-so__terms', 2], ['.demo-so__go', 1]]) {
      const g = await run(`.demo-backdrop.open ${sel}`);
      ok(g && g.x >= c.x + 2 && g.x + g.w <= c.x + c.w - 2 && g.lines === want, `${w}x${h}: ${sel} on ${want} line(s), every word inside the card (${g && [g.x.toFixed(1), (g.x + g.w).toFixed(1), g.lines]})`);
    }
    // The pitch's words stay clear of "Security" and the field.
    const gap = await ev("(function(){var r=document.querySelector('.demo-backdrop.open .demo-so__free').getBoundingClientRect(), s=document.querySelector('.demo-backdrop.open .demo-so__secure').getBoundingClientRect(); return s.top - r.bottom;})()");
    ok(gap > 0, `${w}x${h}: the trial line ends above "Security" (${gap.toFixed(2)}px)`);
    // AFMBP-2602: where the card zooms, iPad Safari's text autosizing must be off on it, or every word
    // draws at its unzoomed size; where it does not, no iOS text rule reaches it.
    const t = await ev(`(function(){${IOS_TSA} var k=document.querySelector('.demo-backdrop.open .demo-card'); return k ? {zoom:parseFloat(getComputedStyle(k).zoom), ios:iosTsa(k)} : null;})()`);
    ok(!!t && (t.zoom < 1 ? t.ios.join() === 'none' : t.ios.length === 0), `${w}x${h}: ${t && t.zoom < 1 ? `the card zooms to ${t.zoom} and iOS turns text autosizing off on it` : 'the card does not zoom and no iOS text rule reaches it'} (${t && JSON.stringify(t.ios)})`);
  }

  console.log(bad ? `\n${bad} FAILED, ${good} passed${NC ? ` (negative control: ${NC})` : ''}` : `\nALL PASS (${good} checks)${NC ? ` — negative control ${NC} did NOT bite` : ''}`);
  ws.close();
} finally {
  chrome.kill('SIGKILL'); srv.close();
  await sleep(300); rmSync(PROFILE, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
