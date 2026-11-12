// AFMBP-2567 — the card-only ad landing pages (/start/<trade>.html, Figma 2142:11370).
// For each page, in headless Chrome at the node's phone size (402 wide) with an Android in-app UA:
//   - the card, the wordmark and the close sit where the node puts them;
//   - the button reads "Start your free trial", goes to the app's sign-up page, and attribution.js
//     decorates it with the visitor id and the ad tags;
//   - the page logs what the trade pages' card logs, so the ad funnel reads it the same way:
//     site_landed, signup_offer_opened (trigger quick_landing) once, trial_link_clicked with
//     placement "signup_offer" on the button, and Meta's StartTrialClick from that tap (the ad
//     sets' optimization event, "Landing page: Start now tap");
//   - the close goes to the home page and logs demo_closed {step: signup_offer};
//   - the page is noindex and is not in the sitemap.
// The ingest and the pixel are stubbed in the page; nothing reaches production.
// Run: node tools/quick-landing-check.mjs [siteRoot]
//      NC=<name> node tools/quick-landing-check.mjs   — one negative control (see MUTATE); each must FAIL.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = resolve(process.argv[2] || '.');
const NC = process.env.NC || '';
const PAGES = ['start/handyman.html', 'start/plumbing.html', 'start/general-contractor.html'];
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const UA = 'Mozilla/5.0 (Linux; Android 14; SM-A146U; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/490.0.0.49.79;]';

