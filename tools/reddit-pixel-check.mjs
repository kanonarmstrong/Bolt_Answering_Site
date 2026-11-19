// AFMBP-2639 — prove the Reddit pixel loads only when allowed and queues the right events once:
// init with the pixel ID and nothing else (no advanced matching), PageVisit once the page is seen,
// Lead on the first start-trial tap. It must load nothing for Global Privacy Control, an opt-out
// (this page, the next, and mid-page), our QA traffic (unless ?bolt_pixel_debug=1), or an automated
// browser. Every page that carries the Meta pixel must carry this one too, the blog template and the
// card-page builder included, so the blog bot's rebuilds keep it. AFMBP-2654: the cookies where
// Reddit's automatic matching kept hashed phone numbers and emails (_rdt_pn, _rdt_em) are gone before
// pixel.js runs, for every visitor. (tools/real-tags-check.mjs proves the same with Reddit's real script.)
// Run: node tools/reddit-pixel-check.mjs [siteRoot]
//      NC=<name> mutates the SERVED reddit-pixel.js only; each must FAIL (see MUTATE).
// Headless Chrome over CDP. Nothing leaves the machine: Chrome resolves no host but 127.0.0.1;
// requests for Reddit's pixel.js are answered locally with an empty script (so the base code's
// window.rdt.callQueue keeps every call for the assertions below), Meta's fbevents.js gets an empty
// script, the ingest and the demo API are stubbed in-page, and app.boltanswering.com navigations are
// cancelled. The served reddit-pixel.js carries a test pixel ID, never the live one.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, relative } from 'node:path';

