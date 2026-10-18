// AFMBP-2310 (before it: 2250 / 2265 / 2267 / 2269 / 2283 / 2284 / 2285 / 2299) — the home page's
// Reviews section in the owner's simpler design (Figma 2251:139 desktop, 2778:3435 mobile): "Trusted by
// pros across the country" over a US-map outline on the dark photo band, and one quote card at a time
// (Quote 1-4) growing in with a small bounce, holding and shrinking away — right of the title on
// desktop, below it on phones — with nothing moving until the section is on screen. Drives the page's
// own CSS animations frame by frame (document.getAnimations()) at 1920x1080, 1440x900, 1280x800,
// 1024x768, 768x1024, 402x874 and 390x844:
//   - start: off screen every card waits at its first frame; on screen Gus's card shows within a second;
//   - the old carousel is gone, the overlay is Figma's 77% black, and the map is drawn at its Figma
//     place with the section cropping it (the page doesn't scroll sideways);
//   - the stage, in Figma pixels times u: desktop u = min(1, (width - 48) / 1481), the 1481x277 title
//     + card group, centered; phones u = min(1.5, width / 402), the 402x300 frame. The section is the
//     stage's height (260.3 at 1440, 291 at 390, 450 at 768); the background is unchanged (the old
//     cover size zoomed in 20%, AFMBP-2283 / 2285);
//   - the title: its words, fonts, sizes and place and, at u = 1 (1920 and 402), its drawn glyphs
//     within 1.5px of Figma's (the lines Inter's own line height apart, line 1 shifted left by Figma's
//     trailing space after "pros");
//   - each card: the Figma size and place, every part inside it; on Figma's own cards (desktop Quote 1,
//     Gus; mobile Quote 2, Bret) every part — photo, name, stars, trade line, logo, quote, quote marks —
//     at its Figma place; the bounce (80% -> 104.3% -> 100%) around a fixed center; at its peak still
//     inside the page and the section and clear of the title;
//   - copy: names, trade lines, logos (Joe has none) and each quote word for word with its emphasis —
//     Gus's desktop and phone wordings each shown only at their size;
//   - timing, every 50ms over the 31.8s loop (at 1440 and 390): at most one card shows; card k only
//     from 0.075s to 6.775s into its turn, and fully from 0.775s to 6.175s;
//   - desktop 1250-1500px (1440, 1280): the How It Works 3D phone, which pokes up into the section,
//     draws under the card, not over it;
//   - reduced motion (at 1440 and 390): the cards only fade.
// Run: node tools/reviews-carousel-check.mjs [siteRoot]      SHOTS=<dir> also saves frames; STEP=500
//      samples coarser; SIZES=1440x900,390x844 runs only those sizes.
//      NC=carousel | NC=overlay50 | NC=nomap | NC=autostart | NC=late | NC=nobounce | NC=cardpos | NC=tall
//      | NC=oldtitle | NC=phoneover — negative controls on the SERVED copy; each must FAIL.
// Nothing leaves the machine: Chrome resolves no host but 127.0.0.1; every other request is answered locally.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { inflateSync } from 'node:zlib';

const ROOT = process.argv[2] ?? new URL('..', import.meta.url).pathname;
const NC = process.env.NC || '';
const SHOTS = process.env.SHOTS || '';
const STEP = +process.env.STEP || 50; // ms between timing samples (STEP=500 for a quick pass)
const SIZES = (process.env.SIZES || '1920x1080,1440x900,1280x800,1024x768,768x1024,402x874,390x844').split(',').map((s) => s.split('x').map(Number));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2' };
// Negative controls: [served file, text, replacement].
const MUTATE = {
  // A carousel row comes back (the owner: "remove all carousels").
  carousel: ['index.html', '<ul class="rq-list"', '<div class="rc"><div class="rc-row rc-row--2"><ul class="rc-track rc-track--2"><li class="rc-card"></li></ul></div></div><ul class="rq-list"'],
  // The overlay back at the old 50% black.
  overlay50: ['review-carousel.css', '.reviews__overlay { background: rgba(0, 0, 0, 0.77); }', '.reviews__overlay { background: rgba(0, 0, 0, 0.5); }'],
  // No US map.
  nomap: ['index.html', '<img class="rv-map" src="assets/reviews/us-map.svg" width="1854" height="1045" alt="" decoding="async" loading="lazy" />', ''],
  // Everything runs from page load, before the section is on screen.
  autostart: ['review-carousel.css', '.reviews:not(.reviews--on) .rq { animation-play-state: paused; }', '.reviews:not(.reviews--on) .rq { animation-play-state: running; }'],
  // Gus's card runs half a second late.
  late: ['review-carousel.css', '.rq--1 { animation-delay: 0s; }', '.rq--1 { animation-delay: 0.5s; }'],
  // No bounce: the card grows straight to its Figma size.
  nobounce: ['review-carousel.css', 'opacity: 1; transform: scale(1.04348);', 'opacity: 1; transform: scale(1);'],
  // The desktop card off its Figma place.
  cardpos: ['review-carousel.css', 'left: calc(562 * var(--u)); top: calc(40.5', 'left: calc(600 * var(--u)); top: calc(40.5'],
  // The desktop section taller than Figma's.
  tall: ['review-carousel.css', 'height: calc(277 * var(--u));', 'height: calc(327 * var(--u));'],
  // The title's lines back 79.5px apart (the first build, before matching Figma's drawn glyphs).
  oldtitle: ['review-carousel.css', 'font-size: calc(40 * var(--u)); line-height: calc(48 * var(--u));', 'font-size: calc(40 * var(--u)); line-height: calc(79.5 * var(--u));'],
  // The cards back under the How It Works band: its phone draws over the card at 1280-1440.
  phoneover: ['review-carousel.css', 'position: absolute; z-index: 4; left: calc(562', 'position: absolute; z-index: auto; left: calc(562'],
};
if (NC) {
  if (!MUTATE[NC]) throw new Error(`unknown NC "${NC}"; one of ${Object.keys(MUTATE).join(', ')}`);
  if (!readFileSync(join(ROOT, MUTATE[NC][0]), 'utf8').includes(MUTATE[NC][1])) throw new Error(`NC ${NC}: its text is no longer in ${MUTATE[NC][0]}`);
}

