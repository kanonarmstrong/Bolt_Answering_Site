// AFMBP-2189 — the demo's first screen on phones, redrawn again (Figma 2670:952 as updated
// 2026-10-15, after AFMBP-2090 and AFMBP-2150; its body text as updated 2026-10-16,
// AFMBP-2274), and again in the owner's 11-12 update (AFMBP-2596): the close button,
// "Available now", the question "How would you like to start the call?", "You call us" with
// the wait under it, "We call you", the rating and its quote under them. The logo, the pitch
// with "real money" underlined and the paintbrush watermark left with the 11-12 update.
// The owner's 11-13 update (AFMBP-2597): the two ways in are 151x43 with corners of 10, in
// Inter Bold with the nodes' shadow; everything under the question moved up; the rating is a
// review in a bubble (the node's own bubble, four stars and a fifth cut flat, "Gus C." /
// "Massachusetts", "“Sounds like a real receptionist!”"); the help line is Inter 14.
// The owner's 11-14 update (AFMBP-2606): the question leaves the picture (it stays for screen
// readers, as the dialog's one heading); the two ways in are 188x43, with a wider gap before
// "We call you"; the review and the help line moved up; the card is 337x393.
// The owner's 11-22 redesign (Figma 2946:1666, AFMBP-2690): a 306x428 card on #f8fbfe with Sierra
// drawn faintly at its top, "Meet Sierra." and a new pitch, "Available now", "You call her" /
// "She calls you" and Brent B.'s review. Every word on it is the node's own drawing (the owner
// outlined the text so it draws the same on every phone); screen readers get the same words as
// hidden text. No wait line and no help line.
// The owner's 11-24 update (AFMBP-2695): the same card drawn about 15% bigger (351x491, centred on
// the screen), the two ways in kept at their size; "Available now" is "Available", and its green
// dot blinks: on for 900ms, off for 100ms, every second (still for anyone who asks for reduced
// motion). Its four new drawings carry -v4 in their names.
// AFMBP-2600 (owner, 2026-11-13: one responsive demo): a computer shows the same card, centred
// and scaled up as far as its screen's height allows (up to 125%). Drives the real modal in
// headless Chrome against a fake Bolt API and checks:
//   - content: the phone node's copy and art, none of the superseded copy, at every width;
//   - closing (AFMBP-2189): the node's close button sits on top where the node draws it, and a
//     tap or Enter on it closes the demo (demo_closed once, from the choice) with no ring;
//   - geometry: each piece where it sits once matched to the node's 3x export (card-relative);
//   - routing: "You call her" is the tel: link with this browser's code and opens the call
//     card; "She calls you" opens the outbound form — never swapped;
//   - attribution: the landing URL's utm_* and click id ride on both selection events;
//   - analytics: demo_opened once per open, each selection once;
//   - the dot (AFMBP-2695): "Available" drawn twice from the node's one drawing, the word cut
//     clear of the dot and never blinking, the dot alone blinking (900ms on, 100ms off, a 1s
//     loop, sampled by pausing the animation), and still under reduced motion;
//   - warming (AFMBP-2690): a page with a way in fetches the card's six drawings once it has
//     loaded and settled; the ad landing's card, which never shows this card, fetches none;
//   - accessibility: the drawings hidden from the accessibility tree, their words read (hidden
//     text) in the picture's order, "Meet Sierra." the one heading;
//     both ways in work from the keyboard, with a visible focus ring;
//   - keyboard focus (AFMBP-2097): the dialog takes focus as it opens and draws no ring of
//     its own; Tab reaches the close button, then "You call her", and goes round the dialog,
//     and Tab / Shift+Tab never leave it, on every screen at both sizes; focus moved behind it comes back; closing it from the keyboard
//     gives focus back to the button that opened it, and closing it with a tap or a click
//     moves no focus and leaves no ring (iOS Safari rings a button a script focuses after a
//     tap on the shade);
//   - responsive: phones 280-430, tablet 768, desktop 1024-1920: no horizontal overflow,
//     both buttons inside the viewport, every word inside the card (under 337px the card
//     scales down rather than clip); wherever a card zooms (all eight card screens, swapped
//     in turn), the iOS-only rule that turns iPad Safari's text autosizing off on it, and
//     nowhere else (AFMBP-2602).
// Run: node tools/demo-landing-check.mjs [siteRoot]
//      SHOTS=<dir> saves the choice at 402x753 @3x and 1920x1200 @1x (plus each phone size).
//      NC=<name> mutates the SERVED copy only; each must FAIL (see MUTATE). no_fix takes out
//      the whole AFMBP-2097 change.
// Nothing leaves the machine: Chrome resolves no host but 127.0.0.1, and every other request
// (Bolt's API, Meta, Google) is answered here.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';

// Absolute, so a served file's path ends in '/<file>' and a negative control applies even when
// the root is given as '.' (a relative root left every NC unapplied: a false "did NOT bite").
const ROOT = resolve(process.argv[2] ?? new URL('..', import.meta.url).pathname);
const NC = process.env.NC || '';
const SHOTS = process.env.SHOTS || '';
const ONLY = process.env.ONLY || ''; // 'sizes': only the size sweep (to compare with another root)
const PORT = 20000 + Math.floor(Math.random() * 10000), DBG = 30000 + Math.floor(Math.random() * 10000);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.webp': 'image/webp' };

