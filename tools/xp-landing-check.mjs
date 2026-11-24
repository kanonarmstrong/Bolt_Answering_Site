// AFMBP-2612 — the landing A/B on the /start/ pages, in headless Chrome (Android Facebook in-app UA,
// the node's 402px phone width, touch on). Run tools/xp-assign-check.mjs first (no browser).
// While tools/xp/landing_demo_buttons.json is not baked, the pages are also served under /__baked/
// with a test bake (configVersion 7), so the live split can be checked before the owner Starts the
// test; once baked, /__baked/ serves the real bake unchanged.
//   - a control visitor and a treatment visitor (two of the platform's own vectors) each see their
//     card, and the treatment card sits where Figma 2169:14533 puts it, with the owner's words;
//   - the exposure goes to EZ's gateway once per tab session, as the platform's web SDK sends it
//     (eventName experiment_exposed, the visitor's bolt_vid, the arm, the configVersion), and to the
//     funnel as xp_exposed, from the same callback with the same arm; the card's own event follows;
//   - every sign-up link carries xp=<key>.<arm>.<configVersion> next to bvid, a trial tap sends
//     start_trial_clicked to the gateway, on the card and on the home page;
//   - the demo card's two animations (AFMBP-2686), with motion allowed: a cover in the card's own art
//     over the whole card at the start, cut away top to bottom in 1.4s, taking no taps, then gone; the
//     "Available" dot blinking every 1.2s. Set to reduce motion: neither. The sign-up card: neither;
//   - every word on the demo card is the node's drawing (AFMBP-2686, after the owner's Pixel 10a), with its
//     words in hidden text for screen readers: no live text on the card, and where 'Times New Roman'
//     answers with another serif (Android's Noto Serif, simulated) nothing on it moves; while "You call
//     her" waits for its code, demo.js's spinner sits beside the drawn label, not on it;
//   - the demo card's buttons run today's demo: "She calls you" opens the form, "You call her" is a
//     tel: link with the demo line's code before the tap and opens the call card; coming back after
//     the dial is logged (demo_inbound_returned); a tap before demo.js has loaded is carried out;
//     the demo comes as its minified copies (tools/demo-min.mjs, AFMBP-2657), never the sources;
//   - unbaked, a real visitor sees the sign-up card and nothing goes to the gateway;
//   - QA (?bolt_qa=1&bolt_xp=<arm>): the forced card, nothing to the gateway, and every sign-up
//     link on the four surfaces (the card, the home floating Start, the demo recap and the demo
//     limit page) carries the forced arm; a real visitor's ?bolt_xp is ignored; ?bolt_xp leaves the
//     address before any tag reads it;
//   - opted-out (?bolt_optout=1) and Global Privacy Control browsers, neither QA, send the exposure
//     and xp_exposed in both arms, with the Meta Pixel, the Reddit pixel and the Google tag off;
//   - with storage blocked, the exposure's visitor is the visitor the arm was decided for;
//   - nothing that reaches the Meta Pixel, the Reddit pixel or the Google tag carries the
//     experiment. Reddit's pixel reads the page address itself, so no address it reads carries the
//     experiment either (a real visitor's ?bolt_xp is stripped first), and QA visitors, whose address
//     carries the forced arm, don't load the Reddit pixel at all (AFMBP-2652).
// The ingest, the gateway, the demo API and the Meta Pixel are stubbed in the page. The Reddit
// pixel's base code runs as served and each of its calls is recorded; its pixel.js never loads
// (Reddit's host doesn't resolve). Nothing reaches production; Chrome resolves no host but 127.0.0.1.
// Run: node tools/xp-landing-check.mjs [siteRoot]
//      NC=<name> node tools/xp-landing-check.mjs   — one negative control (see MUTATE); each must FAIL.
//      A control on a demo source (demo.js) is served in its minified copy's place, so it still
//      reaches the page.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = resolve(process.argv[2] || '.');
const NC = process.env.NC || '';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const UA = 'Mozilla/5.0 (Linux; Android 14; SM-A146U; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/490.0.0.49.79;]';
const KEY = 'landing_demo_buttons';
const DEF = JSON.parse(readFileSync(join(ROOT, 'tools/xp/landing_demo_buttons.json'), 'utf8'));
const CV = DEF.baked ? DEF.configVersion : 7;   // the test bake's configVersion
const QA_CV = DEF.configVersion;                // what the real pages carry (1 = the unbaked placeholder)
// Two of the platform's own vectors for this key and seed (tools/xp/landing_demo_buttons.vectors.json).
const VID = { control: '0b7f6c2e-5d1a-4c3b-9e8f-1a2b3c4d5e6f', treatment: 'deadbeef-0000-4111-8222-333344445555' };
const PAGE = 'start/handyman.html';

