// AFMBP-2250 / 2265 / 2267 / 2269 / 2283 / 2284 / 2285 / 2299 — the home page's Reviews section: the
// owner's review-card carousel over the background (one row since 2299, 31.8s loop: it stops 6.85s
// then moves 1.11s, four times), one Figma quote card per stop (Quote 1-4) that grows in at the
// center of the screen with a small bounce and shrinks away, and nothing moving until the section
// is on screen. Drives the page's own CSS animations frame by frame (document.getAnimations(), the
// way the owner's carousel video was rendered) at 1440x900, 1280x800, 768x1024 and 390x844:
//   - start: with the section off screen everything waits at its first frame; once it's on
//     screen Gus's card (the first stop) appears within a second;
//   - layout: the 2000x404 band and the card are centered in the section (to 1px), the page
//     doesn't scroll sideways, each card stays 24px (desktop) or the page padding (phones)
//     inside the page, and inside the section, even at the top of its bounce; the section is
//     56% of 404 + 2 x clamp(60px, 7vw, 90px) on desktop (327 at 1440) and 70% on phones (367 at
//     390), but below 1024px never shorter than the quote card's peak + 24px above and below (479
//     at 768); on desktop the card's peak stays 40px+ clear of the How It Works phone poking up
//     into the section; at every width the background is the old cover size zoomed in 20%;
//   - the row: just one (434x93 cards on the design's middle line), still through each stop and
//     ~946.7 px/s while it moves;
//   - timing, every 50ms over the loop: at most one card shows, and only while the row is
//     stopped; card k is fully shown for its whole hold (0.775s-6.175s into its stop);
//   - the bounce: 92% at the start, 120% at the top, 115% at rest (of the card's own size), and
//     each card is the Figma 919x196 (desktop) or the Figma mobile 491x359, scaled to fit;
//   - copy: names, trade lines, logos' alt and each quote word for word;
//   - reduced motion: the row doesn't move and the cards only fade.
// Run: node tools/reviews-carousel-check.mjs [siteRoot]      SHOTS=<dir> also saves frames; STEP=500 samples coarser.
//      NC=late | NC=offcenter | NC=uncropped | NC=offset | NC=autostart | NC=nobounce | NC=tall | NC=mtall
//      | NC=oldloop | NC=nozoom | NC=d80 | NC=tworows
//      — negative controls on the SERVED copy; each must FAIL.
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
const css = (f, s, a, b) => (f.endsWith('review-carousel.css') ? s.replace(a, b) : s);
const MUTATE = {
  // The first card runs half a second late: it's still on screen when row 2 moves.
  late: (f, s) => css(f, s, '.rq--1 { animation-delay: 0s; }', '.rq--1 { animation-delay: 0.5s; }'),
  // The band sits off the section's middle.
  offcenter: (f, s) => (f.endsWith('styles.css') ? s.replace('display:grid;place-items:center;min-height:404px;', 'display:grid;place-items:center;min-height:404px;padding-bottom:60px;') : s),
  // The section stops cropping the 2000px frame: the page scrolls sideways.
  uncropped: (f, s) => (f.endsWith('styles.css') ? s.replace('overflow:hidden;               /* AFMBP-2250', 'overflow:visible;               /* AFMBP-2250') : s),
  // Quote 2 sits off-center.
  offset: (f, s) => css(f, s, '.rq--2 { animation-delay: 7.96111s; }', '.rq--2 { animation-delay: 7.96111s; margin-left: 40px; }'),
  // Everything runs from page load, before the section is on screen.
  autostart: (f, s) => css(f, s, '.reviews:not(.reviews--on) .rq { animation-play-state: paused; }', '.reviews:not(.reviews--on) .rq { animation-play-state: running; }'),
  // No bounce: the card goes straight to its resting size.
  nobounce: (f, s) => css(f, s, 'opacity: 1; transform: scale(1.2);', 'opacity: 1; transform: scale(1.15);'),
  // The desktop section keeps its full height (before AFMBP-2269).
  tall: (f, s) => css(f, s, '@media (min-width: 1024px) {\n  .reviews { padding: 0; }', '@media (min-width: 99999px) {\n  .reviews { padding: 0; }'),
  // Phones and tablets keep their full height and the plain cover background (before AFMBP-2283).
  mtall: (f, s) => css(f, s, '@media (max-width: 1023px) {\n  .reviews { padding: 0; }', '@media (max-width: 1px) {\n  .reviews { padding: 0; }'),
  // The background back on plain cover at every width (before AFMBP-2283 / AFMBP-2285).
  nozoom: (f, s) => css(f, s, '.reviews { background-size: calc(1.2', '.reviews { --nozoom: calc(1.2'),
  // The row on the old 28.9s loop while the cards keep the new schedule (before AFMBP-2299).
  oldloop: (f, s) => css(f, s, 'animation: rc-row2 31.84444s', 'animation: rc-row2 28.88889s'),
  // The desktop section back at 70% (before AFMBP-2299).
  d80: (f, s) => css(f, s, 'min-height: calc(0.56 *', 'min-height: calc(0.7 *'),
  // A second carousel row comes back (before AFMBP-2299 there were three).
  tworows: (f, s) => (f.endsWith('index.html') ? s.replace('<div class="rc-row rc-row--2">', '<div class="rc-row rc-row--1"><ul class="rc-track rc-track--1"><li class="rc-card"></li></ul></div><div class="rc-row rc-row--2">') : s),
};
if (NC && !MUTATE[NC]) throw new Error(`unknown NC "${NC}"; one of ${Object.keys(MUTATE).join(', ')}`);

