// AFMBP-2182 — the home hero's background video (a Streamable iframe in .hero__bg) changes by id
// only. Owner rule: the hero band's dimensions never change. At 1440x900, 1280x800, 768x1024 and
// 390x844 this proves that:
//   - the iframe loads VIDEO (the expected id with autoplay, muted and no controls) and keeps its
//     other attributes: class, tabindex -1, the empty title, allow, no pointer events, inside the
//     aria-hidden .hero__bg;
//   - the band (.hero), its background (.hero__bg) and the video box sit exactly where they do on
//     BASE (default origin/main, read with `git archive`, never a checkout);
//   - the 16:9 video box covers the whole band, so no strip of the plain background shows.
// Run: node tools/hero-video-check.mjs [siteRoot]
//      NC=old_id | NC=band | NC=wrapper — negative controls on the SERVED head copy; each must FAIL.
//      (wrapper = Streamable's own copy-paste embed: a top-aligned 56.25% box that leaves most of the
//      band uncovered on tablets and phones.)
//      VIDEO=live SHOTS=<dir> — let *.streamable.com through, wait until each hero video has played
//      2s, and save a screenshot of the band per size, base and head.
// Default: nothing leaves the machine. Chrome resolves no host but 127.0.0.1 (plus Streamable with
// VIDEO=live), and every other request is answered locally.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

const ROOT = process.argv[2] ?? new URL('..', import.meta.url).pathname;
const BASE = process.env.BASE || 'origin/main';
const NC = process.env.NC || '';
const LIVE = process.env.VIDEO === 'live';
const SHOTS = process.env.SHOTS || '';
const VIDEO = 'https://streamable.com/e/26u25l?autoplay=1&muted=1&nocontrols=1';
const SIZES = [[1440, 900], [1280, 800], [768, 1024], [390, 844]];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.webp': 'image/webp', '.mp4': 'video/mp4' };

const MUTATE = {
  old_id: (s) => s.replace('streamable.com/e/26u25l?', 'streamable.com/e/wyg0wg?'),
  band: (s) => s.replace('</head>', '<style>.hero{padding-bottom:24px}</style></head>'),
  wrapper: (s) => s.replace(/<iframe class="hero__vidframe"[^>]*><\/iframe>/, '<div style="position:relative; width:100%; height:0px; padding-bottom:56.250%"><iframe allow="fullscreen;autoplay" allowfullscreen height="100%" src="https://streamable.com/e/26u25l?autoplay=1&amp;muted=1&amp;nocontrols=1" width="100%" style="border:none; width:100%; height:100%; position:absolute; left:0px; top:0px; overflow:hidden;"></iframe></div>'),
};
if (NC && !MUTATE[NC]) throw new Error(`unknown NC "${NC}"; one of ${Object.keys(MUTATE).join(', ')}`);

const BASE_DIR = mkdtempSync(join(tmpdir(), 'hv-base-'));
execFileSync('/bin/sh', ['-c', 'git -C "$1" archive "$2" | tar -x -C "$3"', 'sh', ROOT, BASE, BASE_DIR]);

