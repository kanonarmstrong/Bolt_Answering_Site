// AFMBP-2019 — the privacy policy says "Our website does not send the phone number, email address,
// or business name You enter on our website to Meta or Google". The other harnesses prove our own
// code never hands those to the tags, but they replace Meta's and Google's scripts with stubs.
// This check runs the REAL scripts instead — Meta's fbevents.js with this pixel's live settings
// (its config file), and Google's gtag.js for G-8C8SFMCRYH and AW-18483202475 — walks the demo with
// real typing and real clicks, and searches everything they try to send for what was typed: raw,
// formatted, or hashed the way Meta and Google hash it. Re-run it after any change in Meta Events
// Manager or Google tag settings (e.g. automatic advanced matching, user-provided data).
// Run: node tools/real-tags-check.mjs [siteRoot]
//      NC=meta_mam  — the served pixel passes email + phone to fbq('init') (manual advanced matching)
//      NC=ga_param  — the served page sends the phone as a Google Analytics event parameter
//      Each negative control must make the leak check FAIL.
// Nothing leaves the machine from the browser: Chrome resolves no host but 127.0.0.1, and every
// other request is answered locally. Only this script (Node) downloads the libraries' script files
// from Meta's and Google's CDNs — static files, no events — exactly as a browser would.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

const ROOT = process.argv[2] ?? new URL('..', import.meta.url).pathname;
const NC = process.env.NC || '';
const PORT = 20000 + Math.floor(Math.random() * 10000), DBG = 30000 + Math.floor(Math.random() * 10000);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.webp': 'image/webp' };
const PIXEL = /var PIXEL_ID = '([0-9]*)';/.exec(readFileSync(join(ROOT, 'meta-pixel.js'), 'utf8'))?.[1];
if (!PIXEL) throw new Error('meta-pixel.js has no PIXEL_ID: nothing to check');

const MUTATE = {
  meta_mam: (f, s) => (f.endsWith('meta-pixel.js') ? s.replace("window.fbq('init', PIXEL_ID);", "window.fbq('init', PIXEL_ID, { em: 'qa-pc@example.com', ph: '5551230000' });") : s),
  ga_param: (f, s) => (f.endsWith('.html') ? s.replace("window.gtag('config', 'AW-18483202475');", "window.gtag('config', 'AW-18483202475'); window.gtag('event', 'qa_nc', { note: '5551230000' });") : s),
};
if (NC && !MUTATE[NC]) throw new Error(`unknown NC "${NC}"; one of ${Object.keys(MUTATE).join(', ')}`);

