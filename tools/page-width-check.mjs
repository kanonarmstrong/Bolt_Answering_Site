// AFMBP-2346 — the home and trade pages are never wider than the window, so nothing shifts them
// sideways. The trade pages were: the tilted phone in "Heroes don't always wear capes" (.tpcapes__phone,
// rotated 18.66deg) reached 26-35px past the window's right edge at 800-1440px (hvac.html was 1466px
// wide in a 1440 window). Anything that scrolls the page (scrollIntoView, find in page) could move it
// that far, and iPad Safari (820pt) laid it out 854 wide and showed it zoomed out to 96%. For the home
// page and the 5 trade pages, at 1440x900, 1280x800, 1024x768, 900x900, 800x900 and 390x844 as a
// desktop window (1x), and at 390x844 as a phone (3x, the meta viewport applied), this proves that:
//   - the page is exactly as wide as the window (document scrollWidth === innerWidth === the emulated
//     width, overlay scrollbars; a phone shows an over-wide page zoomed out, widening innerWidth with it)
//     at the top, with the capes section (home: Reviews) on screen, and at the bottom;
//   - nothing moves it sideways: scrollTo(500, y) leaves scrollX at 0;
//   - the look is unchanged (trade pages wider than 768px, where the phone shows): the phone is still
//     drawn into the sections above and below its own (it pokes ~100px out of both) and right up to the
//     window's edge, so the section crops it at that edge and nowhere else.
// A failure names the elements that reach past the window's right edge.
// Run: node tools/page-width-check.mjs [siteRoot]      PAGES=hvac,index runs only those pages.
//      NC=visible | NC=hidden | NC=moved | NC=home | NC=phone — negative controls on the SERVED copy;
//      each must FAIL.
// Nothing leaves the machine: Chrome resolves no host but 127.0.0.1; every other request is answered locally.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { inflateSync } from 'node:zlib';

