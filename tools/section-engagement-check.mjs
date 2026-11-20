// AFMBP-2667: what a visitor actually sees and taps. Drives pages in headless Chrome against a fake Bolt
// API and checks:
//   - section_viewed: one per top-level section per page load, only once it has been on screen for 1 s
//     (half of the section, or half of the screen for a taller one), with the time that look lasted;
//     never for a glance, a hidden section, a section inside another, or a page nobody saw; the time
//     the demo covers the page is not the sections' time;
//   - cta_clicked: a nav anchor, a demo button and a page link each send one, with where it was and
//     where it goes, never the link's text; a sign-up link sends trial_link_clicked only, as before.
// The timing rules run on a test page this check serves (sections of a known height, so every
// scroll position is exact); the taps and section names run on the real home and handyman pages.
// Run: node tools/section-engagement-check.mjs [siteRoot]
//      NC=<name> mutates the SERVED copy only; each must FAIL (see MUTATE).
// Nothing leaves the machine: Chrome resolves no host but 127.0.0.1, and every other request is
// answered here.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(process.argv[2] ?? new URL('..', import.meta.url).pathname);
const NC = process.env.NC || '';
const PORT = 20000 + Math.floor(Math.random() * 10000), DBG = 30000 + Math.floor(Math.random() * 10000);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const APP = 'https://app.boltanswering.com';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.webp': 'image/webp', '.mp4': 'video/mp4' };

const cut = (s, from, to) => { if (!s.includes(from)) throw new Error(`NC anchor missing: ${from}`); return s.split(from).join(to); };
const MUTATE = {
  // A page nobody saw still times its sections.
  unseen: ['attribution.js', (s) => cut(cut(s, 'function sectionsInit() { whenVisible(watchSections); }', 'function sectionsInit() { watchSections(); }'),
    'l.since === null && isVisible() && !covered()', 'l.since === null && !covered()')],
  // A section is sent again every time it comes back on screen.
  again: ['attribution.js', (s) => cut(cut(cut(s, '    if (l.sent || l.ms < SEEN_MS) return;\n', '    if (l.ms < SEEN_MS) return;\n'),
    '      if (!l || l.sent) continue;\n', '      if (!l) continue;\n'), 'function lookStart(l) { if (l.on && !l.sent && ', 'function lookStart(l) { if (l.on && ')],
  // A glance (under 1 s) counts as seen.
  glance: ['attribution.js', (s) => cut(s, '    if (l.sent || l.ms < SEEN_MS) return;\n', '    if (l.sent) return;\n')],
  // The demo's time counts as the sections'.
  demo_time: ['attribution.js', (s) => cut(s, "function covered() { return !!(document.body && document.body.classList.contains('demo-lock')); }", 'function covered() { return false; }')],
  // A section inside another one is counted too.
  nested: ['attribution.js', (s) => cut(s, "if ((up && up.closest && up.closest('section')) || all[i].closest('.demo-backdrop')) continue;", "if (all[i].closest('.demo-backdrop')) continue;")],
  // A tap sends the link's own text.
  link_text: ['attribution.js', (s) => cut(s, "      return 'page:' + u.pathname;\n", "      return 'page:' + u.pathname + ' ' + String(el.textContent || '').trim();\n")],
  // A sign-up link sends cta_clicked as well as trial_link_clicked.
  signup_cta: ['attribution.js', (s) => cut(s, '    if (href && isSignup(href)) return;             // sign-up links send trial_link_clicked\n', '')],
};
if (NC && !MUTATE[NC]) throw new Error(`unknown NC "${NC}"; one of ${Object.keys(MUTATE).join(', ')}`);
const MUTS = !NC ? [] : [MUTATE[NC]];
for (const [file, fn] of MUTS) { const s = readFileSync(join(ROOT, file), 'utf8'); if (fn(s) === s) throw new Error(`NC ${NC} leaves ${file} unchanged`); }