const ROOT = process.argv[2] ?? new URL('..', import.meta.url).pathname;
const PORT = 20000 + Math.floor(Math.random() * 10000), DBG = 30000 + Math.floor(Math.random() * 10000);
const TEST_ID = 't2_testpixel0001';
const NC = process.env.NC || '';
const cut = (s, from, to) => { if (!s.includes(from)) throw new Error(`NC anchor missing: ${from}`); return s.split(from).join(to); };
const MUTATE = {
  // Our QA traffic loads the pixel like anyone else.
  no_qa: (s) => cut(s, "if (qa && get('bolt_pixel_debug', 'session') !== '1') return 'qa';", "if (false) return 'qa';"),
  // Every tap counts: a second tap on the same page sends a second Lead.
  lead_twice: (s) => cut(s, '      if (leadSent) return;\n', ''),
  // Advanced matching: the init call carries an email.
  matching: (s) => cut(s, "window.rdt('init', PIXEL_ID);", "window.rdt('init', PIXEL_ID, { email: 'qa-pc@example.com' });"),
  // Loads on a page nobody has seen yet (a preload or prerender).
  no_wait: (s) => cut(s, '  if (whenVisible) whenVisible(loadPixel);\n', '  if (whenVisible) loadPixel();\n'),
  // Switching off mid-page does not stop the Lead on that page.
  no_midpage: (s) => cut(s, '    if (blockedBy() !== null) { window.boltReddit.enabled = false; return; }\n', ''),
  // The cookies Reddit's automatic matching filled on 2026-11-19 are left in place.
  no_cleanup: (s) => cut(s, '  clearRedditMatchCookies();\n', ''),
};
if (NC && !MUTATE[NC]) throw new Error(`unknown NC "${NC}"; one of ${Object.keys(MUTATE).join(', ')}`);
if (NC) { const src = readFileSync(join(ROOT, 'reddit-pixel.js'), 'utf8'); if (MUTATE[NC](src) === src) throw new Error(`NC ${NC} leaves reddit-pixel.js unchanged`); }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.webp': 'image/webp' };
const srv = createServer((req, res) => {
  try {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
    let f = join(ROOT, p); if (statSync(f).isDirectory()) f = join(f, 'index.html');
    let body = readFileSync(f);
    if (p.endsWith('reddit-pixel.js')) {
      const src = body.toString('utf8');
      const ID_LINE = /var PIXEL_ID = '[A-Za-z0-9_]*';/;
      if ((src.match(new RegExp(ID_LINE.source, 'g')) || []).length !== 1) throw new Error('reddit-pixel.js must carry exactly one PIXEL_ID line');
      body = Buffer.from((NC ? MUTATE[NC] : (x) => x)(src.replace(ID_LINE, `var PIXEL_ID = '${TEST_ID}';`)));
    }
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(PORT, '127.0.0.1');

const PROFILE = mkdtempSync(join(tmpdir(), 'cdp-2639-')); // removed at exit
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--window-size=1280,900', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
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
const STUB = `window.__sent = [];
(function(){ var real = window.fetch;
  function json(o, s){ return Promise.resolve(new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json' } })); }
  window.fetch = function(url, init){
    var u = String(url);
    if (u.indexOf('/api/public/analytics/events') >= 0) { try { JSON.parse(init.body).events.forEach(function(e){ window.__sent.push({ type: e.event_type }); }); } catch (x) {} return json({ ok: true }); }
    if (u.indexOf('/api/demo/') >= 0) return json({ ok: true });
    if (u.indexOf('bolt-staging.fly.dev') >= 0) return json({ error: 'stubbed' }, 500);
    return real.apply(this, arguments); }; })();
window.addEventListener('click', function (e) { var a = e.target && e.target.closest && e.target.closest('a'); if (a && /app\\.boltanswering\\.com/.test(a.href)) e.preventDefault(); });`;
const HIDDEN = `window.__vs = 'hidden';
Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: function(){ return window.__vs; } });
Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: function(){ return window.__vs !== 'visible'; } });`;
const GPC = `Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { configurable: true, get: function(){ return true; } });`;
const WD = (v) => `Object.defineProperty(Navigator.prototype, 'webdriver', { configurable: true, get: function(){ return ${v}; } });`;
// The calls Reddit's base code queued, as plain arrays.
const QUEUE = "JSON.stringify(window.rdt && window.rdt.callQueue ? Array.prototype.map.call(window.rdt.callQueue, function (a) { return Array.prototype.slice.call(a); }) : [])";

// One browser context per scenario; `steps` are page loads in that same context (storage persists).
async function scenario({ name, steps, pre = '', automated = false }) {
  const { browserContextId } = await send('Target.createBrowserContext');
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId); await send('Runtime.enable', {}, sessionId);
  await send('Fetch.enable', { patterns: [{ urlPattern: 'https://www.redditstatic.com/*' }, { urlPattern: 'https://connect.facebook.net/*' }, { urlPattern: 'https://app.boltanswering.com/*' }] }, sessionId);
  let loads = 0; const loadUrls = []; const errors = [];
  const onMsg = async (m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Fetch.requestPaused') {
      const u = m.params.request.url; const js = !u.startsWith('https://app.boltanswering.com/');
      const rd = u.startsWith('https://www.redditstatic.com/');
      if (rd) { loads++; loadUrls.push(u); }
      // Reddit's pixel.js stub notes the cookies it would see, for [10].
      const body = rd ? 'window.__rdtCookieAtLoad = document.cookie;' : js ? '/* stub */' : '<p>stub</p>';
      await send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: js ? 'text/javascript' : 'text/html' }], body: Buffer.from(body).toString('base64') }, sessionId).catch(() => {});
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
      q: JSON.parse(await evalv(QUEUE)),
      reddit: JSON.parse(await evalv('JSON.stringify(window.boltReddit || null)')),
      hasRdt: await evalv("typeof window.rdt === 'function'"),
      sent: JSON.parse(await evalv('JSON.stringify(window.__sent || [])')),
      loads, loadUrls: [...loadUrls],
      probe: step.probe ? await evalv(step.probe) : undefined,
    });
  }
  listeners.splice(listeners.indexOf(onMsg), 1);
  if (errors.length) console.log(`    page errors in "${name}": ${errors.join(' | ')}`);
  await send('Target.disposeBrowserContext', { browserContextId });
  return out;
}

let fails = 0; const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) fails++; };
const calls = (r) => r.q.map((c) => c.slice(0, 2).join(':') + (c.length > 2 ? '+' + JSON.stringify(c.slice(2)) : '')).join(', ') || 'none';
const tracks = (r, ev) => r.q.filter((c) => c[0] === 'track' && c[1] === ev);
const AD = '/start/handyman.html?utm_source=reddit&utm_medium=paid_social&utm_campaign=signup_offer&rdt_cid=TESTCLICK';
const TAP = (times) => `(async () => { const w = (t) => new Promise((r) => setTimeout(r, t)); await w(1200);
  const a = [...document.querySelectorAll('a')].find(x => /app\\.boltanswering\\.com\\/signup/.test(x.href) && !x.closest('.demo-backdrop'));
  for (let i = 0; i < ${times} && a; i++) { a.click(); await w(300); }
  return !!a; })()`;
const LEAD = "(window.rdt && Array.prototype.some.call(window.rdt.callQueue || [], function (c) { return c[1] === 'Lead'; }))";
const VISIT = "(window.rdt && Array.prototype.some.call(window.rdt.callQueue || [], function (c) { return c[1] === 'PageVisit'; }))";

