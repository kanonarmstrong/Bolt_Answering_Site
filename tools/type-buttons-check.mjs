// AFMBP-2327 — the owner's type + button pass, site-wide: on the home page, the five trade pages and
// the support page, at 1920x1080, 1440x900, 1024x768, 800x900 and 390x844:
//   - every trial button, reading "Get started now" (AFMBP-2482; it was "Start my free 30-day trial"), (.btn--yellow: the header's, the pricing section's and,
//     on phones, the floating one) is the size of the page's "Talk to your new assistant" button
//     (.btn--blue; on a page without one, the home page's at the same width): the same width, height
//     and font size (the floating one stays bold);
//   - the pricing line ("Our pros say it pays for itself…") is #180A53;
//   - home page: the band's subtitle ("See why pros hire our assistants…") is the pricing line's size;
//   - the header's trial button stays inside the header bar and the window; on phones the floating one
//     shows wherever the page has it (the support pages don't);
//   - on phones the floating one hides (can't be seen or tapped) while the pricing section's trial button
//     is on screen, even just its top edge, and is back once the page scrolls away from it (AFMBP-2348).
// Run: node tools/type-buttons-check.mjs [siteRoot]
//      NC=oldtrial | NC=nominwidth | NC=bandsub | NC=graysub | NC=nohide | NC=stuck | NC=oldlabel — negative controls on
//      the SERVED copy; each must FAIL.
// Nothing leaves the machine: Chrome resolves no host but 127.0.0.1; every other request is answered locally.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

const ROOT = process.argv[2] ?? new URL('..', import.meta.url).pathname;
const NC = process.env.NC || '';
const PAGES = ['/', '/hvac.html', '/electrical.html', '/general-contractor.html', '/handyman.html', '/plumbing.html', '/support/'];
const SIZES = [[1920, 1080], [1440, 900], [1024, 768], [800, 900], [390, 844]];
const NAVY = 'rgb(24, 10, 83)';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };
// Negative controls: [served file, text, replacement].
const MUTATE = {
  // The trial buttons back at their old 30px.
  oldtrial: ['styles.css', 'padding:0 22px;height:49px;min-width:calc(12.4em + 44px);box-shadow', 'padding:0 20px;height:30px;box-shadow'],
  // The trial buttons without the Talk button's width: their own label is narrower.
  nominwidth: ['styles.css', 'height:49px;min-width:calc(12.4em + 44px);box-shadow', 'height:49px;box-shadow'],
  // The band subtitle back at its old size.
  bandsub: ['styles.css', 'font-size:clamp(16px,1.1vw,20px);line-height:1.4;max-width:660px', 'font-size:clamp(16px,1.35vw,25px);line-height:1.4;max-width:660px'],
  // The pricing line back in gray.
  graysub: ['styles.css', '  color: var(--navy); /* "Our pros say', '  color: var(--gray); /* "Our pros say'],
  // The floating button no longer hides at the pricing section (before AFMBP-2348).
  nohide: ['script.js', "cta.classList.toggle('cta-hide', es[es.length - 1].isIntersecting);", 'void es;'],
  // The floating button hides and never comes back.
  stuck: ['script.js', "cta.classList.toggle('cta-hide', es[es.length - 1].isIntersecting);", "cta.classList.add('cta-hide');"],
  // AFMBP-2482: the home page's floating button keeps the old label.
  oldlabel: ['index.html', 'class="btn btn--yellow floating-cta">Get started now</a>', 'class="btn btn--yellow floating-cta">Start my free 30-day trial</a>'],
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
  if (NC && f.endsWith(MUTATE[NC][0])) body = Buffer.from(body.toString('utf8').replace(MUTATE[NC][1], MUTATE[NC][2]));
  res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(body);
}).listen(PORT, '127.0.0.1');

