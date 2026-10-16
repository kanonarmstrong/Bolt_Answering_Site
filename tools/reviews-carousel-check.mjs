// AFMBP-2250 — the home page's Reviews section: the owner's review-card carousel (3 rows, 60s loop;
// row 2 stops 10-15s, 25-30s, 40-45s, 55-60s) over the background, and one Figma quote card per
// stop (Quote 1-4) that grows in at the center of the screen and shrinks away.
// Drives the page's own CSS animations frame by frame (document.getAnimations(), the way the
// owner's carousel video was rendered) at 1440x900, 1280x800, 768x1024 and 390x844, and checks:
//   - layout: the 2000x404 band and the quote are centered in the section (vertically and
//     horizontally, to 1px), the page doesn't scroll sideways, each card stays 24px (desktop) or
//     the page padding (phones) inside the page;
//   - timing, every 50ms over the 60s loop: at most one quote shows, and only while row 2 is
//     stopped; quote k is fully shown for its whole hold; rows 1 and 3 keep moving during stops;
//   - each card is centered on the screen (to 1px) from the moment it appears to when it's gone,
//     grows from 92%, and is the Figma 919x196 (desktop) or the Figma mobile 491x359 scaled to fit;
//   - copy: names, trade lines, logos' alt and each quote word for word;
//   - reduced motion: the rows don't move and the cards only fade.
// Run: node tools/reviews-carousel-check.mjs [siteRoot]      SHOTS=<dir> also saves frames; STEP=500 samples coarser.
//      NC=late | NC=offcenter | NC=uncropped | NC=offset — negative controls on the SERVED copy; each must FAIL.
// Nothing leaves the machine: Chrome resolves no host but 127.0.0.1; every other request is answered locally.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

const ROOT = process.argv[2] ?? new URL('..', import.meta.url).pathname;
const NC = process.env.NC || '';
const SHOTS = process.env.SHOTS || '';
const STEP = +process.env.STEP || 50; // ms between timing samples (STEP=500 for a quick pass)
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2' };
const MUTATE = {
  // The quotes run half a second late: the last one is still on screen when row 2 moves again.
  late: (f, s) => (f.endsWith('review-carousel.css') ? s.replace('.rq--1 { animation-delay: 10s; }', '.rq--1 { animation-delay: 10.5s; }') : s),
  // The band sits at the top of the section instead of in the middle.
  offcenter: (f, s) => (f.endsWith('styles.css') ? s.replace('display:grid;place-items:center;min-height:404px;', 'display:grid;place-items:center;min-height:404px;padding-bottom:60px;') : s),
  // The section stops cropping the 2000px frame: the page scrolls sideways.
  uncropped: (f, s) => (f.endsWith('styles.css') ? s.replace('overflow:hidden;               /* AFMBP-2250', 'overflow:visible;               /* AFMBP-2250') : s),
  // Quote 2 sits off-center.
  offset: (f, s) => (f.endsWith('review-carousel.css') ? s.replace('.rq--2 { animation-delay: 25s; }', '.rq--2 { animation-delay: 25s; margin-left: 40px; }') : s),
};
if (NC && !MUTATE[NC]) throw new Error(`unknown NC "${NC}"; one of ${Object.keys(MUTATE).join(', ')}`);

// What each card says, typed here as plain text (Figma 2709:2696 / 2709:2736 / 2709:2716 / 2709:2756).
const QUOTES = [
  { name: 'Gus C.', meta: 'General Contractor, Massachusetts', logo: 'CNJ Construction', text: 'I used to waste time meeting with clients who weren’t serious. Bolt qualifies every caller upfront, so I only spend my time on real opportunities.', strong: 'I only spend my time on real opportunities.' },
  { name: 'Bret B.', meta: 'General Contractor, Indiana', logo: 'B. Brooks Builders', text: 'Bolt answered 3 calls last week while I was on jobs. One turned into a project worth $2,800. The thing paid for itself in a day.', strong: 'The thing paid for itself in a day.' },
  { name: 'Joe H.', meta: 'Handyman, Florida', logo: 'J&HS Handyman', text: 'My wife used to spend hours managing my calls and calendar. Now that Bolt handles our scheduling, she can focus on growing the business.', strong: 'focus on growing the business.' },
  { name: 'Josh C.', meta: 'Handyman, California', logo: 'JC Home Services, Inc.', text: 'I work in construction full-time, but I’m building a business to make extra money on the side. Now, I can keep working and I know Bolt is going to book the job.', strong: 'I can keep working and I know Bolt is going to book the job.' },
];
const STOPS = [10, 25, 40, 55]; // row 2's stops start (s); each lasts 5s
const SIZES = [[1440, 900], [1280, 800], [768, 1024], [390, 844]];