console.log('[0] every page with the Meta pixel carries the Reddit pixel (pages, blog template, card builder)');
const walk = (dir) => readdirSync(dir).flatMap((n) => { const f = join(dir, n); if (n === 'node_modules' || n.startsWith('.')) return []; return statSync(f).isDirectory() ? walk(f) : [f]; });
const META_TAG = /<script defer src="\/meta-pixel\.js\?v=\d+"><\/script>/, RD_TAG = /<script defer src="\/reddit-pixel\.js\?v=\d+"><\/script>/;
const htmls = walk(ROOT).filter((f) => f.endsWith('.html') && !relative(ROOT, f).startsWith('tools'));
const withMeta = htmls.filter((f) => META_TAG.test(readFileSync(f, 'utf8')));
const missing = withMeta.filter((f) => !RD_TAG.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f));
ok(withMeta.length > 0 && missing.length === 0, `${withMeta.length} pages carry the Meta pixel; missing the Reddit pixel: ${missing.join(', ') || 'none'}`);
const tpl = readFileSync(join(ROOT, 'tools/blog/lib/templates.mjs'), 'utf8'), bld = readFileSync(join(ROOT, 'tools/quick-landing-build.mjs'), 'utf8');
ok(RD_TAG.test(tpl), 'the blog template (the blog bot rebuilds from it) carries it');
ok(/tag\('reddit-pixel'\)/.test(bld) && bld.includes('${SCRIPTS.reddit}'), 'the card-page builder carries it');

console.log('[1] visible ad visit on the card page');
const [r1] = await scenario({ name: 'visible', steps: [{ path: AD, until: VISIT }] });
console.log(`    ${calls(r1)}`);
ok(r1.loads === 1 && r1.loadUrls[0] === `https://www.redditstatic.com/ads/pixel.js?pixel_id=${TEST_ID}`, `pixel.js requested once, for the served ID (${r1.loads})`);
ok(JSON.stringify(r1.q[0]) === JSON.stringify(['init', TEST_ID]), `init carries the ID and nothing else (${JSON.stringify(r1.q[0])})`);
ok(tracks(r1, 'PageVisit').length === 1 && r1.q.length === 2, 'one PageVisit, nothing else');
ok(r1.reddit?.enabled === true && r1.reddit?.blockedBy === null, 'window.boltReddit says it runs');
ok(r1.sent.some((e) => e.type === 'site_landed'), 'first-party events still go to the ingest');

console.log('[2] start-trial tapped twice on the card page: one Lead');
const [r2] = await scenario({ name: 'lead', steps: [{ path: AD, act: TAP(2), until: LEAD, waitMs: 800 }] });
console.log(`    ${calls(r2)}`);
ok(tracks(r2, 'Lead').length === 1 && tracks(r2, 'Lead')[0].length === 2, `one Lead, no extra data (${JSON.stringify(tracks(r2, 'Lead'))})`);
ok(r2.sent.filter((e) => e.type === 'trial_link_clicked').length >= 1, 'the first-party trial_link_clicked still goes');

console.log('[2b] start-trial on a trade page: Lead');
const [r2b] = await scenario({ name: 'lead trade', steps: [{ path: '/hvac.html?utm_source=reddit', act: TAP(1), until: LEAD }] });
ok(tracks(r2b, 'Lead').length === 1, `one Lead (${calls(r2b)})`);

console.log('[3] Global Privacy Control');
const [r3] = await scenario({ name: 'gpc', pre: GPC, steps: [{ path: AD, act: TAP(1), waitMs: 2500 }] });
ok(r3.loads === 0 && !r3.hasRdt && r3.reddit?.blockedBy === 'gpc', `nothing loads, nothing queued (${r3.reddit?.blockedBy})`);

console.log('[4] opt-out persists until cleared');
const r4 = await scenario({ name: 'optout', steps: [{ path: '/index.html?bolt_optout=1', waitMs: 2000 }, { path: AD, waitMs: 2000 }, { path: `${AD}&bolt_optout=0`, until: VISIT }] });
ok(r4[0].loads === 0 && r4[1].loads === 0 && !r4[1].hasRdt && r4[1].reddit?.blockedBy === 'opted_out', 'opted out: nothing on this page or the next');
ok(r4[2].loads === 1 && tracks(r4[2], 'PageVisit').length === 1, '?bolt_optout=0 turns it back on');

console.log('[5] our QA traffic, and the debug override');
const r5 = await scenario({ name: 'qa', steps: [{ path: '/index.html?bolt_qa=1', waitMs: 2000 }, { path: AD, waitMs: 2000 }, { path: '/index.html?bolt_pixel_debug=1', until: VISIT }] });
ok(r5[0].loads === 0 && !r5[0].hasRdt && r5[0].reddit?.blockedBy === 'qa', `QA browser: nothing loads (${r5[0].reddit?.blockedBy})`);
ok(r5[1].loads === 0 && !r5[1].hasRdt, 'and still nothing on the card page');
ok(r5[2].loads === 1 && tracks(r5[2], 'PageVisit').length === 1, 'bolt_pixel_debug=1 loads it on a QA browser');
const [r5b] = await scenario({ name: 'demoqa', steps: [{ path: '/index.html?demoqa=1', waitMs: 2000 }] });
ok(r5b.loads === 0 && r5b.reddit?.blockedBy === 'qa', 'demoqa=1: nothing loads');

