// AFMBP-2130 — prove Sentry on the site sends only what it should, only when it should:
//   [0] the pinned bundle is Sentry's errors-only CDN bundle, and its integrity hash is the one Sentry
//       publishes for that file (checked against the downloaded file and Sentry's release registry);
//   [1] with the switch off, no page makes any request to any Sentry host, and the three demo
//       failures still reach Bolt's own analytics;
//   [2] with it on: every page loads the bundle once, with its integrity attribute; loading it sends
//       nothing; a forced error arrives with every URL's query string and fragment gone, phone numbers
//       and emails replaced, no Referer, no user, infer_ip "never", the deploy as its release and a
//       readable source location; the demo's API calls carry no tracing headers; each demo failure
//       arrives as a tagged message and as an analytics event, with nothing the visitor typed;
//   [3] our test visits, automated browsers, Global Privacy Control, an opt-out (before or during the
//       visit) and any host but the live site send nothing;
//   [4] the integrity check is enforced: a tampered bundle never runs, and the demo still works;
//   [5] an error thrown while the bundle is still loading is sent once it has loaded.
// Run: node tools/sentry-check.mjs [siteRoot]
//      NC=<name> node tools/sentry-check.mjs   — one negative control on the SERVED copy only (see
//      MUTATE); each must FAIL. Nothing on disk changes.
//      DUMP=1 node tools/sentry-check.mjs       — also print the forced error's envelope exactly as sent
// Headless Chrome. Nothing leaves the machine from the browser: Chrome resolves no host name, and every
// request — the site itself (served as https://www.boltanswering.com from this folder), Sentry's CDN
// and ingest, Bolt's API, Google, Meta — is answered in-process. Only this script (Node) downloads the
// pinned bundle from Sentry's CDN and its published checksum from Sentry's release registry.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

const ROOT = process.argv[2] ?? new URL('..', import.meta.url).pathname;
const NC = process.env.NC || '';
const DBG = 30000 + Math.floor(Math.random() * 10000);
const SITE = 'https://www.boltanswering.com';
const LOCAL = `http://127.0.0.1:${20000 + Math.floor(Math.random() * 10000)}`; // nothing listens: answered in-process
const LAST_MODIFIED = 'Mon, 12 Oct 2026 18:52:05 GMT', RELEASE = 'bolt-site@20261012T185205Z';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.webp': 'image/webp', '.mp4': 'video/mp4' };
const PAGES = ['/index.html', '/hvac.html', '/plumbing.html', '/electrical.html', '/handyman.html', '/general-contractor.html', '/privacy/', '/terms/', '/deletemydata/', '/support/', '/support/hca/disable-ios-spam-blockers/', '/support/hca/disable-android-spam-blockers/', '/support/hca/verizon-iphone-disable-live-voicemail/'];
const TALK = '/hvac.html?talk=1&utm_source=facebook&utm_medium=paid_social&fbclid=TESTCLICK';
const REFERRER = 'https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.boltanswering.com%2F&h=AT0SECRET';
// What the demo walk types and what the forced error carries. None of it may reach Sentry, in any form.
const PHONE = '5551230000', BIZ = 'QA Test Co', EMAIL = 'qa-pc@example.com';
const NEEDLES = [PHONE, '555-123-0000', '(555) 123-0000', '555) 123-0000', '+15551230000', '15551230000', BIZ, 'QA+Test+Co', 'QA%20Test%20Co', EMAIL, 'qa-pc%40example.com', 'TESTCLICK', 'PUSHED', 'paid_social', 'AT0SECRET', 'l.facebook.com', 'secret=1'];
const THROW_PATH = '/__sentry_check_throw.js'; // served by this script only, never part of the site
const THROW_JS = `// tools/sentry-check.mjs only
function throwForSentryCheck() {
  throw new Error('forced: call +15551230000 or (555) 123-0000, mail ${EMAIL}, from ${SITE}/hvac.html?talk=1&fbclid=TESTCLICK#frag');
}
throwForSentryCheck();
`;
const TRANSCRIPT = [{ speaker: 'assistant', text: 'Hi, thanks for calling.' }, { speaker: 'caller', text: 'My AC is out.' }];

let bad = 0, good = 0;
const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${m}`); if (c) good++; else bad++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(100); } return v; };

// ---------- the pinned bundle, and what Sentry publishes for it ----------
const INIT_PATH = join(ROOT, 'sentry-init.js');
const SWITCH = /var SENTRY_SITE_ENABLED = (true|false);/;
const onDisk = readFileSync(INIT_PATH, 'utf8');
if ((onDisk.match(new RegExp(SWITCH.source, 'g')) || []).length !== 1) throw new Error('sentry-init.js must carry exactly one SENTRY_SITE_ENABLED line');
const COMMITTED = SWITCH.exec(onDisk)[1] === 'true';
const VERSION = /browser\.sentry-cdn\.com\/([0-9][^/]*)\//.exec(onDisk)?.[1];
if (!VERSION) throw new Error('sentry-init.js: no pinned browser.sentry-cdn.com version');
const registry = await fetch(`https://release-registry.services.sentry.io/sdks/sentry.javascript.browser/${VERSION}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const published = (file) => { const h = registry?.files?.[file]?.checksums?.['sha384-base64']; return h ? `sha384-${h}` : null; };

