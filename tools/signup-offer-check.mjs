// AFMBP-2273 — the sign-up offer (Figma 2718:3312): an ad link with ?signup=1 opens the demo
// card's frame with the offer and one yellow "Start now" into the sign-up flow, instead of
// the demo. Drives the real page in headless Chrome against a fake Bolt API and checks:
//   - content and art (the node as updated 2026-10-28, AFMBP-2446): the node's copy, stars,
//     logo, brush, close cross and the headline's purple pill; no marker or underline (the
//     update dropped "real money"); none of the demo's ways in, and no "Available now";
//   - weights and colour: the headline semibold and white on the pill, the body regular with
//     "Bolt" semibold, the trial line semibold and centred, on its own;
//   - geometry: each piece where it sits once matched to the node's glyphs (card-relative);
//   - pricing: "30 days" and "$79" follow the pricing feed whether it answers before or after
//     the card is built (pricing.js reapply), and fall back when it doesn't answer;
//   - the link: "Start now" goes to the sign-up flow carrying this visitor's id, ad tags and
//     the QA flag (attribution.js decorates it as it is tapped);
//   - analytics: signup_offer_opened once (never demo_opened), the tap logged once as
//     trial_link_clicked {placement: signup_offer}, a close as demo_closed {step: signup_offer};
//   - closing and keyboard: the cross, Escape and the shade close it; focus starts on the
//     dialog, Tab goes round the cross, "Start now" and the help link;
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
import { extname, join, normalize } from 'node:path';

