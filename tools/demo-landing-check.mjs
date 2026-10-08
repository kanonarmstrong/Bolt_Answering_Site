// AFMBP-2090 — the demo's first screen, redrawn for conversion on phones (Figma 2670:952):
// the rating and its quote, "Available now", "Make a call", and a line under each way in.
// Desktop keeps its own node (2670:896). Drives the real modal in headless Chrome against a
// fake Bolt API and checks:
//   - content: the phone node's copy and art, none of the superseded copy; desktop unchanged;
//   - geometry: each new piece where the node puts it at 402x753 (card-relative, glyph runs);
//   - routing: "Make a call" is the tel: link with this browser's code and opens the call
//     card; "Get a call" opens the outbound form — never swapped;
//   - attribution: the landing URL's utm_* and click id ride on both selection events;
//   - analytics: demo_opened once per open, each selection once;
//   - accessibility: stars hidden from the accessibility tree, the rest in reading order;
//     both ways in work from the keyboard, with a visible focus ring;
//   - keyboard focus (AFMBP-2097): the dialog takes focus as it opens and draws no ring of
//     its own; Tab reaches "Make a call" first and goes round the dialog, and Tab / Shift+Tab
//     never leave it, on every screen at both sizes; focus moved behind it comes back;
//     closing it from the keyboard gives focus back to the button that opened it, and closing
//     it with a tap or a click moves no focus and leaves no ring (iOS Safari rings a button a
//     script focuses after a tap on the shade);
//   - responsive: phones 320-430, tablet 768, desktop 1024-1920: no horizontal overflow,
//     both buttons inside the viewport, nothing outside the card.
// Run: node tools/demo-landing-check.mjs [siteRoot]
//      SHOTS=<dir> saves the choice at 402x753 @3x and 1920x1200 @1x (plus each phone size).
//      NC=<name> mutates the SERVED copy only; each must FAIL (see MUTATE). no_fix takes out
//      the whole AFMBP-2097 change.
// Nothing leaves the machine: Chrome resolves no host but 127.0.0.1, and every other request
// (Bolt's API, Meta, Google) is answered here.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

const ROOT = process.argv[2] ?? new URL('..', import.meta.url).pathname;
const NC = process.env.NC || '';
const SHOTS = process.env.SHOTS || '';
const ONLY = process.env.ONLY || ''; // 'sizes': only the size sweep (to compare with another root)
const PORT = 20000 + Math.floor(Math.random() * 10000), DBG = 30000 + Math.floor(Math.random() * 10000);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.webp': 'image/webp' };

const cut = (s, from, to) => { if (!s.includes(from)) throw new Error(`NC anchor missing: ${from}`); return s.split(from).join(to); };
const MUTATE = {
  // The two ways in swap places.
  swap_ctas: ['demo.js', (s) => cut(cut(cut(s, "'demo-btn demo-choice__btn demo-choice__call'", 'TMP_CALL'), "'demo-btn demo-choice__btn demo-choice__get'", "'demo-btn demo-choice__btn demo-choice__call'"), 'TMP_CALL', "'demo-btn demo-choice__btn demo-choice__get'")],
  // The phone shows the desktop label and title ("Call now", "…assistant now").
  old_label: ['demo.css', (s) => cut(s, '  .demo-choice__lbl-d,.demo-choice__now{display:none}\n', '')],
  // The stars reach screen readers (as text stars, not hidden).
  noisy_stars: ['demo.js', (s) => cut(s, "h('span', { class: 'demo-choice__stars', 'aria-hidden': 'true' }, [h('span'), h('span'), h('span'), h('span'), h('span')])", "h('span', { class: 'demo-choice__stars' }, ['★★★★★'])")],
  // The phone-only pieces leak onto desktop.
  desktop_leak: ['demo.css', (s) => cut(s, '.demo-choice__lbl-m,.demo-choice__proof,.demo-choice__when{display:none}\n', '')],
  // "Get a call" is counted twice.
  double_select: ['demo.js', (s) => cut(s, "      track('demo_mode_selected', { mode: 'outbound' });\n", "      track('demo_mode_selected', { mode: 'outbound' });\n      track('demo_mode_selected', { mode: 'outbound' });\n")],
  // The timing line wraps.
  wrap_when: ['demo.css', (s) => cut(s, '    position:absolute;left:0;width:337px;margin:0;font-size:9.6px;line-height:11.836px;color:#707070;text-align:center;white-space:nowrap;', '    position:absolute;left:100px;width:90px;margin:0;font-size:9.6px;line-height:11.836px;color:#707070;text-align:center;')],
  // The landing touch is dropped from every event.
  no_attr: ['attribution.js', (s) => cut(s, 'if (touch) data.attr = touch;', '')],
  // "Make a call" moves off the node.
  off_node: ['demo.css', (s) => cut(s, '.demo-choice__call{top:153px}', '.demo-choice__call{top:158px}')],
  // AFMBP-2097, one piece at a time, then all of it.
  // Opening the demo leaves keyboard focus where it was.
  no_focus_in: ['demo.js', (s) => cut(s, '    focusDialog();\n    // A reload in the middle', '    // A reload in the middle')],
  // Tab is not kept in the dialog.
  no_trap: ['demo.js', (s) => cut(s, "    document.addEventListener('keydown', keepTab, true);\n", '')],
  // Focus that lands behind the dialog stays there.
  no_guard: ['demo.js', (s) => cut(s, "    document.addEventListener('focusin', keepFocus, true);\n", '')],
  // Closing from the keyboard leaves focus where it was.
  no_restore: ['demo.js', (s) => cut(s, "    returnFocus(!!e && (e.type === 'keydown' || e.detail === 0));\n", '')],
  // A tap or a click on the shade also moves focus back to the button (iOS Safari rings it).
  pointer_restore: ['demo.js', (s) => cut(s, 'if (fromKeys && el && ', 'if (el && ')],
  // The dialog draws the browser's ring when it takes focus.
  card_ring: ['demo.css', (s) => cut(s, '.demo-card:focus{outline:none}\n', '')],
};
const UNFIX = [(s) => cut(s, ", tabindex: '-1' }, [close, logo, body]);", ' }, [close, logo, body]);'), (s) => cut(s, "openModal('button', null, b);", "openModal('button');")];
MUTATE.no_fix = [['demo.js', (s) => [...['no_focus_in', 'no_trap', 'no_guard', 'no_restore'].map((k) => MUTATE[k][1]), ...UNFIX].reduce((t, f) => f(t), s)], MUTATE.card_ring];
if (NC && !MUTATE[NC]) throw new Error(`unknown NC "${NC}"; one of ${Object.keys(MUTATE).join(', ')}`);
// [file, mutate] or a list of them. A missing anchor fails here, before anything runs: thrown
// while serving, it would 404 the file and fake a red run.
const MUTS = !NC ? [] : Array.isArray(MUTATE[NC][0]) ? MUTATE[NC] : [MUTATE[NC]];
for (const [file, fn] of MUTS) {
  const s = readFileSync(join(ROOT, file), 'utf8');
  if (fn(s) === s) throw new Error(`NC ${NC} leaves ${file} unchanged`);
}

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