// Negative controls: break the served copy one way each; the run must then fail.
const MUTATE = {
  placement: (p, s) => s.replace('class="signup_offer ql-card"', 'class="ql-card"'),
  close: (p, s) => s.replace('<a class="ql-close" href="/"', '<a class="ql-close" href="/handyman.html"'),
  opened: (p, s) => s.replace("A.track('signup_offer_opened'", "A.track('signup_offer_seen'"),
  noindex: (p, s) => s.replace('<meta name="robots" content="noindex" />', ''),
  position: (p, s) => s.replace('.ql{position:relative;display:flex;justify-content:center;align-items:flex-start;padding:70px 0 40px}', '.ql{position:relative;display:flex;justify-content:center;align-items:flex-start;padding:90px 0 40px}'),
};
if (NC && !MUTATE[NC]) { console.error(`unknown NC=${NC}; one of ${Object.keys(MUTATE).join(', ')}`); process.exit(2); }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.xml': 'application/xml' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, path.endsWith('/') ? `${path}index.html` : path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end(); }
  let body = readFileSync(file);
  const rel = file.slice(ROOT.length + 1);
  if (NC && PAGES.includes(rel)) {
    const s = body.toString('utf8'); const t = MUTATE[NC](rel, s);
    if (t === s) { console.error(`NC=${NC}: the mutation did not land in ${rel}`); process.exit(2); }
    body = Buffer.from(t);
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// In-page stubs, before any script: the ingest records events, the pixel records its calls,
// and app.boltanswering.com (the button and the warm-up) is answered here instead.
const STUB = `(() => {
  window.__events = []; window.__fbq = [];
  window.fbq = function () { window.__fbq.push([].slice.call(arguments)); };
  const real = window.fetch.bind(window);
  window.fetch = (url, opts) => {
    const u = String(url && url.url || url);
    if (u.includes('/api/public/analytics/events')) {
      try { const b = JSON.parse(opts && opts.body || '{}'); for (const e of (b.events || [b])) window.__events.push({ type: e.event_type, data: e.event_data || {} }); } catch (e) {}
      return Promise.resolve(new Response('{}', { status: 200 }));
    }
    if (u.startsWith('https://app.boltanswering.com/')) return Promise.resolve(new Response('', { status: 404 }));
    return real(url, opts);
  };
})()`;

const results = [];
const check = (name, ok, info) => { results.push({ name, ok: !!ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok || info === undefined ? '' : ' ' + JSON.stringify(info)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

const prof = mkdtempSync(join(tmpdir(), 'ql-check-'));
const port = 9600 + Math.floor(Math.random() * 300);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--no-first-run', '--host-resolver-rules=MAP app.boltanswering.com 127.0.0.1:9, MAP *.facebook.com 127.0.0.1:9, MAP *.facebook.net 127.0.0.1:9, MAP www.googletagmanager.com 127.0.0.1:9, MAP browser.sentry-cdn.com 127.0.0.1:9', 'about:blank'], { stdio: 'ignore' });
let ws;
try {
  let wsUrl;
  for (let i = 0; i < 100 && !wsUrl; i++) { try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch {} if (!wsUrl) await sleep(100); }
  ws = new WebSocket(wsUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.value;
  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.setUserAgentOverride', { userAgent: UA });
  await send('Emulation.setDeviceMetricsOverride', { width: 402, height: 749, deviceScaleFactor: 1, mobile: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
  const load = async (url) => { await send('Page.navigate', { url }); for (let i = 0; i < 100; i++) { if (await ev(`document.readyState === 'complete'`).catch(() => false)) break; await sleep(100); } await sleep(700); };
  const sitemap = readFileSync(join(ROOT, 'sitemap.xml'), 'utf8');

  for (const page of PAGES) {
    console.log(`[${page}]`);
    const url = `${BASE}/${page}?utm_source=fb&utm_medium=paid&utm_campaign=signup_offer&fbclid=QLCHECK1`;
    // Each page is a new visitor: site_landed is logged once per browser session (attribution.js).
    await send('Storage.clearDataForOrigin', { origin: BASE, storageTypes: 'all' });
    await load(url);
    const g = await ev(`(() => { const r = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().toJSON() : null; };
      const cta = document.querySelector('.ql-cta'), x = document.querySelector('.ql-close');
      return { card: r('.ql-card'), logo: r('.ql-logo'), close: r('.ql-close'), ctaBox: r('.ql-cta'),
        ctaText: cta && cta.textContent.trim(), ctaHref: cta && cta.href, closeHref: x && x.getAttribute('href'),
        robots: (document.querySelector('meta[name=robots]') || {}).content || null,
        events: window.__events.map((e) => e.type) }; })()`);
    check('card at 31,70, 337x629 (node 2142:11418)', g.card && near(g.card.left, 31) && near(g.card.top, 70) && near(g.card.width, 337) && near(g.card.height, 629), g.card);
    check('wordmark at 26.3,10, 70.7x29.3 (node 2142:11451)', g.logo && near(g.logo.left, 26.33) && near(g.logo.top, 10) && near(g.logo.width, 70.67), g.logo);
    check('close: a 44px target centred on the node\'s cross (336.5, 101.5)', g.close && near(g.close.left + 22, 336.5) && near(g.close.top + 22, 101.5) && g.close.width === 44, g.close);
    check('button at 70,482 (node 2142:11445), 252x49', g.ctaBox && near(g.ctaBox.left, 70) && near(g.ctaBox.top, 482) && near(g.ctaBox.width, 252), g.ctaBox);
    check('button reads "Start your free trial"', g.ctaText === 'Start your free trial', g.ctaText);
    check('button goes to the app sign-up page, decorated with the visitor id and the ad tags', /^https:\/\/app\.boltanswering\.com\/signup\?bvid=[0-9a-f-]{36}&.*utm_campaign=signup_offer.*fbclid=QLCHECK1/.test(g.ctaHref || ''), g.ctaHref);
    check('close goes to the home page', g.closeHref === '/', g.closeHref);
    check('noindex', g.robots === 'noindex', g.robots);
    check('not in the sitemap', !sitemap.includes(`/${page}`));
    check('site_landed, then signup_offer_opened once', g.events.includes('site_landed') && g.events.filter((t) => t === 'signup_offer_opened').length === 1, g.events);
    const opened = await ev(`(window.__events.find((e) => e.type === 'signup_offer_opened') || {}).data`);
    check('signup_offer_opened: trigger quick_landing, on this page', opened && opened.trigger === 'quick_landing' && opened.page === `/${page}`, opened);

    // The button: trial_link_clicked with the card's placement, and Meta's StartTrialClick from it.
    await ev(`(() => { const a = document.querySelector('.ql-cta'); a.addEventListener('click', (e) => e.preventDefault()); a.click(); })()`);
    await sleep(300);
    const tap = await ev(`({ e: window.__events.filter((e) => e.type === 'trial_link_clicked').map((e) => e.data), f: window.__fbq.filter((c) => c[1] === 'StartTrialClick') })`);
    check('button tap: one trial_link_clicked, placement "signup_offer"', tap.e.length === 1 && tap.e[0].placement === 'signup_offer', tap.e);
    check('button tap: Meta StartTrialClick from "signup_offer"', tap.f.length === 1 && tap.f[0][2] && tap.f[0][2].from === 'signup_offer', tap.f);

    // The close: demo_closed for the card, then the home page.
    await ev(`(() => { const a = document.querySelector('.ql-close'); a.addEventListener('click', (e) => e.preventDefault()); a.click(); })()`);
    await sleep(300);
    const closed = await ev(`window.__events.filter((e) => e.type === 'demo_closed').map((e) => e.data)`);
    check('close tap: demo_closed {step: signup_offer}', closed.length === 1 && closed[0].step === 'signup_offer', closed);
  }
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill('SIGKILL'); server.close();
  await sleep(300); try { rmSync(prof, { recursive: true, force: true }); } catch {}
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length} checks, ${failed} failed${NC ? ` (NC=${NC}: expected to FAIL)` : ''}`);
process.exit(failed ? 1 : 0);
