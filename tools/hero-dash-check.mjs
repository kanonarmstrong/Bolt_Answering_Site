// AFMBP-2485 — the trade heroes' text never runs under the dashboard picture on their right
// (.tphero__dash). Below 1025px the copy column used to run the full width, so the headline and the
// subtitle ran under the dashboard at 769-1024px on all 5 trade pages; at 1025-1100px lines came within
// 1-23px of the phone's edge, and plumbing's bigger phone covered its headline up to 1200px and came within
// 9px of it up to 1250px. Now, from 769 to 1279px, the copy column ends where the dashboard begins and
// plumbing's phone takes the other four's size and place (styles.css). For the 5 trade pages at 769,
// 800, 820, 834, 900, 1000, 1024, 1025, 1100, 1180, 1229, 1279, 1280, 1366, 1440 and 1920 (1x, 900 tall),
// this proves that:
//   - the dashboard still shows: displayed at full opacity, with 20000+ of its pixels drawn;
//   - the headline and the subtitle show (each has a line on screen, faded in);
//   - every line of the hero's text (label, headline, subtitle, button label) and the button itself ends
//     at least 16px left of the first dashboard pixel in its rows, so no dashboard pixel is inside any of
//     them. Dashboard pixels are measured on a magenta hero with the background photo and the text hidden,
//     dashboard shown vs hidden, so a white dashboard on a white background still counts, and so does its
//     drop shadow.
// Phones (768px and narrower) show one baked image instead of this hero, so they aren't measured here.
// Run: node tools/hero-dash-check.mjs [siteRoot]      PAGES=hvac WIDTHS=820,1024 runs only those.
//      NC=main | NC=plumbing | NC=wide | NC=nodash — negative controls on the SERVED copy; each must FAIL.
// Nothing leaves the machine: Chrome resolves no host but 127.0.0.1; every other request is answered locally.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { inflateSync } from 'node:zlib';

const ROOT = process.argv[2] ?? new URL('..', import.meta.url).pathname;
const NC = process.env.NC || '';
const PAGES = (process.env.PAGES || 'electrical,general-contractor,handyman,hvac,plumbing').split(',');
const WIDTHS = (process.env.WIDTHS || '769,800,820,834,900,1000,1024,1025,1100,1180,1229,1279,1280,1366,1440,1920').split(',').map(Number);
const H = 900;
const GAP = 16;       // px every line of hero text keeps clear of the dashboard
const DRAWN = 20000;  // dashboard pixels that must be drawn; at 769px it draws about 100,000
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };
const RULES = '@media (min-width:769px) and (max-width:1279px){\n  .tphero__copy{max-width:min(560px,calc(51% - 24px))}';
// Negative controls: [served file, text, replacement].
const MUTATE = {
  // Main before AFMBP-2485: both new rules off, and the copy runs the full width below 1025px again.
  main: ['styles.css', RULES, '@media (max-width:1024px){.tphero__copy{max-width:100%}}\n@media (max-width:0px){\n  .tphero__copy{max-width:min(560px,calc(51% - 24px))}'],
  // Plumbing's phone back to its desktop size and place below 1280px: it covers plumbing's headline.
  plumbing: ['styles.css', '.tphero__dash:not(.tphero__dash--panel){left:auto;right:-5.7vw;width:auto;max-width:131.4%;object-fit:contain;object-position:right bottom}', ''],
  // A copy column 10% wider: its longest lines reach the dashboard.
  wide: ['styles.css', 'calc(51% - 24px)', 'calc(61% - 24px)'],
  // No dashboard on tablets (an override the owner can pick): nothing is covered, but the dashboard is gone.
  nodash: ['styles.css', '@media (max-width:1024px){\n  .tphero__dash--panel{max-width:52%}\n}', '@media (max-width:1024px){\n  .tphero__dash--panel{max-width:52%}\n  .tphero__dash{display:none}\n}'],
};
if (NC) {
  if (!MUTATE[NC]) throw new Error(`unknown NC "${NC}"; one of ${Object.keys(MUTATE).join(', ')}`);
  const n = readFileSync(join(ROOT, MUTATE[NC][0]), 'utf8').split(MUTATE[NC][1]).length - 1;
  if (n !== 1) throw new Error(`NC ${NC}: its text is in ${MUTATE[NC][0]} ${n} times, want exactly once`);
}

