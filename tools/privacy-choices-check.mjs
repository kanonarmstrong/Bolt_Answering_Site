// AFMBP-2019 — prove "Your Privacy Choices" does what it says, on top of the AFMBP-2021 pixel:
// Meta and Google run by default, stop on opt-out (this page and the next) and for Global Privacy
// Control, come back on opt-in; the pixel's events carry the trade, the demo's call-finished step
// is sent, and nothing typed into the demo reaches Meta or Google. Bolt's own funnel keeps going.
// Run: node tools/privacy-choices-check.mjs [siteRoot]
//      NC=<name> node tools/privacy-choices-check.mjs   — one negative control (see MUTATE)
// Headless Chrome. Nothing leaves the machine: Google's and Meta's scripts and endpoints, Bolt's
// API and app.boltanswering.com are all answered locally, and the served pixel carries a test ID.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

const ROOT = process.argv[2] ?? new URL('..', import.meta.url).pathname;
const NC = process.env.NC || '';
const PORT = 20000 + Math.floor(Math.random() * 10000), DBG = 30000 + Math.floor(Math.random() * 10000);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TEST_ID = '987654321098765';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.webp': 'image/webp' };

// Negative controls: each breaks one guarantee in the SERVED copy only (nothing on disk changes).
const MUTATE = {
  no_gpc_google: (f, s) => (f.endsWith('.html') ? s.split('navigator.globalPrivacyControl === true || ').join('') : s),
  no_optout_write: (f, s) => (f.endsWith('privacy-choices.js') ? s.replace("else window.localStorage.setItem(KEY, '1');", ';') : s),
  no_revoke: (f, s) => (f.endsWith('privacy-choices.js') ? s.replace("window.fbq('consent', 'revoke');", ';') : s),
  no_trade: (f, s) => (f.endsWith('meta-pixel.js') ? s.split(', trade: trade').join('') : s),
  no_call_finished: (f, s) => (f.endsWith('meta-pixel.js') ? s.replace("window.fbq('trackCustom', 'DemoCallFinished'", "void ('DemoCallFinished'") : s),
  no_footer_link: (f, s) => (f.endsWith('.html') ? s.split(' data-privacy-choices>Your Privacy Choices').join('>Your Privacy Choices') : s),
};
if (NC && !MUTATE[NC]) throw new Error(`unknown NC "${NC}"; one of ${Object.keys(MUTATE).join(', ')}`);

