// AFMBP-2575 — the demo's code screen ("One-time passcode"): one check per code, and an answer
// that comes back after the screen has moved on is dropped. On 2026-11-12 an iPhone's code
// autofill checked the same code twice, 36 ms apart: the first check passed and the call went
// out; the second found the code spent and put "That code has expired. Request a new code."
// over the Calling card, so the page never showed the call it had placed.
//
// Drives the real modal in headless Chrome (a phone with touch taps, then a computer with the
// mouse) against a fake Bolt API that keeps a code the way the server does (EZ src/otp.ts and
// src/demo-call.ts): the check that passes spends the code (a second check of it gets 400
// no_active_code), a new code inside 60 s of the last is refused (429 rate_limited, a message
// and no seconds field), a resend while a code is live re-sends that code (AFMBP-2054), and the
// token needs a passed check (403 phone_not_verified). Answers are worked out when a request
// arrives (in the order the server would see them) and can be held back to land later.
//
// Two groups of checks:
//   [one]  each double fire (autofill twice at once, autofill again 36 ms later, autofill +
//          Enter, paste + the browser's own input, typed digits + Enter + Continue) sends ONE
//          check and the Calling card stays up; an answer that lands after the screen moved on
//          (the dialog closed, closed and reopened, a check took over from a new code) changes
//          nothing on screen, and a new code can't be asked for while a check is out.
//          These FAIL on the code before the fix.
//   [same] every path with one trigger renders what it rendered before the fix: typing, a
//          paste (whole or partial), Continue, Enter, a wrong code then the right one, too many
//          tries, an expired code, a refused check, a network failure, a new code, a refused
//          new code, the demo limit, a refused token, and the events each one sends. These
//          PASS on the code before the fix too: run this file against a checkout of it
//          (node tools/demo-code-check.mjs <oldRoot>), and only [one] may fail there.
// AFMBP-2596 (the owner's 11-12 update): a phone's code card is "Enter the code", the boxes and
// Back (2670:1394), with no Continue and no resend line; an error is a line over the boxes
// (2895:1339 wrong code, 2895:1370 expired, 2895:1401 system error) whose link sends a new code,
// and a system error stays on the card. The phone runs reach a new code through that link (after
// a wrong code), Back is checked too. AFMBP-2600: a computer shows the same card, so both views
// are held to the same expectations.
// Run: node tools/demo-code-check.mjs [siteRoot]
//      NC=no_single_flight | NC=verify_answer_always | NC=resend_answer_always |
//      NC=link_while_checking | NC=no_inline_system_error — negative
//      controls on the SERVED copy only; each must FAIL.
// Nothing leaves the machine: Chrome resolves no host but 127.0.0.1, and every other request
// (Bolt's API, Meta, Google) is answered here.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';

// Absolute, so a served file's path ends in '/<file>' and a negative control applies even when
// the root is given as '.'.
const ROOT = resolve(process.argv[2] ?? new URL('..', import.meta.url).pathname);
const NC = process.env.NC || '';
const PORT = 20000 + Math.floor(Math.random() * 10000), DBG = 30000 + Math.floor(Math.random() * 10000);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.webp': 'image/webp' };

const cut = (s, from, to) => { if (!s.includes(from)) throw new Error(`NC anchor missing: ${from}`); return s.split(from).join(to); };
const MUTATE = {
  // A second trigger while a check is out sends a second check (the code before the fix).
  no_single_flight: ['demo.js', (s) => cut(s, 'if (opts.locked || checking) return;', 'if (opts.locked) return;')],
  // A check's answer is drawn whatever is on the screen now.
  verify_answer_always: ['demo.js', (s) => cut(s, '        var live = shown();\n', '        var live = true;\n')],
  // A new code's answer is drawn whatever is on the screen now.
  resend_answer_always: ['demo.js', (s) => cut(s, 'var live = !current || current();', 'var live = true;')],
  // AFMBP-2596: a phone's error-line link sends a new code while a check is out.
  link_while_checking: ['demo.js', (s) => cut(s, 'if (!checking && !a.disabled) doResend(a,', 'if (!a.disabled) doResend(a,')],
  // AFMBP-2596 / 2600: a system error on the code card takes the old full error screen.
  no_inline_system_error: ['demo.js', (s) => cut(s, "    track('demo_error', { at: step });\n    renderCode({ kind: 'system' });\n", "    track('demo_error', { at: step });\n    renderError();\n")],
};
if (NC && !MUTATE[NC]) throw new Error(`unknown NC "${NC}"; one of ${Object.keys(MUTATE).join(', ')}`);
// A missing anchor fails here, before anything runs: thrown while serving, it would 404 the
// file and fake a red run.
if (NC && MUTATE[NC][1](readFileSync(join(ROOT, MUTATE[NC][0]), 'utf8')) === readFileSync(join(ROOT, MUTATE[NC][0]), 'utf8')) throw new Error(`NC ${NC} leaves ${MUTATE[NC][0]} unchanged`);

