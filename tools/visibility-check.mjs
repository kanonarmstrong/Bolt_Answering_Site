// AFMBP-2010 — prove the site logs a landing / ad-link demo open only when a page is seen.
// Run: node tools/visibility-check.mjs [siteRoot]   (headless Chrome over CDP; the ingest fetch is stubbed in-page, nothing reaches production)
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
const ROOT = process.argv[2] ?? new URL('..', import.meta.url).pathname;
const PORT = 8765, DBG = 9339;
const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${mkdtempSync('/tmp/cdp-2010-')}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver; for (let i = 0; i < 50 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${DBG}/json/version`)).json(); } catch { await sleep(200); } }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let nextId = 1; const pending = new Map(); const listeners = [];
ws.addEventListener('message', (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); } else listeners.forEach((f) => f(msg)); });
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params, sessionId })); });

const STUB = `window.__sent = [];
(function(){ var real = window.fetch;
  window.fetch = function(url, init){
    var u = String(url);
    if (u.indexOf('/api/public/analytics/events') >= 0) { try { JSON.parse(init.body).events.forEach(function(e){ window.__sent.push({ t: Date.now(), type: e.event_type, data: e.event_data }); }); } catch (x) {}
      return Promise.resolve(new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })); }
    if (u.indexOf('bolt-staging.fly.dev') >= 0) return Promise.resolve(new Response('{}', { status: 200 }));
    return real.apply(this, arguments); }; })();`;
const HIDDEN = `window.__vs = 'hidden';
Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: function(){ return window.__vs; } });
Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: function(){ return window.__vs !== 'visible'; } });`;
const PRERENDER = `window.__pr = true; Object.defineProperty(Document.prototype, 'prerendering', { configurable: true, get: function(){ return window.__pr; } });`;
const WD = (v) => `Object.defineProperty(Navigator.prototype, 'webdriver', { configurable: true, get: function(){ return ${v}; } });`;

async function scenario({ name, path, pre = '', automated = false, flip = null, waitMs = 2500 }) {
  const { browserContextId } = await send('Target.createBrowserContext');
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId); await send('Runtime.enable', {}, sessionId);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB + WD(automated) + pre }, sessionId);
  const loaded = new Promise((r) => { const f = (m) => { if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') { listeners.splice(listeners.indexOf(f), 1); r(); } }; listeners.push(f); });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}${path}` }, sessionId);
  await loaded; await sleep(waitMs);
  const evalv = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId)).result.value;
  const beforeFlip = await evalv('JSON.stringify(window.__sent)');
  if (flip) { await evalv(flip); await sleep(1500); }
  const sent = JSON.parse(await evalv('JSON.stringify(window.__sent)'));
  const modalOpen = await evalv("!!(document.querySelector('.demo-backdrop') && document.querySelector('.demo-backdrop').classList.contains('open'))");
  await send('Target.disposeBrowserContext', { browserContextId });
  return { name, beforeFlip: JSON.parse(beforeFlip), sent, modalOpen };
}

const TALK = '/index.html?talk=1&utm_source=facebook&utm_medium=paid_social&fbclid=TESTCLICK';
let fails = 0; const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) fails++; };
const types = (s) => s.map((e) => e.type + (e.data.trigger ? `(${e.data.trigger})` : '')).join(', ') || 'nothing';
const landing = (s) => s.find((e) => e.type === 'site_landed');

const s1 = await scenario({ name: 'visible ad link', path: TALK });
console.log(`[1] ${s1.name}: ${types(s1.sent)}`);
ok(landing(s1.sent)?.data.visible_at_load === true && landing(s1.sent)?.data.hidden_ms === 0, 'landing logged, visible_at_load=true, hidden_ms=0');
ok(s1.sent.some((e) => e.type === 'demo_opened' && e.data.trigger === 'ad_link') && s1.modalOpen, 'demo auto-opened and logged');
ok(s1.sent.every((e) => !e.data.automated), 'no automated tag for a human browser');

const s2 = await scenario({ name: 'hidden, never seen (preload / background)', path: TALK, pre: HIDDEN, waitMs: 3500 });
console.log(`[2] ${s2.name}: ${types(s2.sent)}`);
ok(s2.sent.length === 0 && !s2.modalOpen, 'nothing logged and the demo stays closed');

const s3 = await scenario({ name: 'hidden, then seen 1.5 s later', path: TALK, pre: HIDDEN, waitMs: 1500, flip: "window.__vs='visible'; document.dispatchEvent(new Event('visibilitychange'))" });
console.log(`[3] ${s3.name}: before=${types(s3.beforeFlip)} | after=${types(s3.sent)}`);
ok(s3.beforeFlip.length === 0, 'nothing while hidden');
ok(landing(s3.sent)?.data.visible_at_load === false && landing(s3.sent)?.data.hidden_ms >= 1300, `landing on reveal, visible_at_load=false, hidden_ms=${landing(s3.sent)?.data.hidden_ms}`);
ok(s3.sent.some((e) => e.type === 'demo_opened' && e.data.trigger === 'ad_link') && s3.modalOpen, 'demo opens on reveal');

const s4 = await scenario({ name: 'prerendered, then activated', path: TALK, pre: PRERENDER, waitMs: 1500, flip: "window.__pr=false; document.dispatchEvent(new Event('prerenderingchange'))" });
console.log(`[4] ${s4.name}: before=${types(s4.beforeFlip)} | after=${types(s4.sent)}`);
ok(s4.beforeFlip.length === 0, 'nothing while prerendering');
ok(landing(s4.sent)?.data.visible_at_load === false && s4.sent.some((e) => e.type === 'demo_opened'), 'landing + demo open after activation');

const s5 = await scenario({ name: 'automated browser (webdriver)', path: TALK, automated: true });
console.log(`[5] ${s5.name}: ${types(s5.sent)}`);
ok(s5.sent.length >= 2 && s5.sent.every((e) => e.data.automated === true), 'every event tagged automated');

const s6 = await scenario({ name: 'visible trade page, no talk link', path: '/handyman.html?utm_source=fb&utm_medium=paid&fbclid=X2' });
console.log(`[6] ${s6.name}: ${types(s6.sent)}`);
ok(landing(s6.sent) && !s6.sent.some((e) => e.type === 'demo_opened') && !s6.modalOpen, 'landing only, demo stays closed');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
ws.close(); chrome.kill(); srv.kill(); process.exit(fails ? 1 : 0);