console.log('[6] automated browser');
const [r6] = await scenario({ name: 'webdriver', automated: true, steps: [{ path: AD, waitMs: 2500 }] });
ok(r6.loads === 0 && !r6.hasRdt && r6.reddit?.blockedBy === 'automated', `nothing loads (${r6.reddit?.blockedBy})`);

console.log('[7] hidden page (preload): nothing until seen');
const [r7] = await scenario({ name: 'hidden', pre: HIDDEN, steps: [{ path: AD, waitMs: 2500 }] });
ok(r7.loads === 0 && !r7.hasRdt, 'no request and no PageVisit while hidden');
const [r7b] = await scenario({ name: 'hidden→visible', pre: HIDDEN, steps: [{ path: AD, act: "setTimeout(() => { window.__vs = 'visible'; document.dispatchEvent(new Event('visibilitychange')); }, 1200)", until: VISIT }] });
ok(r7b.loads === 1 && tracks(r7b, 'PageVisit').length === 1, 'loads and queues one PageVisit once seen');

console.log('[8] switched off mid-page (the Privacy Choices switch writes the same key): no Lead');
const OFF_THEN_TAP = `(async () => { const w = (t) => new Promise((r) => setTimeout(r, t)); await w(1200);
  localStorage.setItem('bolt_optout', '1');
  const a = [...document.querySelectorAll('a')].find(x => /app\\.boltanswering\\.com\\/signup/.test(x.href) && !x.closest('.demo-backdrop'));
  a && a.click(); await w(600); return true; })()`;
const [r8] = await scenario({ name: 'midpage', steps: [{ path: AD, act: OFF_THEN_TAP, waitMs: 1200 }] });
ok(tracks(r8, 'PageVisit').length === 1 && tracks(r8, 'Lead').length === 0 && r8.reddit?.enabled === false, `PageVisit before, no Lead after (${calls(r8)})`);

console.log('[9] a blog page (built from the template) loads it');
const [r9] = await scenario({ name: 'blog', steps: [{ path: '/blog/index.html?utm_source=reddit', until: VISIT }] });
ok(r9.loads === 1 && tracks(r9, 'PageVisit').length === 1, `one PageVisit (${calls(r9)})`);

console.log("[10] the cookies Reddit's automatic matching filled on 11-19 (_rdt_pn, _rdt_em) are gone before pixel.js runs");
const SEED = "document.cookie = '_rdt_pn=:500~seedphonehash; path=/'; document.cookie = '_rdt_em=seed|400~seedemailhash; path=/'; window.__seeded = document.cookie;";
const COOKIES = "JSON.stringify({ seeded: window.__seeded || '', atLoad: window.__rdtCookieAtLoad === undefined ? null : window.__rdtCookieAtLoad, now: document.cookie })";
const hasRdtCookies = (s) => /(^|; )_rdt_(pn|em)=/.test(s || '');
const [r10] = await scenario({ name: 'cookies', pre: SEED, steps: [{ path: AD, until: 'window.__rdtCookieAtLoad !== undefined', probe: COOKIES }] });
const c10 = JSON.parse(r10.probe);
ok(hasRdtCookies(c10.seeded), 'setup: both cookies are there when the page starts');
ok(r10.loads === 1 && c10.atLoad !== null && !hasRdtCookies(c10.atLoad), `gone when pixel.js runs (it saw: ${c10.atLoad === null ? 'pixel.js never ran' : c10.atLoad || 'no cookies'})`);
ok(!hasRdtCookies(c10.now), 'and still gone after');
const [r10b] = await scenario({ name: 'cookies-gpc', pre: SEED + GPC, steps: [{ path: AD, waitMs: 2000, probe: COOKIES }] });
const c10b = JSON.parse(r10b.probe);
ok(r10b.loads === 0 && hasRdtCookies(c10b.seeded) && !hasRdtCookies(c10b.now), 'deleted for a visitor the pixel never loads for (GPC) too');

console.log(fails ? `\n${fails} FAILED${NC ? ` (negative control: ${NC})` : ''}` : `\nALL PASS${NC ? ` — negative control ${NC} did NOT bite` : ''}`);
ws.close(); chrome.kill('SIGKILL'); srv.close(); await sleep(300); rmSync(PROFILE, { recursive: true, force: true }); process.exit(fails ? 1 : 0);
