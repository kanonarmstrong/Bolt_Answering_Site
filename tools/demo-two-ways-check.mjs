// AFMBP-2083 — the demo's two ways in: "Call now" (the visitor calls Bolt's demo line with a
// one-time code) and "Get a call" (the outbound demo, unchanged). Drives the real modal in
// headless Chrome with real touch taps and mouse clicks against a fake Bolt API, and checks:
//   - the choice opens first; "Call now" is a real tel: link carrying this browser's code
//     before anyone taps, and the tap is left to the dialer on a phone (not on a computer);
//   - the page follows THIS session's call (its own status URL), to the shared recap;
//   - a phone that never left the page shows the number to call; coming back to the page
//     checks at once; a reload mid-call picks the same call back up;
//   - expired / failed / limit / no code; Continue starts over with a new code;
//   - analytics: the inbound branch carries mode:'inbound', success is counted once, and the
//     outbound demo's events are exactly as before (no mode, same steps).
// Run: node tools/demo-two-ways-check.mjs [siteRoot]
//      SHOTS=<dir> also saves a screenshot of every new state (desktop 1920x1200 @1x,
//      phone 402x753 @3x) plus boxes.json (each card's box), for the Figma comparison.
//      NC=no_href | NC=no_reconcile | NC=no_reveal | NC=mode_leak | NC=trade_reuse | NC=no_gen — negative controls on the
//      SERVED copy only; each must FAIL.
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
const PORT = 20000 + Math.floor(Math.random() * 10000), DBG = 30000 + Math.floor(Math.random() * 10000);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.webp': 'image/webp' };

const cut = (s, from, to) => { if (!s.includes(from)) throw new Error(`NC anchor missing: ${from}`); return s.split(from).join(to); };
const MUTATE = {
  // "Call now" never gets its tel: link.
  no_href: (s) => cut(s, "if (s) call.setAttribute('href', s.telUri);", ''),
  // Coming back to the page waits for the next scheduled poll instead of checking at once.
  no_reconcile: (s) => cut(s, "    if (f.callId) pollRecap(f.callId, inboundRecapOpts());\n    else pollInbound(f.session);\n", ''),
  // A tap that never reached the dialer leaves no number on the phone card.
  no_reveal: (s) => cut(s, 'if (inboundFlow === f && !f.hidden && !f.callId) revealDial();', ''),
  // The outbound demo's events start carrying a mode.
  mode_leak: (s) => cut(s, 'function modeProps(p) { if (recapMode) p.mode = recapMode; return p; }', "function modeProps(p) { p.mode = recapMode || 'outbound'; return p; }"),
  // A code fetched on one trade page is reused on another (AFMBP-2096).
  trade_reuse: (s) => cut(s, 'return !!s && s.trade === TRADE && s.expiresAt', 'return !!s && s.expiresAt'),
  // Answers from superseded checks are processed again (AFMBP-2099).
  no_gen: (s) => cut(cut(s, 'if (gen !== inboundGen) return;   // superseded while it was out', ''), 'if (gen !== recapGen) return;   // superseded while it was out', ''),
};
if (NC && !MUTATE[NC]) throw new Error(`unknown NC "${NC}"; one of ${Object.keys(MUTATE).join(', ')}`);