const srv = createServer((req, res) => {
  try {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
    let f = join(ROOT, p);
    if (statSync(f).isDirectory()) f = join(f, 'index.html');
    let body = readFileSync(f);
    if (/\.(html|js|css)$/.test(f)) {
      let s = body.toString('utf8');
      if (f.endsWith('meta-pixel.js')) s = s.replace(/var PIXEL_ID = '[0-9]*';/, `var PIXEL_ID = '${TEST_ID}';`);
      if (NC) s = MUTATE[NC](f, s);
      body = Buffer.from(s);
    }
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(PORT, '127.0.0.1');

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cdp-2019-'))}`, '--no-first-run', '--no-default-browser-check', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) bad++; };

const TYPED = ['5551230000', '555) 123-0000', '555-123-0000', 'QA Test Co', 'qa-pc@example.com', '123456'];
const FB_STUB = `(function(){ var q = window.fbq; window.__fbq = window.__fbq || [];
  function rec(a){ window.__fbq.push(JSON.parse(JSON.stringify(Array.prototype.slice.call(a)))); }
  if (q) { q.callMethod = function(){ rec(arguments); }; (q.queue || []).forEach(rec); q.queue = []; } })();`;
const PAGE_PRE = `Object.defineProperty(Navigator.prototype, 'webdriver', { configurable: true, get: function(){ return false; } });
window.addEventListener('click', function (e) { var a = e.target && e.target.closest && e.target.closest('a'); if (a && /app\\.boltanswering\\.com/.test(a.href)) e.preventDefault(); }, true);`;
const GPC = `Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { configurable: true, get: function(){ return true; } });`;

try {
  let t = null;
  for (let i = 0; i < 100 && !t; i++) { try { t = (await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json()).find((x) => x.type === 'page'); } catch {} if (!t) await sleep(150); }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let nextId = 1; const pending = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  const log = { gtag: 0, fbevents: 0, thirdParty: [], ingest: [], errors: [] };
  const CORS = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' }];
  const reply = (requestId, body, type = 'application/json', code = 200) => send('Fetch.fulfillRequest', { requestId, responseCode: code, responseHeaders: [...CORS, { name: 'Content-Type', value: type }], body: Buffer.from(body).toString('base64') });
  ws.addEventListener('message', async (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); return; }
    if (msg.method === 'Runtime.exceptionThrown') { log.errors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || ''); return; }
    if (msg.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = msg.params; const u = new URL(request.url); const host = u.hostname;
    const body = request.postData || '';
    if (host === 'www.googletagmanager.com' && u.pathname === '/gtag/js') { log.gtag++; log.thirdParty.push(request.url); return reply(requestId, '/* gtag stub */', 'text/javascript'); }
    if (/google|doubleclick/.test(host)) { log.thirdParty.push(request.url + ' ' + body); return reply(requestId, '', 'text/plain', 204); }
    if (host === 'connect.facebook.net') { if (/fbevents\.js$/.test(u.pathname)) { log.fbevents++; return reply(requestId, FB_STUB, 'text/javascript'); } return reply(requestId, '', 'text/javascript'); }
    if (/facebook\.com$/.test(host)) { log.thirdParty.push(request.url + ' ' + body); return reply(requestId, '', 'text/plain'); }
    if (host === 'app.boltanswering.com') return reply(requestId, '<!doctype html><title>app</title>', 'text/html');
    if (host === 'bolt-staging.fly.dev') {
      if (request.method === 'OPTIONS') return send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: CORS });
      if (u.pathname === '/api/public/analytics/events') { try { log.ingest.push(...JSON.parse(body).events.map((e) => e.event_type)); } catch {} return reply(requestId, '{"ok":true}'); }
      if (u.pathname === '/api/demo/otp/send' || u.pathname === '/api/demo/otp/verify') return reply(requestId, '{"ok":true}');
      if (u.pathname === '/api/demo/token') return reply(requestId, '{"token":"tok"}');
      if (u.pathname === '/api/demo/call') return reply(requestId, '{"callId":"call-9","callerId":"+19257257959"}');
      if (u.pathname.startsWith('/api/demo/recap/')) return reply(requestId, JSON.stringify({ status: 'completed', transcript: [{ speaker: 'assistant', text: 'Hi, thanks for calling.' }, { speaker: 'caller', text: 'My AC is out.' }] }));
      return reply(requestId, '{}');
    }
    return send('Fetch.continueRequest', { requestId });
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Network.setBlockedURLs', { urls: ['*streamable.com*'] });
  await send('Fetch.enable', { patterns: ['*googletagmanager.com*', '*google-analytics.com*', '*googleadservices.com*', '*doubleclick.net*', '*connect.facebook.net*', '*facebook.com*', '*bolt-staging.fly.dev*', '*app.boltanswering.com*'].map((urlPattern) => ({ urlPattern })) });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_PRE });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : null; };
  const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(100); } return false; };
  const nav = async (path) => {
    await send('Page.navigate', { url: ORIGIN + path });
    await until(async () => (await ev("document.readyState === 'complete' && !!window.boltPrivacyChoices")) === true, 15000);
    await sleep(600);
  };
  const reset = async () => { await send('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'all' }); };
  const fbq = async () => (await ev('JSON.stringify(window.__fbq || [])')) ? JSON.parse(await ev('JSON.stringify(window.__fbq || [])')) : [];
  const named = (calls, kind, name) => calls.filter((c) => c[0] === kind && c[1] === name);
  const openPanel = async () => { await ev("document.querySelector('[data-privacy-choices]').click(), 1"); return until(async () => (await ev("!!document.querySelector('.pc-card[role=dialog]')")) === true, 3000); };

  // [1] Default: the link is there, Google and Meta load, the pixel starts without auto-scraping.
  console.log('[1] default on (hvac.html)');
  await reset(); let g0 = log.gtag, f0 = log.fbevents;
  await nav('/hvac.html');
  ok((await ev("(function(){var a=document.querySelector('footer a[data-privacy-choices]');return !!a&&a.textContent.trim()==='Your Privacy Choices'&&a.getAttribute('href')==='/privacy/#your-privacy-choices'})()")) === true, 'footer has "Your Privacy Choices" (no-JS target: /privacy/#your-privacy-choices)');
  ok(log.gtag === g0 + 1, `Google tag loaded once (${log.gtag - g0})`);
  let calls = await fbq();
  ok(log.fbevents === f0 + 1 && calls.some((c) => c[0] === 'set' && c[1] === 'autoConfig' && c[2] === false) && calls.some((c) => c[0] === 'init' && c[1] === TEST_ID) && named(calls, 'track', 'PageView').length === 1, `Meta pixel: autoConfig off, init, one PageView (${JSON.stringify(calls.map((c) => c[0] + ':' + c[1]))})`);

  // [2] The demo, start to finish: each step reaches Meta once, with the trade; nothing typed leaks.
  console.log('[2] demo walk (hvac.html?talk=1)');
  await reset(); log.thirdParty = []; log.ingest = [];
  await nav('/hvac.html?talk=1');
  await until(async () => (await ev("!!document.getElementById('demo-phone')")) === true, 15000);
  await ev(`(function(){function v(id,val){var i=document.getElementById(id); if(!i) return; i.value=val; i.dispatchEvent(new Event('input',{bubbles:true}));} v('demo-phone','5551230000'); v('demo-business','QA Test Co'); v('demo-email','qa-pc@example.com'); [].slice.call(document.querySelectorAll('.demo-btn')).find(function(b){return /continue/i.test(b.textContent)}).click(); return 1})()`);
  await until(async () => (await ev("document.querySelectorAll('.demo-code input').length")) === 6, 8000);
  await ev(`(function(){var b=[].slice.call(document.querySelectorAll('.demo-code input')); b.forEach(function(x,i){x.value=String(i+1)}); b[5].dispatchEvent(new Event('input',{bubbles:true})); return 1})()`);
  await until(async () => (await ev("!!document.querySelector('.demo-success-cta')")) === true, 15000);
  await sleep(800);
  await ev("document.querySelector('.demo-success-cta').click(), 1");
  await sleep(600);
  calls = await fbq();
  const vc = named(calls, 'track', 'ViewContent'), lead = named(calls, 'track', 'Lead'), cf = named(calls, 'trackCustom', 'DemoCallFinished'), st = named(calls, 'trackCustom', 'StartTrialClick');
  ok(vc.length === 1 && vc[0][2]?.trade === 'hvac' && vc[0][2]?.content_category === 'ad_link', `ViewContent once, trade hvac, ad_link (${JSON.stringify(vc[0]?.[2])})`);
  ok(lead.length === 1 && lead[0][2]?.trade === 'hvac' && !!lead[0][3]?.eventID, `Lead once, trade hvac, with eventID (${JSON.stringify(lead[0]?.slice(2))})`);
  ok(cf.length === 1 && cf[0][2]?.trade === 'hvac', `DemoCallFinished once, trade hvac (${JSON.stringify(cf[0]?.[2])})`);
  ok(st.length === 1 && st[0][2]?.from === 'recap' && st[0][2]?.trade === 'hvac', `StartTrialClick once, from recap (the demo win), trade hvac (${JSON.stringify(st[0]?.[2])})`);
  const sent = JSON.stringify(calls) + ' ' + log.thirdParty.join(' ');
  const leaked = TYPED.filter((x) => sent.includes(x));
  ok(leaked.length === 0, `nothing typed into the demo reaches Meta or Google ${leaked.length ? JSON.stringify(leaked) : ''}`);
  ok(['demo_opened', 'demo_code_verified', 'demo_call_finished', 'demo_trial_clicked'].every((e) => log.ingest.includes(e)), "Bolt's own funnel events still sent");

  // [3] Opt out in the panel: stops Meta and Google on this page and the next; the funnel keeps going.
  console.log('[3] opt out with the panel');
  await reset(); await nav('/hvac.html');
  ok(await openPanel(), 'footer link opens the panel');
  ok((await ev("document.getElementById('pc-switch').getAttribute('aria-checked')")) === 'true', 'switch starts on');
  await ev("document.getElementById('pc-switch').click(), document.querySelector('.pc-save').click(), 1");
  await sleep(300);
  calls = await fbq();
  ok((await ev("localStorage.getItem('bolt_optout')")) === '1', 'choice saved for this browser');
  ok(calls.some((c) => c[0] === 'consent' && c[1] === 'revoke'), 'Meta pixel revoked on this page');
  ok((await ev("JSON.stringify(window.dataLayer||[]).indexOf('\"ad_storage\":\"denied\"') > -1")) === true && (await ev("window['ga-disable-G-8C8SFMCRYH'] === true")) === true, 'Google told to stop on this page (consent denied + GA disabled)');
  ok((await ev("window.boltMeta && window.boltMeta.enabled === false")) === true, 'demo stops handing Meta ids to the server');
  ok(((await ev("document.querySelector('.pc-status').textContent")) || '').length > 0, 'panel confirms the save');
  g0 = log.gtag; f0 = log.fbevents; log.ingest = [];
  await nav('/hvac.html');
  ok(log.gtag === g0 && log.fbevents === f0, `next page: no Google tag, no Meta pixel (google +${log.gtag - g0}, meta +${log.fbevents - f0})`);
  ok(await openPanel() && (await ev("document.getElementById('pc-switch').getAttribute('aria-checked')")) === 'false', 'panel shows it off');
  await ev("document.querySelector('.pc-close').click(), 1");
  await ev("[].slice.call(document.querySelectorAll('a.btn--blue')).find(function(a){return /talk to your new assistant/i.test(a.textContent)}).click(), 1");
  await until(async () => log.ingest.includes('demo_opened'), 6000);
  ok(log.ingest.includes('demo_opened'), "Bolt's own funnel still runs when opted out");

  // [4] Opt back in: the page reloads and both start again.
  console.log('[4] opt back in');
  g0 = log.gtag; f0 = log.fbevents;
  await ev("document.querySelector('.demo-close') && document.querySelector('.demo-close').click(), 1");
  await openPanel();
  await ev("document.getElementById('pc-switch').click(), document.querySelector('.pc-save').click(), 1");
  await sleep(1500);
  await until(async () => (await ev("document.readyState === 'complete' && !!window.boltPrivacyChoices")) === true, 15000);
  await sleep(800);
  ok((await ev("localStorage.getItem('bolt_optout')")) === null, 'choice cleared');
  ok(log.gtag === g0 + 1 && log.fbevents === f0 + 1, `after the reload Google and Meta load again (google +${log.gtag - g0}, meta +${log.fbevents - f0})`);

  // [5] Global Privacy Control: off from the first page, switch locked, funnel still runs.
  console.log('[5] Global Privacy Control');
  await reset(); const gpcScript = await send('Page.addScriptToEvaluateOnNewDocument', { source: GPC });
  g0 = log.gtag; f0 = log.fbevents; log.ingest = [];
  await nav('/hvac.html');
  ok(log.gtag === g0 && log.fbevents === f0, `no Google tag, no Meta pixel (google +${log.gtag - g0}, meta +${log.fbevents - f0})`);
  await openPanel();
  ok((await ev("(function(){var s=document.getElementById('pc-switch');return s.disabled&&s.getAttribute('aria-checked')==='false'&&/Global Privacy Control/.test(document.querySelector('.pc-card').textContent)})()")) === true, 'panel: switch off and locked, says why');
  await until(async () => log.ingest.includes('site_landed'), 4000);
  ok(log.ingest.includes('site_landed'), "Bolt's own funnel still runs under GPC");
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: gpcScript.identifier });

  // [6] Every page: Google loads by default and not after opting out; no script errors.
  console.log('[6] all 13 pages');
  const PAGES = ['/index.html', '/hvac.html', '/plumbing.html', '/electrical.html', '/handyman.html', '/general-contractor.html', '/privacy/', '/terms/', '/deletemydata/', '/support/', '/support/hca/disable-ios-spam-blockers/', '/support/hca/disable-android-spam-blockers/', '/support/hca/verizon-iphone-disable-live-voicemail/'];
  const FOOTER = new Set(PAGES.slice(0, 6));
  await reset(); log.errors = [];
  const onDefault = [], linkOk = [];
  for (const p of PAGES) { g0 = log.gtag; await nav(p); onDefault.push(log.gtag === g0 + 1); linkOk.push(FOOTER.has(p) ? (await ev("!!document.querySelector('footer a[data-privacy-choices]')")) === true : true); }
  ok(onDefault.every(Boolean), `Google tag loads on every page by default (${onDefault.filter(Boolean).length}/13)`);
  ok(linkOk.every(Boolean), 'footer link on the 6 pages that have a footer');
  await ev("localStorage.setItem('bolt_optout','1'), 1");
  const offOk = [];
  for (const p of PAGES) { g0 = log.gtag; f0 = log.fbevents; await nav(p); offOk.push(log.gtag === g0 && log.fbevents === f0); }
  ok(offOk.every(Boolean), `opted out: no Google tag or Meta pixel on any page (${offOk.filter(Boolean).length}/13)`);
  const ours = log.errors.filter((e) => /gtag|fbq|privacy|boltPrivacy|bolt_optout|dataLayer/i.test(e));
  ok(ours.length === 0, `no script errors from the tags or the panel ${ours.length ? JSON.stringify(ours.slice(0, 3)) : ''}`);

  // [7] The privacy policy section and its button; Escape closes; focus returns.
  console.log('[7] privacy policy section');
  await reset(); await nav('/privacy/');
  ok((await ev("!!document.getElementById('your-privacy-choices') && !!document.querySelector('#your-privacy-choices ~ p [data-privacy-choices]')")) === true, 'section #your-privacy-choices with its button');
  await ev("document.querySelector('[data-privacy-choices]').focus(), document.querySelector('[data-privacy-choices]').click(), 1");
  ok(await until(async () => (await ev("!!document.querySelector('.pc-card[role=dialog]')")) === true, 3000), 'button opens the panel');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(200);
  ok((await ev("!document.querySelector('.pc-card') && document.activeElement && document.activeElement.hasAttribute('data-privacy-choices')")) === true, 'Escape closes it and focus returns to the button');

  console.log(bad ? `\n${bad} FAILED${NC ? ` (negative control: ${NC})` : ''}` : `\nALL PASS${NC ? ` — negative control ${NC} did NOT bite` : ''}`);
  ws.close();
} finally {
  chrome.kill('SIGKILL'); srv.close();
}
process.exit(bad ? 1 : 0);
