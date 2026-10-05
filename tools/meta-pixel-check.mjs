// AFMBP-2021 — prove the Meta pixel loads only when allowed, sends the right events once, and
// hands the demo verify call the ids the server's Conversions API copy needs.
// Run: node tools/meta-pixel-check.mjs [siteRoot]
// Headless Chrome over CDP. Nothing leaves the machine: Meta's fbevents.js is replaced by a
// recording stub, the ingest and the demo API are stubbed in-page, and app.boltanswering.com
// navigations are cancelled.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
const ROOT = process.argv[2] ?? new URL('..', import.meta.url).pathname;
const PORT = 20000 + Math.floor(Math.random() * 10000), DBG = 30000 + Math.floor(Math.random() * 10000);
const TEST_ID = '123456789012345';
let pixelId = TEST_ID; // what the served meta-pixel.js carries; scenarios change it
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2' };
const srv = createServer((req, res) => {
  try {
    let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
    let f = join(ROOT, p); if (statSync(f).isDirectory()) f = join(f, 'index.html');
    let body = readFileSync(f);
    if (p.endsWith('meta-pixel.js')) {
      const src = body.toString('utf8');
      if (!src.includes("var PIXEL_ID = '';")) throw new Error('meta-pixel.js must ship with an empty PIXEL_ID');
      body = Buffer.from(src.replace("var PIXEL_ID = '';", `var PIXEL_ID = '${pixelId}';`));
    }
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(PORT, '127.0.0.1');
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${mkdtempSync('/tmp/cdp-2021-')}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/index.html`)).ok) break; } catch {} await sleep(100); }
let ver; for (let i = 0; i < 50 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${DBG}/json/version`)).json(); } catch { await sleep(200); } }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let nextId = 1; const pending = new Map(); const listeners = [];
ws.addEventListener('message', (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); } else listeners.forEach((f) => f(msg)); });
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const until = async (fn, ms) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(100); } return v; };

// In-page stubs: the ingest records, the demo API answers, signup links don't navigate.
const STUB = `window.__sent = []; window.__verify = [];
(function(){ var real = window.fetch;
  function json(o, s){ return Promise.resolve(new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json' } })); }
  window.fetch = function(url, init){
    var u = String(url);
    if (u.indexOf('/api/public/analytics/events') >= 0) { try { JSON.parse(init.body).events.forEach(function(e){ window.__sent.push({ type: e.event_type, sid: e.session_id, data: e.event_data }); }); } catch (x) {} return json({ ok: true }); }
    if (u.indexOf('/api/demo/otp/send') >= 0) return json({ ok: true });
    if (u.indexOf('/api/demo/otp/verify') >= 0) { try { window.__verify.push(JSON.parse(init.body)); } catch (x) {} return json({ ok: true }); }
    if (u.indexOf('bolt-staging.fly.dev') >= 0) return json({ error: 'stubbed' }, 500);
    return real.apply(this, arguments); }; })();
window.addEventListener('click', function (e) { var a = e.target && e.target.closest && e.target.closest('a'); if (a && /app\\.boltanswering\\.com/.test(a.href)) e.preventDefault(); });`;
// Stand-in for Meta's fbevents.js: drain the base code's queue into window.__fbq and set the
// first-party cookies the real script sets (_fbp always, _fbc when the URL carried fbclid).
const FBEVENTS = `(function(){ var q = window.fbq; window.__fbq = window.__fbq || [];
  document.cookie = '_fbp=fb.1.1700000000000.1111111111; path=/';
  var m = /[?&]fbclid=([^&]+)/.exec(location.search); if (m) document.cookie = '_fbc=fb.1.1700000000000.' + m[1] + '; path=/';
  q.callMethod = function(){ window.__fbq.push(JSON.parse(JSON.stringify(Array.prototype.slice.call(arguments)))); };
  (q.queue || []).forEach(function(a){ q.callMethod.apply(q, a); }); q.queue = []; })();`;
const HIDDEN = `window.__vs = 'hidden';
Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: function(){ return window.__vs; } });
Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: function(){ return window.__vs !== 'visible'; } });`;
const GPC = `Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { configurable: true, get: function(){ return true; } });`;
const WD = (v) => `Object.defineProperty(Navigator.prototype, 'webdriver', { configurable: true, get: function(){ return ${v}; } });`;