// What each card says, typed here as plain text (Figma 2776:3354 and Mobile Quote 1-4: 2778:3642,
// 2778:3795, 2778:3685, 2778:3726). Gus's quote has a desktop wording (one word in the marker) and a
// phone wording (a phrase in semibold).
const CARDS = [
  { name: 'Gus C.', meta: 'General Contractor, Massachusetts', logo: 'CNJ Construction',
    d: { text: 'Bolt qualifies every caller upfront, so I only spend my time on real opportunities and don’t waste time meeting with people that aren’t serious!', strong: '', mk: 'real' },
    m: { text: 'Bolt qualifies every caller upfront, so I only spend time on real opportunities and don’t meet with people that aren’t serious!', strong: 'don’t meet with people that aren’t serious', mk: '' } },
  { name: 'Bret B.', meta: 'General Contractor, Indiana', logo: 'B. Brooks Builders',
    text: 'Bolt answered 3 calls last week while I was working. One turned into a project worth $2,800! The thing paid for itself in a day.', strong: 'project worth $2,800!', mk: '' },
  { name: 'Joe H.', meta: 'Handyman, Florida', logo: null,
    text: 'My wife used to spend hours taking calls. Now Bolt handles the scheduling and she focuses on growing our business.', strong: 'growing our business', mk: '' },
  { name: 'Josh C.', meta: 'Handyman, California', logo: 'JC Home Services, Inc.',
    text: 'I work full-time and am building a side business. Bolt books the jobs and I keep working.', strong: 'Bolt books the jobs and I keep working.', mk: '' },
];
// Figma geometry in Figma pixels (times u on the page). Boxes are [x, y, w, h]; text is [x, center y, w];
// the name is [x, y, the room Figma's Roboto name takes, the gap before the stars].
const FIG = {
  // Section - Reviews 2251:139: the title + card group 2776:3378 (1481x277) is the stage.
  d: { stage: [1481, 277], map: [-249.98, -97.04, 1853.97, 1045.04], title: { cx: 209, top: 108, size: 40, lh: 48, hl: 69 },
    list: [562, 40.5], card: [919, 196], radius: 12, k: 0, // Quote 1 (Gus) 2776:3354:
    parts: { photo: [37, 10, 161, 161], name: [260, 18, 86, 8], stars: [354, 22, 105, 21], meta: [259.78, 51], logo: [605, 28, 268, 32.11], text: [260, 129, 613], open: [216, 85, 58, 48], close: [815, 122, 56, 46] },
    // The title's glyphs as Figma draws them (u = 1, stage pixels): [x0, y0, x1, y1].
    glyphs: { yellow: [1, 96, 252, 147], line1: [269, 117, 403, 153], line2: [34, 165, 383, 201] } },
  // Section - Reviews 2778:3435: the 402x300 frame is the stage.
  m: { stage: [402, 300], map: [-325, -154.47, 875.79, 493.66], title: { cx: 201, top: 32, size: 18.895, lh: 22.87, hl: 32.595 },
    list: [79.29, 96.45], card: [243.42, 177.98], radius: 5.949, k: 1, // Mobile Quote 2 (Bret) 2778:3466:
    parts: { photo: [17.85, 7.93, 98.69, 83.26], name: [114.03, 6.94, 37.67, 3.97], stars: [155.67, 10.91, 52.06, 10.41], meta: [113.91, 25.29], logo: [146, 47.55, 51, 40], text: [23.8, 130.39, 205.25], open: [12.37, 100.22, 28.75, 23.8], close: [197.79, 142.36, 27.76, 22.81] },
    glyphs: { yellow: [103, 25, 221, 49], line1: [229, 36, 292, 52], line2: [119, 59, 283, 75] } },
};
const LOOP = 31844.44;                                                // ms: four turns
const TURN = LOOP / 4;                                                // a new card every 7.96s
const CARD = { in: 75, peak: 525, rest: 775, out: 6175, gone: 6775 }; // ms into its turn
const BOUNCE = { in: 0.8, peak: 1.04348, rest: 1 };
const FULL = new Set([1440, 390]);                                    // widths that also run timing + reduced motion

