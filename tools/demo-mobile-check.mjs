// AFMBP-2150 — the phone demo after its readability redraw, beyond the first screen (that one
// is tools/demo-landing-check.mjs): the "We call you" form in its three states (Figma
// 2657:1639 empty, 2670:1317 filled, 2676:1272 incomplete), the Calling card (2442:1191), the
// shared success (2441:811) and the failure card with its help links (2676:1163), plus the
// "You call us" code on its card (2672:2064). Drives the real modal in headless Chrome with
// touch taps and real key events against a fake Bolt API, and checks:
//   - copy: each phone node's words; desktop keeps its own (unchanged);
//   - the form: required phone + business name, optional email (blank is fine, a typed one
//     must be valid), Continue grey until a whole phone and a business name, the incomplete
//     state's message and flagged fields, values kept, focus on the first field to fix;
//   - nothing is sent for an invalid form; one tap (or a double tap) sends one code, one
//     verify, one call;
//   - phones: Enter/Done closes the keyboard and sends nothing; the focused field and its
//     message are scrolled into the visible area; desktop keeps Enter = Continue;
//   - Calling: the caller id the API returns, and the business the call answers as;
//   - success: the call's own transcript, counted once; the green CTA and its event;
//   - failure: iPhone / Android help articles (the support center's, never swapped), each
//     tap counted by platform; Continue places the call again;
//   - "You call us": the card shows THIS session's code, the same after the page is hidden
//     and shown again, with no second code fetched.
// Run: node tools/demo-mobile-check.mjs [siteRoot]
//      NC=loose_gate | NC=enter_submits | NC=no_keepvisible | NC=double_send | NC=bolt_services |
//      NC=swap_help | NC=no_help_event — negative controls on the SERVED copy only; each must FAIL.
// Nothing leaves the machine: Chrome resolves no host but 127.0.0.1, and every other request
// (Bolt's API, Meta, Google) is answered here.
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

const cut = (s, from, to) => { if (!s.includes(from)) throw new Error(`NC anchor missing: ${from}`); return s.split(from).join(to); };
const MUTATE = {
  // Continue turns blue on anything typed again (the rule before AFMBP-2150).
  loose_gate: ['demo-format.js', (s) => cut(s, "return validPhone(str(v.phone)) && str(v.business).trim() !== '';", "return str(v.phone).trim() !== '' && str(v.business).trim() !== '';")],
  // Enter in a field sends the form on a phone too.
  enter_submits: ['demo.js', (s) => cut(s, 'if (isMobile()) f.input.blur(); else btn.click();', 'btn.click();')],
  // The focused field is left wherever it is.
  no_keepvisible: ['demo.js', (s) => cut(s, '      if (hi + pad > bottom) backdrop.scrollTop', '      if (false) backdrop.scrollTop')],
  // A second tap on Continue before the first answers sends a second code.
  double_send: ['demo.js', (s) => cut(s, "      busy(btn, 'Sending…');\n      // has_email", "      // has_email")],
  // The Calling card names Bolt Services, not the business the call answers as.
  bolt_services: ['demo.js', (s) => cut(s, "expectRows(state.business || 'your business')", "expectRows('Bolt Services')")],
  // The iPhone and Android articles trade places.
  swap_help: ['demo.js', (s) => cut(cut(cut(s, "osLink('/support/hca/disable-ios-spam-blockers'", 'TMP_IOS'), "osLink('/support/hca/disable-android-spam-blockers'", "osLink('/support/hca/disable-ios-spam-blockers'"), 'TMP_IOS', "osLink('/support/hca/disable-android-spam-blockers'")],
  // A help-article tap is not counted.
  no_help_event: ['demo.js', (s) => cut(s, "a.addEventListener('click', function () { track('demo_help_clicked', { os: os }); });", '')],
};
if (NC && !MUTATE[NC]) throw new Error(`unknown NC "${NC}"; one of ${Object.keys(MUTATE).join(', ')}`);

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

