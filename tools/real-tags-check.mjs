// AFMBP-2019 — the privacy policy says "Our website does not send the phone number, email address,
// or business name You enter on our website to Meta, Reddit, or Google". The other harnesses prove our
// own code never hands those to the tags, but they replace Meta's, Google's and Reddit's scripts with
// stubs. This check runs the REAL scripts instead — Meta's fbevents.js with this pixel's live settings
// (its config file), Google's gtag.js for G-8C8SFMCRYH and AW-18483202475, and (AFMBP-2654) Reddit's
// pixel.js with the settings Reddit serves for this pixel — walks the demo with real typing and real
// clicks, types an email into the "Stay in touch" box and (AFMBP-2714) into the sign-up card's email
// field on the Meta ads' landing (/?signup=1) and the Reddit ads' (/start/handyman.html), taps its
// Continue, and searches everything they try to send for what was typed: raw, formatted, or hashed
// the way Meta, Google and Reddit hash it. Re-run it after
// any change in Meta Events Manager, Google tag settings or Reddit Events Manager (e.g. automatic
// advanced matching, user-provided data).
// Reddit (AFMBP-2654): with automatic advanced matching on, Reddit's own pixel.js reads phone numbers
// and emails typed on the page, hashes them, keeps them in the _rdt_pn/_rdt_em cookies and sends them
// with every event. Reddit builds pixel.js per pixel: with matching off, the copy it serves for our
// pixel leaves the matching code out. Its full script (pixel.js without a pixel_id, which reads the
// settings from pixel-config.reddit.com) still has it, so the steps that need matching use that.
// Step [0] recreates a browser from 2026-11-19 (the site before the cookie cleanup, Reddit's full
// script with matching on), so the walk also proves reddit-pixel.js deletes what Reddit stored then.
// Steps [1]–[2] run what Reddit serves for our pixel today.
// Run: node tools/real-tags-check.mjs [siteRoot]
//      NC=meta_mam      — the served pixel passes email + phone to fbq('init') (manual advanced matching)
//      NC=ga_param      — the served page sends the phone as a Google Analytics event parameter
//      NC=reddit_aam    — Reddit turns automatic matching back on (its full script, matching on)
//      NC=reddit_cookie — reddit-pixel.js without the cookie cleanup, and Reddit's full script with
//                         matching off (the script that reads the stored values back)
//      Each negative control must make the leak check FAIL.
//      SIMULATE_REDDIT_MATCHING_OFF=1 — steps [1]–[2] run Reddit's full script with matching off: the
//      cleanup's positive control. Not what Reddit serves for our pixel, so never a live pass: exit 3.
// Nothing leaves the machine from the browser: Chrome resolves no host but 127.0.0.1, and every
// other request is answered locally. Only this script (Node) downloads the libraries' script files
// and settings from Meta's, Google's and Reddit's CDNs — no events — exactly as a browser would.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

const ROOT = process.argv[2] ?? new URL('..', import.meta.url).pathname;
const NC = process.env.NC || '';
const SIM = process.env.SIMULATE_REDDIT_MATCHING_OFF === '1';
const PORT = 20000 + Math.floor(Math.random() * 10000), DBG = 30000 + Math.floor(Math.random() * 10000);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.webp': 'image/webp' };
const PIXEL = /var PIXEL_ID = '([0-9]*)';/.exec(readFileSync(join(ROOT, 'meta-pixel.js'), 'utf8'))?.[1];
if (!PIXEL) throw new Error('meta-pixel.js has no PIXEL_ID: nothing to check');
const REDDIT_SRC = readFileSync(join(ROOT, 'reddit-pixel.js'), 'utf8');
const RPIXEL = /var PIXEL_ID = '([A-Za-z0-9_]*)';/.exec(REDDIT_SRC)?.[1] || ''; // '' = the Reddit pixel is off
const CLEANUP_CALL = '  clearRedditMatchCookies();\n';