const PORT = 20000 + Math.floor(Math.random() * 10000), DBG = 30000 + Math.floor(Math.random() * 10000);
const srv = createServer((req, res) => {
  let f, body;
  try {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
    f = join(ROOT, p);
    if (statSync(f).isDirectory()) f = join(f, 'index.html');
    body = readFileSync(f);
  } catch { res.writeHead(404); res.end(); return; }
  if (NC && f.endsWith(MUTATE[NC][0])) body = Buffer.from(body.toString('utf8').replace(MUTATE[NC][1], MUTATE[NC][2]));
  res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(body);
}).listen(PORT, '127.0.0.1');

// A screenshot's pixels (PNG, 8-bit RGB or RGBA, not interlaced).
function decodePng(buf) {
  let i = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (i < buf.length) {
    const len = buf.readUInt32BE(i), type = buf.toString('ascii', i + 4, i + 8), d = buf.subarray(i + 8, i + 8 + len);
    i += 12 + len;
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; } else if (type === 'IDAT') idat.push(d);
  }
  const raw = inflateSync(Buffer.concat(idat)), bpp = ct === 6 ? 4 : 3, stride = w * bpp, px = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      let v = raw[p++];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = v & 255;
    }
  }
  return { w, h, bpp, px };
}
// How many pixels differ between two same-size screenshots.
const diffPx = (A, B) => { let n = 0; for (let o = 0; o < A.px.length; o += A.bpp) if (Math.abs(A.px[o] - B.px[o]) + Math.abs(A.px[o + 1] - B.px[o + 1]) + Math.abs(A.px[o + 2] - B.px[o + 2]) > 60) n++; return n; };
// The title's ink in a screenshot: the yellow marker word, and the white words split into two lines.
function titleInk(P) {
  const yel = [], wht = [];
  for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) {
    const o = (y * P.w + x) * P.bpp, R = P.px[o], G = P.px[o + 1], B = P.px[o + 2];
    if (R > 180 && G > 110 && B < 110 && R - B > 110) yel.push([x, y]);
    else if (R > 185 && G > 185 && B > 185 && Math.max(R, G, B) - Math.min(R, G, B) < 30) wht.push([x, y]);
  }
  const box = (pts) => pts.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [1e9, 1e9, -1, -1]);
  const rows = [...new Set(wht.map((q) => q[1]))].sort((a, b) => a - b);
  let split = rows[0] ?? 0, gap = 0;
  for (let j = 0; j + 1 < rows.length; j++) if (rows[j + 1] - rows[j] > gap) { gap = rows[j + 1] - rows[j]; split = rows[j]; }
  return { yellow: box(yel), line1: box(wht.filter((q) => q[1] <= split)), line2: box(wht.filter((q) => q[1] > split)), n: yel.length + wht.length };
}

