// AFMBP-2273 — the sign-up offer (Figma 2718:3312): an ad link with ?signup=1 opens the demo
// card's frame with the offer and one blue "Start your free trial" into the sign-up flow, instead of the
// demo. Drives the real page in headless Chrome against a fake Bolt API and checks:
//   - content and art (the "New jobs are calling" design of 2026-11-02, AFMBP-2495): the card's
//     art (the paper with the headline drawn in it) is drawn and covers the card; the headline's
//     words are there for screen readers only; the pitch, with the bolt wordmark drawn in the
//     room the node leaves for it at the start of its first line; the boxed FREE line; in the
//     tilted speech bubble, the reviewer, five stars, "4.9/5" and the testimonial; the close
//     cross. No help line, trial line, logo, pill or watermark (v5 dropped them), none of the
//     demo's ways in, and no "Available now";
//   - type: the pitch and the FREE line in Times New Roman (Tinos where a phone has none: the same
//     widths, so the same lines), black; "FREE" and "today." bold; the reviewer's name bold; the
//     testimonial navy italic; the pitch as the node words it (no comma after "customers");
//   - geometry: each piece where it sits once matched to the node's glyphs (card-relative); the
//     rating turned 3.168° about its bubble's corner, the stars and score turned .148° back;
//   - the link: "Start your free trial" goes to the sign-up flow carrying this visitor's id, ad tags and
//     the QA flag (attribution.js decorates it as it is tapped);
//   - leaving (AFMBP-2344): "Start your free trial" holds the page until its event has gone out, at most
//     about 0.3 s, then follows its link (the page load is stopped at the network and timed);
//   - analytics: signup_offer_opened once (never demo_opened), the tap logged once as
//     trial_link_clicked {placement: signup_offer}, a close as demo_closed {step: signup_offer};
//   - closing and keyboard: the cross, Escape and the shade close it; focus starts on the
//     dialog, Tab goes round the cross and "Start your free trial";
//   - regressions: ?talk=1 still opens the demo; a plain page opens nothing;
//   - sizes: phones 280-430, tablet 768, desktop 1024-1920 (the same card everywhere, no
//     desktop node yet): no horizontal overflow, every piece on screen and inside the card.
// Run: node tools/signup-offer-check.mjs [siteRoot]
//      NC=<name> mutates the SERVED copy only; each must FAIL (see MUTATE).
// Nothing leaves the machine: Chrome resolves no host but 127.0.0.1, and every other request is
// answered here.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';