const serve = (root, mutate) => {
  const port = 20000 + Math.floor(Math.random() * 10000);
  const srv = createServer((req, res) => {
    try {
      const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
      let f = join(root, p);
      if (statSync(f).isDirectory()) f = join(f, 'index.html');
      let body = readFileSync(f);
      if (mutate && f === join(root, 'index.html')) body = Buffer.from(mutate(body.toString('utf8')));
      res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  }).listen(port, '127.0.0.1');
  return { srv, origin: `http://127.0.0.1:${port}` };
};
const head = serve(ROOT, NC ? MUTATE[NC] : null);
const base = serve(BASE_DIR, null);

const DBG = 30000 + Math.floor(Math.random() * 10000);
const PROFILE = mkdtempSync(join(tmpdir(), 'cdp-2182-'));
const RULES = 'MAP * ~NOTFOUND , EXCLUDE 127.0.0.1' + (LIVE ? ' , EXCLUDE streamable.com , EXCLUDE *.streamable.com' : '');
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', `--host-resolver-rules=${RULES}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0, good = 0;
const ok = (c, m) => { if (c) good++; else { bad++; console.log(`  FAIL ${m}`); } };
const same = (a, b) => !!a && !!b && ['x', 'y', 'w', 'h'].every((k) => Math.abs(a[k] - b[k]) <= 0.5);
const fmt = (r) => (r ? `${r.w}x${r.h} @ ${r.x},${r.y}` : 'missing');

try {
  let t = null;
  for (let i = 0; i < 100 && !t; i++) { try { t = (await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json()).find((x) => x.type === 'page'); } catch {} if (!t) await sleep(150); }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let nextId = 1; const pending = new Map();
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params })); });
  // The Streamable player runs in its own process (a cross-site frame); it is reached through an
  // auto-attached session, newest last.
  const players = [];
  const CORS = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }];
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); return; }
    if (msg.method === 'Target.attachedToTarget' && msg.params.targetInfo.type === 'iframe') { players.push(msg.params.sessionId); return; }
    if (msg.method !== 'Fetch.requestPaused' || msg.sessionId) return;
    const { requestId, request } = msg.params;
    const host = new URL(request.url).hostname;
    if (host === '127.0.0.1' || (LIVE && (host === 'streamable.com' || host.endsWith('.streamable.com')))) return send('Fetch.continueRequest', { requestId });
    if (request.method === 'OPTIONS') return send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: CORS });
    return send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [...CORS, { name: 'Content-Type', value: 'application/json' }], body: Buffer.from('{}').toString('base64') });
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  if (LIVE) await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('bolt_qa','1')}catch(e){}" });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  const ev = async (expression, sessionId) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId); return r.result ? r.result.value : null; };
  const MEASURE = `(async () => {
    await document.fonts.ready;
    const band = document.querySelector('section.hero');
    const bg = band && band.querySelector('.hero__bg');
    const f = bg && bg.querySelector('iframe');
    const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: +b.left.toFixed(2), y: +(b.top + scrollY).toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2) }; };
    return { band: r(band), bg: r(bg), frame: r(f), frames: bg ? bg.querySelectorAll('iframe').length : 0,
      src: f && f.getAttribute('src'), cls: f && f.getAttribute('class'), tabindex: f && f.getAttribute('tabindex'), title: f && f.getAttribute('title'),
      allow: f && f.getAttribute('allow'), pe: f && getComputedStyle(f).pointerEvents, hidden: bg && bg.getAttribute('aria-hidden'),
      sw: document.documentElement.scrollWidth, vw: innerWidth };
  })()`;
  const PLAYER = "(() => { const v = document.querySelector('video'); return v ? { t: v.currentTime, paused: v.paused, src: (v.currentSrc || '').split('?')[0], w: v.videoWidth, h: v.videoHeight } : null; })()";
  const visit = async (origin, w, h) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: w <= 768 ? 2 : 1, mobile: w <= 768 });
    players.length = 0;
    await send('Page.navigate', { url: `${origin}/?bolt_qa=1&bolt_optout=1` });
    for (let i = 0; i < 100; i++) { if ((await ev("document.readyState === 'complete'")) === true) break; await sleep(100); }
    await sleep(1000);
    let a = await ev(MEASURE);
    for (let i = 0; i < 10; i++) { await sleep(300); const b = await ev(MEASURE); if (JSON.stringify(a) === JSON.stringify(b)) break; a = b; }
    return a;
  };
  const play = async () => {
    for (let i = 0; i < 120; i++) {
      for (const s of players.slice().reverse()) { const v = await ev(PLAYER, s).catch(() => null); if (v && v.t >= 2 && !v.paused) return v; }
      await sleep(250);
    }
    return null;
  };
  // From the top of the page to the bottom of the band. Capturing beyond the viewport resizes it for
  // a moment, which fades the desktop Trades menu in, so it's used only when the band is taller
  // than the screen (phones).
  const shoot = async (file, r, vh) => {
    const bottom = Math.ceil(r.y + r.h);
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: bottom > vh, clip: { x: 0, y: 0, width: r.w, height: bottom, scale: 1 } });
    writeFileSync(join(SHOTS, file), Buffer.from(data, 'base64'));
  };
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });

  for (const [w, h] of SIZES) {
    console.log(`${w}x${h}`);
    const b = await visit(base.origin, w, h);
    let bv = null;
    if (LIVE) { bv = await play(); if (SHOTS && bv) await shoot(`base-${w}x${h}.png`, b.band, h); }
    const n = await visit(head.origin, w, h);
    let nv = null;
    if (LIVE) { nv = await play(); if (SHOTS && nv) await shoot(`head-${w}x${h}.png`, n.band, h); }
    console.log(`  band ${fmt(n.band)} (base ${fmt(b.band)}) · video box ${fmt(n.frame)} (base ${fmt(b.frame)})`);
    ok(n.frames === 1, `${w}: ${n.frames} iframes in .hero__bg, want 1`);
    ok(n.src === VIDEO, `${w}: iframe src ${n.src}, want ${VIDEO}`);
    ok(n.cls === 'hero__vidframe' && n.cls === b.cls, `${w}: iframe class "${n.cls}" (base "${b.cls}")`);
    ok(n.tabindex === '-1' && n.title === '' && n.allow === b.allow, `${w}: tabindex/title/allow changed: ${n.tabindex} / "${n.title}" / ${n.allow}`);
    ok(n.pe === 'none', `${w}: iframe pointer-events ${n.pe}, want none`);
    ok(n.hidden === 'true', `${w}: .hero__bg aria-hidden ${n.hidden}, want true`);
    ok(same(n.band, b.band), `${w}: band ${fmt(n.band)} differs from base ${fmt(b.band)}`);
    ok(same(n.bg, b.bg), `${w}: .hero__bg ${fmt(n.bg)} differs from base ${fmt(b.bg)}`);
    ok(same(n.frame, b.frame), `${w}: video box ${fmt(n.frame)} differs from base ${fmt(b.frame)}`);
    const f = n.frame, B = n.band;
    ok(!!f && !!B && f.x <= B.x + 0.5 && f.y <= B.y + 0.5 && f.x + f.w >= B.x + B.w - 0.5 && f.y + f.h >= B.y + B.h - 0.5, `${w}: video box ${fmt(f)} does not cover band ${fmt(B)}`);
    ok(!!f && Math.abs(f.w / f.h - 16 / 9) < 0.01, `${w}: video box ${fmt(f)} is not 16:9`);
    ok(n.sw === b.sw && n.sw <= n.vw, `${w}: page scroll width ${n.sw} (base ${b.sw}, viewport ${n.vw})`);
    if (LIVE) {
      console.log(`  playing: head ${nv ? `${nv.src} ${nv.w}x${nv.h} t=${nv.t.toFixed(1)}s` : 'NO'} · base ${bv ? `${bv.src} ${bv.w}x${bv.h}` : 'NO'}`);
      ok(!!nv && nv.src.includes(VIDEO.split('/e/')[1].split('?')[0]) && nv.w * 9 === nv.h * 16, `${w}: head video not playing the expected 16:9 file (${nv && nv.src})`);
    }
  }
  console.log(bad ? `FAIL ${bad} of ${good + bad}` : `PASS ${good} checks`);
  ws.close();
} finally {
  chrome.kill('SIGKILL'); head.srv.close(); base.srv.close();
  await sleep(300);
  rmSync(PROFILE, { recursive: true, force: true }); rmSync(BASE_DIR, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
