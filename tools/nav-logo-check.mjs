// AFMBP-2488 — the top nav's "bolt" logo is drawn whole: at its natural shape and its full width.
// The nav is one flex row (logo, then the links and the trial button). When that row needs more room than
// the bar has, flexbox takes the shortfall out of the logo link: it can shrink to nothing, because the global
// img{max-width:100%} gives the logo image no minimum width, while .logo img keeps its height, so the logo
// is drawn squeezed sideways or not at all. The trade and support pages showed a "How it works" link (to the
// home page's section that is hidden while under construction), and with it the row needs about 776px: at
// 769-861px the logo was 0-66px wide instead of 66.6px; those links now stay hidden, as on the home page. For the
// home page, the 5 trade pages, the support page
// and its 3 articles at 769, 780, 800, 820, 834, 850, 861, 862, 900, 1000, 1024, 1025, 1100, 1180, 1280,
// 1366 and 1440 (1x, 900 tall), with Inter loaded, this proves that:
//   - the logo image's box has the picture's own shape: its width is its height x naturalWidth/naturalHeight;
//   - the logo is drawn whole: the pixels it paints (logo shown vs hidden) span the picture's own ink box at
//     its natural width for its height, within 2px each way;
//   - the row fits: the links and the button end inside the bar's padding, the page is no wider than the
//     window, and the logo ends before the links begin;
//   - the links are one row and each link is one line;
//   - while the home page's "How it works" section is hidden, no page shows a link to it (nav or footer):
//     checked once per page.
// Phones (768px and narrower) show the menu button instead of the links, so they aren't measured here.
// Run: node tools/nav-logo-check.mjs [siteRoot]      PAGES=hvac.html WIDTHS=769,800 runs only those.
//      NC=main | NC=footer | NC=shrink | NC=squeeze | NC=clip | NC=wrap — negative controls on the SERVED copy; each must FAIL.
// Nothing leaves the machine: Chrome resolves no host but 127.0.0.1; every other request is answered locally.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { inflateSync } from 'node:zlib';

const ROOT = process.argv[2] ?? new URL('..', import.meta.url).pathname;
const NC = process.env.NC || '';
const TRADES = ['electrical.html', 'general-contractor.html', 'handyman.html', 'hvac.html', 'plumbing.html'];
const SUPPORT = ['support/index.html', 'support/hca/disable-android-spam-blockers/index.html', 'support/hca/disable-ios-spam-blockers/index.html', 'support/hca/verizon-iphone-disable-live-voicemail/index.html'];
const PAGES = (process.env.PAGES || ['index.html', ...TRADES, ...SUPPORT].join(',')).split(',');
const WIDTHS = (process.env.WIDTHS || '769,780,800,820,834,850,861,862,900,1000,1024,1025,1100,1180,1280,1366,1440').split(',').map(Number);
const H = 900;
const SLACK = 2;      // px the drawn logo may differ from the picture's ink box (anti-aliased edges)
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };
const LOGO = '.logo img{height:clamp(30px,3.375vw,42px);width:auto;display:block}';
const HOW = (href) => [`<li style="display:none"><a href="${href}">How it works</a></li><!-- under construction -->`, `<li><a href="${href}">How it works</a></li>`];
const FOOT = ['<a href="index.html#how" style="display:none">How it works</a><!-- under construction -->', '<a href="index.html#how">How it works</a>'];
// Negative controls: [served file, text, replacement] — each text must be in its file exactly once.
const FOOTER = TRADES.map((f) => [f, ...FOOT]);
const MAIN = [...TRADES.map((f) => [f, ...HOW('index.html#how')]), ...SUPPORT.map((f) => [f, ...HOW('/#how')]), ...FOOTER];
const MUTATE = {
  // Main before AFMBP-2488: the trade and support pages show "How it works" again (nav, and the trade footers);
  // the logo gives way.
  main: MAIN,
  // Only the trade footers' link back: a link to a hidden section, nothing else.
  footer: FOOTER,
  // Main plus the logo held at its size (.logo{flex-shrink:0}): the logo is whole, but the row runs past the bar.
  shrink: [...MAIN, ['styles.css', '.logo{display:inline-flex;align-items:center;line-height:0}', '.logo{display:inline-flex;align-items:center;line-height:0;flex-shrink:0}']],
  // A logo box narrower than its picture: drawn squeezed on every page at every width.
  squeeze: [['styles.css', LOGO, LOGO.replace('width:auto', 'width:40px')]],
  // The box keeps its shape but only part of the logo is painted (the right 40% cut off).
  clip: [['styles.css', LOGO, LOGO.replace('display:block}', 'display:block;clip-path:inset(0 40% 0 0)}')]],
  // The links break into rows.
  wrap: [['styles.css', '.nav__links{display:flex;align-items:center;gap:clamp(18px,2.2vw,44px)}', '.nav__links{display:flex;align-items:center;gap:clamp(18px,2.2vw,44px);flex-wrap:wrap;max-width:300px}']],
};
if (NC) {
  if (!MUTATE[NC]) throw new Error(`unknown NC "${NC}"; one of ${Object.keys(MUTATE).join(', ')}`);
  for (const [f, from] of MUTATE[NC]) {
    const n = readFileSync(join(ROOT, f), 'utf8').split(from).length - 1;
    if (n !== 1) throw new Error(`NC ${NC}: its text is in ${f} ${n} times, want exactly once`);
  }
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
  for (const [file, from, to] of NC ? MUTATE[NC] : []) if (f === join(ROOT, file)) body = Buffer.from(body.toString('utf8').replace(from, to));
  res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(body);
}).listen(PORT, '127.0.0.1');