// Negative controls: each breaks one guarantee in the SERVED copy. The anchor must be found, so a
// control can never silently change nothing.
const swap = (...pairs) => (s) => { for (let i = 0; i < pairs.length; i += 2) { if (!s.includes(pairs[i])) throw new Error(`NC anchor not found: ${pairs[i]}`); s = s.split(pairs[i]).join(pairs[i + 1]); } return s; };
const otherBundle = (file) => swap("/bundle.min.js';", `/${file}';`, /var INTEGRITY = '[^']+';/.exec(onDisk)[0], `var INTEGRITY = '${published(file)}';`);
const MUTATE = {
  no_switch: ['sentry-init.js', swap("if (!SENTRY_SITE_ENABLED) return 'off';", "if (false) return 'off';")],
  no_host_gate: ['sentry-init.js', swap("if (HOSTS.indexOf(window.location.hostname) < 0) return 'host';", '')],
  no_privacy_gate: ['sentry-init.js', swap("if (!choices.allowed()) return 'privacy';", '')],
  no_webdriver_gate: ['sentry-init.js', swap("if (attr.isAutomated()) return 'automated';", '')],
  no_qa_gate: ['sentry-init.js', swap("if (attr.isQa()) return 'qa';", '')],
  no_scrub: ['sentry-init.js', swap('return scrub(event, 0);', 'return event;')],
  no_redact: ['sentry-init.js', swap(".replace(EMAIL, '[email]').replace(E164, '$1[phone]').replace(US_PHONE, '$1[phone]');", ';')],
  no_url_strip: ['sentry-init.js', swap("s.replace(ABS_URL, '$1').replace(REL_URL, '$1$2').replace(CLICK_ID, '$1=[filtered]')", 's')],
  no_sri: ['sentry-init.js', swap("s.setAttribute('integrity', INTEGRITY);", '')],
  pii_on: ['sentry-init.js', swap('userInfo: false,', 'userInfo: true,')],
  sessions_on: ['sentry-init.js', swap("return defaults.filter(function (i) { return i.name !== 'BrowserSession' && i.name !== 'CultureContext'; });", 'return defaults;')],
  client_reports_on: ['sentry-init.js', swap('sendClientReports: false,', 'sendClientReports: true,')],
  no_early_buffer: ['sentry-init.js', swap('early.splice(0).forEach(function (err) { try { S.captureException(err); } catch (e) {} });', '')],
  no_demo_sentry: ['sentry-init.js', swap("window.addEventListener('bolt:track', onTrack);", '')],
  tracing_bundle: ['sentry-init.js', otherBundle('bundle.tracing.min.js')],
  replay_bundle: ['sentry-init.js', otherBundle('bundle.replay.min.js')],
  no_recap_report: ['demo.js', swap("track('demo_recap_poll_failed', ", "void ('demo_recap_poll_failed', ")],
  no_callid_report: ['demo.js', swap("else track('demo_call_id_missing', ", "else void ('demo_call_id_missing', ")],
  no_close_report: ['demo.js', swap("track('demo_closed_while_polling', ", "void ('demo_closed_while_polling', ")],
};
if (NC && !MUTATE[NC]) throw new Error(`unknown NC "${NC}"; one of ${Object.keys(MUTATE).join(', ')}`);
let mutated = 0;
// The copy Chrome gets: the switch as the scenario wants it, and the negative control, if any.
function served(file, s, on) {
  if (file.endsWith('/sentry-init.js')) s = s.replace(SWITCH, `var SENTRY_SITE_ENABLED = ${on};`);
  if (NC && file.endsWith('/' + MUTATE[NC][0])) { s = MUTATE[NC][1](s); mutated++; }
  return s;
}
const SERVED_INIT = served(INIT_PATH, onDisk, true);
const cfg = (name) => new RegExp(`var ${name} = '([^']+)';`).exec(SERVED_INIT)?.[1];
const BUNDLE = cfg('BUNDLE'), INTEGRITY = cfg('INTEGRITY'), DSN = new URL(cfg('DSN'));
const BUNDLE_BYTES = await fetch(BUNDLE).then(async (r) => (r.ok ? Buffer.from(await r.arrayBuffer()) : null)).catch(() => null);
if (!BUNDLE_BYTES) throw new Error(`could not download ${BUNDLE} (this check needs the internet for the bundle)`);
const TAMPERED = Buffer.concat([BUNDLE_BYTES, Buffer.from('\n/* tampered */\n')]);

