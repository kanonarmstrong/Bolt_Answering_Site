// AFMBP-2654 — Reddit serves each pixel's settings with its script: inside pixel.js, and at
// pixel-config.reddit.com (which pixel.js asks only when its own copy is missing). With automatic
// advanced matching on ("aam"), Reddit's own pixel.js reads phone numbers and emails typed on our
// pages, hashes them and sends them to Reddit, which the privacy policy says never happens.
// This fails if Reddit serves matching on (email, phone number, or anything new under "aam") for the
// pixel in reddit-pixel.js, or if those settings can't be read: fail closed, a false alarm beats
// silence. The fix is in Reddit Ads → Events Manager → the pixel → Settings: automatic advanced
// matching off for email and phone number. Runs daily and on pull requests that touch the Reddit pixel
// (.github/workflows/reddit-settings.yml); tools/real-tags-check.mjs runs Reddit's real script.
// Run: node tools/reddit-settings-check.mjs [siteRoot]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.argv[2] ?? new URL('..', import.meta.url).pathname;
const id = /var PIXEL_ID = '([A-Za-z0-9_]*)';/.exec(readFileSync(join(ROOT, 'reddit-pixel.js'), 'utf8'))?.[1];
if (id === undefined) { console.log('FAIL reddit-pixel.js has no PIXEL_ID line'); process.exit(1); }
if (!id) { console.log('PASS the Reddit pixel is off in reddit-pixel.js (empty PIXEL_ID): nothing to check'); process.exit(0); }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
async function get(url) {
  let last = '';
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
      if (r.ok) return await r.text();
      last = `HTTP ${r.status}`;
    } catch (e) { last = e.message; }
    await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
  }
  throw new Error(`${url}: ${last}`);
}
// Every value under "aam" must be false; anything else (true, a new kind, no "aam" at all) fails.
const verdict = (aam) => (aam && typeof aam === 'object' && Object.keys(aam).length > 0 && Object.values(aam).every((v) => v === false));

let bad = 0;
const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) bad++; };
console.log(`Reddit pixel ${id}: automatic advanced matching as Reddit serves it`);

// 1. The copy inside pixel.js: what actually runs on our pages (visitors get this URL, CDN max-age 300).
// Reddit's caches disagree for hours after a change (2026-11-19: 1 of 8 fetches in the same second
// still served matching ON), so read it SAMPLES times and fail on any copy that has it on.
const SAMPLES = Number(process.env.SAMPLES || 12);
const seen = new Map(); let unreadable = 0;
for (let i = 0; i < SAMPLES; i++) {
  try {
    const js = await get(`https://www.redditstatic.com/ads/pixel.js?pixel_id=${id}`);
    const m = /rdt\._serverConfig=(\{[\s\S]*?\})\}catch\(/.exec(js);
    const cfg = m ? JSON.parse(m[1]) : null;
    const key = !cfg ? 'no settings of its own (asks pixel-config.reddit.com)' : cfg.pixelId !== id ? `settings for pixel ${cfg.pixelId}` : JSON.stringify(cfg.aam ?? null);
    const prev = seen.get(key) || { n: 0, good: !cfg || (cfg.pixelId === id && verdict(cfg.aam)) };
    seen.set(key, { ...prev, n: prev.n + 1 });
  } catch { unreadable++; }
  await new Promise((r) => setTimeout(r, 500));
}
for (const [key, { n, good }] of seen) ok(good, `inside pixel.js, ${n} of ${SAMPLES} fetches: ${key}`);
ok(unreadable === 0 && seen.size > 0, `pixel.js was read every time (${SAMPLES - unreadable} of ${SAMPLES})`);

// 2. Reddit's settings endpoint: what pixel.js falls back to, and where a change shows first.
try {
  const cfg = JSON.parse(await get(`https://pixel-config.reddit.com/pixels/${id}/config`));
  ok(verdict(cfg.aam), `at pixel-config.reddit.com: ${JSON.stringify(cfg.aam ?? null)}`);
} catch (e) { ok(false, `pixel-config.reddit.com could not be read: ${e.message}`); }

console.log(bad ? `\n${bad} FAILED. If matching is ON: Reddit Ads → Events Manager → pixel ${id} → Settings → automatic advanced matching off for email and phone number (until then, put PIXEL_ID = '' in reddit-pixel.js).` : '\nALL PASS');
process.exit(bad ? 1 : 0);
