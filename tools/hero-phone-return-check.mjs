// AFMBP-2581 — the home hero's 3D phone survives leaving the page and coming back with Back (owner 11-12: "When I tapped
// back on the browser from the sign-up screen, the phone animation in the hero on the home page stopped animating, and its
// frame disappeared"). Browsers keep a page they leave in the back/forward cache and Back restores it with its scripts'
// state intact (Safari on iPhone does). hero-phone.js used to tear the phone down on every pagehide (renderer disposed,
// WebGL context forced lost, the frame's handle left set), so a page restored that way showed an empty frame (the picture
// still hidden) and a frozen screen that never restarted.
// At desktop (1280x900) and phone (390x844) sizes this proves, on the home page served locally:
//   - the phone is up and running first: the picture handed over, the phone drawn (silhouette overlap with the picture
//     >= 0.9, hero-phone.js's own QA measure) and its clock moving;
//   - after a real round trip (another page, then Back): if Chrome restored the page from its back/forward cache, the
//     phone is still drawn and its clock moves (when Chrome didn't use the cache, the reason is printed and the step
//     below covers the same code path);
//   - after the events of that round trip on the same page (pagehide, then pageshow, both "persisted"): the same;
//   - when the WebGL context is lost, the picture shows again within half a second (never an empty frame), and when the
//     context comes back the phone is rebuilt, drawn and moving again;
//   - when a lost context never comes back, the phone is rebuilt on a new canvas within 3 s, drawn and moving.
// Run: node tools/hero-phone-return-check.mjs [siteRoot]
//      NC=teardown | NC=nolost — negative controls on the SERVED hero-phone.js; each must FAIL:
//        teardown = the old pagehide handler (dispose + forced context loss on every pagehide);
//        nolost   = no context-loss handling (the picture never comes back, the phone is never rebuilt).
// Nothing leaves the machine: Chrome resolves no host but 127.0.0.1 (iframes included), and the page's requests to any other
// host are answered locally.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

const ROOT = process.argv[2] ?? new URL('..', import.meta.url).pathname;
const NC = process.env.NC || '';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };
const NEW_HIDE = `    window.addEventListener("pagehide", function (e) {
        pause()
        if (e.persisted || disposed) return
        disposed = true`;
const OLD_HIDE = `    window.addEventListener("pagehide", function (e) {
        if (disposed) return
        if (raf) window.cancelAnimationFrame(raf)
        disposed = true`;
const MUTATE = {
  teardown: ['hero-phone.js', NEW_HIDE, OLD_HIDE],
  nolost: ['hero-phone.js', '    init()\n    watchContext(canvas)\n', '    init()\n'],
};
if (NC) {
  if (!MUTATE[NC]) throw new Error(`unknown NC "${NC}"; one of ${Object.keys(MUTATE).join(', ')}`);
  const [f, from] = MUTATE[NC];
  const n = readFileSync(join(ROOT, f), 'utf8').split(from).length - 1;
  if (n !== 1) throw new Error(`NC ${NC}: its text is in ${f} ${n} times, want exactly once`);
}

const PORT = 20000 + Math.floor(Math.random() * 10000), DBG = 30000 + Math.floor(Math.random() * 10000);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const srv = createServer((req, res) => {
  let f, body;
  try {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
    f = join(ROOT, p);
    if (statSync(f).isDirectory()) f = join(f, 'index.html');
    body = readFileSync(f);
  } catch { res.writeHead(404); res.end(); return; }
  if (NC && f === join(ROOT, MUTATE[NC][0])) body = Buffer.from(body.toString('utf8').replace(MUTATE[NC][1], MUTATE[NC][2]));
  // no-cache, not no-store: a no-store page never enters Chrome's back/forward cache, and the round trip is the point.
  res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  res.end(body);
}).listen(PORT, '127.0.0.1');