// Absolute, so a relative root ('.') still matches the NC's '/<file>' suffix below and the mutation is served.
const ROOT = resolve(process.argv[2] ?? new URL('..', import.meta.url).pathname);
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
  // "Start your free trial" goes somewhere else.
  cta_href: ['demo.js', (s) => cut(s, "class: 'demo-btn demo-so__cta', href: 'https://app.boltanswering.com/signup'", "class: 'demo-btn demo-so__cta', href: '/'")],
  // The tap is not logged.
  no_track: ['demo.js', (s) => cut(s, "var sent = track('trial_link_clicked', { placement: 'signup_offer' });", 'var sent = null;')],
  // AFMBP-2344: "Start your free trial" leaves at once (the browser's own navigation), not after its event.
  no_hold: ['demo.js', (s) => cut(s, 'if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;', 'return;')],
  // AFMBP-2344: "Start your free trial" waits for its event however long the server takes.
  no_cap: ['demo.js', (s) => cut(s, '      setTimeout(go, 300);\n', '')],
  // The button keeps an old label.
  old_label: ['demo.js', (s) => cut(s, "}, ['Start your free trial']);", "}, ['Start now']);")],
  // "Start your free trial" goes back to v4's yellow.
  yellow_cta: ['demo.js', (s) => cut(s, "class: 'demo-btn demo-so__cta'", "class: 'demo-btn demo-btn--yellow demo-so__cta'")],
  // The pitch keeps the comma the owner took out.
  comma_back: ['demo.js', (s) => cut(s, 'answers calls and books customers so you never miss a job again.', 'answers calls and books customers, so you never miss a job again.')],
  // The FREE line keeps "setup" as one word for the verb (D3, owner 11-09: "set up").
  setup_typo: ['demo.js', (s) => cut(s, "'to set up an assistant. Get started '", "'to setup an assistant. Get started '")],
  // The reviewer line is missing.
  no_who: ['demo.js', (s) => cut(s, "        h('p', { class: 'demo-so__who' }, [h('b', { text: 'Brent B. ' }), 'Indiana']),\n", '')],
  // The testimonial goes back to v4's words.
  old_quote: ['demo.js', (s) => cut(s, '“I was losing jobs to voicemail and even paid $250 a week for someone to answer my phone. Bolt booked a job and paid for itself in a day.”', '“I was paying $250 a week for someone to answer my phone and book work. Bolt booked a job and paid for itself in a day.”')],
  // The help line comes back under the rating.
  help_line: ['demo.js', (s) => cut(s, "      ])\n    ], 'signup');", "      ]),\n      helpLine()\n    ], 'signup');")],
  // The card's art (the paper and the headline) is not drawn.
  no_art: ['demo.css', (s) => cut(s, "background:#f0e0d5 url('assets/demo-so-card.webp') center/cover no-repeat;", 'background:#fff;')],
  // The headline's screen-reader words show on top of the art.
  visible_headline: ['demo.css', (s) => cut(s, '.demo-backdrop[data-screen="signup"] :is(.demo-cm__h,.demo-so__vh){', '.demo-backdrop[data-screen="signup"] :is(.demo-so__vh){')],
  // The bolt wordmark is not drawn.
  no_wordmark: ['demo.css', (s) => cut(s, '.demo-backdrop[data-screen="signup"] .demo-cm__sub::before{\n  content:"";', '.demo-backdrop[data-screen="signup"] .demo-cm__sub::before{\n  content:none;')],
  // The pitch starts at the column's edge, under the wordmark.
  no_spacer: ['demo.css', (s) => cut(s, '.demo-so__bolt{display:inline-block;width:80.886px;', '.demo-so__bolt{display:inline-block;width:0;')],
  // The pitch and the FREE line fall back to the page's sans-serif.
  wrong_font: ['demo.css', (s) => cut(s, "font-family:'Times New Roman',Tinos,serif;", 'font-family:inherit;')],
  // Phones without Times New Roman get whatever serif they have (different widths, different lines).
  no_tinos: ['demo.css', (s) => cut(s, "font-family:'Times New Roman',Tinos,serif;", "font-family:'Times New Roman',serif;")],
  // The FREE line's box is not drawn.
  no_box: ['demo.css', (s) => cut(s, '.demo-backdrop[data-screen="signup"] .demo-cm::after{\n  content:"";', '.demo-backdrop[data-screen="signup"] .demo-cm::after{\n  content:none;')],
  // "FREE" and "today." drop back to regular.
  regular_free: ['demo.css', (s) => cut(s, '.demo-so__free b{font-weight:700}', '.demo-so__free b{font-weight:400}')],
  // "Start your free trial" drops back to regular (the owner set it Bold, 11-09).
  regular_cta: ['demo.css', (s) => cut(s, 'font-size:22px;font-weight:700;line-height:21px;text-decoration:none;', 'font-size:22px;font-weight:400;line-height:21px;text-decoration:none;')],
  // The rating sits level instead of tilted.
  flat_rating: ['demo.css', (s) => cut(s, '  transform:rotate(3.168deg);transform-origin:0 0;\n', '')],
  // The close button is hidden.
  close_hidden: ['demo.css', (s) => cut(s, '.demo-backdrop[data-screen="signup"] .demo-close{\n  display:flex;', '.demo-backdrop[data-screen="signup"] .demo-close{\n  display:none;')],
  // "Start your free trial" moves off the node.
  off_node: ['demo.css', (s) => cut(s, 'position:absolute;left:43.4px;top:412.4px;width:252px;height:49px;', 'position:absolute;left:43.4px;top:417.4px;width:252px;height:49px;')],
  // A narrow phone clips the card instead of scaling it down.
  no_zoom: ['demo.css', (s) => cut(s, '@media (max-width:336px){ .demo-backdrop[data-screen="signup"] .demo-card{zoom:.94;left:0} }', '@media (max-width:336px){ .demo-backdrop[data-screen="signup"] .demo-card{left:0} }')],
  // "Start your free trial" loses its shadow.
  flat_button: ['demo.css', (s) => cut(s, '  box-shadow:0 1px 2px 0 rgba(0,0,0,.3),0 2px 6px 0 rgba(0,0,0,.15);\n  display:flex;', '  display:flex;')],
  // The testimonial is kept on one line.
  nowrap_quote: ['demo.css', (s) => cut(s, 'line-height:15px;color:var(--navy);text-align:center;\n}', 'line-height:15px;color:var(--navy);text-align:center;white-space:nowrap;\n}')],
  // The testimonial goes grey.
  gray_quote: ['demo.css', (s) => cut(s, 'line-height:15px;color:var(--navy);text-align:center;\n}', 'line-height:15px;color:#707070;text-align:center;\n}')],
  // The speech bubble is not drawn.
  no_bubble: ['demo.css', (s) => cut(s, '.demo-backdrop[data-screen="signup"] .demo-so__bubble{\n  position:absolute;', '.demo-backdrop[data-screen="signup"] .demo-so__bubble{\n  display:none;position:absolute;')],
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
const api = { events: [], pricing: null, pricingDelay: 0, analyticsDelay: 0, navs: [] };
const reset = (pricing = null, delay = 0) => { api.events = []; api.navs = []; api.pricing = pricing; api.pricingDelay = delay; api.analyticsDelay = 0; };
function apiRespond(method, url, postData) {
  const p = new URL(url).pathname;
  if (p === '/api/public/pricing') return [200, api.pricing ? { plans: { solo: api.pricing } } : {}, api.pricingDelay];
  if (p === '/api/demo/inbound/session' && method === 'POST') return [200, { sessionId: '00000000-0000-4000-8000-000000000001', code: '4321', number: '+18554973151', numberDisplay: '(855) 497-3151', telUri: 'tel:+18554973151,,4321', expiresAt: new Date(Date.now() + 600000).toISOString() }];
  if (p === '/api/public/analytics/events') {
    try { for (const e of JSON.parse(postData || '{}').events || []) api.events.push({ type: e.event_type, data: e.event_data || {}, at: Date.now() }); } catch {}
    return [200, { ok: true }, api.analyticsDelay];
  }
  return [200, {}];
}
const evs = (type, pred = () => true) => api.events.filter((e) => e.type === type && pred(e.data));
const AD = '/handyman.html?signup=1&utm_source=qa_src&utm_campaign=qa_camp&fbclid=qa_click';
// A page that loads unseen (a preload), until the test makes it visible.
const HIDDEN = `window.__vs = 'hidden';
Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: function(){ return window.__vs; } });
Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: function(){ return window.__vs !== 'visible'; } });`;

