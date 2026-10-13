// AFMBP-2113 — the home hero's picture must be the 3D phone's own frame, so the 3D phone's
// fade-in (hero-phone.js) swaps identical pixels instead of jumping from an old screenshot.
//
//   node tools/hero-first-frame.mjs render   writes assets/hero-frame/{start,still}-{534,1068,1602}.webp
//                                            + start-1068.png (the no-WebP fallback)
//   node tools/hero-first-frame.mjs check    proves the pictures match, at desktop and phone sizes
//   NC=old_picture|jsdelivr node tools/hero-first-frame.mjs check   — negative controls (must FAIL)
//
// "start" = the loop's first frame (t=0), what most visitors see first.
// "still" = the finished Home screen that reduced-motion visitors get (renderStill()).
// Re-render whenever a hero screen, the pose (POSE), the loop's start or the phone look changes.
//
// Headless Chrome on the real GPU where available. Nothing leaves the machine except the page's
// own files: Google, Meta, Streamable, jsDelivr and Bolt's API are answered locally.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

const MODE = process.argv[2] || 'check';
const ROOT = new URL('..', import.meta.url).pathname;
const NC = process.env.NC || '';
const OUT_DIR = join(ROOT, 'assets/hero-frame');
const WIDTHS = [534, 1068, 1602]; // 178:261 multiples, the box's exact 1068:1566 aspect
const CAPTURE_CSS_W = 890; // box width while rendering; 890x1305 CSS px, x2 = 1780x2610
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2' };
const PORT = 20000 + Math.floor(Math.random() * 10000), DBG = 30000 + Math.floor(Math.random() * 10000);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const OLD_IMG = '<img src="assets/hero-phone.png" alt="Bolt app on a phone showing jobs, leads and today\'s schedule" />';