// ---- the fake Bolt API ----
const api = { created: 0, events: [] };
const reset = () => { api.created = 0; api.events = []; };
function apiRespond(method, url, postData) {
  const p = new URL(url).pathname;
  if (method === 'POST' && p === '/api/demo/inbound/session') {
    const id = `00000000-0000-4000-8000-${String(++api.created).padStart(12, '0')}`;
    return [200, { sessionId: id, code: '4321', number: '+18554973151', numberDisplay: '(855) 497-3151', telUri: 'tel:+18554973151,,4321', expiresAt: new Date(Date.now() + 600000).toISOString() }];
  }
  if (/^\/api\/demo\/inbound\/session\//.test(p)) return [200, { state: 'waiting', callId: null }];
  if (p === '/api/public/analytics/events') {
    try { for (const e of JSON.parse(postData || '{}').events || []) api.events.push({ type: e.event_type, data: e.event_data || {} }); } catch {}
    return [200, { ok: true }];
  }
  return [200, {}];
}
const evs = (type, pred = () => true) => api.events.filter((e) => e.type === type && pred(e.data));
const ATTR = (d) => !!d.attr && d.attr.utm_source === 'qa_src' && d.attr.utm_campaign === 'qa_camp' && d.attr.click_id_type === 'fbclid' && d.attr.click_id === 'qa_click' && d.attr.landing === '/hvac.html';

const PROFILE = mkdtempSync(join(tmpdir(), 'cdp-2090-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0, good = 0;
const ok = (c, m) => { if (c) good++; else { bad++; console.log(`  FAIL ${m}`); } };

// The phone node (2670:952), card-relative CSS px: boxes, and the centres of the text runs.
const NODE = {
  card: { w: 337, h: 402 },
  // Figma renders the buttons on whole pixels (x 81-252, y 153 / 260 at 3x): those, not
  // the node's fractional 80.4 / 152.4, are what the screen must match.
  call: { x: 81, y: 153, w: 171, h: 49 },
  get: { x: 81, y: 260, w: 171, h: 49 },
  stars: { x: 49, y: 109, w: 75, h: 15 },
  // Text line boxes: the node's centres, each row 1px lower where Figma renders it so.
  centres: {
    '.demo-choice__score': [142.96, 117.167], '.demo-choice__live': [251.5, 117.167], '.demo-choice__quote': [100.4, 132.067],
    '.demo-choice__when--call': [168.5, 214.067], '.demo-choice__or': [166, 239.067], '.demo-choice__when--get': [168.5, 321.067],
    '.demo-help': [169.79, 355.1],
  },
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
    const [code, body] = /bolt-staging\.fly\.dev$/.test(new URL(request.url).hostname) ? apiRespond(request.method, request.url, request.postData) : [200, {}];
    return quiet(send('Fetch.fulfillRequest', { requestId, responseCode: code, responseHeaders: [...CORS, { name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') }));
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('DOM.enable'); await send('Accessibility.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  // QA visit (no Meta / Google); a tel: link the page leaves alone is recorded, then held
  // (headless Chrome stalls on handing it to the OS).
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: "try{localStorage.setItem('bolt_qa','1')}catch(e){}" +
      "window.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a');window.__clicks=(window.__clicks||[]).concat([{href:a?a.getAttribute('href'):null,followed:!e.defaultPrevented}]);if(a&&/^tel:/.test(a.getAttribute('href')||''))e.preventDefault();});",
  });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : null; };
  const load = async (path) => {
    await ev('try{sessionStorage.clear();localStorage.removeItem("bolt_attr")}catch(e){}');
    await ev('window.__old = 1');
    await send('Page.navigate', { url: ORIGIN + path });
    for (let i = 0; i < 100; i++) { if ((await ev(`!window.__old && document.readyState === 'complete' && location.pathname + location.search === ${JSON.stringify(path)}`)) === true) break; await sleep(100); }
    await ev('document.fonts && document.fonts.ready.then(function(){return 1})');
    await sleep(700);
  };
  const screen = () => ev("(document.querySelector('.demo-backdrop.open')||{getAttribute:function(){return null}}).getAttribute('data-screen')");
  const waitScreen = async (want, ms = 6000) => { for (let i = 0; i < ms / 100; i++) { if ((await screen()) === want) return true; await sleep(100); } return false; };
  const rect = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; var r=e.getBoundingClientRect(); return {x:r.left,y:r.top,w:r.width,h:r.height,cx:r.left+r.width/2,cy:r.top+r.height/2};})()`);
  // The box of the element's text itself (its glyph run), not its CSS box.
  // Text nodes only (element boxes are not glyphs); lines = runs whose tops sit within 6px.
  const run = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; var w=document.createTreeWalker(e,NodeFilter.SHOW_TEXT), n, rs=[]; while((n=w.nextNode())){ if(!n.textContent.trim()) continue; var g=document.createRange(); g.selectNodeContents(n); [].slice.call(g.getClientRects()).forEach(function(r){ if(r.width>0) rs.push(r); }); } if(!rs.length) return null; var x0=Math.min.apply(0,rs.map(function(r){return r.left})),x1=Math.max.apply(0,rs.map(function(r){return r.right})),y0=Math.min.apply(0,rs.map(function(r){return r.top})),y1=Math.max.apply(0,rs.map(function(r){return r.bottom})); var tops=rs.map(function(r){return r.top}).sort(function(a,b){return a-b}), lines=1; for(var i=1;i<tops.length;i++) if(tops[i]-tops[i-1]>6) lines++; return {x:x0,y:y0,w:x1-x0,h:y1-y0,cx:(x0+x1)/2,cy:(y0+y1)/2,lines:lines};})()`);
  const visible = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; var s=getComputedStyle(e); var r=e.getBoundingClientRect(); return s.display!=='none' && s.visibility!=='hidden' && r.width>0 && r.height>0;})()`);
  const text = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); return e ? e.innerText.replace(/\\s+/g,' ').trim() : null;})()`);
  let touch = false;
  const tapAt = async (x, y) => {
    if (touch) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    }
    await sleep(300);
  };
  const tap = async (sel) => {
    const b = await rect(sel);
    if (!b) return false;
    await tapAt(b.cx, b.cy);
    return true;
  };
  const key = async (k, code, vk) => {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk });
    if (k === 'Enter') await send('Input.dispatchKeyEvent', { type: 'char', text: '\r', key: k, code, windowsVirtualKeyCode: vk });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
    await sleep(150);
  };
  const lastClick = () => ev('(window.__clicks||[]).slice(-1)[0]||null');
  // Where keyboard focus is (AFMBP-2097): on the dialog itself, on one of its controls, or
  // outside it ('closed' when no dialog is open); which control (its place among the
  // dialog's showing, enabled controls); and whether a ring shows there.
  const FOCUS = `(function(){var a=document.activeElement, k=document.querySelector('.demo-backdrop.open .demo-card'), s=a?getComputedStyle(a):null;
    var ctl=k?[].slice.call(k.querySelectorAll('a[href],button,input')).filter(function(e){return !e.disabled && e.getClientRects().length && getComputedStyle(e).visibility!=='hidden'}):[];
    return {on: !k ? 'closed' : a===k ? 'dialog' : k.contains(a) ? 'inside' : 'outside', idx: ctl.indexOf(a), n: ctl.length,
      call: !!a && a.classList.contains('demo-choice__call'), get: !!a && a.classList.contains('demo-choice__get'),
      desc: a ? a.tagName.toLowerCase()+(a.className?'.'+String(a.className).trim().split(/\\s+/)[0]:'')+' '+JSON.stringify((a.innerText||a.getAttribute('aria-label')||'').replace(/\\s+/g,' ').trim().slice(0,22)) : 'none',
      fv: !!a && a.matches(':focus-visible'), outline: s ? s.outlineStyle : 'none',
      ring: !!s && ((s.outlineStyle!=='none' && parseFloat(s.outlineWidth)>0) || s.boxShadow!=='none')};})()`;
  // One Tab press (Shift+Tab with back), then where focus went.
  const tab = async (back = false) => {
    for (const type of ['rawKeyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: back ? 8 : 0 });
    await sleep(40);
    return ev(FOCUS);
  };
  const tabs = async (n, back = false) => { const r = []; for (let i = 0; i < n; i++) r.push(await tab(back)); return r; };
  const outside = (fs) => fs.filter((f) => f.on !== 'inside' && f.on !== 'dialog').map((f) => `${f.on} ${f.desc}`).join(', ');
  // The page's own "Talk to your new assistant" button showing at this size.
  const OPENER = "[].slice.call(document.querySelectorAll('a.btn--blue, button.btn--blue, [data-demo-open]')).filter(function(x){return (x.hasAttribute('data-demo-open') || /talk to your new assistant/i.test(x.textContent)) && x.getBoundingClientRect().width > 0})[0]";
  const openerState = () => ev(`(function(){var o=${OPENER}; return {back: document.activeElement === o, fv: o.matches(':focus-visible')};})()`);
  const view = async (w, h, dpr, mobile) => {
    touch = mobile;
    await send('Emulation.setTouchEmulationEnabled', mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile });
  };
  const shot = async (name) => {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    await sleep(400);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(r.data, 'base64'));
  };
  const axIgnored = async (sel) => {
    const { root } = await send('DOM.getDocument', { depth: -1 });
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
    if (!nodeId) return null;
    const { nodes } = await send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
    return nodes.length ? !!nodes[0].ignored : null;
  };
  const SUPERSEDED = ['Call now', 'Call us or we', 'assistant now'];
  let titleCx = 168.5; // the title's card-relative centre at the node's size (measured below)

  // ================= phone, the node's own size =================
  if (ONLY !== 'sizes') {
  await view(402, 753, 3, true);
  console.log('[phone 402x753] content, art, geometry, routing, attribution, analytics, accessibility');
  reset();
  await load('/hvac.html?talk=1&utm_source=qa_src&utm_campaign=qa_camp&fbclid=qa_click');
  ok(await waitScreen('choice'), 'phone: ?talk=1 opens on the choice');
  await sleep(400);
  await shot('choice-402x753@3x');
  if (SHOTS) writeFileSync(join(SHOTS, 'card-402x753.json'), JSON.stringify(await rect('.demo-backdrop.open .demo-card')));
  // content
  ok((await text('.demo-choice__h')) === '2 ways to talk to an assistant', `phone: title (${await text('.demo-choice__h')})`);
  ok((await text('.demo-choice__call')) === 'Make a call', `phone: "Make a call" (${await text('.demo-choice__call')})`);
  ok((await text('.demo-choice__get')) === 'Get a call', 'phone: "Get a call"');
  ok((await text('.demo-choice__score')) === '4.9/5', `phone: rating (${await text('.demo-choice__score')})`);
  ok((await text('.demo-choice__quote')) === '“Professional and helpful”', `phone: quote (${await text('.demo-choice__quote')})`);
  ok((await text('.demo-choice__live')) === 'Available now', 'phone: "Available now"');
  ok((await text('.demo-choice__when--call')) === 'Average time to connect: 3 seconds', `phone: line under "Make a call" (${await text('.demo-choice__when--call')})`);
  ok((await text('.demo-choice__when--get')) === 'Your assistant will call you right now', `phone: line under "Get a call" (${await text('.demo-choice__when--get')})`);
  ok((await ev("[].slice.call(document.querySelectorAll('.demo-choice__when b')).map(function(b){return b.textContent+':'+getComputedStyle(b).fontWeight}).join('|')")) === '3 seconds:600|right now:600', 'phone: "3 seconds" / "right now" semibold');
  ok((await text('.demo-choice__or')) === 'OR' && (await text('.demo-help')) === 'Need help? Contact support.', 'phone: "OR" and the help line');
  const modalText = await ev("document.querySelector('.demo-backdrop.open .demo-card').innerText");
  ok(SUPERSEDED.every((s) => !modalText.includes(s)), `phone: none of the superseded copy (${SUPERSEDED.filter((s) => modalText.includes(s)).join(', ')})`);
  ok(!(await visible('.demo-choice__sub')), 'phone: no subtitle');
  // art: the node's own vectors
  ok((await ev("document.querySelectorAll('.demo-choice__stars span').length")) === 5 && (await ev("[].slice.call(document.querySelectorAll('.demo-choice__stars span')).every(function(s){return /demo-m-star\\.svg/.test(getComputedStyle(s).backgroundImage) && s.getBoundingClientRect().width === 15})")), 'phone: five node stars');
  ok(/demo-m-ul-assistant\.svg/.test(await ev("getComputedStyle(document.querySelector('.demo-backdrop.open .demo-card'),'::after').backgroundImage")), 'phone: the node\'s brush under "talk to an assistant"');
  ok(/demo-m-dot-live\.svg/.test(await ev("getComputedStyle(document.querySelector('.demo-choice__live'),'::before').backgroundImage")), 'phone: the node\'s green dot');
  // Figma draws the quote as a slanted roman Inter (double-storey "a"), which is what the
  // browser synthesizes from the site's Inter; Inter 4's true italic has other letterforms.
  ok((await ev("getComputedStyle(document.querySelector('.demo-choice__quote')).fontStyle")) === 'italic' && /^'?Inter/.test(await ev("getComputedStyle(document.querySelector('.demo-choice__quote')).fontFamily")), 'phone: the quote in italic Inter');
  ok(/^'?Inter/.test(await ev("getComputedStyle(document.querySelector('.demo-choice__l1')).fontFamily")) && /Permanent Marker/.test(await ev("getComputedStyle(document.querySelector('.demo-choice__l2')).fontFamily")), 'phone: line 1 in Inter, line 2 in the marker (as the node)');
  // geometry, card-relative
  const card = await rect('.demo-backdrop.open .demo-card');
  const rel = (b) => b && { x: b.x - card.x, y: b.y - card.y, w: b.w, h: b.h, cx: b.cx - card.x, cy: b.cy - card.y, lines: b.lines };
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  ok(near(card.w, 337, 0.01) && near(card.h, 402, 0.01), `phone: card 337x402 (${card.w}x${card.h})`);
  for (const k of ['call', 'get', 'stars']) {
    const sel = k === 'stars' ? '.demo-choice__stars' : `.demo-choice__${k}`;
    const b = rel(await rect(sel)), n = NODE[k];
    ok(!!b && near(b.x, n.x, 0.5) && near(b.y, n.y, 0.5) && near(b.w, n.w, 0.5) && near(b.h, n.h, 0.5), `phone: ${k} box at the node's (${JSON.stringify(b)} vs ${JSON.stringify(n)})`);
  }
  // Horizontal: the glyph run's centre. Vertical: the line box's (a font's content area is
  // not its line box; the glyphs themselves are compared with the node's 3x export).
  for (const [sel, [cx, cy]] of Object.entries(NODE.centres)) {
    const g = rel(await run(sel)), b = rel(await rect(sel));
    ok(g && b && near(g.cx, cx, 1) && near(b.cy, cy, 0.5) && g.lines === 1, `phone: ${sel} centred where the node puts it, one line (${g && b && [g.cx.toFixed(2), b.cy.toFixed(2), g.lines]} vs ${cx},${cy})`);
  }
  titleCx = rel(await run('.demo-choice__h')).cx;
  // reading order follows the picture: title, rating, quote, availability, call + its line, OR, get + its line, help
  const order = ['.demo-choice__h', '.demo-choice__score', '.demo-choice__quote', '.demo-choice__live', '.demo-choice__call', '.demo-choice__when--call', '.demo-choice__or', '.demo-choice__get', '.demo-choice__when--get', '.demo-help'];
  ok((await ev(`(function(){var s=${JSON.stringify(order)}.map(function(q){return document.querySelector(q)}); for(var i=1;i<s.length;i++){ if(!(s[i-1].compareDocumentPosition(s[i]) & Node.DOCUMENT_POSITION_FOLLOWING)) return false; } return true;})()`)) === true, 'a11y: reading order matches the picture');
  ok((await axIgnored('.demo-choice__stars')) === true, 'a11y: the stars are hidden from screen readers');
  ok((await axIgnored('.demo-choice__score')) === false && (await axIgnored('.demo-choice__quote')) === false && (await axIgnored('.demo-choice__live')) === false, 'a11y: rating, quote and availability are read');
  ok((await ev("document.querySelector('.demo-choice__h').tagName")) === 'H2', 'a11y: the title stays a heading');
  // routing: "Make a call" is the call, with this browser's code
  ok(api.created === 1 && (await ev("document.querySelector('.demo-choice__call').getAttribute('href')")) === 'tel:+18554973151,,4321', 'phone: "Make a call" is the tel: link with the line, a pause and the code');
  await tap('.demo-choice__call');
  const c1 = await lastClick();
  ok(!!c1 && c1.href === 'tel:+18554973151,,4321' && c1.followed === true, `phone: the tap goes to the dialer (${JSON.stringify(c1)})`);
  ok(await waitScreen('inbound-call'), 'phone: "Make a call" -> the call card');
  ok(evs('demo_opened').length === 1, `events: demo_opened once (${evs('demo_opened').length})`);
  ok(evs('demo_mode_selected', (d) => d.mode === 'inbound').length === 1 && evs('demo_mode_selected').length === 1, `events: one selection, inbound (${JSON.stringify(evs('demo_mode_selected').map((e) => e.data.mode))})`);
  ok(evs('demo_mode_selected', ATTR).length === 1 && evs('demo_opened', ATTR).length === 1, 'attribution: utm_source, utm_campaign and fbclid ride on the open and the selection');

  console.log('[phone] "Get a call" -> the outbound form');
  reset();
  await load('/hvac.html?talk=1&utm_source=qa_src&utm_campaign=qa_camp&fbclid=qa_click');
  ok(await waitScreen('choice'), 'phone: choice again');
  await tap('.demo-choice__get');
  ok(await waitScreen('phone'), 'phone: "Get a call" -> the outbound form');
  ok((await text('.demo-h--form')) === 'We’ll call you right now', `phone: outbound form heading unchanged (${await text('.demo-h--form')})`);
  ok(evs('demo_mode_selected', (d) => d.mode === 'outbound').length === 1 && evs('demo_mode_selected').length === 1, `events: one selection, outbound (${evs('demo_mode_selected').length})`);
  ok(evs('demo_mode_selected', ATTR).length === 1, 'attribution: the touch rides on the "Get a call" selection');

  console.log('[phone] keyboard (AFMBP-2097): focus starts in the dialog, Tab goes round it and never leaves');
  reset();
  await load('/hvac.html?talk=1');
  ok(await waitScreen('choice'), 'keyboard: choice');
  // An ad link opens the demo with no tap. Focus starts on the dialog itself, not on a
  // control: iOS Safari rings a control a script focuses as the page loads.
  const f0 = await ev(FOCUS);
  ok(f0.on === 'dialog', `keyboard: focus is on the dialog as it opens (${f0.on} ${f0.desc}; before AFMBP-2097 it stayed on the page, 33 Tab presses from "Make a call")`);
  const fwd = await tabs(7);
  const toCall = fwd.findIndex((f) => f.call) + 1;
  console.log(`  note: Tab reaches "Make a call" after ${toCall} press(es): ${fwd.map((f) => f.desc).join(' > ')}`);
  ok(toCall >= 1 && toCall <= 2, `keyboard: Tab reaches "Make a call" within 2 presses of the dialog opening (${toCall})`);
  ok(!outside(fwd), `keyboard: Tab never leaves the dialog (${outside(fwd)})`);
  ok(fwd[0].call && fwd[1].get && /Contact support/.test(fwd[2].desc) && fwd[3].call, `keyboard: Tab goes "Make a call", "Get a call", the help link, then round to "Make a call" (${fwd.slice(0, 4).map((f) => f.desc).join(' > ')})`);
  const ring = { call: fwd[0].fv && fwd[0].ring, get: fwd[1].fv && fwd[1].ring };
  ok(ring.call && ring.get, `keyboard: each shows a focus ring (${JSON.stringify(ring)})`);
  const bwd = await tabs(7, true);
  ok(!outside(bwd), `keyboard: Shift+Tab never leaves the dialog (${outside(bwd)})`);
  ok(/Contact support/.test(bwd[0].desc) && bwd[1].get && bwd[2].call, `keyboard: Shift+Tab from "Make a call" goes round to the help link, then back (${bwd.slice(0, 3).map((f) => f.desc).join(' > ')})`);
  // Focus moved behind the dialog (a browser whose Tab skips some stops, a phone keyboard's
  // previous / next buttons, a script) comes straight back.
  const behind = await ev(`(function(){var b=[].slice.call(document.querySelectorAll('a[href],button,input')).filter(function(x){return !x.closest('.demo-backdrop') && x.getClientRects().length})[0]; b.focus(); return ${FOCUS};})()`);
  ok(behind.on === 'inside' || behind.on === 'dialog', `keyboard: focus moved behind the dialog comes back into it (${behind.on} ${behind.desc})`);
  // Enter on "Get a call", reached with Tab: the form, focus on its first field, Tab still in.
  for (let i = 0; i < 4 && !(await ev(FOCUS)).get; i++) await tab();
  await key('Enter', 'Enter', 13);
  ok(await waitScreen('phone'), 'keyboard: Enter on "Get a call" opens the form');
  await sleep(200);
  ok((await ev("document.activeElement === document.getElementById('demo-phone')")) === true, `keyboard: focus moves on to the phone field (${(await ev(FOCUS)).desc})`);
  const form = [...(await tabs(8)), ...(await tabs(8, true))];
  ok(!outside(form), `keyboard: on the form, Tab and Shift+Tab stay in the dialog (${outside(form)})`);
  reset();
  await load('/hvac.html?talk=1');
  ok(await waitScreen('choice'), 'keyboard: choice again');
  ok((await tab()).call, 'keyboard: one Tab, on "Make a call"');
  await key('Enter', 'Enter', 13);
  ok(await waitScreen('inbound-call'), 'keyboard: Enter on "Make a call" starts the call');
  const callCard = [...(await tabs(3)), ...(await tabs(3, true))];
  ok(!outside(callCard), `keyboard: on the call card, focus stays in the dialog (${outside(callCard)})`);

  // A point on the shade (outside the card, nothing else on top of it).
  const shade = () => ev("(function(){var b=document.querySelector('.demo-backdrop.open'), p=[[6,innerHeight-6],[6,innerHeight/2],[innerWidth-6,innerHeight-6],[innerWidth/2,innerHeight-6]]; for(var i=0;i<p.length;i++){ if(document.elementFromPoint(p[i][0],p[i][1])===b) return {x:p[i][0],y:p[i][1]}; } return null;})()");
  const openerAt = () => ev(`(function(){var o=${OPENER}; o.scrollIntoView({block:'center'}); var r=o.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2};})()`);
  for (const [w, h, dpr, mobile] of [[402, 753, 3, true], [1280, 800, 1, false]]) {
    const where = `${w}x${h}`;
    console.log(`[${where}] closing from the keyboard gives focus back to the button; a tap or a click moves none`);
    await view(w, h, dpr, mobile);
    reset();
    await load('/hvac.html');
    await openerAt();
    await ev(`(${OPENER}).focus(), 1`);
    await key('Enter', 'Enter', 13);
    ok(await waitScreen('choice'), `${where} restore: Enter on the page's "Talk to your new assistant" opens the demo`);
    // Opened from the keyboard, the dialog matches :focus-visible, where a browser draws its
    // ring. It must draw none; its controls keep theirs.
    const k1 = await ev(FOCUS);
    ok(k1.on === 'dialog' && k1.fv && k1.outline === 'none', `${where} restore: opened from the keyboard, focus is on the dialog and it draws no ring (${JSON.stringify({ on: k1.on, fv: k1.fv, outline: k1.outline })})`);
    if (!mobile) {
      const d1 = await tab();
      ok(d1.call, `${where} keyboard: the first Tab is on "Call now", the same link (${d1.desc})`);
      const dk = [...(await tabs(6)), ...(await tabs(7, true))];
      ok(!outside(dk), `${where} keyboard: Tab and Shift+Tab never leave the dialog (${outside(dk)})`);
    }
    await key('Escape', 'Escape', 27);
    ok((await screen()) === null, `${where} restore: Escape closes the demo`);
    const r1 = await openerState();
    ok(r1.back && r1.fv, `${where} restore: Escape gives focus back to "Talk to your new assistant", ring showing (${JSON.stringify(r1)})`);
    // Then a tap (a click on desktop) opens it and a tap on the shade closes it: no focus
    // moves and no ring shows anywhere. iOS Safari rings a button a script focuses after a
    // tap on the shade; Chrome does too once the keyboard has been used, as it just was.
    const o = await openerAt();
    await tapAt(o.x, o.y);
    ok(await waitScreen('choice'), `${where} restore: a ${mobile ? 'tap' : 'click'} on "Talk to your new assistant" opens the demo`);
    const sp = await shade();
    if (sp) await tapAt(sp.x, sp.y);
    ok(!!sp && (await screen()) === null, `${where} restore: a ${mobile ? 'tap' : 'click'} on the shade closes it`);
    const r2 = await ev(`(function(){var o=${OPENER}, v=document.querySelector(':focus-visible'); return {back: document.activeElement === o, ring: v ? v.tagName.toLowerCase()+'.'+String(v.className).split(' ')[0] : null};})()`);
    ok(!r2.back && !r2.ring, `${where} restore: after the ${mobile ? 'tap' : 'click'}, no focus moves to the button and no ring shows (${JSON.stringify(r2)})`);
  }

  console.log('[keyboard] every screen, both sizes: Tab and Shift+Tab stay in the dialog and reach every control');
  const LONG = Array.from({ length: 14 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', content: `Line ${i} of a longer transcript, long enough to wrap in its bubble.` }));
  const SCREENS = [
    ['choice', '__demoQA.choice()'], ['form', '__demoQA.phone()'], ['limit', '__demoQA.limit()'], ['code', '__demoQA.code()'],
    ['code, locked', "__demoQA.code({ error: 'Too many tries. Request a new code.', locked: true })"], ['calling you', '__demoQA.inCall()'],
    ['recap', `__demoQA.recap({ status: 'completed', transcript: ${JSON.stringify(LONG)} })`], ['recap, no transcript yet', "__demoQA.recap({ status: 'completed', transcript: null })"],
    ['call failed', '__demoQA.fail()'], ['error', '__demoQA.error()'],
    ['call card', "__demoQA.inbound('4321', false)"], ['call card with the number', "__demoQA.inbound('4321', true)"], ['call card failed', '__demoQA.inboundFail()'],
  ];
  for (const [w, h, dpr, mobile] of [[402, 753, 3, true], [1280, 800, 1, false]]) {
    await view(w, h, dpr, mobile);
    reset();
    await load('/hvac.html?demoqa=1');
    await ev('__demoQA.open(); 1');
    await sleep(300);
    for (const [name, js] of SCREENS) {
      await ev(`${js}; 1`);
      await sleep(150);
      await ev("document.querySelector('.demo-backdrop.open .demo-card').focus(); 1");
      const n = (await ev(FOCUS)).n;
      const fs = [...(await tabs(n + 2)), ...(await tabs(n + 2, true))];
      const seen = new Set(fs.map((f) => f.idx).filter((x) => x >= 0));
      ok(!outside(fs), `${w}x${h} ${name}: Tab and Shift+Tab stay in the dialog (${outside(fs)})`);
      ok(seen.size === n, `${w}x${h} ${name}: Tab reaches every control (${seen.size} of ${n})`);
    }
  }

  }

  // ================= sizes =================
  const SIZES = [[320, 568, 2, true], [360, 740, 3, true], [375, 667, 2, true], [390, 844, 3, true], [412, 915, 2.625, true], [430, 932, 3, true], [768, 1024, 2, true], [1024, 768, 1, false], [1280, 800, 1, false], [1920, 1200, 1, false]];
  for (const [w, h, dpr, mobile] of SIZES) {
    await view(w, h, dpr, mobile);
    reset();
    await load('/hvac.html');
    const pageOver = await ev('document.documentElement.scrollWidth - innerWidth');
    await load('/hvac.html?talk=1');
    ok(await waitScreen('choice'), `${w}x${h}: choice`);
    await sleep(300);
    const phoneLayout = w <= 768;
    if (phoneLayout && w !== 402) await shot(`choice-${w}x${h}`);
    const o = await ev("(function(){var b=document.querySelector('.demo-backdrop.open'); return {doc:document.documentElement.scrollWidth-innerWidth, bd:b.scrollWidth-b.clientWidth};})()");
    ok(o.doc <= Math.max(0, pageOver) && o.bd <= 0, `${w}x${h}: the demo adds no horizontal overflow (${JSON.stringify(o)}; the page alone ${pageOver})`);
    for (const sel of ['.demo-choice__call', '.demo-choice__get']) {
      const b = await rect(sel);
      ok(b && b.x >= 0 && b.y >= 0 && b.x + b.w <= w && b.y + b.h <= h, `${w}x${h}: ${sel} inside the viewport (${JSON.stringify(b)})`);
    }
    const c = await rect('.demo-backdrop.open .demo-card');
    if (phoneLayout) {
      ok(c.x >= 0 && c.x + c.w <= w, `${w}x${h}: the card inside the viewport (${c.x.toFixed(1)}..${(c.x + c.w).toFixed(1)})`);
      for (const sel of ['.demo-choice__h', '.demo-choice__score', '.demo-choice__quote', '.demo-choice__live', '.demo-choice__call', '.demo-choice__when--call', '.demo-choice__or', '.demo-choice__get', '.demo-choice__when--get', '.demo-help']) {
        const g = await run(sel);
        ok(g && g.x >= c.x + 4 && g.x + g.w <= c.x + c.w - 4 && g.lines === (sel === '.demo-choice__h' ? 2 : 1), `${w}x${h}: ${sel} on one line, inside the card (${g && [g.x.toFixed(1), (g.x + g.w).toFixed(1), g.lines]} in ${c.x.toFixed(1)}..${(c.x + c.w).toFixed(1)})`);
      }
      const s = await rect('.demo-choice__stars');
      ok(s.x >= c.x + 4 && s.x + s.w <= c.x + c.w - 4, `${w}x${h}: the stars inside the card`);
      // Centred as at the node's size: the same card-relative centre, less half of what the
      // card lost (it narrows under 369px).
      const tc = (await run('.demo-choice__h')).cx - c.x, want = titleCx - (337 - c.w) / 2;
      ok(Math.abs(tc - want) <= 1, `${w}x${h}: the title centred on the card as drawn (${tc.toFixed(2)} vs ${want.toFixed(2)})`);
    } else {
      ok((await text('.demo-choice__h')) === 'Two ways to talk to an assistant now', `${w}x${h}: desktop title unchanged (${await text('.demo-choice__h')})`);
      ok((await text('.demo-choice__call')) === 'Call now' && (await visible('.demo-choice__sub')), `${w}x${h}: desktop "Call now" and the subtitle`);
      ok(!(await visible('.demo-choice__proof')) && !(await visible('.demo-choice__when--call')) && !(await visible('.demo-choice__when--get')) && !(await visible('.demo-choice__lbl-m')), `${w}x${h}: none of the phone pieces on desktop`);
      if (w === 1920) await shot('d-choice-1920x1200');
    }
  }

  console.log(bad ? `\n${bad} FAILED, ${good} passed${NC ? ` (negative control: ${NC})` : ''}` : `\nALL PASS (${good} checks)${NC ? ` — negative control ${NC} did NOT bite` : ''}`);
  ws.close();
} finally {
  chrome.kill('SIGKILL'); srv.close();
  await sleep(300); rmSync(PROFILE, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
