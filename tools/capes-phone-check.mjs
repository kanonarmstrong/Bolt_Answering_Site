// AFMBP-2377 — the tilted phone in "Heroes don't always wear capes" (.tpcapes__phone) never draws over
// the trade pages' text or the Subscribe form. Below 1025px the section used to drop to one column, so
// the centered headline and subtitle ran under the phone (769-1024px); and on hvac and handyman, where
// Subscribe follows the section, the phone's lower corner (it pokes ~100px into the next section by
// design) covered the Subscribe button (769-1280px). Now the copy keeps its left column down to 769px
// and the Subscribe form draws above the phone. For the 5 trade pages at 769, 800, 820, 834, 900, 1024,
// 1025, 1100, 1180, 1280, 1366 and 1440 (1x, 900 tall, the section in the middle of the screen), this
// proves that:
//   - the phone still shows: at full opacity, with thousands of its pixels drawn;
//   - the phone's own pixels (its drop shadow off) land on no text and no control: every line of text,
//     button, input and the Subscribe form whose box meets the phone's box is unchanged when the phone
//     is hidden (but for 8 pixels of raster noise), measured 1px inside its box (the edge row is
//     anti-aliased against whatever is behind).
// The phone's soft shadow may still fall on text (owner, 10-21: the pricing line's shadow stays).
// Run: node tools/capes-phone-check.mjs [siteRoot]      PAGES=hvac WIDTHS=820,1024 runs only those.
//      NC=onecol | NC=narrow | NC=formunder | NC=nophone — negative controls on the SERVED copy; each must FAIL.
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
const WIDTHS = (process.env.WIDTHS || '769,800,820,834,900,1024,1025,1100,1180,1280,1366,1440').split(',').map(Number);
const H = 900;
// Pixels a box may change by without the phone on it: the Subscribe button's rounded corner re-rasterizes
// when the phone's layer is hidden (up to 3 pixels flip between two yellows, even where the phone is
// nowhere near). A real overlap is hundreds.
const NOISE = 8;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };
// Negative controls: [served file, text, replacement].
const MUTATE = {
  // One column again below 1025px (main before AFMBP-2377): the headline and subtitle run under the phone.
  onecol: ['styles.css', '.tpcapes__inner{grid-template-columns:minmax(0,1fr) 240px}', '.tpcapes__inner{grid-template-columns:1fr}'],
  // A phone column too narrow for the tilted phone: the copy's right end runs under it.
  narrow: ['styles.css', '.tpcapes__inner{grid-template-columns:minmax(0,1fr) 240px}', '.tpcapes__inner{grid-template-columns:minmax(0,1fr) 120px}'],
  // The Subscribe form back under the phone: the phone covers the Subscribe button on hvac and handyman.
  formunder: ['styles.css', '.tpcapes + .subscribe .subscribe__form{position:relative;z-index:3}', '.tpcapes + .subscribe .subscribe__form{position:static}'],
  // The phone hidden below 1025px instead (the override the owner didn't pick): nothing is covered, but the phone is gone.
  nophone: ['styles.css', '.tpcapes__inner{grid-template-columns:minmax(0,1fr) 240px}', '.tpcapes__inner{grid-template-columns:1fr}.tpcapes__phone{display:none}'],
};
if (NC) {
  if (!MUTATE[NC]) throw new Error(`unknown NC "${NC}"; one of ${Object.keys(MUTATE).join(', ')}`);
  if (!readFileSync(join(ROOT, MUTATE[NC][0]), 'utf8').includes(MUTATE[NC][1])) throw new Error(`NC ${NC}: its text is no longer in ${MUTATE[NC][0]}`);
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
// How many pixels differ between two same-size screenshots.
const diffPx = (A, B) => { let n = 0; for (let o = 0; o < A.px.length; o += A.bpp) if (Math.abs(A.px[o] - B.px[o]) + Math.abs(A.px[o + 1] - B.px[o + 1]) + Math.abs(A.px[o + 2] - B.px[o + 2]) > 60) n++; return n; };
const PROFILE = mkdtempSync(join(tmpdir(), 'cdp-2377-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
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
  // This Mac reports reduced motion; most visitors don't, so the motion path is what's measured.
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result ? r.result.value : null; };
  const grab = async (clip) => decodePng(Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } })).data, 'base64'));
  const PAINT = '(async () => { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return true; })()';
  const phoneStyle = (prop, v) => ev(`(() => { document.querySelector('.tpcapes__phone').style.${prop} = '${v}'; return true; })()`);
  // Every line of text, and every control, whose box meets the phone's box: 1px inside its box and
  // inside the window, in page coordinates. Plus the phone's own box and how it is shown.
  const TARGETS = `(() => {
    const ph = document.querySelector('.tpcapes__phone'), P = ph.getBoundingClientRect(), cs = getComputedStyle(ph);
    const meets = (b) => b.right > P.left && b.left < P.right && b.bottom > P.top && b.top < P.bottom;
    const inset = (b) => { const x = Math.max(0, Math.ceil(b.left) + 1), y = Math.max(0, Math.ceil(b.top) + 1), r = Math.min(innerWidth, Math.floor(b.right) - 1), bt = Math.min(innerHeight, Math.floor(b.bottom) - 1); return r - x >= 2 && bt - y >= 2 ? { x, y: y + scrollY, width: r - x, height: bt - y } : null; };
    const name = (e) => { const sec = e.closest('section, footer, header'); return (sec ? sec.className.split(' ')[0] + ' ' : '') + e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/)[0] : ''); };
    const out = [];
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const text = n.textContent.trim(), pe = n.parentElement;
      if (!text || !pe || pe.closest('script, style, noscript, .tpcapes__phone')) continue;
      const s = getComputedStyle(pe); if (s.visibility === 'hidden' || s.display === 'none') continue;
      const r = document.createRange(); r.selectNodeContents(n);
      [...r.getClientRects()].forEach((b, i) => { if (meets(b)) { const c = inset(b); if (c) out.push({ what: name(pe) + ' "' + text.slice(0, 24) + (i ? '" line ' + (i + 1) : '"'), c }); } });
    }
    for (const e of document.querySelectorAll('a.btn, button, input, select, textarea, .subscribe__form')) {
      const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') continue;
      const b = e.getBoundingClientRect(); if (meets(b)) { const c = inset(b); if (c) out.push({ what: name(e) + ' [box]', c }); }
    }
    const box = { x: Math.max(0, Math.floor(P.left)), y: Math.max(0, Math.floor(P.top)) + scrollY, width: Math.min(innerWidth, Math.ceil(P.right)) - Math.max(0, Math.floor(P.left)), height: Math.min(innerHeight, Math.ceil(P.bottom)) - Math.max(0, Math.floor(P.top)) };
    return { out, shown: cs.display !== 'none' && cs.visibility !== 'hidden', o: +cs.opacity, box };
  })()`;

  for (const page of PAGES) {
    for (const w of WIDTHS) {
      const tag = `${page} ${w}`;
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: H, deviceScaleFactor: 1, mobile: false });
      await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${page}.html?bolt_qa=1` });
      for (let i = 0; i < 100; i++) { if ((await ev("document.readyState === 'complete'")) === true) break; await sleep(100); }
      await ev('document.fonts.ready.then(() => true)');
      await sleep(400);
      await ev(`(() => { const b = document.querySelector('.tpcapes').getBoundingClientRect(); window.scrollTo({ left: 0, top: Math.max(0, b.top + scrollY + b.height / 2 - innerHeight / 2), behavior: 'instant' }); return true; })()`);
      await sleep(1300);   // the section's reveal (.rv) has faded the copy and the phone in
      const T = await ev(TARGETS);
      // The phone's own pixels only: its drop shadow off, then the same boxes with the phone hidden.
      await phoneStyle('filter', 'none');
      await ev(PAINT);
      const A = []; for (const k of T.out) A.push(await grab(k.c));
      const P1 = T.box.width > 2 && T.box.height > 2 ? await grab(T.box) : null;
      await phoneStyle('visibility', 'hidden');
      await ev(PAINT);
      const hits = [];
      for (const [i, k] of T.out.entries()) { const n = diffPx(A[i], await grab(k.c)); if (n > NOISE) hits.push(`${k.what} ${n}px`); }
      const drawn = P1 ? diffPx(P1, await grab(T.box)) : 0;
      await phoneStyle('visibility', ''); await phoneStyle('filter', '');
      ok(T.shown && T.o > 0.99 && drawn >= 20000, `${tag}: the capes phone shows (display ${T.shown ? 'on' : 'off'}, opacity ${T.o}, ${drawn} of its pixels drawn), want it on screen at full opacity (20000+ pixels)`);
      ok(hits.length === 0, `${tag}: the capes phone draws over ${hits.join(', ')}`);
      console.log(`${tag}: phone ${drawn}px drawn; ${T.out.length} text lines/controls meet its box; covered: ${hits.length ? hits.join(', ') : 'none'}`);
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