const cut = (s, from, to) => { if (!s.includes(from)) throw new Error(`NC anchor missing: ${from}`); return s.split(from).join(to); };
const MUTATE = {
  // The two ways in swap places.
  swap_ctas: ['demo.js', (s) => cut(cut(cut(s, "'demo-btn demo-choice__btn demo-choice__call'", 'TMP_CALL'), "'demo-btn demo-choice__btn demo-choice__get'", "'demo-btn demo-choice__btn demo-choice__call'"), 'TMP_CALL', "'demo-btn demo-choice__btn demo-choice__get'")],
  // AFMBP-2600: a computer's card at its design size (not scaled up).
  desktop_small: ['demo.js', (s) => cut(s, "backdrop.style.setProperty('--demo-zoom', String(Math.round(z * 1000) / 1000));", "backdrop.style.setProperty('--demo-zoom', '1');")],
  // AFMBP-2600: a computer keeps the phone frame's offsets (the card off centre).
  desktop_offset: ['demo.css', (s) => cut(s, '[data-screen="recap"],[data-screen="fail"]){--demo-dx:0px;--demo-dy:0px}', '[data-screen="recap"],[data-screen="fail"]){}')],
  // "Get a call" is counted twice.
  double_select: ['demo.js', (s) => cut(s, "      track('demo_mode_selected', { mode: 'outbound' });\n", "      track('demo_mode_selected', { mode: 'outbound' });\n      track('demo_mode_selected', { mode: 'outbound' });\n")],
  // The landing touch is dropped from every event.
  no_attr: ['attribution.js', (s) => cut(s, 'if (touch) data.attr = touch;', '')],
  // "You call her" moves off the node.
  off_node: ['demo.css', (s) => cut(s, '.demo-choice__call{left:70.812px;top:263.312px;', '.demo-choice__call{left:70.812px;top:268.312px;')],
  // AFMBP-2189: the phone choice hides its close button again (as before the redraw).
  no_close: ['demo.css', (s) => cut(s, '.demo-backdrop[data-screen="choice"] .demo-close{left:calc((100% - var(--demo-w)) / 2 + 301.496px);top:5.497px}', '.demo-backdrop[data-screen="choice"] .demo-close{display:none}')],
  // The close button sits under the body, which takes the tap.
  close_under: ['demo.css', (s) => cut(s, '    z-index:2;left:calc((100% - var(--demo-w)) / 2 + 288.496px);top:1.497px;right:auto;', '    left:calc((100% - var(--demo-w)) / 2 + 288.496px);top:1.497px;right:auto;')],
  // The close button moves off the node.
  close_off: ['demo.css', (s) => cut(s, '+ 301.496px);top:5.497px}', '+ 291.496px);top:5.497px}')],
  // AFMBP-2695: the card at its size before the owner's 11-24 update (the 11-22 card, 306x428).
  old_card: ['demo.css', (s) => cut(cut(s, '.demo-backdrop[data-screen="choice"]{--demo-w:351.042px;--demo-h:491px;', '.demo-backdrop[data-screen="choice"]{--demo-w:306px;--demo-h:428px;'), '.demo-backdrop[data-screen="choice"] .demo-card{height:491px;', '.demo-backdrop[data-screen="choice"] .demo-card{height:428px;')],
  // AFMBP-2690: the old card's heading back in place of "Meet Sierra.".
  old_heading: ['demo.js', (s) => cut(s, "h('h2', { class: 'demo-c__vh', text: 'Meet Sierra.' })", "h('h2', { class: 'demo-c__vh', text: 'How would you like to start the call?' })")],
  // AFMBP-2690: Sierra faded twice (her export already carries the node's 8%).
  double_fade: ['demo.css', (s) => cut(s, 'width:251.236px;height:262.708px;pointer-events:none;', 'width:251.236px;height:262.708px;opacity:.08;pointer-events:none;')],
  // AFMBP-2690: Sierra left out.
  no_art: ['demo.css', (s) => cut(s, "background:url('assets/demo-c-sierra-v4.png') 0 0/100% 100% no-repeat;", '')],
  // AFMBP-2690: the words drawn from the wrong file (the review's).
  wrong_words: ['demo.css', (s) => cut(s, "background:url('assets/demo-c-words-v4.svg') 0 0/100% 100% no-repeat;", "background:url('assets/demo-c-review-v4.svg') 0 0/100% 100% no-repeat;")],
  // AFMBP-2690: the words off the node.
  words_off: ['demo.css', (s) => cut(s, 'position:absolute;left:53px;top:101.318px;', 'position:absolute;left:53px;top:106.318px;')],
  // AFMBP-2695: Sierra drawn from the 11-22 file (her old size, in the new box).
  old_drawings: ['demo.css', (s) => cut(s, "background:url('assets/demo-c-sierra-v4.png')", "background:url('assets/demo-c-sierra.png')")],
  // AFMBP-2695: "Available now" read out again (the 11-24 node says "Available").
  old_live: ['demo.js', (s) => cut(s, "h('span', { class: 'demo-c__vh', text: 'Available' })", "h('span', { class: 'demo-c__vh', text: 'Available now' })")],
  // AFMBP-2695: the dot does not blink.
  no_blink: ['demo.css', (s) => cut(s, ';animation:demo-c-blink 1s step-end infinite}', '}')],
  // AFMBP-2695: the dot blinks at half the speed (off for 200ms every 2s).
  slow_blink: ['demo.css', (s) => cut(s, 'animation:demo-c-blink 1s step-end infinite', 'animation:demo-c-blink 2s step-end infinite')],
  // AFMBP-2695: the word's copy keeps the dot (not cut clear of it): the dot never goes off.
  blink_word: ['demo.css', (s) => cut(s, '.demo-c__live::before{clip-path:inset(0 0 0 9.8px)}', '.demo-c__live::before{}')],
  // AFMBP-2695: the dot blinks for someone who asked for reduced motion.
  blink_reduced: ['demo.css', (s) => cut(s, '  @media (prefers-reduced-motion:reduce){\n    .demo-backdrop[data-screen="choice"] .demo-c__live::after{animation:none}\n  }\n', '')],
  // AFMBP-2690: the review not turned as the node turns it.
  flat_review: ['demo.css', (s) => cut(s, 'transform:rotate(-1deg);pointer-events:none}', 'pointer-events:none}')],
  // AFMBP-2690: "You call her" drawn twice (its words shown, not hidden text).
  shown_label: ['demo.js', (s) => cut(s, "h('span', { class: 'demo-c__vh', text: 'You call her' })", "h('span', { text: 'You call her' })")],
  // AFMBP-2690: the pitch's words dropped (screen readers would hear only the heading).
  no_sr_pitch: ['demo.js', (s) => cut(s, "        h('p', { class: 'demo-c__vh', text: 'She takes your phone calls and more for less than $4 a day. (...without complaining) Cancel anytime.' })\n", '')],
  // AFMBP-2690: the help line back on the first card.
  help_back: ['demo.js', (s) => cut(s, "      ])\n    ], 'choice');", "      ]),\n      helpLine()\n    ], 'choice');")],
  // AFMBP-2690: the drawings fetched only when the demo opens (no warm-up once the page has loaded).
  no_warm: ['demo.js', (s) => cut(s, '    if (openers) warmChoiceLater();\n', '')],
  // AFMBP-2690: the warm-up on every page with the demo, the ad landing too.
  warm_everywhere: ['demo.js', (s) => cut(s, '    if (openers) warmChoiceLater();\n', '    warmChoiceLater();\n')],
  // A narrow phone clips the pitch instead of scaling the card down.
  no_zoom: ['demo.css', (s) => cut(s, '.demo-card{zoom:.94;left:0}', '.demo-card{left:0}')],
  // AFMBP-2695: the 351px card scales with the 337px cards (it clips on phones under 360px).
  choice_clips: ['demo.css', (s) => cut(s, '  @media (max-width:359px){ .demo-backdrop[data-screen="choice"] .demo-card{zoom:.94;left:0} }\n  @media (max-width:336px){ .demo-backdrop[data-screen="choice"] .demo-card{zoom:.88} }\n', '')],
  // AFMBP-2695: the close button's 44px tap target scaled to 34px on a 280px cover screen.
  small_close: ['demo.css', (s) => cut(s, '.demo-close{left:calc((100% - var(--demo-w)) / 2 + 299.496px);top:3.497px;width:48px;height:48px}', '.demo-close{}')],
  // AFMBP-2602: iPad Safari's text autosizing left on in the zoomed cards, set to 100% (which does
  // not fix it), or let out to cards that do not zoom.
  ios_autosize: ['demo.css', (s) => cut(s, '[data-screen="fail"]) .demo-card{-webkit-text-size-adjust:none;text-size-adjust:none}', '[data-screen="fail"]) .demo-card{}')],
  ios_tsa_100: ['demo.css', (s) => cut(s, '[data-screen="fail"]) .demo-card{-webkit-text-size-adjust:none;text-size-adjust:none}', '[data-screen="fail"]) .demo-card{-webkit-text-size-adjust:100%;text-size-adjust:100%}')],
  ios_tsa_wide: ['demo.css', (s) => cut(s, '@supports (-webkit-touch-callout:none){\n    @media (max-width:336px){', '@supports (-webkit-touch-callout:none){\n    @media (max-width:768px){')],
  // AFMBP-2097, one piece at a time, then all of it.
  // Opening the demo leaves keyboard focus where it was.
  no_focus_in: ['demo.js', (s) => cut(s, '    focusDialog();\n    // A reload in the middle', '    // A reload in the middle')],
  // Tab is not kept in the dialog.
  no_trap: ['demo.js', (s) => cut(s, "    document.addEventListener('keydown', keepTab, true);\n", '')],
  // Focus that lands behind the dialog stays there.
  no_guard: ['demo.js', (s) => cut(s, "    document.addEventListener('focusin', keepFocus, true);\n", '')],
  // Closing from the keyboard leaves focus where it was.
  no_restore: ['demo.js', (s) => cut(s, "    returnFocus(!!e && (e.type === 'keydown' || e.detail === 0));\n", '')],
  // A tap or a click on the shade also moves focus back to the button (iOS Safari rings it).
  pointer_restore: ['demo.js', (s) => cut(s, 'if (fromKeys && el && ', 'if (el && ')],
  // The dialog draws the browser's ring when it takes focus.
  card_ring: ['demo.css', (s) => cut(s, '.demo-card:focus{outline:none}\n', '')],
};
const UNFIX = [(s) => cut(s, ", tabindex: '-1' }, [close, logo, body]);", ' }, [close, logo, body]);'), (s) => cut(s, "openModal('button', null, b);", "openModal('button');")];
MUTATE.no_fix = [['demo.js', (s) => [...['no_focus_in', 'no_trap', 'no_guard', 'no_restore'].map((k) => MUTATE[k][1]), ...UNFIX].reduce((t, f) => f(t), s)], MUTATE.card_ring];
if (NC && !MUTATE[NC]) throw new Error(`unknown NC "${NC}"; one of ${Object.keys(MUTATE).join(', ')}`);
// [file, mutate] or a list of them. A missing anchor fails here, before anything runs: thrown
// while serving, it would 404 the file and fake a red run.
const MUTS = !NC ? [] : Array.isArray(MUTATE[NC][0]) ? MUTATE[NC] : [MUTATE[NC]];
for (const [file, fn] of MUTS) {
  const s = readFileSync(join(ROOT, file), 'utf8');
  if (fn(s) === s) throw new Error(`NC ${NC} leaves ${file} unchanged`);
}