const PROFILE = mkdtempSync(join(tmpdir(), 'cdp-2310-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', '--use-angle=metal', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0, good = 0;
const ok = (c, m) => { if (c) good++; else { bad++; console.log(`  FAIL ${m}`); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const f1 = (v) => (Math.round(v * 10) / 10).toString();
const fb = (b) => (b ? `[${b.map(f1).join(', ')}]` : 'none');

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
    // 1x where Figma's pixels are compared (desktop, and the 402 phone); 2x on the other phones.
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: w >= 1024 || w === 402 ? 1 : 2, mobile: w < 1024 });
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
    const cards = [...document.querySelectorAll('.rq')].map((q) => { const cs = getComputedStyle(q); return { o: +cs.opacity, r: r(q), t: cs.transform, w0: parseFloat(cs.width), h0: parseFloat(cs.height) }; });
    return { cards, sec: r(document.querySelector('#reviews')), inner: r(document.querySelector('.reviews__inner')), title: r(document.querySelector('.rv-title')), vw: innerWidth, sw: document.documentElement.scrollWidth, sy: scrollY };
  })()`;
  const OPS = "[...document.querySelectorAll('.rq')].map((q) => +getComputedStyle(q).opacity)";
  // Card k's parts, relative to the card; the quote marks are its ::before / ::after.
  const PARTS = (k) => `(() => {
    const q = document.querySelectorAll('.rq')[${k}], cr = q.getBoundingClientRect();
    const rel = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return [b.left - cr.left, b.top - cr.top, b.width, b.height]; };
    const pe = (p) => { const s = getComputedStyle(q, p); return [parseFloat(s.left), parseFloat(s.top), parseFloat(s.width), parseFloat(s.height)]; };
    const t = q.querySelector('.rq__text').getBoundingClientRect();
    return { w: cr.width, h: cr.height, photo: rel(q.querySelector('.rq__photo')), name: rel(q.querySelector('.rq__name')), stars: rel(q.querySelector('.rq__stars')), meta: rel(q.querySelector('.rq__meta')), logo: rel(q.querySelector('.rq__logo')), text: [t.left - cr.left, t.top + t.height / 2 - cr.top, t.width], textBox: rel(q.querySelector('.rq__text')), open: pe('::before'), close: pe('::after') };
  })()`;
  const shot = async (file, clip) => {
    if (!SHOTS) return;
    await ev(PAINT);
    const b = clip || await ev("(() => { const b = document.querySelector('#reviews').getBoundingClientRect(); return { x: 0, y: b.top + scrollY, width: innerWidth, height: b.height }; })()");
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...b, scale: 1 } });
    writeFileSync(join(SHOTS, file), Buffer.from(data, 'base64'));
  };
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });

  for (const [w, h] of SIZES) {
    const desk = w >= 1024, F = desk ? FIG.d : FIG.m;
    const u = desk ? Math.min(1, (w - 48) / 1481) : Math.min(1.5, w / 402);
    const U = (v) => v * u;
    console.log(`${w}x${h} (${desk ? 'desktop' : 'phone'} layout, u = ${u.toFixed(4)})`);
    // Start: off screen every card waits at its first frame; on screen, Gus's card shows.
    await open(w, h, 'no-preference');
    await sleep(1500);
    const off = await ev(`(() => { const as = ${ANIMS}; return { n: as.length, paused: as.filter((a) => a.playState === 'paused').length, t: Math.max(...as.map((a) => +a.currentTime || 0)), o: +getComputedStyle(document.querySelector('.rq--1')).opacity, on: document.querySelector('#reviews').classList.contains('reviews--on') }; })()`);
    ok(off.n === 4 && off.paused === 4 && off.t === 0 && off.o === 0 && !off.on, `${w}: before the section is on screen ${off.paused} of ${off.n} card animations wait, furthest at ${off.t}ms, Gus at opacity ${off.o}`);
    const imgs = await toSection();
    ok(imgs === 12, `${w}: ${imgs} of 12 images decoded (the map, 4 photos, 4 star rows, 3 logos)`);
    await sleep(700);
    const on = await ev(`(() => { const as = ${ANIMS}; return { running: as.filter((a) => a.playState === 'running').length, o: +getComputedStyle(document.querySelector('.rq--1')).opacity }; })()`);
    ok(on.running === 4 && on.o > 0.5, `${w}: after scrolling to the section ${on.running} of 4 card animations run, Gus at opacity ${on.o.toFixed(2)}`);

    // Structure: no carousel, the overlay, the map (cropped by the section).
    const st = await ev(`(() => {
      const sec = document.querySelector('#reviews'), map = sec.querySelector('.rv-map'), cs = getComputedStyle(sec);
      return { old: sec.querySelectorAll('.rc, .rc-row, .rc-track, .rc-card').length, cards: sec.querySelectorAll('.rq').length, overlay: getComputedStyle(sec.querySelector('.reviews__overlay')).backgroundColor,
        map: map ? { drawn: map.complete && map.naturalWidth > 0, alt: map.getAttribute('alt') } : null, ox: cs.overflowX, oy: cs.overflowY, bg: cs.backgroundSize };
    })()`);
    ok(st.old === 0, `${w}: ${st.old} carousel elements left in the section, want none`);
    ok(st.cards === 4, `${w}: ${st.cards} quote cards, want 4`);
    ok(st.overlay === 'rgba(0, 0, 0, 0.77)', `${w}: the overlay is ${st.overlay}, want Figma's rgba(0, 0, 0, 0.77)`);
    ok(st.map && st.map.drawn && st.map.alt === '', `${w}: the US map is ${st.map ? (st.map.drawn ? 'drawn' : 'not drawn') : 'missing'}${st.map && st.map.alt !== '' ? `, alt "${st.map.alt}" (decorative: want "")` : ''}`);
    ok(st.ox === 'hidden' && st.oy === 'hidden', `${w}: the section's overflow is ${st.ox} / ${st.oy}, want hidden (it crops the map)`);

    // Copy: names, trade lines, logos, stars and each quote as shown at this size.
    const copy = await ev(`[...document.querySelectorAll('.rq')].map((q) => {
      const shown = (e) => e.getClientRects().length > 0, logo = q.querySelector('.rq__logo');
      return { name: q.querySelector('.rq__name').textContent.trim(), meta: q.querySelector('.rq__meta').textContent.trim(), logo: logo ? logo.alt : null, stars: q.querySelector('.rq__stars').alt,
        text: q.querySelector('.rq__text').innerText.replace(/\\s+/g, ' ').trim(),
        strong: [...q.querySelectorAll('.rq__text strong')].filter(shown).map((s) => s.textContent.trim()).join('|'),
        mk: [...q.querySelectorAll('.rq__mk')].filter(shown).map((s) => s.textContent.trim() + ' / ' + getComputedStyle(s).fontFamily + ' / ' + getComputedStyle(s).color).join('|') };
    })`);
    CARDS.forEach((want, i) => {
      const c = copy[i] || {}, v = want.d ? (desk ? want.d : want.m) : want;
      ok(c.name === want.name && c.meta === want.meta && c.logo === want.logo && c.stars === 'Rated 5 out of 5', `${w}: card ${i + 1} is ${c.name} / ${c.meta} / logo ${c.logo} / ${c.stars}`);
      ok(c.text === v.text, `${w}: card ${i + 1} reads "${c.text}"`);
      ok(c.strong === v.strong, `${w}: card ${i + 1} sets "${c.strong}" in semibold, want "${v.strong}"`);
      ok(v.mk ? /^real \/ .*Permanent Marker.* \/ rgb\(252, 189, 17\)$/.test(c.mk) : c.mk === '', `${w}: card ${i + 1}'s marker word: "${c.mk}"${v.mk ? `, want "${v.mk}" in yellow Permanent Marker` : ', want none'}`);
    });

    // The stage and the section (Gus at rest, 2.5s into his turn).
    await ev(SEEK(2500));
    const L = await ev(STATE);
    const SH = U(F.stage[1]);
    ok(near(L.sec.h, SH, 0.6), `${w}: the section is ${L.sec.h.toFixed(2)}px tall, want ${SH.toFixed(2)} (${F.stage[1]} Figma px)`);
    ok(near(L.inner.w, U(F.stage[0]), 0.6) && near(L.inner.h, SH, 0.6) && near(L.inner.cx, w / 2, 0.6) && near(L.inner.y, L.sec.y, 0.6), `${w}: the stage is ${L.inner.w.toFixed(1)}x${L.inner.h.toFixed(1)} centered at ${L.inner.cx.toFixed(1)}, want ${U(F.stage[0]).toFixed(1)}x${SH.toFixed(1)} at ${w / 2}`);
    ok(L.sw === L.vw, `${w}: the page is ${L.sw}px wide in a ${L.vw}px window (sideways scroll)`);
    // Background, every width: the old cover size (the full width, or the full old height where that's
    // bigger) zoomed in 20%, so the short section crops it rather than shrinking it (AFMBP-2283 / 2285).
    const fullH = 404 + 2 * Math.min(90, Math.max(60, w * 0.07)), bgW = parseFloat(st.bg), wantBgW = 1.2 * Math.max(w, 1.5 * fullH);
    ok(/^[\d.]+px auto$/.test(st.bg) && near(bgW, wantBgW, 0.6) && bgW / 1.5 >= L.sec.h && bgW >= w, `${w}: background-size is "${st.bg}", want ${wantBgW.toFixed(1)}px auto, big enough to cover ${w}x${L.sec.h.toFixed(1)}`);
    // The map at its Figma place.
    const mp = await ev("(() => { const m = document.querySelector('.rv-map'), i = document.querySelector('.reviews__inner'); if (!m) return null; const a = m.getBoundingClientRect(), b = i.getBoundingClientRect(); return [a.left - b.left, a.top - b.top, a.width, a.height]; })()");
    ok(mp && F.map.every((v, j) => near(mp[j], U(v), 0.75)), `${w}: the map is at ${fb(mp)}, want ${fb(F.map.map(U))}`);
    // The title.
    const T = await ev(`(() => {
      const h = document.querySelector('.rv-title'), hl = h.querySelector('.rv-title__hl'), cs = getComputedStyle(h), hs = getComputedStyle(hl);
      return { tag: h.tagName, text: h.textContent.replace(/\\s+/g, ' ').trim(), hl: hl.textContent, font: cs.fontFamily, size: parseFloat(cs.fontSize), lh: cs.lineHeight, color: cs.color, hlFont: hs.fontFamily, hlSize: parseFloat(hs.fontSize), hlLh: hs.lineHeight, hlColor: hs.color, hlCase: hs.textTransform };
    })()`);
    ok(T.tag === 'H2' && T.text === 'Trusted by pros across the country' && T.hl === 'Trusted', `${w}: the title is <${T.tag}> "${T.text}", highlighted "${T.hl}"`);
    ok(/Inter/.test(T.font) && T.color === 'rgb(255, 255, 255)' && near(T.size, U(F.title.size), 0.05) && near(parseFloat(T.lh), U(F.title.lh), 0.05), `${w}: the title is ${T.size}px/${T.lh} ${T.font.split(',')[0]} in ${T.color}, want ${U(F.title.size).toFixed(2)}px/${U(F.title.lh).toFixed(2)}px Inter in white`);
    ok(/Permanent Marker/.test(T.hlFont) && T.hlColor === 'rgb(252, 189, 17)' && near(T.hlSize, U(F.title.hl), 0.05) && T.hlLh === '0px' && T.hlCase === 'none', `${w}: "Trusted" is ${T.hlSize}px ${T.hlFont.split(',')[0]} in ${T.hlColor}, line-height ${T.hlLh}, ${T.hlCase}; want ${U(F.title.hl).toFixed(2)}px Permanent Marker in #fcbd11, no line height, mixed case`);
    ok(near(L.title.cx - L.inner.x, U(F.title.cx), 0.75) && near(L.title.y - L.inner.y, U(F.title.top), 0.75), `${w}: the title is centered at x ${(L.title.cx - L.inner.x).toFixed(1)}, top ${(L.title.y - L.inner.y).toFixed(1)}; want ${U(F.title.cx).toFixed(1)}, ${U(F.title.top).toFixed(1)}`);
    // At u = 1 its glyphs land where Figma draws them.
    if (u === 1) {
      const clip = desk ? { x: Math.floor(L.inner.x) - 10, y: Math.round(L.inner.y + L.sy), width: 540, height: 277 } : { x: Math.floor(L.inner.x), y: Math.round(L.inner.y + L.sy), width: 402, height: 92 };
      const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } });
      const ink = titleInk(decodePng(Buffer.from(data, 'base64')));
      const dx = clip.x - L.inner.x, dy = clip.y - L.sy - L.inner.y;
      for (const part of ['yellow', 'line1', 'line2']) {
        const got = ink[part][2] < 0 ? null : [ink[part][0] + dx, ink[part][1] + dy, ink[part][2] + dx, ink[part][3] + dy];
        ok(got && F.glyphs[part].every((v, j) => near(got[j], v, 1.5)), `${w}: the title's ${part === 'yellow' ? '"Trusted"' : part === 'line1' ? '"by pros"' : '"across the country"'} glyphs span ${fb(got)}, Figma draws ${fb(F.glyphs[part])}`);
      }
    }

    // Each card: its size and place at rest, the bounce, and its peak inside the page and the section.
    const pad = 0.75;
    for (let k = 0; k < 4; k++) {
      const S = k * TURN;
      const at = async (ms) => { await ev(SEEK(S + ms)); return ev(STATE); };
      const s0 = await at(CARD.in), sp = await at(CARD.peak), sr = await at(2500);
      const c0 = s0.cards[k], cp = sp.cards[k], cr = sr.cards[k];
      ok(near(cr.w0, U(F.card[0]), 0.6) && near(cr.h0, U(F.card[1]), 0.6), `${w}: card ${k + 1} is ${cr.w0.toFixed(1)}x${cr.h0.toFixed(1)}, want ${U(F.card[0]).toFixed(1)}x${U(F.card[1]).toFixed(1)}`);
      ok(near(cr.r.x - sr.inner.x, U(F.list[0]), pad) && near(cr.r.y - sr.inner.y, U(F.list[1]), pad), `${w}: card ${k + 1} rests at ${(cr.r.x - sr.inner.x).toFixed(1)},${(cr.r.y - sr.inner.y).toFixed(1)} of the stage, want ${U(F.list[0]).toFixed(1)},${U(F.list[1]).toFixed(1)}`);
      ok(desk ? near(cr.r.cy, sr.sec.cy, 0.6) : near(cr.r.cx, w / 2, 0.6), `${w}: card ${k + 1} is centered ${desk ? `in the band's height (${cr.r.cy.toFixed(1)} vs ${sr.sec.cy.toFixed(1)})` : `on the screen (${cr.r.cx.toFixed(1)} vs ${w / 2})`}`);
      ok(sr.cards.every((c, j) => (j === k ? c.o > 0.999 : c.o < 0.01)), `${w}: at rest only card ${k + 1} shows (opacities ${sr.cards.map((c) => c.o.toFixed(2)).join(', ')})`);
      ok(near(c0.r.w / c0.w0, BOUNCE.in, 0.003) && near(cp.r.w / cp.w0, BOUNCE.peak, 0.003) && near(cr.r.w / cr.w0, BOUNCE.rest, 0.003), `${w}: card ${k + 1} bounce ${(c0.r.w / c0.w0).toFixed(3)} → ${(cp.r.w / cp.w0).toFixed(3)} → ${(cr.r.w / cr.w0).toFixed(3)}, want 0.8 → 1.043 → 1`);
      ok([c0, cp].every((c) => near(c.r.cx, cr.r.cx, 0.6) && near(c.r.cy, cr.r.cy, 0.6)), `${w}: card ${k + 1} grows around a fixed center (${c0.r.cx.toFixed(1)},${c0.r.cy.toFixed(1)} → ${cp.r.cx.toFixed(1)},${cp.r.cy.toFixed(1)} → ${cr.r.cx.toFixed(1)},${cr.r.cy.toFixed(1)})`);
      const top = cp.r.y - sp.sec.y, bottom = cp.r.y + cp.r.h - sp.sec.y;
      ok(cp.r.x >= -0.6 && cp.r.x + cp.r.w <= w + 0.6 && top >= -0.6 && bottom <= sp.sec.h + 0.6, `${w}: card ${k + 1} at its peak spans x ${cp.r.x.toFixed(1)}-${(cp.r.x + cp.r.w).toFixed(1)}, y ${top.toFixed(1)}-${bottom.toFixed(1)}; want inside the ${w}px page and the ${sp.sec.h.toFixed(1)}px section`);
      const tb = sp.title, clear = desk ? cp.r.x >= tb.x + tb.w : cp.r.y >= tb.y + tb.h;
      ok(clear, `${w}: card ${k + 1} at its peak ${desk ? `starts at x ${cp.r.x.toFixed(1)}, the title ends at ${(tb.x + tb.w).toFixed(1)}` : `starts at y ${cp.r.y.toFixed(1)}, the title ends at ${(tb.y + tb.h).toFixed(1)}`}`);
      // Every part inside the card (at rest).
      const P = await ev(PARTS(k));
      const inside = ['photo', 'name', 'stars', 'meta', 'logo', 'textBox'].filter((n) => P[n]).every((n) => P[n][0] >= -0.6 && P[n][1] >= -0.6 && P[n][0] + P[n][2] <= P.w + 0.6 && P[n][1] + P[n][3] <= P.h + 0.6);
      ok(inside, `${w}: a part of card ${k + 1} sticks out of it: ${['photo', 'name', 'stars', 'meta', 'logo', 'textBox'].map((n) => `${n} ${fb(P[n])}`).join(' · ')} in ${P.w.toFixed(1)}x${P.h.toFixed(1)}`);
      // Figma's own card: every part at its Figma place.
      if (k === F.k) {
        const fp = F.parts, chk = (n, got, want, tol) => ok(got && want.every((v, j) => near(got[j], U(v), tol)), `${w}: card ${k + 1}'s ${n} is at ${fb(got)}, Figma ${fb(want.map(U))}`);
        chk('photo', P.photo, fp.photo, pad); chk('name', P.name && P.name.slice(0, 2), fp.name.slice(0, 2), pad);
        // The stars sit at Figma's x unless the name is wider than Figma's Roboto draws it (where Roboto
        // isn't installed, as on Macs and iPhones, it falls back to Inter): then the gap after the name.
        const st0 = P.stars, nm = P.name, afterName = nm[0] + nm[2] + U(fp.name[3]);
        ok(st0 && nm[2] >= U(fp.name[2]) - 0.6 && near(st0[0], afterName, pad) && st0[0] >= U(fp.stars[0]) - pad && fp.stars.slice(1).every((v, j) => near(st0[j + 1], U(v), pad)),
          `${w}: card ${k + 1}'s stars are at ${fb(st0)} after a ${f1(nm[2])}px name; want Figma's ${fb(fp.stars.map(U))}, or ${f1(U(fp.name[3]))}px after a wider name`);
        if (st0[0] > U(fp.stars[0]) + pad) console.log(`  note: card ${k + 1}'s stars sit ${f1(st0[0] - U(fp.stars[0]))}px right of Figma's: the name is ${f1(nm[2])}px in the fallback font, Figma's Roboto takes ${f1(U(fp.name[2]))}`);
        chk('trade line', P.meta && P.meta.slice(0, 2), fp.meta, pad); chk('logo', P.logo, fp.logo, pad); chk('quote', P.text, fp.text, pad);
        chk('opening quote mark', P.open, fp.open, pad); chk('closing quote mark', P.close, fp.close, pad);
      }
      if (SHOTS) { await ev(SEEK(S + 2500)); await shot(`reviews-${w}-quote${k + 1}.png`); if (k === 0) { await ev(SEEK(S + CARD.peak)); await shot(`reviews-${w}-quote1-peak.png`); } }
    }
    const rest = U(F.card[0]).toFixed(1) + 'x' + U(F.card[1]).toFixed(1);
    console.log(`  section ${w}x${L.sec.h.toFixed(1)} · stage ${L.inner.w.toFixed(1)}x${L.inner.h.toFixed(1)} centered · card ${rest} at rest`);

    // Desktop 1250-1500: the How It Works band's 3D phone pokes up into this section right under the
    // card; it must draw under the card, not over it. Scroll so the band's top sits at 42% of the
    // window (the phone then reaches into the section), put Gus at the top of his bounce, and compare
    // the card with the phone shown and hidden. The phone must also be seen reaching into the section
    // (left of the card), or the comparison proves nothing.
    if (desk && w >= 1250 && w <= 1500) {
      await ev(`(() => { const b = document.querySelector('#band').getBoundingClientRect(); scrollTo(0, b.top + scrollY - ${Math.round(0.42 * h)}); return true; })()`);
      await sleep(1500);
      await ev(SEEK(CARD.peak));
      await ev(PAINT);
      const g = await ev("(() => { const c = document.querySelector('.rq--1').getBoundingClientRect(), s = document.querySelector('#reviews').getBoundingClientRect(); return { x: c.left, y: c.top + scrollY, w: c.width, h: c.height, sb: s.bottom + scrollY }; })()");
      const r = Math.ceil(U(F.radius) * BOUNCE.peak) + 1;
      const cardClip = { x: Math.ceil(g.x) + r, y: Math.ceil(g.y) + 2, width: Math.floor(g.w) - 2 * r, height: Math.floor(g.h) - 4 };
      const stripClip = { x: 0, y: Math.floor(g.sb) - 60, width: Math.max(1, Math.floor(g.x)), height: 60 };
      const grab = async (clip) => decodePng(Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } })).data, 'base64'));
      const A = [await grab(cardClip), await grab(stripClip)];
      await shot(`reviews-${w}-phone.png`, { x: 0, y: Math.floor(g.sb) - Math.round(L.sec.h), width: w, height: Math.round(L.sec.h) + 160 });
      await ev("(() => { document.querySelector('.hiwphone').style.visibility = 'hidden'; return true; })()");
      await ev(PAINT);
      const B = [await grab(cardClip), await grab(stripClip)];
      await ev("(() => { document.querySelector('.hiwphone').style.visibility = ''; return true; })()");
      const overCard = diffPx(A[0], B[0]), inSection = diffPx(A[1], B[1]);
      ok(inSection > 200, `${w}: the How It Works phone shows ${inSection} pixels in the bottom 60px of the section left of the card, want it reaching in (200+) so the next check means something`);
      ok(overCard <= 2, `${w}: the How It Works phone draws over ${overCard} pixels of Gus's card at the top of its bounce, want none (the card sits above it)`);
      await toSection();
    }

    if (!FULL.has(w)) continue;
    // Timing over the loop.
    let overlap = 0, outside = 0, holes = 0, shown = 0;
    const firstBad = [];
    const note = (m) => { if (firstBad.length < 4) firstBad.push(m); };
    for (let ms = 0; ms < LOOP; ms += STEP) {
      await ev(SEEK(ms));
      const o = await ev(OPS);
      const vis = o.map((x, i) => (x > 0.01 ? i : -1)).filter((i) => i >= 0);
      if (vis.length) shown++;
      if (vis.length > 1) { overlap++; note(`${ms}ms: ${vis.length} cards`); }
      for (const i of vis) { const tIn = ms - i * TURN; if (!(tIn > CARD.in - 1 && tIn < CARD.gone + 1)) { outside++; note(`${ms}ms: card ${i + 1} at opacity ${o[i].toFixed(2)}, ${(tIn / 1000).toFixed(2)}s into its turn`); } }
      const k = Math.floor(ms / TURN), tk = ms - k * TURN;
      if (tk >= CARD.rest && tk <= CARD.out && !(o[k] > 0.999 && vis.length === 1)) { holes++; note(`${ms}ms: card ${k + 1} at opacity ${o[k].toFixed(3)} in its hold`); }
    }
    ok(overlap === 0, `${w}: two cards at once at ${overlap} samples (${firstBad.join('; ')})`);
    ok(outside === 0, `${w}: a card shows outside 0.075-6.775s of its turn at ${outside} samples (${firstBad.join('; ')})`);
    ok(holes === 0, `${w}: a card isn't fully shown during its hold (0.775-6.175s) at ${holes} samples (${firstBad.join('; ')})`);
    ok(shown > 26000 / STEP, `${w}: cards show at only ${shown} of ${Math.ceil(LOOP / STEP)} samples`);
    // Reduced motion: the cards only fade, and still wait for the section.
    await open(w, h, 'reduce');
    await toSection();
    await sleep(500);
    await ev(SEEK(2500));
    const R = await ev(STATE);
    ok(R.cards[0].o > 0.999 && R.cards[0].t === 'none', `${w}: reduced motion: card 1 opacity ${R.cards[0].o}, transform ${R.cards[0].t}`);
    await ev(SEEK(300));
    const R2 = await ev(STATE);
    ok(R2.cards[0].t === 'none' && R2.cards[0].o > 0.01 && R2.cards[0].o < 0.999, `${w}: reduced motion mid-fade: card 1 opacity ${R2.cards[0].o}, transform ${R2.cards[0].t}`);
  }
  console.log(bad ? `FAIL ${bad} of ${good + bad}` : `PASS ${good} checks`);
  ws.close();
} finally {
  chrome.kill('SIGKILL'); srv.close();
  await sleep(300);
  rmSync(PROFILE, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