const srv = createServer((req, res) => {
  try {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
    let f = join(ROOT, p);
    if (statSync(f).isDirectory()) f = join(f, 'index.html');
    let body = readFileSync(f);
    if (NC && f.endsWith('/' + MUTATE[NC][0])) body = Buffer.from(MUTATE[NC][1](body.toString('utf8')));
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(PORT, '127.0.0.1');

// ---- the fake Bolt API: a code kept the way the server keeps one ----
const CODES = ['123456', '246810', '135791', '112358'];
const api = {};
const reset = () => Object.assign(api, {
  calls: [], events: [],
  issued: 0, code: null, live: false, lastSend: 0, verified: false,
  throttle: false,   // the server's 60 s between codes (off unless a check turns it on)
  delay: {},         // path -> ms the answer is held back
  force: {},         // path -> [status, body] or 'network', for the next request only
});
reset();
function apiRespond(method, url, postData) {
  const p = new URL(url).pathname;
  let body = null; try { body = JSON.parse(postData || 'null'); } catch {}
  if (p === '/api/public/analytics/events') {
    for (const e of (body && body.events) || []) api.events.push({ type: e.event_type, data: e.event_data || {} });
    return [200, { ok: true }];
  }
  api.calls.push({ method, p, body });
  if (api.force[p]) { const f = api.force[p]; delete api.force[p]; return f; }
  if (p === '/api/demo/otp/send') {
    if (api.throttle && api.lastSend && Date.now() - api.lastSend < 60000) {
      return [429, { error: 'rate_limited', message: `Please wait ${Math.ceil((60000 - (Date.now() - api.lastSend)) / 1000)} seconds before requesting a new code` }];
    }
    api.lastSend = Date.now();
    if (!api.live) { api.code = CODES[api.issued++ % CODES.length]; api.live = true; }
    return [200, { ok: true }];
  }
  if (p === '/api/demo/otp/verify') {
    if (!api.live) return [400, { error: 'no_active_code', message: 'No active verification code. Please request a new one.' }];
    if (!body || body.code !== api.code) return [400, { error: 'incorrect', message: 'Incorrect code' }];
    api.live = false; api.verified = true;
    return [200, { ok: true }];
  }
  if (p === '/api/demo/token') {
    if (!api.verified) return [403, { error: 'phone_not_verified', message: 'Verify your phone first.' }];
    api.verified = false;
    return [200, { token: 'qa-token', demoUrl: 'https://example.invalid/demo' }];
  }
  if (p === '/api/demo/call') return [200, { callId: 'out-1' }];
  if (/^\/api\/demo\/recap\//.test(p)) return [200, { status: 'in_call', transcript: null }];
  if (p === '/api/demo/inbound/session') return [200, { sessionId: '00000000-0000-4000-8000-000000000001', code: '4321', number: '+18554973151', numberDisplay: '(855) 497-3151', telUri: 'tel:+18554973151,,4321', expiresAt: new Date(Date.now() + 600000).toISOString() }];
  if (/^\/api\/demo\/inbound\/session\//.test(p)) return [200, { state: 'waiting', callId: null }];
  return [200, {}];
}
const sent = (p) => api.calls.filter((c) => c.p === p).length;
const evs = (type, pred = () => true) => api.events.filter((e) => e.type === type && pred(e.data)).length;
const VERIFY = '/api/demo/otp/verify', SEND = '/api/demo/otp/send', TOKEN = '/api/demo/token', CALL = '/api/demo/call';

const PROFILE = mkdtempSync(join(tmpdir(), 'cdp-2575-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tally = { one: [0, 0], same: [0, 0] };
let group = 'same';
const ok = (c, m) => { tally[group][c ? 0 : 1]++; if (!c) console.log(`  FAIL [${group}] ${m}`); };

try {
  let t = null;
  for (let i = 0; i < 100 && !t; i++) { try { t = (await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json()).find((x) => x.type === 'page'); } catch {} if (!t) await sleep(150); }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let nextId = 1; const pending = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  const CORS = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: '*' }];
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); return; }
    if (msg.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = msg.params;
    const quiet = (p) => p.catch(() => {});
    const u = new URL(request.url);
    if (u.hostname === '127.0.0.1') return quiet(send('Fetch.continueRequest', { requestId }));
    if (request.method === 'OPTIONS') return quiet(send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: CORS }));
    const bolt = /bolt-staging\.fly\.dev$/.test(u.hostname);
    // Worked out now, in arrival order, as the server would; delivered after any hold.
    const r = bolt ? apiRespond(request.method, request.url, request.postData) : [200, {}];
    const answer = () => r === 'network'
      ? quiet(send('Fetch.failRequest', { requestId, errorReason: 'Failed' }))
      : quiet(send('Fetch.fulfillRequest', { requestId, responseCode: r[0], responseHeaders: [...CORS, { name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(r[1])).toString('base64') }));
    const hold = bolt ? api.delay[u.pathname] || 0 : 0;
    return hold ? setTimeout(answer, hold) : answer();
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  // A QA visit (no Meta / Google); links are recorded and held in place.
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: "try{localStorage.setItem('bolt_qa','1')}catch(e){}" +
      "window.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a');if(!a)return;var h=a.getAttribute('href')||'';if(/^tel:|^mailto:|signup/.test(h)||a.getAttribute('target')==='_blank')e.preventDefault();});",
  });
  const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : null; };
  const load = async (path) => {
    await ev('try{sessionStorage.clear()}catch(e){}');
    await ev('window.__old = 1');
    await send('Page.navigate', { url: ORIGIN + path });
    for (let i = 0; i < 100; i++) { if ((await ev(`!window.__old && document.readyState === 'complete' && location.pathname + location.search === ${JSON.stringify(path)}`)) === true) break; await sleep(100); }
    await ev('document.fonts && document.fonts.ready.then(function(){return 1})');
    await sleep(500);
  };
  const isOpen = () => ev("!!document.querySelector('.demo-backdrop.open')");
  const screen = () => ev("(document.querySelector('.demo-backdrop.open')||{getAttribute:function(){return null}}).getAttribute('data-screen')");
  const waitFor = async (expr, ms = 6000) => { for (let i = 0; i < ms / 50; i++) { if ((await ev(expr)) === true) return true; await sleep(50); } return false; };
  const CODE_UP = "!!document.querySelector('.demo-backdrop.open .demo-code input')";
  const waitScreen = (want, ms) => waitFor(`(document.querySelector('.demo-backdrop.open')||{getAttribute:function(){return null}}).getAttribute('data-screen') === ${JSON.stringify(want)}`, ms);
  const text = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); return e ? e.innerText.replace(/\\s+/g,' ').trim() : null;})()`);
  const box = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; var r=e.getBoundingClientRect(); return {cx:r.left+r.width/2,cy:r.top+r.height/2,w:r.width,h:r.height};})()`);
  const codeState = () => ev("(function(){var d=document.querySelector('.demo-backdrop.open'); if(!d) return null; var vis=function(e){return !!e && e.getClientRects().length>0;}; var bs=[].slice.call(d.querySelectorAll('.demo-code input')); var b=d.querySelector('.demo-body > .demo-btn'), rs=d.querySelector('.demo-resend button'), er=d.querySelector('.demo-error'), ln=d.querySelector('.demo-codeerr'), lk=d.querySelector('.demo-codeerr__link'), h=d.querySelector('.demo-h');" +
    "return {boxes:bs.length, values:bs.map(function(x){return x.value}).join(''), disabled:bs.length>0&&bs.every(function(x){return x.disabled}), enabled:bs.length>0&&bs.every(function(x){return !x.disabled}), err:er?er.textContent:null, errClass:!!d.querySelector('.demo-code.err'), errM:!!d.querySelector('.demo-code.demo-code--err'), line:vis(ln)?ln.innerText.replace(/\\s+/g,' ').trim():null, link:vis(lk)?lk.textContent:null, linkDisabled:lk?lk.disabled:null, btn:b?b.textContent:null, btnDisabled:b?b.disabled:null, btnShown:vis(b), resend:rs?rs.textContent:null, resendDisabled:rs?rs.disabled:null, resendShown:vis(rs), helpShown:vis(d.querySelector('.demo-body .demo-help')), backShown:vis(d.querySelector('.demo-back')), focus:bs.indexOf(document.activeElement), heading:h?h.innerText.replace(/\\s+/g,' ').trim():null};})()");
  let touch = false;
  const tap = async (sel, wait = 0) => {
    const b = await box(sel);
    if (!b) return false;
    if (touch) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.cx, y: b.cy }] });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: b.cx, y: b.cy, button: 'left', clickCount: 1 });
    }
    if (wait) await sleep(wait);
    return true;
  };
  const type = async (sel, s) => { await ev(`document.querySelector(${JSON.stringify(sel)}).focus(); 1`); await send('Input.insertText', { text: s }); await sleep(60); };
  const key = async (k, code, vk) => {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk });
    if (k === 'Enter') await send('Input.dispatchKeyEvent', { type: 'char', text: '\r', key: k, code, windowsVirtualKeyCode: vk });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
  };
  const enter = () => key('Enter', 'Enter', 13);
  const escape = () => key('Escape', 'Escape', 27);
  const phone = async () => {
    touch = true;
    await send('Emulation.setDeviceMetricsOverride', { width: 402, height: 753, deviceScaleFactor: 3, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  };
  const desktop = async () => {
    touch = false;
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  };

  // The form, filled and sent: the code screen up, its code issued (api.code), focus in box 1.
  const toCode = async () => {
    reset();
    await load('/hvac.html?talk=form');
    if (!(await waitScreen('phone'))) return false;
    await type('#demo-phone', '4155551234');
    // The number only, on every device (AFMBP-2596 / AFMBP-2600).
    await ev('document.activeElement && document.activeElement.blur(); 1');
    await tap('.demo-backdrop.open .demo-btn');
    const up = await waitFor(CODE_UP);
    await sleep(120);   // the screen focuses its first box 30 ms after it draws
    return up && sent(SEND) === 1;
  };
  // What a phone's code autofill does: the whole code lands in the box that has focus.
  const AUTOFILL = (c) => `(function(){var b=document.querySelectorAll('.demo-backdrop.open .demo-code input')[0]; b.value=${JSON.stringify(c)}; b.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`;
  const autofill = (c) => ev(AUTOFILL(c));
  const callingHolds = async (what, ms = 1500) => {
    const up = await waitScreen('calling', 4000);
    await sleep(ms);
    const s = await screen(), st = await codeState();
    ok(up && s === 'calling' && st && st.boxes === 0 && !st.err, `${what}: the Calling card comes up and stays (screen ${JSON.stringify(s)}, ${JSON.stringify(st && { boxes: st.boxes, err: st.err })})`);
  };
  const oneCall = (what) => ok(sent(VERIFY) === 1 && sent(TOKEN) === 1 && sent(CALL) === 1 && evs('demo_code_verified') === 1 && evs('demo_code_failed') === 0, `${what}: one check, one token, one call; verified counted once (${[sent(VERIFY), sent(TOKEN), sent(CALL), evs('demo_code_verified'), evs('demo_code_failed')]})`);

  // AFMBP-2596: on a phone the code card is "Enter the code", the boxes and Back (2670:1394): no
  // Continue and no resend line. An error is one line over the boxes (2895:1339 / 2895:1370 /
  // 2895:1401), whose link sends a new code; a system error stays on the card. A phone reaches
  // a new code through that link, so the phone runs below get to an error first where a computer
  // taps "Request a new code".
  const wrongFirst = async () => { await autofill('000000'); return waitFor("!!document.querySelector('.demo-backdrop.open .demo-codeerr__link')", 3000); };
  const LINK = '.demo-backdrop.open .demo-codeerr__link';
  for (const view of ['phone', 'desktop']) {
    if (view === 'phone') await phone(); else await desktop();
    // AFMBP-2600: one responsive demo. A computer shows the phone's code card too ("Enter the
    // code", the boxes, the error line and its link, Back), so both views hold it to the same
    // expectations; the computer run proves the same flow on a computer's screen and keyboard.
    const V = `[${view}]`, P = true;
    // A new code: the computer's resend button, a phone's error-line link (after a wrong code).
    const RESEND = P ? LINK : '.demo-backdrop.open .demo-resend button';
    console.log(`${V} code screen`);

    // ================= [one] the double fires =================
    group = 'one';

    ok(await toCode(), `${V} setup: the form sends one code and the code screen comes up`);
    await ev(`${AUTOFILL(api.code)}; ${AUTOFILL(api.code)}`);   // one task: both before any answer
    await callingHolds(`${V} autofill twice at once`);
    oneCall(`${V} autofill twice at once`);

    if (P) {
      ok(await toCode(), `${V} setup`);
      api.delay[VERIFY] = 250;
      await autofill(api.code);
      await sleep(36);
      await autofill(api.code);
      await callingHolds(`${V} autofill again 36 ms later (the 11-12 iPhone)`);
      oneCall(`${V} autofill again 36 ms later`);

      ok(await toCode(), `${V} setup`);
      api.delay[VERIFY] = 250;
      await send('Input.insertText', { text: api.code });   // into the focused first box
      await enter();
      await callingHolds(`${V} autofill + Enter`);
      oneCall(`${V} autofill + Enter`);

      ok(await toCode(), `${V} setup`);
      await ev(`(function(){var b=document.querySelectorAll('.demo-backdrop.open .demo-code input')[0], dt=new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(api.code)}); b.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true})); b.value=${JSON.stringify(api.code)}; b.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`);
      await callingHolds(`${V} paste + the browser's own input`);
      oneCall(`${V} paste + input`);
    }

    ok(await toCode(), `${V} setup`);
    api.delay[VERIFY] = 800;
    for (const d of api.code) { await send('Input.insertText', { text: d }); await sleep(40); }   // auto-checks on the 6th
    await enter();
    if (P) {
      await sleep(100);
      ok(sent(VERIFY) === 1, `${V} typed + Enter while the check is out: one check (${sent(VERIFY)})`);
      await callingHolds(`${V} typed + Enter`);
      oneCall(`${V} typed + Enter`);
    } else {
      await tap('.demo-backdrop.open .demo-body > .demo-btn');
      await sleep(100);
      ok(sent(VERIFY) === 1 && (await text('.demo-backdrop.open .demo-body > .demo-btn')) === 'Verifying…', `${V} typed + Enter + Continue while the check is out: one check, "Verifying…" (${sent(VERIFY)}, ${await text('.demo-backdrop.open .demo-body > .demo-btn')})`);
      await callingHolds(`${V} typed + Enter + Continue`);
      oneCall(`${V} typed + Enter + Continue`);
    }

    // ================= [one] answers after the screen moved on =================
    ok(await toCode(), `${V} setup`);
    api.delay[VERIFY] = 1200;
    await autofill(api.code);
    await sleep(200);
    await escape();
    ok(!(await isOpen()), `${V} closed while the check is out: the dialog closes`);
    await sleep(1600);
    ok(!(await isOpen()) && sent(TOKEN) === 0 && sent(CALL) === 0, `${V} closed while the check is out: the late pass places no call and opens nothing (open ${await isOpen()}, token ${sent(TOKEN)}, call ${sent(CALL)})`);
    ok(evs('demo_code_verified') === 1, `${V} closed while the check is out: the pass is still counted (${evs('demo_code_verified')})`);

    ok(await toCode(), `${V} setup`);
    api.delay[VERIFY] = 1500;
    await autofill(api.code);
    await sleep(200);
    await escape();
    await ev("document.querySelector('a.btn--blue, button.btn--blue, [data-demo-open]').click(); 1");
    const reopened = await waitScreen('choice', 3000);
    await sleep(1700);
    ok(reopened && (await screen()) === 'choice' && sent(TOKEN) === 0 && sent(CALL) === 0, `${V} closed and reopened while the check is out: the choice stays, no call (${await screen()}, token ${sent(TOKEN)}, call ${sent(CALL)})`);

    if (P) {
      // Back while a check is out: the form, and the late pass places no call.
      ok(await toCode(), `${V} setup`);
      api.delay[VERIFY] = 1200;
      await autofill(api.code);
      await sleep(150);
      await tap('.demo-backdrop.open .demo-back');
      ok(await waitScreen('phone', 2000), `${V} Back while the check is out: the form`);
      await sleep(1500);
      ok((await screen()) === 'phone' && sent(TOKEN) === 0 && sent(CALL) === 0, `${V} Back while the check is out: the late pass places no call (${await screen()}, token ${sent(TOKEN)}, call ${sent(CALL)})`);
    }

    ok(await toCode(), `${V} setup`);
    if (P) ok(await wrongFirst(), `${V} setup: a wrong code puts up the line and its link`);
    api.delay[VERIFY] = 1200;
    if (P) await ev("document.querySelector('.demo-backdrop.open .demo-codeerr').__old = 1; 1");
    await autofill('000000');
    await sleep(150);
    const sendsBefore = sent(SEND);
    await tap(RESEND);
    await sleep(150);
    ok(sent(SEND) === sendsBefore, `${V} a new code asked for while a check is out: nothing sent (${sent(SEND) - sendsBefore} sends)`);
    // The check's own answer draws a new line (a phone) or the error (a computer).
    const wrongUp = await waitFor(P ? "(function(){var l=document.querySelector('.demo-backdrop.open .demo-codeerr'); return !!l && !l.__old;})()" : "!!document.querySelector('.demo-backdrop.open .demo-error')", 3000);
    const w = await codeState();
    ok(wrongUp && (P
      ? w.line === 'Wrong code. Please try again or request another code.' && w.link === 'request another code.' && !w.linkDisabled && w.enabled
      : w.err === 'Wrong code. Please try again or request another code.' && w.enabled && w.resend === 'Request a new code' && !w.resendDisabled),
      `${V} ...then the check's own answer: "Wrong code", a new code can be asked for (${JSON.stringify(w)})`);

    ok(await toCode(), `${V} setup`);
    if (P) ok(await wrongFirst(), `${V} setup: a wrong code puts up the line and its link`);
    api.delay[SEND] = 1500;
    await tap(RESEND);
    await sleep(150);
    await autofill(api.code);
    await callingHolds(`${V} a check passes while a new code is on its way`, 2000);
    ok(sent(SEND) === 2 && sent(CALL) === 1 && evs('demo_code_resent') === 1 && evs('demo_code_verified') === 1, `${V} ...the new code's late answer is counted, not drawn (${[sent(SEND), sent(VERIFY), sent(CALL), evs('demo_code_resent')]})`);

    // ================= [same] one trigger each: as before the fix =================
    group = 'same';

    ok(await toCode(), `${V} setup`);
    const s0 = await codeState();
    if (P) ok(s0.boxes === 6 && s0.values === '' && s0.enabled && s0.line === null && !s0.errM && !s0.btnShown && !s0.resendShown && !s0.helpShown && s0.backShown && s0.focus === 0 && s0.heading === 'Enter the code', `${V} the code card (2670:1394): "Enter the code", six empty boxes, Back; no Continue, resend or help line; focus in the first box (${JSON.stringify(s0)})`);
    else ok(s0.boxes === 6 && s0.values === '' && s0.enabled && s0.err === null && s0.btn === 'Continue' && !s0.btnDisabled && s0.btnShown && s0.resend === 'Request a new code' && !s0.resendDisabled && !s0.backShown && s0.focus === 0 && s0.heading === 'One-time passcode', `${V} the code screen as it was: six empty boxes, Continue, "Request a new code", focus in the first box (${JSON.stringify(s0)})`);
    for (const d of api.code) { await send('Input.insertText', { text: d }); await sleep(40); }
    await callingHolds(`${V} typing the six digits`, 600);
    oneCall(`${V} typing`);

    if (!P) {
      ok(await toCode(), `${V} setup`);
      await ev(`(function(){var b=document.querySelectorAll('.demo-backdrop.open .demo-code input'); ${JSON.stringify(api.code)}.split('').forEach(function(d,i){b[i].value=d}); return 1;})()`);
      await tap('.demo-backdrop.open .demo-body > .demo-btn');
      await callingHolds(`${V} Continue`, 600);
      oneCall(`${V} Continue`);
    }

    ok(await toCode(), `${V} setup`);
    await ev(`(function(){var b=document.querySelectorAll('.demo-backdrop.open .demo-code input'); ${JSON.stringify(api.code)}.split('').forEach(function(d,i){b[i].value=d}); b[5].focus(); return 1;})()`);
    await enter();
    await callingHolds(`${V} Enter`, 600);
    oneCall(`${V} Enter`);

    if (P) {
      ok(await toCode(), `${V} setup`);
      await autofill(api.code);
      await callingHolds(`${V} one autofill`, 600);
      oneCall(`${V} one autofill`);

      ok(await toCode(), `${V} setup`);
      await ev(`(function(){var b=document.querySelectorAll('.demo-backdrop.open .demo-code input')[0], dt=new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(api.code)}); b.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true})); return 1;})()`);
      await callingHolds(`${V} a paste of the code`, 600);
      oneCall(`${V} a paste`);

      ok(await toCode(), `${V} setup`);
      await ev("(function(){var b=document.querySelectorAll('.demo-backdrop.open .demo-code input')[0], dt=new DataTransfer(); dt.setData('text/plain', '12 34'); b.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true})); return 1;})()");
      await sleep(400);
      const pp = await codeState();
      ok(pp.values === '1234' && pp.focus === 4 && sent(VERIFY) === 0, `${V} a paste of four digits: they fill four boxes, focus on the fifth, nothing checked (${JSON.stringify(pp)}, ${sent(VERIFY)})`);

      // Back: the form again, the number still in its field; nothing sent.
      ok(await toCode(), `${V} setup`);
      await tap('.demo-backdrop.open .demo-back');
      ok(await waitScreen('phone', 2000) && (await ev("document.getElementById('demo-phone').value")) === '(415) 555-1234' && sent(SEND) === 1 && sent(VERIFY) === 0, `${V} Back: the form, the number kept, nothing sent (${await ev("(document.getElementById('demo-phone')||{}).value")})`);
    }

    ok(await toCode(), `${V} setup`);
    await autofill('000000');
    ok(await waitFor(P ? `!!document.querySelector('.demo-backdrop.open .demo-codeerr')` : "!!document.querySelector('.demo-backdrop.open .demo-error')", 3000), `${V} a wrong code: an error shows`);
    await sleep(120);   // the redrawn screen focuses its first box 30 ms after it draws
    const wr = await codeState();
    if (P) ok(wr.line === 'Wrong code. Please try again or request another code.' && wr.link === 'request another code.' && wr.errM && wr.values === '' && wr.enabled && wr.focus === 0, `${V} a wrong code: the node's line over the boxes ("Wrong code." red, the link blue), empty red boxes still open, focus in the first box (${JSON.stringify(wr)})`);
    else ok(wr.err === 'Wrong code. Please try again or request another code.' && wr.errClass && wr.values === '' && wr.enabled && wr.btn === 'Continue' && !wr.btnDisabled && wr.focus === 0, `${V} a wrong code: "Wrong code…", empty boxes still open, Continue, focus in the first box (${JSON.stringify(wr)})`);
    ok(evs('demo_code_failed', (d) => d.reason === 'incorrect') === 1, `${V} a wrong code: demo_code_failed {reason: incorrect} once (${evs('demo_code_failed')})`);
    await autofill(api.code);
    await callingHolds(`${V} ...then the right code`, 600);
    ok(sent(VERIFY) === 2 && sent(TOKEN) === 1 && sent(CALL) === 1, `${V} ...then the right code: a second check, one call (${[sent(VERIFY), sent(TOKEN), sent(CALL)]})`);

    for (const [label, answer, want, wantM, linkM] of [
      ['too many tries', [400, { error: 'locked_out', message: 'Too many incorrect attempts. Please request a new code.' }], 'Too many tries. Request a new code.', 'Too many tries. Request a new code', 'Request a new code'],
      ['an expired code', [400, { error: 'no_active_code', message: 'No active verification code. Please request a new one.' }], 'That code has expired. Request a new code.', 'Code expired. Request new code', 'Request new code'],
    ]) {
      ok(await toCode(), `${V} setup`);
      api.force[VERIFY] = answer;
      await autofill(api.code);
      ok(await waitFor(P ? "!!document.querySelector('.demo-backdrop.open .demo-codeerr')" : "!!document.querySelector('.demo-backdrop.open .demo-error')", 3000), `${V} ${label}: an error shows`);
      const st = await codeState();
      if (P) ok(st.line === wantM && st.link === linkM && !st.linkDisabled && st.disabled && st.errM, `${V} ${label}: "${wantM}", the boxes shut, the link sends a new code (${JSON.stringify(st)})`);
      else ok(st.err === want && st.disabled && st.btn === 'Continue' && st.resend === 'Request a new code' && !st.resendDisabled, `${V} ${label}: "${want}", the boxes shut, a new code can be asked for (${JSON.stringify(st)})`);
      if (!P) {
        await tap('.demo-backdrop.open .demo-body > .demo-btn', 300);
        ok(sent(VERIFY) === 1, `${V} ${label}: Continue checks nothing more (${sent(VERIFY)})`);
      }
      await tap(RESEND);
      if (P) ok(await waitFor("(function(){var l=document.querySelector('.demo-backdrop.open .demo-codeerr'), b=document.querySelector('.demo-backdrop.open .demo-code input'); return !l && !!b && !b.disabled;})()", 3000), `${V} ${label}: a new code is sent, the card back as it starts`);
      else ok(await waitFor("(function(){var b=document.querySelector('.demo-backdrop.open .demo-resend button'); return !!b && /^Request a new code in \\d+s$/.test(b.textContent) && b.disabled;})()", 3000), `${V} ${label}: a new code is sent, with the 60 s count`);
      const nc = await codeState();
      ok(sent(SEND) === 2 && nc.enabled && nc.err === null && nc.line === null && evs('demo_code_resent') === 1, `${V} ${label}: ...the boxes open again (${JSON.stringify(nc)}, ${sent(SEND)} sends)`);
    }

    ok(await toCode(), `${V} setup`);
    api.force[VERIFY] = [429, { error: 'rate_limited', message: 'Too many requests' }];
    await autofill(api.code);
    if (P) {
      ok(await waitFor("!!document.querySelector('.demo-backdrop.open .demo-codeerr')", 3000), `${V} a refused check: the line over the boxes`);
      const rl = await codeState();
      ok(rl.line === 'Please wait a moment and try again' && rl.values === '' && rl.enabled && !rl.link, `${V} a refused check: "Please wait a moment and try again" (the server gives no seconds), the boxes open (${JSON.stringify(rl)})`);
    } else {
      ok(await waitFor("(function(){var b=document.querySelector('.demo-backdrop.open .demo-resend button'); return !!b && b.disabled && /^Request a new code in \\d+s$/.test(b.textContent);})()", 3000), `${V} a refused check: the code screen with the count`);
      const rl = await codeState();
      ok(rl.err === null && rl.values === '' && rl.enabled && /^Request a new code in (59|60)s$/.test(rl.resend), `${V} a refused check: no error line, the boxes open, the count from 60 (${JSON.stringify(rl)})`);
    }

    ok(await toCode(), `${V} setup`);
    api.force[VERIFY] = 'network';
    await autofill(api.code);
    if (P) {
      ok(await waitFor("!!document.querySelector('.demo-backdrop.open .demo-codeerr')", 3000), `${V} a network failure on the check: the line over the boxes`);
      const ne = await codeState();
      ok((await screen()) === 'code' && ne.line === 'Something went wrong on our side. Please try again' && !ne.link && ne.enabled && ne.errM, `${V} a network failure: the node's system error on the code card (2895:1401), the boxes open to try again (${JSON.stringify(ne)})`);
    } else {
      ok(await waitFor("(function(){var h=document.querySelector('.demo-backdrop.open .demo-h'); return !!h && h.textContent === 'Something went wrong';})()", 3000), `${V} a network failure on the check: "Something went wrong"`);
    }
    ok(evs('demo_code_failed', (d) => d.reason === 'network') === 1 && evs('demo_error', (d) => d.at === 'code') === 1, `${V} a network failure: demo_code_failed {network} and demo_error {at: code} once each`);

    ok(await toCode(), `${V} setup`);
    if (P) ok(await wrongFirst(), `${V} setup: a wrong code puts up the line and its link`);
    await tap(RESEND);
    if (P) ok(await waitFor("(function(){var l=document.querySelector('.demo-backdrop.open .demo-codeerr'), b=document.querySelector('.demo-backdrop.open .demo-code input'); return !l && !!b && !b.disabled;})()", 3000), `${V} a new code: the card back as it starts (no line, the boxes open)`);
    else ok(await waitFor("(function(){var b=document.querySelector('.demo-backdrop.open .demo-resend button'); return !!b && b.disabled && /^Request a new code in (59|60)s$/.test(b.textContent);})()", 3000), `${V} a new code: the count from 60, the button shut`);
    ok(sent(SEND) === 2 && evs('demo_code_resent') === 1, `${V} a new code: one more send, counted once (${sent(SEND)}, ${evs('demo_code_resent')})`);
    await autofill(api.code);   // a resend while the code is live re-sends that same code
    await callingHolds(`${V} a new code, then the code`, 600);

    ok(await toCode(), `${V} setup`);
    if (P) ok(await wrongFirst(), `${V} setup: a wrong code puts up the line and its link`);
    api.throttle = true;
    await tap(RESEND);
    if (P) {
      ok(await waitFor("(function(){var l=document.querySelector('.demo-backdrop.open .demo-codeerr'); return !!l && /^Please wait/.test(l.innerText);})()", 3000), `${V} a new code inside 60 s: refused, the wait over the boxes`);
      ok(evs('demo_code_send_failed', (d) => d.reason === 'rate_limited' && d.resend === true) === 1 && (await codeState()).line === 'Please wait a moment and try again', `${V} a new code inside 60 s: demo_code_send_failed {rate_limited, resend} once, "Please wait a moment and try again" (${(await codeState()).line})`);
    } else {
      ok(await waitFor("(function(){var b=document.querySelector('.demo-backdrop.open .demo-resend button'); return !!b && b.disabled && /^Request a new code in (59|60)s$/.test(b.textContent);})()", 3000), `${V} a new code inside 60 s: refused, the count from 60`);
      ok(evs('demo_code_send_failed', (d) => d.reason === 'rate_limited' && d.resend === true) === 1 && (await codeState()).err === null, `${V} a new code inside 60 s: demo_code_send_failed {rate_limited, resend} once, no error line`);
    }

    ok(await toCode(), `${V} setup`);
    if (P) ok(await wrongFirst(), `${V} setup: a wrong code puts up the line and its link`);
    api.force[SEND] = [429, { error: 'demo_limit_reached', used: 3, limit: 3, message: 'You’ve used all three demo calls for this number. Start your free trial to keep going.' }];
    await tap(RESEND);
    ok(await waitFor("!!document.querySelector('.demo-backdrop.open .demo-limitmsg')", 3000), `${V} the demo limit on a new code: the limit message`);
    ok((await screen()) === 'phone' && (await text('.demo-backdrop.open .demo-limitmsg')) === 'You’ve reached your demo limit. Start a free trial today' && evs('demo_limit_reached', (d) => d.at === 'code') === 1, `${V} the demo limit: the form with the limit line, counted at the code step (${await text('.demo-backdrop.open .demo-limitmsg')})`);

    ok(await toCode(), `${V} setup`);
    api.force[TOKEN] = [403, { error: 'phone_not_verified', message: 'Verify your phone first.' }];
    await autofill(api.code);
    ok(await waitFor(P ? "!!document.querySelector('.demo-backdrop.open .demo-codeerr')" : "!!document.querySelector('.demo-backdrop.open .demo-error')", 3000), `${V} a refused token: back to the code screen`);
    const tk = await codeState();
    ok((P ? tk.line === 'Code expired. Request new code' : tk.err === 'That code has expired. Request a new code.') && tk.disabled && sent(CALL) === 0 && evs('demo_call_failed', (d) => d.stage === 'token' && d.reason === 'phone_not_verified') === 1, `${V} a refused token: "${P ? 'Code expired. Request new code' : 'That code has expired…'}", the boxes shut, no call, counted (${JSON.stringify(tk)})`);
  }

  const [o1, o0] = tally.one, [s1, s0] = tally.same;
  console.log(`\n[one]  ${o1} passed, ${o0} failed — the double fires and late answers (fail before the fix)`);
  console.log(`[same] ${s1} passed, ${s0} failed — one trigger each, as before the fix`);
  const bad = o0 + s0;
  console.log(bad ? `\n${bad} FAILED, ${o1 + s1} passed${NC ? ` (negative control: ${NC})` : ''}` : `\nALL PASS (${o1 + s1} checks)${NC ? ` — negative control ${NC} did NOT bite` : ''}`);
  ws.close();
  process.exitCode = bad ? 1 : 0;
} finally {
  chrome.kill('SIGKILL'); srv.close();
  await sleep(300); rmSync(PROFILE, { recursive: true, force: true });
}
