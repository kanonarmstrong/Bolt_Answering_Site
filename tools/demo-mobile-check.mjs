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
// AFMBP-2596 (the owner's 11-12 update; nodes 2657:1639 empty, 2891:986 filled, 2894:1135 /
// 2894:1108 errors, 2670:1394 code, 2891:1072 Calling, 2441:811 success, 2676:1163 failure):
// a phone asks for the number only ("Phone number", the node's consent without email or
// marketing; the call answers as Bolt Services, which the server needs), errors show under the
// field with the field outlined in red, the code card is "Enter the code" + boxes + Back, the
// Calling card is one line and the help line, the success card opens on the pitch with a blue
// "Start free 30-day trial", the failure card reads "OOPs!". A computer keeps its three fields,
// its consent and its rules (checked in the desktop section).
// AFMBP-2597 (the owner's 11-13 update): every phone card draws the close button (the node's
// cross 304px in and 17px down, the code card's 319px, in a 44px tap target on top) and a tap
// on it closes the demo; every button is Inter Bold with the nodes' shadow; the help line is
// Inter 14; the success card opens on black "NEVER" in the marker with the node's yellow brush
// and "miss a job again", then "For less than $4 per day, …" in grey 16px; the "You call us"
// card is 2891:1090: "Here’s how to call your assistant:" and two numbered steps (the number a
// tap-to-dial link with this session's code, then the code), the help line, no rows or brush.
// Run: node tools/demo-mobile-check.mjs [siteRoot]
//      NC=loose_gate | NC=enter_submits | NC=no_keepvisible | NC=double_send | NC=phone_business |
//      NC=old_consent | NC=old_form_fields | NC=old_calling | NC=old_err_look |
//      NC=swap_help | NC=no_help_event | NC=old_inbound | NC=old_sub_size | NC=old_sub_color |
//      NC=old_dy | NC=old_recap_label | NC=recap_tall | NC=old_field_size | NC=old_desk_field_size |
//      NC=no_zoom_floor | NC=no_x | NC=code_x_off | NC=x_dead | NC=regular_btns | NC=flat_cta |
//      NC=old_success_pitch | NC=no_never | NC=big_help | NC=no_tel — negative controls on the
//      SERVED copy only; each must FAIL.
// AFMBP-2576 (owner, 2026-11-12): the text in the form's three fields is 20% smaller: 16.8px on
// a phone (the node's 21px), 17.6px on a computer (22px), placeholders with it; where the phone
// card is scaled down (under 337px) the size on screen never drops under 16px.
// AFMBP-2274 (the nodes as updated 2026-10-16): the calling cards' rows read "Talk to the “…”
// receptionist" / "Tell her about your issue or project", the form's sub is #707070 at 18px,
// and the "You call us" card sits centred (.5px low) as 2672:2064 now puts it.
// Nothing leaves the machine: Chrome resolves no host but 127.0.0.1, and every other request
// (Bolt's API, Meta, Google) is answered here.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';