const MUTATE = {
  meta_mam: (f, s) => (f.endsWith('meta-pixel.js') ? s.replace("window.fbq('init', PIXEL_ID);", "window.fbq('init', PIXEL_ID, { em: 'qa-pc@example.com', ph: '9255550123' });") : s),
  ga_param: (f, s) => (f.endsWith('.html') ? s.replace("window.gtag('config', 'AW-18483202475');", "window.gtag('config', 'AW-18483202475'); window.gtag('event', 'qa_nc', { note: '9255550123' });") : s),
};
const NCS = [...Object.keys(MUTATE), 'reddit_aam', 'reddit_cookie'];
if (NC && !NCS.includes(NC)) throw new Error(`unknown NC "${NC}"; one of ${NCS.join(', ')}`);
if (NC.startsWith('reddit_') && !RPIXEL) throw new Error(`NC ${NC} needs the Reddit pixel on in reddit-pixel.js`);
if (NC === 'reddit_cookie' && !REDDIT_SRC.includes(CLEANUP_CALL)) throw new Error('NC reddit_cookie: the cookie cleanup call is not in reddit-pixel.js, so the NC would not bite');
if (SIM && (NC || !RPIXEL)) throw new Error('SIMULATE_REDDIT_MATCHING_OFF runs alone, with the Reddit pixel on');

// Step [0] serves reddit-pixel.js as it was on 2026-11-19: without the cookie cleanup.
let pre2654 = false;
// null: Reddit's script exactly as Reddit serves it for our pixel. 'on' | 'off': Reddit's full script
// (the one with the matching code), its settings rewritten to automatic matching on or off.
let redditFull = null;
const stripCleanup = (s) => s.split(CLEANUP_CALL).join('');