// Negative controls: break the served copy one way each; the run must then fail.
const MUTATE = {
  qa_gateway: ['attribution.js', (s) => s.replace('  function xpSend(name, type, ctx, props) {\n    if (isQa()) return;\n', '  function xpSend(name, type, ctx, props) {\n')],
  optout: ['attribution.js', (s) => s.replace('  function xpExpose() {\n    var c = xpPage();\n', "  function xpExpose() {\n    if (get('bolt_optout') === '1') return null;\n    var c = xpPage();\n")],
  decorate: ['attribution.js', (s) => s.replace("      if (xc) u.searchParams.set('xp', xpString(xc));\n", '      if (xc) void 0;\n')],
  vid: ['attribution.js', (s) => s.replace("memoryVid = x && typeof x.vid === 'string' && ID_RE.test(x.vid) ? x.vid : newId();", 'memoryVid = newId();')],
  once: ['attribution.js', (s) => s.replace("    if (get('bolt_xp_sent', 'session') === mark) return c;\n", '')],
  once_vid: ['attribution.js', (s) => s.replace("mark = visitorId() + ' ' + s;", 'mark = s;')],
  trial: ['attribution.js', (s) => s.replace("        if (xc) xpSend('start_trial_clicked', 'track', xc, { from: String(data.from || data.placement || 'site') });\n", '')],
  same_arm: ['attribution.js', (s) => s.replace("    var p = { experiment_key: c.experimentKey, variation: c.variation,", "    var p = { experiment_key: c.experimentKey, variation: c.variation === 'control' ? 'treatment' : 'control',")],
  returned: ['demo.js', (s) => s.replace("      track('demo_inbound_returned', ", "      void ('demo_inbound_returned', ")],
  arm_call: ['demo.js', (s) => s.replace("        a.setAttribute('href', s.telUri);\n        // A code is offered", '        // A code is offered')],
  pending: ['start', (s) => s.replace("window.__boltDemoPending = b.getAttribute('data-demo-landing');\n", '')],
  full_demo: ['start', (s) => s.replace("'/demo.min.js?v=", "'/demo.js?v=")],
  strip: ['start', (s) => s.replace('          w.history.replaceState(', '          void (')],
  geometry: ['start', (s) => s.replace('.qlt-call{left:82.333px;top:409.333px;', '.qlt-call{left:82.333px;top:413.333px;')],
  copy: ['start', (s) => s.replace('takes messages, and books customers', 'books customers, takes messages')],
  ways: ['start', (s) => s.replace("url('/assets/xp-ld-two-ways-box.svg')", "url('/assets/xp-ld-rating.svg')")],
  // AFMBP-2686: the demo card's two animations.
  wipe_art: ['start', (s) => s.replace('background:inherit;border-radius:inherit;box-shadow:inherit;', 'background:#f0e0d5;border-radius:inherit;box-shadow:inherit;')],
  wipe_stays: ['start', (s) => s.replace('to{-webkit-clip-path:inset(100% 0 0 0);clip-path:inset(100% 0 0 0)}', 'to{-webkit-clip-path:inset(0 0 0 0);clip-path:inset(0 0 0 0)}')],
  blink: ['start', (s) => s.replace('.qlt-dot{animation:qlt-blink 1.2s ease-in-out infinite}', '')],
  motion: ['start', (s) => s.replace('@media (prefers-reduced-motion:no-preference){', '@media all{')],
  // AFMBP-2686 (owner, 11-22): every word on the demo card a drawing; the spinner beside the drawn label.
  live_words: ['start', (s) => s.replace('<p class="qlt-live"><span class="ql-vh">Available</span></p>', '<p class="qlt-live"><span>Available</span></p>')],
  drawings: ['start', (s) => s.replace("url('/assets/xp-ld-meet-sierra.svg')", "url('/assets/xp-ld-rating.svg')")],
  spinner: ['start', (s) => s.replace('.qlt-call .demo-spinner{position:absolute;left:27px;top:0;bottom:0;margin:auto 0}', '')],
  pixel: ['meta-pixel.js', (s) => s.replace("    if (d.event === 'demo_opened') {", "    if (d.event === 'xp_exposed') window.fbq('trackCustom', 'Xp', data);\n    if (d.event === 'demo_opened') {")],
  reddit: ['reddit-pixel.js', (s) => s.replace("    if (d.event === 'trial_link_clicked' || d.event === 'demo_trial_clicked') {", "    if (d.event === 'xp_exposed') window.rdt('track', 'Custom', { customEventName: 'Xp', props: d.data });\n    if (d.event === 'trial_link_clicked' || d.event === 'demo_trial_clicked') {")],
  reddit_qa: ['reddit-pixel.js', (s) => s.replace("    if (qa && get('bolt_pixel_debug', 'session') !== '1') return 'qa';\n", '')],
  reddit_optout: ['reddit-pixel.js', (s) => s.replace("    if (get('bolt_optout') === '1') return 'opted_out';\n", '')],
};
// AFMBP-2657: the pages load these copies of the demo's files.
const MIN_OF = { 'demo.min.js': 'demo.js', 'demo-format.min.js': 'demo-format.js', 'demo.min.css': 'demo.css' };
if (NC && !MUTATE[NC]) { console.error(`unknown NC=${NC}; one of ${Object.keys(MUTATE).join(', ')}`); process.exit(2); }