const ROOT = process.argv[2] ?? new URL('..', import.meta.url).pathname;
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
  // "Start now" goes somewhere else.
  cta_href: ['demo.js', (s) => cut(s, "class: 'demo-btn demo-btn--yellow demo-so__cta', href: 'https://app.boltanswering.com/signup'", "class: 'demo-btn demo-btn--yellow demo-so__cta', href: '/'")],
  // The tap is not logged.
  no_track: ['demo.js', (s) => cut(s, ", onClick: function () { track('trial_link_clicked', { placement: 'signup_offer' }); } }, ['Start now']", " }, ['Start now']")],
  // The button keeps its old label.
  old_label: ['demo.js', (s) => cut(s, "}, ['Start now']);", "}, ['Get started']);")],
  // The trial length and price are baked text, deaf to the feed.
  static_price: ['demo.js', (s) => cut(s, "'Get your first ', h('span', { class: 'js-td', text: '30' }), ' days free (',\n          h('span', { class: 'js-retail', text: '$79' }), ' value). Cancel anytime.'", "'Get your first 30 days free ($79 value). Cancel anytime.'")],
  // The card never asks pricing.js for the latest numbers.
  no_reapply: ['demo.js', (s) => cut(s, "    try { if (window.boltPricing) window.boltPricing.reapply(); } catch (e) {}\n", '')],
  // The close button is hidden.
  close_hidden: ['demo.css', (s) => cut(s, '.demo-backdrop[data-screen="signup"] .demo-close{\n  display:flex;', '.demo-backdrop[data-screen="signup"] .demo-close{\n  display:none;')],
  // "Start now" moves off the node.
  off_node: ['demo.css', (s) => cut(s, 'position:absolute;left:43.4px;top:389.4px;width:252px;height:49px;', 'position:absolute;left:43.4px;top:394.4px;width:252px;height:49px;')],
  // A narrow phone clips the card instead of scaling it down.
  no_zoom: ['demo.css', (s) => cut(s, '@media (max-width:336px){ .demo-backdrop[data-screen="signup"] .demo-card{zoom:.94;left:0} }', '@media (max-width:336px){ .demo-backdrop[data-screen="signup"] .demo-card{left:0} }')],
  // The headline drops back to regular.
  regular_headline: ['demo.css', (s) => cut(s, '.demo-cm__h{top:107.4px;line-height:26px;font-weight:600;color:#fff}', '.demo-cm__h{top:107.4px;line-height:26px;font-weight:400;color:#fff}')],
  // The headline stays navy on the purple pill.
  navy_headline: ['demo.css', (s) => cut(s, '.demo-cm__h{top:107.4px;line-height:26px;font-weight:600;color:#fff}', '.demo-cm__h{top:107.4px;line-height:26px;font-weight:600}')],
  // The headline's pill is not drawn.
  no_pill: ['demo.css', (s) => cut(s, '.demo-backdrop[data-screen="signup"] .demo-so__pill{\n  position:absolute;', '.demo-backdrop[data-screen="signup"] .demo-so__pill{\n  display:none;position:absolute;')],
  // "Start now" loses its shadow.
  flat_button: ['demo.css', (s) => cut(s, '  box-shadow:0 1px 2px 0 rgba(0,0,0,.3),0 2px 6px 0 rgba(0,0,0,.15);\n  display:flex;', '  display:flex;')],
  // "Bolt" at the start of the body drops back to regular.
  regular_bolt: ['demo.css', (s) => cut(s, '.demo-cm__sub b{font-weight:600}', '.demo-cm__sub b{font-weight:400}')],
  // The trial line drops back to regular.
  regular_trial: ['demo.css', (s) => cut(s, '.demo-so__trial{top:307px;line-height:23px;font-weight:600;text-align:center}', '.demo-so__trial{top:307px;line-height:23px;font-weight:400;text-align:center}')],
  // The trial line sits flush left, as the body does.
  left_trial: ['demo.css', (s) => cut(s, '.demo-so__trial{top:307px;line-height:23px;font-weight:600;text-align:center}', '.demo-so__trial{top:307px;line-height:23px;font-weight:600;text-align:left}')],
  // The body sits where 26+26+23 would put it, 3.6px above the node's glyphs.
  body_high: ['demo.css', (s) => cut(s, '.demo-cm__sub{top:186px;line-height:23px}', '.demo-cm__sub{top:182.4px;line-height:23px}')],
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
const api = { events: [], pricing: null, pricingDelay: 0 };
const reset = (pricing = null, delay = 0) => { api.events = []; api.pricing = pricing; api.pricingDelay = delay; };
function apiRespond(method, url, postData) {
  const p = new URL(url).pathname;
  if (p === '/api/public/pricing') return [200, api.pricing ? { plans: { solo: api.pricing } } : {}, api.pricingDelay];
  if (p === '/api/demo/inbound/session' && method === 'POST') return [200, { sessionId: '00000000-0000-4000-8000-000000000001', code: '4321', number: '+18554973151', numberDisplay: '(855) 497-3151', telUri: 'tel:+18554973151,,4321', expiresAt: new Date(Date.now() + 600000).toISOString() }];
  if (p === '/api/public/analytics/events') {
    try { for (const e of JSON.parse(postData || '{}').events || []) api.events.push({ type: e.event_type, data: e.event_data || {} }); } catch {}
    return [200, { ok: true }];
  }
  return [200, {}];
}
const evs = (type, pred = () => true) => api.events.filter((e) => e.type === type && pred(e.data));
const FEED = { promoPriceUsd: 49, retailPriceUsd: 89, promoMonths: 1, trialDays: 14, perMinuteUsd: 0.12, perMessageUsd: 0.01, minutesIncluded: 400, messagesIncluded: 750 };
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

