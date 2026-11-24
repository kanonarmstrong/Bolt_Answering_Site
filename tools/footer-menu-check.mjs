// AFMBP-2692 — the footer menu is the owner's six links. Owner, 11-23: "I want to change the footer menu to 1/ Back to
// Top: Will automatically scroll to the top of the page 2/ Terms, 3/ Privacy, 4/ Delete My Data, 5/ Privacy Choices
// 6/ "Hi AI..."". Owner, 11-24 (recap D3 = A): the same six links on every screen size, keeping "Your Privacy Choices"
// (California's name for the opt-out link) and "Hey AI, learn about us!". Home, About, Pricing, Support and Sign in
// left the footer; all five are in the header menu.
// For the home page, /about/ and the 5 trade pages, this proves that:
//   - the footer menu is exactly these six links, in this order: Back to Top (#top), Terms (/terms/), Privacy (/privacy/),
//     Delete My Data (/deletemydata), Your Privacy Choices (/privacy/#your-privacy-choices, data-privacy-choices) and
//     Hey AI, learn about us! (/llms.txt);
//   - the blog's next build copies the same six links (tools/blog/lib/chrome.mjs reads hvac.html), and its Back to Top
//     stays on the page it is on (not "/#top", which would open the home page);
// and in Chrome, at 390x844 (a phone, touch) and 1440x900:
//   - the six links show, inside the window, and the page is no wider than the window;
//   - at the bottom of the page, the floating "Start your free trial" button (phones) covers none of the links (not the
//     © line: on /about/, handyman and hvac the button's top edge already sat 4-5px into that line's box before
//     AFMBP-2692, so it is left for its own ticket);
//   - tapping Back to Top at the bottom of the page brings the page to the top, a second time too, with no "#" left in
//     the address. (That is script.js's work, as for the header's own #top links: with JavaScript off, "#top" is the
//     header, which is pinned to the top of the window, so the browser doesn't move.)
// Run: node tools/footer-menu-check.mjs [siteRoot]     PAGES=index.html runs only that page.
//      NC=old | NC=order | NC=label | NC=blog | NC=noscroll | NC=covered — negative controls on the copy
//      read and served; each must FAIL:
//        old      = hvac.html keeps the ten-link footer (the blog would copy it too);
//        order    = Terms and Privacy swapped on the home page;
//        label    = "Terms & Conditions" back on /about/;
//        blog     = the blog's copier turns "#top" into "/#top" again;
//        noscroll = script.js's scroll to the top does nothing, so a tap is swallowed;
//        covered  = phones lose the footer's room under the floating button.
// Nothing leaves the machine: Chrome resolves no host but 127.0.0.1; every other request is answered locally.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.argv[2] ?? new URL('..', import.meta.url).pathname;
const NC = process.env.NC || '';
const PAGES = (process.env.PAGES || 'index.html,about/index.html,electrical.html,general-contractor.html,handyman.html,hvac.html,plumbing.html').split(',');
const VIEWS = [{ name: 'phone 390', w: 390, h: 844, mobile: true }, { name: 'desktop 1440', w: 1440, h: 900, mobile: false }];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.txt': 'text/plain' };
const WANT = [
  ['href="#top"', 'Back to Top'],
  ['href="/terms/"', 'Terms'],
  ['href="/privacy/"', 'Privacy'],
  ['href="/deletemydata"', 'Delete My Data'],
  ['href="/privacy/#your-privacy-choices" data-privacy-choices', 'Your Privacy Choices'],
  ['href="/llms.txt"', 'Hey AI, learn about us!'],
];
const MENU = `    <nav class="footer__menu">\n${WANT.map(([a, t]) => `      <a ${a}>${t}</a>`).join('\n')}\n    </nav>`;
const OLD_HVAC = `    <nav class="footer__menu">
      <a href="index.html">Home</a>
      <a href="/about/">About</a>
      <a href="index.html#how" style="display:none">How it works</a><!-- under construction -->
      <a href="#pricing">Pricing</a>
      <a href="/support">Support</a>
      <a href="https://app.boltanswering.com/login" class="footer__signin">Sign in</a>
      <a href="/terms/">Terms &amp; Conditions</a>
      <a href="/privacy/">Privacy Policy</a>
      <a href="/deletemydata">Delete My Data</a>
      <a href="/privacy/#your-privacy-choices" data-privacy-choices>Your Privacy Choices</a>
      <a href="/llms.txt">Hey AI, learn about us!</a>
    </nav>`;