// AFMBP-2686: Android has no Times New Roman but answers to the name with its own serif (Noto Serif: wider
// letters, taller lines). Simulated: 'Times New Roman' becomes a wide serif (Georgia) with Noto Serif's line box.
const ANDROID_SERIF = `(() => { const st = document.createElement('style'); st.textContent = "@font-face{font-family:'Times New Roman';font-weight:400;src:local('Georgia');ascent-override:106.9%;descent-override:29.3%;line-gap-override:0%}@font-face{font-family:'Times New Roman';font-weight:700;src:local('Georgia Bold');ascent-override:106.9%;descent-override:29.3%;line-gap-override:0%}"; const add = () => document.head.appendChild(st); if (document.head) add(); else document.addEventListener('DOMContentLoaded', add); })()`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hold = { demoMs: 0 };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain' };
const server = createServer(async (req, res) => {
  let path = decodeURIComponent(req.url.split('?')[0]);
  if (path === '/__control/hold') { hold.demoMs = Number(new URL(req.url, 'http://x').searchParams.get('ms')) || 0; res.writeHead(204); return res.end(); }
  let baked = false;
  if (path.startsWith('/__baked/')) { baked = true; path = path.slice('/__baked'.length); }
  const file = join(ROOT, path.endsWith('/') ? `${path}index.html` : path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end(); }
  const raw = readFileSync(file);
  const rel = file.slice(ROOT.length + 1);
  let text = null;
  if (baked && rel.startsWith('start/') && !DEF.baked) {
    const s = raw.toString('utf8'); const t = s.replace('"configVersion":1,"baked":false}', `"configVersion":${CV},"baked":true}`);
    if (t === s) { console.error(`the test bake did not land in ${rel}`); process.exit(2); }
    text = t;
  }
  // AFMBP-2654: this checks what reddit-pixel.js does, not whether the live pixel ID is switched on
  // today, so the served copy carries a test ID (as in reddit-pixel-check.mjs).
  if (rel === 'reddit-pixel.js') {
    const s = text ?? raw.toString('utf8'); const ID_LINE = /var PIXEL_ID = '[A-Za-z0-9_]*';/;
    if ((s.match(new RegExp(ID_LINE.source, 'g')) || []).length !== 1) { console.error('reddit-pixel.js must carry exactly one PIXEL_ID line'); process.exit(2); }
    text = s.replace(ID_LINE, "var PIXEL_ID = 't2_testpixel0001';");
  }
  if (NC) {
    const [target, fn] = MUTATE[NC];
    const source = MIN_OF[rel] === target ? readFileSync(join(ROOT, target), 'utf8') : null;
    if (target === rel || source !== null || (target === 'start' && rel.startsWith('start/'))) {
      const s = source ?? text ?? raw.toString('utf8'); const t = fn(s);
      if (t === s) { console.error(`NC=${NC}: the mutation did not land in ${rel}`); process.exit(2); }
      text = t;
    }
  }
  if ((rel === 'demo.min.js' || rel === 'demo.js') && hold.demoMs) await sleep(hold.demoMs);
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(text ?? raw);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// In-page stubs, before any script: the ingest, the gateway and the demo API are answered here and
// recorded; the Meta Pixel's calls are recorded (meta-pixel.js finds window.fbq and loads nothing),
// and so are the Reddit pixel's, each with the page address it was made on.
const STUB = `(() => {
  window.__events = []; window.__gw = []; window.__fbq = []; window.__api = [];
  window.fbq = function () { window.__fbq.push([].slice.call(arguments)); };
  // reddit-pixel.js's base code defines window.rdt: the setter wraps it so each call is recorded with
  // the page address at that moment (Reddit's pixel.js sends the address itself). pixel.js never
  // loads here (Reddit's host doesn't resolve), so the calls also stay in the base code's queue.
  window.__rdt = [];
  let rdtFn;
  Object.defineProperty(window, 'rdt', { configurable: true, get: () => rdtFn, set: (v) => {
    rdtFn = typeof v !== 'function' ? v : function () { window.__rdt.push({ args: [].slice.call(arguments), href: location.href }); return v.apply(this, arguments); };
  } });
  const real = window.fetch.bind(window);
  const json = (o, status) => Promise.resolve(new Response(JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json' } }));
  window.fetch = (url, opts) => {
    const u = String(url && url.url || url), method = (opts && opts.method) || 'GET';
    if (u.includes('/api/public/analytics/events')) {
      try { const b = JSON.parse(opts && opts.body || '{}'); for (const e of (b.events || [b])) window.__events.push({ type: e.event_type, sid: e.session_id, data: e.event_data || {} }); } catch (e) {}
      return json({});
    }
    if (u === 'https://bolt-staging.fly.dev/api/public/experiments/v1/events') {
      try { window.__gw.push({ body: JSON.parse(opts.body), keepalive: !!opts.keepalive, ct: (opts.headers || {})['Content-Type'] }); } catch (e) { window.__gw.push({ bad: true }); }
      return json({ accepted: true }, 202);
    }
    if (u === 'https://bolt-staging.fly.dev/api/demo/inbound/session' && method === 'POST') {
      window.__api.push({ u, body: JSON.parse(opts.body || '{}') });
      return json({ sessionId: 's-test', code: '1234', telUri: 'tel:+18554973151,,1234', number: '+18554973151', numberDisplay: '(855) 497-3151', expiresAt: new Date(Date.now() + 600000).toISOString() });
    }
    if (u.startsWith('https://bolt-staging.fly.dev/api/demo/inbound/session/')) return json({ state: 'waiting' });
    if (u.startsWith('https://bolt-staging.fly.dev/') || u.startsWith('https://app.boltanswering.com/')) { window.__api.push({ u }); return json({}, 404); }
    return real(url, opts);
  };
  // A tel: link the page lets through is a dial; it must not leave the page here (the dialer's half
  // of a tap is the phone's). Last listener of all, so it sees what the page's own handlers did.
  window.addEventListener('click', (e) => { const a = e.target && e.target.closest && e.target.closest('a[href^="tel:"]'); if (a && !e.defaultPrevented) { window.__dialed = a.getAttribute('href'); e.preventDefault(); } });
})()`;

const results = [];
const check = (name, ok, info) => { results.push({ name, ok: !!ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok || info === undefined ? '' : ' ' + JSON.stringify(info)}`); };
const near = (a, b, tol = 1) => typeof a === 'number' && Math.abs(a - b) <= tol;
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Words that would mean the experiment reached Meta, Reddit or Google.
const LEAK = /landing_demo_buttons|xp_exposed|config_?version|bolt_xp|experiment/i;

const prof = mkdtempSync(join(tmpdir(), 'xp-check-'));
const port = 9600 + Math.floor(Math.random() * 300);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--no-first-run', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
let ws;
try {
  let wsUrl;
  // Up to 45 s: a busy machine can take 10+ s to start Chrome.
  for (let i = 0; i < 450 && !wsUrl; i++) { try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch {} if (!wsUrl) await sleep(100); }
  if (!wsUrl) { console.error('Chrome did not start (no DevTools page in 45 s)'); process.exit(3); }
  ws = new WebSocket(wsUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(`page threw: ${JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text)}`); return r.result.value; };
  const until = async (e, ms = 5000) => { for (let t = 0; t < ms; t += 100) { if (await ev(e).catch(() => false)) return true; await sleep(100); } return false; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.setUserAgentOverride', { userAgent: UA });
  const phone = async () => { await send('Emulation.setDeviceMetricsOverride', { width: 402, height: 749, deviceScaleFactor: 1, mobile: true }); await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); };
  const computer = async () => { await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }); await send('Emulation.setTouchEmulationEnabled', { enabled: false }); };
  await phone();
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
  const load = async (url) => { await send('Page.navigate', { url }); for (let i = 0; i < 100; i++) { if (await ev(`document.readyState === 'complete'`).catch(() => false)) break; await sleep(100); } await sleep(600); };
  // A new visitor (both storages emptied), with the given bolt_vid stored first.
  const visit = async (path, { vid = null } = {}) => {
    await load(`${BASE}/robots.txt`);
    await ev(`(() => { try { localStorage.clear(); } catch (e) {} try { sessionStorage.clear(); } catch (e) {} return true; })()`);
    if (vid) await ev(`localStorage.setItem('bolt_vid', ${JSON.stringify(vid)})`);
    await load(`${BASE}${path}`);
  };
  const state = () => ev(`({ events: window.__events, gw: window.__gw.map((g) => g.body ? Object.assign({ _keepalive: g.keepalive, _ct: g.ct }, g.body) : g), fbq: window.__fbq, rdt: window.__rdt, reddit: window.boltReddit || null, api: window.__api, dl: JSON.stringify(window.dataLayer || []), gtagScript: !!document.querySelector('script[src*="googletagmanager"]'), href: location.href, xp: window.boltXp, cls: document.documentElement.className })`);
  const typesOf = (s, t) => s.events.filter((e) => e.type === t);
  const exposures = (s) => s.gw.filter((g) => g.eventType === 'exposure');
  const tracks = (s) => s.gw.filter((g) => g.eventType === 'track');
  const ctx = (arm, cv = CV) => [{ experimentKey: KEY, variation: arm, configVersion: cv }];
  const xpParam = (href) => { try { return new URL(href).searchParams.get('xp'); } catch { return null; } };
  const bvidParam = (href) => { try { return new URL(href).searchParams.get('bvid'); } catch { return null; } };
  const noLeak = async (label) => {
    const s = await state();
    check(`${label}: nothing to the Meta Pixel names the experiment`, !LEAK.test(JSON.stringify(s.fbq)), s.fbq);
    check(`${label}: nothing to the Google tag names the experiment, and the address carries no bolt_xp`, !LEAK.test(s.dl) && !/[?&]bolt_xp=/.test(s.href), { dl: s.dl.slice(0, 200), href: s.href });
    // Not vacuous: the Reddit pixel must have run here (init + PageVisit); then nothing it got, and no
    // page address it was called on, may name the experiment.
    const rdtRan = s.rdt.some((c) => c.args[0] === 'init') && s.rdt.some((c) => c.args[0] === 'track' && c.args[1] === 'PageVisit');
    check(`${label}: the Reddit pixel ran; nothing it got names the experiment, nor any address it read`, rdtRan && !LEAK.test(JSON.stringify(s.rdt.map((c) => c.args))) && s.rdt.every((c) => !LEAK.test(c.href) && !/[?&]xp=/.test(c.href)), s.rdt);
  };
  // Tap a sign-up link without leaving the page: attribution.js decorates it in the capture phase,
  // then this listener reads the decorated address and stops the navigation.
  const tapSignup = (sel) => ev(`(() => { const a = document.querySelector(${JSON.stringify(sel)}); if (!a) return null; let href = null;
    const f = (e) => { href = e.target.closest('a').href; e.preventDefault(); }; document.addEventListener('click', f); a.click(); document.removeEventListener('click', f); return href; })()`);

  // ---------- 1. a control visitor (baked) ----------
  console.log(`[control visitor, baked (configVersion ${CV})]`);
  await visit(`/__baked/${PAGE}?utm_source=fb&fbclid=XPCHECK1`, { vid: VID.control });
  let s = await state();
  const disp = () => ev(`({ c: getComputedStyle(document.querySelector('.ql-card--c')).display, t: getComputedStyle(document.querySelector('.ql-card--t')).display })`);
  let d = await disp();
  check('the sign-up card shows, the demo card is hidden', d.c !== 'none' && d.t === 'none' && !s.cls.includes('xp-t'), d);
  check('window.boltXp: control, not forced, this visitor', s.xp && s.xp.variation === 'control' && s.xp.forced === false && s.xp.vid === VID.control && s.xp.configVersion === CV, s.xp);
  let ex = exposures(s);
  check('one exposure to the gateway', ex.length === 1, s.gw);
  const e0 = ex[0] || {};
  check('exposure: experiment_exposed / exposure / web, sdkVersion bolt-site-1', e0.eventName === 'experiment_exposed' && e0.eventType === 'exposure' && e0.platform === 'web' && e0.sdkVersion === 'bolt-site-1', e0);
  check('exposure: anonymousId is the visitor\'s bolt_vid', e0.anonymousId === VID.control, e0.anonymousId);
  check('exposure: experiments = [{landing_demo_buttons, control, configVersion}]', JSON.stringify(e0.experiments) === JSON.stringify(ctx('control')), e0.experiments);
  check('exposure: eventId a v4 UUID, a session id, properties {}', UUID4.test(e0.eventId || '') && typeof e0.sessionId === 'string' && e0.sessionId.length > 0 && e0.sessionId.length <= 200 && JSON.stringify(e0.properties) === '{}', e0);
  check('exposure: url is the page\'s origin and path only (no query)', e0.url === `${BASE}/__baked/${PAGE}`, e0.url);
  check('exposure: timestamp is now (ISO)', Math.abs(Date.parse(e0.timestamp) - Date.now()) < 60000, e0.timestamp);
  check('exposure: JSON with keepalive, no key from the browser', e0._keepalive === true && e0._ct === 'application/json' && !('userId' in e0) && !JSON.stringify(e0).includes('apiKey'), e0);
  let xe = typesOf(s, 'xp_exposed');
  check('funnel: one xp_exposed {landing_demo_buttons, control, configVersion}, with the browser class', xe.length === 1 && xe[0].data.experiment_key === KEY && xe[0].data.variation === 'control' && xe[0].data.config_version === CV && xe[0].data.browser === 'android_facebook' && !('forced' in xe[0].data), xe);
  check('funnel: the card\'s own event, signup_offer_opened, once', typesOf(s, 'signup_offer_opened').length === 1 && typesOf(s, 'demo_card_opened').length === 0, s.events.map((e) => e.type));
  let href = await ev(`document.querySelector('.ql-cta').href`);
  check(`the card's button carries xp=${KEY}.control.${CV} next to bvid`, xpParam(href) === `${KEY}.control.${CV}` && bvidParam(href) === VID.control, href);
  const tapped = await tapSignup('.ql-cta');
  await sleep(300);
  s = await state();
  let tr = tracks(s);
  check('a trial tap: start_trial_clicked to the gateway with the arm', tr.length === 1 && tr[0].eventName === 'start_trial_clicked' && JSON.stringify(tr[0].experiments) === JSON.stringify(ctx('control')) && tr[0].anonymousId === VID.control && tr[0].properties.from === 'signup_offer', tr);
  check('the tapped link carried the arm', xpParam(tapped) === `${KEY}.control.${CV}`, tapped);
  await noLeak('control visitor');
  await load(`${BASE}/__baked/${PAGE}`);
  s = await state();
  check('a reload in the same tab: no second exposure, no second xp_exposed', exposures(s).length === 0 && typesOf(s, 'xp_exposed').length === 0, { gw: s.gw.length, xe: typesOf(s, 'xp_exposed').length });

  // ---------- 2. a treatment visitor (baked) ----------
  console.log('[treatment visitor, baked]');
  await visit(`/__baked/${PAGE}`, { vid: VID.treatment });
  s = await state();
  d = await disp();
  check('the demo card shows (html.xp-t), the sign-up card is hidden', d.t !== 'none' && d.c === 'none' && s.cls.includes('xp-t'), d);
  const g = await ev(`(() => { const r = (q) => { const e = document.querySelector(q); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width, h: b.height }; };
    const tx = (q) => { const e = document.querySelector(q); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; };
    const bg = (q, p) => { const e = document.querySelector(q); return e ? getComputedStyle(e, p || null).backgroundImage : null; };
    const live = [], w = document.createTreeWalker(document.querySelector('.ql-card--t'), NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) if (n.nodeValue.trim() && !n.parentElement.closest('.ql-vh')) live.push(n.nodeValue.trim());
    return { card: r('.ql-card--t'), sub: r('.qlt-sub'), ways: r('.qlt-ways'), call: r('.qlt-call'), get: r('.qlt-get'), close: r('.qlt-close'), dot: r('.qlt-dot'), avail: r('.qlt-live'), rating: r('.qlt-bubble'),
      draw: { sub: bg('.qlt-sub'), ways: bg('.qlt-ways'), avail: bg('.qlt-live'), call: bg('.qlt-call'), get: bg('.qlt-get'), rating: bg('.qlt-bubble'), close: bg('.qlt-close', '::before') },
      subT: tx('.qlt-sub'), liveT: tx('.qlt-live'), waysT: tx('.qlt-ways'), callT: tx('.qlt-call'), getT: tx('.qlt-get'), wait: !!document.querySelector('.qlt-wait'),
      ratingT: [].map.call(document.querySelectorAll('.qlt-bubble .ql-vh'), (e) => e.textContent), live,
      closeHref: document.querySelector('.qlt-close').getAttribute('href'), h1: tx('#qlt-h') }; })()`);
  // AFMBP-2685 (owner, 11-21): the node's redesign, 375x702.151 with a .667px border; the numbers are the
  // node's inside the border, on the page at the node's 402px width (card at 14,32).
  // AFMBP-2686 (owner, 11-22): the node's latest edits, measured against its render.
  check('card at 14,32, 375x702.2 (Figma 2169:14533)', g.card && near(g.card.l, 14) && near(g.card.t, 32) && near(g.card.w, 375) && near(g.card.h, 702.151), g.card);
  check('the receptionist line is the node\'s vector, 333.7x91 at 36.7,262.2 (2281:21114)', g.sub && near(g.sub.l, 36.707, 0.5) && near(g.sub.t, 262.231, 0.5) && near(g.sub.w, 333.721, 0.5) && near(g.sub.h, 91.048, 0.5), g.sub);
  const inside = (a, b) => !!a && !!b && a.l >= b.l && a.t >= b.t && a.l + a.w <= b.l + b.w && a.t + a.h <= b.t + b.h;
  check('"Two ways to talk to Sierra now" is the node\'s frame, 295x191 at 53.7,371.9, with "Available" and both buttons inside it (2269:21112)', g.ways && near(g.ways.l, 53.667) && near(g.ways.t, 371.917) && near(g.ways.w, 295) && near(g.ways.h, 191) && /\/assets\/xp-ld-two-ways-box\.svg/.test(g.draw.ways)
    && inside(g.dot, g.ways) && inside(g.avail, g.ways) && inside(g.call, g.ways) && inside(g.get, g.ways), { ways: g.ways, bg: g.draw.ways });
  check('"You call her" 209x41 at 97,442 (2171:14604)', g.call && near(g.call.l, 97) && near(g.call.t, 442) && near(g.call.w, 209) && near(g.call.h, 41), g.call);
  check('"She calls you" 210x41 at 97,498 (2171:14606)', g.get && near(g.get.l, 97) && near(g.get.t, 498) && near(g.get.w, 210) && near(g.get.h, 41), g.get);
  check('close: a 44px target centred on the node\'s cross (364, 68.2)', g.close && near(g.close.l + 22, 363.958) && near(g.close.t + 22, 68.16) && g.close.w === 44, g.close);
  check('"Available" in the frame\'s top right: the dot, 8.3px at 269,386 (2171:14616), and the word\'s vector, 44.1x8.2 at 282.3,386 (2281:21124)', g.dot && near(g.dot.l, 269) && near(g.dot.t, 386) && near(g.dot.w, 8.327, 0.2)
    && g.avail && near(g.avail.l, 282.34) && near(g.avail.t, 385.968) && near(g.avail.w, 44.051, 0.2) && near(g.avail.h, 8.169, 0.2), { dot: g.dot, avail: g.avail });
  check('the rating is the node\'s vector turned 3.17deg, within 0.5px of the node\'s bounds: 315.5x129.6 at 45,582 (2169:14534)', g.rating && near(g.rating.l, 45, 0.5) && near(g.rating.t, 582, 0.5) && near(g.rating.w, 315.479, 0.5) && near(g.rating.h, 129.57, 0.5), g.rating);
  check('every word on the card is a drawing, from the node\'s own files: no live text on it (owner\'s Pixel 10a)', g.live.length === 0
    && /\/assets\/xp-ld-meet-sierra\.svg/.test(g.draw.sub) && /\/assets\/xp-ld-available\.svg/.test(g.draw.avail) && /\/assets\/xp-ld-you-call-her\.svg/.test(g.draw.call)
    && /\/assets\/xp-ld-she-calls-you\.svg/.test(g.draw.get) && /\/assets\/xp-ld-rating\.svg/.test(g.draw.rating) && /\/assets\/xp-ld-close\.svg/.test(g.draw.close), { live: g.live, draw: g.draw });
  const files = await ev(`Promise.all(['meet-sierra', 'two-ways-box', 'available', 'dot', 'you-call-her', 'she-calls-you', 'rating', 'close'].map((n) => fetch('/assets/xp-ld-' + n + '.svg').then((x) => x.status + ' ' + x.headers.get('content-type'))))`);
  check('the drawings are all there: each file 200, image/svg+xml', files.length === 8 && files.every((x) => x === '200 image/svg+xml'), files);
  check('the owner\'s words, verbatim, for screen readers, and no wait line (the node dropped it)', g.subT === 'Meet Sierra, your new personal receptionist. She answers calls, takes messages, and books customers when you can’t for less than $4/day.'
    && g.liveT === 'Available' && g.waysT === 'Two ways to talk to Sierra now' && g.callT === 'You call her' && g.getT === 'She calls you' && !g.wait
    && JSON.stringify(g.ratingT) === JSON.stringify(['Brent B. Indiana', '4.9/5', '“Bolt booked a job and paid for itself in a day.”']), g);
  check('the close goes home; the headline for screen readers', g.closeHref === '/' && g.h1 === 'New jobs are calling', g);
  ex = exposures(s);
  check('one exposure: treatment, this visitor', ex.length === 1 && JSON.stringify(ex[0].experiments) === JSON.stringify(ctx('treatment')) && ex[0].anonymousId === VID.treatment, s.gw);
  xe = typesOf(s, 'xp_exposed');
  check('funnel: one xp_exposed, treatment (the same arm as the exposure)', xe.length === 1 && xe[0].data.variation === 'treatment' && xe[0].data.config_version === CV, xe);
  const dco = typesOf(s, 'demo_card_opened');
  check('funnel: demo_card_opened {trigger quick_landing, trade handyman} once, no signup_offer_opened', dco.length === 1 && dco[0].data.trigger === 'quick_landing' && dco[0].data.trade === 'handyman' && typesOf(s, 'signup_offer_opened').length === 0, s.events.map((e) => e.type));
  check('demo.js and demo.css load after the card has painted', await until(`!!(window.boltDemo && window.boltDemo.ready) && !!document.querySelector('link[rel=stylesheet][href^="/demo.min.css"]')`));
  const demoFiles = await ev(`performance.getEntriesByType('resource').map((r) => new URL(r.name).pathname).filter((p) => /^\\/demo[.-]/.test(p))`);
  check('the demo comes minified: demo.min.css, demo-format.min.js and demo.min.js, none of the sources', ['/demo.min.css', '/demo-format.min.js', '/demo.min.js'].every((f) => demoFiles.includes(f)) && !demoFiles.some((f) => !/\.min\.(js|css)$/.test(f)), demoFiles);
  check('"You call her" is the demo line\'s tel: link (with the code) before any tap', await until(`document.querySelector('.qlt-call').getAttribute('href') === 'tel:+18554973151,,1234'`), await ev(`document.querySelector('.qlt-call').getAttribute('href')`));
  s = await state();
  const sess = s.api.filter((a) => a.u === 'https://bolt-staging.fly.dev/api/demo/inbound/session');
  check('one demo-line code, for this trade and this visitor', sess.length === 1 && sess[0].body.trade === 'handyman' && sess[0].body.sessionId === VID.treatment && sess[0].body.voice === 'Sofía', sess);
  // "She calls you": the form.
  await ev(`document.querySelector('.qlt-get').click()`);
  await sleep(400);
  let m = await ev(`(() => { const b = document.querySelector('.demo-backdrop'); return { open: !!(b && b.classList.contains('open')), screen: b && b.getAttribute('data-screen'), h: (document.querySelector('.demo-h--form') || {}).textContent }; })()`);
  check('"She calls you" opens today\'s "We call you" form', m.open && m.screen === 'phone' && /What number to call\?/.test(m.h || ''), m);
  s = await state();
  check('funnel: demo_opened {trigger button, entry landing}, then demo_mode_selected {outbound, from landing}', typesOf(s, 'demo_opened').some((e) => e.data.trigger === 'button' && e.data.entry === 'landing') && typesOf(s, 'demo_mode_selected').some((e) => e.data.mode === 'outbound' && e.data.from === 'landing'), s.events.map((e) => [e.type, e.data.entry || e.data.mode || '']));
  await ev(`document.querySelector('.demo-close').click()`);
  await sleep(300);
  // "You call her": the dial, then the call card.
  await ev(`document.querySelector('.qlt-call').click()`);
  await sleep(400);
  m = await ev(`(() => { const b = document.querySelector('.demo-backdrop'); return { open: !!(b && b.classList.contains('open')), screen: b && b.getAttribute('data-screen'), code: (document.querySelector('.demo-ihow__code') || {}).textContent, tel: (document.querySelector('a.demo-ihow__tel') || {}).textContent, dialed: window.__dialed }; })()`);
  check('"You call her" dials the line with the code (the tap\'s own tel: link)', m.dialed === 'tel:+18554973151,,1234', m);
  check('then the call card shows the number and the code', m.open && m.screen === 'inbound-call' && m.code === '1234' && m.tel === '(855) 497-3151', m);
  s = await state();
  check('funnel: demo_mode_selected {inbound, dial auto, from landing} and demo_inbound_call_tapped {from landing}', typesOf(s, 'demo_mode_selected').some((e) => e.data.mode === 'inbound' && e.data.dial === 'auto' && e.data.from === 'landing') && typesOf(s, 'demo_inbound_call_tapped').some((e) => e.data.from === 'landing'), s.events.map((e) => [e.type, e.data.mode || e.data.from || '']));
  await ev(`(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); })()`);
  await sleep(250);
  await ev(`(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); })()`);
  await sleep(300);
  s = await state();
  const back = typesOf(s, 'demo_inbound_returned');
  check('back on the page after the dial: demo_inbound_returned once {inbound, not connected, away_ms}', back.length === 1 && back[0].data.mode === 'inbound' && back[0].data.connected === false && back[0].data.away_ms >= 200, back);
  check('the visitor\'s visits so far carried no QA flag', s.events.every((e) => !e.data.qa));
  await noLeak('treatment visitor');
  // The home page's floating Start (the card's x), for a real visitor: the kept arm, and a trial tap.
  await load(`${BASE}/`);
  href = await ev(`(document.querySelector('a.floating-cta') || {}).href`);
  check(`home page, floating Start: xp=${KEY}.treatment.${CV} (kept from the exposure)`, xpParam(href) === `${KEY}.treatment.${CV}` && bvidParam(href) === VID.treatment, href);
  await tapSignup('a.floating-cta');
  await sleep(300);
  s = await state();
  check('home page: no exposure; a trial tap sends start_trial_clicked with the kept arm', exposures(s).length === 0 && tracks(s).length === 1 && JSON.stringify(tracks(s)[0].experiments) === JSON.stringify(ctx('treatment')) && tracks(s)[0].properties.from === 'floating', s.gw);

  // ---------- 3. a tap before demo.js has loaded ----------
  console.log('[a tap before demo.js]');
  await fetch(`${BASE}/__control/hold?ms=2500`);
  await visit(`/__baked/${PAGE}`, { vid: VID.treatment });
  const early = await ev(`!(window.boltDemo)`);
  await ev(`document.querySelector('.qlt-get').click()`);
  const opened = await until(`!!document.querySelector('.demo-backdrop.open') && document.querySelector('.demo-backdrop').getAttribute('data-screen') === 'phone'`, 6000);
  await fetch(`${BASE}/__control/hold?ms=0`);
  check('a "She calls you" tap before demo.js arrives opens the form once it has', early && opened, { early, opened });
  // "You call her" too: the tap waits for demo.js, then for its code, and meanwhile demo.js puts its spinner in
  // the button. The label is part of the button's drawing, so nothing moves aside: the spinner must sit left of it.
  await fetch(`${BASE}/__control/hold?ms=2500`);
  await visit(`/__baked/${PAGE}`, { vid: VID.treatment });
  await ev(`(() => { const a = document.querySelector('.qlt-call'); window.__sp = null;
    new MutationObserver(() => { const sp = a.querySelector('.demo-spinner'); if (sp && !window.__sp) { const b = a.getBoundingClientRect(), r = sp.getBoundingClientRect(); window.__sp = { l: r.left - b.left, r: r.right - b.left, t: r.top - b.top, b: r.bottom - b.top, w: r.width }; } }).observe(a, { childList: true });
    a.click(); return true; })()`);
  const called = await until(`!!document.querySelector('.demo-backdrop.open')`, 6000);
  await fetch(`${BASE}/__control/hold?ms=0`);
  const sp = await ev('window.__sp');
  check('a "You call her" tap before demo.js arrives: while its code comes, the spinner sits left of the drawn label, not on it', called && !!sp && sp.w >= 12 && sp.l >= 4 && sp.r <= 51 && Math.abs((sp.t + sp.b) / 2 - 20.5) <= 1.5, { called, sp });

  // ---------- 4. unbaked: the real pages before Start ----------
  if (!DEF.baked) {
    console.log('[unbaked: the pages as committed, a real visitor]');
    await visit(`/${PAGE}`, { vid: VID.treatment });
    s = await state();
    d = await disp();
    check('a treatment-vector visitor sees the sign-up card; no arm', d.c !== 'none' && d.t === 'none' && s.xp && s.xp.variation === null, { d, xp: s.xp });
    check('nothing to the gateway, no xp_exposed', s.gw.length === 0 && typesOf(s, 'xp_exposed').length === 0, s.gw);
    href = await ev(`document.querySelector('.ql-cta').href`);
    check('the button carries no xp', xpParam(href) === null && bvidParam(href) === VID.treatment, href);
    check('the card\'s own event still goes: signup_offer_opened', typesOf(s, 'signup_offer_opened').length === 1);
  }

  // ---------- 5. QA, forced arms: the four surfaces ----------
  for (const arm of ['treatment', 'control']) {
    console.log(`[QA ?bolt_xp=${arm} (the pages as committed): the four surfaces]`);
    await visit(`/${PAGE}?bolt_qa=1&bolt_xp=${arm}&demoqa=1&utm_source=fb`);
    s = await state();
    d = await disp();
    check(`the ${arm === 'treatment' ? 'demo' : 'sign-up'} card shows; forced`, (arm === 'treatment' ? d.t !== 'none' && d.c === 'none' : d.c !== 'none' && d.t === 'none') && s.xp.forced === true && s.xp.variation === arm, { d, xp: s.xp });
    check('?bolt_xp is out of the address; the rest stays', !/bolt_xp/.test(s.href) && /bolt_qa=1/.test(s.href) && /utm_source=fb/.test(s.href), s.href);
    check('QA: the Reddit pixel doesn\'t load (this address carried the forced arm)', !!s.reddit && s.reddit.blockedBy === 'qa' && s.rdt.length === 0, { reddit: s.reddit, rdt: s.rdt });
    check('QA: nothing to the gateway', s.gw.length === 0, s.gw);
    xe = typesOf(s, 'xp_exposed');
    check('QA: xp_exposed for the funnel, marked qa and forced', xe.length === 1 && xe[0].data.qa === true && xe[0].data.forced === true && xe[0].data.variation === arm && xe[0].data.config_version === QA_CV, xe);
    const want = `${KEY}.${arm}.${QA_CV}`;
    if (arm === 'control') {
      href = await ev(`document.querySelector('.ql-cta').href`);
      check(`surface 1, the card: xp=${want}`, xpParam(href) === want, href);
    } else {
      await until(`!!window.__demoQA && !!(window.boltDemo && window.boltDemo.ready)`);
      await ev(`(() => { window.__demoQA.open(); window.__demoQA.recap({ transcript: [{ speaker: 'assistant', text: 'Thanks for calling.' }] }); })()`);
      await sleep(200);
      href = await tapSignup('.demo-success-cta');
      check(`surface 3, the demo recap: xp=${want}`, xpParam(href) === want, href);
      await ev(`window.__demoQA.limit()`);
      await sleep(200);
      href = await tapSignup('.demo-limitmsg__link');
      check(`surface 4, the demo limit page: xp=${want}`, xpParam(href) === want, href);
      s = await state();
      check('QA: the recap and limit taps send nothing to the gateway', s.gw.length === 0, s.gw);
    }
    await load(`${BASE}/`);
    href = await ev(`(document.querySelector('a.floating-cta') || {}).href`);
    check(`surface 2, the home floating Start (after x): xp=${want}`, xpParam(href) === want, href);
    s = await state();
    check('home page: nothing to the gateway', s.gw.length === 0);
  }

  // ---------- 6. a real visitor's ?bolt_xp is ignored ----------
  console.log('[a real visitor with ?bolt_xp=treatment, baked]');
  await visit(`/__baked/${PAGE}?bolt_xp=treatment`, { vid: VID.control });
  s = await state();
  const kept = await ev(`sessionStorage.getItem('bolt_xp_force')`);
  check('the hashed arm (control), not forced, nothing kept, out of the address', s.xp.variation === 'control' && s.xp.forced === false && kept === null && !/bolt_xp/.test(s.href), { xp: s.xp, kept, href: s.href });
  check('its exposure is the hashed arm', exposures(s).length === 1 && exposures(s)[0].experiments[0].variation === 'control', s.gw);
  await noLeak('a real visitor with ?bolt_xp');

  // ---------- 7. opted out and Global Privacy Control, both arms ----------
  for (const how of ['optout', 'gpc']) {
    let scriptId = null;
    if (how === 'gpc') scriptId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { configurable: true, get: () => true })` })).identifier;
    for (const arm of ['control', 'treatment']) {
      console.log(`[${how === 'gpc' ? 'Global Privacy Control' : '?bolt_optout=1'}, ${arm}, baked]`);
      await visit(`/__baked/${PAGE}${how === 'optout' ? '?bolt_optout=1' : ''}`, { vid: VID[arm] });
      s = await state();
      ex = exposures(s);
      check('the exposure still goes, with the arm', ex.length === 1 && ex[0].experiments[0].variation === arm && ex[0].anonymousId === VID[arm], s.gw);
      check('xp_exposed still goes', typesOf(s, 'xp_exposed').length === 1 && typesOf(s, 'xp_exposed')[0].data.variation === arm);
      check('the Meta Pixel is off (no calls) and the Google tag is off (no tag, no config)', s.fbq.length === 0 && !s.gtagScript && s.dl === '[]', { fbq: s.fbq, gtag: s.gtagScript, dl: s.dl });
      check(`the Reddit pixel is off (no calls; blocked: ${how === 'gpc' ? 'gpc' : 'opted_out'})`, s.rdt.length === 0 && !!s.reddit && s.reddit.blockedBy === (how === 'gpc' ? 'gpc' : 'opted_out'), { rdt: s.rdt, reddit: s.reddit });
      if (arm === 'control') {
        href = await ev(`document.querySelector('.ql-cta').href`);
        check('the button carries xp and the opt-out', xpParam(href) === `${KEY}.control.${CV}` && (how === 'gpc' || new URL(href).searchParams.get('bolt_optout') === '1'), href);
      }
    }
    if (scriptId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId });
  }

  // ---------- 8. storage blocked ----------
  console.log('[localStorage blocked, baked]');
  const blockId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } })` })).identifier;
  // The decide step's new id on each load, made known: two treatment vectors in turn (the same arm
  // twice, so only the visitor tells the two exposures apart). Later UUIDs are Chrome's own.
  const uuidId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try { const ids = ['${VID.treatment}', '12345678-90ab-4cde-8f01-234567890abc']; const n = Number(sessionStorage.getItem('__uuidn') || 0); const orig = crypto.randomUUID.bind(crypto); let used = false; crypto.randomUUID = () => { if (used) return orig(); used = true; sessionStorage.setItem('__uuidn', String(n + 1)); return ids[n % 2]; }; } catch (e) {} })()` })).identifier;
  await visit(`/__baked/${PAGE}`);
  s = await state();
  ex = exposures(s);
  check('the exposure\'s visitor is the visitor the arm was decided for', s.xp && ex.length === 1 && ex[0].anonymousId === s.xp.vid && ex[0].experiments[0].variation === s.xp.variation, { xp: s.xp, gw: s.gw });
  const fe = typesOf(s, 'xp_exposed')[0];
  check('the funnel hears the same visitor', fe && fe.sid === s.xp.vid, fe);
  // Storage blocked, every page load is a new visitor id: the next load is a new subject, and is reported.
  await load(`${BASE}/__baked/${PAGE}`);
  const s2 = await state();
  check('the next load (a new id, same tab, same arm) is a new subject, and is reported', s.xp && s.xp.vid === VID.treatment && s2.xp && s2.xp.vid === '12345678-90ab-4cde-8f01-234567890abc' && s2.xp.variation === 'treatment' && exposures(s2).length === 1 && exposures(s2)[0].anonymousId === s2.xp.vid, { a: s.xp, b: s2.xp, gw: s2.gw });
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: uuidId });
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: blockId });

  // ---------- 9. a computer: no dialer, so the call card shows the number ----------
  console.log('[a computer, treatment, baked]');
  await computer();
  await visit(`/__baked/${PAGE}`, { vid: VID.treatment });
  await until(`!!(window.boltDemo && window.boltDemo.ready) && document.querySelector('.qlt-call').getAttribute('href') !== '#'`);
  await ev(`window.__dialed = null; document.querySelector('.qlt-call').click()`);
  await sleep(400);
  m = await ev(`(() => { const b = document.querySelector('.demo-backdrop'); return { open: !!(b && b.classList.contains('open')), screen: b && b.getAttribute('data-screen'), plain: !!document.querySelector('b.demo-ihow__tel'), dialed: window.__dialed }; })()`);
  s = await state();
  check('"You call her" on a computer: no dial, the call card with the number to call', m.open && m.screen === 'inbound-call' && m.plain && !m.dialed && typesOf(s, 'demo_mode_selected').some((e) => e.data.dial === 'manual'), m);
  await phone();

  // ---------- 10. the demo card's two animations (AFMBP-2686) ----------
  // This Mac, and so headless Chrome here, prefers reduced motion: each setting is set explicitly.
  const motion = (v) => send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: v }] });
  const anim = () => ev(`(() => { const c = document.querySelector('.ql-card--t'), k = getComputedStyle(c), a = getComputedStyle(c, '::after'), d = getComputedStyle(document.querySelector('.qlt-dot'));
    const find = (n) => document.getAnimations().find((x) => x.animationName === n) || null, w = find('qlt-wipe'), b = find('qlt-blink');
    return { content: a.content, name: a.animationName, dur: a.animationDuration, iter: a.animationIterationCount, fill: a.animationFillMode, pe: a.pointerEvents, z: a.zIndex,
      box: [a.top, a.right, a.bottom, a.left].join(' '), clip: a.clipPath, wipe: w && w.playState,
      art: /demo-so-card\\.webp/.test(a.backgroundImage) && a.backgroundImage === k.backgroundImage && a.backgroundPosition === k.backgroundPosition && a.backgroundSize === k.backgroundSize,
      dot: d.animationName, dotDur: d.animationDuration, dotIter: d.animationIterationCount, blink: b && b.playState, all: document.getAnimations().length }; })()`);
  console.log('[the demo card\'s animations, a phone that allows motion]');
  await motion('no-preference');
  await send('Animation.enable');
  // Every animation frozen at its start before the page paints: the card shows its art alone (the cover
  // whole), so nothing it covers flashes up first.
  await send('Animation.setPlaybackRate', { playbackRate: 0 });
  await visit(`/__baked/${PAGE}`, { vid: VID.treatment });
  let a = await anim();
  check('the wipe-in at its start: a cover in the card\'s own art (same file, place and size) over the whole card, the cross included, taking no taps', a.content === '""' && a.name === 'qlt-wipe' && a.art && a.box === '0px 0px 0px 0px' && a.z === '3' && a.pe === 'none' && /^inset\(0(%|px)( 0px){0,3}\)$/.test(a.clip), a);
  const mid = await ev(`(() => { const w = document.getAnimations().find((x) => x.animationName === 'qlt-wipe'); w.pause(); w.currentTime = 700;
    const b = document.querySelector('.qlt-call').getBoundingClientRect(), h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return { clip: getComputedStyle(document.querySelector('.ql-card--t'), '::after').clipPath, hit: !!(h && h.closest('.qlt-call')) }; })()`);
  check('halfway (0.7s): the cover is cut away from the top partway down, and a tap goes through it to "You call her"', /^inset\(\d+(\.\d+)?% 0px 0px\)$/.test(mid.clip) && mid.hit, mid);
  await send('Animation.setPlaybackRate', { playbackRate: 1 });
  await visit(`/__baked/${PAGE}`, { vid: VID.treatment });
  a = await anim();
  check('the wipe runs once, 1.4s (owner: 2x the first 0.7s); the dot blinks every 1.2s for as long as the card shows', a.name === 'qlt-wipe' && a.dur === '1.4s' && a.iter === '1' && a.fill === 'both' && a.dot === 'qlt-blink' && a.dotDur === '1.2s' && a.dotIter === 'infinite', a);
  const gone = await until(`getComputedStyle(document.querySelector('.ql-card--t'), '::after').clipPath === 'inset(100% 0px 0px)' && document.getAnimations().some((x) => x.animationName === 'qlt-wipe' && x.playState === 'finished')`, 3000);
  a = await anim();
  check('after the wipe the cover is gone (cut away to the bottom) and the dot still blinks', gone && a.clip === 'inset(100% 0px 0px)' && a.blink === 'running', a);
  const op = await ev(`(() => { const k = document.getAnimations().find((x) => x.animationName === 'qlt-blink'), d = document.querySelector('.qlt-dot');
    k.pause(); k.currentTime = 0; const on = getComputedStyle(d).opacity; k.currentTime = 600; const off = getComputedStyle(d).opacity; k.play(); return { on, off }; })()`);
  check('the dot fades out and back: opacity 1, and 0.15 half a blink in', op.on === '1' && op.off === '0.15', op);
  await visit(`/__baked/${PAGE}`, { vid: VID.control });
  a = await ev(`({ content: getComputedStyle(document.querySelector('.ql-card--c'), '::after').content, all: document.getAnimations().length })`);
  check('the sign-up card (control): no cover, nothing animates', a.content === 'none' && a.all === 0, a);
  console.log('[the demo card\'s animations, a phone set to reduce motion]');
  await motion('reduce');
  await visit(`/__baked/${PAGE}`, { vid: VID.treatment });
  a = await anim();
  check('reduce motion: no cover, no wipe, a steady dot; the card is all there at once', a.content === 'none' && a.name === 'none' && a.dot === 'none' && a.all === 0, a);
  await send('Emulation.setEmulatedMedia', { features: [] });

  // ---------- 11. an Android phone's fonts (AFMBP-2686, the owner's Pixel 10a) ----------
  // On Android the demo card's words grew into the "Two ways" box: the phone drew 'Times New Roman' in its own
  // serif. Every word on the card is a drawing now, so with that serif (simulated) nothing on the card moves.
  console.log('[an Android phone\'s fonts: \'Times New Roman\' answered by another serif (simulated)]');
  await motion('reduce');
  await send('DOM.enable'); await send('CSS.enable');
  const fontsOf = async (sel) => { const doc = await send('DOM.getDocument', { depth: -1 }); const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: sel }); if (!q.nodeId) return null; return (await send('CSS.getPlatformFontsForNode', { nodeId: q.nodeId })).fonts.map((f) => f.familyName); };
  const geo = () => ev(`['.qlt-sub', '.qlt-ways', '.qlt-dot', '.qlt-live', '.qlt-call', '.qlt-get', '.qlt-bubble', '.qlt-close'].map((q) => { const b = document.querySelector(q).getBoundingClientRect(); return [q, +b.left.toFixed(3), +b.top.toFixed(3), +b.width.toFixed(3), +b.height.toFixed(3)]; })`);
  await visit(`/__baked/${PAGE}`, { vid: VID.treatment });
  await ev('document.fonts.ready.then(() => true)');
  const g0 = await geo();
  const aliasId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: ANDROID_SERIF })).identifier;
  await visit(`/__baked/${PAGE}`, { vid: VID.treatment });
  await ev(`(() => { const p = document.createElement('span'); p.id = '__tnr'; p.style.fontFamily = "'Times New Roman'"; p.textContent = 'Times'; document.body.appendChild(p); return document.fonts.ready.then(() => true); })()`);
  const fp = await fontsOf('#__tnr'), g1 = await geo();
  check('simulated Android: "Times New Roman" answers with another serif (the simulation is on)', !!fp && fp.length > 0 && fp.every((f) => f !== 'Times New Roman' && f !== 'Tinos'), fp);
  check('simulated Android: nothing on the demo card moves, its words being drawings', g0.length === 8 && JSON.stringify(g1) === JSON.stringify(g0), { g0, g1 });
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: aliasId });
  await send('Emulation.setEmulatedMedia', { features: [] });
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill('SIGKILL'); server.close();
  await sleep(300); try { rmSync(prof, { recursive: true, force: true }); } catch {}
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length} checks, ${failed} failed${NC ? ` (NC=${NC}: expected to FAIL)` : ''}`);
process.exit(failed ? 1 : 0);