const PROFILE = mkdtempSync(join(tmpdir(), 'cdp-2273-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0, good = 0;
const ok = (c, m) => { if (c) good++; else { bad++; console.log(`  FAIL ${m}`); } };

// The node (2718:3312, the "New jobs are calling" design of 2026-11-02, AFMBP-2495), card-relative
// CSS px, as matched to its glyphs (Chrome at a true 3x and iPhone Safari). The card's children sit
// inside its .6px stroke. Card 629 tall, top 65 on the node's 758 screen.
const NODE = {
  card: { w: 337, h: 629, y: 65 },
  cta: { x: 44, y: 413, w: 252, h: 49 },
  close: { x: 283.496, y: 9.497, w: 44, h: 44 },
  // The rating's box (its bubble's union, 278.886x114.825) turned 3.168° about its top-left
  // corner (32, 478.943): the box it fills on the page.
  rating: { x: 25.654, y: 478.943, w: 284.804, h: 130.06 },
  // The wordmark (the node's four vectors), on the pitch's box.
  wordmark: { x: 31.4, y: 210.9, w: 73.5, h: 30.7 },
  // The FREE line's 2px box, stroke inside.
  box: { x: 28, y: 335, w: 274, h: 59 },
  // The pitch: its box's left and top, its lines, and where its first words start (after the
  // 17 spaces' room the node leaves for the wordmark).
  pitch: { x: 29, y: 220.71, lines: 4, first: 109.886 },
  // Centred blocks: [the glyph run's centre x, the box's top, lines].
  free: [165, 341.065, 2],
};
const DEG = (m) => { const v = /matrix\(([^,]+), ([^,]+)/.exec(m || ''); return v ? Math.atan2(parseFloat(v[2]), parseFloat(v[1])) * 180 / Math.PI : 0; };

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
    if (new URL(request.url).hostname === '127.0.0.1') return quiet(send('Fetch.continueRequest', { requestId }));
    // AFMBP-2344: the app's page load is stopped here (the tab stays on the offer) and timed.
    if (new URL(request.url).hostname === 'app.boltanswering.com' && msg.params.resourceType === 'Document') {
      api.navs.push({ url: request.url, at: Date.now() });
      return quiet(send('Fetch.failRequest', { requestId, errorReason: 'Aborted' }));
    }
    if (request.method === 'OPTIONS') return quiet(send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: CORS }));
    const [code, body, delay] = /bolt-staging\.fly\.dev$/.test(new URL(request.url).hostname) ? apiRespond(request.method, request.url, request.postData) : [200, {}];
    const answer = () => quiet(send('Fetch.fulfillRequest', { requestId, responseCode: code, responseHeaders: [...CORS, { name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') }));
    return delay ? setTimeout(answer, delay) : answer();
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable'); await send('Accessibility.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  // A QA visit (no Meta / Google); a tap on a sign-up link is recorded with the href it carried
  // when it left (after attribution.js decorated it). The page stays because the app's page load
  // is stopped at the network (above), not here, so the button's own leaving can be timed.
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: "try{localStorage.setItem('bolt_qa','1')}catch(e){}" +
      "window.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a');if(!a)return;var h=a.getAttribute('href')||'';window.__clicks=(window.__clicks||[]).concat([{href:h}]);if(/^tel:/.test(h))e.preventDefault();});",
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
  const HEAD = 'New jobs are calling';
  const QUOTE = '“I was losing jobs to voicemail and even paid $250 a week for someone to answer my phone. Bolt booked a job and paid for itself in a day.”';
  const BODY = 'Bolt is your 24/7 receptionist that answers calls and books customers so you never miss a job again.';
  const FREE = 'It’s FREE to set up an assistant. Get started today.';
  const isClose = (f) => /^button\.demo-close /.test(f.desc);
  const isCta = (f) => /^a\.demo-btn "Start your free trial"/.test(f.desc);

  // ================= phone, the node's own size =================
  await view(402, 758, 3, true);
  console.log('[phone 402x758] content, art, type, geometry');
  reset();
  await load(AD);
  ok(await waitScreen('signup'), 'phone: ?signup=1 opens the sign-up offer');
  await sleep(300);
  const card = (await rect('.demo-backdrop.open .demo-card')) || { x: 0, y: 0, w: 0, h: 0 };
  const rel = (b) => b && { x: b.x - card.x, y: b.y - card.y, w: b.w, h: b.h, cx: b.cx - card.x, cy: b.cy - card.y, lines: b.lines };
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  ok(near(card.w, NODE.card.w, 0.01) && near(card.h, NODE.card.h, 0.01), `phone: card ${NODE.card.w}x${NODE.card.h} (${card.w}x${card.h})`);
  ok(near(card.y, NODE.card.y, 0.01), `phone: card where the node puts it, ${NODE.card.y}px from the top of a 758px screen (${card.y})`);
  // The art: the node's image, drawn (it loads) and covering the card.
  const art = (await ev("(function(){var s=getComputedStyle(document.querySelector('.demo-backdrop.open .demo-card'));return {img:s.backgroundImage,size:s.backgroundSize,pos:s.backgroundPosition,rep:s.backgroundRepeat};})()")) || {};
  ok(/assets\/demo-so-card\.webp/.test(art.img) && art.size === 'cover' && art.pos === '50% 50%' && art.rep === 'no-repeat', `phone: the card's art is the node's image, covering the card from its centre (${JSON.stringify(art)})`);
  const artW = await ev("new Promise(function(r){var i=new Image();i.onload=function(){r(i.naturalWidth+'x'+i.naturalHeight)};i.onerror=function(){r(null)};i.src='assets/demo-so-card.webp';})");
  ok(artW === '941x1670', `phone: the art loads, at the node's 941x1670 (${artW})`);
  // The headline is in the art: its words are the one heading, for screen readers only.
  const h2 = (await ev("(function(){var e=document.querySelectorAll('.demo-backdrop.open h2'); if(e.length!==1) return {n:e.length}; var s=getComputedStyle(e[0]), r=e[0].getBoundingClientRect(); return {n:1, t:e[0].textContent, clip:s.clipPath, w:r.width, h:r.height, display:s.display, vis:s.visibility};})()")) || {};
  ok(h2.n === 1 && h2.t === HEAD && h2.clip === 'inset(50%)' && h2.w <= 1 && h2.h <= 1 && h2.display !== 'none' && h2.vis === 'visible', `a11y: one heading, "${HEAD}", read out but not drawn over the art (${JSON.stringify(h2)})`);
  // The pitch: the node's words, "Bolt" read out from hidden text; the wordmark drawn in its room.
  ok((await text('.demo-cm__sub')) === BODY, `phone: the pitch (${await text('.demo-cm__sub')})`);
  const wm = (await ev("(function(){var p=document.querySelector('.demo-backdrop.open .demo-cm__sub'), s=getComputedStyle(p,'::before'), r=p.getBoundingClientRect(), k=document.querySelector('.demo-backdrop.open .demo-card').getBoundingClientRect(); return {content:s.content, img:s.backgroundImage, x:r.left-k.left+parseFloat(s.left), y:r.top-k.top+parseFloat(s.top), w:parseFloat(s.width), h:parseFloat(s.height)};})()")) || {};
  ok(wm.content !== 'none' && wm.content !== 'normal' && /assets\/demo-so-bolt\.svg/.test(wm.img) && near(wm.x, NODE.wordmark.x, 0.05) && near(wm.y, NODE.wordmark.y, 0.05) && near(wm.w, NODE.wordmark.w, 0.05) && near(wm.h, NODE.wordmark.h, 0.05), `phone: the bolt wordmark is drawn where the node puts it (${JSON.stringify(wm)})`);
  const pr = rel(await rect('.demo-backdrop.open .demo-cm__sub')), pg = rel(await run('.demo-backdrop.open .demo-cm__sub'));
  const first = await ev("(function(){var p=document.querySelector('.demo-backdrop.open .demo-cm__sub'), k=document.querySelector('.demo-backdrop.open .demo-card').getBoundingClientRect(), w=document.createTreeWalker(p,NodeFilter.SHOW_TEXT), n; while((n=w.nextNode())){ if(n.parentElement.closest('.demo-so__vh')||!n.textContent.trim()) continue; var g=document.createRange(); g.setStart(n,0); g.setEnd(n,1); return g.getBoundingClientRect().left-k.left; } return null;})()");
  ok(pr && pg && near(pr.x, NODE.pitch.x, 0.05) && near(pr.y, NODE.pitch.y, 0.05) && pg.lines === NODE.pitch.lines && near(first, NODE.pitch.first, 0.1), `phone: the pitch at ${NODE.pitch.x},${NODE.pitch.y}, on ${NODE.pitch.lines} lines as the node wraps it, its words starting at ${NODE.pitch.first} after the wordmark (${pr && pg && [pr.x.toFixed(2), pr.y.toFixed(2), pg.lines, first && first.toFixed(2)]})`);
  // Type: Times New Roman (Tinos where a phone has none), black; the FREE line's bold words.
  const type = (await ev("(function(){function f(sel){var e=document.querySelector('.demo-backdrop.open '+sel), s=getComputedStyle(e); return s.fontFamily+'|'+s.fontSize+'|'+s.fontWeight+'|'+s.color;} return {sub:f('.demo-cm__sub'), big:f('.demo-so__big'), free:f('.demo-so__free'), b:[].slice.call(document.querySelectorAll('.demo-backdrop.open .demo-so__free b')).map(function(b){return b.textContent+':'+getComputedStyle(b).fontWeight})};})()")) || {};
  ok(type.sub === '"Times New Roman", Tinos, serif|19.032px|400|rgb(0, 0, 0)' && type.big === '"Times New Roman", Tinos, serif|20.03px|400|rgb(0, 0, 0)' && type.free === '"Times New Roman", Tinos, serif|19.032px|400|rgb(0, 0, 0)', `type: the pitch and the FREE line in Times New Roman, then Tinos, black, at the node's 19.032 and 20.03px (${JSON.stringify(type)})`);
  ok(JSON.stringify(type.b) === JSON.stringify(['FREE :700', 'today.:700']), `type: "FREE" and "today." bold (${JSON.stringify(type.b)})`);
  const tinos = await ev("(function(){var w=[]; document.fonts.forEach(function(f){ if(/Tinos/.test(f.family)) w.push(f.weight); }); return w.sort().join(',');})()");
  ok(tinos === '400,700', `type: Tinos regular and bold are declared, for phones without Times New Roman (${tinos})`);
  // The FREE line, centred in its column, inside its 2px box.
  ok((await text('.demo-so__free')) === FREE, `phone: the FREE line (${await text('.demo-so__free')})`);
  const fr = rel(await rect('.demo-backdrop.open .demo-so__free')), fg = rel(await run('.demo-backdrop.open .demo-so__free'));
  ok(fr && fg && near(fg.cx, NODE.free[0], 0.5) && near(fr.y, NODE.free[1], 0.05) && fg.lines === NODE.free[2], `phone: the FREE line centred at ${NODE.free[0]}, top ${NODE.free[1]}, on ${NODE.free[2]} lines (${fr && fg && [fg.cx.toFixed(2), fr.y.toFixed(2), fg.lines]})`);
  const bx = (await ev("(function(){var m=document.querySelector('.demo-backdrop.open .demo-cm'), s=getComputedStyle(m,'::after'), b=document.querySelector('.demo-backdrop.open .demo-body').getBoundingClientRect(), k=document.querySelector('.demo-backdrop.open .demo-card').getBoundingClientRect(); return {content:s.content, x:b.left-k.left+parseFloat(s.left), y:b.top-k.top+parseFloat(s.top), w:parseFloat(s.width), h:parseFloat(s.height), border:s.borderTopWidth+' '+s.borderTopStyle+' '+s.borderTopColor, sizing:s.boxSizing};})()")) || {};
  ok(bx.content !== 'none' && bx.content !== 'normal' && near(bx.x, NODE.box.x, 0.05) && near(bx.y, NODE.box.y, 0.05) && near(bx.w, NODE.box.w, 0.05) && near(bx.h, NODE.box.h, 0.05) && bx.border === '2px solid rgb(0, 0, 0)' && bx.sizing === 'border-box', `phone: the FREE line's 2px black box where the node puts it (${JSON.stringify(bx)})`);
  // "Start your free trial": the node's blue button and its shadow.
  // AFMBP-2548: the owner's label (11-10), not the node's "Start now".
  ok((await text('.demo-so__cta')) === 'Start your free trial', `phone: "Start your free trial" (${await text('.demo-so__cta')})`);
  ok((await ev("getComputedStyle(document.querySelector('.demo-so__cta')).backgroundColor")) === 'rgb(43, 127, 253)' && (await ev("getComputedStyle(document.querySelector('.demo-so__cta')).color")) === 'rgb(255, 255, 255)', 'phone: "Start your free trial" is the node\'s blue with white words');
  const cs = await ev("getComputedStyle(document.querySelector('.demo-so__cta')).boxShadow");
  ok(cs === 'rgba(0, 0, 0, 0.3) 0px 1px 2px 0px, rgba(0, 0, 0, 0.15) 0px 2px 6px 0px', `phone: "Start your free trial" carries the node's two shadows as Figma draws them on it, no spread (${cs})`);
  // The label is the node's Inter Bold 22 on a 21px line (owner, 11-09), drawn with the bold face itself.
  const lf = (await ev("(function(){var s=getComputedStyle(document.querySelector('.demo-so__cta')); return {font:s.fontFamily.split(',')[0].replace(/[\"']/g,'')+'|'+s.fontSize+'|'+s.fontWeight+'|'+s.lineHeight, bold:document.fonts.check('700 22px Inter')};})()")) || {};
  ok(lf.font === 'Inter|22px|700|21px' && lf.bold === true, `phone: "Start your free trial" is Inter Bold 22 on a 21px line (${lf.font}, bold face ${lf.bold})`);
  // The rating: the reviewer, stars, score and testimonial in the tilted bubble.
  ok((await text('.demo-backdrop.open .demo-so__who')) === 'Brent B. Indiana' && (await ev("getComputedStyle(document.querySelector('.demo-backdrop.open .demo-so__who b')).fontWeight")) === '700', `phone: the reviewer, "Brent B." bold, then "Indiana" (${await text('.demo-backdrop.open .demo-so__who')})`);
  ok((await text('.demo-backdrop.open .demo-cm__score')) === '4.9/5' && (await text('.demo-backdrop.open .demo-cm__quote')) === QUOTE, `phone: the rating and the testimonial (${await text('.demo-backdrop.open .demo-cm__quote')})`);
  const qs = await ev("(function(){var s=getComputedStyle(document.querySelector('.demo-backdrop.open .demo-cm__quote'));return s.color+'|'+s.fontStyle+'|'+s.fontSize;})()");
  ok(qs === 'rgb(24, 10, 83)|italic|12.248px', `phone: the testimonial navy italic at the node's 12.248px (${qs})`);
  ok((await ev("[].slice.call(document.querySelectorAll('.demo-cm__stars span')).length")) === 5 && (await ev("[].slice.call(document.querySelectorAll('.demo-cm__stars span')).every(function(s){var c=getComputedStyle(s); return /demo-m-star-lg\\.svg/.test(c.backgroundImage) && Math.abs(parseFloat(c.width)-16.972)<.01 && Math.abs(parseFloat(c.height)-17.898)<.01})")), 'phone: five node stars at the node\'s 16.972x17.898');
  const bub = await ev("(function(){var e=document.querySelector('.demo-backdrop.open .demo-so__bubble'); if(!e) return null; var s=getComputedStyle(e); return {img:s.backgroundImage, hidden:e.getAttribute('aria-hidden'), shown:s.display!=='none'&&s.visibility!=='hidden'};})()");
  ok(!!bub && bub.shown && /demo-so-bubble-v5\.svg/.test(bub.img) && bub.hidden === 'true', `phone: the rating's speech bubble (the node's union, with its shadow), hidden from screen readers (${JSON.stringify(bub)})`);
  const cr = (await ev("(function(){var e=document.querySelector('.demo-backdrop.open .demo-cr'), s=document.querySelector('.demo-backdrop.open .demo-cm__stars'), c=document.querySelector('.demo-backdrop.open .demo-cm__score'); return {cr:getComputedStyle(e).transform, origin:getComputedStyle(e).transformOrigin, stars:getComputedStyle(s).transform, score:getComputedStyle(c).transform};})()")) || {};
  ok(near(DEG(cr.cr), 3.168, 0.002) && cr.origin === '0px 0px' && near(DEG(cr.stars), -0.148, 0.002) && near(DEG(cr.score), -0.148, 0.002), `phone: the rating turned 3.168° about its corner, the stars and score turned .148° back, as the node turns them (${[DEG(cr.cr), DEG(cr.stars), DEG(cr.score)].map((v) => v.toFixed(3))})`);
  const rb = rel(await rect('.demo-backdrop.open .demo-cr'));
  ok(!!rb && near(rb.x, NODE.rating.x, 0.05) && near(rb.y, NODE.rating.y, 0.05) && near(rb.w, NODE.rating.w, 0.05) && near(rb.h, NODE.rating.h, 0.05), `phone: the rating fills the box the node's tilted bubble fills (${JSON.stringify(rb)} vs ${JSON.stringify(NODE.rating)})`);
  for (const [sel, lines] of [['.demo-so__who', 1], ['.demo-cm__score', 1], ['.demo-cm__quote', 4]]) {
    const g = await run(`.demo-backdrop.open ${sel}`);
    ok(!!g && g.lines === lines, `phone: ${sel} on ${lines} line(s), as the node wraps it (${g && g.lines})`);
  }
  ok((await ev("(function(){var q=document.querySelector('.demo-backdrop.open .demo-cm__quote'); if(!q) return false; var r=q.getBoundingClientRect(); return document.elementFromPoint(r.left+r.width/2, r.top+r.height/2) === q;})()")) === true, 'phone: the testimonial sits on top of its bubble');
  // What v5 dropped, and what the offer never shows.
  ok(!(await ev("!!document.querySelector('.demo-backdrop.open .demo-help')")) && (await ev("document.querySelector('.demo-backdrop.open .demo-card').innerText.indexOf('Need help') < 0")), 'phone: no help line (the node has none)');
  ok(!(await ev("!!document.querySelector('.demo-backdrop.open .demo-so__trial, .demo-backdrop.open .demo-so__pill, .demo-backdrop.open .demo-so__tm, .demo-backdrop.open .demo-cm__logo')")), 'phone: no trial line, pill, "tm" or logo (v5 dropped them)');
  ok((await ev("getComputedStyle(document.querySelector('.demo-backdrop.open .demo-body'),'::before').content")) === 'none', 'phone: no paintbrush watermark (v5 dropped it)');
  ok(!(await ev("!!document.querySelector('.demo-backdrop.open .demo-cm__live')")) && !(await ev("document.querySelector('.demo-backdrop.open .demo-card').innerText.indexOf('Available now') >= 0")), 'phone: no "Available now" or green dot');
  ok(!(await ev("!!document.querySelector('.demo-backdrop.open .demo-choice__call, .demo-backdrop.open .demo-choice__get, .demo-backdrop.open .demo-choice__when')")), 'phone: none of the demo\'s ways in');
  ok((await visible('.demo-close')) && /demo-m-close\.svg/.test(await ev("getComputedStyle(document.querySelector('.demo-close'),'::before').backgroundImage")), 'phone: the close button shows, drawn with the node\'s own cross');
  for (const k of ['cta', 'close']) {
    const b = rel(await rect(k === 'cta' ? '.demo-so__cta' : '.demo-close')), n = NODE[k];
    ok(!!b && near(b.x, n.x, 0.05) && near(b.y, n.y, 0.05) && near(b.w, n.w, 0.05) && near(b.h, n.h, 0.05), `phone: ${k} box where it matches the node (${JSON.stringify(b)} vs ${JSON.stringify(n)})`);
  }
  ok((await ev("(function(){var b=document.querySelector('.demo-close'), r=b.getBoundingClientRect(); return document.elementFromPoint(r.left+r.width/2, r.top+r.height/2) === b;})()")) === true, 'phone: the close button takes a tap at its centre (nothing on top of it)');

  console.log('[phone] analytics and the link');
  ok(evs('signup_offer_opened', (d) => d.trigger === 'ad_link').length === 1 && evs('signup_offer_opened').length === 1, `events: signup_offer_opened once, from the ad link (${evs('signup_offer_opened').length})`);
  ok(evs('demo_opened').length === 0, `events: no demo_opened for the offer (${evs('demo_opened').length})`);
  ok(evs('signup_offer_opened', (d) => d.attr && d.attr.utm_source === 'qa_src' && d.attr.click_id === 'qa_click').length === 1, 'attribution: the ad tags ride on signup_offer_opened');
  ok((await ev("document.querySelector('.demo-so__cta').tagName")) === 'A' && (await ev("document.querySelector('.demo-so__cta').getAttribute('href')")).indexOf(SIGNUP) === 0, '"Start your free trial" is a link into the sign-up flow');
  await tap('.demo-so__cta');
  const c1 = await lastClick();
  let u1 = null; try { u1 = new URL(c1.href); } catch {}
  const vid = await ev('window.boltAttr && window.boltAttr.visitorId()');
  ok(!!u1 && u1.origin + u1.pathname === SIGNUP && u1.searchParams.get('bvid') === vid && u1.searchParams.get('utm_source') === 'qa_src' && u1.searchParams.get('utm_campaign') === 'qa_camp' && u1.searchParams.get('fbclid') === 'qa_click' && u1.searchParams.get('bolt_qa') === '1', `the tap leaves for the sign-up flow with this visitor's id, the ad tags and the QA flag (${c1 && c1.href})`);
  await sleep(300);
  ok(evs('trial_link_clicked', (d) => d.placement === 'signup_offer').length === 1 && evs('trial_link_clicked').length === 1, `events: the tap logged once, trial_link_clicked {placement: signup_offer} (${JSON.stringify(evs('trial_link_clicked').map((e) => e.data.placement))})`);

  console.log('[phone] leaving: the tap waits for its event, never long (AFMBP-2344)');
  const tapTimed = async (delay) => {
    reset(); await load(AD); await waitScreen('signup'); await sleep(300);
    api.analyticsDelay = delay;
    const t0 = Date.now();
    await tap('.demo-so__cta');
    for (let i = 0; i < 50 && !api.navs.length; i++) await sleep(100);
    const e = evs('trial_link_clicked', (d) => d.placement === 'signup_offer')[0], n = api.navs[0];
    api.analyticsDelay = 0;
    return { event: e ? e.at - t0 : null, leave: n ? n.at - t0 : null, url: n ? n.url : null };
  };
  const held = await tapTimed(150);
  ok(held.event !== null && held.leave !== null && held.leave >= held.event + 140 && /[?&]bvid=/.test(held.url) && held.url.indexOf(SIGNUP) === 0,
    `the tap holds the page until its event has gone out (server answers in 150 ms), then leaves for the sign-up flow (${JSON.stringify(held)})`);
  const capped = await tapTimed(3000);
  ok(capped.event !== null && capped.leave !== null && capped.leave <= 450,
    `the tap never waits past about 0.3 s when the server hangs (${JSON.stringify(capped)})`);

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

  console.log('[phone] keyboard: focus starts on the dialog; Tab goes round the cross and "Start your free trial"');
  reset();
  await load(AD);
  ok(await waitScreen('signup'), 'keyboard: offer open');
  const f0 = await ev(FOCUS);
  // The card's hairline is a painted inset shadow, not a ring: the dialog's outline is what must stay off.
  ok(f0.on === 'dialog' && f0.outline === 'none', `keyboard: focus is on the dialog as it opens, and it draws no ring (${f0.on} ${f0.outline})`);
  const fwd = [await tab(), await tab(), await tab()];
  ok(isClose(fwd[0]) && isCta(fwd[1]) && isClose(fwd[2]), `keyboard: Tab goes the cross, "Start your free trial", then round (${fwd.map((f) => f.desc).join(' > ')})`);
  ok(fwd.every((f) => f.on === 'inside'), 'keyboard: Tab never leaves the dialog');
  const bwd = [await tab(true), await tab(true)];
  ok(isCta(bwd[0]) && isClose(bwd[1]) && bwd.every((f) => f.on === 'inside'), `keyboard: Shift+Tab goes back round (${bwd.map((f) => f.desc).join(' > ')})`);
  await tab();
  await key('Enter', 'Enter', 13);
  const k1 = await lastClick();
  ok(!!k1 && k1.href.indexOf(SIGNUP) === 0 && evs('trial_link_clicked', (d) => d.placement === 'signup_offer').length === 1, 'keyboard: Enter on "Start your free trial" goes to the sign-up flow, logged once');
  reset();
  await load(AD);
  ok(await waitScreen('signup'), 'keyboard: offer open, to close it');
  await key('Escape', 'Escape', 27);
  ok((await screen()) === null && evs('demo_closed', (d) => d.step === 'signup_offer').length === 1, 'keyboard: Escape closes it (demo_closed, step signup_offer)');

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
    const b = await rect('.demo-so__cta');
    ok(b && b.x >= c.x && b.x + b.w <= c.x + c.w && b.y >= 0 && b.y + b.h <= h, `${w}x${h}: "Start your free trial" inside the card and on screen (${JSON.stringify(b)})`);
    for (const [name, sel] of [["the FREE line", '.demo-so__free'], ["the rating's bubble", '.demo-so__bubble']]) {
      const pb = await rect(`.demo-backdrop.open ${sel}`);
      ok(!!pb && pb.x >= c.x && pb.x + pb.w <= c.x + c.w && pb.y + pb.h <= c.y + c.h + 0.5 && pb.w > 0, `${w}x${h}: ${name} inside the card (${pb && [pb.x.toFixed(1), (pb.x + pb.w).toFixed(1), (pb.y + pb.h).toFixed(1), (c.y + c.h).toFixed(1)]})`);
    }
    const x = await rect('.demo-close');
    ok(!!x && (await visible('.demo-close')) && x.x >= c.x && x.x + x.w <= c.x + c.w && x.y >= 0 && x.w >= 36, `${w}x${h}: the close button inside the card and on screen, at least 36px`);
    for (const [sel, want] of [['.demo-cm__sub', 4], ['.demo-so__free', 2], ['.demo-so__who', 1], ['.demo-cm__score', 1], ['.demo-cm__quote', 4], ['.demo-so__cta', 1]]) {
      const g = await run(`.demo-backdrop.open ${sel}`);
      ok(g && g.x >= c.x + 2 && g.x + g.w <= c.x + c.w - 2 && g.lines === want, `${w}x${h}: ${sel} on ${want} line(s), every word inside the card (${g && [g.x.toFixed(1), (g.x + g.w).toFixed(1), g.lines]})`);
    }
  }

  console.log(bad ? `\n${bad} FAILED, ${good} passed${NC ? ` (negative control: ${NC})` : ''}` : `\nALL PASS (${good} checks)${NC ? ` — negative control ${NC} did NOT bite` : ''}`);
  ws.close();
} finally {
  chrome.kill('SIGKILL'); srv.close();
  await sleep(300); rmSync(PROFILE, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
