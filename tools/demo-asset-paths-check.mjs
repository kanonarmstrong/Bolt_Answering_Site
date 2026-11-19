// AFMBP-2642 — the demo's own images load on every page that opens the demo, folder pages included.
// demo.js builds some images itself (the recap's chat icons, the call-failed card's phone logos, the
// phone entry's mascot, the art it warms). A page-relative path ('assets/…') works on a page in the
// site root but not on a folder page (/about/ asked for /about/assets/… and got 404s, from PR 159 on).
//   - demo.js has no page-relative assets/ path;
//   - on /about/ (a folder page) and on the home page, in headless Chrome at a phone's size, the
//     demo's recap, call-failed card and phone entry, rendered through its QA hook (?demoqa=1),
//     show every image they hold, and no request goes to <folder>/assets/.
// The ingest is stubbed in the page; nothing reaches production, and Chrome resolves no host but
// 127.0.0.1. ?demoqa=1 keeps the Meta Pixel and the Google tag off.
// Run: node tools/demo-asset-paths-check.mjs [siteRoot]
//      NC=relative node tools/demo-asset-paths-check.mjs   — puts one relative path back; must FAIL.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = resolve(process.argv[2] || '.');
const NC = process.env.NC || '';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MUTATE = { relative: (s) => s.replace("src: '/assets/demo-m-chat-' + who + '.svg'", "src: 'assets/demo-m-chat-' + who + '.svg'") };
if (NC && !MUTATE[NC]) { console.error(`unknown NC=${NC}; one of ${Object.keys(MUTATE).join(', ')}`); process.exit(2); }

const results = [];
const check = (name, ok, info) => { results.push({ name, ok: !!ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok || info === undefined ? '' : ' ' + JSON.stringify(info)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let demoSrc = readFileSync(join(ROOT, 'demo.js'), 'utf8');
if (NC) { const t = MUTATE[NC](demoSrc); if (t === demoSrc) { console.error(`NC=${NC}: the mutation did not land`); process.exit(2); } demoSrc = t; }
console.log('[demo.js]');
const relative = demoSrc.match(/['"]assets\/[^'"]*/g) || [];
check('no page-relative assets/ path', relative.length === 0, relative);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const misses = [];
const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, path.endsWith('/') ? `${path}index.html` : path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { misses.push(path); res.writeHead(404); return res.end(); }
  const rel = file.slice(ROOT.length + 1);
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(rel === 'demo.js' ? demoSrc : readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const STUB = `(() => {
  const real = window.fetch.bind(window);
  window.fetch = (url, opts) => { const u = String(url && url.url || url); if (/^https:\\/\\//.test(u)) return Promise.resolve(new Response('{}', { status: 200 })); return real(url, opts); };
})()`;

const prof = mkdtempSync(join(tmpdir(), 'demo-assets-'));
const port = 9300 + Math.floor(Math.random() * 300);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--no-first-run', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
let ws;
try {
  let wsUrl;
  for (let i = 0; i < 450 && !wsUrl; i++) { try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch {} if (!wsUrl) await sleep(100); }
  if (!wsUrl) { console.error('Chrome did not start (no DevTools page in 45 s)'); process.exit(3); }
  ws = new WebSocket(wsUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.value;
  const until = async (e, ms = 6000) => { for (let t = 0; t < ms; t += 100) { if (await ev(e).catch(() => false)) return true; await sleep(100); } return false; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 402, height: 874, deviceScaleFactor: 1, mobile: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
  // Every image in the dialog once it has had time to load: its address and whether it drew.
  const imgs = () => ev(`new Promise((done) => setTimeout(() => done([].map.call(document.querySelectorAll('.demo-card img'), (i) => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0 }))), 900))`);
  for (const page of ['/about/', '/']) {
    console.log(`[${page}]`);
    misses.length = 0;
    await send('Page.navigate', { url: `${BASE}${page}?demoqa=1` });
    check('the demo loads, with its QA hook', await until(`!!window.__demoQA`));
    await ev(`(() => { window.__demoQA.open(); window.__demoQA.recap({ transcript: [{ speaker: 'assistant', text: 'Thanks for calling.' }, { speaker: 'caller', text: 'Hi.' }] }); return true; })()`);
    let got = await imgs();
    check('recap: the assistant and caller icons load', got.filter((i) => /demo-m-chat-(assistant|caller)/.test(i.src)).length >= 2 && got.every((i) => i.ok), got);
    await ev(`(() => { window.__demoQA.fail(); return true; })()`);
    got = await imgs();
    check('call-failed card: the iPhone and Android logos load', got.filter((i) => /demo-m-lockup-(iphone|android)/.test(i.src)).length === 2 && got.every((i) => i.ok), got);
    await ev(`(() => { window.__demoQA.phone(); return true; })()`);
    got = await imgs();
    check('phone entry: every image loads', got.every((i) => i.ok), got);
    const folder = page === '/' ? null : page;
    const wrong = misses.filter((p) => /\/assets\//.test(p));
    check(`no image asked for at a folder's own assets/${folder ? ` (${folder}assets/)` : ''}, no 404s for images`, wrong.length === 0, wrong);
  }
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill('SIGKILL'); server.close();
  await sleep(300); try { rmSync(prof, { recursive: true, force: true }); } catch {}
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length} checks, ${failed} failed${NC ? ` (NC=${NC}: expected to FAIL)` : ''}`);
process.exit(failed ? 1 : 0);
