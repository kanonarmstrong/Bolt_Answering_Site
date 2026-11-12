// AFMBP-2578 — the nav's "Trades" and "Community" menus never stick open after a click (owner 11-12: "it's possible to
// tap on trades or community to make the drop-down menu sticky. This can look like clutter if one drop-down menu is
// sticky and another renders"). Before: styles.css showed a menu on :hover OR :focus-within, and a mouse click focuses
// the link (Chrome, Edge, Firefox), so the clicked menu stayed up after the mouse left, and hovering the other trigger
// showed two menus. Now a menu shows on hover, or while focus inside it came from the keyboard (:focus-visible).
// For the home page, a trade page, the about page, the support page and one of its articles (inline nav script, no
// script.js) and the blog home, at 1440, 1024 and 800px (desktop menus), this proves that:
//   - hovering a trigger shows its menu and only its menu;
//   - clicking it does not move the page (no jump to the top, no "#" in the address);
//   - after the click, moving the mouse away hides the menu, though the link still has focus (the old sticky case);
//   - with one menu clicked, hovering the other shows exactly one menu (the owner's clutter case), for both menus;
//   - the keyboard still works: Tab onto a trigger shows its menu, Tab into its links keeps it up, Tab past them
//     hides it and shows the next one;
// and at 390px (phone menu) that the hamburger menu's lists still open and close on tap, one at a time.
// Run: node tools/nav-dropdown-check.mjs [siteRoot]     PAGES=index.html WIDTHS=1440 runs only those.
//      NC=pin | NC=jump | NC=keys — negative controls on the SERVED copy; each must FAIL:
//        pin  = the old :focus-within rule (menus stick after a click);
//        jump = script.js cancels the trigger's "#" on phones only, as before (the page jumps to the top);
//        keys = no keyboard rule at all (Tab onto a trigger shows nothing).
// Nothing leaves the machine: Chrome resolves no host but 127.0.0.1; every other request is answered locally.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