// What each card says, typed here as plain text (Figma 2709:2696 / 2709:2736 / 2709:2716 / 2709:2756).
const QUOTES = [
  { name: 'Gus C.', meta: 'General Contractor, Massachusetts', logo: 'CNJ Construction', text: 'I used to waste time meeting with clients who weren’t serious. Bolt qualifies every caller upfront, so I only spend my time on real opportunities.', strong: 'I only spend my time on real opportunities.' },
  { name: 'Bret B.', meta: 'General Contractor, Indiana', logo: 'B. Brooks Builders', text: 'Bolt answered 3 calls last week while I was on jobs. One turned into a project worth $2,800. The thing paid for itself in a day.', strong: 'The thing paid for itself in a day.' },
  { name: 'Joe H.', meta: 'Handyman, Florida', logo: 'J&HS Handyman', text: 'My wife used to spend hours managing my calls and calendar. Now that Bolt handles our scheduling, she can focus on growing the business.', strong: 'focus on growing the business.' },
  { name: 'Josh C.', meta: 'Handyman, California', logo: 'JC Home Services, Inc.', text: 'I work in construction full-time, but I’m building a business to make extra money on the side. Now, I can keep working and I know Bolt is going to book the job.', strong: 'I can keep working and I know Bolt is going to book the job.' },
];
const STOP_LEN = 6.85, CYCLE = 6.85 + 10 / 9;       // the row stops 6.85s, then moves 1.11s
const LOOP = 4 * CYCLE * 1000;                     // 31.844s
const STOPS = [0, 1, 2, 3].map((k) => k * CYCLE); // the stops start (s)
const CARD = { in: 75, peak: 525, rest: 775, out: 6175, gone: 6775 }; // ms into its stop
const SPEED = 946.7;                               // px/s while the row moves
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
  const open = async (w, h, motion) => {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: motion }] });
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: w <= 768 ? 2 : 1, mobile: w <= 768 });
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?bolt_qa=1` });
    for (let i = 0; i < 100; i++) { if ((await ev("document.readyState === 'complete'")) === true) break; await sleep(100); }
    await ev('document.fonts.ready.then(() => true)');
  };
  const toSection = async () => {
    // Scroll first: the quote images are lazy, and they only start loading near the screen.
    await ev("(() => { document.querySelector('#reviews').scrollIntoView({ block: 'center', behavior: 'instant' }); return true; })()");
    const imgs = await ev("Promise.race([Promise.all([...document.querySelectorAll('#reviews img')].map((i) => i.decode().then(() => 1, () => 0))), new Promise((r) => setTimeout(() => r(null), 8000))]).then((v) => v && v.reduce((a, b) => a + b, 0))");
    await sleep(300);
    return imgs;
  };
  const ANIMS = "document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('#reviews'))";
  // Every CSS animation in the section, paused and set to the same point of the loop.
  const SEEK = (ms) => `(() => { const as = ${ANIMS}; as.forEach((a) => { a.pause(); a.currentTime = ${ms}; }); return as.length; })()`;
  // Styles and boxes follow a seek at once; only a screenshot needs the frame painted.
  const PAINT = '(async () => { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return true; })()';
  const STATE = `(() => {
    const r = (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, cx: b.left + b.width / 2, cy: b.top + b.height / 2 }; };
    const tx = (e) => new DOMMatrixReadOnly(getComputedStyle(e).transform).m41;
    const row = tx(document.querySelector('.rc-track--2')), tracks = document.querySelectorAll('.rc-track').length;
    const cards = [...document.querySelectorAll('.rq')].map((q) => ({ o: +getComputedStyle(q).opacity, r: r(q), t: getComputedStyle(q).transform, w0: q.offsetWidth, h0: q.offsetHeight }));
    const rowCard = (n) => r(document.querySelector('.rc-track--' + n + ' .rc-card'));
    return { row, tracks, cards, card2: rowCard(2), sec: r(document.querySelector('#reviews')), inner: r(document.querySelector('.reviews__inner')), band: r(document.querySelector('.rc')), vw: innerWidth, sw: document.documentElement.scrollWidth };
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
    const pad = Math.min(80, Math.max(20, w * 0.05));
    console.log(`${w}x${h} (${desktop ? 'desktop card' : 'mobile card'}, centered)`);
    // Start: off screen everything waits at its first frame; on screen, Gus's card shows.
    await open(w, h, 'no-preference');
    await sleep(1500);
    const off = await ev(`(() => { const as = ${ANIMS}; return { n: as.length, paused: as.filter((a) => a.playState === 'paused').length, t: Math.max(...as.map((a) => +a.currentTime || 0)), o: +getComputedStyle(document.querySelector('.rq--1')).opacity, on: document.querySelector('#reviews').classList.contains('reviews--on') }; })()`);
    ok(off.n === 5 && off.paused === 5 && off.t === 0 && off.o === 0 && !off.on, `${w}: before the section is on screen ${off.paused} of ${off.n} animations wait, furthest at ${off.t}ms, Gus at opacity ${off.o}`);
    const imgs = await toSection();
    ok(imgs === 12, `${w}: ${imgs} of 12 quote images decoded`);
    await sleep(700);
    const on = await ev(`(() => { const as = ${ANIMS}; return { running: as.filter((a) => a.playState === 'running').length, o: +getComputedStyle(document.querySelector('.rq--1')).opacity }; })()`);
    ok(on.running === 5 && on.o > 0.5, `${w}: after scrolling to the section ${on.running} of 5 animations run, Gus at opacity ${on.o.toFixed(2)}`);
    // Copy.
    const copy = await ev(`[...document.querySelectorAll('.rq')].map((q) => ({ name: q.querySelector('.rq__name').textContent.trim(), meta: q.querySelector('.rq__meta').textContent.trim(), logo: q.querySelector('.rq__logo').alt, stars: q.querySelector('.rq__stars').alt, text: q.querySelector('.rq__text').textContent.replace(/\\s+/g, ' ').trim(), strong: q.querySelector('.rq__text strong').textContent.trim() }))`);
    ok(copy.length === 4, `${w}: ${copy.length} quote cards, want 4`);
    QUOTES.forEach((q, i) => {
      const c = copy[i] || {};
      ok(c.name === q.name && c.meta === q.meta && c.logo === q.logo && c.stars === 'Rated 5 out of 5', `${w}: card ${i + 1} is ${c.name} / ${c.meta} / ${c.logo}`);
      ok(c.text === q.text && c.strong === q.strong, `${w}: card ${i + 1} text differs: ${c.text}`);
    });
    // Layout (2.5s into the first stop: Gus at rest).
    await ev(SEEK(2500));
    const L = await ev(STATE);
    ok(near(L.band.cy, L.sec.cy, 1) && near(L.inner.cy, L.sec.cy, 1), `${w}: band center ${L.band.cy.toFixed(1)} / stage ${L.inner.cy.toFixed(1)} vs section ${L.sec.cy.toFixed(1)}`);
    ok(near(L.band.cx, w / 2, 1) && near(L.band.w, 2000, 0.5) && near(L.band.h, 404, 0.5), `${w}: band ${L.band.w}x${L.band.h} centered at ${L.band.cx}`);
    ok(L.sw === L.vw, `${w}: page is ${L.sw}px wide in a ${L.vw}px window (sideways scroll)`);
    // Section height: 30% less than the frame plus clamp(60px, 7vw, 90px) top and bottom; below
    // 1024px never less than the mobile card's peak (359 x 1.2 Figma px) + 24px above and below.
    const fullH = 404 + 2 * Math.min(90, Math.max(60, w * 0.07));
    const cardFloor = desktop ? 0 : 430.8 * Math.min(1, (w - 2 * pad) / 589.2) + 48;
    const share = desktop ? 0.56 : 0.7, wantH = Math.max(share * fullH, cardFloor);
    ok(near(L.sec.h, wantH, 0.6), `${w}: section is ${L.sec.h.toFixed(1)}px tall, want ${wantH.toFixed(1)} (${share * 100}% of ${fullH.toFixed(1)}${cardFloor > share * fullH ? `, raised to fit the card` : ''})`);
    // Background, every width: the old cover size (the full width, or the full old height where
    // that's bigger) zoomed in 20%, so the shorter section crops it rather than shrinking it.
    const bg = await ev("getComputedStyle(document.querySelector('#reviews')).backgroundSize");
    const bgW = parseFloat(bg), wantBgW = 1.2 * Math.max(w, 1.5 * fullH);
    ok(/^[\d.]+px auto$/.test(bg) && near(bgW, wantBgW, 0.6) && bgW / 1.5 >= L.sec.h && bgW >= w, `${w}: background-size is "${bg}", want ${wantBgW.toFixed(1)}px auto (1.2 x the old cover width), big enough to cover ${w}x${L.sec.h.toFixed(1)}`);
    // The row: just one, 434x93 cards on the design's middle line.
    ok(L.tracks === 1, `${w}: ${L.tracks} carousel rows, want 1 (the top and bottom rows are gone)`);
    ok(near(L.card2.w, 434, 0.5) && near(L.card2.h, 93, 0.5) && near(L.card2.cy - L.band.y, 202.5, 0.5), `${w}: row cards are ${L.card2.w}x${L.card2.h} centered at ${(L.card2.cy - L.band.y).toFixed(2)}, want 434x93 at 202.5`);
    // Each card: the Figma size, centered, inside the page at the top of its bounce; the bounce.
    const base = desktop ? 919 : 491, baseH = desktop ? 196 : 359;
    const room = desktop ? w - 48 : w - 2 * pad;
    const u = Math.min(1, room / (base * 1.2));
    for (let k = 0; k < 4; k++) {
      const S = STOPS[k] * 1000;
      const at = async (ms) => { await ev(SEEK(S + ms)); return (await ev(STATE)).cards[k]; };
      const c0 = await at(CARD.in), cp = await at(CARD.peak), cr = await at(2500), ce = await at(CARD.gone);
      ok(near(cr.w0, base * u, 0.6) && near(cr.h0, baseH * u, 0.6), `${w}: quote ${k + 1} is ${cr.w0}x${cr.h0} before scaling, want ${(base * u).toFixed(1)}x${(baseH * u).toFixed(1)}`);
      ok(near(c0.r.w / cr.w0, 0.92, 0.003) && near(cp.r.w / cr.w0, 1.2, 0.003) && near(cr.r.w / cr.w0, 1.15, 0.003), `${w}: quote ${k + 1} bounce ${(c0.r.w / cr.w0).toFixed(3)} → ${(cp.r.w / cr.w0).toFixed(3)} → ${(cr.r.w / cr.w0).toFixed(3)}, want 0.92 → 1.2 → 1.15`);
      for (const c of [c0, cp, cr, ce]) ok(near(c.r.cx, w / 2, 1) && near(c.r.cy, L.sec.cy, 1), `${w}: quote ${k + 1} centered at ${c.r.cx.toFixed(1)},${c.r.cy.toFixed(1)}; the screen's middle is ${w / 2}, the section's ${L.sec.cy.toFixed(1)}`);
      const m = desktop ? 24 : pad;
      ok(cp.r.x >= m - 0.6 && cp.r.x + cp.r.w <= w - m + 0.6, `${w}: quote ${k + 1} at its peak spans ${cp.r.x.toFixed(1)}-${(cp.r.x + cp.r.w).toFixed(1)}, want inside ${m}-${w - m}`);
      const top = cp.r.y - L.sec.y, bottom = cp.r.y + cp.r.h - L.sec.y;
      ok(top >= -0.6 && bottom <= L.sec.h + 0.6, `${w}: quote ${k + 1} at its peak spans y ${top.toFixed(1)}-${bottom.toFixed(1)} of a ${L.sec.h.toFixed(1)}px section (the section crops it)`);
      // The How It Works 3D phone pokes up to ~40px into the bottom of the section on desktop (its
      // layout box reaches much higher, but the drawn phone doesn't); keep the card clear of it.
      if (desktop) ok(L.sec.h - bottom >= 40, `${w}: quote ${k + 1}'s peak ends ${(L.sec.h - bottom).toFixed(1)}px above the section's bottom, want 40+ (room for the How It Works phone)`);
    }
    console.log(`  section ${L.sec.w}x${L.sec.h.toFixed(1)} · band 2000x404 centered · card ${(base * u).toFixed(1)}x${(baseH * u).toFixed(1)}, at rest ${(base * u * 1.15).toFixed(1)}`);
    // Speed: the row stands still through a stop and moves ~946.7 px/s between stops.
    await ev(SEEK(1000)); const a = await ev(STATE); await ev(SEEK(6000)); const b = await ev(STATE);
    ok(near(a.row, b.row, 0.01), `${w}: the row moves ${(a.row - b.row).toFixed(2)}px during a stop, want 0`);
    await ev(SEEK(STOP_LEN * 1000 + 100)); const c = await ev(STATE); await ev(SEEK(STOP_LEN * 1000 + 900)); const d = await ev(STATE);
    ok(near((c.row - d.row) / 0.8, SPEED, 4), `${w}: the row moves ${((c.row - d.row) / 0.8).toFixed(1)} px/s between stops, want ${SPEED}`);
    // Timing over the loop.
    let shown = 0, overlap = 0, moving = 0, holes = 0;
    const firstBad = [];
    for (let ms = 0; ms <= LOOP; ms += STEP) {
      await ev(SEEK(ms));
      const S = await ev(STATE);
      const vis = S.cards.map((x, i) => (x.o > 0.01 ? i : -1)).filter((i) => i >= 0);
      if (vis.length > 1) { overlap++; if (firstBad.length < 3) firstBad.push(`${ms.toFixed(0)}ms: ${vis.length} cards`); }
      if (vis.length) {
        shown++;
        await ev(SEEK(ms + 40));
        const S2 = await ev(STATE);
        if (!near(S2.row, S.row, 0.01)) { moving++; if (firstBad.length < 3) firstBad.push(`${ms.toFixed(0)}ms: card ${vis[0] + 1} up while row 2 moves`); }
      }
      // Hold: from the end of the bounce to the start of the shrink, the stop's card is fully shown.
      const k = STOPS.findIndex((s) => ms >= s * 1000 + CARD.rest && ms <= s * 1000 + CARD.out);
      if (k >= 0 && !(S.cards[k].o > 0.999 && vis.length === 1 && vis[0] === k)) { holes++; if (firstBad.length < 3) firstBad.push(`${ms.toFixed(0)}ms: card ${k + 1} opacity ${S.cards[k].o}`); }
    }
    ok(overlap === 0, `${w}: two cards at once at ${overlap} samples (${firstBad.join('; ')})`);
    ok(moving === 0, `${w}: a card shows while row 2 moves at ${moving} samples (${firstBad.join('; ')})`);
    ok(holes === 0, `${w}: a card isn't fully shown during its hold at ${holes} samples (${firstBad.join('; ')})`);
    ok(shown > 16000 / STEP, `${w}: cards show at only ${shown} of ${Math.floor(LOOP / STEP) + 1} samples`);
    if (SHOTS) {
      for (const [label, at] of [['moving', STOP_LEN + 0.55], ['grow', STOPS[1] + 0.3], ['peak', STOPS[1] + CARD.peak / 1000], ['rest', STOPS[1] + 2.5], ['shrink', STOPS[1] + 6.475]]) { await ev(SEEK(at * 1000)); await shot(`reviews-${w}-${label}.png`); }
      for (let k = 0; k < 4; k++) { await ev(SEEK((STOPS[k] + 2.5) * 1000)); await shot(`reviews-${w}-quote${k + 1}.png`); }
    }
    // Reduced motion: rows stand still, cards only fade (and wait for the section too).
    await open(w, h, 'reduce');
    await toSection();
    await sleep(500);
    await ev(SEEK(2500));
    const R = await ev(STATE);
    const rowAnims = await ev("document.getAnimations().filter((a) => a.effect.target.classList.contains('rc-track')).length");
    ok(rowAnims === 0 && R.row === 0, `${w}: reduced motion: ${rowAnims} row animations, the row at ${R.row}`);
    ok(R.cards[0].o > 0.999 && R.cards[0].t === 'none', `${w}: reduced motion: quote 1 opacity ${R.cards[0].o}, transform ${R.cards[0].t}`);
    await ev(SEEK(300));
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