const srv = createServer((req, res) => {
  try {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
    let f = join(ROOT, p);
    if (statSync(f).isDirectory()) f = join(f, 'index.html');
    let body = readFileSync(f);
    if (NC && f.endsWith('/demo.js')) body = Buffer.from(MUTATE[NC](body.toString('utf8')));
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(PORT, '127.0.0.1');

// ---- the fake Bolt API ----
const api = {
  sessions: new Map(), // sessionId -> { code, state, callId }
  recaps: new Map(), // callId -> recap body
  createStatus: 200,
  created: 0,
  delayMs: 0, // hold every Bolt API answer this long (overlapping checks)
  trades: [], // the trade each code was fetched for, in order
  statusGets: [], // { t, id }
  events: [], // { type, data }
  nextCode: 4321,
};
const reset = () => { api.sessions.clear(); api.recaps.clear(); api.createStatus = 200; api.created = 0; api.delayMs = 0; api.trades = []; api.statusGets = []; api.events = []; api.nextCode = 4321; };
function apiRespond(method, url, postData) {
  const p = new URL(url).pathname;
  if (method === 'POST' && p === '/api/demo/inbound/session') {
    if (api.createStatus !== 200) return [api.createStatus, { error: 'demo_inbound_disabled' }];
    const id = `00000000-0000-4000-8000-${String(++api.created).padStart(12, '0')}`;
    const code = String(api.nextCode++);
    api.sessions.set(id, { code, state: 'waiting', callId: null });
    try { api.trades.push(JSON.parse(postData || '{}').trade); } catch { api.trades.push(null); }
    return [200, { sessionId: id, code, number: '+18554973151', numberDisplay: '(855) 497-3151', telUri: `tel:+18554973151,,${code}`, expiresAt: new Date(Date.now() + 600000).toISOString() }];
  }
  let m = p.match(/^\/api\/demo\/inbound\/session\/([^/]+)$/);
  if (m) {
    api.statusGets.push({ t: Date.now(), id: m[1] });
    const s = api.sessions.get(m[1]);
    return s ? [200, { state: s.state, callId: s.callId }] : [404, { error: 'not found' }];
  }
  m = p.match(/^\/api\/demo\/recap\/([^/]+)$/);
  if (m) return [200, api.recaps.get(m[1]) || { status: 'in_call', transcript: null }];
  if (p === '/api/public/analytics/events') {
    try { for (const e of JSON.parse(postData || '{}').events || []) api.events.push({ type: e.event_type, data: e.event_data || {} }); } catch {}
    return [200, { ok: true }];
  }
  if (p === '/api/demo/otp/send' || p === '/api/demo/otp/verify') return [200, { ok: true }];
  if (p === '/api/demo/token') return [200, { token: 'qa-token' }];
  if (p === '/api/demo/call') return [200, { callId: 'out-1' }];
  return [200, {}];
}
const TRANSCRIPT = [
  { role: 'assistant', content: "Hi, you've reached Bolt Services. Nobody's available right now, but I'm Bolt Services's smart assistant." },
  { role: 'user', content: 'My AC stopped blowing cold air.' },
];
const lastSession = () => [...api.sessions.entries()].pop();
const setState = (state, callId = null) => { const [, s] = lastSession(); s.state = state; s.callId = callId; };
const evs = (type, pred = () => true) => api.events.filter((e) => e.type === type && pred(e.data));

const PROFILE = mkdtempSync(join(tmpdir(), 'cdp-2083-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0, good = 0;
const ok = (c, m) => { if (c) good++; else { bad++; console.log(`  FAIL ${m}`); } };
const boxes = {};

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
    // A request the page dropped (it navigated) has no interception left to answer.
    const quiet = (p) => p.catch(() => {});
    if (new URL(request.url).hostname === '127.0.0.1') return quiet(send('Fetch.continueRequest', { requestId }));
    if (request.method === 'OPTIONS') return quiet(send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: CORS }));
    const bolt = /bolt-staging\.fly\.dev$/.test(new URL(request.url).hostname);
    const [code, body] = bolt ? apiRespond(request.method, request.url, request.postData) : [200, {}];
    const answer = () => quiet(send('Fetch.fulfillRequest', { requestId, responseCode: code, responseHeaders: [...CORS, { name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') }));
    return bolt && api.delayMs ? setTimeout(answer, api.delayMs) : answer();
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  // QA visit (no Meta / Google), a controllable visibility state, and a record of whether the
  // browser was left to follow each click (a tel: link it may hand to the dialer).
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: "try{localStorage.setItem('bolt_qa','1')}catch(e){}" +
      "Object.defineProperty(document,'visibilityState',{configurable:true,get:function(){return window.__vis||'visible'}});" +
      "Object.defineProperty(document,'hidden',{configurable:true,get:function(){return (window.__vis||'visible')==='hidden'}});" +
      // Runs after the page's own handlers. A tel: link the page left alone is recorded as
      // followed, then held here: headless Chrome stalls on a second hand-off to the OS.
      "window.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a');window.__clicks=(window.__clicks||[]).concat([{href:a?a.getAttribute('href'):null,followed:!e.defaultPrevented}]);if(a&&/^tel:/.test(a.getAttribute('href')||''))e.preventDefault();});",
  });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : null; };
  // A fresh visit forgets the last scenario's demo-line session (same tab, same origin).
  // Ready = the NEW document, loaded (right after Page.navigate the old one still answers).
  const load = async (path, { keepStorage = false } = {}) => {
    if (!keepStorage) await ev('try{sessionStorage.clear()}catch(e){}');
    await ev('window.__old = 1');
    await send('Page.navigate', { url: ORIGIN + path });
    for (let i = 0; i < 100; i++) { if ((await ev(`!window.__old && document.readyState === 'complete' && location.pathname + location.search === ${JSON.stringify(path)}`)) === true) break; await sleep(100); }
    await ev('document.fonts && document.fonts.ready.then(function(){return 1})');
    await sleep(900);
  };
  const screen = () => ev("(document.querySelector('.demo-backdrop.open')||{getAttribute:function(){return null}}).getAttribute('data-screen')");
  const waitScreen = async (want, ms = 6000) => { for (let i = 0; i < ms / 100; i++) { if ((await screen()) === want) return true; await sleep(100); } return false; };
  const box = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; var r=e.getBoundingClientRect(); return {x:r.left,y:r.top,w:r.width,h:r.height,cx:r.left+r.width/2,cy:r.top+r.height/2};})()`);
  const visible = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; var s=getComputedStyle(e); var r=e.getBoundingClientRect(); return s.display!=='none' && s.visibility!=='hidden' && r.width>0 && r.height>0;})()`);
  const text = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); return e ? e.innerText.replace(/\\s+/g,' ').trim() : null;})()`);
  let touch = false;
  const tap = async (sel) => {
    const b = await box(sel);
    if (!b) return false;
    if (touch) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.cx, y: b.cy }] });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: b.cx, y: b.cy, button: 'left', clickCount: 1 });
    }
    await sleep(300);
    return true;
  };
  const lastClick = () => ev('(window.__clicks||[]).slice(-1)[0]||null');
  const reopen = () => ev("(function(){var b=[].slice.call(document.querySelectorAll('a.btn--blue, button.btn--blue, [data-demo-open]')).filter(function(x){return x.hasAttribute('data-demo-open') || /talk to your new assistant/i.test(x.textContent)})[0]; b.click(); return 1;})()");
  const setVis = async (v) => { await ev(`window.__vis=${JSON.stringify(v)}; document.dispatchEvent(new Event('visibilitychange')); 1`); };
  const stored = () => ev("(function(){try{return JSON.parse(sessionStorage.getItem('bolt_demo_inbound')||'null')}catch(e){return 'err'}})()");
  const shot = async (name, sel) => {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    await sleep(500);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(r.data, 'base64'));
    boxes[name] = await box(sel);
  };
  const phone = async () => {
    touch = true;
    await send('Emulation.setDeviceMetricsOverride', { width: 402, height: 753, deviceScaleFactor: 3, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  };
  const desktop = async () => {
    touch = false;
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1200, deviceScaleFactor: 1, mobile: false });
  };

  // ================= phone =================
  await phone();
  console.log('[phone 402x753] call now -> dialer -> back -> recap');
  reset();
  await load('/hvac.html?talk=1');
  ok((await ev("matchMedia('(hover:hover) and (pointer:fine)').matches")) === false, 'phone: emulated as a touch device');
  ok(await waitScreen('choice'), 'phone: ?talk=1 opens on the choice');
  await sleep(300);
  ok(api.created === 1, `phone: one code fetched on open (${api.created})`);
  ok((await ev("document.querySelector('.demo-choice__call').getAttribute('href')")) === 'tel:+18554973151,,4321', 'phone: "Call now" is a tel: link with the line, a pause and the code, before any tap');
  // AFMBP-2090: the redrawn phone node drops "now" (desktop keeps it).
  ok((await text('.demo-choice__h')) === '2 ways to talk to an assistant', `phone: heading copy (${await text('.demo-choice__h')})`);
  ok((await visible('.demo-choice__or')) && !(await visible('.demo-choice__two')), 'phone: "OR" shown, "Two" hidden');
  ok(!(await ev("!!document.querySelector('.demo-backdrop.open .demo-disclosure')")), 'phone: no consent line on the choice');
  await shot('m-choice', '.demo-card');
  await tap('.demo-choice__call');
  const c1 = await lastClick();
  ok(!!c1 && c1.href === 'tel:+18554973151,,4321' && c1.followed === true, `phone: the tap is left to the dialer (${JSON.stringify(c1)})`);
  ok(await waitScreen('inbound-call'), 'phone: call card after the tap');
  ok((await text('.demo-incall__digits')) === '4321', 'phone: the card shows the code');
  ok(!(await visible('.demo-incall__dial')), 'phone: number line hidden right after a tap that reached the dialer');
  await shot('m-incall', '.demo-card');
  // The dialer took over: the page goes to the background before the 4s check.
  await setVis('hidden');
  await sleep(4500);
  ok(!(await visible('.demo-incall__dial')), 'phone: number line still hidden while the page is behind the dialer');
  // Line up right after a scheduled check (answered "waiting"), so the next scheduled one is
  // ~3s away: a check within 450ms of coming back can only be the page reconciling.
  for (let n = api.statusGets.length, i = 0; api.statusGets.length === n && i < 100; i++) await sleep(20);
  setState('connected', 'in-1');
  api.recaps.set('in-1', { status: 'in_call', transcript: null });
  const before = api.statusGets.length;
  const tBack = Date.now();
  await setVis('visible');
  await sleep(500);
  ok(api.statusGets.length > before && api.statusGets[before].t - tBack < 450, 'phone: coming back to the page checks the call at once');
  ok(api.statusGets.every((g) => g.id === lastSession()[0]), 'phone: every status check is for THIS browser\'s session');
  api.recaps.set('in-1', { status: 'completed', transcript: TRANSCRIPT, durationSec: 41 });
  ok(await waitScreen('recap', 8000), 'phone: the linked call goes to the shared recap');
  await sleep(400);
  ok(/Bolt Services/.test((await text('.demo-chat')) || ''), 'phone: recap shows the call transcript');
  ok((await stored()) === null, 'phone: finished flow leaves nothing to resume');
  ok(evs('demo_mode_selected', (d) => d.mode === 'inbound' && d.dial === 'auto').length === 1, 'events: demo_mode_selected inbound/auto once');
  ok(evs('demo_inbound_call_tapped', (d) => d.from === 'choice' && d.mode === 'inbound').length === 1, 'events: demo_inbound_call_tapped once');
  ok(evs('demo_inbound_call_connected', (d) => d.call_id === 'in-1' && d.mode === 'inbound').length === 1, 'events: demo_inbound_call_connected once with the call id');
  ok(evs('demo_call_finished', (d) => d.call_id === 'in-1' && d.mode === 'inbound').length === 1 && evs('demo_call_finished').length === 1, 'events: demo_call_finished once, mode inbound');
  ok(evs('demo_transcript_shown', (d) => d.mode === 'inbound').length === 1, 'events: demo_transcript_shown once, mode inbound');
  ok(['demo_call_placed', 'demo_code_verified', 'demo_details_submitted', 'demo_code_sent'].every((x) => evs(x).length === 0), 'events: no outbound steps on the inbound branch');
  ok(evs('demo_opened').length === 1, 'events: demo_opened once');
  // A synthetic click (the trial link would leave the page; the click is still tracked).
  await ev("(function(){var a=document.querySelector('.demo-success-cta'); a.addEventListener('click', function (e) { e.preventDefault(); }); a.click(); return 1;})()");
  await sleep(300);
  ok(evs('demo_trial_clicked', (d) => d.from === 'recap' && d.mode === 'inbound' && d.call_id === 'in-1').length === 1, 'events: trial click from the inbound recap carries mode');
  await ev("document.querySelector('.demo-close').click(); 1");
  await reopen();
  ok(await waitScreen('choice'), 'phone: reopening after a finished demo starts at the choice');
  await sleep(300);
  ok(api.created === 2, `phone: and with a new code (${api.created})`);

  console.log('[phone] tap never reached the dialer -> number shown');
  reset();
  await load('/hvac.html?talk=1');
  await waitScreen('choice'); await sleep(300);
  await tap('.demo-choice__call');
  await waitScreen('inbound-call');
  await sleep(4500);
  ok(await visible('.demo-incall__dial'), 'phone: no dialer after 4s -> "Call (855) 497-3151" shown');
  ok((await ev("document.querySelector('.demo-incall__tel').getAttribute('href')")) === 'tel:+18554973151,,4321', 'phone: the number is the same tel: link');
  ok((await text('.demo-incall__dial')) === 'Call (855) 497-3151', `phone: number line copy (${await text('.demo-incall__dial')})`);
  await shot('m-incall-manual', '.demo-card');

  console.log('[phone] reload mid-call -> same call, to its recap');
  setState('connected', 'in-2');
  api.recaps.set('in-2', { status: 'in_call', transcript: null });
  await sleep(3500);
  const openedBefore = evs('demo_opened').length;
  await load('/hvac.html', { keepStorage: true });
  ok(await waitScreen('inbound-call'), 'phone: reload while on the call reopens the call card');
  api.recaps.set('in-2', { status: 'completed', transcript: TRANSCRIPT });
  ok(await waitScreen('recap', 8000), 'phone: and follows that call to its recap');
  ok(evs('demo_opened').length === openedBefore, 'events: the resume is not a new demo_opened');
  ok(evs('demo_inbound_call_connected', (d) => d.call_id === 'in-2').length === 1, 'events: connected once across the reload');

  console.log('[phone] closed before the call connected -> reopen goes back to the choice, same code');
  reset();
  await load('/hvac.html?talk=1');
  await waitScreen('choice'); await sleep(300);
  await tap('.demo-choice__call');
  await waitScreen('inbound-call');
  await ev("document.querySelector('.demo-close').click(); 1");
  await sleep(300);
  await reopen();
  ok(await waitScreen('choice'), 'phone: not connected -> back to the choice');
  await sleep(300);
  ok(api.created === 1 && (await ev("document.querySelector('.demo-choice__call').getAttribute('href')")) === 'tel:+18554973151,,4321', 'phone: same code, no second session');

  console.log('[phone] another trade page in the same tab -> its own code (AFMBP-2096)');
  reset();
  await load('/hvac.html?talk=1');
  await waitScreen('choice'); await sleep(300);
  await load('/plumbing.html?talk=1', { keepStorage: true });
  ok(await waitScreen('choice'), 'phone: plumbing page opens on the choice');
  await sleep(400);
  ok(api.created === 2 && api.trades.join(',') === 'hvac,plumbing', `phone: the plumbing page fetched its own code (${api.trades.join(',')})`);
  ok((await ev("document.querySelector('.demo-choice__call').getAttribute('href')")) === 'tel:+18554973151,,4322', 'phone: "Call now" carries the plumbing code, not the hvac one');
  await load('/plumbing.html?talk=1', { keepStorage: true });
  await waitScreen('choice'); await sleep(400);
  ok(api.created === 2, `phone: back on the same trade page, the same code is reused (${api.created} codes)`);

  console.log('[phone] back from the call with two checks in flight -> counted once (AFMBP-2099)');
  reset();
  await load('/hvac.html?talk=1');
  await waitScreen('choice'); await sleep(300);
  await tap('.demo-choice__call');
  await waitScreen('inbound-call');
  await setVis('hidden');
  await sleep(300);
  setState('completed', 'in-9');
  api.recaps.set('in-9', { status: 'completed', transcript: TRANSCRIPT });
  // Answers take 700ms, so the two checks below overlap, as on an iPhone waking up.
  api.delayMs = 700;
  await setVis('visible');
  await sleep(100);
  await setVis('hidden');
  await setVis('visible');
  ok(await waitScreen('recap', 8000), 'phone: the call is followed to the recap');
  await sleep(2500);
  api.delayMs = 0;
  ok(evs('demo_transcript_shown', (d) => d.call_id === 'in-9').length === 1, `events: demo_transcript_shown once (${evs('demo_transcript_shown').length})`);
  ok(evs('demo_call_finished', (d) => d.call_id === 'in-9').length === 1, `events: demo_call_finished once (${evs('demo_call_finished').length})`);
  ok(evs('demo_inbound_call_connected', (d) => d.call_id === 'in-9').length === 1, `events: demo_inbound_call_connected once (${evs('demo_inbound_call_connected').length})`);

  console.log('[phone] expired -> failure -> Continue -> new code');
  reset();
  await load('/hvac.html?talk=1');
  await waitScreen('choice'); await sleep(300);
  await tap('.demo-choice__call');
  await waitScreen('inbound-call');
  setState('expired');
  ok(await waitScreen('inbound-fail', 6000), 'phone: an expired code shows the failure card');
  ok((await text('.demo-ifail')) === 'Sorry... that didn’t work We weren’t able to connect. Please try your call again later. Continue', `phone: failure copy (${await text('.demo-ifail')})`);
  ok(evs('demo_inbound_failed', (d) => d.reason === 'expired' && d.mode === 'inbound').length === 1, 'events: demo_inbound_failed reason expired');
  await shot('m-fail', '.demo-card');
  await tap('.demo-ifail__btn');
  ok(await waitScreen('choice'), 'phone: Continue -> the choice');
  await sleep(400);
  ok(api.created === 2 && (await ev("document.querySelector('.demo-choice__call').getAttribute('href')")) === 'tel:+18554973151,,4322', 'phone: with a new code');

  console.log('[phone] lifetime cap -> the limit form');
  reset();
  await load('/hvac.html?talk=1');
  await waitScreen('choice'); await sleep(300);
  await tap('.demo-choice__call');
  await waitScreen('inbound-call');
  setState('limit');
  ok(await waitScreen('phone', 6000), 'phone: limit -> the form with the limit message');
  ok(await visible('.demo-limitmsg'), 'phone: limit message shown');

  console.log('[phone] the line is off -> "Call now" ends on the failure card; "Get a call" still works');
  reset();
  api.createStatus = 503;
  await load('/hvac.html?talk=1');
  await waitScreen('choice'); await sleep(300);
  ok((await ev("document.querySelector('.demo-choice__call').getAttribute('href')")) === '#', 'phone: no code, no tel: link');
  await tap('.demo-choice__call');
  ok(await waitScreen('inbound-fail', 6000), 'phone: no code -> failure card');
  ok(evs('demo_inbound_session_failed', (d) => d.reason === 'demo_inbound_disabled').length >= 1, 'events: demo_inbound_session_failed with the reason');
  await tap('.demo-ifail__btn');
  await waitScreen('choice');
  await tap('.demo-choice__get');
  ok(await waitScreen('phone'), 'phone: "Get a call" opens the outbound form');

  // ================= desktop =================
  await desktop();
  console.log('[desktop 1920x1200] choice, call card with the number, outbound unchanged');
  reset();
  await load('/hvac.html?talk=1');
  ok((await ev("matchMedia('(hover:hover) and (pointer:fine)').matches")) === true, 'desktop: emulated as a mouse device');
  ok(await waitScreen('choice'), 'desktop: ?talk=1 opens on the choice');
  await sleep(300);
  ok((await text('.demo-choice__h')) === 'Two ways to talk to an assistant now', `desktop: heading copy (${await text('.demo-choice__h')})`);
  ok(!(await visible('.demo-choice__or')), 'desktop: no "OR"');
  await shot('d-choice', '.demo-card');
  await tap('.demo-choice__call');
  const c2 = await lastClick();
  ok(!!c2 && c2.followed === false, `desktop: "Call now" does not hand the link to the OS (${JSON.stringify(c2)})`);
  ok(await waitScreen('inbound-call'), 'desktop: call card');
  ok(await visible('.demo-incall__dial'), 'desktop: number to call shown');
  ok((await text('.demo-incall__code')) === 'Your code 4321', `desktop: code block (${await text('.demo-incall__code')})`);
  ok(evs('demo_mode_selected', (d) => d.mode === 'inbound' && d.dial === 'manual').length === 1, 'events: desktop selection is manual dial');
  await shot('d-incall', '.demo-card');
  setState('failed');
  ok(await waitScreen('inbound-fail', 6000), 'desktop: failed -> failure card');
  await shot('d-fail', '.demo-card');

  console.log('[desktop] outbound demo, end to end: unchanged events');
  reset();
  await load('/hvac.html?talk=form');
  ok(await waitScreen('phone'), 'desktop: ?talk=form opens straight on the outbound form');
  ok((await text('.demo-h--form')) === 'We’ll call you right now', 'desktop: outbound form heading unchanged');
  await ev(`(function(){
    function set(id,v){var e=document.getElementById(id); e.value=v; e.dispatchEvent(new Event('input',{bubbles:true}));}
    set('demo-phone','(555) 555-1212'); set('demo-business','QA HVAC'); return 1; })()`);
  await tap('.demo-backdrop.open .demo-btn');
  await sleep(600);
  await ev(`(function(){var b=document.querySelectorAll('.demo-code input'); b[0].value='123456'; b[0].dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`);
  ok(await waitScreen('calling', 6000), 'outbound: code accepted -> calling card');
  api.recaps.set('out-1', { status: 'completed', transcript: TRANSCRIPT });
  ok(await waitScreen('recap', 8000), 'outbound: -> recap');
  const outTypes = ['demo_details_submitted', 'demo_code_sent', 'demo_code_verified', 'demo_call_placed', 'demo_call_finished', 'demo_transcript_shown'];
  ok(outTypes.every((x) => evs(x).length === 1), `outbound: each step once (${outTypes.map((x) => evs(x).length).join(',')})`);
  ok(api.events.filter((e) => /^demo_/.test(e.type)).every((e) => !('mode' in e.data)), 'outbound: no event carries a mode (sent exactly as before)');
  ok(api.created === 0, `outbound: ?talk=form fetched no code (${api.created})`);

  if (SHOTS) {
    // The same states rendered on demand for any later visual check.
    writeFileSync(join(SHOTS, 'boxes.json'), JSON.stringify(boxes, null, 2));
  }
  console.log(bad ? `\n${bad} FAILED, ${good} passed${NC ? ` (negative control: ${NC})` : ''}` : `\nALL PASS (${good} checks)${NC ? ` — negative control ${NC} did NOT bite` : ''}`);
  ws.close();
} finally {
  chrome.kill('SIGKILL'); srv.close();
  await sleep(300); rmSync(PROFILE, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