// One browser context per scenario; `steps` are page loads in that same context (storage persists).
async function scenario({ name, steps, pre = '', automated = false, id = TEST_ID }) {
  pixelId = id;
  const { browserContextId } = await send('Target.createBrowserContext');
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId); await send('Runtime.enable', {}, sessionId);
  await send('Fetch.enable', { patterns: [{ urlPattern: 'https://connect.facebook.net/*' }, { urlPattern: 'https://app.boltanswering.com/*' }] }, sessionId);
  let fbeventsLoads = 0; const errors = [];
  const onMsg = async (m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Fetch.requestPaused') {
      const meta = m.params.request.url.startsWith('https://connect.facebook.net/');
      if (meta) fbeventsLoads++;
      await send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: meta ? 'text/javascript' : 'text/html' }], body: Buffer.from(meta ? FBEVENTS : '<p>stub</p>').toString('base64') }, sessionId);
    }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  };
  listeners.push(onMsg);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB + WD(automated) + pre }, sessionId);
  const evalv = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)).result.value;
  const out = [];
  for (const step of steps) {
    const loaded = new Promise((r) => { const f = (m) => { if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') { listeners.splice(listeners.indexOf(f), 1); r(); } }; listeners.push(f); });
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}${step.path}` }, sessionId);
    await loaded;
    if (step.act) await evalv(step.act);
    if (step.until) await until(async () => evalv(step.until), 10000); else await sleep(step.waitMs ?? 2000);
    out.push({
      fbq: JSON.parse(await evalv('JSON.stringify(window.__fbq || [])')),
      verify: JSON.parse(await evalv('JSON.stringify(window.__verify || [])')),
      sent: JSON.parse(await evalv('JSON.stringify(window.__sent || [])')),
      meta: JSON.parse(await evalv('JSON.stringify(window.boltMeta || null)')),
      hasFbq: await evalv("typeof window.fbq === 'function'"),
      loads: fbeventsLoads,
    });
  }
  listeners.splice(listeners.indexOf(onMsg), 1);
  if (errors.length) console.log(`    page errors in "${name}": ${errors.join(' | ')}`);
  await send('Target.disposeBrowserContext', { browserContextId });
  return out;
}

let fails = 0; const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) fails++; };
const calls = (r) => r.fbq.map((c) => c.slice(0, 2).join(':') + (c[2]?.content_category ? `(${c[2].content_category})` : '')).join(', ') || 'none';
const tracks = (r, ev) => r.fbq.filter((c) => (c[0] === 'track' || c[0] === 'trackCustom') && c[1] === ev);
const TALK = '/index.html?talk=1&utm_source=facebook&utm_medium=paid_social&fbclid=TESTCLICK';

// Fills the demo form, gets a (stubbed) code sent, enters it: the verify body is captured.
const DEMO = `(async () => {
  const w = (t) => new Promise((r) => setTimeout(r, t));
  for (let i = 0; i < 50 && !document.getElementById('demo-phone'); i++) await w(100);
  const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  set(document.getElementById('demo-phone'), '4155552671');
  set(document.getElementById('demo-business'), 'Harness HVAC');
  document.querySelector('.demo-backdrop .demo-btn').click();
  for (let i = 0; i < 50 && document.querySelectorAll('.demo-code input').length < 6; i++) await w(100);
  const boxes = document.querySelectorAll('.demo-code input');
  boxes.forEach((b, i) => { b.value = String(i + 1); });
  const btns = document.querySelectorAll('.demo-backdrop .demo-btn'); btns[btns.length - 1].click();
  return true; })()`;

console.log('[1] visible ad link, pixel ID set');
const [r1] = await scenario({ name: 'visible', steps: [{ path: TALK, until: "(window.__fbq || []).some(c => c[1] === 'ViewContent')" }] });
console.log(`    ${calls(r1)}`);
ok(r1.loads === 1, `fbevents.js requested once (${r1.loads})`);
ok(JSON.stringify(r1.fbq[0]) === JSON.stringify(['set', 'autoConfig', false, TEST_ID]) && JSON.stringify(r1.fbq[1]) === JSON.stringify(['init', TEST_ID]), 'automatic scraping off, then init with the ID');
ok(tracks(r1, 'PageView').length === 1, 'one PageView');
ok(tracks(r1, 'ViewContent').length === 1 && tracks(r1, 'ViewContent')[0][2].content_category === 'ad_link', 'ViewContent for the ad-link demo open');
ok(r1.sent.some((e) => e.type === 'site_landed') && r1.sent.some((e) => e.type === 'demo_opened'), 'first-party events still go to the ingest');

console.log('[2] no pixel ID (how it ships)');
const [r2] = await scenario({ name: 'no id', id: '', steps: [{ path: TALK, waitMs: 2500 }] });
ok(r2.loads === 0 && !r2.hasFbq && r2.meta?.enabled === false && r2.meta?.blockedBy === 'no_pixel_id', `nothing loads (${r2.meta?.blockedBy})`);

console.log('[3] Global Privacy Control');
const [r3] = await scenario({ name: 'gpc', pre: GPC, steps: [{ path: TALK, waitMs: 2500 }] });
ok(r3.loads === 0 && !r3.hasFbq && r3.meta?.blockedBy === 'gpc', `nothing loads (${r3.meta?.blockedBy})`);

console.log('[4] opt-out persists until cleared');
const r4 = await scenario({ name: 'optout', steps: [{ path: '/index.html?bolt_optout=1', waitMs: 2000 }, { path: '/hvac.html', waitMs: 2000 }, { path: '/hvac.html?bolt_optout=0', until: "(window.__fbq || []).some(c => c[1] === 'PageView')" }] });
ok(r4[0].loads === 0 && r4[1].loads === 0 && r4[1].meta?.blockedBy === 'opted_out', 'opted out: nothing on this page or the next');
ok(r4[2].loads === 1 && tracks(r4[2], 'PageView').length === 1, '?bolt_optout=0 turns it back on');

console.log('[5] our QA traffic, and the debug override');
const r5 = await scenario({ name: 'qa', steps: [{ path: '/index.html?bolt_qa=1', waitMs: 2000 }, { path: '/index.html?bolt_pixel_debug=1', until: "(window.__fbq || []).some(c => c[1] === 'PageView')" }] });
ok(r5[0].loads === 0 && r5[0].meta?.blockedBy === 'qa', 'QA browser: nothing loads');
ok(r5[1].loads === 1 && tracks(r5[1], 'PageView').length === 1, 'bolt_pixel_debug=1 loads it on a QA browser');

console.log('[6] automated browser');
const [r6] = await scenario({ name: 'webdriver', automated: true, steps: [{ path: TALK, waitMs: 2500 }] });
ok(r6.loads === 0 && !r6.hasFbq && r6.meta?.blockedBy === 'automated', `nothing loads (${r6.meta?.blockedBy})`);

console.log('[7] hidden page (preload): nothing until seen');
const [r7] = await scenario({ name: 'hidden', pre: HIDDEN, steps: [{ path: '/hvac.html', waitMs: 2500 }] });
ok(r7.loads === 0 && !r7.hasFbq, 'no request and no PageView while hidden');
const [r7b] = await scenario({ name: 'hidden→visible', pre: HIDDEN, steps: [{ path: '/hvac.html', act: "setTimeout(() => { window.__vs = 'visible'; document.dispatchEvent(new Event('visibilitychange')); }, 1200)", until: "(window.__fbq || []).some(c => c[1] === 'PageView')" }] });
ok(r7b.loads === 1 && tracks(r7b, 'PageView').length === 1, 'loads and sends one PageView once seen');

console.log('[8] demo verified: Lead with the event_id the server gets');
const [r8] = await scenario({ name: 'demo lead', steps: [{ path: TALK, act: DEMO, until: "(window.__fbq || []).some(c => c[1] === 'Lead')" }] });
const body8 = r8.verify[0] ?? {}; const lead8 = tracks(r8, 'Lead');
console.log(`    verify body keys: ${Object.keys(body8).sort().join(', ')}`);
ok(lead8.length === 1 && lead8[0][3]?.eventID && lead8[0][3].eventID === body8.event_id, `one Lead, eventID = the verify body's event_id (${body8.event_id})`);
ok(body8.sessionId && body8.sessionId === r8.sent.find((e) => e.type === 'site_landed')?.sid, `verify body carries the visitor id the ingest saw (${body8.sessionId})`);
ok(body8.fbp === 'fb.1.1700000000000.1111111111' && body8.fbc === 'fb.1.1700000000000.TESTCLICK', 'verify body carries _fbp and _fbc');
ok(r8.sent.some((e) => e.type === 'demo_code_verified' && e.data.event_id === body8.event_id), 'the first-party demo_code_verified carries the same event_id');

console.log('[9] demo verified with GPC: no Meta ids leave');
const [r9] = await scenario({ name: 'demo gpc', pre: GPC, steps: [{ path: TALK, act: DEMO, until: '(window.__verify || []).length > 0' }] });
const body9 = r9.verify[0] ?? {};
console.log(`    verify body keys: ${Object.keys(body9).sort().join(', ')}`);
ok(!('event_id' in body9) && !('fbp' in body9) && !('fbc' in body9) && body9.sessionId, 'no event_id / fbp / fbc; the visitor id still goes (first-party)');
ok(r9.loads === 0 && r9.fbq.length === 0, 'and no pixel');

console.log('[10] signup link tapped');
const [r10] = await scenario({ name: 'trial click', steps: [{ path: '/hvac.html?utm_source=fb', act: "setTimeout(() => { const a = [...document.querySelectorAll('a')].find(x => /app\\.boltanswering\\.com\\/signup/.test(x.href) && !x.closest('.demo-backdrop')); a && a.click(); }, 1500)", until: "(window.__fbq || []).some(c => c[1] === 'StartTrialClick')" }] });
ok(tracks(r10, 'StartTrialClick').length === 1, `one StartTrialClick (${JSON.stringify(tracks(r10, 'StartTrialClick')[0]?.[2] ?? null)})`);

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
ws.close(); chrome.kill(); srv.close(); process.exit(fails ? 1 : 0);