const MUTATE = {
  // The picture before AFMBP-2113: an old Home screen. The match check must fail.
  old_picture: (f, s) => (f.endsWith('index.html') ? s.replace(/<picture>[\s\S]*?<\/picture>/, OLD_IMG) : s),
  // three.js from jsDelivr again. The "served by this site" check must fail.
  jsdelivr: (f, s) => (f.endsWith('three-phone.js') ? s.replace('./vendor/three-0.169.0/three.module.min.js', 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js') : s),
};
if (NC && !MUTATE[NC]) throw new Error(`unknown NC "${NC}"; one of ${Object.keys(MUTATE).join(', ')}`);

const srv = createServer((req, res) => {
  try {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
    let f = join(ROOT, p);
    // While rendering for the first time the frames don't exist yet: stand the old picture in
    // (same 1068x1566 box; it is hidden during the capture). Never in check mode.
    if (MODE === 'render' && p.startsWith('/assets/hero-frame/') && !existsSync(f)) f = join(ROOT, 'assets/hero-phone.png');
    if (statSync(f).isDirectory()) f = join(f, 'index.html');
    let body = readFileSync(f);
    if (NC && /\.(html|js)$/.test(f)) body = Buffer.from(MUTATE[NC](f, body.toString('utf8')));
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(PORT, '127.0.0.1');

const PROFILE = mkdtempSync(join(tmpdir(), 'cdp-heroframe-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) bad++; };

try {
  let t = null;
  for (let i = 0; i < 100 && !t; i++) { try { t = (await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json()).find((x) => x.type === 'page'); } catch {} if (!t) await sleep(150); }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let nextId = 1; const pending = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  const seen = { jsdelivr: 0, threeLocal: 0 };
  const vendorThree = readFileSync(join(ROOT, 'vendor/three-0.169.0/three.module.min.js'));
  ws.addEventListener('message', async (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); return; }
    if (msg.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = msg.params; const u = new URL(request.url);
    if (u.hostname === '127.0.0.1') {
      if (u.pathname.includes('/vendor/three-0.169.0/')) seen.threeLocal++;
      return send('Fetch.continueRequest', { requestId });
    }
    const reply = (body, type, code = 200) => send('Fetch.fulfillRequest', { requestId, responseCode: code, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Content-Type', value: type }], body: Buffer.from(body).toString('base64') });
    if (u.hostname === 'cdn.jsdelivr.net') { seen.jsdelivr++; return reply(vendorThree, 'text/javascript'); } // keeps the page working under NC=jsdelivr
    if (u.hostname === 'bolt-staging.fly.dev') return reply('{"ok":true}', 'application/json');
    return reply('', 'text/plain'); // Google, Meta, Streamable, anything else: nothing leaves
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });

  const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result ? r.result.value : null; };
  const until = async (expr, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if ((await ev(expr).catch(() => false)) === true) return true; await sleep(100); } return false; };
  const frames = (n = 3) => ev(`new Promise(function(r){var i=${n};(function f(){if(--i<0)return r(1);requestAnimationFrame(f)})()})`);
  async function open(variant, { width, height, dpr, mobile }) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: !!mobile });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: variant === 'still' ? 'reduce' : 'no-preference' }] });
    await send('Page.navigate', { url: `${ORIGIN}/?heroqa=1&bolt_qa=1&bolt_optout=1&nc=${Date.now()}` });
    return until("!!document.querySelector('.hero__media.hero__media--3d') && !!window.__heroPhoneQA && window.__heroPhoneQA.ready()[0] === true");
  }
  async function freeze(variant) {
    if (variant === 'start') await ev('window.__heroPhoneQA.seek(0), 1');
    await frames(4); await sleep(200); await frames(2);
  }
  const rect = (sel) => ev(`(function(){var r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height}})()`);
  const shot = async (clip) => (await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 }, captureBeyondViewport: false })).data;

  if (MODE === 'render') {
    mkdirSync(OUT_DIR, { recursive: true });
    for (const variant of ['start', 'still']) {
      console.log(`[render] ${variant}`);
      ok(await open(variant, { width: 1800, height: 2800, dpr: 2 }), '3D phone took over');
      // Only the phone, on transparency, in a big box; no CSS shadow (the page adds it to both).
      await ev(`(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(
        `html,body{background:transparent!important}body *{visibility:hidden!important}.hero__media,.hero__media *{visibility:visible!important}` +
        // Pinned to the top-left so the whole (enlarged) box is inside the viewport.
        `.hero__media{position:fixed!important;left:0!important;top:0!important;margin:0!important;max-width:none!important;width:${CAPTURE_CSS_W}px!important;z-index:2147483647!important}` +
        `.hero__media img{opacity:0!important;transition:none!important;max-width:none!important;width:${CAPTURE_CSS_W}px!important;margin:0!important;filter:none!important}` +
        `.heroPhone{filter:none!important;transition:none!important}.hero__bg{display:none!important}`)};document.head.appendChild(s);return 1})()`);
      await frames(4); await sleep(300);
      await freeze(variant);
      const r = await rect('.heroPhone');
      ok(Math.abs(r.width - CAPTURE_CSS_W) < 0.01 && Math.abs(r.height - (CAPTURE_CSS_W * 1566) / 1068) < 0.01, `capture box ${r.width}x${r.height} CSS px`);
      const png = await shot(r);
      // Encode in the page: 1780 -> 1602 -> 1068 -> 534, high-quality smoothing at each step.
      const out = await ev(`(async function(){
        var im=new Image();im.src='data:image/png;base64,${png}';await im.decode();
        function draw(src,w,h){var c=document.createElement('canvas');c.width=w;c.height=h;var x=c.getContext('2d');x.imageSmoothingEnabled=true;x.imageSmoothingQuality='high';x.drawImage(src,0,0,w,h);return c}
        var c1602=draw(im,1602,2349),c1068=draw(c1602,1068,1566),c534=draw(c1068,534,783);
        var q=0.9;return {src:[im.naturalWidth,im.naturalHeight],w1602:c1602.toDataURL('image/webp',q),w1068:c1068.toDataURL('image/webp',q),w534:c534.toDataURL('image/webp',q),png1068:${variant === 'start'}?c1068.toDataURL('image/png'):null}
      })()`);
      ok(out.src[0] === CAPTURE_CSS_W * 2 && out.src[1] === 2610, `captured ${out.src.join('x')} px on transparency`);
      for (const w of WIDTHS) {
        const b = Buffer.from(out[`w${w}`].split(',')[1], 'base64');
        ok(b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP', `${variant}-${w}.webp is WebP`);
        writeFileSync(join(OUT_DIR, `${variant}-${w}.webp`), b);
        console.log(`    wrote assets/hero-frame/${variant}-${w}.webp (${Math.round(b.length / 1024)} kB)`);
      }
      if (out.png1068) { const b = Buffer.from(out.png1068.split(',')[1], 'base64'); writeFileSync(join(OUT_DIR, 'start-1068.png'), b); console.log(`    wrote assets/hero-frame/start-1068.png (${Math.round(b.length / 1024)} kB, no-WebP fallback)`); }
    }
  } else {
    await send('Emulation.setDefaultBackgroundColorOverride', {}); // real page background for the comparison
    const VIEWS = { desktop: { width: 1280, height: 900, dpr: 2 }, phone: { width: 390, height: 844, dpr: 3, mobile: true } };
    for (const [vname, view] of Object.entries(VIEWS)) {
      for (const variant of ['start', 'still']) {
        console.log(`[check] ${vname}, ${variant === 'start' ? 'animation (first frame)' : 'reduced motion (still)'}`);
        seen.jsdelivr = 0; seen.threeLocal = 0;
        const took = await open(variant, view);
        ok(took, '3D phone took over');
        if (!took) continue;
        await sleep(450); // past the 320ms cross-fade
        await freeze(variant);
        const info = await ev("(function(){var i=document.querySelector('.hero__media img');return {src:i.currentSrc,fp:i.getAttribute('fetchpriority'),w:i.getAttribute('width'),h:i.getAttribute('height')}})()");
        const want = variant === 'start' ? /\/assets\/hero-frame\/start-\d+\.webp/ : /\/assets\/hero-frame\/still-\d+\.webp/;
        ok(want.test(info.src), `picture shown: ${info.src.replace(ORIGIN, '')}`);
        const r = await rect('.hero__media img');
        await ev("(function(){var s=document.createElement('style');s.id='qa-3d';s.textContent='.hero__media img{opacity:0!important;transition:none!important}.heroPhone{opacity:1!important;transition:none!important}';document.head.appendChild(s);return 1})()");
        await frames(3);
        const a = await shot(r);
        await ev("(function(){document.getElementById('qa-3d').remove();var s=document.createElement('style');s.textContent='.hero__media img{opacity:1!important;transition:none!important}.heroPhone{visibility:hidden!important}';document.head.appendChild(s);return 1})()");
        await frames(3);
        const b = await shot(r);
        const d = await ev(`(async function(){
          async function px(b64){var im=new Image();im.src='data:image/png;base64,'+b64;await im.decode();var c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;var x=c.getContext('2d',{willReadFrequently:true});x.drawImage(im,0,0);return x.getImageData(0,0,c.width,c.height).data}
          var A=await px('${a}'),B=await px('${b}'),n=A.length/4,sum=0,big=0;
          for(var i=0;i<A.length;i+=4){var dr=Math.abs(A[i]-B[i]),dg=Math.abs(A[i+1]-B[i+1]),db=Math.abs(A[i+2]-B[i+2]);sum+=(dr+dg+db)/3;if(Math.max(dr,dg,db)>48)big++}
          return {mean:sum/n,bigPct:100*big/n,n:n}
        })()`);
        ok(d.mean < 2.5 && d.bigPct < 0.5, `picture vs 3D phone, pixel by pixel: mean difference ${d.mean.toFixed(2)}/255, ${d.bigPct.toFixed(2)}% of pixels differ visibly (limits 2.5 and 0.5%)`);
        writeFileSync(join(tmpdir(), `hero-${vname}-${variant}-3d.png`), Buffer.from(a, 'base64'));
        writeFileSync(join(tmpdir(), `hero-${vname}-${variant}-picture.png`), Buffer.from(b, 'base64'));
        ok(info.fp === 'high' && info.w === '1068' && info.h === '1566', 'picture: fetchpriority high, size reserved (1068x1566)');
        ok(seen.jsdelivr === 0 && seen.threeLocal > 0, `three.js served by this site (local ${seen.threeLocal}, jsDelivr ${seen.jsdelivr})`);
      }
    }
    const lazy = await ev("document.querySelector('img.switcher-video').getAttribute('loading')");
    ok(lazy === 'lazy', `the animated heading image waits until needed (loading=${lazy})`);
    console.log(`  (captures saved to ${tmpdir()}/hero-*.png)`);
  }
  console.log(bad ? `\n${bad} FAILED${NC ? ` (negative control: ${NC})` : ''}` : `\nALL PASS${NC ? ` — negative control ${NC} did NOT bite` : ''}`);
  ws.close();
} finally {
  chrome.kill('SIGKILL'); srv.close();
  await sleep(300); rmSync(PROFILE, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