// The node (2718:3312, as updated 2026-10-28), card-relative CSS px, as matched to its glyphs
// (Chrome at a true 3x and iPhone Safari): the card's children sit inside its .6px stroke
// ("Start now" at 44, 390). The 10-28 update moved the button 25px down and the rating 21px
// down, and put the headline on a purple pill (2798:3107).
const NODE = {
  card: { w: 337, h: 611 },
  cta: { x: 44, y: 390, w: 252, h: 49 },
  stars: { x: 85.104, y: 476, w: 107.76, h: 21.552 },
  close: { x: 278.496, y: 21.497, w: 44, h: 44 },
  pill: { x: 27, y: 100, w: 289, h: 69 },
  // Centred lines: [the glyph run's centre x, the line box's centre y].
  centres: { '.demo-cm__score': [216.99, 487.391], '.demo-cm__quote': [163.98, 508.938], '.demo-help': [168.73, 566.656] },
  // Left edge, top and line count: the headline on 2 lines, the body on 4 (the column sits
  // .2px right of the node's 46 so both engines draw it on the node's glyphs; demo.css).
  pitch: { '.demo-cm__h': [46.2, 108, 2], '.demo-cm__sub': [46.2, 186.6, 4] },
  // The trial line: centred in the same column [run centre x, top, lines].
  trial: [179.2, 307.6, 2],
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
    if (new URL(request.url).hostname === '127.0.0.1') return quiet(send('Fetch.continueRequest', { requestId }));
    if (request.method === 'OPTIONS') return quiet(send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: CORS }));
    const [code, body, delay] = /bolt-staging\.fly\.dev$/.test(new URL(request.url).hostname) ? apiRespond(request.method, request.url, request.postData) : [200, {}];
    const answer = () => quiet(send('Fetch.fulfillRequest', { requestId, responseCode: code, responseHeaders: [...CORS, { name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') }));
    return delay ? setTimeout(answer, delay) : answer();
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable'); await send('Accessibility.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  // A QA visit (no Meta / Google); a tap on a sign-up link is recorded with the href it carried
  // when it left (after attribution.js decorated it), then held so the page stays.
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: "try{localStorage.setItem('bolt_qa','1')}catch(e){}" +
      "window.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a');if(!a)return;var h=a.getAttribute('href')||'';window.__clicks=(window.__clicks||[]).concat([{href:h}]);if(/^https:\\/\\/app\\.boltanswering\\.com/.test(h)||/^tel:/.test(h))e.preventDefault();});",
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
  const run = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; var w=document.createTreeWalker(e,NodeFilter.SHOW_TEXT), n, rs=[]; while((n=w.nextNode())){ if(!n.textContent.trim()) continue; var g=document.createRange(); g.selectNodeContents(n); [].slice.call(g.getClientRects()).forEach(function(r){ if(r.width>0) rs.push(r); }); } if(!rs.length) return null; var x0=Math.min.apply(0,rs.map(function(r){return r.left})),x1=Math.max.apply(0,rs.map(function(r){return r.right})),y0=Math.min.apply(0,rs.map(function(r){return r.top})),y1=Math.max.apply(0,rs.map(function(r){return r.bottom})); var tops=rs.map(function(r){return r.top}).sort(function(a,b){return a-b}), lines=1; for(var i=1;i<tops.length;i++) if(tops[i]-tops[i-1]>6) lines++; return {x:x0,y:y0,w:x1-x0,h:y1-y0,cx:(x0+x1)/2,cy:(y0+y1)/2,lines:lines};})()`);
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
  const HEAD = 'One phone call can make or break your business.';
  const BODY = 'Bolt is a 24/7 receptionist in your pocket that answers calls and books customers, so you never miss a job.';
  const offer = () => text('.demo-so__trial');
  const OFFER = (days, price) => `Get your first ${days} days free (${price} value). Cancel anytime.`;
  const isClose = (f) => /^button\.demo-close /.test(f.desc);
  const isCta = (f) => /^a\.demo-btn "Start now"/.test(f.desc);

  // ================= phone, the node's own size =================
  await view(402, 758, 3, true);
  console.log('[phone 402x758] content, art, geometry, pricing fallback');
  reset();
  await load(AD);
  ok(await waitScreen('signup'), 'phone: ?signup=1 opens the sign-up offer');
  await sleep(300);
  ok((await text('.demo-cm__h')) === HEAD, `phone: the headline (${await text('.demo-cm__h')})`);
  ok((await text('.demo-cm__sub')) === BODY, `phone: the body (${await text('.demo-cm__sub')})`);
  const wt = (sel) => ev(`(function(){var e=document.querySelector('.demo-backdrop.open ${sel}');return e?getComputedStyle(e).fontWeight:null})()`);
  ok((await wt('.demo-cm__h')) === '600', `phone: the headline semibold (${await wt('.demo-cm__h')})`);
  const hc = await ev("getComputedStyle(document.querySelector('.demo-backdrop.open .demo-cm__h')).color");
  ok(hc === 'rgb(255, 255, 255)', `phone: the headline white, on its pill (${hc})`);
  ok((await wt('.demo-cm__sub')) === '400' && (await text('.demo-cm__sub b')) === 'Bolt' && (await wt('.demo-cm__sub b')) === '600', `phone: the body regular, its first word "Bolt" semibold (${await wt('.demo-cm__sub')}, ${await text('.demo-cm__sub b')} ${await wt('.demo-cm__sub b')})`);
  const pill = await ev("(function(){var e=document.querySelector('.demo-backdrop.open .demo-so__pill'); if(!e) return null; var s=getComputedStyle(e); return {bg:s.backgroundColor, radius:s.borderRadius, shadow:s.boxShadow, hidden:e.getAttribute('aria-hidden'), shown:s.display!=='none'&&s.visibility!=='hidden'};})()");
  ok(!!pill && pill.shown && pill.bg === 'rgb(86, 68, 161)' && pill.radius === '23px' && pill.shadow === 'rgba(0, 0, 0, 0.3) 0px 1px 2px 0px, rgba(0, 0, 0, 0.15) 0px 2px 6px 2px' && pill.hidden === 'true', `phone: the headline's pill, the node's purple, 23px corners and its two shadows, hidden from screen readers (${JSON.stringify(pill)})`);
  ok((await ev("(function(){var p=document.querySelector('.demo-backdrop.open .demo-so__pill'), h=document.querySelector('.demo-backdrop.open .demo-cm__h'); if(!p||!h) return false; var r=p.getBoundingClientRect(); return document.elementFromPoint(r.left+r.width/2, r.top+r.height/2) === h;})()")) === true, 'phone: the headline sits on top of its pill');
  ok((await wt('.demo-so__trial')) === '600' && (await ev("getComputedStyle(document.querySelector('.demo-backdrop.open .demo-so__trial')).textAlign")) === 'center', `phone: the trial line semibold and centred (${await wt('.demo-so__trial')})`);
  ok((await offer()) === OFFER(30, '$79'), `phone: the trial line, its length and price from the fallback (${await offer()})`);
  ok((await text('.demo-so__cta')) === 'Start now', `phone: "Start now" (${await text('.demo-so__cta')})`);
  ok((await text('.demo-backdrop.open .demo-cm__score')) === '4.9/5' && (await text('.demo-backdrop.open .demo-cm__quote')) === '“Pays for itself”' && (await text('.demo-backdrop.open .demo-help')) === 'Need help? Contact support.', `phone: rating, quote and the help line (${await text('.demo-backdrop.open .demo-cm__quote')})`);
  ok(!(await ev("!!document.querySelector('.demo-backdrop.open .demo-cm__live')")) && !(await ev("document.querySelector('.demo-backdrop.open .demo-card').innerText.indexOf('Available now') >= 0")), 'phone: no "Available now" or green dot (the node dropped them)');
  ok(!(await ev("!!document.querySelector('.demo-backdrop.open .demo-choice__call, .demo-backdrop.open .demo-choice__get, .demo-backdrop.open .demo-choice__when')")), 'phone: none of the demo\'s ways in');
  ok((await ev("[].slice.call(document.querySelectorAll('.demo-cm__stars span')).length")) === 5 && (await ev("[].slice.call(document.querySelectorAll('.demo-cm__stars span')).every(function(s){return /demo-m-star-lg\\.svg/.test(getComputedStyle(s).backgroundImage) && Math.abs(s.getBoundingClientRect().width - 21.552) < .01})")), 'phone: five node stars');
  ok(!(await ev("!!document.querySelector('.demo-backdrop.open .demo-cm__mk, .demo-backdrop.open .demo-mk')")) && (await ev("getComputedStyle(document.querySelector('.demo-backdrop.open .demo-cm'),'::before').backgroundImage")) === 'none', 'phone: no marker words and no underline (the 10-28 node dropped "real money")');
  ok(/assets\/logo\.png/.test(await ev("getComputedStyle(document.querySelector('.demo-backdrop.open .demo-cm__logo')).backgroundImage")), 'phone: the in-card logo');
  ok(/demo-m-brush\.svg/.test(await ev("(function(){var s=getComputedStyle(document.querySelector('.demo-backdrop.open .demo-body'),'::before');return s.webkitMaskImage||s.maskImage})()")) && (await ev("getComputedStyle(document.querySelector('.demo-backdrop.open .demo-body'),'::before').transform")) === 'matrix(-1, 0, 0, 1, 0, 0)', 'phone: the paintbrush watermark, mirrored as the node draws it');
  ok((await visible('.demo-close')) && /demo-m-close\.svg/.test(await ev("getComputedStyle(document.querySelector('.demo-close'),'::before').backgroundImage")), 'phone: the close button shows, drawn with the node\'s own cross');
  ok((await ev("getComputedStyle(document.querySelector('.demo-so__cta')).backgroundColor")) === 'rgb(252, 189, 17)' && (await ev("getComputedStyle(document.querySelector('.demo-so__cta')).color")) === 'rgb(24, 10, 83)', 'phone: "Start now" is the node\'s yellow with navy words');
  const cs = await ev("getComputedStyle(document.querySelector('.demo-so__cta')).boxShadow");
  ok(cs === 'rgba(0, 0, 0, 0.3) 0px 1px 2px 0px, rgba(0, 0, 0, 0.15) 0px 2px 6px 0px', `phone: "Start now" carries the node's two shadows as Figma draws them on it, no spread (${cs})`);
  ok((await ev("getComputedStyle(document.querySelector('.demo-backdrop.open .demo-cm__quote')).fontStyle")) === 'italic', 'phone: the quote in italic');
  const card = (await rect('.demo-backdrop.open .demo-card')) || { x: 0, y: 0, w: 0, h: 0 };
  const rel = (b) => b && { x: b.x - card.x, y: b.y - card.y, w: b.w, h: b.h, cx: b.cx - card.x, cy: b.cy - card.y, lines: b.lines };
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  ok(near(card.w, 337, 0.01) && near(card.h, 611, 0.01), `phone: card 337x611 (${card.w}x${card.h})`);
  ok(near(card.y, 73, 0.01), `phone: card where the node puts it, 73px from the top of a 758px screen (${card.y})`);
  for (const [k, sel] of [['cta', '.demo-so__cta'], ['stars', '.demo-backdrop.open .demo-cm__stars'], ['close', '.demo-close'], ['pill', '.demo-backdrop.open .demo-so__pill']]) {
    const b = rel(await rect(sel)), n = NODE[k];
    ok(!!b && near(b.x, n.x, 0.05) && near(b.y, n.y, 0.05) && near(b.w, n.w, 0.05) && near(b.h, n.h, 0.05), `phone: ${k} box where it matches the node (${JSON.stringify(b)} vs ${JSON.stringify(n)})`);
  }
  for (const [sel, [cx, cy]] of Object.entries(NODE.centres)) {
    const g = rel(await run(`.demo-backdrop.open ${sel}`)), b = rel(await rect(`.demo-backdrop.open ${sel}`));
    ok(g && b && near(g.cx, cx, 0.5) && near(b.cy, cy, 0.05) && g.lines === 1, `phone: ${sel} centred where it matches the node, one line (${g && b && [g.cx.toFixed(2), b.cy.toFixed(3), g.lines]} vs ${cx},${cy})`);
  }
  for (const [sel, [x, y, lines]] of Object.entries(NODE.pitch)) {
    const g = rel(await run(`.demo-backdrop.open ${sel}`)), b = rel(await rect(`.demo-backdrop.open ${sel}`));
    ok(g && b && near(g.x, x, 0.05) && near(b.y, y, 0.05) && g.lines === lines, `phone: ${sel} from x ${x}, top ${y}, on ${lines} lines, as the node wraps it (${g && b && [g.x.toFixed(2), b.y.toFixed(2), g.lines]})`);
  }
  {
    const [cx, y, lines] = NODE.trial;
    const g = rel(await run('.demo-backdrop.open .demo-so__trial')), b = rel(await rect('.demo-backdrop.open .demo-so__trial'));
    ok(g && b && near(g.cx, cx, 0.5) && near(b.y, y, 0.05) && g.lines === lines, `phone: the trial line centred at ${cx}, top ${y}, on ${lines} lines, as the node wraps it (${g && b && [g.cx.toFixed(2), b.y.toFixed(2), g.lines]})`);
  }
  ok((await ev("(function(){var b=document.querySelector('.demo-close'), r=b.getBoundingClientRect(); return document.elementFromPoint(r.left+r.width/2, r.top+r.height/2) === b;})()")) === true, 'phone: the close button takes a tap at its centre (nothing on top of it)');
  ok((await ev("document.querySelector('.demo-backdrop.open h2').textContent")) === HEAD && (await ev("[].slice.call(document.querySelectorAll('.demo-backdrop.open h2')).filter(function(e){return e.getClientRects().length}).length")) === 1, 'a11y: the headline is the one heading');

  console.log('[phone] analytics and the link');
  ok(evs('signup_offer_opened', (d) => d.trigger === 'ad_link').length === 1 && evs('signup_offer_opened').length === 1, `events: signup_offer_opened once, from the ad link (${evs('signup_offer_opened').length})`);
  ok(evs('demo_opened').length === 0, `events: no demo_opened for the offer (${evs('demo_opened').length})`);
  ok(evs('signup_offer_opened', (d) => d.attr && d.attr.utm_source === 'qa_src' && d.attr.click_id === 'qa_click').length === 1, 'attribution: the ad tags ride on signup_offer_opened');
  ok((await ev("document.querySelector('.demo-so__cta').tagName")) === 'A' && (await ev("document.querySelector('.demo-so__cta').getAttribute('href')")).indexOf(SIGNUP) === 0, '"Start now" is a link into the sign-up flow');
  await tap('.demo-so__cta');
  const c1 = await lastClick();
  let u1 = null; try { u1 = new URL(c1.href); } catch {}
  const vid = await ev('window.boltAttr && window.boltAttr.visitorId()');
  ok(!!u1 && u1.origin + u1.pathname === SIGNUP && u1.searchParams.get('bvid') === vid && u1.searchParams.get('utm_source') === 'qa_src' && u1.searchParams.get('utm_campaign') === 'qa_camp' && u1.searchParams.get('fbclid') === 'qa_click' && u1.searchParams.get('bolt_qa') === '1', `the tap leaves for the sign-up flow with this visitor's id, the ad tags and the QA flag (${c1 && c1.href})`);
  await sleep(300);
  ok(evs('trial_link_clicked', (d) => d.placement === 'signup_offer').length === 1 && evs('trial_link_clicked').length === 1, `events: the tap logged once, trial_link_clicked {placement: signup_offer} (${JSON.stringify(evs('trial_link_clicked').map((e) => e.data.placement))})`);

  console.log('[phone] pricing: the feed reaches the card whether it answers before or after it is built');
  // The order that needs reapply: an in-app browser preloads the ad page HIDDEN, the feed
  // answers, and the card is only built when someone looks (AFMBP-2010's whenVisible).
  const hidden = await send('Page.addScriptToEvaluateOnNewDocument', { source: HIDDEN });
  reset(FEED, 0);
  await load(AD, 1500);
  ok((await screen()) === null && (await ev('document.visibilityState')) === 'hidden', 'pricing: a preloaded (hidden) page builds no card yet');
  await ev("window.__vs = 'visible'; document.dispatchEvent(new Event('visibilitychange')); 1");
  ok(await waitScreen('signup'), 'pricing: the card opens once the page is seen');
  ok((await offer()) === OFFER(14, '$89'), `pricing: the card built AFTER the feed answered shows the feed's trial and price (${await offer()})`);
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: hidden.identifier });
  reset(FEED, 2000);
  await load(AD, 300);
  ok(await waitScreen('signup'), 'pricing: offer open (feed slow)');
  const early = await offer();
  await sleep(2600);
  ok(early === OFFER(30, '$79') && (await offer()) === OFFER(14, '$89'), `pricing: the fallback first, then the feed's numbers when it answers late (${early} -> ${await offer()})`);

  console.log('[phone] closing');
  reset();
  await load(AD);
  ok(await waitScreen('signup'), 'close: offer open');
  const xb = await rect('.demo-close');
  await tapAt(xb.cx, xb.cy);
  ok((await screen()) === null, 'close: a tap on the cross closes the offer');
  ok(evs('demo_closed', (d) => d.step === 'signup_offer').length === 1 && evs('demo_closed').length === 1, `close: demo_closed once, step signup_offer (${JSON.stringify(evs('demo_closed').map((e) => e.data.step))})`);
  const xr = await ev("(function(){var v=document.querySelector(':focus-visible'); return v ? v.tagName.toLowerCase()+'.'+String(v.className).split(' ')[0] : null;})()");
  ok(!xr, `close: after the tap no ring shows anywhere (${xr})`);
  reset();
  await load(AD);
  ok(await waitScreen('signup'), 'close: offer open again');
  const sp = await ev("(function(){var b=document.querySelector('.demo-backdrop.open'), p=[[6,innerHeight-6],[6,innerHeight/2],[innerWidth-6,innerHeight-6],[innerWidth/2,innerHeight-6]]; for(var i=0;i<p.length;i++){ if(document.elementFromPoint(p[i][0],p[i][1])===b) return {x:p[i][0],y:p[i][1]}; } return null;})()");
  if (sp) await tapAt(sp.x, sp.y);
  ok(!!sp && (await screen()) === null, 'close: a tap on the shade closes it');

  console.log('[phone] keyboard: focus starts on the dialog; Tab goes round the cross, "Start now" and help');
  reset();
  await load(AD);
  ok(await waitScreen('signup'), 'keyboard: offer open');
  const f0 = await ev(FOCUS);
  // The card's hairline is a painted inset shadow, not a ring: the dialog's outline is what must stay off.
  ok(f0.on === 'dialog' && f0.outline === 'none', `keyboard: focus is on the dialog as it opens, and it draws no ring (${f0.on} ${f0.outline})`);
  const fwd = [await tab(), await tab(), await tab(), await tab()];
  ok(isClose(fwd[0]) && isCta(fwd[1]) && /Contact support/.test(fwd[2].desc) && isClose(fwd[3]), `keyboard: Tab goes the cross, "Start now", the help link, then round (${fwd.map((f) => f.desc).join(' > ')})`);
  ok(fwd.every((f) => f.on === 'inside'), 'keyboard: Tab never leaves the dialog');
  const bwd = [await tab(true), await tab(true), await tab(true)];
  ok(/Contact support/.test(bwd[0].desc) && isCta(bwd[1]) && isClose(bwd[2]) && bwd.every((f) => f.on === 'inside'), `keyboard: Shift+Tab goes back round (${bwd.map((f) => f.desc).join(' > ')})`);
  await tab();
  await key('Enter', 'Enter', 13);
  const k1 = await lastClick();
  ok(!!k1 && k1.href.indexOf(SIGNUP) === 0 && evs('trial_link_clicked', (d) => d.placement === 'signup_offer').length === 1, 'keyboard: Enter on "Start now" goes to the sign-up flow, logged once');
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
    ok(b && b.x >= c.x && b.x + b.w <= c.x + c.w && b.y >= 0 && b.y + b.h <= h, `${w}x${h}: "Start now" inside the card and on screen (${JSON.stringify(b)})`);
    const pb = await rect('.demo-backdrop.open .demo-so__pill');
    ok(!!pb && pb.x >= c.x && pb.x + pb.w <= c.x + c.w && pb.w > 0, `${w}x${h}: the headline's pill inside the card (${pb && [pb.x.toFixed(1), (pb.x + pb.w).toFixed(1)]})`);
    const x = await rect('.demo-close');
    ok(!!x && (await visible('.demo-close')) && x.x >= c.x && x.x + x.w <= c.x + c.w && x.y >= 0 && x.w >= 36, `${w}x${h}: the close button inside the card and on screen, at least 36px`);
    for (const [sel, want] of [['.demo-cm__h', 2], ['.demo-cm__sub', 4], ['.demo-so__trial', 2], ['.demo-cm__score', 1], ['.demo-cm__quote', 1], ['.demo-help', 1], ['.demo-so__cta', 1]]) {
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