// ---- the fake Bolt API ----
const TRANSCRIPT = [
  { role: 'assistant', content: 'Hi, you’ve reached QA Test Co. How can I help?' },
  { role: 'user', content: 'My AC stopped blowing cold air.' },
  { role: 'assistant', content: 'Sorry to hear that. Let’s get someone out to you.' },
];
const api = {};
// sendDelayMs holds the code-send answer, so a second tap lands while the first is in flight.
const reset = () => Object.assign(api, { calls: [], events: [], sessions: 0, recap: { status: 'in_call', transcript: null }, callerId: '+14155550123', inState: 'waiting', inCallId: null, sendDelayMs: 0 });
reset();
function apiRespond(method, url, postData) {
  const p = new URL(url).pathname;
  let body = null; try { body = JSON.parse(postData || 'null'); } catch {}
  if (p === '/api/public/analytics/events') {
    for (const e of (body && body.events) || []) api.events.push({ type: e.event_type, data: e.event_data || {} });
    return [200, { ok: true }];
  }
  api.calls.push({ method, p, body });
  if (method === 'POST' && p === '/api/demo/inbound/session') {
    const n = ++api.sessions;
    return [200, { sessionId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, code: String(4320 + n), number: '+18554973151', numberDisplay: '(855) 497-3151', telUri: `tel:+18554973151,,${4320 + n}`, expiresAt: new Date(Date.now() + 600000).toISOString() }];
  }
  if (/^\/api\/demo\/inbound\/session\//.test(p)) return [200, { state: api.inState, callId: api.inCallId }];
  if (p === '/api/demo/otp/send' || p === '/api/demo/otp/verify') return [200, { ok: true }];
  if (p === '/api/demo/token') return [200, { token: 'qa-token' }];
  if (p === '/api/demo/call') return [200, { callId: 'out-1', callerId: api.callerId }];
  if (/^\/api\/demo\/recap\//.test(p)) return [200, api.recap];
  return [200, {}];
}
const sent = (p) => api.calls.filter((c) => c.p === p);
const evs = (type, pred = () => true) => api.events.filter((e) => e.type === type && pred(e.data));
const CONSENT = 'By providing your phone number and/or email address and tapping “Continue”, you agree to (1) receive text messages and emails from Bolt Answering for (a) security verification and (b) marketing purposes, and (2) automated phone calls from Bolt Answering’s virtual assistant at the number provided. Message frequency may vary. Standard Message, Voice, and Data Rates may apply. Reply STOP to opt out. Reply HELP for help. In accordance with our Privacy Policy, we will not share mobile information with third parties for promotional or marketing purposes.';

const PROFILE = mkdtempSync(join(tmpdir(), 'cdp-2150-'));
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
  const CORS = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: '*' }];
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); return; }
    if (msg.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = msg.params;
    const quiet = (p) => p.catch(() => {});
    if (new URL(request.url).hostname === '127.0.0.1') return quiet(send('Fetch.continueRequest', { requestId }));
    if (request.method === 'OPTIONS') return quiet(send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: CORS }));
    const bolt = /bolt-staging\.fly\.dev$/.test(new URL(request.url).hostname);
    const [code, body] = bolt ? apiRespond(request.method, request.url, request.postData) : [200, {}];
    const answer = () => quiet(send('Fetch.fulfillRequest', { requestId, responseCode: code, responseHeaders: [...CORS, { name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') }));
    return bolt && api.sendDelayMs && new URL(request.url).pathname === '/api/demo/otp/send' ? setTimeout(answer, api.sendDelayMs) : answer();
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  // QA visit (no Meta / Google), a controllable visibility state, and links held in place:
  // a tel: link or a new-tab help article is recorded, then not followed.
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: "try{localStorage.setItem('bolt_qa','1')}catch(e){}" +
      "Object.defineProperty(document,'visibilityState',{configurable:true,get:function(){return window.__vis||'visible'}});" +
      "Object.defineProperty(document,'hidden',{configurable:true,get:function(){return (window.__vis||'visible')==='hidden'}});" +
      "window.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a');if(!a)return;window.__clicks=(window.__clicks||[]).concat([{href:a.getAttribute('href'),target:a.getAttribute('target')}]);if(/^tel:/.test(a.getAttribute('href')||'')||a.getAttribute('target')==='_blank'||/signup/.test(a.getAttribute('href')||''))e.preventDefault();});",
  });
  const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : null; };
  const load = async (path) => {
    await ev('try{sessionStorage.clear()}catch(e){}');
    await ev('window.__old = 1');
    await send('Page.navigate', { url: ORIGIN + path });
    for (let i = 0; i < 100; i++) { if ((await ev(`!window.__old && document.readyState === 'complete' && location.pathname + location.search === ${JSON.stringify(path)}`)) === true) break; await sleep(100); }
    await ev('document.fonts && document.fonts.ready.then(function(){return 1})');
    await sleep(700);
  };
  const screen = () => ev("(document.querySelector('.demo-backdrop.open')||{getAttribute:function(){return null}}).getAttribute('data-screen')");
  const waitScreen = async (want, ms = 6000) => { for (let i = 0; i < ms / 100; i++) { if ((await screen()) === want) return true; await sleep(100); } return false; };
  const box = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; var r=e.getBoundingClientRect(); return {x:r.left,y:r.top,w:r.width,h:r.height,cx:r.left+r.width/2,cy:r.top+r.height/2};})()`);
  const visible = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; var s=getComputedStyle(e); var r=e.getBoundingClientRect(); return s.display!=='none' && s.visibility!=='hidden' && r.width>0 && r.height>0;})()`);
  const text = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); return e ? e.innerText.replace(/\\s+/g,' ').trim() : null;})()`);
  const css = (sel, prop) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); return e ? getComputedStyle(e)[${JSON.stringify(prop)}] : null;})()`);
  const attr = (sel, a) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); return e ? e.getAttribute(${JSON.stringify(a)}) : null;})()`);
  const val = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)})||{}).value`);
  let touch = false;
  const tap = async (sel, wait = 300) => {
    const b = await box(sel);
    if (!b) return false;
    if (touch) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.cx, y: b.cy }] });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: b.cx, y: b.cy, button: 'left', clickCount: 1 });
    }
    await sleep(wait);
    return true;
  };
  // Type into a field the way a person does: focus it, then insert the text (input events).
  const type = async (sel, s) => { await ev(`document.querySelector(${JSON.stringify(sel)}).focus(); 1`); await send('Input.insertText', { text: s }); await sleep(80); };
  const clear = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); e.value=''; e.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`);
  const enter = async () => {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'char', text: '\r', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(300);
  };
  const active = () => ev("(document.activeElement && document.activeElement.id) || (document.activeElement && document.activeElement.tagName)");
  const phone = async (h = 753) => {
    touch = true;
    await send('Emulation.setDeviceMetricsOverride', { width: 402, height: h, deviceScaleFactor: 3, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  };
  const desktop = async () => {
    touch = false;
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  };
  const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;
  const cardRel = async (sel) => { const c = await box('.demo-backdrop.open .demo-card'), b = await box(sel); return b && { x: b.x - c.x, y: b.y - c.y, w: b.w, h: b.h }; };
  const flagged = () => ev("['demo-phone','demo-business','demo-email'].filter(function(id){var e=document.getElementById(id); return e.classList.contains('err') && e.getAttribute('aria-invalid')==='true' && e.getAttribute('aria-describedby')==='demo-formerr';})");
  const greyBtn = async () => (await attr('.demo-backdrop.open .demo-btn', 'aria-disabled')) === 'true' && (await ev("document.querySelector('.demo-backdrop.open .demo-btn').classList.contains('demo-btn--off')"));

  // ================= the form, empty (2657:1639) =================
  await phone();
  console.log('[phone] "We call you" form: copy, fields, geometry, grey Continue');
  reset();
  await load('/hvac.html?talk=form');
  ok(await waitScreen('phone'), 'form: ?talk=form opens the form');
  ok((await text('.demo-h--form')) === 'We’ll call you now', `form: heading (${await text('.demo-h--form')})`);
  ok((await text('.demo-sub')) === 'First, we’ll send a code', `form: sub (${await text('.demo-sub')})`);
  ok((await text('.demo-field--phone .demo-label')) === 'What’s your phone number?' && (await text('.demo-field--business .demo-label')) === 'What’s your business name?' && (await text('.demo-field--email .demo-label')) === 'What’s your email? (Optional)', 'form: the node\'s labels, "(Optional)" in regular weight');
  ok((await css('.demo-field--email .demo-label__opt', 'fontWeight')) === '400' && (await css('.demo-field--email .demo-label', 'fontWeight')) === '700', 'form: label bold, "(Optional)" regular');
  ok((await attr('#demo-phone', 'placeholder')) === '(555) 555-1212' && (await attr('#demo-business', 'placeholder')) === 'Business name' && (await attr('#demo-email', 'placeholder')) === 'yourname@example.com', 'form: placeholders');
  ok((await text('.demo-disclosure')) === CONSENT, 'form: the consent text is exactly the one the server hashes (unchanged)');
  ok((await attr('#demo-phone', 'type')) === 'tel' && (await attr('#demo-phone', 'inputmode')) === 'tel' && (await attr('#demo-phone', 'autocomplete')) === 'tel', 'form: phone opens the phone keypad, autofills a phone');
  ok((await attr('#demo-email', 'type')) === 'email' && (await attr('#demo-email', 'autocomplete')) === 'email' && (await attr('#demo-business', 'autocomplete')) === 'organization', 'form: email / business autofill');
  ok(['#demo-phone', '#demo-business', '#demo-email'].every(Boolean) && (await ev("['demo-phone','demo-business','demo-email'].every(function(id){return document.getElementById(id).getAttribute('enterkeyhint')==='done'})")), 'form: the keyboard key reads "done" on a phone');
  ok((await ev("document.getElementById('demo-phone').required && document.getElementById('demo-business').required && !document.getElementById('demo-email').required && document.getElementById('demo-email').getAttribute('aria-required')===null")), 'form: phone and business name required, email optional');
  ok((await ev("['demo-phone','demo-business','demo-email'].every(function(id){var e=document.getElementById(id), l=document.querySelector('label[for='+id+']'); return !!l && e.labels && e.labels[0]===l;})")), 'a11y: each field has its label');
  ok((await css('#demo-phone', 'fontSize')) === '21px' && (await css('.demo-field--phone .demo-label', 'fontSize')) === '15px' && (await css('.demo-backdrop.open .demo-btn', 'fontSize')) === '22px' && (await css('.demo-sub', 'fontSize')) === '20px', 'form: the redrawn sizes (21px fields, 15px labels, 22px Continue, 20px sub; no zoom on focus)');
  const fc = await box('.demo-backdrop.open .demo-card');
  ok(near(fc.w, 337) && near(fc.h, 629) && near(fc.y, 69), `form: card 337x629 where the node puts it (${fc.w}x${fc.h} at ${fc.y})`);
  for (const [sel, x, y, w, h] of [['#demo-phone', 29, 135, 285.2, 36], ['#demo-business', 29, 206, 285.2, 35], ['#demo-email', 29, 283, 285.2, 38], ['.demo-backdrop.open .demo-btn', 45, 349, 253, 49]]) {
    const b = await cardRel(sel);
    ok(b && near(b.x, x) && near(b.y, y) && near(b.w, w) && near(b.h, h), `form: ${sel} where it matches the node (${JSON.stringify(b)})`);
  }
  ok(await greyBtn(), 'form: Continue starts grey (aria-disabled, never disabled)');
  ok((await css('.demo-backdrop.open .demo-btn', 'backgroundColor')) === 'rgb(184, 182, 185)', `form: grey is the node's #b8b6b9 (${await css('.demo-backdrop.open .demo-btn', 'backgroundColor')})`);
  ok(!(await ev("document.querySelector('.demo-backdrop.open .demo-btn').disabled")), 'form: the grey Continue still takes a tap');

  console.log('[phone] Continue turns blue on a whole phone + a business name only');
  await type('#demo-phone', '415555123');
  await type('#demo-business', 'QA Test Co');
  ok((await val('#demo-phone')) === '(415) 555-123' && (await greyBtn()), `gate: 9 digits keep Continue grey (${await val('#demo-phone')})`);
  await type('#demo-phone', '4');
  ok((await val('#demo-phone')) === '(415) 555-1234' && !(await greyBtn()), 'gate: the 10th digit turns it blue');
  await sleep(250);   // Continue fades between grey and blue (.15s)
  ok((await css('.demo-backdrop.open .demo-btn', 'backgroundColor')) === 'rgb(43, 127, 253)', 'gate: blue is the node\'s #2b7ffd (2670:1317)');
  await clear('#demo-business'); await type('#demo-business', '   ');
  ok(await greyBtn(), 'gate: a business name of spaces only keeps it grey');
  ok(sent('/api/demo/otp/send').length === 0, 'gate: nothing sent while typing');

  // ================= incomplete (2676:1272) =================
  console.log('[phone] incomplete: the message, flagged fields, nothing sent');
  reset();
  await load('/hvac.html?talk=form');
  await waitScreen('phone');
  await ev('document.activeElement && document.activeElement.blur(); 1');
  await tap('.demo-backdrop.open .demo-btn');
  ok((await text('#demo-formerr')) === 'Please complete the form to continue.' && (await visible('#demo-formerr')), `incomplete: the node's message (${await text('#demo-formerr')})`);
  ok(JSON.stringify(await flagged()) === '["demo-phone","demo-business"]', `incomplete: phone and business name flagged, email not (${JSON.stringify(await flagged())})`);
  ok((await css('#demo-phone', 'backgroundColor')) === 'rgb(250, 221, 221)' && (await css('#demo-email', 'backgroundColor')) === 'rgb(255, 255, 255)', 'incomplete: flagged fields pink (#fadddd), the rest white');
  ok((await css('#demo-formerr', 'color')) === 'rgb(255, 0, 0)' && (await css('#demo-formerr', 'fontSize')) === '10px', 'incomplete: the message red, 10px');
  const eb = await cardRel('#demo-formerr');
  ok(eb && near(eb.x, 45) && near(eb.y + eb.h / 2, 338.4 + 0.6 - 0.67, 0.05), `incomplete: the message between the email field and Continue, where 2676:1272 puts it (${JSON.stringify(eb)})`);
  ok((await attr('#demo-formerr', 'role')) === 'alert', 'a11y: the message is announced');
  ok((await active()) === 'demo-phone', `incomplete: focus goes to the first field to fix (${await active()})`);
  ok(sent('/api/demo/otp/send').length === 0, 'incomplete: no code sent, no call');
  await type('#demo-business', 'QA Test Co');
  ok(JSON.stringify(await flagged()) === '["demo-phone"]', 'incomplete: typing in a flagged field clears its flag');
  await ev('document.activeElement && document.activeElement.blur(); 1');
  await tap('.demo-backdrop.open .demo-btn');
  ok((await val('#demo-business')) === 'QA Test Co' && JSON.stringify(await flagged()) === '["demo-phone"]', 'incomplete: values are kept, only the empty phone flagged');
  console.log('[phone] optional email: blank is fine, a typed one must be real');
  await type('#demo-phone', '4155551234');
  await type('#demo-email', 'james');
  await ev('document.activeElement && document.activeElement.blur(); 1');
  await tap('.demo-backdrop.open .demo-btn');
  ok((await text('#demo-formerr')) === 'Invalid email address. Please try again.' && JSON.stringify(await flagged()) === '["demo-email"]', `email: a malformed address is flagged (${await text('#demo-formerr')})`);
  ok(sent('/api/demo/otp/send').length === 0, 'email: nothing sent for it');
  await clear('#demo-business'); await type('#demo-business', '   ');
  await ev('document.activeElement && document.activeElement.blur(); 1');
  await tap('.demo-backdrop.open .demo-btn');
  ok((await text('#demo-formerr')) === 'Please complete the form to continue.' && (await flagged()).includes('demo-business'), 'business: spaces only is incomplete');

  // ================= Enter / Done on a phone =================
  console.log('[phone] Enter/Done closes the keyboard and sends nothing');
  reset();
  await load('/hvac.html?talk=form');
  await waitScreen('phone');
  await type('#demo-business', 'QA Test Co');
  await type('#demo-phone', '4155551234');
  for (const id of ['demo-phone', 'demo-business', 'demo-email']) {
    await ev(`document.getElementById('${id}').focus(); 1`);
    await enter();
    ok((await active()) !== id, `enter: ${id} lets go of focus (the keyboard closes) (${await active()})`);
  }
  ok(sent('/api/demo/otp/send').length === 0 && (await screen()) === 'phone', `enter: nothing sent, still the form (${sent('/api/demo/otp/send').length})`);

  // ================= the focused field above the keyboard =================
  console.log('[phone] the focused field and its message are scrolled into the visible area');
  await phone(320);   // the area left above an open keyboard
  reset();
  await load('/hvac.html?talk=form');
  await waitScreen('phone');
  await ev('document.querySelector(".demo-backdrop").scrollTop = 0; document.activeElement && document.activeElement.blur(); 1');
  // iOS Safari never scrolls the overlay for a field: focus without the browser's own scroll,
  // then let the visible area change, as the keyboard does.
  await ev("document.getElementById('demo-email').focus({preventScroll:true}); window.visualViewport.dispatchEvent(new Event('resize')); 1");
  await sleep(450);
  const em = await box('#demo-email'), vh = await ev('window.visualViewport.height');
  ok(em && em.y >= 0 && em.y + em.h <= vh, `keep visible: the email field is in the visible area (${em && [em.y.toFixed(1), (em.y + em.h).toFixed(1)]} of ${vh})`);
  await ev('document.querySelector(".demo-backdrop").scrollTop = 0; document.activeElement && document.activeElement.blur(); 1');
  await tap('.demo-backdrop.open .demo-btn');   // incomplete: focus goes to the phone field
  await ev("document.querySelector('.demo-backdrop').scrollTop = 0; document.getElementById('demo-business').focus({preventScroll:true}); window.visualViewport.dispatchEvent(new Event('resize')); 1");
  await sleep(450);
  const bz = await box('#demo-business'), msg = await box('#demo-formerr');
  ok(bz && msg && bz.y >= 0 && msg.y + msg.h <= vh, `keep visible: the field and the message tied to it both shown (${bz && msg && [bz.y.toFixed(1), (msg.y + msg.h).toFixed(1)]} of ${vh})`);
  await phone();

  // ================= one tap, one code, one call; Calling (2442:1191) =================
  console.log('[phone] a double tap sends one code; one verify, one call; the Calling card');
  reset();
  await load('/hvac.html?talk=form');
  await waitScreen('phone');
  await type('#demo-phone', '4155551234');
  await type('#demo-business', 'QA Test Co');
  await ev('document.activeElement && document.activeElement.blur(); 1');
  api.sendDelayMs = 800;
  await tap('.demo-backdrop.open .demo-btn', 120);
  await tap('.demo-backdrop.open .demo-btn', 1200);
  api.sendDelayMs = 0;
  ok(sent('/api/demo/otp/send').length === 1, `send: a second tap while the first is on its way sends nothing (${sent('/api/demo/otp/send').length})`);
  ok((sent('/api/demo/otp/send')[0] || {}).body && sent('/api/demo/otp/send')[0].body.consentText === CONSENT && sent('/api/demo/otp/send')[0].body.phone === '+14155551234' && !('email' in sent('/api/demo/otp/send')[0].body), 'send: E.164 phone, the rendered consent text, no email key when none was given');
  ok(evs('demo_details_submitted', (d) => d.has_email === false).length === 1, 'events: demo_details_submitted once, has_email false');
  let codeUp = false;
  for (let i = 0; i < 40 && !codeUp; i++) { codeUp = (await ev("!!document.querySelector('.demo-backdrop.open .demo-code input')")) === true; if (!codeUp) await sleep(100); }
  ok(codeUp, 'send: the code screen follows the one send');
  await ev("document.querySelectorAll('.demo-code input')[0].focus(); 1");
  await send('Input.insertText', { text: '123456' });
  ok(await waitScreen('calling', 6000), 'call: code accepted -> the Calling card');
  await sleep(800);
  ok(sent('/api/demo/otp/verify').length === 1 && sent('/api/demo/token').length === 1 && sent('/api/demo/call').length === 1, `call: one verify, one token, one call (${['/api/demo/otp/verify', '/api/demo/token', '/api/demo/call'].map((p) => sent(p).length)})`);
  ok((await text('.demo-callcard__title')) === 'ALL Set' && (await css('.demo-callcard__title', 'textTransform')) === 'none', `calling: "ALL Set" as the node sets it (${await text('.demo-callcard__title')})`);
  ok((await text('.demo-callcard__from')) === 'Calling from (415) 555-0123', `calling: the caller id the API returned (${await text('.demo-callcard__from')})`);
  ok(JSON.stringify(await ev("[].slice.call(document.querySelectorAll('.demo-xm__row')).map(function(e){return e.innerText})")) === JSON.stringify(['Receptionist for QA Test Co', 'She’ll ask about your issue or project', 'Share fake details for her to schedule']), `calling: the rows, naming the business typed on the form (${await text('.demo-xm')})`);
  ok((await ev("['chat','ask','route'].every(function(k){return new RegExp('demo-m-ico-'+k+'\\\\.svg').test(getComputedStyle(document.querySelector('.demo-xm__row--'+k),'::before').backgroundImage)})")) === true, 'calling: each row\'s node icon');
  ok(!(await visible('.demo-callcard__list')) && (await css('.demo-xm', 'fontSize')) === '21px', 'calling: the phone rows at 21px, not the desktop list');
  const cc = await box('.demo-backdrop.open .demo-card');
  ok(near(cc.w, 331) && near(cc.h, 414), `calling: card 331x414 (${cc.w}x${cc.h})`);
  ok(evs('demo_call_placed', (d) => d.call_id === 'out-1').length === 1, 'events: demo_call_placed once');

  // ================= shared success (2441:811) =================
  console.log('[phone] success: the call\'s transcript, counted once; the green CTA');
  api.recap = { status: 'completed', transcript: TRANSCRIPT };
  ok(await waitScreen('recap', 8000), 'success: the completed call -> the success card');
  await sleep(3500);   // a few more status answers arrive: still counted once
  ok((await text('.demo-success-title')) === 'NEVER miss a job again', 'success: title');
  ok((await text('.demo-success-sub')) === "Don't waste money on receptionists or lose leads to voicemail. Bolt qualifies leads and books jobs for under $3/day.", `success: the node's pitch (${await text('.demo-success-sub')})`);
  ok((await text('.demo-success-tlabel')) === 'Here’s the transcript:', 'success: "Here’s the transcript:"');
  ok(JSON.stringify(await ev("[].slice.call(document.querySelectorAll('.demo-chat .demo-bubble')).map(function(e){return e.innerText})")) === JSON.stringify(TRANSCRIPT.map((t) => t.content)), 'success: the call\'s own transcript, not the node\'s sample');
  ok((await text('.demo-success-cta')) === 'Start free 30-day trial' && (await css('.demo-success-cta', 'backgroundColor')) === 'rgb(0, 154, 21)' && (await attr('.demo-success-cta', 'href')) === 'https://app.boltanswering.com/signup', 'success: the green "Start free 30-day trial" to sign-up');
  ok(!(await visible('.demo-success-trial')), 'success: no desktop "First 30 days" line');
  ok(evs('demo_transcript_shown', (d) => d.call_id === 'out-1').length === 1 && evs('demo_call_finished').length === 1, `events: demo_transcript_shown and demo_call_finished once each (${evs('demo_transcript_shown').length}, ${evs('demo_call_finished').length})`);
  await tap('.demo-success-cta');
  ok(evs('demo_trial_clicked', (d) => d.from === 'recap' && d.call_id === 'out-1').length === 1, 'events: the CTA tap counted once, from the recap');
  const sc = await box('.demo-backdrop.open .demo-card');
  ok(near(sc.w, 332) && near(sc.h, 702), `success: card 332x702 (${sc.w}x${sc.h})`);

  // ================= failure + help (2676:1163) =================
  console.log('[phone] failure: help articles, never swapped, each tap counted; Continue calls again');
  reset();
  await load('/hvac.html?talk=form');
  await waitScreen('phone');
  await type('#demo-phone', '4155551234');
  await type('#demo-business', 'QA Test Co');
  await ev('document.activeElement && document.activeElement.blur(); 1');
  await tap('.demo-backdrop.open .demo-btn', 600);
  await ev("document.querySelectorAll('.demo-code input')[0].focus(); 1");
  await send('Input.insertText', { text: '123456' });
  await waitScreen('calling', 6000);
  api.recap = { status: 'failed' };
  ok(await waitScreen('fail', 8000), 'failure: a failed call -> the failure card');
  ok((await text('.demo-failcard__title2')) === 'Sorry... that didn’t work' && (await text('.demo-failcard__body2')) === 'Sometimes Bolt calls get spam blocked. Here’s how to temporarily turn off spam blockers before you try again:', `failure: the node's copy (${await text('.demo-failcard__body2')})`);
  const links = await ev("[].slice.call(document.querySelectorAll('.demo-failcard__link')).map(function(a){return {href:a.getAttribute('href'),text:a.innerText.trim(),target:a.target,rel:a.rel,label:a.getAttribute('aria-label'),logo:(a.querySelector('img')||{}).getAttribute&&a.querySelector('img').getAttribute('src')}})");
  ok(links.length === 2 && links[0].href === '/support/hca/disable-ios-spam-blockers' && links[0].text === 'iPhones' && /iphone/.test(links[0].logo), `help: "iPhones" -> the iPhone article, with the Apple lockup (${JSON.stringify(links[0])})`);
  ok(links.length === 2 && links[1].href === '/support/hca/disable-android-spam-blockers' && links[1].text === 'Androids' && /android/.test(links[1].logo), `help: "Androids" -> the Android article, with the Android lockup (${JSON.stringify(links[1])})`);
  ok(links.every((l) => l.target === '_blank' && /noopener/.test(l.rel) && l.label && l.label.indexOf(l.text) === 0 && /spam blockers/.test(l.label)), 'help: new tab, noopener, a descriptive name that starts with the visible words');
  ok((await ev("[].slice.call(document.querySelectorAll('.demo-failcard__os')).every(function(i){return i.alt==='' && i.getAttribute('aria-hidden')==='true'})")), 'a11y: the lockups are decoration');
  await tap('.demo-failcard__link:nth-child(1)');
  await tap('.demo-failcard__link:nth-child(2)');
  ok(evs('demo_help_clicked', (d) => d.os === 'ios').length === 1 && evs('demo_help_clicked', (d) => d.os === 'android').length === 1, `events: each help tap counted once, by platform (${JSON.stringify(evs('demo_help_clicked').map((e) => e.data.os))})`);
  ok(evs('demo_help_clicked').every((e) => Object.keys(e.data).filter((k) => !['os', 'trade', 'qa', 'attr', 'page', 'automated'].includes(k)).length === 0), 'events: the help event carries the platform only (no phone, email or business)');
  ok((await text('.demo-failcard__btn')) === 'Continue', 'failure: "Continue"');
  const before = sent('/api/demo/call').length;
  api.recap = { status: 'in_call', transcript: null };
  await tap('.demo-failcard__btn');
  ok(await waitScreen('calling', 6000), 'failure: Continue places the call again -> Calling');
  await sleep(500);
  ok(sent('/api/demo/call').length === before + 1, `failure: exactly one more call (${sent('/api/demo/call').length - before})`);

  // ================= "You call us": the code stays this session's =================
  console.log('[phone] "You call us": this session\'s code, stable when the page comes back');
  reset();
  await load('/hvac.html?talk=1');
  ok(await waitScreen('choice'), 'inbound: choice');
  await sleep(300);
  ok(api.sessions === 1, `inbound: one code fetched (${api.sessions})`);
  await tap('.demo-choice__call');
  ok(await waitScreen('inbound-call'), 'inbound: the call card');
  ok((await text('.demo-incall__digits')) === '4321', `inbound: the card shows this session's code (${await text('.demo-incall__digits')})`);
  ok((await css('.demo-incall__digits', 'fontSize')) === '25px' && (await css('.demo-incall__label', 'fontFamily')).includes('Permanent Marker'), 'inbound: "Your code" in the marker, the code at 25px');
  ok(JSON.stringify(await ev("[].slice.call(document.querySelectorAll('.demo-xm__row')).map(function(e){return e.innerText})")) === JSON.stringify(['Receptionist for Bolt Services', 'She’ll ask about your issue or project', 'Share fake details for her to schedule']), 'inbound: the rows name Bolt Services (the line answers as it)');
  await ev("window.__vis='hidden'; document.dispatchEvent(new Event('visibilitychange')); 1");
  await sleep(300);
  await ev("window.__vis='visible'; document.dispatchEvent(new Event('visibilitychange')); 1");
  await sleep(800);
  ok((await text('.demo-incall__digits')) === '4321' && api.sessions === 1, `inbound: the same code after the page comes back, no second code (${await text('.demo-incall__digits')}, ${api.sessions})`);
  api.inState = 'connected'; api.inCallId = 'in-1'; api.recap = { status: 'completed', transcript: TRANSCRIPT };
  ok(await waitScreen('recap', 8000), 'inbound: the linked call ends on the same success card');
  ok((await text('.demo-success-title')) === 'NEVER miss a job again' && (await text('.demo-success-cta')) === 'Start free 30-day trial', 'inbound: one shared success (same card, same copy)');
  await sleep(3500);
  ok(evs('demo_transcript_shown', (d) => d.call_id === 'in-1' && d.mode === 'inbound').length === 1, 'events: inbound success counted once, mode inbound');

  // ================= desktop: unchanged =================
  console.log('[desktop] the form, Calling, success and failure keep their own copy; Enter = Continue');
  await desktop();
  reset();
  await load('/hvac.html?talk=form');
  ok(await waitScreen('phone'), 'desktop: the form');
  ok((await text('.demo-h--form')) === 'We’ll call you right now' && (await text('.demo-sub')) === 'Get a one-time passcode', `desktop: its own heading and sub (${await text('.demo-h--form')} / ${await text('.demo-sub')})`);
  ok((await text('.demo-field--business .demo-label')) === 'What’s your business called?' && (await text('.demo-field--email .demo-label')) === 'What’s your email? (optional)', 'desktop: its own labels');
  ok((await attr('#demo-phone', 'enterkeyhint')) === null, 'desktop: no "done" key hint');
  await type('#demo-phone', '4155551234');
  await type('#demo-business', 'QA Test Co');
  await ev("document.getElementById('demo-phone').focus(); 1");
  await enter();
  await sleep(500);
  ok(sent('/api/demo/otp/send').length === 1, `desktop: Enter in a field = Continue (${sent('/api/demo/otp/send').length})`);
  await ev("document.querySelectorAll('.demo-code input')[0].focus(); 1");
  await send('Input.insertText', { text: '123456' });
  ok(await waitScreen('calling', 6000), 'desktop: Calling');
  ok((await text('.demo-callcard__title')) === 'ALL SET!' && (await text('.demo-callcard__from')) === 'Calling you now from (415) 555-0123', `desktop: its own Calling copy (${await text('.demo-callcard__title')} / ${await text('.demo-callcard__from')})`);
  ok((await visible('.demo-callcard__list')) && !(await visible('.demo-xm')), 'desktop: its numbered list, not the phone rows');
  api.recap = { status: 'failed' };
  ok(await waitScreen('fail', 8000), 'desktop: failure card');
  ok((await text('.demo-failcard__btn')) === 'Try again' && /Follow these instructions/.test(await text('.demo-failcard__body')) && !(await visible('.demo-failcard__body2')), 'desktop: its own failure copy and "Try again"');

  console.log(bad ? `\n${bad} FAILED, ${good} passed${NC ? ` (negative control: ${NC})` : ''}` : `\nALL PASS (${good} checks)${NC ? ` — negative control ${NC} did NOT bite` : ''}`);
  ws.close();
} finally {
  chrome.kill('SIGKILL'); srv.close();
  await sleep(300); rmSync(PROFILE, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