const srv = createServer((req, res) => {
  try {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
    let f = join(ROOT, p);
    if (statSync(f).isDirectory()) f = join(f, 'index.html');
    let body = readFileSync(f);
    if (NC && /\.(html|js)$/.test(f)) body = Buffer.from(MUTATE[NC](f, body.toString('utf8')));
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(PORT, '127.0.0.1');

// What the demo walk types, and every form Meta or Google could send it in.
const PHONE = '5551230000', BIZ = 'QA Test Co', EMAIL = 'qa-pc@example.com', CODE = '123456';
const sha = (s) => createHash('sha256').update(s).digest();
const NEEDLES = new Set([PHONE, '555-123-0000', '(555) 123-0000', '555) 123-0000', '+15551230000', '15551230000', BIZ, BIZ.toLowerCase(), 'QA+Test+Co', 'QA%20Test%20Co', 'qatestco', EMAIL, 'qa-pc%40example.com', CODE]);
for (const v of [EMAIL, PHONE, '15551230000', '+15551230000', BIZ, BIZ.toLowerCase(), 'qatestco']) {
  const d = sha(v);
  NEEDLES.add(d.toString('hex')); NEEDLES.add(d.toString('base64')); NEEDLES.add(d.toString('base64url'));
}

const PROFILE = mkdtempSync(join(tmpdir(), 'cdp-real-')); // removed at exit
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--window-size=1280,900', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) bad++; };

// Library script files only; Node fetches them, the browser never reaches the CDN.
let UA = '';
const cdn = new Map();
const isLibrary = (u) => (u.hostname === 'connect.facebook.net' && (/^\/[a-z]{2}_[A-Z]{2}\/fbevents\.js$/.test(u.pathname) || u.pathname.startsWith('/signals/config/') || u.pathname.startsWith('/signals/plugins/')))
  || (u.hostname === 'www.googletagmanager.com' && (u.pathname === '/gtag/js' || u.pathname === '/gtag/destination'));
async function library(u) {
  // The pixel's settings: ask for them the way the live site does (its domain), nothing else.
  const url = u.pathname.startsWith('/signals/config/') ? `https://connect.facebook.net${u.pathname}?v=${u.searchParams.get('v') || ''}&r=stable&domain=www.boltanswering.com` : u.href;
  if (!cdn.has(url)) cdn.set(url, fetch(url, { headers: { 'user-agent': UA } }).then(async (r) => ({ code: r.status, body: Buffer.from(await r.arrayBuffer()) })));
  return cdn.get(url);
}

const PAGE_PRE = `Object.defineProperty(Navigator.prototype, 'webdriver', { configurable: true, get: function(){ return false; } });
window.addEventListener('click', function (e) { var a = e.target && e.target.closest && e.target.closest('a'); if (a && /app\\.boltanswering\\.com/.test(a.href)) e.preventDefault(); }, true);`;

try {
  let t = null;
  for (let i = 0; i < 100 && !t; i++) { try { t = (await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json()).find((x) => x.type === 'page'); } catch {} if (!t) await sleep(150); }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let nextId = 1; const pending = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  const sent = [];                 // every request the page tried to send off the machine (url + body)
  const served = { meta: 0, config: 0, gtag: 0 };
  const ingest = [];
  const CORS = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' }];
  const reply = (requestId, body, type = 'application/json', code = 200) => send('Fetch.fulfillRequest', { requestId, responseCode: code, responseHeaders: [...CORS, { name: 'Content-Type', value: type }], body: Buffer.from(body).toString('base64') });
  const bodyOf = (r) => r.postData || (r.postDataEntries || []).map((e) => Buffer.from(e.bytes || '', 'base64').toString('utf8')).join('');
  ws.addEventListener('message', async (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); return; }
    // Second witness: the Network domain sees beacons and image pixels too, before any DNS lookup.
    if (msg.method === 'Network.requestWillBeSent') {
      const r = msg.params.request; const u = new URL(r.url);
      if (u.hostname !== '127.0.0.1' && !isLibrary(u) && u.protocol.startsWith('http')) sent.push({ via: 'net', url: r.url, body: bodyOf(r) });
      return;
    }
    if (msg.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = msg.params; const u = new URL(request.url); const host = u.hostname;
    if (host === '127.0.0.1') return send('Fetch.continueRequest', { requestId });
    if (isLibrary(u)) {
      if (/fbevents\.js$/.test(u.pathname)) served.meta++;
      if (u.pathname.startsWith('/signals/config/')) served.config++;
      if (u.pathname === '/gtag/js') served.gtag++;
      const r = await library(u);
      return reply(requestId, r.body, 'text/javascript', r.code);
    }
    const body = bodyOf(request);
    sent.push({ via: 'fetch', url: request.url, body });
    if (host === 'bolt-staging.fly.dev') {
      if (request.method === 'OPTIONS') return send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: CORS });
      if (u.pathname === '/api/public/analytics/events') { try { ingest.push(...JSON.parse(body).events.map((e) => e.event_type)); } catch {} return reply(requestId, '{"ok":true}'); }
      if (u.pathname === '/api/demo/otp/send' || u.pathname === '/api/demo/otp/verify') return reply(requestId, '{"ok":true}');
      if (u.pathname === '/api/demo/token') return reply(requestId, '{"token":"tok"}');
      if (u.pathname === '/api/demo/call') return reply(requestId, '{"callId":"call-9","callerId":"+19257257959"}');
      if (u.pathname.startsWith('/api/demo/recap/')) return reply(requestId, JSON.stringify({ status: 'completed', transcript: [{ speaker: 'assistant', text: 'Hi, thanks for calling.' }, { speaker: 'caller', text: 'My AC is out.' }] }));
      return reply(requestId, '{}');
    }
    if (host === 'app.boltanswering.com') return reply(requestId, '<!doctype html><title>app</title>', 'text/html');
    return reply(requestId, '', 'text/plain', 200); // Meta, Google and anything else: answered here, recorded above
  });

  UA = (await send('Browser.getVersion')).userAgent.replace('HeadlessChrome', 'Chrome');
  await send('Network.setUserAgentOverride', { userAgent: UA }); // a normal browser to Meta's bot rules
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_PRE });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : null; };
  const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(100); } return false; };
  // A real click at the element's centre (trusted events, the kind Meta's click listeners see).
  const tap = async (expr) => {
    const c = await ev(`(function(){var el=(${expr}); if(!el) return null; el.scrollIntoView({block:'center'}); var r=el.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    if (!c) return false;
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: c.x, y: c.y, button: 'left', clickCount: 1 });
    return true;
  };
  const typeInto = async (sel, text) => { await ev(`document.querySelector(${JSON.stringify(sel)}).focus(), 1`); await send('Input.insertText', { text }); };

  console.log(`[1] demo walk with the real Meta and Google scripts (pixel ${PIXEL}, hvac.html?talk=1)${NC ? ` — NC ${NC}` : ''}`);
  await send('Page.navigate', { url: ORIGIN + '/hvac.html?talk=1' });
  // The demo opens on the choice of two (AFMBP-2083): this walk is the outbound demo.
  await until(async () => (await ev("!!document.querySelector('.demo-choice__get')")) === true, 15000);
  await ev("document.querySelector('.demo-choice__get').click(), 1");
  await until(async () => (await ev("!!document.getElementById('demo-phone')")) === true, 15000);
  await sleep(1500);
  await typeInto('#demo-phone', PHONE);
  await typeInto('#demo-business', BIZ);
  await typeInto('#demo-email', EMAIL);
  await tap("[].slice.call(document.querySelectorAll('.demo-btn')).find(function(b){return /continue/i.test(b.textContent)})");
  await until(async () => (await ev("document.querySelectorAll('.demo-code input').length")) === 6, 8000);
  await ev("document.querySelector('.demo-code input').focus(), 1");
  for (const d of CODE) { await send('Input.insertText', { text: d }); await sleep(60); }
  ok(await until(async () => (await ev("!!document.querySelector('.demo-success-cta')")) === true, 20000), 'demo reached the recap (call finished)');
  await sleep(800);
  await tap("document.querySelector('.demo-success-cta')");
  await sleep(2500);
  await send('Page.navigate', { url: ORIGIN + '/plumbing.html' }); // page hide flushes anything batched
  await sleep(4000);

  const meta = sent.filter((s) => /facebook\.com$/.test(new URL(s.url).hostname));
  const google = sent.filter((s) => /google|doubleclick/.test(new URL(s.url).hostname));
  const metaEvents = [], dedupe = new Set();
  for (const s of meta) {
    const q = new URL(s.url).searchParams; const b = new URLSearchParams(s.body || '');
    const get = (k) => q.get(k) ?? b.get(k);
    const key = `${get('ev')}|${get('eid') || ''}|${get('ts') || s.url}`;
    if (!get('ev') || dedupe.has(key)) continue; dedupe.add(key);
    metaEvents.push({ ev: get('ev'), id: get('id'), trade: get('cd[trade]'), keys: [...new Set([...q.keys(), ...b.keys()])] });
  }
  const count = (name) => metaEvents.filter((e) => e.ev === name).length;
  console.log('  Meta received:', JSON.stringify(metaEvents.map((e) => `${e.ev}${e.trade ? `(${e.trade})` : ''}`)));
  console.log('  Google requests:', google.length, JSON.stringify([...new Set(google.map((s) => { const u = new URL(s.url); return u.hostname + u.pathname.replace(/[0-9]{6,}/g, '#'); }))]));

  ok(served.meta >= 1 && served.config >= 1, `Meta's real script and this pixel's live settings were loaded (script ${served.meta}, settings ${served.config})`);
  ok(metaEvents.length > 0 && metaEvents.every((e) => e.id === PIXEL), `Meta's script sent to this pixel only (${metaEvents.length} events)`);
  ok(count('PageView') >= 1 && ['ViewContent', 'Lead', 'DemoCallFinished', 'StartTrialClick'].every((n) => count(n) === 1), 'Meta got PageView + ViewContent, Lead, DemoCallFinished, StartTrialClick once each');
  ok(metaEvents.filter((e) => e.ev !== 'PageView').every((e) => e.trade === 'hvac'), 'each demo event carries trade=hvac');
  ok(!metaEvents.some((e) => /SubscribedButtonClick|Microdata/.test(e.ev)), "no automatic button or page-scraping events from Meta's script");
  const ud = metaEvents.filter((e) => e.keys.some((k) => k.startsWith('ud[')));
  ok(ud.length === 0, `no user data (ud[...]) fields in any Meta event ${ud.length ? JSON.stringify(ud.map((e) => e.ev + ':' + e.keys.filter((k) => k.startsWith('ud[')).join(','))) : ''}`);
  ok(served.gtag >= 1 && google.some((s) => /\/g\/collect/.test(s.url)) && google.some((s) => s.url.includes('18483202475')), "Google's real script ran and sent Analytics and Ads hits");
  const upd = google.filter((s) => /[?&]em=|"em"|user_data/.test(s.url + ' ' + s.body));
  ok(upd.length === 0, `no user-provided data fields (em=) in any Google hit ${upd.length ? JSON.stringify(upd.map((s) => s.url.slice(0, 120))) : ''}`);
  const hay = (list) => list.map((s) => { let u = s.url; try { u += ' ' + decodeURIComponent(s.url); } catch {} return u + ' ' + s.body; }).join('\n');
  const leakMeta = [...NEEDLES].filter((n) => hay(meta).includes(n));
  const leakGoogle = [...NEEDLES].filter((n) => hay(google).includes(n));
  const leakOther = [...NEEDLES].filter((n) => hay(sent.filter((s) => !meta.includes(s) && !google.includes(s) && !/bolt-staging\.fly\.dev$/.test(new URL(s.url).hostname))).includes(n));
  ok(leakMeta.length === 0, `nothing typed reaches Meta — raw, formatted or hashed ${leakMeta.length ? JSON.stringify(leakMeta.map((n) => n.slice(0, 16))) : ''}`);
  ok(leakGoogle.length === 0, `nothing typed reaches Google — raw, formatted or hashed ${leakGoogle.length ? JSON.stringify(leakGoogle.map((n) => n.slice(0, 16))) : ''}`);
  ok(leakOther.length === 0, `nothing typed reaches any other third party ${leakOther.length ? JSON.stringify(leakOther) : ''}`);
  ok(['demo_opened', 'demo_code_verified', 'demo_call_finished', 'demo_trial_clicked'].every((e) => ingest.includes(e)), "Bolt's own funnel events sent (to Bolt only)");

  console.log(bad ? `\n${bad} FAILED${NC ? ` (negative control: ${NC})` : ''}` : `\nALL PASS${NC ? ` — negative control ${NC} did NOT bite` : ''}`);
  ws.close();
} finally {
  chrome.kill('SIGKILL'); srv.close();
  await sleep(300); rmSync(PROFILE, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
