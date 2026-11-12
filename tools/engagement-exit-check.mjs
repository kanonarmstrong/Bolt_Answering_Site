// AFMBP-2565 (and the site half of AFMBP-2564) — what a visitor does before leaving, and a warmer
// sign-up. Drives the real pages in headless Chrome against a fake Bolt API (a Pixel 7, as
// Playwright describes it, unless a scenario says otherwise) and checks:
//   - browser: every event names the page's own browser by the web app's sign-up page rules
//     (bolt-web src/lib/social-signin-availability.ts): bolt-web's own user-agent table in the page,
//     and end to end a Pixel 7, Facebook's Android in-app browser, a plain Android WebView, a Mac;
//   - site_engaged: nothing until a person acts; then exactly one, at the first tap, key or scroll
//     of the page, with ms since the navigation started. A script's own event, or a box scrolling
//     inside the page, is not a person;
//   - site_exit: exactly one when the page is first hidden (another tab) or left (a navigation),
//     whichever comes first, with visible_ms, scroll_pct (the deepest the screen's bottom got),
//     engaged and lcp_ms as the page itself measured them; a page nobody saw sends nothing; time
//     hidden before the page was seen doesn't count; a page back from the back/forward cache is a
//     new view;
//   - the same flags as every event: qa on a QA visit, automated in an automated browser, and an
//     opt-out keeps Bolt's own first-party events running, as it always has for site_landed;
//   - the warm-up: every page with a sign-up link (and the blog template) opens the app's
//     connection early (one crossorigin preconnect); the offer asks for /signup-preload.json once,
//     and prefetches its files once the page has loaded (paths on the app only, each once), as
//     plain prefetches: the app's files carry no CORS header, as on the live app, and the browser
//     refuses none of them; the app's answer today (its index.html, no CORS), a 404 or no network
//     is silent: no exception, no console error from the page, the offer still opens and its
//     button still goes to the sign-up;
//   - regressions: site_landed, signup_offer_opened, trial_link_clicked and demo_closed as before.
// Run: node tools/engagement-exit-check.mjs [siteRoot]
//      NC=<name> mutates the SERVED copy only; each must FAIL (see MUTATE).
// Nothing leaves the machine: Chrome resolves no host but 127.0.0.1, and every other request is
// answered here.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, relative, resolve } from 'node:path';

const ROOT = resolve(process.argv[2] ?? new URL('..', import.meta.url).pathname);
const NC = process.env.NC || '';
const PORT = 20000 + Math.floor(Math.random() * 10000), DBG = 30000 + Math.floor(Math.random() * 10000);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const APP = 'https://app.boltanswering.com';
const SIGNUP = `${APP}/signup`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.webp': 'image/webp', '.mp4': 'video/mp4' };