// Absolute, so a served file's path ends in '/<file>' and a negative control applies even when
// the root is given as '.' (a relative root left every NC unapplied: a false "did NOT bite").
const ROOT = resolve(process.argv[2] ?? new URL('..', import.meta.url).pathname);
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
  // AFMBP-2596: a phone sends the (empty) business field, which the server refuses.
  phone_business: ['demo.js', (s) => cut(s, 'state.business = onPhone ? PHONE_BUSINESS : state.bizTyped;', 'state.business = state.bizTyped;')],
  // AFMBP-2596: a phone sends the computer's consent, not the one it showed.
  old_consent: ['demo.js', (s) => cut(s, 'state.consent = onPhone ? CONSENT_M_TEXT : CONSENT_TEXT;', 'state.consent = CONSENT_TEXT;')],
  // AFMBP-2596: the phone form shows the business and email fields again.
  old_form_fields: ['demo.js', (s) => cut(s, "    biz.wrap.classList.add('demo-db');\n    email.wrap.classList.add('demo-db');\n", '')],
  // AFMBP-2596: the phone Calling card shows its old title and line again.
  old_calling: ['demo.js', (s) => cut(s, "h('p', { class: 'demo-callcard__head demo-db' },", "h('p', { class: 'demo-callcard__head' },")],
  // AFMBP-2596: a field to fix back to the old pink, with no red outline.
  old_err_look: ['demo.css', (s) => cut(s, 'background:#ffefef;color:var(--navy);box-shadow:0 0 0 1.6px #f00', 'background:#fadddd;color:var(--navy)')],
  // AFMBP-2274: the rows before the nodes' 10-16 update.
  old_inbound: ['demo.js', (s) => cut(s, "h('div', { class: 'demo-ihow demo-mb' }, [", "h('div', { class: 'demo-ihow demo-db' }, [")],
  // The form's sub at its old size (20px on 24px lines, the same centre).
  old_sub_size: ['demo.css', (s) => cut(s, 'top:95.4px;width:278px;max-width:none;margin:0;font-size:16px;line-height:19px;color:#707070;', 'top:95.4px;width:278px;max-width:none;margin:0;font-size:18px;line-height:22px;color:#707070;')],
  // The form's sub in its old light grey.
  old_sub_color: ['demo.css', (s) => cut(s, 'font-size:16px;line-height:19px;color:#707070;text-align:center;', 'font-size:16px;line-height:19px;color:#b8b6b9;text-align:center;')],
  // The "You call us" card back where it sat, 13.5px above the centre.
  old_dy: ['demo.css', (s) => cut(s, '--demo-h:215px;--demo-dx:-1.5px;--demo-dy:32px;', '--demo-h:215px;--demo-dx:-1.5px;--demo-dy:0px;')],
  // The iPhone and Android articles trade places.
  swap_help: ['demo.js', (s) => cut(cut(cut(s, "osLink('/support/hca/disable-ios-spam-blockers'", 'TMP_IOS'), "osLink('/support/hca/disable-android-spam-blockers'", "osLink('/support/hca/disable-ios-spam-blockers'"), 'TMP_IOS', "osLink('/support/hca/disable-android-spam-blockers'")],
  // A help-article tap is not counted.
  no_help_event: ['demo.js', (s) => cut(s, "a.addEventListener('click', function () { track('demo_help_clicked', { os: os }); });", '')],
  // AFMBP-2548: the end-of-call button keeps its old label.
  old_recap_label: ['demo.js', (s) => cut(s, "dm('Start your free trial', 'Start free 30-day trial'))", "dm('Start your free trial', 'Start your free trial'))")],
  // AFMBP-2576: the phone fields' text back at the node's 21px.
  old_field_size: ['demo.css', (s) => cut(s, 'color:var(--navy);font-size:18px;line-height:22px;', 'color:var(--navy);font-size:16.8px;line-height:22px;')],
  // AFMBP-2576: the computer fields' text back at the node's 22px.
  old_desk_field_size: ['demo.css', (s) => cut(s, 'padding:0 9px;font-size:17.6px;border-radius:6px}', 'padding:0 9px;font-size:22px;border-radius:6px}')],
  // AFMBP-2576: no floor where the card is scaled down: 16.8px x .94 = 15.8px on a 320px phone.
  no_zoom_floor: ['demo.css', (s) => cut(s, '  @media (max-width:316px){ .demo-backdrop[data-screen="phone"] .demo-input{font-size:19.4px} }', '')],
  // AFMBP-2548: the desktop end-of-call button back at 56px, taller than the Talk button.
  recap_tall: ['demo.css', (s) => cut(s, '.demo-success-cta{\n  max-width:340px;margin:2px auto 0;height:49px;', '.demo-success-cta{\n  max-width:340px;margin:2px auto 0;height:56px;')],
  // AFMBP-2597: the phone cards hide the close button again (all but the choice, as before).
  no_x: ['demo.css', (s) => cut(s, '.demo-backdrop[data-screen="code"] .demo-close{left:calc((100% - var(--demo-w)) / 2 + 303.496px)}', '.demo-backdrop[data-screen="code"] .demo-close{left:calc((100% - var(--demo-w)) / 2 + 303.496px)}\n  .demo-backdrop:is([data-screen="inbound-call"],[data-screen="inbound-fail"],[data-screen="phone"],[data-screen="code"],[data-screen="calling"],[data-screen="recap"],[data-screen="fail"]) .demo-close{display:none}')],
  // AFMBP-2597: the code card's cross where the other cards draw theirs (the node moved it in 15px).
  code_x_off: ['demo.css', (s) => cut(s, '+ 303.496px)}', '+ 288.496px)}')],
  // AFMBP-2597: the close button shows but does nothing.
  x_dead: ['demo.js', (s) => cut(s, "var close = h('button', { class: 'demo-close', 'aria-label': 'Close', onClick: closeModal }, [", "var close = h('button', { class: 'demo-close', 'aria-label': 'Close' }, [")],
  // AFMBP-2597: the phone form's Continue in regular Inter.
  regular_btns: ['demo.css', (s) => cut(s, 'font-size:22px;font-weight:700;line-height:21px;box-shadow:var(--demo-btn-shadow);', 'font-size:22px;font-weight:400;line-height:21px;box-shadow:var(--demo-btn-shadow);')],
  // AFMBP-2597: the success CTA without the nodes' shadow.
  flat_cta: ['demo.css', (s) => cut(s, 'background:var(--blue);color:#fff;font-size:21px;font-weight:700;line-height:21px;box-shadow:var(--demo-btn-shadow);', 'background:var(--blue);color:#fff;font-size:21px;font-weight:700;line-height:21px;box-shadow:none;')],
  // AFMBP-2597: the success pitch before the 11-13 update.
  old_success_pitch: ['demo.js', (s) => cut(s, "h('span', { class: 'demo-m', text: 'For less than $4 per day, skip the cost of a receptionist without missing a single lead.' })", "h('span', { class: 'demo-m', text: 'Bolt qualifies leads and books jobs for less than $4/day.' })")],
  // AFMBP-2597: the success card without its title on a phone (as after the 11-12 update).
  no_never: ['demo.js', (s) => cut(s, "h('h2', { class: 'demo-success-title' }, [", "h('h2', { class: 'demo-success-title demo-db' }, [")],
  // AFMBP-2597: the form's help line at 15px, as before the 11-13 update.
  big_help: ['demo.css', (s) => cut(s, 'top:495.9px;width:249.5px;margin:0;font-size:14px;line-height:17px;', 'top:494.4px;width:249.5px;margin:0;font-size:15px;line-height:18px;')],
  // AFMBP-2597: the You call us card's number as plain words (no tap to dial).
  no_tel: ['demo.js', (s) => cut(s, "h('li', {}, ['Dial ', telLink('demo-ihow__tel')]),", "h('li', {}, ['Dial ', s.numberDisplay]),")],
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
// AFMBP-2596: a phone's consent, word for word from 2657:1639 (no email, no marketing clause).
const CONSENT_M = 'By providing your phone number and tapping “Continue”, you agree to (1) receive text messages from Bolt Answering for (a) security verification and (2) automated phone calls from Bolt Answering\'s virtual assistant at the number provided. Message frequency may vary. Standard Message, Voice, and Data Rates may apply. Reply STOP to opt out. Reply HELP for help. In accordance with our Privacy Policy, we will not share mobile information with third parties for promotional or marketing purposes.';

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
  // AFMBP-2597: the close button on the open card, card-relative, whether it is on top at its
  // centre, and whether it draws the node's cross.
  const closeAt = () => ev("(function(){var c=document.querySelector('.demo-backdrop.open .demo-card'), b=document.querySelector('.demo-backdrop.open .demo-close'); if(!c||!b) return {none:true}; var s=getComputedStyle(b); if(s.display==='none'||s.visibility==='hidden') return {hidden:true}; var cr=c.getBoundingClientRect(), r=b.getBoundingClientRect(); return {x:r.left-cr.left, y:r.top-cr.top, w:r.width, h:r.height, top:document.elementFromPoint(r.left+r.width/2, r.top+r.height/2)===b, art:/demo-m-close\\.svg/.test(getComputedStyle(b,'::before').backgroundImage)};})()");
  // The node's 13px cross at `gx` (card-relative), 17px down, centred in a 44px target.
  const closeFits = (c, gx) => !!c && near(c.x, gx - 15.504) && near(c.y, 1.497) && near(c.w, 44) && near(c.h, 44) && c.top === true && c.art === true;
  // AFMBP-2597: Inter Bold with the nodes' two shadows.
  const boldShadow = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; var c=getComputedStyle(e); return c.fontWeight+'|'+/rgba\\(0, 0, 0, 0\\.3\\) 0px 1px 2px 0px, rgba\\(0, 0, 0, 0\\.15\\) 0px 2px 6px 2px/.test(c.boxShadow);})()`);
  const cardRel = async (sel) => { const c = await box('.demo-backdrop.open .demo-card'), b = await box(sel); return b && { x: b.x - c.x, y: b.y - c.y, w: b.w, h: b.h }; };
  const flagged = () => ev("['demo-phone','demo-business','demo-email'].filter(function(id){var e=document.getElementById(id); return e.classList.contains('err') && e.getAttribute('aria-invalid')==='true' && e.getAttribute('aria-describedby')==='demo-formerr';})");
  const greyBtn = async () => (await attr('.demo-backdrop.open .demo-btn', 'aria-disabled')) === 'true' && (await ev("document.querySelector('.demo-backdrop.open .demo-btn').classList.contains('demo-btn--off')"));

  // ================= the form, empty (2657:1639 as updated 2026-11-12, AFMBP-2596) =================
  await phone();
  console.log('[phone] "We call you" form: the number only; copy, field, geometry, grey Continue');
  reset();
  await load('/hvac.html?talk=form');
  ok(await waitScreen('phone'), 'form: ?talk=form opens the form');
  ok((await text('.demo-h--form')) === 'What number would you like the assistant to call?', `form: heading (${await text('.demo-h--form')})`);
  ok((await text('.demo-sub')) === 'We’ll send a one-time passcode before we make the call.', `form: sub (${await text('.demo-sub')})`);
  ok((await text('.demo-field--phone .demo-label')) === 'Phone number' && (await css('.demo-field--phone .demo-label', 'fontWeight')) === '700', `form: the node's label "Phone number", bold (${await text('.demo-field--phone .demo-label')})`);
  ok((await visible('#demo-phone')) && !(await visible('#demo-business')) && !(await visible('#demo-email')) && !(await visible('.demo-field--business .demo-label')) && !(await visible('.demo-field--email .demo-label')), 'form: the phone number is the one field (no business name or email field, no label for them)');
  ok((await attr('#demo-phone', 'placeholder')) === '(555) 555-1212', 'form: the phone placeholder');
  ok((await text('.demo-disclosure')) === CONSENT_M, `form: the node's consent, word for word (no email, no marketing clause) (${await text('.demo-disclosure')})`);
  ok((await attr('#demo-phone', 'type')) === 'tel' && (await attr('#demo-phone', 'inputmode')) === 'tel' && (await attr('#demo-phone', 'autocomplete')) === 'tel', 'form: phone opens the phone keypad, autofills a phone');
  ok((await attr('#demo-phone', 'enterkeyhint')) === 'done', 'form: the keyboard key reads "done" on a phone');
  ok((await ev("document.getElementById('demo-phone').required")) === true, 'form: the phone number is required');
  ok((await ev("(function(){var e=document.getElementById('demo-phone'), l=document.querySelector('label[for=demo-phone]'); return !!l && e.labels && e.labels[0]===l;})()")) === true, 'a11y: the field has its label');
  ok((await css('#demo-phone', 'fontSize')) === '18px' && (await css('.demo-field--phone .demo-label', 'fontSize')) === '15px' && (await css('.demo-backdrop.open .demo-btn', 'fontSize')) === '22px' && (await css('.demo-sub', 'fontSize')) === '16px' && (await css('.demo-h--form', 'fontSize')) === '21px' && (await css('.demo-h--form', 'fontWeight')) === '600', 'form: the node\'s sizes (18px field, 15px label, 22px Continue, 16px sub, Semi Bold 21px heading)');
  const fieldType = await ev("(function(){var e=document.getElementById('demo-phone'); return getComputedStyle(e).fontSize+'/'+getComputedStyle(e,'::placeholder').fontSize+'/'+getComputedStyle(e).lineHeight;})()");
  ok(fieldType === '18px/18px/22px', `form: the field and its placeholder at the node's 18px (${fieldType})`);
  ok((await css('.demo-sub', 'color')) === 'rgb(112, 112, 112)', `form: the sub in the node's #707070 (${await css('.demo-sub', 'color')})`);
  ok((await ev("getComputedStyle(document.querySelector('.demo-h--form'),'::after').content")) === 'none' && (await ev("getComputedStyle(document.querySelector('.demo-backdrop.open .demo-body'),'::before').content")) === 'none', 'form: no brush and no paintbrush watermark (the 11-12 node dropped both)');
  const fs = await cardRel('.demo-sub');
  ok(fs && near(fs.y, 96) && near(fs.h, 38), `form: the sub's two 19px lines where the node sets them (${JSON.stringify(fs)})`);
  const fc = await box('.demo-backdrop.open .demo-card');
  ok(near(fc.w, 337) && near(fc.h, 535) && near(fc.y, 96), `form: card 337x535 where the node puts it (${fc.w}x${fc.h} at ${fc.y})`);
  for (const [sel, x, y, w, h] of [['#demo-phone', 44, 181, 254, 36], ['.demo-backdrop.open .demo-btn', 45, 245, 253, 49], ['.demo-backdrop.open .demo-help', 44, 496.5, 249.5, 17]]) {
    const b = await cardRel(sel);
    ok(b && near(b.x, x) && near(b.y, y) && near(b.w, w) && near(b.h, h), `form: ${sel} where it matches the node (${JSON.stringify(b)})`);
  }
  // Under 337px the card is scaled down (zoom .94, then .83 under 317px). There the field type
  // is set up where needed, so its size on screen stays at 16px or more (iOS zooms under 16).
  for (const [w, z] of [[402, 1], [375, 1], [337, 1], [336, 0.94], [320, 0.94], [317, 0.94], [316, 0.83], [280, 0.83]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 700, deviceScaleFactor: 3, mobile: true });
    await sleep(150);
    const [f, zz] = await ev("(function(){var e=document.getElementById('demo-phone'); return [parseFloat(getComputedStyle(e).fontSize), e.currentCSSZoom];})()");
    ok(near(zz, z, 0.001) && f * zz >= 16 && (w > 316 ? f === 18 : f > 18), `form ${w}px: the field type on screen ${+(f * zz).toFixed(3)}px (${f}px x the card's zoom ${z}) never under 16px`);
  }
  await phone();
  await sleep(150);
  ok(await greyBtn(), 'form: Continue starts grey (aria-disabled, never disabled)');
  ok((await css('.demo-backdrop.open .demo-btn', 'backgroundColor')) === 'rgb(184, 182, 185)', `form: grey is the node's #b8b6b9 (${await css('.demo-backdrop.open .demo-btn', 'backgroundColor')})`);
  ok(!(await ev("document.querySelector('.demo-backdrop.open .demo-btn').disabled")), 'form: the grey Continue still takes a tap');

  console.log('[phone] Continue turns blue on a whole phone number (no business name to wait for)');
  await type('#demo-phone', '415555123');
  ok((await val('#demo-phone')) === '(415) 555-123' && (await greyBtn()), `gate: 9 digits keep Continue grey (${await val('#demo-phone')})`);
  await type('#demo-phone', '4');
  ok((await val('#demo-phone')) === '(415) 555-1234' && !(await greyBtn()), 'gate: the 10th digit turns it blue');
  await sleep(250);   // Continue fades between grey and blue (.15s)
  ok((await css('.demo-backdrop.open .demo-btn', 'backgroundColor')) === 'rgb(43, 127, 253)', 'gate: blue is the node\'s #2b7ffd (2891:986)');
  ok(sent('/api/demo/otp/send').length === 0, 'gate: nothing sent while typing');

  // ================= errors (2894:1135 / 2894:1108) =================
  console.log('[phone] errors: the line under the field, the field outlined in red, nothing sent');
  reset();
  await load('/hvac.html?talk=form');
  await waitScreen('phone');
  await ev('document.activeElement && document.activeElement.blur(); 1');
  await tap('.demo-backdrop.open .demo-btn');
  ok((await text('#demo-formerr')) === 'Please complete the form to continue' && (await visible('#demo-formerr')), `incomplete: the node's message, no full stop (${await text('#demo-formerr')})`);
  ok(JSON.stringify(await flagged()) === '["demo-phone"]', `incomplete: the phone field flagged (${JSON.stringify(await flagged())})`);
  ok((await css('#demo-phone', 'backgroundColor')) === 'rgb(255, 239, 239)' && /rgb\(255, 0, 0\) 0px 0px 0px 1\.6px/.test(await css('#demo-phone', 'boxShadow')), `incomplete: the field pink (#ffefef), outlined in red 1.6px, also with focus (${await css('#demo-phone', 'boxShadow')})`);
  ok((await css('#demo-formerr', 'color')) === 'rgb(255, 0, 0)' && (await css('#demo-formerr', 'fontSize')) === '10px', 'incomplete: the message red, 10px');
  const eb = await cardRel('#demo-formerr');
  ok(eb && near(eb.x, 45) && near(eb.y, 228), `incomplete: the message under the field, where 2894:1135 puts it (${JSON.stringify(eb)})`);
  ok((await attr('#demo-formerr', 'role')) === 'alert', 'a11y: the message is announced');
  ok((await active()) === 'demo-phone', `incomplete: focus goes to the field to fix (${await active()})`);
  ok(sent('/api/demo/otp/send').length === 0, 'incomplete: no code sent, no call');
  await type('#demo-phone', '415555123');
  ok(JSON.stringify(await flagged()) === '[]' && !(await visible('#demo-formerr')), 'incomplete: typing in the flagged field clears its flag and the message');
  await ev('document.activeElement && document.activeElement.blur(); 1');
  await tap('.demo-backdrop.open .demo-btn');
  ok((await text('#demo-formerr')) === 'Please enter a valid US phone number' && JSON.stringify(await flagged()) === '["demo-phone"]' && (await val('#demo-phone')) === '(415) 555-123', `invalid: 9 digits -> the node's "Please enter a valid US phone number", the number kept (${await text('#demo-formerr')})`);
  ok(sent('/api/demo/otp/send').length === 0, 'invalid: nothing sent');

  // ================= Enter / Done on a phone =================
  console.log('[phone] Enter/Done closes the keyboard and sends nothing');
  reset();
  await load('/hvac.html?talk=form');
  await waitScreen('phone');
  await type('#demo-phone', '4155551234');
  await ev("document.getElementById('demo-phone').focus(); 1");
  await enter();
  ok((await active()) !== 'demo-phone', `enter: the field lets go of focus (the keyboard closes) (${await active()})`);
  ok(sent('/api/demo/otp/send').length === 0 && (await screen()) === 'phone', `enter: nothing sent, still the form (${sent('/api/demo/otp/send').length})`);

  // ================= the focused field above the keyboard =================
  console.log('[phone] the focused field and its message are scrolled into the visible area');
  await phone(220);   // the area left above an open keyboard on a short phone
  reset();
  await load('/hvac.html?talk=form');
  await waitScreen('phone');
  await ev('document.querySelector(".demo-backdrop").scrollTop = 0; document.activeElement && document.activeElement.blur(); 1');
  // Incomplete: the message ties to the phone field. (Continue sits under the fold here, so it is
  // clicked from the page rather than tapped on screen.)
  await ev("document.querySelector('.demo-backdrop.open .demo-btn').click(); 1");
  ok((await visible('#demo-formerr')) && (await attr('#demo-phone', 'aria-describedby')) === 'demo-formerr', 'keep visible: the message shows, tied to the phone field');
  // iOS Safari never scrolls the overlay for a field: focus without the browser's own scroll,
  // then let the visible area change, as the keyboard does.
  await ev("document.querySelector('.demo-backdrop').scrollTop = 0; document.getElementById('demo-phone').blur(); document.getElementById('demo-phone').focus({preventScroll:true}); window.visualViewport.dispatchEvent(new Event('resize')); 1");
  await sleep(450);
  const vh = await ev('window.visualViewport.height');
  const pf = await box('#demo-phone'), msg = await box('#demo-formerr');
  ok(pf && msg && msg.h > 0 && pf.y >= 0 && msg.y + msg.h <= vh, `keep visible: the field and the message tied to it both shown (${pf && msg && [pf.y.toFixed(1), (msg.y + msg.h).toFixed(1)]} of ${vh})`);
  await phone();

  // ================= one tap, one code, one call; the code card; Calling (2891:1072) =================
  console.log('[phone] a double tap sends one code (as Bolt Services, the phone consent); the code card; one verify, one call; Calling');
  reset();
  await load('/hvac.html?talk=form');
  await waitScreen('phone');
  await type('#demo-phone', '4155551234');
  await ev('document.activeElement && document.activeElement.blur(); 1');
  api.sendDelayMs = 800;
  await tap('.demo-backdrop.open .demo-btn', 120);
  await tap('.demo-backdrop.open .demo-btn', 1200);
  api.sendDelayMs = 0;
  ok(sent('/api/demo/otp/send').length === 1, `send: a second tap while the first is on its way sends nothing (${sent('/api/demo/otp/send').length})`);
  const sb = (sent('/api/demo/otp/send')[0] || {}).body || {};
  ok(sb.consentText === CONSENT_M && sb.phone === '+14155551234' && sb.businessName === 'Bolt Services' && !('email' in sb), `send: E.164 phone, the phone's consent as rendered, Bolt Services, no email key (${JSON.stringify({ phone: sb.phone, businessName: sb.businessName, email: 'email' in sb, consent: sb.consentText === CONSENT_M })})`);
  ok(evs('demo_details_submitted', (d) => d.has_email === false).length === 1, 'events: demo_details_submitted once, has_email false');
  let codeUp = false;
  for (let i = 0; i < 40 && !codeUp; i++) { codeUp = (await ev("!!document.querySelector('.demo-backdrop.open .demo-code input')")) === true; if (!codeUp) await sleep(100); }
  ok(codeUp && (await screen()) === 'code', 'send: the code card follows the one send');
  // The code card (2670:1394): "Enter the code", six boxes, Back; no Continue, no resend line, no help line.
  ok((await text('.demo-backdrop.open .demo-h')) === 'Enter the code' && (await visible('.demo-back')) && (await text('.demo-back')) === 'Back', `code: "Enter the code" and Back (${await text('.demo-backdrop.open .demo-h')})`);
  ok(!(await visible('.demo-backdrop.open .demo-btn')) && !(await visible('.demo-resend')) && !(await visible('.demo-backdrop.open .demo-help')) && !(await visible('.demo-backdrop.open .demo-sub')) && !(await visible('.demo-logo')), 'code: no Continue, resend line, help line, sub or logo on the phone card');
  const kx = await closeAt();
  ok(closeFits(kx, 319), `code: the close button where 2670:1394 draws its cross (319px in), on top (${JSON.stringify(kx)})`);
  const kc = await box('.demo-backdrop.open .demo-card');
  ok(near(kc.w, 352) && near(kc.h, 210) && near(kc.y, 246), `code: card 352x210 where the node puts it (${kc.w}x${kc.h} at ${kc.y})`);
  const bx = await ev("[].slice.call(document.querySelectorAll('.demo-code input')).map(function(i){var r=i.getBoundingClientRect();return [+(r.width).toFixed(2), +(r.height).toFixed(2)]})");
  ok(bx.length === 6 && bx.every(([w, h]) => near(w, 42.42) && near(h, 40.44)), `code: six 42.42x40.44 boxes (${JSON.stringify(bx)})`);
  await ev("document.querySelectorAll('.demo-code input')[0].focus(); 1");
  await send('Input.insertText', { text: '123456' });
  ok(await waitScreen('calling', 6000), 'call: the sixth digit checks the code -> the Calling card');
  await sleep(800);
  ok(sent('/api/demo/otp/verify').length === 1 && sent('/api/demo/token').length === 1 && sent('/api/demo/call').length === 1, `call: one verify, one token, one call (${['/api/demo/otp/verify', '/api/demo/token', '/api/demo/call'].map((p) => sent(p).length)})`);
  ok(((sent('/api/demo/token')[0] || {}).body || {}).businessName === 'Bolt Services', 'call: the call is set up as Bolt Services (the server needs a business name)');
  ok((await text('.demo-callcard__m')) === 'Your assistant is calling from: (415) 555-0123', `calling: the node's line with the caller id the API returned (${await text('.demo-callcard__m')})`);
  ok((await css('.demo-callcard__m', 'fontSize')) === '21px' && (await css('.demo-callcard__m', 'fontWeight')) === '600', 'calling: Inter Semi Bold 21px');
  ok(!(await visible('.demo-callcard__head')) && !(await visible('.demo-callcard__expect')) && !(await visible('.demo-xm')) && !(await visible('.demo-callcard__list')), 'calling: no title, "What to expect" or rows (the 11-12 node dropped them)');
  ok((await visible('.demo-backdrop.open .demo-help')) && (await text('.demo-backdrop.open .demo-help')) === 'Need help? Contact support.' && (await css('.demo-backdrop.open .demo-help', 'fontSize')) === '14px', 'calling: the help line, Inter 14');
  const cx = await closeAt();
  ok(closeFits(cx, 304), `calling: the close button where 2891:1072 draws its cross, on top (${JSON.stringify(cx)})`);
  const cc = await box('.demo-backdrop.open .demo-card');
  ok(near(cc.w, 337) && near(cc.h, 151) && near(cc.y, 301), `calling: card 337x151 where the node puts it (${cc.w}x${cc.h} at ${cc.y})`);
  ok(evs('demo_call_placed', (d) => d.call_id === 'out-1').length === 1, 'events: demo_call_placed once');

  // ================= shared success (2441:811 as updated 2026-11-12) =================
  console.log('[phone] success: the call\'s transcript, counted once; the blue CTA');
  api.recap = { status: 'completed', transcript: TRANSCRIPT };
  ok(await waitScreen('recap', 8000), 'success: the completed call -> the success card');
  await sleep(3500);   // a few more status answers arrive: still counted once
  ok((await visible('.demo-success-never')) && (await text('.demo-success-never')) === 'NEVER' && (await visible('.demo-success-rest')) && (await text('.demo-success-rest')) === 'miss a job again', 'success: the node\'s title, "NEVER" and "miss a job again"');
  ok((await css('.demo-success-never', 'fontFamily')).includes('Permanent Marker') && (await css('.demo-success-never', 'color')) === 'rgb(0, 0, 0)' && /^matrix\(0\.995/.test(await css('.demo-success-never', 'transform')) && (await css('.demo-success-rest', 'fontWeight')) === '600' && (await css('.demo-success-rest', 'fontSize')) === '17.374px', `success: "NEVER" black in the marker and turned as the node turns it; "miss a job again" Inter Semi Bold 17.37 (${await css('.demo-success-never', 'transform')})`);
  ok(/demo-m-ul-success\.svg/.test(await ev("getComputedStyle(document.querySelector('.demo-success-title'),'::after').backgroundImage")), 'success: the node\'s yellow brush under "NEVER"');
  ok((await text('.demo-success-sub')) === 'For less than $4 per day, skip the cost of a receptionist without missing a single lead.' && (await css('.demo-success-sub', 'fontSize')) === '16px' && (await css('.demo-success-sub', 'fontWeight')) === '400' && (await css('.demo-success-sub', 'color')) === 'rgb(112, 112, 112)', `success: the node's pitch, Inter 16 in grey (${await text('.demo-success-sub')})`);
  ok((await boldShadow('.demo-success-cta')) === '700|true', `success: the CTA in Inter Bold with the nodes' shadow (${await boldShadow('.demo-success-cta')})`);
  const sx = await closeAt();
  ok(closeFits(sx, 304), `success: the close button where 2441:811 draws its cross, on top (${JSON.stringify(sx)})`);
  ok((await text('.demo-success-tlabel')) === 'Transcript', `success: "Transcript" (${await text('.demo-success-tlabel')})`);
  ok(JSON.stringify(await ev("[].slice.call(document.querySelectorAll('.demo-chat .demo-bubble')).map(function(e){return e.innerText})")) === JSON.stringify(TRANSCRIPT.map((t) => t.content)), 'success: the call\'s own transcript, not the node\'s sample');
  ok((await text('.demo-success-cta')) === 'Start free 30-day trial' && (await css('.demo-success-cta', 'backgroundColor')) === 'rgb(43, 127, 253)' && (await css('.demo-success-cta', 'fontSize')) === '21px' && (await attr('.demo-success-cta', 'href')) === 'https://app.boltanswering.com/signup', `success: the node's blue "Start free 30-day trial" to sign-up (${await text('.demo-success-cta')})`);
  ok(!(await visible('.demo-success-trial')), 'success: no desktop "First 30 days" line');
  ok(evs('demo_transcript_shown', (d) => d.call_id === 'out-1').length === 1 && evs('demo_call_finished').length === 1, `events: demo_transcript_shown and demo_call_finished once each (${evs('demo_transcript_shown').length}, ${evs('demo_call_finished').length})`);
  await tap('.demo-success-cta');
  ok(evs('demo_trial_clicked', (d) => d.from === 'recap' && d.call_id === 'out-1').length === 1, 'events: the CTA tap counted once, from the recap');
  const sc = await box('.demo-backdrop.open .demo-card');
  ok(near(sc.w, 332) && near(sc.h, 633) && near(sc.y, 60), `success: card 332x633 where the node puts it (${sc.w}x${sc.h} at ${sc.y})`);

  // ================= failure + help (2676:1163 as updated 2026-11-12) =================
  console.log('[phone] failure: help articles, never swapped, each tap counted; Continue calls again');
  reset();
  await load('/hvac.html?talk=form');
  await waitScreen('phone');
  await type('#demo-phone', '4155551234');
  await ev('document.activeElement && document.activeElement.blur(); 1');
  await tap('.demo-backdrop.open .demo-btn', 600);
  await ev("document.querySelectorAll('.demo-code input')[0].focus(); 1");
  await send('Input.insertText', { text: '123456' });
  await waitScreen('calling', 6000);
  api.recap = { status: 'failed' };
  ok(await waitScreen('fail', 8000), 'failure: a failed call -> the failure card');
  ok((await text('.demo-failcard__title2')) === 'OOPs!' && (await text('.demo-failcard__body2')) === 'Sometimes Bolt calls get spam blocked. Here’s how to temporarily turn off spam blockers before you try again:', `failure: the node's copy (${await text('.demo-failcard__title2')} / ${await text('.demo-failcard__body2')})`);
  ok((await css('.demo-failcard__body2', 'fontSize')) === '18px' && (await css('.demo-failcard__title2', 'fontFamily')).includes('Permanent Marker'), 'failure: "OOPs!" in the marker, the words at 18px');
  const fcd = await box('.demo-backdrop.open .demo-card');
  ok(near(fcd.w, 332) && near(fcd.h, 445) && near(fcd.y, 154), `failure: card 332x445 where the node puts it (${fcd.w}x${fcd.h} at ${fcd.y})`);
  const links = await ev("[].slice.call(document.querySelectorAll('.demo-failcard__link')).map(function(a){return {href:a.getAttribute('href'),text:a.innerText.trim(),target:a.target,rel:a.rel,label:a.getAttribute('aria-label'),logo:(a.querySelector('img')||{}).getAttribute&&a.querySelector('img').getAttribute('src')}})");
  ok(links.length === 2 && links[0].href === '/support/hca/disable-ios-spam-blockers' && links[0].text === 'iPhones' && /iphone/.test(links[0].logo), `help: "iPhones" -> the iPhone article, with the Apple lockup (${JSON.stringify(links[0])})`);
  ok(links.length === 2 && links[1].href === '/support/hca/disable-android-spam-blockers' && links[1].text === 'Androids' && /android/.test(links[1].logo), `help: "Androids" -> the Android article, with the Android lockup (${JSON.stringify(links[1])})`);
  ok(links.every((l) => l.target === '_blank' && /noopener/.test(l.rel) && l.label && l.label.indexOf(l.text) === 0 && /spam blockers/.test(l.label)), 'help: new tab, noopener, a descriptive name that starts with the visible words');
  ok((await ev("[].slice.call(document.querySelectorAll('.demo-failcard__os')).every(function(i){return i.alt==='' && i.getAttribute('aria-hidden')==='true'})")), 'a11y: the lockups are decoration');
  await tap('.demo-failcard__link:nth-child(1)');
  await tap('.demo-failcard__link:nth-child(2)');
  ok(evs('demo_help_clicked', (d) => d.os === 'ios').length === 1 && evs('demo_help_clicked', (d) => d.os === 'android').length === 1, `events: each help tap counted once, by platform (${JSON.stringify(evs('demo_help_clicked').map((e) => e.data.os))})`);
  // `browser` (AFMBP-2565) rides on every event: a closed class like "ios_browser", never the user agent.
  ok(evs('demo_help_clicked').every((e) => Object.keys(e.data).filter((k) => !['os', 'trade', 'qa', 'attr', 'page', 'automated', 'browser'].includes(k)).length === 0 && /^(ios|android|desktop)_[a-z]+$/.test(e.data.browser)), 'events: the help event carries the platform only (no phone, email or business)');
  ok((await text('.demo-failcard__btn')) === 'Continue' && (await boldShadow('.demo-failcard__btn')) === '700|true', `failure: "Continue", Inter Bold with the nodes' shadow (${await boldShadow('.demo-failcard__btn')})`);
  const fx2 = await closeAt();
  ok(closeFits(fx2, 304), `failure: the close button where 2676:1163 draws its cross, on top (${JSON.stringify(fx2)})`);
  const before = sent('/api/demo/call').length;
  api.recap = { status: 'in_call', transcript: null };
  await tap('.demo-failcard__btn');
  ok(await waitScreen('calling', 6000), 'failure: Continue places the call again -> Calling');
  await sleep(500);
  ok(sent('/api/demo/call').length === before + 1, `failure: exactly one more call (${sent('/api/demo/call').length - before})`);

  // ================= "You call us": the code stays this session's =================
  // (Its call card is 2891:1090 since the 11-13 update, AFMBP-2597.)
  console.log('[phone] "You call us": this session\'s code, stable when the page comes back');
  reset();
  await load('/hvac.html?talk=1');
  ok(await waitScreen('choice'), 'inbound: choice');
  await sleep(300);
  ok(api.sessions === 1, `inbound: one code fetched (${api.sessions})`);
  await tap('.demo-choice__call');
  ok(await waitScreen('inbound-call'), 'inbound: the call card');
  ok((await text('.demo-ihow__h')) === 'Here’s how to call your assistant:', `inbound: the node's title (${await text('.demo-ihow__h')})`);
  const steps = await ev("[].slice.call(document.querySelectorAll('.demo-backdrop.open .demo-ihow__list li')).map(function(l){return l.innerText.replace(/\\s+/g,' ').trim()})");
  ok(JSON.stringify(steps) === JSON.stringify(['Dial (855) 497-3151', 'Tap in this code: 4321']), `inbound: the two steps, with this session's number and code (${JSON.stringify(steps)})`);
  ok((await ev("[].slice.call(document.querySelectorAll('.demo-backdrop.open .demo-ihow__list li')).map(function(l){return getComputedStyle(l,'::before').content}).join('|')")) === 'counter(demo-ihow) "."|counter(demo-ihow) "."' && (await css('.demo-ihow__list li', 'color')) === 'rgb(112, 112, 112)', 'inbound: the steps numbered by a counter ("1." / "2."; the pixels were matched to the node), in grey');
  ok((await attr('.demo-ihow__tel', 'href')) === 'tel:+18554973151,,4321' && (await css('.demo-ihow__tel', 'color')) === 'rgb(24, 10, 83)' && (await css('.demo-ihow__list b', 'color')) === 'rgb(24, 10, 83)', `inbound: the number dials this session's line and code; number and code in navy (${await attr('.demo-ihow__tel', 'href')})`);
  ok(!(await visible('.demo-incall__digits')) && !(await visible('.demo-incall__expect')) && !(await visible('.demo-incall__dial')) && !(await visible('.demo-incall__list')) && (await ev("getComputedStyle(document.querySelector('.demo-backdrop.open .demo-body'),'::before').content")) === 'none', 'inbound: no big code, "What to expect", rows or paintbrush (the 11-13 node dropped them)');
  ok((await text('.demo-backdrop.open .demo-help')) === 'Need help? Contact support.' && (await css('.demo-backdrop.open .demo-help', 'fontSize')) === '14px', 'inbound: the help line, Inter 14');
  const ic = await box('.demo-backdrop.open .demo-card');
  ok(near(ic.w, 337) && near(ic.h, 215) && near(ic.y, 301), `inbound: card 337x215 where 2891:1090 puts it (${ic.w}x${ic.h} at ${ic.y})`);
  const ix = await closeAt();
  ok(closeFits(ix, 304), `inbound: the close button where 2891:1090 draws its cross, on top (${JSON.stringify(ix)})`);
  // A tap on the number is counted, from the card (navigation to tel: held back here).
  await ev("(function(){var a=document.querySelector('.demo-ihow__tel'); a.addEventListener('click', function(e){e.preventDefault()}, {once:true}); a.click(); return 1})()");
  await sleep(300);
  ok(evs('demo_inbound_call_tapped', (d) => d.from === 'card').length === 1, `inbound: a tap on the number counted once, from the card (${evs('demo_inbound_call_tapped').length})`);
  await ev("window.__vis='hidden'; document.dispatchEvent(new Event('visibilitychange')); 1");
  await sleep(300);
  await ev("window.__vis='visible'; document.dispatchEvent(new Event('visibilitychange')); 1");
  await sleep(800);
  ok((await text('.demo-backdrop.open .demo-ihow__list b')) === '4321' && api.sessions === 1, `inbound: the same code after the page comes back, no second code (${await text('.demo-backdrop.open .demo-ihow__list b')}, ${api.sessions})`);
  api.inState = 'connected'; api.inCallId = 'in-1'; api.recap = { status: 'completed', transcript: TRANSCRIPT };
  ok(await waitScreen('recap', 8000), 'inbound: the linked call ends on the same success card');
  ok(/^For less than \$4 per day/.test(await text('.demo-success-sub')) && (await text('.demo-success-cta')) === 'Start free 30-day trial', 'inbound: one shared success (same card, same copy)');
  await sleep(3500);
  ok(evs('demo_transcript_shown', (d) => d.call_id === 'in-1' && d.mode === 'inbound').length === 1, 'events: inbound success counted once, mode inbound');

  // ================= the close button on a phone card (AFMBP-2597) =================
  console.log('[phone] the close button on the form: a tap closes the demo, as the shade does');
  reset();
  await load('/hvac.html?talk=form');
  ok(await waitScreen('phone'), 'close: the form');
  const ffx = await closeAt();
  ok(closeFits(ffx, 304), `form: the close button where 2657:1639 draws its cross, on top (${JSON.stringify(ffx)})`);
  ok((await boldShadow('.demo-backdrop.open .demo-btn')) === '700|true' && (await css('.demo-backdrop.open .demo-help', 'fontSize')) === '14px', `form: Continue in Inter Bold with the nodes' shadow; the help line Inter 14 (${await boldShadow('.demo-backdrop.open .demo-btn')})`);
  await tap('.demo-backdrop.open .demo-close', 400);
  ok((await screen()) === null && evs('demo_closed').length === 1, `close: a tap on the form's close button closes the demo, demo_closed once (${JSON.stringify(evs('demo_closed').map((e) => e.data.step))})`);

  // ================= desktop: unchanged =================
  console.log('[desktop] the form, Calling, success and failure keep their own copy; Enter = Continue');
  await desktop();
  reset();
  await load('/hvac.html?talk=form');
  ok(await waitScreen('phone'), 'desktop: the form');
  ok((await text('.demo-h--form')) === 'We’ll call you right now' && (await text('.demo-sub')) === 'Get a one-time passcode', `desktop: its own heading and sub (${await text('.demo-h--form')} / ${await text('.demo-sub')})`);
  ok((await text('.demo-field--business .demo-label')) === 'What’s your business called?' && (await text('.demo-field--email .demo-label')) === 'What’s your email? (optional)', 'desktop: its own labels');
  ok((await attr('#demo-phone', 'enterkeyhint')) === null, 'desktop: no "done" key hint');
  // AFMBP-2576: the three fields' text 20% under the node's 22px, the placeholders with it.
  const deskType = await ev("['demo-phone','demo-business','demo-email'].map(function(id){var e=document.getElementById(id); return getComputedStyle(e).fontSize+'/'+getComputedStyle(e,'::placeholder').fontSize;})");
  ok(JSON.stringify(deskType) === JSON.stringify(['17.6px/17.6px', '17.6px/17.6px', '17.6px/17.6px']) && (await css('.demo-field--phone .demo-label', 'fontSize')) === '15px' && (await css('.demo-backdrop.open .demo-btn', 'fontSize')) === '22px', `desktop: the three fields and their placeholders at 17.6px; labels 15px, Continue 22px (${JSON.stringify(deskType)})`);
  // AFMBP-2596: phones ask for the number only; a computer keeps its three fields, its consent
  // and the rules of AFMBP-2000 / AFMBP-2150 (phone + business name required, email optional).
  ok((await visible('#demo-business')) && (await visible('#demo-email')) && (await text('.demo-field--phone .demo-label')) === 'What’s your phone number?', 'desktop: the phone, business name and email fields, its own phone label');
  ok((await text('.demo-disclosure')) === CONSENT, 'desktop: its consent unchanged (the one the server hashes for a computer)');
  ok((await ev("document.getElementById('demo-phone').required && document.getElementById('demo-business').required && !document.getElementById('demo-email').required && document.getElementById('demo-email').getAttribute('aria-required')===null")), 'desktop: phone and business name required, email optional');
  await ev('document.activeElement && document.activeElement.blur(); 1');
  await tap('.demo-backdrop.open .demo-btn');
  ok((await text('#demo-formerr')) === 'Please complete the form to continue.' && JSON.stringify(await flagged()) === '["demo-phone","demo-business"]', `desktop incomplete: its message, phone and business name flagged, email not (${await text('#demo-formerr')} ${JSON.stringify(await flagged())})`);
  await type('#demo-business', '   ');
  await type('#demo-phone', '4155551234');
  ok(await greyBtn(), 'desktop gate: a business name of spaces only keeps Continue grey');
  await clear('#demo-business'); await type('#demo-business', 'QA Test Co');
  await type('#demo-email', 'james');
  await ev('document.activeElement && document.activeElement.blur(); 1');
  await tap('.demo-backdrop.open .demo-btn');
  ok((await text('#demo-formerr')) === 'Invalid email address. Please try again.' && JSON.stringify(await flagged()) === '["demo-email"]', `desktop email: a malformed address is flagged (${await text('#demo-formerr')})`);
  ok(sent('/api/demo/otp/send').length === 0, 'desktop: nothing sent for an invalid form');
  await clear('#demo-email');
  await ev("document.getElementById('demo-phone').focus(); 1");
  await enter();
  await sleep(500);
  ok(sent('/api/demo/otp/send').length === 1, `desktop: Enter in a field = Continue (${sent('/api/demo/otp/send').length})`);
  const db = (sent('/api/demo/otp/send')[0] || {}).body || {};
  ok(db.consentText === CONSENT && db.businessName === 'QA Test Co' && !('email' in db), `desktop send: its own consent, the business typed, no email key (${JSON.stringify({ businessName: db.businessName, email: 'email' in db, consent: db.consentText === CONSENT })})`);
  await ev("document.querySelectorAll('.demo-code input')[0].focus(); 1");
  await send('Input.insertText', { text: '123456' });
  ok(await waitScreen('calling', 6000), 'desktop: Calling');
  ok((await text('.demo-callcard__title')) === 'ALL SET!' && (await text('.demo-callcard__from')) === 'Calling you now from (415) 555-0123', `desktop: its own Calling copy (${await text('.demo-callcard__title')} / ${await text('.demo-callcard__from')})`);
  ok((await visible('.demo-callcard__list')) && !(await visible('.demo-xm')), 'desktop: its numbered list, not the phone rows');
  api.recap = { status: 'failed' };
  ok(await waitScreen('fail', 8000), 'desktop: failure card');
  ok((await text('.demo-failcard__btn')) === 'Try again' && /Follow these instructions/.test(await text('.demo-failcard__body')) && !(await visible('.demo-failcard__body2')), 'desktop: its own failure copy and "Try again"');

  // AFMBP-2548 (owner, 11-10: "make the height of those buttons the same size as the height of the 'talk to
  // your assistant' buttons"): on a computer the success card's trial button reads "Start your free trial" and is
  // the height of the page's "Talk to your new assistant" button (it was 56px, the Talk button 49px).
  console.log('[desktop] success: the trial button at the Talk button\'s height');
  for (const [w, h] of [[1280, 900], [1920, 1080]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    reset();
    await load('/hvac.html?talk=form');
    ok(await waitScreen('phone'), `desktop ${w}: the form, for a call that completes`);
    await type('#demo-phone', '4155551234');
    await type('#demo-business', 'QA Test Co');
    await ev("document.getElementById('demo-phone').focus(); 1");
    await enter();
    await sleep(500);
    await ev("document.querySelectorAll('.demo-code input')[0].focus(); 1");
    await send('Input.insertText', { text: '123456' });
    ok(await waitScreen('calling', 6000), `desktop ${w}: Calling`);
    api.recap = { status: 'completed', transcript: TRANSCRIPT };
    ok(await waitScreen('recap', 8000), `desktop ${w}: the completed call -> the success card`);
    await sleep(400);
    const talk = await box('.tphero .btn--blue'), cta = await box('.demo-backdrop.open .demo-success-cta');
    ok((await text('.demo-success-cta')) === 'Start your free trial' && (await css('.demo-success-cta', 'backgroundColor')) === 'rgb(252, 189, 17)', `desktop ${w}: the yellow "Start your free trial" (${await text('.demo-success-cta')})`);
    ok(!!talk && !!cta && talk.h > 0 && near(cta.h, talk.h, 0.5), `desktop ${w}: the success card's trial button is ${cta && cta.h}px tall; "Talk to your new assistant" is ${talk && talk.h}px`);
    ok(!!cta && (await ev("(function(){var a=document.querySelector('.demo-success-cta');return a.scrollWidth<=a.clientWidth&&a.scrollHeight<=a.clientHeight})()")) === true, `desktop ${w}: the label fits inside the button`);
  }

  console.log(bad ? `\n${bad} FAILED, ${good} passed${NC ? ` (negative control: ${NC})` : ''}` : `\nALL PASS (${good} checks)${NC ? ` — negative control ${NC} did NOT bite` : ''}`);
  ws.close();
} finally {
  chrome.kill('SIGKILL'); srv.close();
  await sleep(300); rmSync(PROFILE, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