const PORT = 20000 + Math.floor(Math.random() * 10000), DBG = 30000 + Math.floor(Math.random() * 10000);
const srv = createServer((req, res) => {
  let f, body;
  try {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
    f = join(ROOT, p);
    if (statSync(f).isDirectory()) f = join(f, 'index.html');
    body = readFileSync(f);
  } catch { res.writeHead(404); res.end(); return; }
  if (NC && f === join(ROOT, MUTATE[NC][0])) body = Buffer.from(body.toString('utf8').replace(MUTATE[NC][1], MUTATE[NC][2]));
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
// Which pixels differ between two same-size screenshots (1 = differs).
const diffMask = (A, B) => { const m = new Uint8Array(A.w * A.h); for (let i = 0, o = 0; o < A.px.length; i++, o += A.bpp) m[i] = Math.abs(A.px[o] - B.px[o]) + Math.abs(A.px[o + 1] - B.px[o + 1]) + Math.abs(A.px[o + 2] - B.px[o + 2]) > 60 ? 1 : 0; return m; };
const PROFILE = mkdtempSync(join(tmpdir(), 'cdp-2485-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0, good = 0;
const ok = (c, m) => { if (c) good++; else { bad++; console.log(`  FAIL ${m}`); } };

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
    // A request the page abandons (it navigates to the next size) can't be answered any more:
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
  // This Mac reports reduced motion; most visitors don't, so the hero's fade-in is what's measured.
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result ? r.result.value : null; };
  const grab = async (clip) => decodePng(Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } })).data, 'base64'));
  const PAINT = '(async () => { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return true; })()';
  // Every line of text in the hero's copy (label, headline, subtitle, button label) and the button's box,
  // in page coordinates; the hero's box; how the dashboard and the headline/subtitle are shown.
  const MEASURE = `(() => {
    const hero = document.querySelector('.tphero'), R = hero.getBoundingClientRect(), dash = hero.querySelector('.tphero__dash'), cs = getComputedStyle(dash);
    const copy = hero.querySelector('.tphero__copy'), lines = [];
    const part = (e) => e.closest('.btn') ? 'button' : e.closest('.tphero__title') ? 'headline' : e.closest('.tphero__sub') ? 'subtitle' : e.closest('.tphero__label') ? 'label' : e.tagName.toLowerCase();
    // Screen-reader-only text (AFMBP-2525: "Bolt Answering for Plumbers:" at the start of each H1) sits in a
    // box 1px or smaller with overflow hidden, so it paints nothing; its Range rects still span the whole
    // laid-out line, so skip it. Judged by the rendered box, not a class name: if the hiding CSS broke, the
    // text would get a real box again and be measured like any other line.
    const clipped = (e) => { for (; e && e !== copy; e = e.parentElement) { const s = getComputedStyle(e), b = e.getBoundingClientRect(); if (s.overflowX === 'hidden' && s.overflowY === 'hidden' && b.width <= 1 && b.height <= 1) return true; } return false; };
    const tw = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const text = n.textContent.trim(); if (!text || clipped(n.parentElement)) continue;
      const r = document.createRange(); r.selectNodeContents(n);
      [...r.getClientRects()].forEach((b, i) => { if (b.width > 1 && b.height > 1) lines.push({ what: part(n.parentElement) + ' "' + text.slice(0, 24) + (i ? '" line ' + (i + 1) : '"'), l: b.left, r: b.right, t: b.top + scrollY, b: b.bottom + scrollY }); });
    }
    const B = copy.querySelector('.btn').getBoundingClientRect();
    lines.push({ what: 'button [box]', l: B.left, r: B.right, t: B.top + scrollY, b: B.bottom + scrollY });
    const shows = (sel) => { const e = copy.querySelector(sel), s = getComputedStyle(e); return lines.some((k) => k.what.startsWith(part(e) + ' ')) && s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.99; };
    return {
      clip: { x: 0, y: Math.max(0, Math.floor(R.top + scrollY)), width: innerWidth, height: Math.ceil(R.height) },
      lines, dashOn: cs.display !== 'none' && cs.visibility !== 'hidden', o: +cs.opacity,
      title: shows('.tphero__title'), sub: shows('.tphero__sub'),
    };
  })()`;
  // Dashboard pixels only: a magenta hero, its background photo and copy hidden (their boxes stay).
  const ISOLATE = `(() => { const h = document.querySelector('.tphero'); h.style.setProperty('background', '#f0f', 'important');
    for (const e of h.querySelectorAll('.tphero__bg2, .tphero__copy')) e.style.setProperty('visibility', 'hidden', 'important'); return true; })()`;
  const dashVis = (v) => ev(`(() => { document.querySelector('.tphero__dash').style.setProperty('visibility', '${v}', 'important'); return true; })()`);

  for (const page of PAGES) {
    for (const w of WIDTHS) {
      const tag = `${page} ${w}`;
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: H, deviceScaleFactor: 1, mobile: false });
      await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${page}.html?bolt_qa=1` });
      for (let i = 0; i < 100; i++) { if ((await ev("document.readyState === 'complete'")) === true) break; await sleep(100); }
      await ev('document.fonts.ready.then(() => true)');
      await ev(`Promise.all([...document.querySelectorAll('.tphero img')].map((i) => i.decode().catch(() => {}))).then(() => true)`);
      await sleep(1200);   // the hero's copy has faded in (reveal.js: up to 380ms delay + 300ms)
      const M = await ev(MEASURE);
      await ev(ISOLATE); await ev(PAINT);
      const A = await grab(M.clip);
      await dashVis('hidden'); await ev(PAINT);
      const mask = diffMask(A, await grab(M.clip));
      const drawn = mask.reduce((s, v) => s + v, 0);
      // Per line: the first dashboard pixel in its rows, from its left end on; the gap is that pixel's
      // distance past its right end (negative: the dashboard draws inside the line).
      const near = [];
      let closest = null;
      for (const k of M.lines) {
        const y0 = Math.max(0, Math.ceil(k.t) - M.clip.y), y1 = Math.min(A.h, Math.floor(k.b) - M.clip.y), x0 = Math.max(0, Math.floor(k.l));
        let first = A.w;
        for (let y = y0; y < y1; y++) for (let x = x0; x < first; x++) if (mask[y * A.w + x]) { first = x; break; }
        if (first === A.w) continue;
        const gap = first - Math.ceil(k.r);
        if (!closest || gap < closest.gap) closest = { what: k.what, gap };
        if (gap < GAP) near.push(`${k.what} ${gap < 0 ? `runs ${-gap}px under it` : `ends ${gap}px from it`}`);
      }
      ok(M.dashOn && M.o > 0.99 && drawn >= DRAWN, `${tag}: the dashboard shows (display ${M.dashOn ? 'on' : 'off'}, opacity ${M.o}, ${drawn} of its pixels drawn), want it on screen at full opacity (${DRAWN}+ pixels)`);
      ok(M.title && M.sub, `${tag}: the headline (${M.title ? 'shows' : 'missing'}) and the subtitle (${M.sub ? 'shows' : 'missing'}) are on screen`);
      ok(near.length === 0, `${tag}: hero text within ${GAP}px of the dashboard: ${near.join('; ')}`);
      console.log(`${tag}: dashboard ${drawn}px drawn; ${M.lines.length} lines of hero text; closest ${closest ? `${closest.what} ${closest.gap}px` : 'none in its rows'}`);
    }
  }
  console.log(bad ? `FAIL ${bad} of ${good + bad}` : `PASS ${good} checks`);
  ws.close();
} finally {
  chrome.kill('SIGKILL'); srv.close();
  await sleep(300);
  rmSync(PROFILE, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