const cut = (s, from, to) => { if (!s.includes(from)) throw new Error(`NC anchor missing: ${from}`); return s.split(from).join(to); };
const MUTATE = {
  // Events go out without the browser.
  no_browser: ['attribution.js', (s) => cut(s, '      data.browser = BROWSER;\n', '')],
  // The rules drift from bolt-web's: a WebView is named before the app inside it.
  webview_first: ['attribution.js', (s) => cut(s, '    var os = signupOsOf(ua, maxTouchPoints || 0);\n', "    var os = signupOsOf(ua, maxTouchPoints || 0);\n    if (os === 'android' && ANDROID_WEBVIEW.test(ua)) return { os: os, inApp: 'other' };\n")],
  // site_engaged is not held to once.
  engaged_again: ['attribution.js', (s) => cut(s, 'if (engaged || (e && e.isTrusted === false)', 'if ((e && e.isTrusted === false)')],
  // A script's own (untrusted) event counts as a person.
  untrusted: ['attribution.js', (s) => cut(s, 'if (engaged || (e && e.isTrusted === false) || !isVisible()) return;', 'if (engaged || !isVisible()) return;')],
  // A box scrolling inside the page counts as a person.
  box_scroll: ['attribution.js', (s) => cut(s, "window.addEventListener('scroll', onScroll, { passive: true });", "window.addEventListener('scroll', onScroll, { capture: true, passive: true });")],
  // site_exit is not held to once per view.
  exit_again: ['attribution.js', (s) => cut(s, '    if (!view || view.done) return;\n    view.done = true;', '    if (!view) return;\n    view.done = true;')],
  // The view starts before anyone sees the page: a preload sends site_exit.
  exit_unseen: ['attribution.js', (s) => cut(s, 'whenVisible(landed); whenVisible(firstView); }', 'whenVisible(landed); firstView(); }')],
  // A page back from the back/forward cache is not a new view.
  no_new_view: ['attribution.js', (s) => cut(s, '    if (e && e.persisted) whenVisible(function () { startView(sinceStart()); });\n', '')],
  // The deepest point is not kept: scroll_pct is where the screen was at the end.
  last_depth: ['attribution.js', (s) => cut(s, '    if (view && !view.done) view.bottom = Math.max(view.bottom, screenBottom());', '    if (view && !view.done) view.bottom = screenBottom();')],
  // A trade page loses the app's preconnect.
  no_preconnect: ['handyman.html', (s) => cut(s, '  <link rel="preconnect" href="https://app.boltanswering.com" crossorigin />\n', '')],
  // The offer doesn't warm the app.
  no_warm: ['demo.js', (s) => cut(s, "    if (entry === 'signup' && !s) warmApp();\n", '')],
  // A listed file on another site is prefetched.
  any_origin: ['demo.js', (s) => cut(s, 'if (u.origin !== APP_ORIGIN || have[u.href]) continue;', 'if (have[u.href]) continue;')],
  // A failed warm-up surfaces as an unhandled rejection.
  loud_warm: ['demo.js', (s) => cut(s, '        .catch(function () {});\n    } catch (e) {}\n  }\n  // The modal opens', '    } catch (e) {}\n  }\n  // The modal opens')],
  // The prefetches ask for CORS, which the app's files don't answer: refused, then downloaded again.
  cors_prefetch: ['demo.js', (s) => cut(s, "      l.rel = 'prefetch';\n", "      l.rel = 'prefetch';\n      l.crossOrigin = 'anonymous';\n")],
  // The prefetches start before the page itself has loaded.
  warm_early: ['demo.js', (s) => cut(s, "          if (document.readyState === 'complete') go();\n          else window.addEventListener('load', go);\n", '          go();\n')],
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
    // No no-store: a page must be able to go into the back/forward cache.
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(PORT, '127.0.0.1');

// Playwright's devices['Pixel 7'] (1.62).
const PIXEL7 = { ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.34 Mobile Safari/537.36', width: 412, height: 839, dpr: 2.625, mobile: true };
const MAC = { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36', width: 1280, height: 800, dpr: 1, mobile: false };
// Facebook's Android in-app browser, as a live ad visit sends it.
const FB_ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A146U; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/490.0.0.49.79;]';
// bolt-web src/lib/social-signin-availability.test.ts (origin/main 960044a), its user agents and the
// browser each names ('names each browser'), as browserClassOf labels it; plus the ad visit above.
const UA_TABLE = [
  ['iosSafari', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 0, 'ios_browser'],
  ['iosChrome', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/127.0.6533.107 Mobile/15E148 Safari/604.1', 0, 'ios_browser'],
  ['iosFacebook', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.40.97;FBBV/634553429;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5;FBRV/635913566]', 0, 'ios_facebook'],
  ['iosInstagram', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 341.0.4.27.106 (iPhone15,2; iOS 17_5; en_US; en; scale=3.00; 1179x2556; 619193093)', 0, 'ios_instagram'],
  ['iosTikTok', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_35.1.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/US', 0, 'ios_tiktok'],
  ['androidChrome', 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.6533.103 Mobile Safari/537.36', 0, 'android_browser'],
  ['androidFacebook', 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.6533.103 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/478.0.0.48.69;]', 0, 'android_facebook'],
  ['androidInstagram', 'Mozilla/5.0 (Linux; Android 14; SM-S918U Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.6533.103 Mobile Safari/537.36 Instagram 343.0.0.33.101 Android (34/14; 450dpi; 1080x2340; samsung; SM-S918U; dm3q; qcom; en_US; 634108168)', 0, 'android_instagram'],
  ['androidWebView', 'Mozilla/5.0 (Linux; Android 13; SM-A536U Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.134 Mobile Safari/537.36', 0, 'android_webview'],
  ['macSafari', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 0, 'desktop_browser'],
  ['iPadOS Safari (a Mac with touch)', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 5, 'ios_browser'],
  ['windowsChrome', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36', 0, 'desktop_browser'],
  ['ad visit, Facebook on Android', FB_ANDROID, 0, 'android_facebook'],
];
const AD = '/handyman.html?signup=1&utm_source=qa_src&utm_campaign=qa_camp&fbclid=qa_click&bolt_qa=1';
const CORS = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: '*' }];
// The contract (AFMBP-2564), with what must never be prefetched mixed in.
const PRELOAD = { files: ['/assets/index-QA1234.js', '/assets/index-QA5678.css', '//evil.example/a.js', '/\\evil.example/b.js', 'https://evil.example/c.js', '@evil.example/d.js', 'assets/relative.js', 42, null, '/assets/index-QA1234.js'] };
const PREFETCH_OK = [`${APP}/assets/index-QA1234.js`, `${APP}/assets/index-QA5678.css`];

const PROFILE = mkdtempSync(join(tmpdir(), 'cdp-2565-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0, good = 0;
const ok = (c, m) => { if (c) good++; else bad++; console.log(`  ${c ? 'PASS' : 'FAIL'} ${m}`); };
const show = (o) => JSON.stringify(o);

try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${ORIGIN}/index.html`)).ok) break; } catch {} await sleep(100); }
  let ver; for (let i = 0; i < 60 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${DBG}/json/version`)).json(); } catch { await sleep(200); } }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let nextId = 1; const pending = new Map(); const bySession = new Map();
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); return; }
    const tab = msg.sessionId && bySession.get(msg.sessionId);
    if (tab) tab.on(msg);
  });
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params, sessionId })); });
  const quiet = (p) => p.catch(() => {});

  // ---- a tab: its own requests answered here, everything it logs kept ----
  async function openTab(ctx, { device = PIXEL7, ua, human = true, preload = 'prod', hold = null } = {}) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId: ctx });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const tab = { targetId, sessionId, preload, hold, events: [], app: [], navs: [], other: [], logs: [], errors: [], notCached: [], loads: 0 };
    tab.on = (msg) => {
      const p = msg.params || {};
      if (msg.method === 'Page.loadEventFired') tab.loads++;
      else if (msg.method === 'Runtime.exceptionThrown') tab.errors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text);
      else if (msg.method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'assert')) tab.errors.push('console.' + p.type + ': ' + (p.args || []).map((a) => a.value ?? a.description).join(' '));
      else if (msg.method === 'Log.entryAdded') tab.logs.push(`[${p.entry.source} ${p.entry.level}] ${p.entry.text}`);
      else if (msg.method === 'Page.backForwardCacheNotUsed') tab.notCached.push((p.notRestoredExplanations || []).map((n) => n.reason).join(','));
      else if (msg.method === 'Fetch.requestPaused') route(tab, p);
    };
    bySession.set(sessionId, tab);
    for (const d of ['Page', 'Runtime', 'Log']) await send(`${d}.enable`, {}, sessionId);
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId);
    await send('Emulation.setDeviceMetricsOverride', { width: device.width, height: device.height, deviceScaleFactor: device.dpr, mobile: device.mobile }, sessionId);
    await send('Emulation.setTouchEmulationEnabled', device.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false }, sessionId);
    await send('Emulation.setUserAgentOverride', { userAgent: ua || device.ua }, sessionId);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }, sessionId);
    // A person's browser, or an automated one that says so; and the page's own clocks, kept for the checks.
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `Object.defineProperty(Navigator.prototype, 'webdriver', { configurable: true, get: function(){ return ${!human}; } });
        window.__shownAt = (document.visibilityState === 'visible' && !document.prerendering) ? 0 : null;
        document.addEventListener('visibilitychange', function(){ if (document.visibilityState === 'visible' && window.__shownAt === null) window.__shownAt = performance.now(); });
        window.addEventListener('pageshow', function(e){ if (e.persisted) { window.__restoredAt = performance.now(); } });
        window.__lcp = null; try { new PerformanceObserver(function(l){ var e = l.getEntries(); if (e.length) window.__lcp = Math.round(e[e.length-1].startTime); }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch (e) {}`,
    }, sessionId);
    tab.ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId); return r.result ? r.result.value : undefined; };
    tab.go = async (path, { wait = true } = {}) => {
      const before = tab.loads;
      await send('Page.navigate', { url: ORIGIN + path }, sessionId);
      if (wait) for (let i = 0; i < 150 && tab.loads === before; i++) await sleep(100);
      await sleep(300);
    };
    tab.back = async () => {
      const h = await send('Page.getNavigationHistory', {}, sessionId);
      const before = tab.notCached.length;
      await send('Page.navigateToHistoryEntry', { entryId: h.entries[h.currentIndex - 1].id }, sessionId);
      await sleep(900);
      return tab.notCached.length === before;
    };
    tab.box = (sel) => tab.ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; var r=e.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2};})()`);
    tab.tap = async (sel) => {
      const b = await tab.box(sel); if (!b) return false;
      if (device.mobile) { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y }] }, sessionId); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId); }
      else for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1 }, sessionId);
      await sleep(350); return true;
    };
    // A tap on nothing in particular: the first point on screen that is no link, button or field.
    tab.tapPlain = async () => {
      const p = await tab.ev(`(function(){ for (var y = 160; y < innerHeight - 40; y += 37) for (var x = 30; x < innerWidth - 30; x += 41) {
        var e = document.elementFromPoint(x, y); if (e && !e.closest('a,button,input,select,textarea,label,[role=button],[tabindex],video,canvas,iframe,.demo-backdrop')) return {x:x, y:y}; } return null; })()`);
      if (!p) return false;
      if (device.mobile) { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] }, sessionId); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId); }
      else for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 }, sessionId);
      await sleep(350); return true;
    };
    tab.wheel = async (dy) => { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 400, y: 400, deltaX: 0, deltaY: dy }, sessionId); await sleep(1000); };
    tab.key = async () => { for (const type of ['rawKeyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 }, sessionId); await sleep(250); };
    tab.of = (type, page) => tab.events.filter((e) => e.type === type && (!page || e.data.page === page));
    tab.depth = () => tab.ev('(function(){var d=document.documentElement,b=document.body;return Math.max(0,Math.min(100,Math.round((window.pageYOffset+window.innerHeight)/Math.max(d.scrollHeight,b.scrollHeight)*100)));})()');
    return tab;
  }
  function route(tab, { requestId, request, resourceType }) {
    const u = new URL(request.url);
    const answer = (code, headers, body = '') => quiet(send('Fetch.fulfillRequest', { requestId, responseCode: code, responseHeaders: headers, body: Buffer.from(body).toString('base64') }, tab.sessionId));
    if (u.hostname === '127.0.0.1') {
      const go = () => quiet(send('Fetch.continueRequest', { requestId }, tab.sessionId));
      return tab.hold && u.pathname === tab.hold.path ? setTimeout(go, tab.hold.ms) : go();
    }
    if (request.method === 'OPTIONS') return answer(204, CORS);
    if (u.hostname === 'bolt-staging.fly.dev') {
      if (u.pathname === '/api/public/analytics/events') {
        try { for (const e of JSON.parse(request.postData || '{}').events || []) tab.events.push({ type: e.event_type, sid: e.session_id, data: e.event_data || {}, at: Date.now() }); } catch {}
      }
      return answer(200, [...CORS, { name: 'Content-Type', value: 'application/json' }], '{"ok":true}');
    }
    if (u.origin === APP) {
      // The sign-up page itself: kept from loading (the tab stays where it is), and noted.
      if (resourceType === 'Document') { tab.navs.push(request.url); return quiet(send('Fetch.failRequest', { requestId, errorReason: 'Aborted' }, tab.sessionId)); }
      tab.app.push({ path: u.pathname, url: u.href, type: resourceType, method: request.method });
      // The app's own files, as the live app serves them: long-cached, no CORS header.
      if (u.pathname !== '/signup-preload.json') return answer(200, [{ name: 'Content-Type', value: /\.css$/.test(u.pathname) ? 'text/css' : 'text/javascript' }, { name: 'Cache-Control', value: 'public, max-age=31536000, immutable' }], '/* qa */');
      // What the app answers today: its own index.html (the SPA's fallback), with no CORS header.
      if (tab.preload === 'prod') return answer(200, [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }, { name: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }], '<!doctype html><html><head><title>Bolt</title></head><body><div id="root"></div></body></html>');
      if (tab.preload === '404') return answer(404, [...CORS, { name: 'Content-Type', value: 'text/plain' }], 'Not Found');
      if (tab.preload === 'offline') return quiet(send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' }, tab.sessionId));
      return answer(200, [...CORS, { name: 'Content-Type', value: 'application/json' }], JSON.stringify(PRELOAD));
    }
    tab.other.push(u.href);
    return answer(200, [{ name: 'Content-Type', value: 'text/plain' }]);   // Google, Meta, Sentry's CDN: nothing leaves
  }
  async function context() { return (await send('Target.createBrowserContext')).browserContextId; }
  async function close(ctx) { await quiet(send('Target.disposeBrowserContext', { browserContextId: ctx })); }
  // Another tab in front: the page is really hidden (Chrome's own visibilitychange); and back.
  async function hide(ctx, tab) {
    if (!tab.cover) tab.cover = (await send('Target.createTarget', { url: 'about:blank', browserContextId: ctx, newWindow: false })).targetId;
    await send('Target.activateTarget', { targetId: tab.cover }); await sleep(500);
  }
  async function front(tab) { await send('Target.activateTarget', { targetId: tab.targetId }); await sleep(400); }
  const opened = (tab) => tab.ev("(function(){var b=document.querySelector('.demo-backdrop.open'); return b ? b.getAttribute('data-screen') : null;})()");
  const until = async (fn, ms = 6000) => { for (let i = 0; i < ms / 100; i++) { if (await fn()) return true; await sleep(100); } return false; };
  const sample = {};

  // ================= the browser rule, held to bolt-web's own table =================
  console.log('[rule] bolt-web social-signin-availability user agents');
  {
    const ctx = await context(); const tab = await openTab(ctx);
    await tab.go('/privacy/');
    for (const [name, ua, touch, want] of UA_TABLE) {
      const got = await tab.ev(`window.boltAttr.browserClassOf(${JSON.stringify(ua)}, ${touch})`);
      ok(got === want, `rule: ${name} -> ${want} (${got})`);
    }
    await close(ctx);
  }

  // ================= a Pixel 7 ad visit (QA): the offer, a tap, then another tab =================
  console.log('[pixel 7] ad visit: landed, offer, warm-up, first touch, backgrounded');
  {
    const ctx = await context(); const tab = await openTab(ctx);
    await tab.go(AD);
    ok(await until(async () => (await opened(tab)) === 'signup'), 'offer: ?signup=1 opens the sign-up offer');
    await sleep(1500);
    const landed = tab.of('site_landed');
    ok(landed.length === 1 && landed[0].data.browser === 'android_browser' && (await tab.ev('window.boltAttr.browser')) === 'android_browser', `browser: site_landed says android_browser (${show(landed.map((e) => e.data.browser))})`);
    sample.site_landed = landed[0];
    ok(landed.length === 1 && landed[0].data.qa === true && landed[0].data.attr && landed[0].data.attr.utm_source === 'qa_src' && landed[0].data.device === 'mobile' && landed[0].data.visible_at_load === true, `regression: site_landed keeps its fields (qa, attr, device, visible_at_load) (${show(landed[0] && landed[0].data)})`);
    const offer = tab.of('signup_offer_opened');
    ok(offer.length === 1 && offer[0].data.trigger === 'ad_link' && offer[0].data.trade === 'handyman' && offer[0].data.browser === 'android_browser', `regression: signup_offer_opened once, ad_link, handyman, with browser (${show(offer.map((e) => e.data))})`);
    ok(tab.of('demo_opened').length === 0, 'regression: no demo_opened for the offer');
    const pc = await tab.ev(`[].slice.call(document.querySelectorAll('link[rel="preconnect"]')).map(function(l){return {href:l.href, co:l.crossOrigin, head:l.parentNode===document.head};})`);
    ok(pc.length === 1 && pc[0].href === APP + '/' && pc[0].co === 'anonymous' && pc[0].head, `warm-up: one crossorigin preconnect to the app, in <head> (${show(pc)})`);
    const pre = tab.app.filter((r) => r.path === '/signup-preload.json');
    ok(pre.length === 1 && /^(Fetch|XHR)$/.test(pre[0].type) && pre[0].method === 'GET', `warm-up: the offer asks for /signup-preload.json once (${show(pre)})`);
    ok((await tab.ev('document.querySelectorAll(\'link[rel="prefetch"]\').length')) === 0 && tab.app.length === 1, `warm-up: today's answer (the app's index.html, no CORS) prefetches nothing (${show(tab.app.map((r) => r.path))})`);
    ok(tab.errors.length === 0, `silent: no exception or console error from the page (${show(tab.errors)})`);
    sample.prodLogs = tab.logs.slice();
    ok(tab.of('site_engaged').length === 0 && tab.of('site_exit').length === 0, `engaged: nothing before anyone acts (${show(tab.events.map((e) => e.type))})`);
    const t0 = await tab.ev('performance.now()');
    await tab.tap('.demo-backdrop.open .demo-cm__sub');
    const t1 = await tab.ev('performance.now()');
    let eng = tab.of('site_engaged');
    ok(eng.length === 1 && eng[0].data.ms >= Math.floor(t0) && eng[0].data.ms <= Math.ceil(t1) && eng[0].data.browser === 'android_browser' && eng[0].data.qa === true, `engaged: a tap sends one site_engaged, ms since the navigation started (${eng[0] && eng[0].data.ms} in ${Math.round(t0)}..${Math.round(t1)})`);
    sample.site_engaged = eng[0];
    ok((await opened(tab)) === 'signup', 'offer: a tap on the card leaves it open');
    await tab.tap('.demo-backdrop.open .demo-so__free'); await tab.key();
    ok(tab.of('site_engaged').length === 1, `engaged: more taps and a key send nothing more (${tab.of('site_engaged').length})`);
    const depth = await tab.depth(), lcp = await tab.ev('window.__lcp');
    const h0 = await tab.ev('performance.now()');
    await hide(ctx, tab);
    const h1 = await tab.ev('performance.now()');
    ok((await tab.ev('document.visibilityState')) === 'hidden', 'exit: another tab in front hides the page');
    let ex = tab.of('site_exit');
    const d = ex[0] && ex[0].data;
    ok(ex.length === 1, `exit: hidden sends one site_exit (${ex.length})`);
    ok(!!d && d.visible_ms >= Math.floor(h0) && d.visible_ms <= Math.ceil(h1), `exit: visible_ms is the time on screen since the navigation started (${d && d.visible_ms} in ${Math.round(h0)}..${Math.round(h1)})`);
    ok(!!d && d.scroll_pct === depth && d.scroll_pct > 0 && d.scroll_pct < 100, `exit: scroll_pct is how much of the page the first screen showed (${d && d.scroll_pct}, page says ${depth})`);
    ok(!!d && d.engaged === true, 'exit: engaged true after the tap');
    ok(!!d && typeof d.lcp_ms === 'number' && d.lcp_ms > 0 && d.lcp_ms === lcp && d.lcp_ms <= d.visible_ms, `exit: lcp_ms is the page's Largest Contentful Paint (${d && d.lcp_ms}, page says ${lcp})`);
    ok(!!d && d.browser === 'android_browser' && d.qa === true && d.page === '/handyman.html' && d.attr && d.attr.click_id === 'qa_click', `exit: site_exit carries the same fields as every event (${show(d)})`);
    sample.site_exit = ex[0];
    await front(tab); await sleep(400); await hide(ctx, tab); await front(tab);
    await tab.go('/privacy/');
    ok(tab.of('site_exit', '/handyman.html').length === 1, `exit: shown again, hidden again, then left: still one site_exit for the view (${tab.of('site_exit', '/handyman.html').length})`);
    ok(tab.errors.length === 0, `silent: still no exception or console error (${show(tab.errors)})`);
    await close(ctx);
  }

  // ================= the offer's button still goes to the sign-up; closing is still logged =================
  console.log('[pixel 7] the offer\'s button and its close');
  {
    const ctx = await context(); const tab = await openTab(ctx);
    await tab.go(AD);
    await until(async () => (await opened(tab)) === 'signup');
    await sleep(500);
    await tab.tap('.demo-backdrop.open .demo-so__cta');
    await until(async () => tab.navs.length > 0, 3000);
    const vid = await tab.ev('window.boltAttr.visitorId()');
    const nav = tab.navs[0] ? new URL(tab.navs[0]) : null;
    ok(!!nav && nav.origin + nav.pathname === SIGNUP && nav.searchParams.get('bvid') === vid && nav.searchParams.get('utm_source') === 'qa_src' && nav.searchParams.get('fbclid') === 'qa_click' && nav.searchParams.get('bolt_qa') === '1', `link: "Start your free trial" goes to the sign-up with the visitor and the ad (${tab.navs[0]})`);
    const tl = tab.of('trial_link_clicked');
    ok(tl.length === 1 && tl[0].data.placement === 'signup_offer' && tl[0].data.browser === 'android_browser' && tl[0].sid === vid, `regression: trial_link_clicked once, signup_offer, with browser (${show(tl.map((e) => e.data))})`);
    ok(tab.of('site_engaged').length === 1, 'engaged: the tap on the button is the first touch');
    await tab.tap('.demo-backdrop.open .demo-close');
    const dc = tab.of('demo_closed');
    ok(dc.length === 1 && dc[0].data.step === 'signup_offer' && dc[0].data.browser === 'android_browser', `regression: demo_closed once, step signup_offer, with browser (${show(dc.map((e) => e.data))})`);
    ok(tab.errors.length === 0, `silent: no exception or console error (${show(tab.errors)})`);
    await close(ctx);
  }

  // ================= other answers from the app: a 404, no network =================
  for (const answer of ['404', 'offline']) {
    console.log(`[pixel 7] the app answers /signup-preload.json with ${answer}`);
    const ctx = await context(); const tab = await openTab(ctx, { preload: answer });
    await tab.go(AD);
    ok(await until(async () => (await opened(tab)) === 'signup'), `${answer}: the offer opens`);
    await sleep(1200);
    ok(tab.app.filter((r) => r.path === '/signup-preload.json').length === 1 && (await tab.ev('document.querySelectorAll(\'link[rel="prefetch"]\').length')) === 0, `${answer}: asked once, nothing prefetched`);
    ok(tab.errors.length === 0, `${answer}: no exception or console error from the page (${show(tab.errors)})`);
    ok((await tab.ev("document.querySelector('.demo-so__cta').getAttribute('href')")) === SIGNUP, `${answer}: the button still links to the sign-up`);
    sample[`logs_${answer}`] = tab.logs.slice();
    await close(ctx);
  }

  // ================= the contract: the files are prefetched once the page has loaded =================
  console.log('[pixel 7] /signup-preload.json answers the contract; the page\'s load is held back');
  {
    const ctx = await context(); const tab = await openTab(ctx, { preload: 'json', hold: { path: '/assets/logo-wordmark.png', ms: 2500 } });
    await tab.go(AD, { wait: false });
    ok(await until(async () => (await opened(tab)) === 'signup'), 'contract: the offer opens while the page is still loading');
    await until(async () => tab.app.some((r) => r.path === '/signup-preload.json'), 3000);
    await sleep(400);
    const early = await tab.ev('({ state: document.readyState, links: document.querySelectorAll(\'link[rel="prefetch"]\').length })');
    ok(early.state !== 'complete' && early.links === 0, `contract: nothing is prefetched before the page has loaded (${show(early)})`);
    await until(async () => (await tab.ev('document.readyState')) === 'complete', 6000);
    await sleep(600);
    const links = await tab.ev(`[].slice.call(document.querySelectorAll('link[rel="prefetch"]')).map(function(l){return {href:l.href, co:l.crossOrigin, head:l.parentNode===document.head};})`);
    ok(show(links.map((l) => l.href)) === show(PREFETCH_OK) && links.every((l) => l.co === null && l.head), `contract: one plain prefetch link (no crossorigin) per file on the app; other sites, relative paths and junk skipped (${show(links)})`);
    ok(!tab.logs.some((l) => /app\.boltanswering\.com/.test(l)), `contract: the browser refuses no prefetch (no CORS or load error about the app) (${show(tab.logs.filter((l) => /app\.boltanswering\.com|CORS/.test(l)))})`);
    const fetched = tab.app.filter((r) => r.path !== '/signup-preload.json').map((r) => r.url).sort();
    ok(show(fetched) === show([...PREFETCH_OK].sort()) && tab.other.every((h) => !/evil/.test(h)), `contract: the browser prefetches exactly those files (${show(fetched)}; elsewhere: ${show(tab.other)})`);
    ok(tab.app.filter((r) => r.path === '/signup-preload.json').length === 1, 'contract: asked once');
    ok(!tab.events.some((e) => !/^(site_landed|signup_offer_opened|site_engaged|site_exit)$/.test(e.type)), `contract: the warm-up sends nothing to analytics (${show(tab.events.map((e) => e.type))})`);
    ok(tab.errors.length === 0, `contract: no exception or console error (${show(tab.errors)})`);
    sample.logs_json = tab.logs.slice();
    await close(ctx);
  }

  // ================= nobody saw it; then a page seen only later =================
  console.log('[pixel 7] a page that loads behind another tab');
  {
    const ctx = await context(); const tab = await openTab(ctx);
    await hide(ctx, tab);
    await tab.go(AD);
    ok((await tab.ev('document.visibilityState')) === 'hidden', 'unseen: the page loads hidden');
    await tab.ev("window.scrollTo(0, 400), document.dispatchEvent(new Event('scroll')), 1");
    await sleep(1800);
    ok(tab.events.length === 0 && (await opened(tab)) === null && tab.app.length === 0, `unseen: nothing logged, no offer, no warm-up (${show(tab.events.map((e) => e.type))}, ${show(tab.app.map((r) => r.path))})`);
    await tab.go('/privacy/');
    ok(tab.events.length === 0, `unseen: leaving it sends no site_exit (${show(tab.events.map((e) => e.type))})`);
    // The same tab, a page shown 1.5 s after it loaded.
    await tab.go(AD.replace('handyman', 'hvac'));
    await sleep(1500);
    await front(tab);
    await until(async () => tab.of('site_exit').length === 0 && tab.of('signup_offer_opened').length === 1, 3000);
    await sleep(800);
    const shownAt = await tab.ev('window.__shownAt'), h0 = await tab.ev('performance.now()');
    await hide(ctx, tab);
    const h1 = await tab.ev('performance.now()');
    const ex = tab.of('site_exit');
    const d = ex[0] && ex[0].data;
    ok(ex.length === 1 && shownAt > 1000 && d.visible_ms >= Math.floor(h0 - shownAt) - 25 && d.visible_ms <= Math.ceil(h1 - shownAt) + 1, `seen later: visible_ms counts from when it was shown, not loaded (${d && d.visible_ms} in ${Math.round(h0 - shownAt)}..${Math.round(h1 - shownAt)}; shown at ${Math.round(shownAt)})`);
    ok(!!d && d.engaged === false, 'seen later: engaged false with no touch');
    await close(ctx);
  }

  // ================= a Mac: scroll only, leave, come back from the back/forward cache =================
  console.log('[mac] scroll, leave, back from the back/forward cache, leave again');
  {
    const ctx = await context(); const tab = await openTab(ctx, { device: MAC, human: true });
    await tab.go('/hvac.html?bolt_qa=1');
    await sleep(1200);
    ok(tab.of('site_landed').length === 1 && tab.of('site_landed')[0].data.browser === 'desktop_browser', `browser: a Mac is desktop_browser (${show(tab.of('site_landed').map((e) => e.data.browser))})`);
    ok(tab.of('site_engaged').length === 0, 'engaged: nothing before the scroll');
    await tab.wheel(1400);
    const deep = await tab.depth();
    const eng = tab.of('site_engaged');
    ok(eng.length === 1 && (await tab.ev('window.pageYOffset')) > 0, `engaged: a scroll alone (no tap) sends one site_engaged (${eng.length}, at ${await tab.ev('window.pageYOffset')}px)`);
    await tab.wheel(-1000); await tab.wheel(300);
    ok(tab.of('site_engaged').length === 1, 'engaged: more scrolling sends nothing more');
    const h0 = await tab.ev('performance.now()');
    await tab.go('/privacy/?bolt_qa=1');
    let ex = tab.of('site_exit', '/hvac.html');
    const d = ex[0] && ex[0].data;
    ok(ex.length === 1, `exit: leaving sends one site_exit (${ex.length})`);
    ok(!!d && d.scroll_pct === deep && deep > 0 && deep < 100, `exit: scroll_pct keeps the deepest point, not the last (${d && d.scroll_pct}, deepest ${deep})`);
    ok(!!d && d.visible_ms >= Math.floor(h0) && d.engaged === true && typeof d.lcp_ms === 'number', `exit: visible_ms, engaged, lcp_ms (${show(d)})`);
    const restored = await tab.back();
    const restoredAt = await tab.ev('window.__restoredAt');
    ok(restored && typeof restoredAt === 'number', `bfcache: Back restores the page from the back/forward cache (${restored ? 'restored' : 'not restored: ' + show(tab.notCached)})`);
    await sleep(700);
    const r0 = await tab.ev('performance.now()');
    await tab.go('/terms/?bolt_qa=1');
    ex = tab.of('site_exit', '/hvac.html');
    const d2 = ex[1] && ex[1].data;
    ok(ex.length === 2 && !!d2 && d2.visible_ms >= Math.floor(r0 - restoredAt) - 25 && d2.visible_ms < 5000, `bfcache: the restored page is a new view with its own site_exit (${ex.length}; visible_ms ${d2 && d2.visible_ms}, at least ${Math.round(r0 - restoredAt)})`);
    ok(tab.of('site_engaged', '/hvac.html').length === 1, 'bfcache: still one site_engaged for the page load');
    await close(ctx);
  }

  // ================= a key; a script's own events and a box scrolling are not a person =================
  console.log('[mac] a key; [pixel 7] what is not a person');
  {
    const ctx = await context(); const tab = await openTab(ctx, { device: MAC });
    await tab.go('/plumbing.html?bolt_qa=1');
    await sleep(900);
    await tab.key();
    ok(tab.of('site_engaged').length === 1, `engaged: a key sends one site_engaged (${tab.of('site_engaged').length})`);
    await close(ctx);
  }
  {
    const ctx = await context(); const tab = await openTab(ctx);
    await tab.go('/electrical.html?bolt_qa=1');
    await sleep(900);
    await tab.ev(`(function(){
      var b = document.createElement('div'); b.style.cssText = 'position:fixed;top:0;left:0;width:80px;height:40px;overflow:auto'; b.innerHTML = '<div style="height:400px"></div>';
      document.body.appendChild(b); b.scrollTop = 200;
      window.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('pointerdown')); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      return 1; })()`);
    await sleep(800);
    ok(tab.of('site_engaged').length === 0, `engaged: a box scrolling inside the page and a script's own events are not a person (${tab.of('site_engaged').length})`);
    await tab.tapPlain();
    ok(tab.of('site_engaged').length === 1, `engaged: then a real tap is (${tab.of('site_engaged').length})`);
    await close(ctx);
  }

  // ================= other browsers, end to end =================
  for (const [name, ua, want] of [['Facebook\'s Android in-app browser', FB_ANDROID, 'android_facebook'], ['a plain Android WebView', UA_TABLE.find((r) => r[0] === 'androidWebView')[1], 'android_webview']]) {
    console.log(`[${name}]`);
    const ctx = await context(); const tab = await openTab(ctx, { ua });
    await tab.go('/handyman.html?signup=1&utm_source=fb&bolt_qa=1');
    await until(async () => (await opened(tab)) === 'signup');
    await sleep(700);
    await tab.tap('.demo-backdrop.open .demo-cm__sub');
    await hide(ctx, tab);
    const types = ['site_landed', 'signup_offer_opened', 'site_engaged', 'site_exit'];
    const got = types.map((t) => tab.of(t).map((e) => e.data.browser).join('|'));
    ok(got.every((b) => b === want), `browser: ${name} -> ${want} on ${types.join(', ')} (${show(got)})`);
    if (want === 'android_facebook') sample.fb = tab.of('site_landed')[0];
    await close(ctx);
  }

  // ================= the same flags as every event =================
  console.log('[gates] automated browser; opted out; not QA');
  {
    const ctx = await context(); const tab = await openTab(ctx, { human: false });
    await tab.go('/index.html?bolt_qa=1');
    await sleep(900); await tab.tapPlain(); await hide(ctx, tab);
    const t = ['site_landed', 'site_engaged', 'site_exit'].map((x) => tab.of(x));
    ok(t.every((l) => l.length === 1 && l[0].data.automated === true), `gates: an automated browser's events all say automated (${show(t.map((l) => l.map((e) => e.data.automated)))})`);
    await close(ctx);
  }
  {
    const ctx = await context(); const tab = await openTab(ctx);
    await tab.go('/hvac.html?bolt_optout=1&utm_source=fb');
    await sleep(900); await tab.tapPlain(); await hide(ctx, tab);
    const t = ['site_landed', 'site_engaged', 'site_exit'].map((x) => tab.of(x));
    ok(t.every((l) => l.length === 1 && !('qa' in l[0].data) && !('automated' in l[0].data)), `gates: opted out (no ad tags), Bolt's own events keep running, as site_landed always has; no qa or automated flag on a person's visit (${show(t.map((l) => l.length))})`);
    await close(ctx);
  }

  // ================= every page with a sign-up link opens the app's connection early =================
  console.log('[pages] preconnect');
  {
    const files = [];
    const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) { if (!/^(\.git|node_modules|tools|vendor)$/.test(n)) walk(p); } else if (n.endsWith('.html')) files.push(p); } };
    walk(ROOT);
    const LINE = '<link rel="preconnect" href="https://app.boltanswering.com" crossorigin />';
    let checked = 0; const missing = [];
    for (const f of files) {
      let s = readFileSync(f, 'utf8');
      for (const [file, fn] of MUTS) if (f.endsWith('/' + file)) s = fn(s);
      if (!s.includes('https://app.boltanswering.com/signup') && !/demo\.js/.test(s)) continue;
      checked++;
      const head = s.slice(0, s.indexOf('</head>'));
      if (head.split(LINE).length !== 2 || s.split('rel="preconnect"').length !== 2) missing.push(relative(ROOT, f));
    }
    ok(checked >= 16 && missing.length === 0, `pages: all ${checked} pages with a sign-up link or the offer have one preconnect to the app, in <head> (missing: ${show(missing)})`);
    const tpl = readFileSync(join(ROOT, 'tools/blog/lib/templates.mjs'), 'utf8');
    ok(tpl.split(LINE).length === 2, 'pages: the blog template has it too, so every rebuilt blog page keeps it');
  }

  console.log('\nsample payloads:');
  for (const k of ['site_landed', 'site_engaged', 'site_exit', 'fb']) if (sample[k]) console.log(`  ${k === 'fb' ? 'site_landed (Facebook on Android)' : k}: ${show(sample[k].data)}`);
  for (const k of ['prodLogs', 'logs_404', 'logs_offline', 'logs_json']) console.log(`  the browser's own console lines (${k === 'prodLogs' ? "today's answer" : k.slice(5)}): ${show(sample[k] || [])}`);
  console.log(`\n${good}/${good + bad} passed${NC ? ` (NC=${NC})` : ''}`);
  ws.close();
} finally {
  chrome.kill('SIGKILL'); srv.close();
  await sleep(300);
  rmSync(PROFILE, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