// Negative controls: [file, text, replacement] — each text must be in its file exactly once.
const MUTATE = {
  old: [['hvac.html', MENU, OLD_HVAC]],
  order: [['index.html', '      <a href="/terms/">Terms</a>\n      <a href="/privacy/">Privacy</a>\n', '      <a href="/privacy/">Privacy</a>\n      <a href="/terms/">Terms</a>\n']],
  label: [['about/index.html', '<a href="/terms/">Terms</a>', '<a href="/terms/">Terms &amp; Conditions</a>']],
  blog: [['tools/blog/lib/chrome.mjs', "u === '#' || u === '#top' || ", "u === '#' || "]],
  noscroll: [['script.js', "function toTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }", 'function toTop() {}']],
  covered: [['styles.css', '.footer{padding-bottom:96px}', '.footer{padding-bottom:0}']],
};
if (NC) {
  if (!MUTATE[NC]) throw new Error(`unknown NC "${NC}"; one of ${Object.keys(MUTATE).join(', ')}`);
  for (const [f, from] of MUTATE[NC]) {
    const n = readFileSync(join(ROOT, f), 'utf8').split(from).length - 1;
    if (n !== 1) throw new Error(`NC ${NC}: its text is in ${f} ${n} times, want exactly once`);
  }
}
/** A file as this run sees it: the real one, with this run's negative control applied. */
const read = (rel) => {
  let s = readFileSync(join(ROOT, rel), 'utf8');
  for (const [f, from, to] of NC ? MUTATE[NC] : []) if (f === rel) s = s.replace(from, to);
  return s;
};