const PORT = 20000 + Math.floor(Math.random() * 10000), DBG = 30000 + Math.floor(Math.random() * 10000);
const srv = createServer((req, res) => {
  let f, body;
  try {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
    f = join(ROOT, p);
    if (statSync(f).isDirectory()) f = join(f, 'index.html');
    body = readFileSync(f);
  } catch { res.writeHead(404); res.end(); return; }
  if (NC && /\.(css|html)$/.test(f)) body = Buffer.from(MUTATE[NC](f, body.toString('utf8')));
  res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(body);
}).listen(PORT, '127.0.0.1');

const PROFILE = mkdtempSync(join(tmpdir(), 'cdp-2250-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', '--use-angle=metal', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0, good = 0;
const ok = (c, m) => { if (c) good++; else { bad++; console.log(`  FAIL ${m}`); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

try {
  let t = null;
  for (let i = 0; i < 100 && !t; i++) { try { t = (await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json()).find((x) => x.type === 'page'); } catch {} if (!t) await sleep(150); }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let nextId = 1; const pending = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  const CORS = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }];
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); return; }
    if (msg.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = msg.params;
    // A request the page abandons (it navigates to the next size) can't be continued any more:
    // Chrome rejects the command, which must not take the run down.
    const done = () => {};
    if (new URL(request.url).hostname === '127.0.0.1') return send('Fetch.continueRequest', { requestId }).catch(done);
    if (request.method === 'OPTIONS') return send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: CORS }).catch(done);
    return send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [...CORS, { name: 'Content-Type', value: 'application/json' }], body: Buffer.from('{}').toString('base64') }).catch(done);
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('bolt_qa','1')}catch(e){}" });
  const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result ? r.result.value : null; };
  const load = async (w, h, motion) => {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: motion }] });
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: w <= 768 ? 2 : 1, mobile: w <= 768 });
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?bolt_qa=1` });
    for (let i = 0; i < 100; i++) { if ((await ev("document.readyState === 'complete'")) === true) break; await sleep(100); }
    await ev('document.fonts.ready.then(() => true)');
    // Scroll first: the quote images are lazy, and they only start loading near the screen.
    await ev("(() => { document.querySelector('#reviews').scrollIntoView({ block: 'center', behavior: 'instant' }); return true; })()");
    const imgs = await ev("Promise.race([Promise.all([...document.querySelectorAll('#reviews img')].map((i) => i.decode().then(() => 1, () => 0))), new Promise((r) => setTimeout(() => r(null), 8000))]).then((v) => v && v.reduce((a, b) => a + b, 0))");
    ok(imgs === 12, `${w}: ${imgs} of 12 quote images decoded`);
    await sleep(300);
  };
  // Every CSS animation in the section, paused and set to the same point of the loop.
  const SEEK = (ms) => `(async () => { const as = document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('#reviews')); as.forEach((a) => { a.pause(); a.currentTime = ${ms}; }); return as.length; })()`;
  // Styles and boxes follow a seek at once; only a screenshot needs the frame painted.
  const PAINT = '(async () => { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return true; })()';
  const STATE = `(() => {
    const r = (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, cx: b.left + b.width / 2, cy: b.top + b.height / 2 }; };
    const tx = (e) => new DOMMatrixReadOnly(getComputedStyle(e).transform).m41;
    const rows = [1, 2, 3].map((n) => tx(document.querySelector('.rc-track--' + n)));
    const cards = [...document.querySelectorAll('.rq')].map((q) => ({ o: +getComputedStyle(q).opacity, r: r(q), t: getComputedStyle(q).transform }));
    const mid = [...document.querySelectorAll('.rc-track--2 .rc-card')].map(r);
    return { rows, cards, mid, sec: r(document.querySelector('#reviews')), inner: r(document.querySelector('.reviews__inner')), band: r(document.querySelector('.rc')), vw: innerWidth, sw: document.documentElement.scrollWidth };
  })()`;
  const shot = async (file) => {
    if (!SHOTS) return;
    await ev(PAINT);
    const b = await ev("(() => { const b = document.querySelector('#reviews').getBoundingClientRect(); return { x: 0, y: b.top + scrollY, w: innerWidth, h: b.height }; })()");
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: b.x, y: b.y, width: b.w, height: b.h, scale: 1 } });
    writeFileSync(join(SHOTS, file), Buffer.from(data, 'base64'));
  };
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });

  for (const [w, h] of SIZES) {
    const desktop = w >= 1024;
    console.log(`${w}x${h} (${desktop ? 'desktop card' : 'mobile card'}, centered)`);
    await load(w, h, 'no-preference');
    const n = await ev(SEEK(0));
    ok(n === 7, `${w}: ${n} animations in the section, want 7 (3 rows + 4 cards)`);
    // Copy.
    const copy = await ev(`[...document.querySelectorAll('.rq')].map((q) => ({ name: q.querySelector('.rq__name').textContent.trim(), meta: q.querySelector('.rq__meta').textContent.trim(), logo: q.querySelector('.rq__logo').alt, stars: q.querySelector('.rq__stars').alt, text: q.querySelector('.rq__text').textContent.replace(/\\s+/g, ' ').trim(), strong: q.querySelector('.rq__text strong').textContent.trim() }))`);
    ok(copy.length === 4, `${w}: ${copy.length} quote cards, want 4`);
    QUOTES.forEach((q, i) => {
      const c = copy[i] || {};
      ok(c.name === q.name && c.meta === q.meta && c.logo === q.logo && c.stars === 'Rated 5 out of 5', `${w}: card ${i + 1} is ${c.name} / ${c.meta} / ${c.logo}`);
      ok(c.text === q.text && c.strong === q.strong, `${w}: card ${i + 1} text differs: ${c.text}`);
    });
    // Layout (at 12s: quote 1 at full size).
    await ev(SEEK(12000));
    const L = await ev(STATE);
    ok(near(L.band.cy, L.sec.cy, 1) && near(L.inner.cy, L.sec.cy, 1), `${w}: band center ${L.band.cy.toFixed(1)} / stage ${L.inner.cy.toFixed(1)} vs section ${L.sec.cy.toFixed(1)}`);
    ok(near(L.band.cx, w / 2, 1) && near(L.band.w, 2000, 0.5) && near(L.band.h, 404, 0.5), `${w}: band ${L.band.w}x${L.band.h} centered at ${L.band.cx}`);
    ok(L.sw === L.vw, `${w}: page is ${L.sw}px wide in a ${L.vw}px window (sideways scroll)`);
    const q1 = L.cards[0];
    ok(near(q1.r.cy, L.sec.cy, 1), `${w}: quote 1 centered at y ${q1.r.cy.toFixed(1)}, section ${L.sec.cy.toFixed(1)}`);
    if (desktop) ok(near(q1.r.w, 919, 0.5) && near(q1.r.h, 196, 0.5), `${w}: quote 1 is ${q1.r.w}x${q1.r.h}, want 919x196`);
    else { const u = Math.min(1, (w - 2 * Math.min(80, Math.max(20, w * 0.05))) / 491); ok(near(q1.r.w, 491 * u, 0.6) && near(q1.r.h, 359 * u, 0.6) && near(q1.r.cx, w / 2, 1), `${w}: quote 1 is ${q1.r.w.toFixed(1)}x${q1.r.h.toFixed(1)} at ${q1.r.cx.toFixed(1)}, want ${(491 * u).toFixed(1)}x${(359 * u).toFixed(1)} centered`); }
    console.log(`  section ${L.sec.w}x${L.sec.h.toFixed(1)} · band 2000x404 centered · quote 1 ${q1.r.w.toFixed(1)}x${q1.r.h.toFixed(1)}`);
    // Each card at full size stays inside the page.
    for (let k = 0; k < 4; k++) {
      await ev(SEEK((STOPS[k] + 2.5) * 1000));
      const S = await ev(STATE);
      const c = S.cards[k].r, m = desktop ? 24 : Math.min(80, Math.max(20, w * 0.05));
      ok(c.x >= m - 0.5 && c.x + c.w <= w - m + 0.5, `${w}: quote ${k + 1} spans ${c.x.toFixed(1)}-${(c.x + c.w).toFixed(1)}, want inside ${m}-${w - m}`);
    }
    // Timing, every 50ms over the loop.
    let shown = 0, overlap = 0, moving = 0, holes = 0;
    const firstBad = [];
    let prev = null;
    for (let ms = 0; ms <= 60000; ms += STEP) {
      await ev(SEEK(ms));
      const S = await ev(STATE);
      const vis = S.cards.map((c, i) => (c.o > 0.01 ? i : -1)).filter((i) => i >= 0);
      if (vis.length > 1) { overlap++; if (firstBad.length < 3) firstBad.push(`${ms}ms: ${vis.length} cards`); }
      if (vis.length) {
        shown++;
        await ev(SEEK(ms + 40));
        const S2 = await ev(STATE);
        if (!near(S2.rows[1], S.rows[1], 0.01)) { moving++; if (firstBad.length < 3) firstBad.push(`${ms}ms: card ${vis[0] + 1} up while row 2 moves`); }
      }
      // Hold: in [S+0.75, S+4.25] the stop's card is fully shown.
      const k = STOPS.findIndex((s) => ms >= s * 1000 + 750 && ms <= s * 1000 + 4250);
      if (k >= 0 && !(S.cards[k].o > 0.999 && vis.length === 1 && vis[0] === k)) { holes++; if (firstBad.length < 3) firstBad.push(`${ms}ms: card ${k + 1} opacity ${S.cards[k].o}`); }
      prev = S;
    }
    ok(overlap === 0, `${w}: two cards at once at ${overlap} samples (${firstBad.join('; ')})`);
    ok(moving === 0, `${w}: a card shows while row 2 moves at ${moving} samples (${firstBad.join('; ')})`);
    ok(holes === 0, `${w}: a card isn't fully shown during its hold at ${holes} samples (${firstBad.join('; ')})`);
    ok(shown > 16000 / STEP, `${w}: cards show at only ${shown} of ${60000 / STEP + 1} samples`);
    // Rows 1 and 3 move during a stop.
    await ev(SEEK(11000)); const a = await ev(STATE); await ev(SEEK(12000)); const b = await ev(STATE);
    ok(!near(a.rows[0], b.rows[0], 1) && !near(a.rows[2], b.rows[2], 1) && near(a.rows[1], b.rows[1], 0.01), `${w}: during a stop rows move ${(b.rows[0] - a.rows[0]).toFixed(1)} / ${(b.rows[1] - a.rows[1]).toFixed(1)} / ${(b.rows[2] - a.rows[2]).toFixed(1)} px/s`);
    // Each card is centered on the screen while it shows, and grows from 92%.
    for (let k = 0; k < 4; k++) {
      for (const at of [STOPS[k] + 0.15, STOPS[k] + 0.45, STOPS[k] + 2.5, STOPS[k] + 4.55, STOPS[k] + 4.85]) {
        await ev(SEEK(at * 1000));
        const S = await ev(STATE);
        const q = S.cards[k].r;
        ok(near(q.cx, w / 2, 1) && near(q.cy, S.sec.cy, 1), `${w}: at ${at}s quote ${k + 1} is centered at ${q.cx.toFixed(1)},${q.cy.toFixed(1)}; the screen's middle is ${w / 2}, the section's ${S.sec.cy.toFixed(1)}`);
      }
      await ev(SEEK((STOPS[k] + 0.15) * 1000)); const a0 = await ev(STATE);
      await ev(SEEK((STOPS[k] + 2.5) * 1000)); const a1 = await ev(STATE);
      ok(near(a0.cards[k].r.w / a1.cards[k].r.w, 0.92, 0.002), `${w}: quote ${k + 1} starts at ${(100 * a0.cards[k].r.w / a1.cards[k].r.w).toFixed(1)}% of its size, want 92%`);
    }
    if (SHOTS) {
      for (const [label, at] of [['moving', 7], ['grow', 25.45], ['full', 27.5], ['shrink', 29.55]]) { await ev(SEEK(at * 1000)); await shot(`reviews-${w}-${label}.png`); }
      for (let k = 0; k < 4; k++) { await ev(SEEK((STOPS[k] + 2.5) * 1000)); await shot(`reviews-${w}-quote${k + 1}.png`); }
    }
    // Reduced motion: rows stand still, cards only fade.
    await load(w, h, 'reduce');
    await ev(SEEK(12000));
    const R = await ev(STATE);
    const rowAnims = await ev("document.getAnimations().filter((a) => a.effect.target.classList.contains('rc-track')).length");
    ok(rowAnims === 0 && R.rows.every((x) => x === 0), `${w}: reduced motion: ${rowAnims} row animations, rows at ${R.rows.join(', ')}`);
    ok(R.cards[0].o > 0.999 && R.cards[0].t === 'none', `${w}: reduced motion: quote 1 opacity ${R.cards[0].o}, transform ${R.cards[0].t}`);
    await ev(SEEK(10450));
    const R2 = await ev(STATE);
    ok(R2.cards[0].t === 'none' && R2.cards[0].o > 0.01 && R2.cards[0].o < 0.999, `${w}: reduced motion mid-fade: quote 1 opacity ${R2.cards[0].o}, transform ${R2.cards[0].t}`);
  }
  console.log(bad ? `FAIL ${bad} of ${good + bad}` : `PASS ${good} checks`);
  ws.close();
} finally {
  chrome.kill('SIGKILL'); srv.close();
  await sleep(300);
  rmSync(PROFILE, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