const ROOT = process.argv[2] ?? new URL('..', import.meta.url).pathname;
const NC = process.env.NC || '';
const TRADES = ['electrical', 'general-contractor', 'handyman', 'hvac', 'plumbing'];
const PAGES = (process.env.PAGES || ['index', ...TRADES].join(',')).split(',');
// [width, height, phone]: a desktop window at 1x, then a 390 phone at 3x with the meta viewport applied.
const SIZES = [[1440, 900], [1280, 800], [1024, 768], [900, 900], [800, 900], [390, 844], [390, 844, true]];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };
// Negative controls: [served file, text, replacement].
const MUTATE = {
  // The capes section back at overflow:visible (main before AFMBP-2346): the phone widens the page.
  visible: ['styles.css', 'overflow:visible;overflow-x:clip;z-index:2', 'overflow:visible;z-index:2'],
  // Cropped on every side instead: the page fits, but the phone loses the ~100px it pokes up and down.
  hidden: ['styles.css', 'overflow:visible;overflow-x:clip;z-index:2', 'overflow:hidden;z-index:2'],
  // The phone moved in until it fits: the page fits, but the phone no longer reaches the window's edge.
  moved: ['styles.css', 'position:absolute;right:clamp(10px,4vw,90px);top:50%', 'position:absolute;right:clamp(60px,8vw,150px);top:50%'],
  // The home page's Reviews section stops cropping its US map.
  home: ['styles.css', 'overflow:hidden;               /* crops the US-map', 'overflow:visible;              /* crops the US-map'],
  // The phones' pricing card wider than the window (no section crops it).
  phone: ['styles.css', '.chev-mobile{display:block;width:100%;max-width:340px;margin:0 auto;height:auto}', '.chev-mobile{display:block;width:120vw;max-width:none;margin:0 auto;height:auto}'],
};
if (NC) {
  if (!MUTATE[NC]) throw new Error(`unknown NC "${NC}"; one of ${Object.keys(MUTATE).join(', ')}`);
  if (!readFileSync(join(ROOT, MUTATE[NC][0]), 'utf8').includes(MUTATE[NC][1])) throw new Error(`NC ${NC}: its text is no longer in ${MUTATE[NC][0]}`);
}
const POKE = 80;  // px of each section next to the capes one where the phone must still be drawn
const EDGE = 8;   // the window's last columns, where the phone must still be drawn

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
const PROFILE = mkdtempSync(join(tmpdir(), 'cdp-2346-'));
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
  // The page's width, and the outermost elements reaching past the window's right edge that no
  // ancestor crops (fixed boxes don't widen the page).
  const WIDTH = `(() => {
    const cw = document.documentElement.clientWidth;
    const crops = (e) => { const cs = getComputedStyle(e); return cs.overflowX !== 'visible' || /paint|strict|content/.test(cs.contain) || cs.position === 'fixed'; };
    const past = [];
    for (const e of document.querySelectorAll('body *')) {
      const b = e.getBoundingClientRect();
      if (!(b.width || b.height) || b.right + scrollX <= cw + 0.5 || getComputedStyle(e).position === 'fixed') continue;
      let a = e.parentElement; while (a && a !== document.body && !crops(a)) a = a.parentElement;
      if (a && a !== document.body) continue;
      const p = e.parentElement.getBoundingClientRect();
      if (e.parentElement !== document.body && p.right + scrollX > cw + 0.5) continue;
      past.push(e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/).join('.') : '') + ' to x ' + (b.right + scrollX).toFixed(1));
    }
    return { iw: innerWidth, cw, sw: document.documentElement.scrollWidth, past };
  })()`;
  const go = (y) => ev(`(() => { window.scrollTo({ left: 0, top: ${y}, behavior: 'instant' }); return scrollY; })()`);
  const grab = async (clip) => decodePng(Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } })).data, 'base64'));
  const PAINT = '(async () => { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return true; })()';

  for (const page of PAGES) {
    const trade = TRADES.includes(page);
    for (const [w, h, phone] of SIZES) {
      const tag = `${page} ${w}x${h}${phone ? ' phone' : ''}`;
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: phone ? 3 : 1, mobile: !!phone });
      await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${page === 'index' ? '' : `${page}.html`}?bolt_qa=1` });
      for (let i = 0; i < 100; i++) { if ((await ev("document.readyState === 'complete'")) === true) break; await sleep(100); }
      await ev('document.fonts.ready.then(() => true)');
      await sleep(500);
      // The page's width at the top, with the capes section (home: Reviews) centered, and at the bottom.
      const mid = await ev(`(() => { const s = document.querySelector('${trade ? '.tpcapes' : '#reviews'}'); const b = s.getBoundingClientRect(); return Math.max(0, b.top + scrollY + b.height / 2 - innerHeight / 2); })()`);
      const seen = [];
      for (const [where, y] of [['top', 0], ['mid', mid], ['bottom', 1e7]]) {
        await go(y);
        await sleep(where === 'top' ? 0 : 600);
        const W = await ev(WIDTH);
        seen.push(`${where} ${W.sw}`);
        ok(W.cw === w, `${tag}: the window's content area is ${W.cw}px wide, want ${w}: the width checks need overlay scrollbars`);
        // A phone doesn't scroll an over-wide page: it widens its viewport to fit and shows the page
        // zoomed out, so innerWidth grows with scrollWidth.
        ok(W.sw === W.iw && W.iw === w, `${tag} (${where}): the page is ${W.sw}px wide in a ${w}px window${W.iw !== w ? ` (the viewport widened to ${W.iw}: the page shows zoomed out)` : ''}${W.past.length ? `; past the right edge: ${W.past.join(', ')}` : ''}`);
      }
      const sx = await ev("(() => { window.scrollTo({ left: 500, top: scrollY, behavior: 'instant' }); const x = scrollX; window.scrollTo({ left: 0, top: scrollY, behavior: 'instant' }); return x; })()");
      ok(sx === 0, `${tag}: scrollTo(500) moved the page ${sx}px sideways`);
      let look = '';
      if (trade && w > 768) {
        // The phone, shown and hidden: where it is drawn just above and below its section, and in the
        // window's last columns.
        await go(mid);
        await sleep(900);   // the section's reveal (.rv) has faded the phone in
        const g = await ev(`(() => { const s = document.querySelector('.tpcapes').getBoundingClientRect(), p = document.querySelector('.tpcapes__phone').getBoundingClientRect(); return { st: s.top + scrollY, sb: s.bottom + scrollY, pl: p.left, pr: Math.min(p.right, innerWidth), pt: p.top + scrollY, pb: p.bottom + scrollY, o: +getComputedStyle(document.querySelector('.tpcapes__phone')).opacity }; })()`);
        const clips = [
          { x: Math.floor(g.pl), y: Math.floor(g.st) - POKE, width: Math.ceil(g.pr - g.pl), height: POKE },
          { x: Math.floor(g.pl), y: Math.ceil(g.sb), width: Math.ceil(g.pr - g.pl), height: POKE },
          { x: w - EDGE, y: Math.floor(g.pt), width: EDGE, height: Math.ceil(g.pb - g.pt) },
        ];
        await ev(PAINT);
        const A = [];
        for (const c of clips) A.push(await grab(c));
        await ev("(() => { document.querySelector('.tpcapes__phone').style.visibility = 'hidden'; return true; })()");
        await ev(PAINT);
        const n = [];
        for (const [i, c] of clips.entries()) n.push(diffPx(A[i], await grab(c)));
        await ev("(() => { document.querySelector('.tpcapes__phone').style.visibility = ''; return true; })()");
        ok(g.o > 0.99, `${tag}: the capes phone is at opacity ${g.o} when its section is on screen`);
        ok(n[0] >= 2000, `${tag}: the capes phone draws ${n[0]} pixels in the ${POKE}px above its section, want it poking out (2000+)`);
        ok(n[1] >= 2000, `${tag}: the capes phone draws ${n[1]} pixels in the ${POKE}px below its section, want it poking out (2000+)`);
        ok(n[2] >= 300, `${tag}: the capes phone draws ${n[2]} pixels in the window's last ${EDGE} columns, want it reaching the edge (300+)`);
        look = `; phone px above ${n[0]}, below ${n[1]}, at the edge ${n[2]}`;
      }
      console.log(`${tag}: ${seen.join(', ')}, scrollTo(500) -> ${sx}${look}`);
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
