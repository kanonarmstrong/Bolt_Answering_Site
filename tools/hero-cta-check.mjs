// AFMBP-2059 — on phones, each trade page's hero (and the handyman/plumbing feature section) is one
// baked image with the "Talk to your new assistant" button painted in, so a tap on it used to tap a
// picture. This proves the real link laid over it works, with real touch taps, at several phone
// widths: every point of the painted button lands on the link, the link is at least 44px tall and
// stays inside the image, and a tap opens the demo. On desktop the link is hidden and the real hero
// buttons still open the demo.
// Run: node tools/hero-cta-check.mjs [siteRoot]
//      NC=no_demo_open | NC=no_link | NC=plumb_feat_link  — negative controls on the SERVED copy only; each must FAIL.
// Nothing leaves the machine: Chrome resolves no host but 127.0.0.1, and every other request (Meta,
// Google, Bolt's API) is answered locally.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

const ROOT = process.argv[2] ?? new URL('..', import.meta.url).pathname;
const NC = process.env.NC || '';
const PORT = 20000 + Math.floor(Math.random() * 10000), DBG = 30000 + Math.floor(Math.random() * 10000);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.webp': 'image/webp' };

const MUTATE = {
  no_demo_open: (s) => s.split(' data-demo-open aria-label').join(' aria-label'),
  no_link: (s) => s.split('\n').filter((l) => !l.includes('__mobilecta')).join('\n'),
  // Puts a link on plumbing's feature image, which phone3d.css hides on phones (the guard must catch it).
  plumb_feat_link: (s) => s.replace(/(<img class="tpfeat__mobileimg" src="assets\/plumb-feat-mobile[^>]*\/>\n)/, '$1    <a href="#" class="tpfeat__mobilecta" data-demo-open aria-label="Talk to your new assistant"></a>\n'),
};
if (NC && !MUTATE[NC]) throw new Error(`unknown NC "${NC}"; one of ${Object.keys(MUTATE).join(', ')}`);

// The painted button inside each baked image, in image pixels (measured from the images' pixels).
const HERO = { x: 276, y: 891, w: 739, h: 116 };
const HERO_GC = { x: 276, y: 885, w: 738, h: 116 };
const FEAT = { x: 276, y: 1873, w: 738, h: 117 };
const PAGES = [
  { path: '/hvac.html', parts: [['hero', HERO]] },
  { path: '/electrical.html', parts: [['hero', HERO]] },
  { path: '/general-contractor.html', parts: [['hero', HERO_GC]] },
  { path: '/handyman.html', parts: [['hero', HERO], ['feat', FEAT]] },
  // Plumbing's feature section is not baked on phones: phone3d.css shows the live 3D phone and a real button.
  { path: '/plumbing.html', parts: [['hero', HERO]] },
];
const SEL = { hero: ['.tphero__mobileimg', '.tphero__mobilecta'], feat: ['.tpfeat__mobileimg', '.tpfeat__mobilecta'] };
const PHONE_WIDTHS = [360, 390, 430, 768];

const srv = createServer((req, res) => {
  try {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
    let f = join(ROOT, p);
    if (statSync(f).isDirectory()) f = join(f, 'index.html');
    let body = readFileSync(f);
    if (NC && f.endsWith('.html')) body = Buffer.from(MUTATE[NC](body.toString('utf8')));
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(PORT, '127.0.0.1');

const PROFILE = mkdtempSync(join(tmpdir(), 'cdp-2059-'));
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
    if (new URL(request.url).hostname === '127.0.0.1') return send('Fetch.continueRequest', { requestId });
    if (request.method === 'OPTIONS') return send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: CORS });
    return send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [...CORS, { name: 'Content-Type', value: 'application/json' }], body: Buffer.from('{}').toString('base64') });
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('bolt_qa','1')}catch(e){}" });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : null; };
  const load = async (path) => {
    await send('Page.navigate', { url: ORIGIN + path });
    for (let i = 0; i < 80; i++) { if ((await ev("document.readyState === 'complete'")) === true) break; await sleep(100); }
    await sleep(1200);
  };
  const demoOpen = () => ev("!!document.querySelector('.demo-backdrop.open')");
  const closeDemo = async () => {
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(400);
  };

  // Phones: real touch taps on the painted buttons.
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  for (const width of PHONE_WIDTHS) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 2, mobile: true });
    console.log(`[phone ${width}px]`);
    for (const page of PAGES) {
      await load(page.path);
      // Guard: a phone link only ever sits on a baked image that is actually showing.
      ok((await ev("[].slice.call(document.querySelectorAll('.tphero__mobilecta,.tpfeat__mobilecta')).every(function(l){var i=l.previousElementSibling; return !!i && /__mobileimg/.test(i.className) && getComputedStyle(i).display!=='none'})")) === true, `${width}px ${page.path}: every phone link sits on a baked image that is showing`);
      for (const [part, box] of page.parts) {
        const [imgSel, linkSel] = SEL[part];
        const g = await ev(`(async function(){
          var img=document.querySelector('${imgSel}'), link=document.querySelector('${linkSel}');
          if(!img || !img.complete || !img.naturalWidth) return {err:'image not loaded'};
          var b=${JSON.stringify(box)}, r0=img.getBoundingClientRect(), s=r0.width/img.naturalWidth;
          window.scrollTo({top: r0.top + scrollY + (b.y + b.h/2)*s - innerHeight/2, behavior:'instant'});
          await new Promise(function(r){setTimeout(r,300)});
          var r=img.getBoundingClientRect(), L=r.left+b.x*s, T=r.top+b.y*s, W=b.w*s, H=b.h*s;
          var pts=[[L+W/2,T+H/2],[L+3,T+3],[L+W-3,T+3],[L+3,T+H-3],[L+W-3,T+H-3]];
          var on=pts.map(function(p){var e=document.elementFromPoint(p[0],p[1]); return !!(e && link && (e===link || link.contains(e)));});
          var lr=link ? link.getBoundingClientRect() : null;
          return {cx:L+W/2, cy:T+H/2, on:on, linkH: lr ? lr.height : 0,
            inside: !!lr && lr.left>=r.left-0.5 && lr.right<=r.right+0.5 && lr.top>=r.top-0.5 && lr.bottom<=r.bottom+0.5};
        })()`);
        const label = `${width}px ${page.path} ${part}`;
        if (!g || g.err) { ok(false, `${label}: ${g ? g.err : 'no result'}`); continue; }
        ok(g.on.every(Boolean), `${label}: every point of the painted button lands on the link (${g.on.map((x) => (x ? 'y' : 'n')).join('')})`);
        ok(g.linkH >= 43.9, `${label}: tap target at least 44px tall (${g.linkH.toFixed(1)}px)`);
        ok(g.inside, `${label}: link stays inside the image`);
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: g.cx, y: g.cy }] });
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(800);
        ok((await demoOpen()) === true, `${label}: a tap opens the demo`);
        await closeDemo();
      }
    }
  }

  // Desktop: the link is hidden; the real hero buttons still open the demo.
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  console.log('[desktop 1280px]');
  for (const page of PAGES) {
    await load(page.path);
    ok((await ev("[].slice.call(document.querySelectorAll('.tphero__mobilecta,.tpfeat__mobilecta')).every(function(l){return getComputedStyle(l).display==='none'})")) === true, `desktop ${page.path}: phone links hidden`);
    const c = await ev(`(async function(){ var b=document.querySelector('.tphero__copy a.btn--blue'); b.scrollIntoView({block:'center',behavior:'instant'}); await new Promise(function(r){setTimeout(r,500)}); var r=b.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: c.x, y: c.y, button: 'left', clickCount: 1 });
    await sleep(800);
    ok((await demoOpen()) === true, `desktop ${page.path}: the real hero button opens the demo`);
    await closeDemo();
  }

  console.log(bad ? `\n${bad} FAILED, ${good} passed${NC ? ` (negative control: ${NC})` : ''}` : `\nALL PASS (${good} checks)${NC ? ` — negative control ${NC} did NOT bite` : ''}`);
  ws.close();
} finally {
  chrome.kill('SIGKILL'); srv.close();
  await sleep(300); rmSync(PROFILE, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