const PROFILE = mkdtempSync(join(tmpdir(), 'cdp-2327-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', '--use-angle=metal', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0, good = 0;
const ok = (c, m) => { if (c) good++; else { bad++; console.log(`  FAIL ${m}`); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

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
    // A request the page abandons (it navigates on) can't be answered any more; that must not take the run down.
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
  const STATE = `(() => {
    const shown = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
    const box = (e) => { const b = e.getBoundingClientRect(), c = getComputedStyle(e); return { cls: e.className, text: e.textContent.replace(/\\s+/g, ' ').trim(), w: b.width, h: b.height, top: b.top, bottom: b.bottom, right: b.right, fs: parseFloat(c.fontSize), fw: c.fontWeight }; };
    const trial = [...document.querySelectorAll('a.btn--yellow')].filter(shown).map(box);
    const talk = [...document.querySelectorAll('a.btn--blue')].filter(shown).map(box);
    const nav = document.querySelector('.nav'), nb = nav && nav.getBoundingClientRect();
    const pr = [...document.querySelectorAll('.section__sub')].find((p) => /pays for itself/.test(p.textContent));
    const sub = document.querySelector('.band__sub');
    return { trial, talk, nav: nb && { top: nb.top, bottom: nb.bottom }, vw: innerWidth, hasFloat: !!document.querySelector('.floating-cta'),
      pricing: pr && { color: getComputedStyle(pr).color, fs: parseFloat(getComputedStyle(pr).fontSize) },
      bandSub: sub && { fs: parseFloat(getComputedStyle(sub).fontSize) } };
  })()`;
  const home = {}; // the home page's Talk button per width, for pages without one
  for (const page of PAGES) {
    for (const [w, h] of SIZES) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w <= 768 });
      await send('Page.navigate', { url: `http://127.0.0.1:${PORT}${page}?bolt_qa=1` });
      for (let i = 0; i < 100; i++) { if ((await ev("document.readyState === 'complete'")) === true) break; await sleep(100); }
      await ev('document.fonts.ready.then(() => true)');
      const S = await ev(STATE);
      const ref = S.talk[0] || home[w];
      if (page === '/' && S.talk[0]) home[w] = S.talk[0];
      const where = `${page} ${w}`;
      ok(ref, `${where}: no "Talk to your new assistant" button to compare with`);
      // (The support pages have only the header's trial button, which phones hide, and no floating one.)
      ok((S.trial.length >= 1 || (w <= 768 && !S.hasFloat)) && S.trial.every((b) => b.text.trim() === 'Get started now'), `${where}: ${S.trial.length} trial buttons shown (${S.trial.map((b) => b.text).join(' | ')})`);
      if (w > 768) ok(S.trial.some((b) => /nav__cta/.test(b.cls)), `${where}: the header's trial button isn't shown`);
      else if (S.hasFloat) ok(S.trial.some((b) => /floating-cta/.test(b.cls)), `${where}: the floating trial button isn't shown on a phone`);
      if (ref) for (const b of S.trial) {
        const which = /nav__cta/.test(b.cls) ? 'header' : /floating-cta/.test(b.cls) ? 'floating' : 'pricing';
        ok(near(b.w, ref.w, 0.6) && near(b.h, ref.h, 0.6) && near(b.fs, ref.fs, 0.05) && (which === 'floating' ? b.fw === '700' : b.fw === ref.fw),
          `${where}: the ${which} trial button is ${b.w.toFixed(1)}x${b.h.toFixed(1)} at ${b.fs}px weight ${b.fw}; "Talk to your new assistant" is ${ref.w.toFixed(1)}x${ref.h.toFixed(1)} at ${ref.fs}px weight ${ref.fw}`);
      }
      // The header's trial button stays inside the header bar and the window.
      const navCta = S.trial.find((b) => /nav__cta/.test(b.cls));
      if (navCta && S.nav) ok(navCta.top >= S.nav.top - 0.5 && navCta.bottom <= S.nav.bottom + 0.5 && navCta.right <= S.vw + 0.5, `${where}: the header's trial button spans y ${navCta.top.toFixed(1)}-${navCta.bottom.toFixed(1)}, right ${navCta.right.toFixed(1)}; the header bar is ${S.nav.top.toFixed(1)}-${S.nav.bottom.toFixed(1)} in a ${S.vw}px window`);
      if (page !== '/support/') ok(S.pricing && S.pricing.color === NAVY, `${where}: the pricing line ("Our pros say it pays for itself…") is ${S.pricing ? S.pricing.color : 'missing'}, want #180A53 (${NAVY})`);
      if (page === '/') ok(S.bandSub && S.pricing && near(S.bandSub.fs, S.pricing.fs, 0.05), `${where}: the band subtitle is ${S.bandSub ? S.bandSub.fs : '?'}px, the pricing line ${S.pricing ? S.pricing.fs : '?'}px — want the same`);
      // AFMBP-2348: on phones the floating button gets out of the way of the pricing section's own trial
      // button: hidden and untappable while any of it is on screen, back once the page scrolls away.
      if (w <= 768 && S.hasFloat) {
        const FLOAT = `(() => {
          const f = document.querySelector('.floating-cta'), c = getComputedStyle(f), b = f.getBoundingClientRect();
          const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
          const p = document.querySelector('#pricing a.btn--yellow'), pb = p && p.getBoundingClientRect();
          return { vis: c.visibility, op: parseFloat(c.opacity), onTop: !!hit && f.contains(hit), pOn: !!pb && pb.bottom > 0 && pb.top < innerHeight };
        })()`;
        const at = async (js) => { await ev(`(() => { ${js}; return true; })()`); await sleep(700); return ev(FLOAT); };
        const mid = await at("document.querySelector('#pricing a.btn--yellow').scrollIntoView({ block: 'center', behavior: 'instant' })");
        ok(mid.pOn && mid.vis === 'hidden' && mid.op === 0 && !mid.onTop, `${where}: with the pricing trial button on screen the floating one is ${mid.vis} at opacity ${mid.op}${mid.onTop ? ' and still tappable' : ''}; want it hidden`);
        const edge = await at("scrollTo(0, document.querySelector('#pricing a.btn--yellow').getBoundingClientRect().top + scrollY - innerHeight + 10)");
        ok(edge.pOn && edge.vis === 'hidden' && !edge.onTop, `${where}: with only the pricing button's top 10px on screen (where the floating one rests) it is ${edge.vis}; want it hidden`);
        const away = await at("scrollTo(0, Math.max(30, document.querySelector('#pricing').getBoundingClientRect().top + scrollY - 2 * innerHeight))");
        ok(!away.pOn && away.vis === 'visible' && away.op === 1 && away.onTop, `${where}: away from the pricing section the floating button is ${away.vis} at opacity ${away.op}${away.onTop ? '' : ', not tappable'}; want it back`);
      }
    }
    console.log(`${page}: ${SIZES.map(([w]) => w).join(', ')} checked`);
  }
  console.log(bad ? `FAIL ${bad} of ${good + bad}` : `PASS ${good} checks`);
  ws.close();
} finally {
  chrome.kill('SIGKILL'); srv.close();
  await sleep(300);
  rmSync(PROFILE, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