const PROFILE = mkdtempSync(join(tmpdir(), 'cdp-2581-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--window-size=1280,900', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0, good = 0;
const ok = (c, m) => { if (c) good++; else bad++; console.log(`  ${c ? 'PASS' : 'FAIL'} ${m}`); };

try {
  let t = null;
  for (let i = 0; i < 100 && !t; i++) { try { t = (await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json()).find((x) => x.type === 'page'); } catch {} if (!t) await sleep(150); }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let nextId = 1; const pending = new Map(); const notUsed = [];
  const send = (method, params = {}) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); return; }
    if (msg.method === 'Page.backForwardCacheNotUsed') { notUsed.push(...(msg.params.notRestoredExplanations || []).map((e) => e.reason)); return; }
    if (msg.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = msg.params;
    const done = () => {};
    if (new URL(request.url).hostname === '127.0.0.1') return send('Fetch.continueRequest', { requestId }).catch(done);
    return send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Content-Type', value: 'text/plain' }], body: '' }).catch(done);
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('bolt_qa','1')}catch(e){}window.addEventListener('pageshow',function(e){window.__ps=e.persisted?'cache':'load'})" });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result ? r.result.value : null; };
  const until = async (expr, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if ((await ev(expr).catch(() => false)) === true) return true; await sleep(100); } return false; };
  // The phone as a visitor sees it: handed over from the picture, drawn (overlap with the picture), clock moving.
  const STATE = `(async function(){
    var q=window.__heroPhoneQA,m=document.querySelector('.hero__media'),img=m.querySelector('img'),cv=document.querySelector('.heroPhone__canvas');
    var t0=q.time();await new Promise(function(r){setTimeout(r,700)});var t1=q.time();
    return {handed:m.classList.contains('hero__media--3d'),iou:+q.iou(200).toFixed(3),moved:+(((t1-t0)+q.LOOP)%q.LOOP).toFixed(3),imgOpacity:+getComputedStyle(img).opacity,canvasId:cv&&(cv.__id||(cv.__id=Math.random().toString(36).slice(2,8)))}})()`;
  const phoneOk = (s) => s.handed && s.iou >= 0.9 && s.moved > 0.3;
  const show = (s) => `picture handed over ${s.handed}, overlap ${s.iou}, clock +${s.moved}s in 0.7s`;
  const loseCtx = (restore) => ev(`(function(){var cv=document.querySelector('.heroPhone__canvas');var gl=cv.getContext('webgl2')||cv.getContext('webgl');var x=gl&&gl.getExtension('WEBGL_lose_context');if(!x)return false;window.__lc=x;${restore ? 'x.restoreContext()' : 'x.loseContext()'};return true})()`);

  for (const [name, vp] of [['desktop', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }], ['phone', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }]]) {
    console.log(`[${name}]`);
    await send('Emulation.setDeviceMetricsOverride', vp);
    const home = `${ORIGIN}/?heroqa=1&bolt_qa=1&bolt_optout=1&nc=${Date.now()}`;
    await send('Page.navigate', { url: home });
    const up = await until("!!window.__heroPhoneQA && document.querySelector('.hero__media').classList.contains('hero__media--3d') && window.__heroPhoneQA.ready().every(Boolean)");
    ok(up, `${name}: the 3D phone took over and every screen loaded`);
    if (!up) continue;
    let s = await ev(STATE);
    ok(phoneOk(s), `${name}: first load: ${show(s)}`);

    // 1. A real round trip: another page, then Back.
    notUsed.length = 0;
    await ev(`(function(){window.__mark=1;window.__ps='';return 1})()`);
    await send('Page.navigate', { url: `${ORIGIN}/support/?bolt_qa=1` });
    await until("location.pathname.indexOf('/support')===0 && document.readyState==='complete'");
    await sleep(300);
    const hist = await send('Page.getNavigationHistory');
    await send('Page.navigateToHistoryEntry', { entryId: hist.entries[hist.currentIndex - 1].id });
    await until("location.pathname==='/' && document.readyState==='complete' && !!window.__ps");
    await sleep(500);
    const how = await ev("window.__ps + (window.__mark ? ' (same page)' : ' (reloaded)')");
    if (how.startsWith('cache')) {
      s = await ev(STATE);
      ok(phoneOk(s), `${name}: Back restored the page from the back/forward cache: ${show(s)}`);
    } else {
      console.log(`  NOTE ${name}: Back reloaded the page (${how}); Chrome didn't use its back/forward cache${notUsed.length ? ` (${[...new Set(notUsed)].join(', ')})` : ''}. The next step drives the same code path.`);
      await until("!!window.__heroPhoneQA && document.querySelector('.hero__media').classList.contains('hero__media--3d') && window.__heroPhoneQA.ready().every(Boolean)");
    }

    // 2. The round trip's own events on this page: pagehide then pageshow, both persisted (= into and out of the cache).
    await ev("window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})),1");
    await sleep(400);
    await ev("window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})),1");
    await sleep(500);
    s = await ev(STATE);
    ok(phoneOk(s), `${name}: after pagehide + pageshow (persisted): ${show(s)}`);

    // 3. The WebGL context lost, then given back.
    ok(await loseCtx(false), `${name}: lost the WebGL context`);
    await sleep(500);
    const during = await ev("(function(){var m=document.querySelector('.hero__media');return {handed:m.classList.contains('hero__media--3d'),img:+getComputedStyle(m.querySelector('img')).opacity,phone:+getComputedStyle(document.querySelector('.heroPhone')).opacity}})()");
    ok(!during.handed && during.img > 0.99 && during.phone < 0.01, `${name}: while the context is lost the picture shows (picture opacity ${during.img}, phone ${during.phone})`);
    const c0 = s.canvasId;
    await ev('window.__lc.restoreContext(),1');
    await until("document.querySelector('.hero__media').classList.contains('hero__media--3d')", 4000);
    await sleep(400);
    s = await ev(STATE);
    ok(phoneOk(s) && s.canvasId === c0, `${name}: context given back -> rebuilt on the same canvas: ${show(s)}`);

    // 4. The context lost for good.
    await loseCtx(false);
    await sleep(500);
    const handedBack = await until("document.querySelector('.hero__media').classList.contains('hero__media--3d')", 3000);
    await sleep(400);
    s = await ev(STATE);
    ok(handedBack && phoneOk(s) && s.canvasId !== c0, `${name}: context never given back -> rebuilt on a new canvas: ${show(s)}`);
  }
  console.log(bad ? `FAIL ${bad} of ${good + bad}` : `PASS ${good} checks`);
  ws.close();
} finally {
  chrome.kill('SIGKILL'); srv.close();
  await sleep(300);
  rmSync(PROFILE, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