let bad = 0, good = 0;
const ok = (c, m) => { if (c) good++; else { bad++; console.log(`  FAIL ${m}`); } };
const menuLinks = (html) => {
  const menus = [...html.matchAll(/<nav class="footer__menu">([\s\S]*?)<\/nav>/g)];
  return menus.length === 1 ? [...menus[0][1].matchAll(/<a ([^>]*)>([^<]*)<\/a>/g)].map((m) => [m[1], m[2]]) : null;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 1. The markup: each page, then what the blog's next build will copy.
for (const page of PAGES) {
  const links = menuLinks(read(page));
  ok(links && same(links, WANT), `${page}: footer menu is ${links ? links.map(([, t]) => t).join(' · ') : 'missing or doubled'}`);
}
{
  const tmp = mkdtempSync(join(tmpdir(), 'footer-2692-blog-'));
  try {
    for (const rel of ['support/index.html', 'hvac.html', 'tools/blog/lib/chrome.mjs']) {
      mkdirSync(dirname(join(tmp, rel)), { recursive: true });
      writeFileSync(join(tmp, rel), read(rel));
    }
    const { readSiteChrome } = await import(pathToFileURL(join(tmp, 'tools/blog/lib/chrome.mjs')).href);
    const links = menuLinks(readSiteChrome(tmp).footer);
    ok(links && same(links, WANT), `blog: the next build copies a footer menu of ${links ? links.map(([a, t]) => `${t} (${a})`).join(' · ') : 'nothing'}`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

// 2. In Chrome.
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

const PROFILE = mkdtempSync(join(tmpdir(), 'cdp-2692-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result ? r.result.value : null; };
  const load = async (page, v) => {
    await send('Emulation.setDeviceMetricsOverride', { width: v.w, height: v.h, deviceScaleFactor: 1, mobile: v.mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: v.mobile, maxTouchPoints: v.mobile ? 5 : 1 });
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${page}?bolt_qa=1` });
    for (let i = 0; i < 100; i++) { if ((await ev("document.readyState === 'complete'")) === true) break; await sleep(100); }
    await ev('document.fonts.ready.then(() => true)');
    await sleep(300);
  };
  const toBottom = async () => {
    await ev("window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }), true");
    await sleep(800); // the floating button drops to its resting spot (0.5s)
    return ev('Math.round(scrollY)');
  };
  // The footer as drawn: each link's box and whether it is the element on top at its centre.
  const FOOT = `(() => {
    const box = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
    const shown = (e) => { const s = getComputedStyle(e); return s.display !== 'none' && s.visibility === 'visible' && +s.opacity > 0; };
    const links = [...document.querySelectorAll('.footer__menu a')].map((a) => { const b = box(a); const top = document.elementFromPoint(b.x + b.w / 2, b.y + b.h / 2);
      return { text: a.textContent.trim(), shown: shown(a) && b.w > 0 && b.h > 0, ...b, onTop: !!top && (top === a || a.contains(top)) }; });
    const cta = document.querySelector('.floating-cta');
    return { links, cta: cta && shown(cta) ? box(cta) : null, scrollW: document.documentElement.scrollWidth, innerW: innerWidth, innerH: innerHeight };
  })()`;
  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const tapTop = async (v) => {
    const f = await ev(FOOT);
    const b = f.links.find((l) => l.text === 'Back to Top');
    if (!b || !b.onTop || b.y < 0 || b.y + b.h > f.innerH) return false;
    const x = b.x + b.w / 2, y = b.y + b.h / 2;
    if (v.mobile) { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
    else for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    return true;
  };
  const settleTop = async () => { let y = -1; for (let i = 0; i < 40; i++) { y = await ev('Math.round(scrollY)'); if (y === 0) break; await sleep(100); } return y; };

  for (const page of PAGES) {
    for (const v of VIEWS) {
      const tag = `${page} @ ${v.name}`;
      await load(page, v);
      let f = await ev(FOOT);
      ok(same(f.links.map((l) => l.text), WANT.map(([, t]) => t)), `${tag}: the footer shows ${f.links.map((l) => l.text).join(' · ')}`);
      ok(f.links.every((l) => l.shown && l.x >= 0 && l.x + l.w <= f.innerW + 0.5), `${tag}: a footer link is hidden or outside the window: ${f.links.filter((l) => !(l.shown && l.x >= 0 && l.x + l.w <= f.innerW + 0.5)).map((l) => l.text).join(', ')}`);
      ok(f.scrollW <= f.innerW, `${tag}: the page is ${f.scrollW}px wide in a ${f.innerW}px window`);

      const y0 = await toBottom();
      ok(y0 > 300, `${tag}: the page did not scroll to its bottom (scrollY ${y0})`);
      f = await ev(FOOT);
      if (f.cta) {
        const hit = f.links.filter((l) => overlap(l, f.cta)).map((l) => l.text);
        ok(!hit.length, `${tag}: the floating button covers ${hit.join(', ')}`);
      }
      ok(await tapTop(v), `${tag}: Back to Top is not on screen and clear to tap at the bottom of the page`);
      let y = await settleTop();
      ok(y === 0, `${tag}: after Back to Top the page sits at ${y}px, not the top`);
      ok((await ev('location.hash')) === '', `${tag}: the address keeps "${await ev('location.hash')}" after Back to Top`);
      await toBottom();
      ok(await tapTop(v), `${tag}: Back to Top is not clear to tap the second time`);
      y = await settleTop();
      ok(y === 0, `${tag}: a second Back to Top leaves the page at ${y}px`);
    }
  }
  ws.close();
} finally {
  chrome.kill('SIGKILL'); srv.close();
  await sleep(200); try { rmSync(PROFILE, { recursive: true, force: true }); } catch {}
}
console.log(`footer-menu-check: ${good} passed, ${bad} failed${NC ? ` (NC=${NC})` : ''}`);
process.exit(bad ? 1 : 0);