function siteFile(pathname, on) {
  const p = normalize(decodeURIComponent(pathname)).replace(/^([.][.][/\\])+/, '');
  let f = join(ROOT, p);
  if (statSync(f).isDirectory()) f = join(f, 'index.html');
  let body = readFileSync(f);
  if (/\.(html|js)$/.test(f)) body = Buffer.from(served(f, body.toString('utf8'), on));
  return { body, type: TYPES[extname(f)] || 'application/octet-stream' };
}
function parseEnvelope(body) {
  const lines = String(body).split('\n').filter((l) => l.length);
  const items = [];
  for (let i = 1; i + 1 < lines.length; i += 2) {
    let payload; try { payload = JSON.parse(lines[i + 1]); } catch { payload = lines[i + 1]; }
    items.push({ type: JSON.parse(lines[i]).type, payload });
  }
  return { header: JSON.parse(lines[0]), items };
}

// ---------- Chrome ----------
const PROFILE = mkdtempSync(join(tmpdir(), 'cdp-2130-')); // removed at exit
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--window-size=1280,900', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
let ver; for (let i = 0; i < 75 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${DBG}/json/version`)).json(); } catch { await sleep(200); } }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let nextId = 1; const pending = new Map(); const listeners = [];
ws.addEventListener('message', (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); } else listeners.forEach((f) => f(msg)); });
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params, sessionId })); });

const CORS = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' }];
const ct = (v) => ({ name: 'Content-Type', value: v });
// Every request of a scenario's page lands here; st records what the page tried to send.
async function route(st, S, p) {
  const { requestId, request, resourceType, networkId } = p;
  const u = new URL(request.url), host = u.hostname;
  const fulfill = (code, headers, body = '') => S('Fetch.fulfillRequest', { requestId, responseCode: code, responseHeaders: headers, body: Buffer.from(body).toString('base64') });
  const bodyOf = async () => {
    if (request.postData) return request.postData;
    if (request.postDataEntries) return request.postDataEntries.map((e) => Buffer.from(e.bytes || '', 'base64').toString('utf8')).join('');
    if (request.hasPostData && networkId) { try { return (await S('Network.getRequestPostData', { requestId: networkId })).postData; } catch {} }
    return '';
  };
  if (/sentry/i.test(host)) st.sentry.push(`${request.method} ${request.url}`);
  if (u.origin === SITE || u.origin === LOCAL) {
    if (u.pathname === THROW_PATH) return fulfill(200, [ct('text/javascript')], THROW_JS);
    try {
      const f = siteFile(u.pathname, st.on);
      return fulfill(200, [ct(f.type), { name: 'Last-Modified', value: LAST_MODIFIED }, { name: 'Cache-Control', value: 'no-store' }], f.body);
    } catch { return fulfill(404, [ct('text/plain')]); }
  }
  if (host === 'browser.sentry-cdn.com') {
    st.cdn++;
    const answer = () => (request.url === BUNDLE ? fulfill(200, [...CORS, ct('application/javascript')], st.tamper ? TAMPERED : BUNDLE_BYTES) : fulfill(404, CORS));
    if (st.hold) { st.releaseBundle = answer; return; }
    return answer();
  }
  if (/(^|\.)sentry\.io$/.test(host)) {
    if (request.method === 'OPTIONS') return fulfill(204, CORS);
    st.envelopes.push({ url: request.url, body: await bodyOf() });
    return fulfill(200, [...CORS, ct('application/json')], '{}');
  }
  if (host === 'bolt-staging.fly.dev') {
    if (request.method === 'OPTIONS') return fulfill(204, CORS);
    st.api.push({ path: u.pathname, headers: request.headers });
    const json = (o, code = 200) => fulfill(code, [...CORS, ct('application/json')], JSON.stringify(o));
    if (u.pathname === '/api/public/analytics/events') { try { JSON.parse(await bodyOf()).events.forEach((e) => st.events.push({ type: e.event_type, data: e.event_data })); } catch {} return json({ ok: true }); }
    if (u.pathname === '/api/demo/otp/send' || u.pathname === '/api/demo/otp/verify') return json({ ok: true });
    if (u.pathname === '/api/demo/token') return json({ token: 'tok' });
    if (u.pathname === '/api/demo/call') return json(st.call);
    if (u.pathname.startsWith('/api/demo/recap/')) {
      st.recapChecks++;
      if (st.recap === 'network') return S('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' });
      return json(st.recap);
    }
    if (u.pathname === '/api/demo/inbound/session') return json({ error: 'stubbed' }, 503);
    return json({});
  }
  // Google, Meta, Streamable, the app, the 3D phone's library: answered here, nothing leaves.
  st.other.add(host);
  if (resourceType === 'Document') return fulfill(200, [ct('text/html')], '<!doctype html><title>stub</title>');
  return fulfill(200, [...CORS, ct(resourceType === 'Script' ? 'text/javascript' : 'text/plain')]);
}

const PRE = (o) => `Object.defineProperty(Navigator.prototype, 'webdriver', { configurable: true, get: function(){ return ${!!o.automated}; } });
${o.gpc ? "Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { configurable: true, get: function(){ return true; } });" : ''}
window.__vs = 'visible';
Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: function(){ return window.__vs; } });
Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: function(){ return window.__vs !== 'visible'; } });
(function(){ var real = Date.now.bind(Date); window.__skew = 0; Date.now = function(){ return real() + window.__skew; }; })();
window.addEventListener('click', function (e) { var a = e.target && e.target.closest && e.target.closest('a'); if (a && /app\\.boltanswering\\.com/.test(a.href)) e.preventDefault(); }, true);`;

// One browser context (fresh storage) per scenario.
async function open(o = {}) {
  const st = { on: o.on ?? true, tamper: !!o.tamper, hold: !!o.hold, releaseBundle: null, call: o.call ?? { callId: 'call-9', callerId: '+19257257959' }, recap: o.recap ?? { status: 'completed', transcript: TRANSCRIPT }, sentry: [], cdn: 0, envelopes: [], api: [], events: [], recapChecks: 0, other: new Set(), errors: [], logs: [] };
  const { browserContextId } = await send('Target.createBrowserContext');
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p = {}) => send(m, p, sessionId);
  const onMsg = (m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Fetch.requestPaused') route(st, S, m.params).catch((e) => st.errors.push(`route: ${e.message}`));
    else if (m.method === 'Runtime.exceptionThrown') st.errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    else if (m.method === 'Log.entryAdded') st.logs.push(m.params.entry.text);
  };
  listeners.push(onMsg);
  await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable'); await S('Log.enable');
  await S('Network.setCacheDisabled', { cacheDisabled: true });
  await S('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await S('Page.addScriptToEvaluateOnNewDocument', { source: PRE(o) });
  const ev = async (expression) => { const r = await S('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : undefined; };
  const nav = async (path, referrer) => {
    const loaded = new Promise((r) => { const f = (m) => { if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') { listeners.splice(listeners.indexOf(f), 1); r(); } }; listeners.push(f); });
    await S('Page.navigate', { url: (o.origin ?? SITE) + path, ...(referrer ? { referrer } : {}) });
    await Promise.race([loaded, sleep(15000)]);
  };
  const ready = () => until(() => ev('!!(window.Sentry && window.Sentry.getClient && window.Sentry.getClient())'), 8000);
  const close = async () => { listeners.splice(listeners.indexOf(onMsg), 1); await send('Target.disposeBrowserContext', { browserContextId }); };
  return { st, ev, nav, ready, close };
}
const sentEvents = (st) => st.envelopes.flatMap((e) => parseEnvelope(e.body).items.filter((i) => i.type === 'event').map((i) => i.payload));
const itemTypes = (st) => [...new Set(st.envelopes.flatMap((e) => parseEnvelope(e.body).items.map((i) => i.type)))];
const leaks = (text) => NEEDLES.filter((n) => text.includes(n));
const throwNow = (pageQuery = '?v=1&fbclid=TESTCLICK') => `(function(){ var s = document.createElement('script'); s.src = '${THROW_PATH}${pageQuery}'; document.head.appendChild(s); return 1; })()`;
const msgOf = (e) => e.message ?? e.logentry?.message ?? e.logentry?.formatted;
const excValue = (e) => { const v = e.exception?.values; return v && v.length ? v[v.length - 1].value : undefined; };

// The outbound demo, from the choice screen to the placed call: typed values a visitor would type.
const WALK = `(async () => {
  const w = (t) => new Promise((r) => setTimeout(r, t));
  for (let i = 0; i < 80 && !document.querySelector('.demo-choice__get'); i++) await w(100);
  document.querySelector('.demo-choice__get').click();
  for (let i = 0; i < 50 && !document.getElementById('demo-phone'); i++) await w(100);
  const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  set('demo-phone', '${PHONE}'); set('demo-business', '${BIZ}'); set('demo-email', '${EMAIL}');
  [...document.querySelectorAll('.demo-backdrop .demo-btn')].find((b) => /continue/i.test(b.textContent)).click();
  for (let i = 0; i < 50 && document.querySelectorAll('.demo-code input').length < 6; i++) await w(100);
  const b = document.querySelectorAll('.demo-code input'); b[0].value = '123456'; b[0].dispatchEvent(new Event('input', { bubbles: true }));
  return true; })()`;
const FAILURES = {
  no_call_id: { event: 'demo_call_id_missing', level: 'error', opts: { call: { ok: true } } },
  closed_while_polling: { event: 'demo_closed_while_polling', level: 'warning', opts: { recap: { status: 'in_call' } } },
  recap_poll_network: { event: 'demo_recap_poll_failed', level: 'error', opts: { recap: 'network' } },
};
// Reproduce one silent demo failure; returns the scenario's record.
async function demoFailure(kind, on) {
  const F = FAILURES[kind];
  const p = await open({ on, ...F.opts });
  await p.nav(TALK);
  await p.ev(WALK);
  if (kind === 'closed_while_polling') {
    await until(async () => p.st.recapChecks > 0, 8000);
    await sleep(300);
    await p.ev("document.querySelector('.demo-close').click(), 1");
  }
  if (kind === 'recap_poll_network') {
    await until(async () => p.st.recapChecks > 0, 8000);
    await sleep(800); // the first failed check is handled (and the next one scheduled) at the real time
    await p.ev('window.__skew = 10 * 60000, 1'); // past the 4-minute wait: the next failed check gives up
  }
  await until(async () => p.st.events.some((e) => e.type === F.event), 12000);
  if (on) await until(async () => sentEvents(p.st).some((e) => e.tags?.demo_failure === kind), 6000);
  else await sleep(1200);
  await p.close();
  return p.st;
}
function checkFailureEvent(kind, st) {
  const F = FAILURES[kind];
  const evs = st.events.filter((e) => e.type === F.event);
  const d = evs[0]?.data ?? {};
  const shape = {
    no_call_id: d.stage === 'call' && d.reason === 'no_call_id',
    closed_while_polling: d.at === 'in_call' && d.waiting_for === 'call_end' && d.call_id === 'call-9' && typeof d.waited_s === 'number' && d.failed_checks === 0,
    recap_poll_network: d.stage === 'recap_poll' && d.reason === 'network' && d.call_id === 'call-9' && d.waiting_for === 'call_end' && d.failed_checks >= 2,
  }[kind];
  ok(evs.length === 1 && d.trade === 'hvac' && shape, `${kind}: one ${F.event} analytics event (${JSON.stringify({ stage: d.stage, reason: d.reason, at: d.at, waiting_for: d.waiting_for, call_id: d.call_id, failed_checks: d.failed_checks, trade: d.trade })})`);
  const typed = [PHONE, '555) 555', BIZ, EMAIL].filter((n) => JSON.stringify(evs).includes(n));
  ok(typed.length === 0, `${kind}: the analytics event carries nothing the visitor typed ${typed.length ? JSON.stringify(typed) : ''}`);
}

try {
  console.log(`sentry-init.js as committed: SENTRY_SITE_ENABLED = ${COMMITTED}${NC ? ` — negative control ${NC}` : ''}`);

  // ---------- [0] ----------
  console.log(`[0] the pinned bundle (${BUNDLE})`);
  ok(/^https:\/\/browser\.sentry-cdn\.com\/\d+\.\d+\.\d+\/bundle\.min\.js$/.test(BUNDLE), 'it is the errors-only bundle (bundle.min.js), at an exact version: no tracing, replay, feedback or logs bundle');
  const digest = 'sha384-' + createHash('sha384').update(BUNDLE_BYTES).digest('base64');
  ok(digest === INTEGRITY, `the integrity attribute matches the file (${digest})`);
  const pubFile = BUNDLE.split('/').pop();
  ok(published(pubFile) === INTEGRITY, `it is the hash Sentry publishes for ${VERSION}/${pubFile} (release registry: ${published(pubFile)})`);
  const bundleText = BUNDLE_BYTES.toString('utf8');
  ok(/does not include tracing/.test(bundleText) && /does not include replay/.test(bundleText), 'the file itself has no tracing and no replay (it carries Sentry\'s stand-ins for both)');
  const forbidden = ['js.sentry-cdn.com', 'replayIntegration', 'browserTracingIntegration', 'tracesSampleRate', 'replaysSessionSampleRate', 'replaysOnErrorSampleRate', 'profilesSampleRate', 'enableLogs'].filter((x) => SERVED_INIT.includes(x));
  ok(forbidden.length === 0, `sentry-init.js has no Loader Script, tracing, replay, profiling or logs settings ${forbidden.length ? JSON.stringify(forbidden) : ''}`);

  // ---------- [1] ----------
  console.log('[1] switch off: no Sentry request from any page; the demo failures still reach Bolt');
  {
    const p = await open({ on: false });
    const rows = [];
    for (const path of PAGES) {
      await p.nav(path === '/hvac.html' ? TALK : path);
      await sleep(900);
      rows.push({ path, info: await p.ev("JSON.stringify({ b: window.boltSentry || null, S: typeof window.Sentry, tag: document.querySelectorAll('script[src*=\"sentry-cdn\"]').length })") });
    }
    await sleep(1000);
    const offEverywhere = rows.every((r) => { const i = JSON.parse(r.info); return i.b && i.b.enabled === false && i.b.blockedBy === 'off' && i.S === 'undefined' && i.tag === 0; });
    ok(offEverywhere, `all 13 pages run sentry-init.js and stay off (boltSentry.blockedBy "off", no Sentry script, no window.Sentry) ${offEverywhere ? '' : JSON.stringify(rows.filter((r) => !/"blockedBy":"off"/.test(r.info)))}`);
    ok(p.st.sentry.length === 0, `no request to any Sentry host (${p.st.sentry.length}) ${p.st.sentry.slice(0, 3).join(' ')}`);
    await p.close();
  }
  for (const kind of Object.keys(FAILURES)) {
    const st = await demoFailure(kind, false);
    checkFailureEvent(kind, st);
    ok(st.sentry.length === 0, `${kind}: and no request to any Sentry host (${st.sentry.length})`);
  }

  // ---------- [2] ----------
  console.log('[2] switch on, a visitor from a Meta ad on the live site');
  {
    const p = await open();
    await p.nav(TALK, REFERRER);
    ok(!!(await p.ready()), 'Sentry loads and starts');
    const tag = JSON.parse(await p.ev("JSON.stringify([].slice.call(document.querySelectorAll('script[src*=\"sentry-cdn\"]')).map(function (s) { return { src: s.src, integrity: s.getAttribute('integrity'), crossorigin: s.getAttribute('crossorigin') }; }))"));
    ok(tag.length === 1 && tag[0].src === BUNDLE && tag[0].integrity === INTEGRITY && tag[0].crossorigin === 'anonymous', `one script tag: the pinned bundle with integrity + crossorigin="anonymous" (${JSON.stringify(tag)})`);
    ok(p.st.cdn === 1, `the bundle was requested once (${p.st.cdn})`);
    ok((await p.ev('JSON.stringify(window.boltSentry)')) === '{"enabled":true,"blockedBy":null}', `window.boltSentry says on (${await p.ev('JSON.stringify(window.boltSentry)')})`);
    await sleep(2500);
    ok(p.st.envelopes.length === 0, `loading Sentry sends nothing: no session, no event (${itemTypes(p.st).join(',') || 'nothing sent'})`);
    // An error Sentry is told to ignore, then the page is hidden: no client report goes out either.
    await p.ev("setTimeout(function(){ throw new Error('ResizeObserver loop limit exceeded'); }), 1");
    await sleep(500);
    await p.ev("window.__vs = 'hidden', document.dispatchEvent(new Event('visibilitychange')), 1");
    await sleep(1500);
    await p.ev("window.__vs = 'visible', document.dispatchEvent(new Event('visibilitychange')), 1");
    ok(p.st.envelopes.length === 0, `an ignored error and a hidden page send nothing (no client report) (${itemTypes(p.st).join(',') || 'nothing sent'})`);

    // Breadcrumbs with personal data and click ids, then a real error thrown from a served file.
    await p.ev(`(function(){
      history.pushState({}, '', '/hvac.html?talk=1&fbclid=PUSHED#frag');
      console.log('log: call 555-123-0000, mail ${EMAIL}, at /hvac.html?fbclid=TESTCLICK');
      fetch('https://bolt-staging.fly.dev/api/demo/recap/call-x?secret=1').catch(function(){});
      return 1; })()`);
    await sleep(600);
    await p.ev(throwNow());
    await until(async () => sentEvents(p.st).length > 0, 8000);
    await sleep(800);
    const evs = sentEvents(p.st), e = evs[0] ?? {};
    const env = p.st.envelopes[0] ?? { url: '', body: '' };
    console.log(`    sent: ${JSON.stringify(excValue(e))}`);
    if (process.env.DUMP) console.log(`    --- the envelope, exactly as sent ---\n${env.url}\n${env.body}\n    ---`);
    ok(evs.length === 1 && p.st.envelopes.length === 1, `exactly one envelope, one event (${p.st.envelopes.length}/${evs.length})`);
    const eu = env.url ? new URL(env.url) : null;
    ok(!!eu && eu.host === DSN.host && eu.pathname === `/api${DSN.pathname}/envelope/` && eu.searchParams.get('sentry_key') === DSN.username, `sent to the DSN's project (${eu ? eu.host + eu.pathname : 'none'})`);
    ok(itemTypes(p.st).join(',') === 'event', `only an error event: no transaction, span, replay, session, profile or log items (${itemTypes(p.st).join(',')})`);
    const v = excValue(e) || '';
    ok((v.match(/\[phone\]/g) || []).length === 2 && v.includes('[email]') && !/\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(v), 'error message: both phone numbers and the email replaced');
    ok(v.includes(`${SITE}/hvac.html,`) || v.endsWith(`${SITE}/hvac.html`), 'error message: the URL keeps its path, loses its query string and fragment');
    const frames = e.exception?.values?.at(-1)?.stacktrace?.frames ?? [];
    const top = frames.at(-1) ?? {};
    ok(top.filename === `${SITE}${THROW_PATH}` && top.function === 'throwForSentryCheck' && top.lineno === 3 && top.colno > 0, `readable source location: ${top.function} at ${top.filename}:${top.lineno}:${top.colno} (query string dropped)`);
    ok(e.request?.url === `${SITE}/hvac.html`, `page URL without its query string or fragment (${e.request?.url})`);
    const hdrs = e.request?.headers ?? {};
    ok(!!hdrs['User-Agent'] && !Object.keys(hdrs).some((h) => /^referer$/i.test(h)), `request headers: the browser line only, no Referer (${Object.keys(hdrs).join(', ')})`);
    ok(!('user' in e), 'no user on the event');
    const settings = e.sdk?.settings ?? parseEnvelope(env.body).header.sdk?.settings;
    ok(settings?.infer_ip === 'never', `Sentry is asked not to add the IP address (sdk.settings ${JSON.stringify(settings)})`);
    ok(e.environment === 'production' && e.release === RELEASE, `environment production, release = the deploy (${e.environment}, ${e.release})`);
    const crumbs = e.breadcrumbs ?? [];
    const nav = crumbs.find((b) => b.category === 'navigation'), con = crumbs.find((b) => b.category === 'console'), fet = crumbs.find((b) => b.category === 'fetch' && /recap\/call-x/.test(b.data?.url || ''));
    ok(nav?.data?.to === '/hvac.html', `navigation breadcrumb: no query string or fragment (${JSON.stringify(nav?.data)})`);
    ok(!!con && /\[phone\]/.test(con.message) && /\[email\]/.test(con.message) && !('arguments' in (con.data || {})), `console breadcrumb: phone and email replaced (${JSON.stringify(con?.message)})`);
    ok(fet?.data?.url === 'https://bolt-staging.fly.dev/api/demo/recap/call-x', `fetch breadcrumb: URL without its query string (${fet?.data?.url})`);
    const leaked = leaks(p.st.envelopes.map((x) => x.url + '\n' + x.body).join('\n'));
    ok(leaked.length === 0, `nothing personal or ad-identifying anywhere in what was sent ${leaked.length ? JSON.stringify(leaked) : ''}`);
    const traced = p.st.api.filter((r) => Object.keys(r.headers).some((h) => /^(sentry-trace|baggage|traceparent)$/i.test(h)));
    ok(traced.length === 0 && p.st.api.length > 0, `no tracing headers on Bolt API calls (${traced.length} of ${p.st.api.length})`);
    await p.close();
  }
  {
    const p = await open();
    const rows = [];
    for (const path of PAGES) {
      const before = p.st.cdn;
      await p.nav(path);
      rows.push({ path, ready: !!(await p.ready()), loads: p.st.cdn - before });
    }
    await sleep(800);
    const okRows = rows.filter((r) => r.ready && r.loads === 1);
    ok(okRows.length === 13, `every page loads the bundle once and starts Sentry (${okRows.length}/13) ${okRows.length === 13 ? '' : JSON.stringify(rows.filter((r) => !(r.ready && r.loads === 1)))}`);
    const seen = sentEvents(p.st).map(excValue);
    if (seen.length) console.log(`    note: errors these pages would report here (harness stubs, e.g. no 3D library): ${JSON.stringify(seen.slice(0, 4))}`);
    const leaked = leaks(p.st.envelopes.map((x) => x.url + '\n' + x.body).join('\n'));
    ok(leaked.length === 0, `and nothing personal in anything they sent ${leaked.length ? JSON.stringify(leaked) : ''}`);
    await p.close();
  }
  for (const kind of Object.keys(FAILURES)) {
    const st = await demoFailure(kind, true);
    checkFailureEvent(kind, st);
    const evs = sentEvents(st).filter((e) => e.tags?.demo_failure === kind);
    const e = evs[0] ?? {};
    ok(evs.length === 1 && e.tags?.trade === 'hvac' && e.tags?.demo_mode === 'outbound' && e.level === FAILURES[kind].level && /^Demo: /.test(msgOf(e) || ''), `${kind}: one Sentry message tagged demo_failure=${kind} (${JSON.stringify({ level: e.level, tags: e.tags, message: msgOf(e) })})`);
    const leaked = leaks(st.envelopes.map((x) => x.url + '\n' + x.body).join('\n'));
    ok(leaked.length === 0, `${kind}: nothing the visitor typed, and no click id, in what Sentry got ${leaked.length ? JSON.stringify(leaked) : ''}`);
    const traced = st.api.filter((r) => Object.keys(r.headers).some((h) => /^(sentry-trace|baggage|traceparent)$/i.test(h)));
    ok(traced.length === 0, `${kind}: no tracing headers on the demo's API calls (${traced.length} of ${st.api.length})`);
  }

  // ---------- [3] ----------
  console.log('[3] switch on, visits that must never send anything');
  const GATES = [
    { name: 'our test visit (?bolt_qa=1), and the next page', paths: ['/hvac.html?bolt_qa=1', '/plumbing.html'], expect: 'qa' },
    { name: 'our test visit (?demoqa=1)', paths: ['/hvac.html?demoqa=1'], expect: 'qa' },
    { name: 'an automated browser (navigator.webdriver)', automated: true, paths: [TALK], expect: 'automated' },
    { name: 'Global Privacy Control', gpc: true, paths: [TALK], expect: 'privacy' },
    { name: 'opted out (?bolt_optout=1), and the next page', paths: ['/hvac.html?bolt_optout=1', '/hvac.html'], expect: 'privacy' },
    { name: 'not the live site (127.0.0.1)', origin: LOCAL, paths: [TALK], expect: 'host' },
  ];
  for (const g of GATES) {
    const p = await open({ automated: g.automated, gpc: g.gpc, origin: g.origin });
    const why = [];
    for (const path of g.paths) {
      await p.nav(path);
      await sleep(1500);
      await p.ev(throwNow());
      await sleep(600);
      why.push(await p.ev('window.boltSentry && window.boltSentry.blockedBy'));
    }
    ok(p.st.sentry.length === 0 && why.every((w) => w === g.expect), `${g.name}: nothing requested from Sentry (${p.st.sentry.length}), blockedBy ${JSON.stringify(why)}`);
    await p.close();
  }
  {
    const p = await open();
    await p.nav('/hvac.html');
    await p.ready();
    await p.ev("document.querySelector('footer a[data-privacy-choices]').click(), 1");
    await until(() => p.ev("!!document.getElementById('pc-switch')"), 3000);
    await p.ev("document.getElementById('pc-switch').click(), document.querySelector('.pc-save').click(), 1");
    await sleep(300);
    const saved = await p.ev("localStorage.getItem('bolt_optout')");
    await p.ev(throwNow());
    await sleep(1500);
    await p.ev("window.__vs = 'hidden', document.dispatchEvent(new Event('visibilitychange')), 1");
    await sleep(1000);
    ok(saved === '1' && p.st.envelopes.length === 0, `switched off in "Your Privacy Choices" during the visit: the next error is not sent (opt-out saved: ${saved}, sent: ${p.st.envelopes.length})`);
    await p.close();
  }

  // ---------- [4] ----------
  console.log('[4] a tampered bundle never runs');
  {
    const p = await open({ tamper: true });
    await p.nav(TALK);
    await sleep(3000);
    await p.ev(throwNow());
    await sleep(800);
    const sri = p.st.logs.filter((t) => /integrity/i.test(t));
    ok(p.st.cdn === 1 && (await p.ev('typeof window.Sentry')) === 'undefined' && p.st.envelopes.length === 0, `requested, refused, nothing sent (window.Sentry ${await p.ev('typeof window.Sentry')}, sent ${p.st.envelopes.length})`);
    ok(sri.length > 0, `the browser refused it on the integrity check (${JSON.stringify((sri[0] || '').slice(0, 110))})`);
    ok((await p.ev('JSON.stringify(window.boltSentry)')) === '{"enabled":false,"blockedBy":"not_loaded"}', `window.boltSentry says it did not load (${await p.ev('JSON.stringify(window.boltSentry)')})`);
    ok((await p.ev("!!document.querySelector('.demo-backdrop.open .demo-choice__get')")) === true, 'the demo still opens');
    const ours = p.st.errors.filter((x) => !x.includes('forced:'));
    ok(ours.length === 0, `no other page errors ${ours.length ? JSON.stringify(ours.slice(0, 2)) : ''}`);
    await p.close();
  }

  // ---------- [5] ----------
  console.log('[5] an error while the bundle is still loading');
  {
    const p = await open({ hold: true });
    await p.nav('/hvac.html');
    await until(async () => !!p.st.releaseBundle, 8000);
    await p.ev(throwNow());
    await sleep(500);
    const before = p.st.envelopes.length;
    if (p.st.releaseBundle) await p.st.releaseBundle();
    await until(async () => sentEvents(p.st).length > 0, 8000);
    await sleep(800);
    const evs = sentEvents(p.st), top = evs[0]?.exception?.values?.at(-1)?.stacktrace?.frames?.at(-1) ?? {};
    ok(before === 0 && evs.length === 1 && /^forced: /.test(excValue(evs[0]) || '') && top.filename === `${SITE}${THROW_PATH}`, `kept, then sent once the bundle loaded (${evs.length} event, ${top.filename}:${top.lineno})`);
    await p.close();
  }

  if (NC) console.log(`\nnegative control ${NC}: mutated ${mutated} served cop${mutated === 1 ? 'y' : 'ies'} of ${MUTATE[NC][0]}`);
  console.log(bad ? `\n${bad} FAILED, ${good} passed${NC ? ` (negative control: ${NC})` : ''}` : `\nALL PASS (${good} checks)${NC ? ` — negative control ${NC} did NOT bite` : ''}`);
  ws.close();
} finally {
  chrome.kill('SIGKILL');
  await sleep(300); rmSync(PROFILE, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