// AFMBP-2690: a page that loads the demo (its sources, so a negative control reaches it) and offers
// no way into it, for the warm-up check. The /start/ pages load the minified copies instead.
const NO_OPENER = '<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/demo.css"></head>' +
  '<body><p>No way into the demo here.</p><script src="/demo-format.js"></script><script src="/demo.js"></script></body></html>';
const srv = createServer((req, res) => {
  try {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
    if (p === '/__no-opener.html') { res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); res.end(NO_OPENER); return; }
    let f = join(ROOT, p);
    if (statSync(f).isDirectory()) f = join(f, 'index.html');
    let body = readFileSync(f);
    for (const [file, fn] of MUTS) if (f.endsWith('/' + file)) body = Buffer.from(fn(body.toString('utf8')));
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(PORT, '127.0.0.1');

// ---- the fake Bolt API ----
const api = { created: 0, events: [] };
const reset = () => { api.created = 0; api.events = []; };
function apiRespond(method, url, postData) {
  const p = new URL(url).pathname;
  if (method === 'POST' && p === '/api/demo/inbound/session') {
    const id = `00000000-0000-4000-8000-${String(++api.created).padStart(12, '0')}`;
    return [200, { sessionId: id, code: '4321', number: '+18554973151', numberDisplay: '(855) 497-3151', telUri: 'tel:+18554973151,,4321', expiresAt: new Date(Date.now() + 600000).toISOString() }];
  }
  if (/^\/api\/demo\/inbound\/session\//.test(p)) return [200, { state: 'waiting', callId: null }];
  if (p === '/api/public/analytics/events') {
    try { for (const e of JSON.parse(postData || '{}').events || []) api.events.push({ type: e.event_type, data: e.event_data || {} }); } catch {}
    return [200, { ok: true }];
  }
  return [200, {}];
}
const evs = (type, pred = () => true) => api.events.filter((e) => e.type === type && pred(e.data));
const ATTR = (d) => !!d.attr && d.attr.utm_source === 'qa_src' && d.attr.utm_campaign === 'qa_camp' && d.attr.click_id_type === 'fbclid' && d.attr.click_id === 'qa_click' && d.attr.landing === '/hvac.html';

const PROFILE = mkdtempSync(join(tmpdir(), 'cdp-2090-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0, good = 0;
const ok = (c, m) => { if (c) good++; else { bad++; console.log(`  FAIL ${m}`); } };
// AFMBP-2602: the text-size-adjust of every iOS-only rule (inside @supports (-webkit-touch-callout:none))
// that reaches an element here, each @media evaluated against this window and each selector against
// the element. Chrome never applies those rules, so they are read from the style sheets.
const IOS_TSA = `function iosTsa(el){var hit=[];
  function walk(list, ios){for(var i=0;i<list.length;i++){var r=list[i];
    if(r instanceof CSSSupportsRule) walk(r.cssRules, ios||/-webkit-touch-callout\\s*:\\s*none/.test(r.conditionText));
    else if(r instanceof CSSMediaRule){if(matchMedia(r.media.mediaText).matches) walk(r.cssRules, ios);}
    else if(ios && r instanceof CSSStyleRule && el.matches(r.selectorText)) hit.push(r.style.getPropertyValue('text-size-adjust'));}}
  for(var s=0;s<document.styleSheets.length;s++){try{walk(document.styleSheets[s].cssRules,false);}catch(e){}}
  return hit;}`;
// The demo's card screens, each one's card zoom and iOS text rules in turn: the backdrop's
// data-screen swapped and put back in one go, so no frame ever shows a swapped screen.
const SCREENS = ['choice', 'inbound-call', 'inbound-fail', 'phone', 'code', 'calling', 'recap', 'fail'];
const SCREEN_TSA = `(function(){${IOS_TSA} var b=document.querySelector('.demo-backdrop.open'), k=b&&b.querySelector('.demo-card'), was=b&&b.getAttribute('data-screen'), out=[];
  if(!k) return null;
  ${JSON.stringify(SCREENS)}.forEach(function(n){b.setAttribute('data-screen',n); out.push({screen:n, zoom:parseFloat(getComputedStyle(k).zoom), ios:iosTsa(k)});});
  b.setAttribute('data-screen',was); return out;})()`;

// The phone node (Figma 2946:1666 as updated 2026-11-24, AFMBP-2695), card-relative CSS px, as the
// node's metadata gives them (its children sit inside its .688px stroke). Every piece is one of the
// node's own drawings.
const NODE = {
  card: { w: 351.042, h: 491, x: 25, y: 131 },
  call: { x: 71.5, y: 264, w: 209, h: 41 },
  get: { x: 71, y: 315, w: 210, h: 41 },
  // The close button: a 44px tap target centred on the node's 13px cross (317-330, 21-34).
  close: { x: 301.496, y: 5.497, w: 44, h: 44 },
  art: { x: 65.391, y: 16.061, w: 251.236, h: 262.708 },
  words: { x: 53.688, y: 102.006, w: 250.673, h: 129.07 },
  live: { x: 223.043, y: 244, w: 53.651, h: 8.16 },
  // The review's box (its drawing turns 1 degree inside it): the turned group's bounds.
  review: { x: 64.244, y: 382.484, w: 222.6, h: 84.295 },
};
// Each piece's drawing (the node's export); the review's is its bubble's ::before, the dot's and
// the word's are the "Available" box's ::after and ::before.
const ART = { '.demo-c__art': 'demo-c-sierra-v4.png', '.demo-c__words': 'demo-c-words-v4.svg', '.demo-choice__call': 'demo-c-call.svg', '.demo-choice__get': 'demo-c-get.svg' };
const CHOICE_ART = ['demo-c-sierra-v4.png', 'demo-c-words-v4.svg', 'demo-c-live-v4.svg', 'demo-c-call.svg', 'demo-c-get.svg', 'demo-c-review-v4.svg'];

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
    const [code, body] = /bolt-staging\.fly\.dev$/.test(new URL(request.url).hostname) ? apiRespond(request.method, request.url, request.postData) : [200, {}];
    return quiet(send('Fetch.fulfillRequest', { requestId, responseCode: code, responseHeaders: [...CORS, { name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') }));
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('DOM.enable'); await send('Accessibility.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  // QA visit (no Meta / Google); a tel: link the page leaves alone is recorded, then held
  // (headless Chrome stalls on handing it to the OS).
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: "try{localStorage.setItem('bolt_qa','1')}catch(e){}" +
      "window.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a');window.__clicks=(window.__clicks||[]).concat([{href:a?a.getAttribute('href'):null,followed:!e.defaultPrevented}]);if(a&&/^tel:/.test(a.getAttribute('href')||''))e.preventDefault();});",
  });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result ? r.result.value : null; };
  const load = async (path) => {
    await ev('try{sessionStorage.clear();localStorage.removeItem("bolt_attr")}catch(e){}');
    await ev('window.__old = 1');
    await send('Page.navigate', { url: ORIGIN + path });
    for (let i = 0; i < 100; i++) { if ((await ev(`!window.__old && document.readyState === 'complete' && location.pathname + location.search === ${JSON.stringify(path)}`)) === true) break; await sleep(100); }
    await ev('document.fonts && document.fonts.ready.then(function(){return 1})');
    await sleep(700);
  };
  const screen = () => ev("(document.querySelector('.demo-backdrop.open')||{getAttribute:function(){return null}}).getAttribute('data-screen')");
  const waitScreen = async (want, ms = 6000) => { for (let i = 0; i < ms / 100; i++) { if ((await screen()) === want) return true; await sleep(100); } return false; };
  const rect = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; var r=e.getBoundingClientRect(); return {x:r.left,y:r.top,w:r.width,h:r.height,cx:r.left+r.width/2,cy:r.top+r.height/2};})()`);
  // The box of the element's text itself (its glyph run), not its CSS box.
  // Text nodes only (element boxes are not glyphs); lines = runs whose tops sit within 6px.
  const run = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; var w=document.createTreeWalker(e,NodeFilter.SHOW_TEXT), n, rs=[]; while((n=w.nextNode())){ if(!n.textContent.trim()) continue; var g=document.createRange(); g.selectNodeContents(n); [].slice.call(g.getClientRects()).forEach(function(r){ if(r.width>0) rs.push(r); }); } if(!rs.length) return null; var x0=Math.min.apply(0,rs.map(function(r){return r.left})),x1=Math.max.apply(0,rs.map(function(r){return r.right})),y0=Math.min.apply(0,rs.map(function(r){return r.top})),y1=Math.max.apply(0,rs.map(function(r){return r.bottom})); var tops=rs.map(function(r){return r.top}).sort(function(a,b){return a-b}), lines=1; for(var i=1;i<tops.length;i++) if(tops[i]-tops[i-1]>6) lines++; return {x:x0,y:y0,w:x1-x0,h:y1-y0,cx:(x0+x1)/2,cy:(y0+y1)/2,lines:lines};})()`);
  const visible = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; var s=getComputedStyle(e); var r=e.getBoundingClientRect(); return s.display!=='none' && s.visibility!=='hidden' && r.width>0 && r.height>0;})()`);
  const text = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); return e ? e.innerText.replace(/\\s+/g,' ').trim() : null;})()`);
  let touch = false;
  const tapAt = async (x, y) => {
    if (touch) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    }
    await sleep(300);
  };
  const tap = async (sel) => {
    const b = await rect(sel);
    if (!b) return false;
    await tapAt(b.cx, b.cy);
    return true;
  };
  const key = async (k, code, vk) => {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk });
    if (k === 'Enter') await send('Input.dispatchKeyEvent', { type: 'char', text: '\r', key: k, code, windowsVirtualKeyCode: vk });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
    await sleep(150);
  };
  const lastClick = () => ev('(window.__clicks||[]).slice(-1)[0]||null');
  // Where keyboard focus is (AFMBP-2097): on the dialog itself, on one of its controls, or
  // outside it ('closed' when no dialog is open); which control (its place among the
  // dialog's showing, enabled controls); and whether a ring shows there.
  const FOCUS = `(function(){var a=document.activeElement, k=document.querySelector('.demo-backdrop.open .demo-card'), s=a?getComputedStyle(a):null;
    var ctl=k?[].slice.call(k.querySelectorAll('a[href],button,input')).filter(function(e){return !e.disabled && e.getClientRects().length && getComputedStyle(e).visibility!=='hidden'}):[];
    return {on: !k ? 'closed' : a===k ? 'dialog' : k.contains(a) ? 'inside' : 'outside', idx: ctl.indexOf(a), n: ctl.length,
      call: !!a && a.classList.contains('demo-choice__call'), get: !!a && a.classList.contains('demo-choice__get'),
      desc: a ? a.tagName.toLowerCase()+(a.className?'.'+String(a.className).trim().split(/\\s+/)[0]:'')+' '+JSON.stringify((a.innerText||a.getAttribute('aria-label')||'').replace(/\\s+/g,' ').trim().slice(0,22)) : 'none',
      fv: !!a && a.matches(':focus-visible'), outline: s ? s.outlineStyle : 'none',
      ring: !!s && ((s.outlineStyle!=='none' && parseFloat(s.outlineWidth)>0) || s.boxShadow!=='none')};})()`;
  // One Tab press (Shift+Tab with back), then where focus went.
  const tab = async (back = false) => {
    for (const type of ['rawKeyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: back ? 8 : 0 });
    await sleep(40);
    return ev(FOCUS);
  };
  const tabs = async (n, back = false) => { const r = []; for (let i = 0; i < n; i++) r.push(await tab(back)); return r; };
  const outside = (fs) => fs.filter((f) => f.on !== 'inside' && f.on !== 'dialog').map((f) => `${f.on} ${f.desc}`).join(', ');
  // The page's own "Talk to your new assistant" button showing at this size.
  const OPENER = "[].slice.call(document.querySelectorAll('a.btn--blue, button.btn--blue, [data-demo-open]')).filter(function(x){return (x.hasAttribute('data-demo-open') || /talk to your new assistant/i.test(x.textContent)) && x.getBoundingClientRect().width > 0})[0]";
  const openerState = () => ev(`(function(){var o=${OPENER}; return {back: document.activeElement === o, fv: o.matches(':focus-visible')};})()`);
  const view = async (w, h, dpr, mobile) => {
    touch = mobile;
    await send('Emulation.setTouchEmulationEnabled', mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile });
  };
  const shot = async (name) => {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    await sleep(400);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(r.data, 'base64'));
  };
  const axIgnored = async (sel) => {
    const { root } = await send('DOM.getDocument', { depth: -1 });
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
    if (!nodeId) return null;
    const { nodes } = await send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
    return nodes.length ? !!nodes[0].ignored : null;
  };
  const SUPERSEDED = ['Call now', 'Call us or we', 'assistant now', 'ways to', 'Make a call', 'Get a call', 'Professional and helpful', 'Average time to connect', 'will call you right now',
    'Answering one call', 'Dollars in your pocket', 'Talk with a real assistant', 'Smart & very professional', 'Bolt books customers', 'keep on working',
    // AFMBP-2596: the pitch and quote before the 11-12 update.
    'One phone call', 'real money', 'Bolt answers calls', 'Easy to use',
    // AFMBP-2597: the quote before the 11-13 update.
    'real person',
    // AFMBP-2690: the card before the owner's 11-22 redesign, and the redesign's first two pitches.
    'How would you like', 'You call us', 'We call you', 'Avg. wait', '3 seconds', 'Gus C.', 'Massachusetts', 'Sounds like a real receptionist', 'Need help', 'manages your phone calls', 'leads, and calendar',
    // AFMBP-2695: the 11-22 card's "Available now".
    'Available now'];
  const HEADING = 'Meet Sierra.';
  const PITCH = 'She takes your phone calls and more for less than $4 a day. (...without complaining) Cancel anytime.';

  // ================= phone, the node's own size =================
  if (ONLY !== 'sizes') {
  await view(402, 753, 3, true);
  console.log('[phone 402x753] content, art, geometry, routing, attribution, analytics, accessibility');
  reset();
  await load('/hvac.html?talk=1&utm_source=qa_src&utm_campaign=qa_camp&fbclid=qa_click');
  ok(await waitScreen('choice'), 'phone: ?talk=1 opens on the choice');
  await sleep(400);
  await shot('choice-402x753@3x');
  if (SHOTS) writeFileSync(join(SHOTS, 'card-402x753.json'), JSON.stringify(await rect('.demo-backdrop.open .demo-card')));
  // content: every word is the node's drawing; screen readers get the same words as hidden text
  ok((await text('.demo-c__words h2')) === HEADING, `phone: the heading "Meet Sierra." (${await text('.demo-c__words h2')})`);
  ok((await text('.demo-c__words p')) === PITCH, `phone: the pitch, word for word (${await text('.demo-c__words p')})`);
  ok((await text('.demo-c__live')) === 'Available', `phone: "Available" (${await text('.demo-c__live')})`);
  ok((await text('.demo-choice__call')) === 'You call her', `phone: "You call her" (${await text('.demo-choice__call')})`);
  ok((await text('.demo-choice__get')) === 'She calls you', `phone: "She calls you" (${await text('.demo-choice__get')})`);
  const rv = await ev("[].slice.call(document.querySelectorAll('.demo-c__review p')).map(function(p){return p.textContent})");
  ok(JSON.stringify(rv) === JSON.stringify(['Brent B., Indiana', '4.9/5', '“Bolt booked a job and paid for itself in a day.”']), `phone: the review's words: reviewer, rating, quote (${JSON.stringify(rv)})`);
  ok(!(await ev("!!document.querySelector('.demo-backdrop.open .demo-help')")) && !(await ev("!!document.querySelector('.demo-backdrop.open .demo-choice__when')")), 'phone: no help line and no wait line (the 11-22 node dropped both)');
  const modalText = await ev("document.querySelector('.demo-backdrop.open .demo-card').innerText");
  ok(SUPERSEDED.every((s) => !modalText.includes(s)), `phone: none of the superseded copy (${SUPERSEDED.filter((s) => modalText.includes(s)).join(', ')})`);
  ok(!(await visible('.demo-choice__sub')) && !(await visible('.demo-choice__h')), 'phone: no desktop title or subtitle');
  // Every run of words is hidden text: 1px and clipped (the drawings draw it), yet read.
  const vh = await ev("[].slice.call(document.querySelectorAll('.demo-backdrop.open .demo-card .demo-c__vh')).map(function(e){var r=e.getBoundingClientRect(), c=getComputedStyle(e); return r.width<=1 && r.height<=1 && c.clipPath==='inset(50%)' && c.overflow==='hidden';})");
  ok(Array.isArray(vh) && vh.length === 8 && vh.every(Boolean), `phone: the card's 8 runs of words are hidden text, 1px and clipped (${JSON.stringify(vh)})`);
  ok((await ev("[].slice.call(document.querySelectorAll('.demo-backdrop.open .demo-choice__btn')).every(function(b){return [].slice.call(b.childNodes).every(function(n){return n.nodeType===1 && n.classList.contains('demo-c__vh')})})")) === true, 'phone: the buttons hold only hidden labels (the drawings carry the words)');
  // art: the node's own drawings, each on its piece
  for (const [sel, file] of Object.entries(ART)) {
    const bg = await ev(`getComputedStyle(document.querySelector(${JSON.stringify(sel)})).backgroundImage`);
    ok((bg || '').includes(file), `phone: ${sel} drawn with the node's ${file} (${bg})`);
  }
  ok(/demo-c-review-v4\.svg/.test(await ev("getComputedStyle(document.querySelector('.demo-c__bubble'),'::before').backgroundImage")), "phone: the review drawn with the node's demo-c-review-v4.svg");
  // AFMBP-2695: "Available" and its dot, the node's one drawing twice: the word cut clear of the dot
  // (the dot ends 7.93px in, the word starts 11.71px in), the dot alone, blinking.
  const dot = (await ev("(function(){var e=document.querySelector('.demo-c__live'), b=getComputedStyle(e,'::before'), a=getComputedStyle(e,'::after'); return {bImg:b.backgroundImage, aImg:a.backgroundImage, bClip:b.clipPath, aClip:a.clipPath, bAnim:b.animationName, aAnim:a.animationName, aDur:a.animationDuration, aIter:a.animationIterationCount, aEase:a.animationTimingFunction, own:getComputedStyle(e).backgroundImage};})()")) || {};
  ok(/demo-c-live-v4\.svg/.test(dot.bImg) && /demo-c-live-v4\.svg/.test(dot.aImg) && dot.own === 'none', `phone: "Available" and its dot drawn from the node's demo-c-live-v4.svg, twice (${JSON.stringify(dot)})`);
  ok(dot.bClip === 'inset(0px 0px 0px 9.8px)' && dot.aClip === 'inset(0px calc(100% - 9.8px) 0px 0px)', `phone: the word cut clear of the dot, the dot alone in its own copy (${dot.bClip} / ${dot.aClip})`);
  ok(dot.bAnim === 'none' && dot.aAnim === 'demo-c-blink' && dot.aDur === '1s' && dot.aIter === 'infinite' && /^(step-end|steps\(1(, end)?\))$/.test(dot.aEase), `phone: only the dot blinks, on a 1s loop, switching (no fade) (${JSON.stringify(dot)})`);
  // Sample the loop: pause the dot's animation and read its opacity through one second.
  const blink = await ev("(function(){var a=document.getAnimations().filter(function(x){return x.animationName==='demo-c-blink'}); if(a.length!==1) return 'animations: '+a.length; a=a[0]; a.pause(); var e=document.querySelector('.demo-c__live'), out=[0,450,890,899,900,950,999].map(function(t){a.currentTime=t; return getComputedStyle(e,'::after').opacity+'@'+t;}); a.play(); return out.join(' ');})()");
  ok(blink === '1@0 1@450 1@890 1@899 0@900 0@950 0@999', `phone: the dot on for 900ms, off for 100ms, every second (owner: "blink w/ 100ms speed") (${blink})`);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const still = await ev("(function(){var e=document.querySelector('.demo-c__live'), a=getComputedStyle(e,'::after'); return a.animationName+' '+a.opacity+' '+document.getAnimations().filter(function(x){return x.animationName==='demo-c-blink'}).length;})()");
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  ok(still === 'none 1 0', `phone: with reduced motion asked for, the dot stays on, still (${still})`);
  // Sierra's export already carries the node's 8% (her ink is black at alpha 20): no second fade.
  ok((await ev("getComputedStyle(document.querySelector('.demo-c__art')).opacity")) === '1', `phone: Sierra at the export's own 8%, not faded again (opacity ${await ev("getComputedStyle(document.querySelector('.demo-c__art')).opacity")})`);
  const turn = await ev("getComputedStyle(document.querySelector('.demo-c__bubble')).transform");
  ok(turn === 'matrix(0.999848, -0.0174524, 0.0174524, 0.999848, 0, 0)', `phone: the review turned 1 degree, as the node turns it (${turn})`);
  ok((await ev("getComputedStyle(document.querySelector('.demo-backdrop.open .demo-card')).backgroundColor")) === 'rgb(248, 251, 254)', "phone: the card in the node's #f8fbfe");
  ok((await visible('.demo-close')) && /demo-m-close\.svg/.test(await ev("getComputedStyle(document.querySelector('.demo-close'),'::before').backgroundImage")) && (await ev("getComputedStyle(document.querySelector('.demo-close svg')).display")) === 'none', "phone: the close button shows, drawn with the node's own cross");
  ok((await ev("getComputedStyle(document.querySelector('.demo-backdrop.open .demo-body'),'::before').content")) === 'none', 'phone: no paintbrush watermark');
  // geometry, card-relative
  const card = await rect('.demo-backdrop.open .demo-card');
  const rel = (b) => b && { x: b.x - card.x, y: b.y - card.y, w: b.w, h: b.h, cx: b.cx - card.x, cy: b.cy - card.y };
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  // Chrome lays out in 64ths of a pixel: the 351.042px card is 351.03 wide, its left edge 25.016.
  ok(near(card.w, NODE.card.w, 0.016) && near(card.h, NODE.card.h, 0.016), `phone: card 351x491 (${card.w}x${card.h})`);
  ok(near(card.x, NODE.card.x, 0.016) && near(card.y, NODE.card.y, 0.016), `phone: card where the node puts it, centred: 25px in, 131px down a 402x753 screen (${card.x}, ${card.y})`);
  const PIECES = { call: '.demo-choice__call', get: '.demo-choice__get', close: '.demo-close', art: '.demo-c__art', words: '.demo-c__words', live: '.demo-c__live', review: '.demo-c__review' };
  for (const [k, sel] of Object.entries(PIECES)) {
    const b = rel(await rect(sel)), n = NODE[k];
    ok(!!b && near(b.x, n.x, 0.05) && near(b.y, n.y, 0.05) && near(b.w, n.w, 0.05) && near(b.h, n.h, 0.05), `phone: ${k} where the node puts it (${JSON.stringify(b)} vs ${JSON.stringify(n)})`);
  }
  // The close button is on top at its own centre: the body (above the card's other children)
  // would otherwise take the tap.
  ok((await ev("(function(){var b=document.querySelector('.demo-close'), r=b.getBoundingClientRect(); return document.elementFromPoint(r.left+r.width/2, r.top+r.height/2) === b;})()")) === true, 'phone: the close button takes a tap at its centre (nothing on top of it)');
  // Both ways in take a tap at their centre (Sierra, drawn over the top of "You call her", takes none).
  ok((await ev("['.demo-choice__call','.demo-choice__get'].every(function(q){var b=document.querySelector(q), r=b.getBoundingClientRect(); return [[.5,.5],[.5,.12],[.1,.5],[.9,.5]].every(function(p){var e=document.elementFromPoint(r.left+r.width*p[0], r.top+r.height*p[1]); return e===b || b.contains(e);});})")) === true, 'phone: both ways in take a tap anywhere on them');
  // reading order follows the picture: heading, pitch, availability, the two ways in, the review
  const order = ['.demo-c__words h2', '.demo-c__words p', '.demo-c__live', '.demo-choice__call', '.demo-choice__get', '.demo-c__review'];
  ok((await ev(`(function(){var s=${JSON.stringify(order)}.map(function(q){return document.querySelector(q)}); for(var i=1;i<s.length;i++){ if(!(s[i-1].compareDocumentPosition(s[i]) & Node.DOCUMENT_POSITION_FOLLOWING)) return false; } return true;})()`)) === true, 'a11y: reading order matches the picture');
  // The drawings themselves are hidden from screen readers; their words are read.
  ok((await ev("['.demo-c__art','.demo-c__bubble'].every(function(q){var s=document.querySelector(q); return !!s && s.getAttribute('aria-hidden')==='true' && s.textContent===''})")) === true, "a11y: Sierra and the review's drawing are hidden from screen readers (aria-hidden, no words)");
  ok((await axIgnored('.demo-c__words h2')) === false && (await axIgnored('.demo-c__words p')) === false && (await axIgnored('.demo-c__live')) === false && (await axIgnored('.demo-c__review p')) === false, 'a11y: the heading, pitch, availability and review are read');
  ok((await ev("[].slice.call(document.querySelectorAll('.demo-backdrop.open h2')).filter(function(e){return e.getClientRects().length}).map(function(e){return e.textContent}).join('|')")) === HEADING, 'a11y: "Meet Sierra." is the one heading on the card');
  // routing: "You call her" is the call, with this browser's code
  ok(api.created === 1 && (await ev("document.querySelector('.demo-choice__call').getAttribute('href')")) === 'tel:+18554973151,,4321', 'phone: "You call her" is the tel: link with the line, a pause and the code');
  await tap('.demo-choice__call');
  const c1 = await lastClick();
  ok(!!c1 && c1.href === 'tel:+18554973151,,4321' && c1.followed === true, `phone: the tap goes to the dialer (${JSON.stringify(c1)})`);
  ok(await waitScreen('inbound-call'), 'phone: "You call her" -> the call card');
  ok(evs('demo_opened').length === 1, `events: demo_opened once (${evs('demo_opened').length})`);
  ok(evs('demo_mode_selected', (d) => d.mode === 'inbound').length === 1 && evs('demo_mode_selected').length === 1, `events: one selection, inbound (${JSON.stringify(evs('demo_mode_selected').map((e) => e.data.mode))})`);
  ok(evs('demo_mode_selected', ATTR).length === 1 && evs('demo_opened', ATTR).length === 1, 'attribution: utm_source, utm_campaign and fbclid ride on the open and the selection');

  console.log('[phone] "She calls you" -> the outbound form');
  reset();
  await load('/hvac.html?talk=1&utm_source=qa_src&utm_campaign=qa_camp&fbclid=qa_click');
  ok(await waitScreen('choice'), 'phone: choice again');
  await tap('.demo-choice__get');
  ok(await waitScreen('phone'), 'phone: "She calls you" -> the outbound form');
  ok((await text('.demo-h--form')) === 'What number to call?', `phone: the redrawn form's heading (2657:1639, the owner's 11-24 title) (${await text('.demo-h--form')})`);
  ok(evs('demo_mode_selected', (d) => d.mode === 'outbound').length === 1 && evs('demo_mode_selected').length === 1, `events: one selection, outbound (${evs('demo_mode_selected').length})`);
  ok(evs('demo_mode_selected', ATTR).length === 1, 'attribution: the touch rides on the "She calls you" selection');

  console.log("[warm] the first card's drawings come down once a page with a way in has loaded and settled; the ad landing fetches none (AFMBP-2690)");
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'performance.setResourceTimingBufferSize(5000)' });
  const fetched = () => ev(`performance.getEntriesByType('resource').map(function(e){return e.name.split('/').pop().split('?')[0]}).filter(function(n){return ${JSON.stringify(CHOICE_ART)}.indexOf(n)>=0})`);
  reset();
  await load('/hvac.html');
  await sleep(2600);
  const warmed = await fetched();
  ok(CHOICE_ART.every((n) => warmed.includes(n)), `warm: /hvac.html fetches all six drawings, no tap needed (${JSON.stringify(warmed)})`);
  ok((await screen()) === null, 'warm: and the demo stays closed');
  reset();
  await load('/start/handyman.html?bolt_qa=1&bolt_xp=treatment');
  await sleep(2600);
  const cold = await fetched();
  ok((await ev('!!(window.boltDemo && window.boltDemo.ready)')) === true && cold.length === 0, `warm: the ad landing's card (the demo loaded, its card never shows this one) fetches none (${JSON.stringify(cold)})`);
  reset();
  await load('/__no-opener.html');
  await sleep(2600);
  const bare = await fetched();
  ok((await ev('!!(window.boltDemo && window.boltDemo.ready)')) === true && bare.length === 0, `warm: a page with the demo's sources but no way into it fetches none (${JSON.stringify(bare)})`);

  console.log('[phone] the close button (AFMBP-2189): a tap closes the demo, as the shade does');
  reset();
  await load('/hvac.html?talk=1');
  ok(await waitScreen('choice'), 'close: choice');
  const xb = await rect('.demo-close');
  await tapAt(xb.cx, xb.cy);
  ok((await screen()) === null, 'close: a tap on the close button closes the demo');
  ok(evs('demo_closed', (d) => d.step === 'choice').length === 1 && evs('demo_closed').length === 1, `close: demo_closed once, from the choice (${JSON.stringify(evs('demo_closed').map((e) => e.data.step))})`);
  const xr = await ev("(function(){var v=document.querySelector(':focus-visible'); return v ? v.tagName.toLowerCase()+'.'+String(v.className).split(' ')[0] : null;})()");
  ok(!xr, `close: after the tap no ring shows anywhere (${xr})`);

  console.log('[phone] keyboard (AFMBP-2097): focus starts in the dialog, Tab goes round it and never leaves');
  reset();
  await load('/hvac.html?talk=1');
  ok(await waitScreen('choice'), 'keyboard: choice');
  // An ad link opens the demo with no tap. Focus starts on the dialog itself, not on a
  // control: iOS Safari rings a control a script focuses as the page loads.
  const f0 = await ev(FOCUS);
  ok(f0.on === 'dialog', `keyboard: focus is on the dialog as it opens (${f0.on} ${f0.desc}; before AFMBP-2097 it stayed on the page, 33 Tab presses from the first way in)`);
  const fwd = await tabs(7);
  const toCall = fwd.findIndex((f) => f.call) + 1;
  console.log(`  note: Tab reaches "You call her" after ${toCall} press(es): ${fwd.map((f) => f.desc).join(' > ')}`);
  ok(toCall >= 1 && toCall <= 2, `keyboard: Tab reaches "You call her" within 2 presses of the dialog opening (${toCall})`);
  ok(!outside(fwd), `keyboard: Tab never leaves the dialog (${outside(fwd)})`);
  // AFMBP-2189: the close button, first in the card, is the first stop.
  const isClose = (f) => /^button\.demo-close /.test(f.desc);
  ok(isClose(fwd[0]) && fwd[1].call && fwd[2].get && isClose(fwd[3]), `keyboard: Tab goes the close button, "You call her", "She calls you", then round to the close button (${fwd.slice(0, 4).map((f) => f.desc).join(' > ')})`);
  const ring = { close: fwd[0].fv && fwd[0].ring, call: fwd[1].fv && fwd[1].ring, get: fwd[2].fv && fwd[2].ring };
  ok(ring.close && ring.call && ring.get, `keyboard: each shows a focus ring (${JSON.stringify(ring)})`);
  const bwd = await tabs(7, true);
  ok(!outside(bwd), `keyboard: Shift+Tab never leaves the dialog (${outside(bwd)})`);
  ok(bwd[0].get && bwd[1].call && isClose(bwd[2]) && bwd[3].get, `keyboard: Shift+Tab from the close button goes round to "She calls you", then "You call her", the close button and "She calls you" again (${bwd.slice(0, 4).map((f) => f.desc).join(' > ')})`);
  // Focus moved behind the dialog (a browser whose Tab skips some stops, a phone keyboard's
  // previous / next buttons, a script) comes straight back.
  const behind = await ev(`(function(){var b=[].slice.call(document.querySelectorAll('a[href],button,input')).filter(function(x){return !x.closest('.demo-backdrop') && x.getClientRects().length})[0]; b.focus(); return ${FOCUS};})()`);
  ok(behind.on === 'inside' || behind.on === 'dialog', `keyboard: focus moved behind the dialog comes back into it (${behind.on} ${behind.desc})`);
  // Enter on "She calls you", reached with Tab: the form, focus on its first field, Tab still in.
  for (let i = 0; i < 4 && !(await ev(FOCUS)).get; i++) await tab();
  await key('Enter', 'Enter', 13);
  ok(await waitScreen('phone'), 'keyboard: Enter on "She calls you" opens the form');
  await sleep(200);
  ok((await ev("document.activeElement === document.getElementById('demo-phone')")) === true, `keyboard: focus moves on to the phone field (${(await ev(FOCUS)).desc})`);
  const form = [...(await tabs(8)), ...(await tabs(8, true))];
  ok(!outside(form), `keyboard: on the form, Tab and Shift+Tab stay in the dialog (${outside(form)})`);
  reset();
  await load('/hvac.html?talk=1');
  ok(await waitScreen('choice'), 'keyboard: choice again');
  const k1 = await tab(), k2 = await tab();
  ok(isClose(k1) && k2.call, `keyboard: two Tabs, the close button then "You call her" (${k1.desc} > ${k2.desc})`);
  await key('Enter', 'Enter', 13);
  ok(await waitScreen('inbound-call'), 'keyboard: Enter on "You call her" starts the call');
  const callCard = [...(await tabs(3)), ...(await tabs(3, true))];
  ok(!outside(callCard), `keyboard: on the call card, focus stays in the dialog (${outside(callCard)})`);
  reset();
  await load('/hvac.html?talk=1');
  ok(await waitScreen('choice'), 'keyboard: choice, to close it');
  ok(isClose(await tab()), 'keyboard: one Tab, on the close button');
  await key('Enter', 'Enter', 13);
  ok((await screen()) === null && evs('demo_closed', (d) => d.step === 'choice').length === 1, `keyboard: Enter on the close button closes the demo, demo_closed once from the choice (${JSON.stringify(evs('demo_closed').map((e) => e.data.step))})`);

  // A point on the shade (outside the card, nothing else on top of it).
  const shade = () => ev("(function(){var b=document.querySelector('.demo-backdrop.open'), p=[[6,innerHeight-6],[6,innerHeight/2],[innerWidth-6,innerHeight-6],[innerWidth/2,innerHeight-6]]; for(var i=0;i<p.length;i++){ if(document.elementFromPoint(p[i][0],p[i][1])===b) return {x:p[i][0],y:p[i][1]}; } return null;})()");
  const openerAt = () => ev(`(function(){var o=${OPENER}; o.scrollIntoView({block:'center'}); var r=o.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2};})()`);
  for (const [w, h, dpr, mobile] of [[402, 753, 3, true], [1280, 800, 1, false]]) {
    const where = `${w}x${h}`;
    console.log(`[${where}] closing from the keyboard gives focus back to the button; a tap or a click moves none`);
    await view(w, h, dpr, mobile);
    reset();
    await load('/hvac.html');
    await openerAt();
    await ev(`(${OPENER}).focus(), 1`);
    await key('Enter', 'Enter', 13);
    ok(await waitScreen('choice'), `${where} restore: Enter on the page's "Talk to your new assistant" opens the demo`);
    // Opened from the keyboard, the dialog matches :focus-visible, where a browser draws its
    // ring. It must draw none; its controls keep theirs.
    const k1 = await ev(FOCUS);
    ok(k1.on === 'dialog' && k1.fv && k1.outline === 'none', `${where} restore: opened from the keyboard, focus is on the dialog and it draws no ring (${JSON.stringify({ on: k1.on, fv: k1.fv, outline: k1.outline })})`);
    if (!mobile) {
      // AFMBP-2600: a computer shows the phone card, so the close button comes first, as on a phone.
      const d1 = await tab(), d2 = await tab();
      ok(/^button\.demo-close /.test(d1.desc) && d2.call, `${where} keyboard: the first Tab is on the close button, the second on "You call her", the same link (${d1.desc} > ${d2.desc})`);
      const dk = [...(await tabs(6)), ...(await tabs(7, true))];
      ok(!outside(dk), `${where} keyboard: Tab and Shift+Tab never leave the dialog (${outside(dk)})`);
    }
    await key('Escape', 'Escape', 27);
    ok((await screen()) === null, `${where} restore: Escape closes the demo`);
    const r1 = await openerState();
    ok(r1.back && r1.fv, `${where} restore: Escape gives focus back to "Talk to your new assistant", ring showing (${JSON.stringify(r1)})`);
    // Then a tap (a click on desktop) opens it and a tap on the shade closes it: no focus
    // moves and no ring shows anywhere. iOS Safari rings a button a script focuses after a
    // tap on the shade; Chrome does too once the keyboard has been used, as it just was.
    const o = await openerAt();
    await tapAt(o.x, o.y);
    ok(await waitScreen('choice'), `${where} restore: a ${mobile ? 'tap' : 'click'} on "Talk to your new assistant" opens the demo`);
    const sp = await shade();
    if (sp) await tapAt(sp.x, sp.y);
    ok(!!sp && (await screen()) === null, `${where} restore: a ${mobile ? 'tap' : 'click'} on the shade closes it`);
    const r2 = await ev(`(function(){var o=${OPENER}, v=document.querySelector(':focus-visible'); return {back: document.activeElement === o, ring: v ? v.tagName.toLowerCase()+'.'+String(v.className).split(' ')[0] : null};})()`);
    ok(!r2.back && !r2.ring, `${where} restore: after the ${mobile ? 'tap' : 'click'}, no focus moves to the button and no ring shows (${JSON.stringify(r2)})`);
  }

  console.log('[keyboard] every screen, both sizes: Tab and Shift+Tab stay in the dialog and reach every control');
  const LONG = Array.from({ length: 14 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', content: `Line ${i} of a longer transcript, long enough to wrap in its bubble.` }));
  const SCREENS = [
    ['choice', '__demoQA.choice()'], ['form', '__demoQA.phone()'], ['limit', '__demoQA.limit()'], ['code', '__demoQA.code()'],
    ['code, locked', "__demoQA.code({ error: 'Too many tries. Request a new code.', locked: true })"], ['calling you', '__demoQA.inCall()'],
    ['recap', `__demoQA.recap({ status: 'completed', transcript: ${JSON.stringify(LONG)} })`], ['recap, no transcript yet', "__demoQA.recap({ status: 'completed', transcript: null })"],
    ['call failed', '__demoQA.fail()'], ['error', '__demoQA.error()'],
    ['call card', "__demoQA.inbound('4321', false)"], ['call card with the number', "__demoQA.inbound('4321', true)"], ['call card failed', '__demoQA.inboundFail()'],
  ];
  for (const [w, h, dpr, mobile] of [[402, 753, 3, true], [1280, 800, 1, false]]) {
    await view(w, h, dpr, mobile);
    reset();
    await load('/hvac.html?demoqa=1');
    await ev('__demoQA.open(); 1');
    await sleep(300);
    for (const [name, js] of SCREENS) {
      await ev(`${js}; 1`);
      await sleep(150);
      await ev("document.querySelector('.demo-backdrop.open .demo-card').focus(); 1");
      const n = (await ev(FOCUS)).n;
      const fs = [...(await tabs(n + 2)), ...(await tabs(n + 2, true))];
      const seen = new Set(fs.map((f) => f.idx).filter((x) => x >= 0));
      ok(!outside(fs), `${w}x${h} ${name}: Tab and Shift+Tab stay in the dialog (${outside(fs)})`);
      ok(seen.size === n, `${w}x${h} ${name}: Tab reaches every control (${seen.size} of ${n})`);
    }
  }

  }

  // ================= sizes =================
  const SIZES = [[280, 653, 2, true], [320, 568, 2, true], [360, 740, 3, true], [375, 667, 2, true], [390, 844, 3, true], [412, 915, 2.625, true], [430, 932, 3, true], [768, 1024, 2, true], [1024, 768, 1, false], [1280, 800, 1, false], [1920, 1200, 1, false]];
  for (const [w, h, dpr, mobile] of SIZES) {
    await view(w, h, dpr, mobile);
    reset();
    await load('/hvac.html');
    const pageOver = await ev('document.documentElement.scrollWidth - innerWidth');
    await load('/hvac.html?talk=1');
    ok(await waitScreen('choice'), `${w}x${h}: choice`);
    await sleep(300);
    const phoneLayout = w <= 768;
    if (phoneLayout && w !== 402) await shot(`choice-${w}x${h}`);
    const o = await ev("(function(){var b=document.querySelector('.demo-backdrop.open'); return {doc:document.documentElement.scrollWidth-innerWidth, bd:b.scrollWidth-b.clientWidth};})()");
    ok(o.doc <= Math.max(0, pageOver) && o.bd <= 0, `${w}x${h}: the demo adds no horizontal overflow (${JSON.stringify(o)}; the page alone ${pageOver})`);
    for (const sel of ['.demo-choice__call', '.demo-choice__get']) {
      const b = await rect(sel);
      ok(b && b.x >= 0 && b.y >= 0 && b.x + b.w <= w && b.y + b.h <= h, `${w}x${h}: ${sel} inside the viewport (${JSON.stringify(b)})`);
    }
    const c = await rect('.demo-backdrop.open .demo-card');
    if (phoneLayout) {
      ok(c.x >= 0 && c.x + c.w <= w, `${w}x${h}: the card inside the viewport (${c.x.toFixed(1)}..${(c.x + c.w).toFixed(1)})`);
      // Every drawing inside the card (under 360px the card scales down rather than clip).
      for (const sel of ['.demo-c__art', '.demo-c__words', '.demo-c__live', '.demo-choice__call', '.demo-choice__get', '.demo-c__review']) {
        const g = await rect(sel);
        ok(g && g.x >= c.x + 2 && g.x + g.w <= c.x + c.w - 2 && g.y >= c.y && g.y + g.h <= c.y + c.h, `${w}x${h}: ${sel} inside the card (${g && [g.x.toFixed(1), (g.x + g.w).toFixed(1), g.y.toFixed(1), (g.y + g.h).toFixed(1)]} in ${c.x.toFixed(1)}..${(c.x + c.w).toFixed(1)})`);
      }
      // The close button shows on the first paint at every phone size (the card never rises
      // above the top edge), inside the card, a usable tap target even where the card zooms.
      const x = await rect('.demo-close');
      ok(!!x && (await visible('.demo-close')) && x.x >= c.x && x.x + x.w <= c.x + c.w && x.y >= c.y && x.y >= 0 && x.y + x.h <= h && x.w >= 36 && x.h >= 36, `${w}x${h}: the close button inside the card and on screen, at least 36px (${x && [x.x.toFixed(1), x.y.toFixed(1), x.w.toFixed(1)]})`);
      // From 360px the card is the node's own size; under it the card scales down (zoom keeps
      // every piece in proportion instead of clipping the words at the card's edges). AFMBP-2695:
      // the 11-24 card is 351px, so it starts scaling at 359px, not with the others at 336px.
      ok(w >= 360 ? Math.abs(c.w - NODE.card.w) < 0.016 : c.w < NODE.card.w && c.w <= w - 4, `${w}x${h}: the card is ${w >= 360 ? "the node's 351px" : 'scaled down, whole, with 2px of shade either side'} (${c.w.toFixed(2)})`);
    } else {
      // AFMBP-2600: a computer shows the phone card, centred, at up to 125% of its design size
      // as far as the screen's height allows (16px of shade above and below), never smaller.
      const zWant = Math.max(1, Math.min(1.25, (h - 32) / NODE.card.h));
      ok(Math.abs(c.w - NODE.card.w * zWant) < 0.6 && Math.abs(c.h - NODE.card.h * zWant) < 0.6, `${w}x${h}: the phone card at ${(zWant * 100).toFixed(1)}% (${c.w.toFixed(2)}x${c.h.toFixed(2)})`);
      ok(Math.abs((c.x + c.w / 2) - w / 2) < 1 && c.y >= 0 && c.y + c.h <= h, `${w}x${h}: the card centred and on screen (${c.x.toFixed(1)},${c.y.toFixed(1)})`);
      ok((await text('.demo-c__words h2')) === HEADING && (await text('.demo-choice__call')) === 'You call her' && (await text('.demo-choice__get')) === 'She calls you' && (await visible('.demo-c__review')) && (await visible('.demo-close')), `${w}x${h}: the phone card: "Meet Sierra.", "You call her" / "She calls you", the review and the close button`);
      ok((await ev("!!document.querySelector('.demo-backdrop .demo-choice__h, .demo-backdrop .demo-choice__sub, .demo-backdrop .demo-d, .demo-backdrop .demo-db, .demo-backdrop .demo-m, .demo-backdrop .demo-mb')")) === false, `${w}x${h}: no second, computer-only design in the page`);
      if (w === 1920) await shot('d-choice-1920x1200');
    }
    // AFMBP-2602: wherever a card zooms, iPad Safari's text autosizing must be off on it, or every
    // word draws at its unzoomed size; nowhere else does the iOS rule reach a card.
    const zs = (await ev(SCREEN_TSA)) || [];
    ok(zs.length === SCREENS.length, `${w}x${h}: every card screen measured (${zs.length} of ${SCREENS.length})`);
    for (const z of zs) ok(z.zoom < 1 ? z.ios.join() === 'none' : z.ios.length === 0, `${w}x${h}: ${z.screen}: ${z.zoom < 1 ? `the card zooms to ${z.zoom} and iOS turns text autosizing off on it` : 'the card does not zoom and no iOS text rule reaches it'} (${JSON.stringify(z.ios)})`);
  }

  // AFMBP-2600: a computer centres every card, whatever offset its phone node gives it. The You call
  // her card sits 32px low on a phone; the first card's own offset is only .5px.
  await view(1280, 800, 1, false);
  reset();
  await load('/hvac.html?demoqa=1');
  await ev("__demoQA.open(); __demoQA.inbound('4321', true); 1");
  await sleep(400);
  const ic = await rect('.demo-backdrop.open .demo-card');
  ok(!!ic && Math.abs(ic.y + ic.h / 2 - 400) < 1 && Math.abs(ic.x + ic.w / 2 - 640) < 1, `1280x800: the You call her card centred on a computer (${ic && [ic.x.toFixed(1), ic.y.toFixed(1), ic.w.toFixed(1), ic.h.toFixed(1)]})`);

  console.log(bad ? `\n${bad} FAILED, ${good} passed${NC ? ` (negative control: ${NC})` : ''}` : `\nALL PASS (${good} checks)${NC ? ` — negative control ${NC} did NOT bite` : ''}`);
  ws.close();
} finally {
  chrome.kill('SIGKILL'); srv.close();
  await sleep(300); rmSync(PROFILE, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