const srv = createServer((req, res) => {
  try {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
    let f = join(ROOT, p);
    if (statSync(f).isDirectory()) f = join(f, 'index.html');
    let body = readFileSync(f);
    let text = null;
    if (f.endsWith('reddit-pixel.js') && (pre2654 || NC === 'reddit_cookie')) text = stripCleanup(body.toString('utf8'));
    if (MUTATE[NC] && /\.(html|js)$/.test(f)) text = MUTATE[NC](f, text ?? body.toString('utf8'));
    if (text !== null) body = Buffer.from(text);
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(PORT, '127.0.0.1');

// What the walk types, and every form Meta, Google or Reddit could send it in. The phone is
// (925) 555-0123: in the 555-0100–0199 range kept for fiction, and one Reddit's phone scanner
// accepts (it skips 555-123-0000, which would make the Reddit check prove nothing).
const PHONE = '9255550123', BIZ = 'QA Test Co', EMAIL = 'qa-pc@example.com', CODE = '123456';
const [PA, PX, PL] = [PHONE.slice(0, 3), PHONE.slice(3, 6), PHONE.slice(6)];
const sha = (s) => createHash('sha256').update(s).digest();
const NEEDLES = new Set([PHONE, `${PA}-${PX}-${PL}`, `(${PA}) ${PX}-${PL}`, `${PA}) ${PX}-${PL}`, '+1' + PHONE, '1' + PHONE, BIZ, BIZ.toLowerCase(), 'QA+Test+Co', 'QA%20Test%20Co', 'qatestco', EMAIL, encodeURIComponent(EMAIL), CODE]);
for (const v of [EMAIL, PHONE, '1' + PHONE, '+1' + PHONE, BIZ, BIZ.toLowerCase(), 'qatestco']) {
  const d = sha(v);
  NEEDLES.add(d.toString('hex')); NEEDLES.add(d.toString('base64')); NEEDLES.add(d.toString('base64url'));
}

const PROFILE = mkdtempSync(join(tmpdir(), 'cdp-real-')); // removed at exit
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--window-size=1280,900', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) bad++; };

// Library script files and settings only; Node fetches them, the browser never reaches the CDN.
let UA = '';
const cdn = new Map();
const libErrors = [];
const isRedditLib = (u) => (u.hostname === 'www.redditstatic.com' && u.pathname === '/ads/pixel.js') || (u.hostname === 'pixel-config.reddit.com' && /^\/pixels\/[^/]+\/config$/.test(u.pathname));
const isLibrary = (u) => (u.hostname === 'connect.facebook.net' && (/^\/[a-z]{2}_[A-Z]{2}\/fbevents\.js$/.test(u.pathname) || u.pathname.startsWith('/signals/config/') || u.pathname.startsWith('/signals/plugins/')))
  || (u.hostname === 'www.googletagmanager.com' && (u.pathname === '/gtag/js' || u.pathname === '/gtag/destination'))
  || isRedditLib(u);
// Reddit serves the pixel's settings inside pixel.js (and at pixel-config.reddit.com):
// "aam":{"email":…,"phone_number":…} is automatic advanced matching.
const AAM_RE = /"aam":\{"email":(true|false),"phone_number":(true|false)\}/;
const REDDIT_FULL = 'https://www.redditstatic.com/ads/pixel.js';
const getCdn = (url) => {
  if (!cdn.has(url)) cdn.set(url, fetch(url, { headers: { 'user-agent': UA } }).then(async (r) => ({ code: r.status, body: Buffer.from(await r.arrayBuffer()) })));
  return cdn.get(url);
};
async function library(u) {
  // The pixel's settings: ask for them the way the live site does (its domain), nothing else.
  const url = u.pathname.startsWith('/signals/config/') ? `https://connect.facebook.net${u.pathname}?v=${u.searchParams.get('v') || ''}&r=stable&domain=www.boltanswering.com` : u.href;
  if (!isRedditLib(u) || !redditFull) return getCdn(url);
  if (u.hostname === 'www.redditstatic.com') {
    const r = await getCdn(REDDIT_FULL);
    if (r.code !== 200 || !r.body.includes('auto_pn') || AAM_RE.test(r.body.toString('utf8'))) throw new Error(`Reddit's full script changed (${REDDIT_FULL}): no matching code, or settings of its own`);
    return r;
  }
  const r = await getCdn(url); const text = r.body.toString('utf8');
  if (!AAM_RE.test(text)) throw new Error(`Reddit's settings changed shape (${u.href}): no "aam" block to rewrite`);
  const v = redditFull === 'on';
  return { code: r.code, body: Buffer.from(text.replace(AAM_RE, `"aam":{"email":${v},"phone_number":${v}}`)) };
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
  const served = { meta: 0, config: 0, gtag: 0, reddit: 0 };
  const ingest = [];
  const CORS = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' }];
  const reply = (requestId, body, type = 'application/json', code = 200) => send('Fetch.fulfillRequest', { requestId, responseCode: code, responseHeaders: [...CORS, { name: 'Content-Type', value: type }], body: Buffer.from(body).toString('base64') }).catch(() => {});
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
    if (host === '127.0.0.1') return send('Fetch.continueRequest', { requestId }).catch(() => {});
    if (isLibrary(u)) {
      if (/fbevents\.js$/.test(u.pathname)) served.meta++;
      if (u.pathname.startsWith('/signals/config/')) served.config++;
      if (u.pathname === '/gtag/js') served.gtag++;
      if (host === 'www.redditstatic.com') served.reddit++;
      let r;
      try { r = await library(u); } catch (e) { libErrors.push(e.message); return reply(requestId, '', 'text/plain', 500); }
      return reply(requestId, r.body, host === 'pixel-config.reddit.com' ? 'application/json' : 'text/javascript', r.code);
    }
    const body = bodyOf(request);
    sent.push({ via: 'fetch', url: request.url, body });
    if (host === 'bolt-staging.fly.dev') {
      if (request.method === 'OPTIONS') return send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: CORS }).catch(() => {});
      if (u.pathname === '/api/public/analytics/events') { try { ingest.push(...JSON.parse(body).events.map((e) => e.event_type)); } catch {} return reply(requestId, '{"ok":true}'); }
      if (u.pathname === '/api/demo/otp/send' || u.pathname === '/api/demo/otp/verify') return reply(requestId, '{"ok":true}');
      if (u.pathname === '/api/demo/token') return reply(requestId, '{"token":"tok"}');
      if (u.pathname === '/api/demo/call') return reply(requestId, '{"callId":"call-9","callerId":"+19257257959"}');
      if (u.pathname.startsWith('/api/demo/recap/')) return reply(requestId, JSON.stringify({ status: 'completed', transcript: [{ speaker: 'assistant', text: 'Hi, thanks for calling.' }, { speaker: 'caller', text: 'My AC is out.' }] }));
      return reply(requestId, '{}');
    }
    if (host === 'app.boltanswering.com') return reply(requestId, '<!doctype html><title>app</title>', 'text/html');
    return reply(requestId, '', 'text/plain', 200); // Meta, Google, Reddit and anything else: answered here, recorded above
  });

  UA = (await send('Browser.getVersion')).userAgent.replace('HeadlessChrome', 'Chrome');
  // What Reddit serves for our pixel today: the settings inside its pixel.js, and whether that copy
  // carries the matching code at all (Reddit leaves it out while matching is off).
  let redditServed = '', redditServedOff = false;
  if (RPIXEL) {
    const r = await getCdn(`https://www.redditstatic.com/ads/pixel.js?pixel_id=${RPIXEL}`);
    const m = AAM_RE.exec(r.body.toString('utf8'));
    redditServed = r.code !== 200 ? `HTTP ${r.code}` : m ? `matching email ${m[1] === 'true' ? 'ON' : 'off'}, phone ${m[2] === 'true' ? 'ON' : 'off'}; ${r.body.length} bytes, ${r.body.includes('rdt.aam') ? 'with' : 'without'} the matching code` : `no settings inside pixel.js (${r.body.length} bytes)`;
    redditServedOff = r.code === 200 && !!m && m[1] === 'false' && m[2] === 'false';
  }
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
  const typeEmailBox = async () => { await ev("(function(){var i=document.querySelector('input[type=email]'); i.scrollIntoView({block:'center'}); i.focus(); return 1})()"); await send('Input.insertText', { text: EMAIL }); };
  const openOutboundDemo = async () => {
    // The demo opens on the choice of two (AFMBP-2083): this walk is the outbound demo.
    await until(async () => (await ev("!!document.querySelector('.demo-choice__get')")) === true, 15000);
    await ev("document.querySelector('.demo-choice__get').click(), 1");
    await until(async () => (await ev("!!document.getElementById('demo-phone')")) === true, 15000);
    await sleep(1500);
  };
  const cookieNames = async () => (await ev("document.cookie")).split('; ').map((c) => c.split('=')[0]).filter(Boolean);

  if (RPIXEL) {
    console.log('[0] a browser from 2026-11-19: the site before the cookie cleanup, Reddit serving automatic matching ON');
    pre2654 = true; redditFull = 'on';
    await send('Page.navigate', { url: ORIGIN + '/hvac.html?talk=1' });
    await openOutboundDemo();
    await typeInto('#demo-phone', PHONE);
    await sleep(6000); // Reddit's scanner re-reads the page every 0.5–10 s
    await send('Page.navigate', { url: ORIGIN + '/handyman.html' });
    await sleep(3000);
    await typeEmailBox();
    await sleep(6000);
    const c0 = await cookieNames();
    ok(c0.includes('_rdt_pn') && c0.includes('_rdt_em'), `setup: Reddit's script stored the typed phone and email in its cookies, as on 11-19 (${c0.filter((n) => n.startsWith('_rdt')).join(', ') || 'none'})`);
    await send('Page.navigate', { url: 'about:blank' });
    await sleep(1500);
    pre2654 = false; redditFull = NC === 'reddit_aam' ? 'on' : (NC === 'reddit_cookie' || SIM) ? 'off' : null;
  }

  const m1 = sent.length, reddit1 = served.reddit;
  console.log(`[1] demo walk with the real Meta, Google${RPIXEL ? ' and Reddit' : ''} scripts (Meta pixel ${PIXEL}${RPIXEL ? `, Reddit pixel ${RPIXEL}` : ''}, hvac.html?talk=1)${NC ? ` — NC ${NC}` : ''}${SIM ? " — SIMULATED: Reddit's full script, matching OFF" : ''}`);
  await send('Page.navigate', { url: ORIGIN + '/hvac.html?talk=1' });
  await openOutboundDemo();
  // The form asks for the number only since AFMBP-2600 (BIZ and EMAIL stay in the needles).
  await typeInto('#demo-phone', PHONE);
  await sleep(6000); // a person takes a few seconds, and Reddit's scanner re-reads the page every 0.5–10 s
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
  const m2 = sent.length;

  let rstate = null, mTap = Infinity;
  if (RPIXEL) {
    console.log('[2] an email typed into the "Stay in touch" box (handyman.html), a start-trial tap on that page, then one more page');
    await send('Page.navigate', { url: ORIGIN + '/handyman.html' });
    await sleep(3000);
    await typeEmailBox();
    await sleep(6000);
    // The Lead goes out on the page where the email was typed (what Reddit's matching would attach it to).
    mTap = sent.length;
    ok(await tap("[].slice.call(document.querySelectorAll('a')).find(function(a){return /app\\.boltanswering\\.com\\/signup/.test(a.href) && !a.closest('.demo-backdrop')})"), 'a start-trial link was tapped on handyman.html');
    await sleep(2500);
    await send('Page.navigate', { url: ORIGIN + '/electrical.html' });
    await sleep(5000);
    rstate = { aam: JSON.parse(await ev("JSON.stringify(window.rdt && window.rdt.aam || null)")), cookies: await cookieNames() };
  }

  // AFMBP-2714: the sign-up card's email field, on both ad landings, with the real tags running: typed,
  // left for Reddit's scanner, then Continue (which leaves for the app with the address in the fragment,
  // where no request carries it).
  console.log('[3] an email typed into the sign-up card on /?signup=1 and /start/handyman.html, then Continue');
  for (const path of ['/?signup=1', '/start/handyman.html']) {
    await send('Page.navigate', { url: ORIGIN + path });
    ok(await until(async () => (await ev("!!document.querySelector('.demo-so__email, .ql-email')")) === true, 15000), `${path}: the sign-up card's email field is there`);
    await sleep(1500);
    await ev("(function(){var i=document.querySelector('.demo-so__email, .ql-email'); i.scrollIntoView({block:'center'}); i.focus(); return 1})()");
    await send('Input.insertText', { text: EMAIL });
    await sleep(6000); // Reddit's scanner re-reads the page every 0.5–10 s
    ok(await tap("document.querySelector('.demo-so__go, .ql-go')"), `${path}: Continue tapped`);
    await sleep(2500);
  }
  await send('Page.navigate', { url: ORIGIN + '/electrical.html' }); // one more page: anything stored would ride on its events
  await sleep(5000);
  const cardCookies = RPIXEL ? await cookieNames() : [];
  if (RPIXEL) ok(!cardCookies.includes('_rdt_pn') && !cardCookies.includes('_rdt_em'), `after the card: Reddit stored no matching cookie (${cardCookies.filter((n) => n.startsWith('_rdt')).join(', ') || 'none'})`);

  const isMeta = (s) => /facebook\.com$/.test(new URL(s.url).hostname);
  const isGoogle = (s) => /google|doubleclick/.test(new URL(s.url).hostname);
  const isReddit = (s) => /(^|\.)reddit\.com$/.test(new URL(s.url).hostname);
  const meta = sent.filter(isMeta), google = sent.filter(isGoogle);
  const metaEventsOf = (list) => {
    const out = [], dedupe = new Set();
    for (const s of list) {
      const q = new URL(s.url).searchParams; const b = new URLSearchParams(s.body || '');
      const get = (k) => q.get(k) ?? b.get(k);
      const key = `${get('ev')}|${get('eid') || ''}|${get('ts') || s.url}`;
      if (!get('ev') || dedupe.has(key)) continue; dedupe.add(key);
      out.push({ ev: get('ev'), id: get('id'), trade: get('cd[trade]'), keys: [...new Set([...q.keys(), ...b.keys()])] });
    }
    return out;
  };
  // Event counts: the demo walk only (step [0] opens the demo too, step [2] adds page views).
  // Everything else: every step.
  const metaEvents = metaEventsOf(sent.slice(m1, m2).filter(isMeta)), allMetaEvents = metaEventsOf(meta);
  const count = (name) => metaEvents.filter((e) => e.ev === name).length;
  console.log('  Meta received:', JSON.stringify(metaEvents.map((e) => `${e.ev}${e.trade ? `(${e.trade})` : ''}`)));
  console.log('  Google requests:', google.length, JSON.stringify([...new Set(google.map((s) => { const u = new URL(s.url); return u.hostname + u.pathname.replace(/[0-9]{6,}/g, '#'); }))]));

  ok(served.meta >= 1 && served.config >= 1, `Meta's real script and this pixel's live settings were loaded (script ${served.meta}, settings ${served.config})`);
  ok(metaEvents.length > 0 && allMetaEvents.every((e) => e.id === PIXEL), `Meta's script sent to this pixel only (${allMetaEvents.length} events)`);
  ok(count('PageView') >= 1 && ['ViewContent', 'Lead', 'DemoCallFinished', 'StartTrialClick'].every((n) => count(n) === 1), 'Meta got PageView + ViewContent, Lead, DemoCallFinished, StartTrialClick once each');
  ok(metaEvents.filter((e) => e.ev !== 'PageView').every((e) => e.trade === 'hvac'), 'each demo event carries trade=hvac');
  ok(!allMetaEvents.some((e) => /SubscribedButtonClick|Microdata/.test(e.ev)), "no automatic button or page-scraping events from Meta's script");
  const ud = allMetaEvents.filter((e) => e.keys.some((k) => k.startsWith('ud[')));
  ok(ud.length === 0, `no user data (ud[...]) fields in any Meta event ${ud.length ? JSON.stringify(ud.map((e) => e.ev + ':' + e.keys.filter((k) => k.startsWith('ud[')).join(','))) : ''}`);
  ok(served.gtag >= 1 && google.some((s) => /\/g\/collect/.test(s.url)) && google.some((s) => s.url.includes('18483202475')), "Google's real script ran and sent Analytics and Ads hits");
  const upd = google.filter((s) => /[?&]em=|"em"|user_data/.test(s.url + ' ' + s.body));
  ok(upd.length === 0, `no user-provided data fields (em=) in any Google hit ${upd.length ? JSON.stringify(upd.map((s) => s.url.slice(0, 120))) : ''}`);
  const text = (s) => { let u = s.url; try { u += ' ' + decodeURIComponent(s.url); } catch {} return u + ' ' + (s.body || ''); };
  const hay = (list) => list.map(text).join('\n');
  const leakMeta = [...NEEDLES].filter((n) => hay(meta).includes(n));
  const leakGoogle = [...NEEDLES].filter((n) => hay(google).includes(n));
  const leakOther = [...NEEDLES].filter((n) => hay(sent.filter((s) => !isMeta(s) && !isGoogle(s) && !isReddit(s) && !/bolt-staging\.fly\.dev$/.test(new URL(s.url).hostname))).includes(n));
  ok(leakMeta.length === 0, `nothing typed reaches Meta — raw, formatted or hashed ${leakMeta.length ? JSON.stringify(leakMeta.map((n) => n.slice(0, 16))) : ''}`);
  ok(leakGoogle.length === 0, `nothing typed reaches Google — raw, formatted or hashed ${leakGoogle.length ? JSON.stringify(leakGoogle.map((n) => n.slice(0, 16))) : ''}`);
  ok(leakOther.length === 0, `nothing typed reaches any other third party ${leakOther.length ? JSON.stringify(leakOther) : ''}`);
  ok(['demo_opened', 'demo_code_verified', 'demo_call_finished', 'demo_trial_clicked'].every((e) => ingest.includes(e)), "Bolt's own funnel events sent (to Bolt only)");

  if (RPIXEL) {
    // Everything Reddit got from step [1] on: step [0] leaks on purpose (Reddit serving matching ON).
    const reddit = sent.slice(m1).filter(isReddit);
    console.log(`  Reddit serves pixel ${RPIXEL}: ${redditServed}${redditFull ? `. Steps [1]–[2] ran Reddit's full script with matching ${redditFull.toUpperCase()} instead` : ''}`);
    console.log(`  Reddit received ${reddit.length} requests in steps [1]–[2]; script loaded ${served.reddit - reddit1}x; Reddit cookies at the end: ${rstate.cookies.filter((n) => n.startsWith('_rdt')).join(', ') || 'none'}`);
    ok(REDDIT_SRC.includes(CLEANUP_CALL), 'reddit-pixel.js deletes the cookies Reddit stored while matching was on (clearRedditMatchCookies)');
    ok(libErrors.length === 0, `Reddit's served script and settings were read ${libErrors.length ? JSON.stringify(libErrors) : ''}`);
    ok(served.reddit - reddit1 >= 1 && reddit.some((s) => text(s).includes(RPIXEL)), `Reddit's real script ran and sent to pixel ${RPIXEL}`);
    const leadIn = (a, b) => sent.slice(a, b).filter(isReddit).some((s) => /\bLead\b/.test(text(s)));
    ok(reddit.some((s) => /PageVisit/.test(text(s))) && leadIn(m1, m2) && leadIn(mTap), 'Reddit got PageVisit, and a Lead from both start-trial taps (the demo recap, handyman.html)');
    ok(redditServedOff, `Reddit serves automatic matching OFF for pixel ${RPIXEL} (${redditServed}). If ON: Reddit Ads → Events Manager → pixel ${RPIXEL} → Settings → automatic advanced matching off for email and phone number`);
    ok(!(rstate.aam && (rstate.aam.email || rstate.aam.phoneNumber)), `no automatic matching ran in Reddit's script (rdt.aam ${JSON.stringify(rstate.aam)})`);
    const auto = reddit.filter((s) => /auto_(pn|em)/.test(text(s)));
    ok(auto.length === 0, `no matching fields (auto_pn, auto_em) in any Reddit request ${auto.length ? `(${auto.length} of ${reddit.length})` : ''}`);
    const leakReddit = [...NEEDLES].filter((n) => hay(reddit).includes(n));
    ok(leakReddit.length === 0, `nothing typed reaches Reddit — raw, formatted or hashed ${leakReddit.length ? JSON.stringify(leakReddit.map((n) => n.slice(0, 16))) : ''}`);
    ok(!rstate.cookies.includes('_rdt_pn') && !rstate.cookies.includes('_rdt_em'), "Reddit's matching cookies are gone (_rdt_pn, _rdt_em)");
  } else console.log('  Reddit: the pixel is off in reddit-pixel.js (empty PIXEL_ID): not checked');

  const verdict = bad ? `\n${bad} FAILED${NC ? ` (negative control: ${NC})` : ''}` : `\nALL PASS${NC ? ` — negative control ${NC} did NOT bite` : ''}`;
  console.log(SIM ? `${verdict}\nSIMULATED: steps [1]–[2] ran Reddit's full script with matching OFF, not what Reddit serves for our pixel. Not a live pass.` : verdict);
  ws.close();
} finally {
  chrome.kill('SIGKILL'); srv.close();
  await sleep(300); rmSync(PROFILE, { recursive: true, force: true });
}
process.exit(bad ? 1 : SIM ? 3 : 0);