// The test page: sections of a known height (taller than the screen), one hidden, one inside another.
const TEST_PAGE = '/__qa_sections.html';
const TEST_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html{scroll-behavior:auto}body{margin:0;font:16px sans-serif}section{height:1200px;border-top:1px solid #ccc}.qa_outer{height:auto}</style></head><body>
<section class="qa_a">A</section><section class="qa_b">B</section><section class="qa_c">C</section><section class="qa_d">D</section>
<section class="qa_hidden" style="display:none">hidden</section>
<section class="qa_outer"><section class="qa_inner">inside another section</section></section>
<script src="/attribution.js"></script></body></html>`;

const srv = createServer((req, res) => {
  try {
    const path = new URL(req.url, 'http://x').pathname;
    if (path === TEST_PAGE) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(TEST_HTML); return; }
    const p = normalize(decodeURIComponent(path)).replace(/^([.][.][/\\])+/, '');
    let f = join(ROOT, p);
    if (statSync(f).isDirectory()) f = join(f, 'index.html');
    let body = readFileSync(f);
    for (const [file, fn] of MUTS) if (f.endsWith('/' + file)) body = Buffer.from(fn(body.toString('utf8')));
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(PORT, '127.0.0.1');

// Playwright's devices['Pixel 7'] (1.62), and a Mac.
const PIXEL7 = { ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.34 Mobile Safari/537.36', width: 412, height: 839, dpr: 2.625, mobile: true };
const MAC = { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36', width: 1280, height: 800, dpr: 1, mobile: false };
const CORS = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: '*' }];
// What a tap may say about where it goes: a path, an anchor, another site's host, or a fixed word. No spaces, no query.
const TARGET_RE = /^(page:\/[^\s?#]*|anchor:[\w-]+|out:[\w.-]+|demo|email|phone|link|button:[\w-]+)$/;
const SECTION_KEYS = new Set(['placement', 'visible_ms', 'page', 'browser', 'attr', 'qa', 'automated']);

const PROFILE = mkdtempSync(join(tmpdir(), 'cdp-2667-'));
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

  async function context() { return (await send('Target.createBrowserContext')).browserContextId; }
  async function close(ctx) { await quiet(send('Target.disposeBrowserContext', { browserContextId: ctx })); }
  async function openTab(ctx, device) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId: ctx });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const tab = { targetId, sessionId, events: [], navs: [], errors: [], loads: 0 };
    tab.on = (msg) => {
      const p = msg.params || {};
      if (msg.method === 'Page.loadEventFired') tab.loads++;
      else if (msg.method === 'Runtime.exceptionThrown') tab.errors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text);
      else if (msg.method === 'Fetch.requestPaused') route(tab, p);
    };
    bySession.set(sessionId, tab);
    for (const d of ['Page', 'Runtime']) await send(`${d}.enable`, {}, sessionId);
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId);
    await send('Emulation.setDeviceMetricsOverride', { width: device.width, height: device.height, deviceScaleFactor: device.dpr, mobile: device.mobile }, sessionId);
    await send('Emulation.setTouchEmulationEnabled', device.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false }, sessionId);
    await send('Emulation.setUserAgentOverride', { userAgent: device.ua }, sessionId);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
    tab.pre = (source) => send('Page.addScriptToEvaluateOnNewDocument', { source }, sessionId);
    tab.ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId); return r.result ? r.result.value : undefined; };
    tab.go = async (path) => {
      const before = tab.loads;
      await send('Page.navigate', { url: ORIGIN + path }, sessionId);
      for (let i = 0; i < 150 && tab.loads === before; i++) await sleep(100);
      await sleep(300);
    };
    tab.to = (sel) => tab.ev(`(function(){var e=document.querySelector(${show(sel)}); if(!e) return false; window.scrollTo(0, e.getBoundingClientRect().top + window.pageYOffset); return true;})()`);
    // Taps the element's middle once it has stopped moving (a smooth scroll, a reveal animation) and is on top.
    tab.tap = async (sel) => {
      if (!(await tab.ev(`(function(){var e=document.querySelector(${show(sel)}); if(!e) return false; e.scrollIntoView({block:'center', behavior:'instant'}); return true;})()`))) return false;
      let b = null, last = '';
      for (let i = 0; i < 40; i++) {
        await sleep(100);
        b = await tab.ev(`(function(){var e=document.querySelector(${show(sel)}); var r=e.getBoundingClientRect(); var x=r.left+r.width/2, y=r.top+r.height/2;
          var top=document.elementFromPoint(x, y); return {x:x, y:y, onTop: !!top && (top === e || e.contains(top))};})()`);
        const now = `${Math.round(b.x)},${Math.round(b.y)}`;
        if (b.onTop && now === last) break;
        last = now;
      }
      if (!b || !b.onTop) return false;
      if (device.mobile) { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y }] }, sessionId); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId); }
      else for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1 }, sessionId);
      await sleep(350); return true;
    };
    tab.of = (type) => tab.events.filter((e) => e.type === type);
    return tab;
  }
  function route(tab, { requestId, request, resourceType }) {
    const u = new URL(request.url);
    const answer = (code, headers, body = '') => quiet(send('Fetch.fulfillRequest', { requestId, responseCode: code, responseHeaders: headers, body: Buffer.from(body).toString('base64') }, tab.sessionId));
    if (u.hostname === '127.0.0.1') return quiet(send('Fetch.continueRequest', { requestId }, tab.sessionId));
    if (request.method === 'OPTIONS') return answer(204, CORS);
    if (u.hostname === 'bolt-staging.fly.dev') {
      if (u.pathname === '/api/public/analytics/events') {
        try { for (const e of JSON.parse(request.postData || '{}').events || []) tab.events.push({ type: e.event_type, data: e.event_data || {}, at: Date.now() }); } catch {}
      }
      return answer(200, [...CORS, { name: 'Content-Type', value: 'application/json' }], '{"ok":true}');
    }
    if (u.origin === APP && resourceType === 'Document') { tab.navs.push(request.url); return quiet(send('Fetch.failRequest', { requestId, errorReason: 'Aborted' }, tab.sessionId)); }
    return answer(200, [{ name: 'Content-Type', value: 'text/plain' }]);   // the app's files, Google, Meta, Streamable: nothing leaves
  }
  // Another tab in front: the page is really hidden (Chrome's own visibilitychange).
  async function hide(ctx, tab) {
    if (!tab.cover) tab.cover = (await send('Target.createTarget', { url: 'about:blank', browserContextId: ctx, newWindow: false })).targetId;
    await send('Target.activateTarget', { targetId: tab.cover }); await sleep(600);
  }
  const views = (tab) => tab.of('section_viewed').map((e) => e.data);
  const names = (tab) => views(tab).map((d) => d.placement);
  const msOf = (tab, name) => (views(tab).find((d) => d.placement === name) || {}).visible_ms;
  const within = (v, lo, hi) => typeof v === 'number' && v >= lo && v <= hi;

  console.log('[1] the rules, on the test page (a Pixel 7): 1.6 s per section, a 150 ms glance, a return, a nested section');
  {
    const ctx = await context(); const t = await openTab(ctx, PIXEL7);
    await t.go(TEST_PAGE);
    await sleep(1600);
    await t.to('.qa_b'); await sleep(1600);
    await t.to('.qa_c'); await sleep(150);
    await t.to('.qa_d'); await sleep(1600);
    await t.to('.qa_a'); await sleep(1600);     // back to A: already sent
    await t.to('.qa_outer'); await sleep(1600);
    await hide(ctx, t);
    console.log(`  sent: ${show(views(t))}`);
    ok(show(names(t)) === show(['qa_a', 'qa_b', 'qa_d', 'qa_outer']), `each section seen for 1 s is sent once, in order; the glance (qa_c), the hidden one and the nested one never (${show(names(t))})`);
    ok(['qa_a', 'qa_b', 'qa_d', 'qa_outer'].every((n) => within(msOf(t, n), 1300, 2700)), `each carries the time of its first look, about 1.6 s (${show(['qa_a', 'qa_b', 'qa_d', 'qa_outer'].map((n) => msOf(t, n)))})`);
    ok(views(t).every((d) => Object.keys(d).every((k) => SECTION_KEYS.has(k))), `nothing else rides along (${show([...new Set(views(t).flatMap((d) => Object.keys(d)))])})`);
    ok(t.errors.length === 0, `no exception (${show(t.errors)})`);
    await close(ctx);
  }

  console.log('[2] a page that loads behind another tab and is left unseen');
  {
    const ctx = await context(); const t = await openTab(ctx, PIXEL7);
    await hide(ctx, t);
    await t.go(TEST_PAGE);
    ok((await t.ev('document.visibilityState')) === 'hidden', 'the page loads hidden');
    await t.to('.qa_b'); await sleep(1800);
    await t.go('/privacy/');
    ok(t.of('section_viewed').length === 0, `nobody saw it: no section sent (${show(views(t))})`);
    await close(ctx);
  }

  // Chrome runs no visibility observer in a background tab at all, so [2] holds even without the page's
  // own rule. A prerendered page (as tools/visibility-check.mjs makes one) is laid out on screen but not
  // yet shown: only the page's rule keeps it from timing its sections.
  console.log('[2b] a prerendered page, never shown, then left');
  {
    const ctx = await context(); const t = await openTab(ctx, PIXEL7);
    await t.pre("window.__pr = true; Object.defineProperty(Document.prototype, 'prerendering', { configurable: true, get: function(){ return window.__pr; } });");
    await t.go(TEST_PAGE);
    ok((await t.ev('document.prerendering')) === true, 'the page is prerendering');
    await sleep(1800);
    await t.go('/privacy/');
    ok(t.of('section_viewed').length === 0, `never shown: no section sent (${show(views(t))})`);
    await close(ctx);
  }

  console.log('[3] the demo covers the page for 2 s of 4');
  {
    const ctx = await context(); const t = await openTab(ctx, PIXEL7);
    await t.go(TEST_PAGE);
    await sleep(1000);
    await t.ev("document.body.classList.add('demo-lock'), 1"); await sleep(2000);
    await t.ev("document.body.classList.remove('demo-lock'), 1"); await sleep(1000);
    await t.to('.qa_b'); await sleep(300);
    ok(within(msOf(t, 'qa_a'), 1700, 2900), `the section's time leaves out the 2 s under the demo (qa_a ${msOf(t, 'qa_a')} ms of ~4,300)`);
    await close(ctx);
  }

  console.log('[4] the home page on a Mac: a nav anchor, a sign-up link, a footer link');
  {
    const ctx = await context(); const t = await openTab(ctx, MAC);
    await t.go('/index.html');
    await sleep(1400);
    ok(await t.tap('header.nav a[href="#pricing"]'), 'tapped Pricing in the nav');
    await sleep(1600);
    ok(await t.tap('#pricing a[href^="https://app.boltanswering.com/signup"]'), 'tapped the pricing card\'s sign-up button');
    ok(await t.tap('footer a[href="/privacy/"]'), 'tapped Privacy in the footer');
    await sleep(800);
    const ctas = t.of('cta_clicked').map((e) => e.data);
    console.log(`  cta_clicked: ${show(ctas.map((d) => [d.placement, d.from]))}; trial: ${show(t.of('trial_link_clicked').map((e) => e.data.placement))}; sections: ${show(views(t))}`);
    ok(show(ctas.map((d) => [d.placement, d.from])) === show([['nav', 'anchor:pricing'], ['footer', 'page:/privacy/']]), 'the nav anchor and the footer link each send one cta_clicked; the sign-up button sends none');
    ok(ctas.every((d) => TARGET_RE.test(String(d.from))), `where a tap goes is a path, anchor, host or fixed word, never text (${show(ctas.map((d) => d.from))})`);
    ok(t.of('trial_link_clicked').length === 1 && t.of('trial_link_clicked')[0].data.placement === 'pricing', 'the sign-up button still sends trial_link_clicked (placement pricing)');
    ok(names(t).filter((n) => n === 'hero').length === 1 && msOf(t, 'hero') >= 1000, `the hero is sent once, with its time (${msOf(t, 'hero')} ms)`);
    ok(names(t).includes('pricing') && msOf(t, 'pricing') >= 1000, `pricing, scrolled to by the nav, is sent once the page is left (${msOf(t, 'pricing')} ms)`);
    ok(!names(t).includes('signup') && new Set(names(t)).size === names(t).length, `the hidden "how it works" section never, and no section twice (${show(names(t))})`);
    ok(t.errors.length === 0, `no exception (${show(t.errors)})`);
    await close(ctx);
  }

  console.log('[5] the handyman page on a Pixel 7: the hero\'s demo button, 2 s in the demo, back');
  {
    const ctx = await context(); const t = await openTab(ctx, PIXEL7);
    await t.go('/handyman.html');
    const t0 = Date.now();
    await sleep(1200);
    ok(await t.tap('section.tphero [data-demo-open]'), 'tapped the hero\'s demo button');
    let open = false; for (let i = 0; i < 40 && !open; i++) { open = await t.ev("document.body.classList.contains('demo-lock')"); if (!open) await sleep(100); }
    ok(open, 'the demo opened over the page');
    await sleep(2000);
    await t.ev("(function(){var b=document.querySelector('.demo-backdrop'); if (b) b.click(); return 1})()");
    await sleep(1000);
    const t1 = Date.now();
    await hide(ctx, t);
    const ctas = t.of('cta_clicked').map((e) => e.data);
    console.log(`  cta_clicked: ${show(ctas.map((d) => [d.placement, d.from]))}; demo_opened: ${show(t.of('demo_opened').map((e) => e.data.trigger))}; sections: ${show(views(t))}`);
    ok(show(ctas.map((d) => [d.placement, d.from])) === show([['tphero', 'demo']]), 'the demo button sends one cta_clicked: the hero, demo');
    ok(t.of('demo_opened').length === 1, 'demo.js still logs demo_opened');
    ok(typeof msOf(t, 'tphero') === 'number' && msOf(t, 'tphero') <= (t1 - t0) - 1500, `the hero's time leaves out the demo (${msOf(t, 'tphero')} ms of ${t1 - t0} ms on the page)`);
    ok(t.errors.length === 0, `no exception (${show(t.errors)})`);
    await close(ctx);
  }

  console.log(`\n${good} passed, ${bad} failed${NC ? ` (negative control ${NC})` : ''}`);
  ws.close();
} finally {
  chrome.kill('SIGKILL'); srv.close();
  await sleep(300); rmSync(PROFILE, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