const ROOT = process.argv[2] ?? new URL('..', import.meta.url).pathname;
const NC = process.env.NC || '';
const PAGES = (process.env.PAGES || 'index.html,hvac.html,about/index.html,support/index.html,support/hca/disable-ios-spam-blockers/index.html,blog/index.html').split(',');
const WIDTHS = (process.env.WIDTHS || '1440,1024,800').split(',').map(Number);
const PHONE = 390, H = 900;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };
const KEYS = '.nav__dropdown:has(:focus-visible) .nav__dropdown-menu{opacity:1;visibility:visible;transform:translateX(-50%) translateY(0)}';
const HOVER = '.nav__dropdown:hover .nav__dropdown-menu{opacity:1;visibility:visible;transform:translateX(-50%) translateY(0)}';
const JS_NOW = "      e.preventDefault();\n      if (window.matchMedia('(max-width: 768px)').matches) {\n";
const JS_OLD = "      if (window.matchMedia('(max-width: 768px)').matches) {\n        e.preventDefault();\n";
// Negative controls: [served file, text, replacement] — each text must be in its file exactly once.
const MUTATE = {
  pin: [['styles.css', `${HOVER}\n${KEYS}`, '.nav__dropdown:hover .nav__dropdown-menu,\n.nav__dropdown:focus-within .nav__dropdown-menu{opacity:1;visibility:visible;transform:translateX(-50%) translateY(0)}']],
  jump: [['script.js', JS_NOW, JS_OLD]],
  keys: [['styles.css', `\n${KEYS}`, '']],
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

const PROFILE = mkdtempSync(join(tmpdir(), 'cdp-2578-'));
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
    const done = () => {};
    if (new URL(request.url).hostname === '127.0.0.1') return send('Fetch.continueRequest', { requestId }).catch(done);
    if (request.method === 'OPTIONS') return send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: CORS }).catch(done);
    return send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [...CORS, { name: 'Content-Type', value: 'application/json' }], body: Buffer.from('{}').toString('base64') }).catch(done);
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('bolt_qa','1')}catch(e){}" });
  // Menus fade in 0.2s; the check reads them at rest. Reduced motion would hide a menu that only shows mid-fade.
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result ? r.result.value : null; };
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1, ...extra });
  const tab = async () => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 }); };
  const REST = 450; // > the menus' 0.2s fade
  // Each dropdown's trigger centre (window coordinates), whether its menu shows, and where focus is.
  const STATE = `(() => {
    const dds = [...document.querySelectorAll('.nav__dropdown')];
    const shown = (m) => { const s = getComputedStyle(m); return s.visibility === 'visible' && +s.opacity > 0.99 && m.getBoundingClientRect().height > 0; };
    const a = document.activeElement;
    return {
      dds: dds.map((d) => { const t = d.querySelector('.nav__dropdown-trigger'), b = t.getBoundingClientRect(); return { name: t.textContent.trim(), x: b.left + b.width / 2, y: b.top + b.height / 2, shown: shown(d.querySelector('.nav__dropdown-menu')), links: d.querySelectorAll('.nav__dropdown-menu a[href]').length }; }),
      focus: a ? { inDd: dds.findIndex((d) => d.contains(a)), trigger: !!(a.classList && a.classList.contains('nav__dropdown-trigger')), text: (a.textContent || '').trim().slice(0, 30) } : null,
      scrollY: Math.round(scrollY), hash: location.hash, href: location.href,
    };
  })()`;
  const st = () => ev(STATE);
  const load = async (page, w, mobile) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: H, deviceScaleFactor: 1, mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${page}?bolt_qa=1` });
    for (let i = 0; i < 100; i++) { if ((await ev("document.readyState === 'complete'")) === true) break; await sleep(100); }
    await ev('document.fonts.ready.then(() => true)');
    await sleep(300);
  };
  const shownNames = (s) => s.dds.filter((d) => d.shown).map((d) => d.name).join(' + ') || 'none';

  for (const page of PAGES) {
    for (const w of WIDTHS) {
      const tag = `${page} ${w}`;
      await load(page, w, false);
      // Scrolled a little, so a jump to the top shows (the nav stays in view: it is fixed to the top).
      await ev('(() => { scrollTo(0, 300); return true; })()'); await sleep(REST);
      let s = await st();
      ok(s.dds.length === 2 && s.dds.every((d) => d.links > 0), `${tag}: want the two menus (Trades, Community) with links, got ${s.dds.map((d) => `${d.name}/${d.links}`).join(', ')}`);
      if (s.dds.length !== 2) continue;
      const y0 = s.scrollY, away = { x: Math.round(w / 2), y: H - 120 };
      ok(y0 > 0, `${tag}: the page scrolled to ${y0} before the clicks`);
      const notes = [];
      for (const [i, j] of [[0, 1], [1, 0]]) {
        const A = s.dds[i], B = s.dds[j];
        await mouse('mouseMoved', away.x, away.y); await sleep(REST);
        await mouse('mouseMoved', A.x, A.y); await sleep(REST);
        s = await st();
        ok(s.dds[i].shown && !s.dds[j].shown, `${tag}: hovering ${A.name} shows ${shownNames(s)}, want ${A.name} only`);
        await mouse('mousePressed', A.x, A.y); await mouse('mouseReleased', A.x, A.y); await sleep(REST);
        s = await st();
        ok(s.scrollY === y0 && !s.hash, `${tag}: clicking ${A.name} moved the page: scrollY ${y0} -> ${s.scrollY}, address ends "${s.hash}"`);
        const focused = s.focus && s.focus.trigger && s.focus.inDd === i;
        await mouse('mouseMoved', away.x, away.y); await sleep(REST);
        s = await st();
        ok(!s.dds[i].shown, `${tag}: after clicking ${A.name} and moving away, ${shownNames(s)} still shows (stuck open)`);
        await mouse('mouseMoved', B.x, B.y); await sleep(REST);
        s = await st();
        ok(s.dds[j].shown && !s.dds[i].shown, `${tag}: ${A.name} clicked, then hovering ${B.name} shows ${shownNames(s)}, want ${B.name} only`);
        notes.push(`${A.name} click: focus ${focused ? 'on it' : 'elsewhere'}, then hover ${B.name} -> ${shownNames(s)}`);
      }
      // Keyboard: focus the nav item before "Trades", then Tab through Trades' links and on to "Community".
      await mouse('mouseMoved', away.x, away.y); await sleep(REST);
      const prev = await ev(`(() => { const t = document.querySelector('.nav__dropdown-trigger'); const all = [...document.querySelectorAll('.nav a[href], .nav button')].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden'); const p = all[all.indexOf(t) - 1]; if (!p) return null; p.focus(); return p.textContent.trim().slice(0, 20) || p.className; })()`);
      await tab(); await sleep(REST);
      s = await st();
      ok(s.focus && s.focus.trigger && s.focus.inDd === 0 && s.dds[0].shown && !s.dds[1].shown, `${tag}: Tab from "${prev}" onto ${s.dds[0].name}: focus "${s.focus && s.focus.text}", shows ${shownNames(s)}, want ${s.dds[0].name}`);
      let inside = true;
      for (let k = 0; k < s.dds[0].links; k++) {
        await tab(); await sleep(120);
        const q = await st();
        inside = inside && q.focus && q.focus.inDd === 0 && !q.focus.trigger && q.dds[0].shown;
      }
      ok(inside, `${tag}: Tab through ${s.dds[0].name}'s ${s.dds[0].links} links keeps its menu up`);
      await tab(); await sleep(REST);
      s = await st();
      ok(s.focus && s.focus.trigger && s.focus.inDd === 1 && s.dds[1].shown && !s.dds[0].shown, `${tag}: Tab past ${s.dds[0].name}'s links onto ${s.dds[1].name}: shows ${shownNames(s)}, want ${s.dds[1].name}`);
      s = await st();
      ok(s.scrollY === y0 && !s.hash, `${tag}: the page stayed put through the clicks and keys: scrollY ${y0} -> ${s.scrollY}, address ends "${s.hash}"`);
      console.log(`${tag}: ${notes.join('; ')}; keyboard from "${prev}" ok`);
    }
    // Phone menu: the hamburger's lists open and close on tap, one at a time.
    const tag = `${page} ${PHONE}`;
    await load(page, PHONE, true);
    const P = await ev(`(async () => {
      const wait = () => new Promise((r) => setTimeout(r, 400));
      const dds = [...document.querySelectorAll('.nav__dropdown')], tr = dds.map((d) => d.querySelector('.nav__dropdown-trigger'));
      const open = () => dds.map((d) => d.classList.contains('open') && d.querySelector('.nav__dropdown-menu').getBoundingClientRect().height > 20);
      document.getElementById('navToggle').click(); await wait();
      const out = [];
      tr[0].click(); await wait(); out.push(open());
      tr[1].click(); await wait(); out.push(open());
      tr[1].click(); await wait(); out.push(open());
      return { out, hash: location.hash };
    })()`);
    const want = [[true, false], [false, true], [false, false]];
    ok(JSON.stringify(P.out) === JSON.stringify(want) && !P.hash, `${tag}: phone menu lists (tap Trades, tap Community, tap Community) ${JSON.stringify(P.out)}, want ${JSON.stringify(want)}; address ends "${P.hash}"`);
    console.log(`${tag}: phone menu ${JSON.stringify(P.out)}`);
  }
  console.log(bad ? `FAIL ${bad} of ${good + bad}` : `PASS ${good} checks`);
  ws.close();
} finally {
  chrome.kill('SIGKILL'); srv.close();
  await sleep(300);
  rmSync(PROFILE, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