// A PNG's pixels (8-bit RGB or RGBA, not interlaced): screenshots, and the logo picture itself.
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
// The box around the pixels that differ between two same-size screenshots, or null.
function diffBox(A, B) {
  let x0 = A.w, y0 = A.h, x1 = -1, y1 = -1;
  for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) {
    const o = (y * A.w + x) * A.bpp;
    if (Math.abs(A.px[o] - B.px[o]) + Math.abs(A.px[o + 1] - B.px[o + 1]) + Math.abs(A.px[o + 2] - B.px[o + 2]) > 60) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? null : { l: x0, t: y0, r: x1 + 1, b: y1 + 1 };
}
// The picture's own ink box (alpha 128+), as fractions of its size.
const inkCache = new Map();
function ink(file) {
  if (!inkCache.has(file)) {
    const P = decodePng(readFileSync(file));
    if (P.bpp !== 4) throw new Error(`${file}: want an RGBA PNG`);
    let x0 = P.w, y0 = P.h, x1 = -1, y1 = -1;
    for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) if (P.px[(y * P.w + x) * 4 + 3] >= 128) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    inkCache.set(file, { l: x0 / P.w, t: y0 / P.h, r: (x1 + 1) / P.w, b: (y1 + 1) / P.h });
  }
  return inkCache.get(file);
}
const PROFILE = mkdtempSync(join(tmpdir(), 'cdp-2488-'));
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
  const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result ? r.result.value : null; };
  const grab = async (clip) => decodePng(Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } })).data, 'base64'));
  const PAINT = '(async () => { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return true; })()';
  // The nav's boxes in window coordinates (the page is at the top), the logo picture's file, and every
  // shown link's line boxes.
  const MEASURE = `(() => {
    const nav = document.querySelector('.nav'), bar = nav.querySelector('.nav__inner'), logo = bar.querySelector('.logo'), img = logo.querySelector('img');
    const box = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
    // A link's text lines (its text only: the Trades link also holds a chevron icon).
    const links = [...bar.querySelectorAll('.nav__links > li')].filter((li) => getComputedStyle(li).display !== 'none').map((li) => {
      const a = li.querySelector('a'), rects = [], tw = document.createTreeWalker(a, NodeFilter.SHOW_TEXT);
      for (let n = tw.nextNode(); n; n = tw.nextNode()) { if (!n.textContent.trim()) continue; const r = document.createRange(); r.selectNodeContents(n); rects.push(...[...r.getClientRects()].filter((k) => k.width > 1 && k.height > 1)); }
      return { text: a.textContent.trim(), lines: new Set(rects.map((k) => Math.round(k.top))).size, mid: rects.length ? (rects[0].top + rects[0].bottom) / 2 : NaN };
    });
    const cs = getComputedStyle(bar);
    return {
      nav: { w: innerWidth, h: Math.ceil(nav.getBoundingClientRect().bottom) }, scrollY, docW: document.documentElement.scrollWidth,
      inter: document.fonts.check('500 14px Inter'), src: new URL(img.currentSrc).pathname, nw: img.naturalWidth, nh: img.naturalHeight,
      img: box(img), logo: box(logo), menu: box(bar.querySelector('.nav__menu')), cta: box(bar.querySelector('.nav__cta')),
      edge: bar.getBoundingClientRect().right - parseFloat(cs.paddingRight), links,
    };
  })()`;
  const logoVis = (v) => ev(`(() => { document.querySelector('.nav .logo img').style.setProperty('visibility', '${v}', 'important'); return true; })()`);
  // Links shown on the page (nav, footer or anywhere) to the home page's "How it works" section.
  const HOWLINKS = `[...document.querySelectorAll('a[href]')].filter((a) => { const u = new URL(a.href); return (u.pathname === '/' || u.pathname === '/index.html') && u.hash === '#how' && a.getClientRects().length > 0 && getComputedStyle(a).visibility !== 'hidden'; })
    .map((a) => (a.closest('footer') ? 'footer' : a.closest('.nav') ? 'nav' : 'page') + ' "' + a.textContent.trim() + '"')`;
  const load = async (page, w) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: H, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${page}?bolt_qa=1` });
    for (let i = 0; i < 100; i++) { if ((await ev("document.readyState === 'complete'")) === true) break; await sleep(100); }
  };
  // Is that section hidden (under construction)? Then a link to it lands at the top of the home page.
  await load('index.html', 1280);
  const howHidden = await ev("(() => { const s = document.getElementById('how'); return !s || getComputedStyle(s).display === 'none'; })()");
  console.log(`home page "How it works" section: ${howHidden ? 'hidden' : 'shown'}`);

  for (const page of PAGES) {
    for (const w of WIDTHS) {
      const tag = `${page.replace(/(^|\/)index\.html$/, '$1') || 'index.html'} ${w}`;
      await load(page, w);
      await ev('document.fonts.ready.then(() => true)');
      await ev(`Promise.race([document.querySelector('.nav .logo img').decode().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]).then(() => true)`);
      await ev(PAINT);
      const M = await ev(MEASURE);
      const clip = { x: 0, y: 0, width: M.nav.w, height: M.nav.h };
      const A = await grab(clip);
      await logoVis('hidden'); await ev(PAINT);
      const D = diffBox(A, await grab(clip));
      const k = ink(join(ROOT, M.src)), I = M.img, natW = I.h * M.nw / M.nh;
      // Where the picture's ink lands when it is drawn whole: at its natural width for the image's height.
      const want = { l: I.l + k.l * natW, t: I.t + k.t * I.h, r: I.l + k.r * natW, b: I.t + k.b * I.h };
      ok(M.inter && M.scrollY === 0, `${tag}: Inter is ${M.inter ? '' : 'NOT '}loaded and the page is at the top (scrollY ${M.scrollY})`);
      ok(Math.abs(I.w - natW) <= 0.5, `${tag}: the logo's box is ${I.w.toFixed(1)}x${I.h.toFixed(1)}px, want ${natW.toFixed(1)} wide for that height (its picture is ${M.nw}x${M.nh})`);
      const off = D ? Math.max(...['l', 't', 'r', 'b'].map((s) => Math.abs(D[s] - want[s]))) : Infinity;
      ok(off <= SLACK, `${tag}: the logo is drawn ${D ? `${D.r - D.l}x${D.b - D.t}px at ${D.l},${D.t}` : 'nowhere'}, want its ink ${(want.r - want.l).toFixed(1)}x${(want.b - want.t).toFixed(1)}px at ${want.l.toFixed(1)},${want.t.toFixed(1)} (within ${SLACK}px)`);
      const fits = M.menu.r <= M.edge + 0.5 && M.cta.r <= M.edge + 0.5 && M.docW <= w && M.logo.r <= M.menu.l;
      ok(fits, `${tag}: the nav row fits: links and button end at ${M.menu.r.toFixed(1)} / ${M.cta.r.toFixed(1)}, want <= ${M.edge.toFixed(1)}; page ${M.docW}px wide; logo ends at ${M.logo.r.toFixed(1)}, links begin at ${M.menu.l.toFixed(1)}`);
      const mids = M.links.map((l) => l.mid), wrapped = M.links.filter((l) => l.lines !== 1).map((l) => l.text);
      ok(M.links.length >= 5 && Math.max(...mids) - Math.min(...mids) <= 2 && !wrapped.length, `${tag}: the ${M.links.length} links are one row (text centered at ${Math.min(...mids).toFixed(1)}-${Math.max(...mids).toFixed(1)}), each one line${wrapped.length ? ` (more than one: ${wrapped.join(', ')})` : ''}`);
      if (w === WIDTHS[0]) {
        const how = await ev(HOWLINKS);
        ok(!howHidden || !how.length, `${tag}: ${how.length} link(s) shown to the home page's hidden "How it works" section: ${how.join(', ')}`);
      }
      console.log(`${tag}: logo ${I.w.toFixed(1)}x${I.h.toFixed(1)} (want ${natW.toFixed(1)} wide), drawn ${D ? `${D.r - D.l}x${D.b - D.t}` : 'nowhere'} (ink ${(want.r - want.l).toFixed(1)}x${(want.b - want.t).toFixed(1)}, ${off.toFixed(1)}px off); row ends ${M.menu.r.toFixed(1)} of ${M.edge.toFixed(1)}, ${(M.menu.l - M.logo.r).toFixed(1)}px between logo and links; ${M.links.length} links`);
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
